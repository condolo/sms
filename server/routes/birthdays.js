/* ============================================================
   Msingi — /api/birthdays
   Today's birthday lookup + one-shot daily notification send.

   GET  /api/birthdays/today     — role-filtered birthday list
   POST /api/birthdays/notify    — idempotent daily send (admin+)

   Notification rules:
     admin / principal / deputy  → see all students + teachers
     teacher                     → see only their assigned-class students
     student                     → see classmates in their class + self-flag
     parent                      → not consumed here (email only)
   ============================================================ */
const express        = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, E }          = require('../utils/response');
const email              = require('../utils/email');
const { resolveTeacher } = require('../utils/resolveTeacher');

const router = express.Router();
router.use(authMiddleware);

/* ── Helpers ───────────────────────────────────────────────── */
function _todayStr() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

const _resolveTeacher = (userId, emailAddr, schoolId) =>
  resolveTeacher(userId, emailAddr, schoolId, 'classIds');

function _monthDay(dob) {
  if (!dob) return null;
  const parts = dob.split('-');
  if (parts.length < 3) return null;
  return `${parts[1]}-${parts[2]}`; // 'MM-DD'
}

function _age(dob) {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}


/* ── Upcoming helper ───────────────────────────────────────── */
function _upcomingDays(dob) {
  if (!dob) return null;
  const [, m, d] = dob.split('-').map(Number);
  const today = new Date();
  let bday = new Date(today.getFullYear(), m - 1, d);
  if (bday <= today) bday.setFullYear(today.getFullYear() + 1);
  const diff = Math.round((bday - today) / 86400000);
  return diff > 0 && diff <= 7 ? diff : null;
}

/* ── GET /api/birthdays/today ──────────────────────────────── */
router.get('/today', rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const todayMD  = _todayStr().slice(5); // 'MM-DD'
    const Students = tenantModel('students', tenantContext(req));
    const Teachers = tenantModel('teachers', tenantContext(req));

    let studentFilter = { schoolId, status: 'active' };

    /* Teacher — restrict to their assigned classes */
    if (role === 'teacher') {
      const teacher  = await _resolveTeacher(userId, req.jwtUser.email, schoolId);
      const classIds = teacher?.classIds ?? [];
      if (classIds.length > 0) {
        studentFilter.classId = { $in: classIds };
      } else {
        return ok(res, { students: [], upcoming: [], teachers: [], todayMD });
      }
    }

    /* Student — restrict to their own class */
    if (role === 'student') {
      const self = await Students.findOne({ userId, schoolId }).select('classId').lean()
        ?? await Students.findOne({ schoolEmail: req.jwtUser.email, schoolId }).select('classId').lean();
      if (self?.classId) {
        studentFilter.classId = self.classId;
      } else {
        return ok(res, { students: [], upcoming: [], teachers: [], todayMD });
      }
    }

    /* All students in scope — filter by month-day in JS (regex on YYYY-MM-DD) */
    const allStudents = await Students.find(studentFilter)
      .select('id firstName lastName dateOfBirth gender className classId schoolEmail')
      .lean();

    const birthdayStudents = [];
    const upcomingStudents = [];

    for (const s of allStudents) {
      const md = _monthDay(s.dateOfBirth);
      if (!md) continue;
      const base = {
        id:        s.id || s._id?.toString(),
        firstName: s.firstName,
        lastName:  s.lastName,
        age:       _age(s.dateOfBirth),
        gender:    s.gender,
        className: s.className ?? null,
        type:      'student',
      };
      if (md === todayMD) {
        birthdayStudents.push(base);
      } else {
        const days = _upcomingDays(s.dateOfBirth);
        if (days !== null) upcomingStudents.push({ ...base, daysUntil: days });
      }
    }
    upcomingStudents.sort((a, b) => a.daysUntil - b.daysUntil);

    /* Teachers — only for admin/principal roles */
    let birthdayTeachers = [];
    if (['superadmin', 'admin', 'principal', 'deputy_principal'].includes(role)) {
      const allTeachers = await Teachers.find({ schoolId })
        .select('id firstName lastName dateOfBirth gender title')
        .lean();
      birthdayTeachers = allTeachers
        .filter(t => _monthDay(t.dateOfBirth) === todayMD)
        .map(t => ({
          id:        t.id || t._id?.toString(),
          firstName: t.firstName,
          lastName:  t.lastName,
          age:       _age(t.dateOfBirth),
          gender:    t.gender,
          title:     t.title ?? null,
          type:      'teacher',
        }));
    }

    /* Fire-and-forget notification send for admins (first login of the day) */
    if (['superadmin', 'admin', 'principal'].includes(role) && birthdayStudents.length > 0) {
      _sendDailyBirthdays(schoolId, birthdayStudents).catch(() => {});
    }

    return ok(res, { students: birthdayStudents, upcoming: upcomingStudents, teachers: birthdayTeachers, todayMD });
  } catch (err) {
    console.error('[birthdays GET /today]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/birthdays/notify — manual trigger (admin only) ─ */
router.post('/notify', rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!['superadmin', 'admin', 'principal', 'deputy_principal'].includes(role)) {
      return E.forbidden(res, 'Only admin can trigger birthday notifications.');
    }

    const todayMD  = _todayStr().slice(5);
    const Students = tenantModel('students', tenantContext(req));
    const allStudents = await Students.find({ schoolId, status: 'active' })
      .select('id firstName lastName dateOfBirth gender className schoolEmail parentEmail parentName')
      .lean();

    const birthdayStudents = allStudents
      .filter(s => _monthDay(s.dateOfBirth) === todayMD)
      .map(s => ({ ...s, id: s.id || s._id?.toString(), age: _age(s.dateOfBirth) }));

    const result = await _sendDailyBirthdays(schoolId, birthdayStudents, true);
    return ok(res, result);
  } catch (err) {
    console.error('[birthdays POST /notify]', err);
    return E.serverError(res);
  }
});

