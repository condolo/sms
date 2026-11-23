/* ============================================================
   Msingi — /api/student-subjects
   Student ↔ Subject enrollment registry.
   Tracks which subjects each student is enrolled in.
   Feeds timetable (enrolled-only view) and grade entry filters.
   ============================================================ */
const express        = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac }           = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, fail, E } = require('../utils/response');

const router = express.Router();

/* GET /api/student-subjects/counts
   Returns { [subjectId]: number } — how many ACTIVE students take each
   subject, counted the way every roster in the system is built (v5.276.4):
     • a class where the subject is compulsory → every active student in it;
     • a class where it is an elective → that class's active students
       enrolled in it (student_subjects);
     • any other active student enrolled in it directly, even where it is
       not on their class's curriculum (v5.278.1).
   Reported (2026-11-18): "if enrollment for maths is 309, it should be the
   same for any compulsory subject". This used to count raw student_subjects
   rows: students who left still counted, and students in a class where the
   subject is compulsory but who never got an enrolment row did not, so two
   subjects compulsory in the same classes showed different totals. A
   student counts once per subject, whatever happened to their rows.
   Used by SubjectsPage to show enrollment badges per subject. */
router.get('/counts', authMiddleware, async (req, res) => { // rbac: intentionally open to every authenticated user — reference/count data
  try {
    const { schoolId } = req.jwtUser;
    const [links, students, rows, classes] = await Promise.all([
      tenantModel('class_subjects', tenantContext(req)).find({ schoolId, isActive: { $ne: false } }).select('classId subjectId isCompulsoryForClass').lean(),
      tenantModel('students', tenantContext(req)).find({ schoolId, status: 'active' }).select('id _id classId').lean(),
      tenantModel('student_subjects', tenantContext(req)).find({ schoolId }).select('studentId subjectId').lean(),
      tenantModel('classes', tenantContext(req)).find({ schoolId }).select('id _id').lean(),
    ]);
    // Every id form (v5.278.2): records onboarded through irregular paths can
    // lack the `id` field (the Mongo _id is then their id), and a class may be
    // referenced by either form. Both forms map to one key, so such learners
    // and classes are counted instead of silently skipped.
    const classKey = new Map();
    for (const c of classes) {
      const key = c.id || (c._id != null ? String(c._id) : null);
      if (!key) continue;
      if (c.id) classKey.set(c.id, key);
      if (c._id != null) classKey.set(String(c._id), key);
    }
    const toClass = (v) => (v == null || v === '' ? null : (classKey.get(String(v)) || String(v)));
    const studentKey = new Map();
    for (const st of students) {
      const key = st.id || (st._id != null ? String(st._id) : null);
      if (!key) continue;
      if (st.id) studentKey.set(st.id, key);
      if (st._id != null) studentKey.set(String(st._id), key);
    }
    const toStudent = (v) => (v == null ? null : studentKey.get(String(v)) || null);   // null = not an active learner

    const byClass = new Map();
    for (const st of students) {
      const sid = toStudent(st.id || st._id);
      const cid = toClass(st.classId);
      if (!cid || !sid) continue;
      if (!byClass.has(cid)) byClass.set(cid, []);
      byClass.get(cid).push(sid);
    }
    const enrolled = new Set();
    for (const r of rows) {
      const sid = toStudent(r.studentId);
      if (sid && r.subjectId) enrolled.add(`${r.subjectId}|${sid}`);
    }
    const takers = new Map();   // subjectId -> Set(student key)
    for (const l of links) {
      const roster = byClass.get(toClass(l.classId)) || [];
      if (!roster.length || !l.subjectId) continue;
      if (!takers.has(l.subjectId)) takers.set(l.subjectId, new Set());
      const set = takers.get(l.subjectId);
      for (const sid of roster) {
        if (l.isCompulsoryForClass || enrolled.has(`${l.subjectId}|${sid}`)) set.add(sid);
      }
    }
    // Learners enrolled directly (Subjects → Enroll Class / Enroll individual)
    // count too, even where the subject is not on their class's curriculum
    // (v5.278.1). Reported 2026-11-23 (Trinity): "Personal development" had
    // 23 KG1 learners enrolled but showed 0, because only curriculum-linked
    // classes were counted. Active learners only, each once.
    for (const key of enrolled) {
      const [subjectId, sid] = key.split('|');
      if (!takers.has(subjectId)) takers.set(subjectId, new Set());
      takers.get(subjectId).add(sid);
    }
    const map = {};
    for (const [subjectId, set] of takers) map[subjectId] = set.size;
    return ok(res, map);
  } catch (err) { console.error('[student-subjects GET /counts]', err); return E.serverError(res); }
});

/* GET /api/student-subjects
   ?subjectId=X  — list enrollments for a subject (includes student + class name)
   ?studentId=X  — list subjects a student is enrolled in */
