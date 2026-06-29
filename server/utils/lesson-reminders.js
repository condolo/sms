/* ============================================================
   Msingi — Lesson Coverage Reminders
   Scheduled jobs that remind teachers to update their lesson
   coverage and escalate to HODs when they don't.

   Schedule:
   ┌─ Friday ~5pm (end of school day):
   │   Check each teacher's last Friday timetable slot.
   │   For any teacher whose last slot ended and who has
   │   uncovered topics for today's class: send email reminder.
   │
   ├─ Saturday 12:00pm:
   │   Second reminder to teachers who still have uncovered topics.
   │
   └─ Saturday 4:00pm (HOD escalation):
       If teacher still hasn't updated, notify their HOD with
       a list of pending staff.

   All times are in the server timezone (UTC).
   For UTC+3 Kenya schools: 5pm Kenya = 2pm UTC.
   Override via LESSON_REMINDER_TZ env var (node-cron schedule).
   ============================================================ */
'use strict';

const cron         = require('node-cron');
const { _model }   = require('./model');
const { sendLessonReminder, sendHodEscalation } = require('./lesson-email');

/* ── Config ─────────────────────────────────────────────────── */
// Friday end-of-day reminder: 5pm Kenya (UTC+3) = 14:00 UTC
// Saturday first  reminder:  12:00pm Kenya       = 09:00 UTC
// Saturday HOD escalation:    4:00pm Kenya       = 13:00 UTC
// Override via env vars for different school timezones.
const CRON_FRIDAY_ENDOFDAY = process.env.LESSON_CRON_FRIDAY   || '0 14 * * 5';  // Fri 14:00 UTC
const CRON_SAT_MIDDAY      = process.env.LESSON_CRON_SAT_NOON || '0 9 * * 6';   // Sat 09:00 UTC
const CRON_SAT_HOD         = process.env.LESSON_CRON_SAT_HOD  || '0 13 * * 6';  // Sat 13:00 UTC

/* ── Helper: get all active schools ─────────────────────────── */
async function _getActiveSchools() {
  return _model('schools')
    .find({ status: { $ne: 'suspended' } })
    .select('id name academicYear plan')
    .lean();
}

/* ── Helper: get teacher email ───────────────────────────────── */
async function _teacherEmail(schoolId, teacherId) {
  const user = await _model('users').findOne({ id: teacherId, schoolId }).select('email name').lean();
  return user ?? null;
}

/* ── Helper: get teachers with pending coverage for a school ─── */
/*
  Returns teachers who:
  1. Have teaching assignments in this school
  2. Had at least one timetable slot on the given dayOfWeek
  3. Have at least one uncovered topic/subtopic for those class-subject pairs
*/
async function _getPendingTeachers(schoolId, academicYear, dayOfWeek) {
  // dayOfWeek: 'friday' (lowercase string matching timetable 'day' field)

  // 1. Get assignments
  const assignments = await _model('teaching_assignments')
    .find({ schoolId })
    .select('teacherId teacherName classId className subjectId subjectName')
    .lean();

  if (!assignments.length) return [];

  // 2. Get teachers who had a timetable slot on the given day
  const teacherIds = [...new Set(assignments.map(a => a.teacherId))];
  const slots      = await _model('timetable').find({
    schoolId,
    teacherId: { $in: teacherIds },
    day: dayOfWeek,
  }).select('teacherId classId subjectId').lean();

  if (!slots.length) return [];

  // Teachers who taught today
  const taughtToday = new Set(slots.map(s => s.teacherId));

  // Filter assignments to those teachers
  const relevantAssignments = assignments.filter(a => taughtToday.has(a.teacherId));

  // 3. Group by teacher
  const byTeacher = {};
  relevantAssignments.forEach(a => {
    if (!byTeacher[a.teacherId]) {
      byTeacher[a.teacherId] = { teacherId: a.teacherId, teacherName: a.teacherName, pending: [] };
    }
    byTeacher[a.teacherId].pending.push({
      classId: a.classId, className: a.className,
      subjectId: a.subjectId, subjectName: a.subjectName,
    });
  });

  // 4. For each teacher, check if any topics are uncovered
  const pendingTeachers = [];

  await Promise.all(Object.values(byTeacher).map(async (t) => {
    let hasUncovered = false;
    await Promise.all(t.pending.map(async (c) => {
      if (hasUncovered) return;

      const topics = await _model('syllabus_topics')
        .find({ schoolId, subjectId: c.subjectId, academicYear })
        .select('id subtopics').lean();

      if (!topics.length) return; // no curriculum defined yet

      let totalItems = 0;
      topics.forEach(tp => { totalItems += tp.subtopics?.length ? tp.subtopics.length : 1; });

      const coveredCount = await _model('lesson_coverage').countDocuments({
        schoolId, classId: c.classId, subjectId: c.subjectId, academicYear,
      });

      if (coveredCount < totalItems) hasUncovered = true;
    }));

    if (hasUncovered) pendingTeachers.push(t);
  }));

  return pendingTeachers;
}

/* ── Helper: get HOD email for a teacher ───────────────────── */
async function _getHodsForSchool(schoolId) {
  // Find users with hod role
  const hods = await _model('users')
    .find({ schoolId, $or: [{ role: 'hod' }, { roles: 'hod' }, { extraRoles: 'hod' }] })
    .select('id name email departmentId')
    .lean();
  return hods;
}