/* ── Idempotent daily send ─────────────────────────────────── */
async function _sendDailyBirthdays(schoolId, birthdayStudents, force = false) {
  if (!birthdayStudents.length) return { notified: 0, skipped: 0 };

  const Log    = tenantModel('birthday_sent', { schoolId });
  const School = _model('schools');
  const today  = _todayStr();

  /* Check per-student records for today to ensure idempotency */
  const studentIds = birthdayStudents.map(s => s.id).filter(Boolean);
  const alreadySent = await Log.find({ schoolId, date: today, studentId: { $in: studentIds } })
    .select('studentId').lean();
  const sentSet = new Set(alreadySent.map(l => l.studentId));

  if (!force && sentSet.size === studentIds.length) {
    return { notified: 0, skipped: studentIds.length };
  }

  const school = await School.findOne({ id: schoolId }).select('name systemEmail').lean();
  const schoolName  = school?.name  ?? 'Your School';
  const schoolEmail = school?.systemEmail ?? '';

  let notified = 0;
  let skipped  = 0;

  for (const s of birthdayStudents) {
    if (!force && sentSet.has(s.id)) { skipped++; continue; }

    const age = s.age ?? _age(s.dateOfBirth);

    /* Log first to prevent duplicate sends on retry */
    await Log.updateOne(
      { schoolId, date: today, studentId: s.id },
      { $setOnInsert: { id: uuidv4(), schoolId, date: today, studentId: s.id, sentAt: new Date() } },
      { upsert: true }
    ).catch(() => {});

    /* Email to student */
    if (s.schoolEmail) {
      email.sendBirthdayWishToStudent({
        firstName:   s.firstName,
        toEmail:     s.schoolEmail,
        age,
        schoolName,
        schoolEmail,
        schoolId,
      }).catch(err => console.error('[birthday] student email failed:', err.message));
    }

    /* Email to parent */
    if (s.parentEmail) {
      email.sendBirthdayWishToParent({
        parentName:       s.parentName,
        toEmail:          s.parentEmail,
        studentFirstName: s.firstName,
        studentGender:    s.gender,
        age,
        schoolName,
        schoolEmail,
        schoolId,
      }).catch(err => console.error('[birthday] parent email failed:', err.message));
    }

    notified++;
  }

  return { notified, skipped };
}

module.exports = router;