router.get('/', authMiddleware, rbac('subjects', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { subjectId, studentId } = req.query;

    if (!subjectId && !studentId) return E.badRequest(res, 'subjectId or studentId required');

    const filter = { schoolId };
    if (subjectId) filter.subjectId = subjectId;
    if (studentId) filter.studentId = studentId;

    const enrollments = await tenantModel('student_subjects', tenantContext(req))
      .find(filter)
      .sort({ enrolledAt: -1 })
      .lean();

    // Populate student details when listing by subject
    if (subjectId && enrollments.length > 0) {
      const studentIds = enrollments.map(e => e.studentId);
      const [students, classes] = await Promise.all([
        tenantModel('students', tenantContext(req))
          .find({ schoolId, id: { $in: studentIds } })
          .select('id firstName lastName admissionNumber classId status')
          .lean(),
        (async () => {
          const classIds = [...new Set(
            (await tenantModel('students', tenantContext(req)).find({ schoolId, id: { $in: studentIds } }).select('classId').lean())
              .map(s => s.classId).filter(Boolean)
          )];
          return classIds.length
            ? tenantModel('classes', tenantContext(req)).find({ schoolId, id: { $in: classIds } }).select('id name').lean()
            : [];
        })(),
      ]);

      const stuMap = Object.fromEntries(students.map(s => [s.id, s]));
      const clsMap = Object.fromEntries(classes.map(c => [c.id, c]));

      return ok(res, enrollments.map(e => ({
        ...e,
        student:   stuMap[e.studentId]  ?? null,
        className: clsMap[stuMap[e.studentId]?.classId]?.name ?? null,
      })));
    }

    return ok(res, enrollments);
  } catch (err) { console.error('[student-subjects GET /]', err); return E.serverError(res); }
});

/* POST /api/student-subjects — enroll a single student
   Body: { studentId, subjectId } */
router.post('/', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { studentId, subjectId } = req.body;

    if (!studentId || !subjectId) return E.badRequest(res, 'studentId and subjectId required');

    const [student, subject] = await Promise.all([
      tenantModel('students', tenantContext(req)).findOne({ schoolId, id: studentId }).lean(),
      tenantModel('subjects', tenantContext(req)).findOne({ schoolId, id: subjectId, isActive: { $ne: false } }).lean(),
    ]);
    if (!student) return E.notFound(res, 'Student not found');
    if (!subject) return E.notFound(res, 'Subject not found');

    const existing = await tenantModel('student_subjects', tenantContext(req)).findOne({ schoolId, studentId, subjectId }).lean();
    if (existing) return E.conflict(res, 'Student is already enrolled in this subject');

    const doc = await tenantModel('student_subjects', tenantContext(req)).create({
      id:         uuidv4(),
      schoolId,
      studentId,
      subjectId,
      classId:    student.classId ?? null,
      enrolledAt: new Date(),
      enrolledBy: userId,
    });
    return created(res, doc.toObject());
  } catch (err) { console.error('[student-subjects POST /]', err); return E.serverError(res); }
});

/* POST /api/student-subjects/bulk — enroll all active students in a class
   Body: { subjectId, classId } */
router.post('/bulk', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { subjectId, classId } = req.body;

    if (!subjectId || !classId) return E.badRequest(res, 'subjectId and classId required');

    const subject = await tenantModel('subjects', tenantContext(req)).findOne({ schoolId, id: subjectId, isActive: { $ne: false } }).lean();
    if (!subject) return E.notFound(res, 'Subject not found');

    const students = await tenantModel('students', tenantContext(req))
      .find({ schoolId, classId, status: 'active' })
      .select('id classId')
      .lean();

    if (students.length === 0) {
      return ok(res, { enrolled: 0, skipped: 0, message: 'No active students found in this class' });
    }

    const alreadyEnrolled = await tenantModel('student_subjects', tenantContext(req))
      .find({ schoolId, subjectId, studentId: { $in: students.map(s => s.id) } })
      .select('studentId')
      .lean();

    const alreadyIds = new Set(alreadyEnrolled.map(e => e.studentId));

    const toInsert = students
      .filter(s => !alreadyIds.has(s.id))
      .map(s => ({
        id:         uuidv4(),
        schoolId,
        studentId:  s.id,
        subjectId,
        classId:    s.classId ?? null,
        enrolledAt: new Date(),
        enrolledBy: userId,
      }));

    if (toInsert.length > 0) await tenantModel('student_subjects', tenantContext(req)).insertMany(toInsert);

    return ok(res, {
      enrolled: toInsert.length,
      skipped:  alreadyIds.size,
      message:  `Enrolled ${toInsert.length} student${toInsert.length !== 1 ? 's' : ''}${alreadyIds.size ? `, ${alreadyIds.size} already enrolled` : ''}`,
    });
  } catch (err) { console.error('[student-subjects POST /bulk]', err); return E.serverError(res); }
});

/* DELETE /api/student-subjects/:id — unenroll
   ?force=true bypasses the has-marks warning below (the client re-sends
   the same request with this flag once the user confirms). Unenrolling
   never deletes the marks themselves — they're left in place, just no
   longer reachable from this subject's roster — this only warns before
   that happens. */
router.delete('/:id', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const enrollment = await tenantModel('student_subjects', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!enrollment) return E.notFound(res, 'Enrollment not found');

    if (req.query.force !== 'true') {
      const markCount = await tenantModel('assessment_marks', tenantContext(req)).countDocuments({
        schoolId, studentId: enrollment.studentId, subjectId: enrollment.subjectId,
      });
      if (markCount > 0) {
        return fail(res, 'HAS_MARKS', `This student already has ${markCount} recorded mark${markCount !== 1 ? 's' : ''} for this subject. Unenrolling will not delete those marks, but the student will disappear from this subject's roster and grade entry.`, 409, { markCount });
      }
    }

    await tenantModel('student_subjects', tenantContext(req)).deleteOne({ id: req.params.id, schoolId });
    return ok(res, { message: 'Student unenrolled successfully' });
  } catch (err) { console.error('[student-subjects DELETE /:id]', err); return E.serverError(res); }
});

module.exports = router;