/* ── Job: Friday end-of-day ──────────────────────────────────── */
async function runFridayReminder() {
  console.log('[LessonReminders] Running Friday end-of-day check...');
  try {
    const schools = await _getActiveSchools();
    let totalReminders = 0;

    for (const school of schools) {
      // Only standard+ plans
      if (!['standard', 'premium', 'enterprise'].includes(school.plan)) continue;

      const academicYear = school.academicYear ?? String(new Date().getFullYear());
      const pending      = await _getPendingTeachers(school.id, academicYear, 'friday');

      for (const teacher of pending) {
        const user = await _teacherEmail(school.id, teacher.teacherId);
        if (!user?.email) continue;

        await sendLessonReminder({
          toEmail:     user.email,
          toName:      user.name || teacher.teacherName,
          schoolName:  school.name,
          type:        'friday',
          pendingCount: teacher.pending.length,
        });
        totalReminders++;
      }
    }

    console.log(`[LessonReminders] Friday check complete — ${totalReminders} reminder(s) sent.`);
  } catch (err) {
    console.error('[LessonReminders] Friday job error:', err.message);
  }
}

/* ── Job: Saturday 12pm ──────────────────────────────────────── */
async function runSaturdayMorningReminder() {
  console.log('[LessonReminders] Running Saturday 12pm check...');
  try {
    const schools = await _getActiveSchools();
    let totalReminders = 0;

    for (const school of schools) {
      if (!['standard', 'premium', 'enterprise'].includes(school.plan)) continue;

      const academicYear = school.academicYear ?? String(new Date().getFullYear());
      // Check Friday's teachers who still haven't updated
      const pending      = await _getPendingTeachers(school.id, academicYear, 'friday');

      for (const teacher of pending) {
        const user = await _teacherEmail(school.id, teacher.teacherId);
        if (!user?.email) continue;

        await sendLessonReminder({
          toEmail:     user.email,
          toName:      user.name || teacher.teacherName,
          schoolName:  school.name,
          type:        'saturday_morning',
          pendingCount: teacher.pending.length,
        });
        totalReminders++;
      }
    }

    console.log(`[LessonReminders] Saturday morning check complete — ${totalReminders} reminder(s) sent.`);
  } catch (err) {
    console.error('[LessonReminders] Saturday morning job error:', err.message);
  }
}

/* ── Job: Saturday 4pm — HOD escalation ─────────────────────── */
async function runSaturdayHodEscalation() {
  console.log('[LessonReminders] Running Saturday 4pm HOD escalation...');
  try {
    const schools = await _getActiveSchools();
    let totalEscalations = 0;

    for (const school of schools) {
      if (!['standard', 'premium', 'enterprise'].includes(school.plan)) continue;

      const academicYear = school.academicYear ?? String(new Date().getFullYear());
      const pending      = await _getPendingTeachers(school.id, academicYear, 'friday');

      if (!pending.length) continue;

      // Get HODs for this school
      const hods = await _getHodsForSchool(school.id);
      if (!hods.length) {
        // Fallback: notify admin users
        const admins = await _model('users')
          .find({ schoolId: school.id, $or: [{ role: 'admin' }, { role: 'principal' }] })
          .select('email name').lean();
        for (const admin of admins) {
          if (!admin.email) continue;
          await sendHodEscalation({
            toEmail:    admin.email,
            toName:     admin.name,
            schoolName: school.name,
            pending,
          });
          totalEscalations++;
        }
        continue;
      }

      for (const hod of hods) {
        if (!hod.email) continue;
        await sendHodEscalation({
          toEmail:    hod.email,
          toName:     hod.name,
          schoolName: school.name,
          pending,
        });
        totalEscalations++;
      }
    }

    console.log(`[LessonReminders] Saturday HOD escalation complete — ${totalEscalations} escalation(s) sent.`);
  } catch (err) {
    console.error('[LessonReminders] Saturday HOD escalation error:', err.message);
  }
}

/* ── Start all scheduled jobs ────────────────────────────────── */
function startLessonReminders() {
  if (!cron.validate(CRON_FRIDAY_ENDOFDAY) ||
      !cron.validate(CRON_SAT_MIDDAY)      ||
      !cron.validate(CRON_SAT_HOD)) {
    console.error('[LessonReminders] Invalid cron expression — reminders NOT started. Check LESSON_CRON_* env vars.');
    return;
  }

  cron.schedule(CRON_FRIDAY_ENDOFDAY, runFridayReminder,         { timezone: 'UTC' });
  cron.schedule(CRON_SAT_MIDDAY,      runSaturdayMorningReminder, { timezone: 'UTC' });
  cron.schedule(CRON_SAT_HOD,         runSaturdayHodEscalation,  { timezone: 'UTC' });

  console.log('[LessonReminders] Scheduled:');
  console.log(`  Friday end-of-day:  ${CRON_FRIDAY_ENDOFDAY} UTC`);
  console.log(`  Saturday 12pm:      ${CRON_SAT_MIDDAY} UTC`);
  console.log(`  Saturday HOD 4pm:   ${CRON_SAT_HOD} UTC`);
}

module.exports = { startLessonReminders, runFridayReminder, runSaturdayMorningReminder, runSaturdayHodEscalation };
