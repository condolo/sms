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
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();

/* GET /api/student-subjects/counts
   Returns { [subjectId]: number } for all subjects in the school.
   Used by SubjectsPage to show enrollment badges per subject. */
router.get('/counts', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const agg = await _model('student_subjects').aggregate([
      { $match: { schoolId } },
      { $group: { _id: '$subjectId', count: { $sum: 1 } } },
    ]);
    const map = {};
    for (const { _id, count } of agg) map[_id] = count;
    return ok(res, map);
  } catch (err) { console.error('[student-subjects GET /counts]', err); return E.serverError(res); }
});

/* GET /api/student-subjects
   ?subjectId=X  — list enrollments for a subject (includes student + class name)
   ?studentId=X  — list subjects a student is enrolled in */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { subjectId, studentId } = req.query;

    if (!subjectId && !studentId) return E.badRequest(res, 'subjectId or studentId required');

    const filter = { schoolId };
    if (subjectId) filter.subjectId = subjectId;
    if (studentId) filter.studentId = studentId;

    const enrollments = await _model('student_subjects')
      .find(filter)
      .sort({ enrolledAt: -1 })
      .lean();

    // Populate student details when listing by subject
    if (subjectId && enrollments.length > 0) {
      const studentIds = enrollments.map(e => e.studentId);
      const [students, classes] = await Promise.all([
        _model('students')
          .find({ schoolId, id: { $in: studentIds } })
          .select('id firstName lastName admissionNumber classId status')
          .lean(),
        (async () => {
          const classIds = [...new Set(
            (await _model('students').find({ schoolId, id: { $in: studentIds } }).select('classId').lean())
              .map(s => s.classId).filter(Boolean)
          )];
          return classIds.length
            ? _model('classes').find({ schoolId, id: { $in: classIds } }).select('id name').lean()
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
      _model('students').findOne({ schoolId, id: studentId }).lean(),
      _model('subjects').findOne({ schoolId, id: subjectId, isActive: { $ne: false } }).lean(),
    ]);
    if (!student) return E.notFound(res, 'Student not found');
    if (!subject) return E.notFound(res, 'Subject not found');

    const existing = await _model('student_subjects').findOne({ schoolId, studentId, subjectId }).lean();
    if (existing) return E.conflict(res, 'Student is already enrolled in this subject');

    const doc = await _model('student_subjects').create({
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

    const subject = await _model('subjects').findOne({ schoolId, id: subjectId, isActive: { $ne: false } }).lean();
    if (!subject) return E.notFound(res, 'Subject not found');

    const students = await _model('students')
      .find({ schoolId, classId, status: 'active' })
      .select('id classId')
      .lean();

    if (students.length === 0) {
      return ok(res, { enrolled: 0, skipped: 0, message: 'No active students found in this class' });
    }

    const alreadyEnrolled = await _model('student_subjects')
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

    if (toInsert.length > 0) await _model('student_subjects').insertMany(toInsert);

    return ok(res, {
      enrolled: toInsert.length,
      skipped:  alreadyIds.size,
      message:  `Enrolled ${toInsert.length} student${toInsert.length !== 1 ? 's' : ''}${alreadyIds.size ? `, ${alreadyIds.size} already enrolled` : ''}`,
    });
  } catch (err) { console.error('[student-subjects POST /bulk]', err); return E.serverError(res); }
});

/* DELETE /api/student-subjects/:id — unenroll */
router.delete('/:id', authMiddleware, rbac('subjects', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await _model('student_subjects').findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Enrollment not found');
    return ok(res, { message: 'Student unenrolled successfully' });
  } catch (err) { console.error('[student-subjects DELETE /:id]', err); return E.serverError(res); }
});

module.exports = router;
