/* ============================================================
   Msingi — /api/assignments
   Native assignments: teacher issues work, a student submits it,
   the teacher grades it, and the mark lands in the Markbook through
   the same deterministic planner Google Classroom uses.

   This is the "survive without Google" surface. Google Classroom
   remains an optional source; nothing here calls Google.

   Sub-routes:
     GET    /                     — list (role-scoped)
     GET    /exceptions           — grades that could not reach the Markbook
     POST   /                     — create (teacher/admin)
     GET    /:id                  — detail
     PATCH  /:id                  — update title/due/points/status
     DELETE /:id                  — delete assignment + submissions
     GET    /:id/submissions      — roster + submission status (teacher)
     POST   /:id/grade            — grade one student
     POST   /:id/submit           — student turns work in (self-scoped)
   ============================================================ */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { rbac } = require('../middleware/rbac');
const { planGate } = require('../middleware/plan');
const { moduleGate } = require('../middleware/module-gate');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created: createdRes, E } = require('../utils/response');
const { resolveTeacher } = require('../utils/resolveTeacher');
const { isManagement, canWriteSubject, unassignedPairs } = require('../utils/subject-scope');
const { taughtPairs } = require('../utils/teaching-scope');
const { planClassroomMark } = require('../utils/classroom-mark-plan');
const { firstArchivedYear } = require('../utils/archival');

const router = express.Router();
const PLAN = planGate('elearning');
const MODGATE = moduleGate('elearning');

const TYPES = ['ASSIGNMENT', 'SHORT_ANSWER_QUESTION', 'MULTIPLE_CHOICE_QUESTION', 'MATERIAL'];
const STUDENT_ROLES = new Set(['student']);

/* A student holds no staff permission grants — their read is self-scoped by
   _listFilter/_canRead, so the staff rbac gate is skipped for that role only. */
const staffRead = rbac('elearning', 'read');
function readAccess(req, res, next) {
  if (STUDENT_ROLES.has(req.jwtUser?.role)) return next();
  return staffRead(req, res, next);
}

/* ── Validation ─────────────────────────────────────────────── */

const CreateSchema = z.object({
  classId: z.string().min(1),
  subjectId: z.string().min(1),
  streamId: z.string().min(1).optional().nullable(),
  type: z.enum(TYPES).optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().max(5000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  maxPoints: z.number().positive().max(1000).optional().nullable(),
  scheduledTime: z.string().optional().nullable(),
  assessmentScheduleId: z.string().min(1).optional().nullable(),
  allowLate: z.boolean().optional(),
});

const UpdateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().max(5000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  maxPoints: z.number().positive().max(1000).optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  scheduledTime: z.string().optional().nullable(),
  assessmentScheduleId: z.string().min(1).optional().nullable(),
  allowLate: z.boolean().optional(),
});

const SubmitSchema = z.object({
  textAnswer: z.string().max(20000).optional(),
  attachmentIds: z.array(z.string()).max(10).optional(),
});

const GradeSchema = z.object({
  studentId: z.string().min(1),
  assignedGrade: z.number().min(0),
  feedback: z.string().max(2000).optional(),
});

/* ── Helpers ─────────────────────────────────────────────────── */

function _bad(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

async function _teacherClassIds(req, teacher) {
  if (!teacher) return [];
  const { schoolId } = req.jwtUser;
  const [streams, classes] = await Promise.all([
    tenantModel('streams', tenantContext(req))
      .find({ schoolId, $or: [{ formTeacherId: teacher.id }, { assistantFormTeacherId: teacher.id }] })
      .select('classId').lean().catch(() => []),
    tenantModel('classes', tenantContext(req))
      .find({ schoolId, formTeacherId: teacher.id }).select('id').lean().catch(() => []),
  ]);
  return [...new Set([...streams.map(s => s.classId), ...classes.map(c => c.id)].filter(Boolean))];
}

/**
 * A published assignment is readable by management, its creator, a teacher
 * assigned to that exact {class, subject[, stream]} pair, or the class
 * teacher (oversight across every subject in their class). Students may
 * read their own class's published work only.
 */
async function _canRead(req, assignment) {
  const { schoolId, role, userId, studentId } = req.jwtUser;
  if (isManagement(req)) return true;

  if (STUDENT_ROLES.has(role)) {
    if (!studentId) return false;
    const student = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: studentId }).select('classId').lean();
    return !!student && student.classId === assignment.classId && assignment.status === 'PUBLISHED';
  }

  if (assignment.teacherId === userId) return true;

  const denied = await unassignedPairs(req, [{
    classId: assignment.classId,
    subjectId: assignment.subjectId,
    streamId: assignment.streamId ?? null,
  }]);
  if (denied.length === 0) return true;

  const teacher = await resolveTeacher(userId, req.jwtUser.email, schoolId);
  const classIds = await _teacherClassIds(req, teacher);
  return classIds.includes(assignment.classId);
}

/** Filter for GET / — the same rule as _canRead, expressed once as a query. */
async function _listFilter(req) {
  const { schoolId, role, userId, studentId } = req.jwtUser;

  if (STUDENT_ROLES.has(role)) {
    if (!studentId) return null;
    const student = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: studentId }).select('classId').lean();
    if (!student) return null;
    return { schoolId, classId: student.classId, status: 'PUBLISHED' };
  }

  if (isManagement(req)) return { schoolId };

  const filter = { schoolId };
  const taught = await taughtPairs(req);
  const teacher = await resolveTeacher(userId, req.jwtUser.email, schoolId);
  const classTeacherIds = await _teacherClassIds(req, teacher);

  const or = [{ teacherId: userId }];
  if (taught) {
    or.push(...taught.map(p => ({
      classId: p.classId,
      subjectId: p.subjectId,
      ...(p.streamId ? { $or: [{ streamId: p.streamId }, { streamId: null }] } : {}),
    })));
  }
  if (classTeacherIds.length) or.push({ classId: { $in: classTeacherIds } });
  filter.$or = or;
  return filter;
}

/** Adds class and subject names so mobile can render a row without extra calls. */
async function _withNames(req, assignments) {
  if (!assignments.length) return assignments;
  const { schoolId } = req.jwtUser;
  const classIds = [...new Set(assignments.map(a => a.classId).filter(Boolean))];
  const subjectIds = [...new Set(assignments.map(a => a.subjectId).filter(Boolean))];
  const [classDocs, subjectDocs] = await Promise.all([
    classIds.length
      ? tenantModel('classes', tenantContext(req)).find({ schoolId, id: { $in: classIds } }).select('id name').lean()
      : [],
    subjectIds.length
      ? tenantModel('subjects', tenantContext(req)).find({ schoolId, id: { $in: subjectIds } }).select('id name').lean()
      : [],
  ]);
  const classNames = Object.fromEntries(classDocs.map(c => [c.id, c.name]));
  const subjectNames = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));
  return assignments.map(a => ({
    ...a,
    className: classNames[a.classId] || null,
    subjectName: subjectNames[a.subjectId] || null,
  }));
}

async function _withCounts(req, assignments) {
  if (!assignments.length) return assignments;
  const ids = assignments.map(a => a.id);
  const subs = await tenantModel('assignment_submissions', tenantContext(req))
    .find({ schoolId: req.jwtUser.schoolId, assignmentId: { $in: ids } })
    .select('assignmentId status').lean();

  const byAssignment = new Map();
  for (const s of subs) {
    const row = byAssignment.get(s.assignmentId) || { submitted: 0, graded: 0 };
    if (s.status !== 'ASSIGNED') row.submitted += 1;
    if (s.status === 'GRADED' || s.status === 'RETURNED') row.graded += 1;
    byAssignment.set(s.assignmentId, row);
  }
  return assignments.map(a => ({
    ...a,
    submittedCount: byAssignment.get(a.id)?.submitted ?? 0,
    gradedCount:    byAssignment.get(a.id)?.graded ?? 0,
  }));
}

function _exceptionDoc(req, assignment, studentId, reason, detail) {
  return {
    id: uuidv4(),
    schoolId: req.jwtUser.schoolId,
    kind: String(reason || 'unknown').toUpperCase(),
    assignmentId: assignment.id,
    teacherId: assignment.teacherId ?? null,
    studentId: studentId ?? null,
    detail: detail || '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

async function _upsertException(req, doc) {
  const Exceptions = tenantModel('assignment_sync_exceptions', tenantContext(req));
  const existing = await Exceptions.findOne({
    schoolId: doc.schoolId,
    kind: doc.kind,
    assignmentId: doc.assignmentId,
    studentId: doc.studentId,
    resolvedAt: null,
  }).lean();
  if (existing) return existing;
  await Exceptions.create(doc);
  return doc;
}

/* ── List ────────────────────────────────────────────────────── */

router.get('/', authMiddleware, PLAN, MODGATE, readAccess, async (req, res) => {
  // rbac: staff use elearning:read; a student is self-scoped by _listFilter
  try {
    const filter = await _listFilter(req);
    if (!filter) return ok(res, { assignments: [] });

    if (req.query.classId) filter.classId = req.query.classId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mine === '1' && !STUDENT_ROLES.has(req.jwtUser.role)) {
      filter.teacherId = req.jwtUser.userId;
    }

    const assignments = await tenantModel('assignments', tenantContext(req))
      .find(filter)
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(200)
      .lean();

    const rows = await _withNames(req, await _withCounts(req, assignments));

    // A student's own status travels with the list so the portal can show
    // "not started / submitted / graded" without one request per card.
    if (STUDENT_ROLES.has(req.jwtUser.role) && req.jwtUser.studentId) {
      const own = await tenantModel('assignment_submissions', tenantContext(req))
        .find({ schoolId: req.jwtUser.schoolId, studentId: req.jwtUser.studentId, assignmentId: { $in: rows.map(a => a.id) } })
        .select('assignmentId status assignedGrade rawScore submittedAt feedback markWriteStatus').lean();
      const byAssignment = new Map(own.map(s => [s.assignmentId, s]));
      return ok(res, {
        assignments: rows.map(a => ({ ...a, submission: byAssignment.get(a.id) || null })),
      });
    }

    return ok(res, { assignments: rows });
  } catch (err) {
    console.error('[assignments GET]', err);
    return E.serverError(res, 'Could not load assignments.');
  }
});

/* ── Exceptions ──────────────────────────────────────────────── */

router.get('/exceptions', authMiddleware, PLAN, MODGATE, rbac('elearning', 'read'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const filter = { schoolId, resolvedAt: null };
    if (!isManagement(req)) filter.teacherId = userId;

    // teacherId is denormalized onto the exception when it is raised; older
    // rows without it are still visible to management only.
    const exceptions = await tenantModel('assignment_sync_exceptions', tenantContext(req))
      .find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return ok(res, { exceptions });
  } catch (err) {
    console.error('[assignments exceptions GET]', err);
    return E.serverError(res, 'Could not load sync exceptions.');
  }
});

/* ── Create ──────────────────────────────────────────────────── */

router.post('/', authMiddleware, PLAN, MODGATE, rbac('elearning', 'create'), async (req, res) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })));
    }
    const d = parsed.data;
    const { schoolId, userId } = req.jwtUser;
    const type = d.type || 'ASSIGNMENT';

    if (!(await canWriteSubject(req, d.classId, d.subjectId, d.streamId ?? null))) {
      return _bad(res, `You are not assigned to teach: ${d.subjectId}`, 403);
    }

    if (d.assessmentScheduleId) {
      const schedule = await tenantModel('assessment_schedule', tenantContext(req))
        .findOne({ schoolId, id: d.assessmentScheduleId }).select('id').lean();
      if (!schedule) return _bad(res, 'assessmentScheduleId does not match a configured assessment for this school.');
    }

    const maxPoints = type === 'MATERIAL' ? null : (d.maxPoints ?? 100);
    const status = d.scheduledTime && new Date(d.scheduledTime).getTime() > Date.now() ? 'DRAFT' : 'PUBLISHED';

    const doc = {
      id: uuidv4(),
      schoolId,
      classId: d.classId,
      subjectId: d.subjectId,
      streamId: d.streamId ?? null,
      source: 'native',
      type,
      title: d.title,
      description: d.description || '',
      status,
      maxPoints,
      dueDate: d.dueDate || null,
      dueTime: d.dueTime || null,
      scheduledTime: d.scheduledTime || null,
      assessmentScheduleId: d.assessmentScheduleId || null,
      allowLate: d.allowLate === true,
      teacherId: userId,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await tenantModel('assignments', tenantContext(req)).create(doc);
    return createdRes(res, { assignment: doc });
  } catch (err) {
    console.error('[assignments POST]', err);
    return E.serverError(res, 'Could not create the assignment.');
  }
});

/* ── Detail ──────────────────────────────────────────────────── */

router.get('/:id', authMiddleware, PLAN, MODGATE, readAccess, async (req, res) => {
  // rbac: staff use elearning:read; a student is self-scoped by _canRead
  try {
    const { schoolId, studentId } = req.jwtUser;
    const assignment = await tenantModel('assignments', tenantContext(req))
      .findOne({ schoolId, id: req.params.id }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found.');
    if (!(await _canRead(req, assignment))) return E.forbidden(res, 'You do not have access to this assignment.');

    const payload = { assignment };
    if (studentId && STUDENT_ROLES.has(req.jwtUser.role)) {
      payload.submission = await tenantModel('assignment_submissions', tenantContext(req))
        .findOne({ schoolId, assignmentId: assignment.id, studentId }).lean();
    }
    return ok(res, payload);
  } catch (err) {
    console.error('[assignments/:id GET]', err);
    return E.serverError(res, 'Could not load the assignment.');
  }
});

/* ── Update ──────────────────────────────────────────────────── */

router.patch('/:id', authMiddleware, PLAN, MODGATE, rbac('elearning', 'update'), async (req, res) => {
  try {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })));
    }
    const { schoolId, userId } = req.jwtUser;
    const Assignments = tenantModel('assignments', tenantContext(req));
    const assignment = await Assignments.findOne({ schoolId, id: req.params.id }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found.');

    const owns = assignment.teacherId === userId || isManagement(req);
    if (!owns) return E.forbidden(res, 'Only the teacher who issued this assignment may edit it.');

    const patch = { ...parsed.data, updatedAt: new Date().toISOString() };
    if (parsed.data.maxPoints === null && assignment.type !== 'MATERIAL') {
      return _bad(res, 'Points are required for graded work.');
    }
    if (assignment.type === 'MATERIAL') patch.maxPoints = null;

    await Assignments.updateOne({ schoolId, id: assignment.id }, { $set: patch });
    const updated = await Assignments.findOne({ schoolId, id: assignment.id }).lean();
    return ok(res, { assignment: updated });
  } catch (err) {
    console.error('[assignments/:id PATCH]', err);
    return E.serverError(res, 'Could not update the assignment.');
  }
});

/* ── Delete ──────────────────────────────────────────────────── */

router.delete('/:id', authMiddleware, PLAN, MODGATE, rbac('elearning', 'update'), async (req, res) => {
  // The creator may withdraw their own work; 'update' (not 'delete') is the
  // grant teachers hold by default. Management may delete any assignment.
  try {
    const { schoolId, userId } = req.jwtUser;
    const Assignments = tenantModel('assignments', tenantContext(req));
    const assignment = await Assignments.findOne({ schoolId, id: req.params.id }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found.');
    if (assignment.teacherId !== userId && !isManagement(req)) {
      return E.forbidden(res, 'Only the teacher who issued this assignment may delete it.');
    }

    await Promise.all([
      Assignments.deleteOne({ schoolId, id: assignment.id }),
      tenantModel('assignment_submissions', tenantContext(req)).deleteMany({ schoolId, assignmentId: assignment.id }),
      tenantModel('assignment_sync_exceptions', tenantContext(req)).deleteMany({ schoolId, assignmentId: assignment.id }),
    ]);
    return ok(res, { deleted: true });
  } catch (err) {
    console.error('[assignments/:id DELETE]', err);
    return E.serverError(res, 'Could not delete the assignment.');
  }
});

/* ── Roster + submissions ────────────────────────────────────── */

router.get('/:id/submissions', authMiddleware, PLAN, MODGATE, rbac('elearning', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const assignment = await tenantModel('assignments', tenantContext(req))
      .findOne({ schoolId, id: req.params.id }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found.');
    if (!(await _canRead(req, assignment))) return E.forbidden(res, 'You do not have access to this assignment.');

    const studentFilter = { schoolId, classId: assignment.classId };
    if (assignment.streamId) studentFilter.streamId = assignment.streamId;
    const students = await tenantModel('students', tenantContext(req))
      .find(studentFilter)
      .select('id name firstName lastName admissionNumber streamId')
      .sort({ name: 1 })
      .lean();

    const submissions = await tenantModel('assignment_submissions', tenantContext(req))
      .find({ schoolId, assignmentId: assignment.id })
      .select('studentId status assignedGrade rawScore submittedAt gradedAt feedback textAnswer markWriteStatus skipReason attemptNo')
      .lean();
    const byStudent = new Map(submissions.map(s => [s.studentId, s]));

    const rows = students.map(s => ({
      studentId: s.id,
      name: s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Student',
      admissionNumber: s.admissionNumber || null,
      streamId: s.streamId ?? null,
      submission: byStudent.get(s.id) || null,
    }));

    return ok(res, { assignment, rows });
  } catch (err) {
    console.error('[assignments/:id/submissions GET]', err);
    return E.serverError(res, 'Could not load submissions.');
  }
});

/* ── Student submits ─────────────────────────────────────────── */

router.post('/:id/submit', authMiddleware, PLAN, MODGATE, async (req, res) => {
  // rbac: student self-scoped — the caller may only submit their own work
  try {
    const { schoolId, role, studentId } = req.jwtUser;
    if (!STUDENT_ROLES.has(role) || !studentId) {
      return E.forbidden(res, 'Only a student may submit an assignment.');
    }
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })));
    }
    if (!parsed.data.textAnswer && !(parsed.data.attachmentIds || []).length) {
      return _bad(res, 'Add an answer or an attachment before submitting.');
    }

    const Assignments = tenantModel('assignments', tenantContext(req));
    const assignment = await Assignments.findOne({ schoolId, id: req.params.id }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found.');
    if (assignment.status !== 'PUBLISHED') return E.forbidden(res, 'This assignment is not open yet.');
    if (assignment.type === 'MATERIAL') return _bad(res, 'Materials do not need a submission.');

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: studentId }).select('id classId streamId').lean();
    if (!student || student.classId !== assignment.classId) {
      return E.forbidden(res, 'This assignment is not for your class.');
    }
    if (assignment.streamId && student.streamId && assignment.streamId !== student.streamId) {
      return E.forbidden(res, 'This assignment is not for your stream.');
    }

    if (assignment.dueDate && !assignment.allowLate) {
      const deadline = new Date(`${assignment.dueDate}T${assignment.dueTime || '23:59'}:00`);
      if (Number.isFinite(deadline.getTime()) && Date.now() > deadline.getTime()) {
        return _bad(res, 'The deadline has passed. Ask your teacher to reopen it.', 403);
      }
    }

    const Submissions = tenantModel('assignment_submissions', tenantContext(req));
    const existing = await Submissions.findOne({ schoolId, assignmentId: assignment.id, studentId, attemptNo: 1 }).lean();
    if (existing && (existing.status === 'GRADED' || existing.status === 'RETURNED')) {
      return _bad(res, 'This work has already been graded. Ask your teacher to reopen it.', 409);
    }

    const now = new Date().toISOString();
    await Submissions.updateOne(
      { schoolId, assignmentId: assignment.id, studentId, attemptNo: 1 },
      {
        $set: {
          status: 'TURNED_IN',
          textAnswer: parsed.data.textAnswer || '',
          attachmentIds: parsed.data.attachmentIds || [],
          submittedAt: existing?.submittedAt || now,
          updatedAt: now,
        },
        $setOnInsert: {
          id: uuidv4(),
          schoolId,
          assignmentId: assignment.id,
          studentId,
          classId: assignment.classId,
          subjectId: assignment.subjectId,
          streamId: student.streamId ?? null,
          attemptNo: 1,
          source: 'native',
          markWriteStatus: 'PENDING',
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const submission = await Submissions.findOne({ schoolId, assignmentId: assignment.id, studentId, attemptNo: 1 }).lean();
    return ok(res, { submission, assignment: { id: assignment.id, title: assignment.title, dueDate: assignment.dueDate, dueTime: assignment.dueTime } });
  } catch (err) {
    console.error('[assignments/:id/submit POST]', err);
    return E.serverError(res, 'Could not submit the assignment.');
  }
});

/* ── Teacher grades ──────────────────────────────────────────── */

router.post('/:id/grade', authMiddleware, PLAN, MODGATE, rbac('elearning', 'update'), async (req, res) => {
  try {
    const parsed = GradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return E.validation(res, parsed.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })));
    }
    const { schoolId, userId } = req.jwtUser;
    const Assignments = tenantModel('assignments', tenantContext(req));
    const assignment = await Assignments.findOne({ schoolId, id: req.params.id }).lean();
    if (!assignment) return E.notFound(res, 'Assignment not found.');
    if (assignment.type === 'MATERIAL') return _bad(res, 'Materials are not graded.');
    if (!(assignment.maxPoints > 0)) return _bad(res, 'Set the assignment points before grading.');

    if (!(await canWriteSubject(req, assignment.classId, assignment.subjectId, assignment.streamId ?? null))) {
      return _bad(res, `You are not assigned to teach: ${assignment.subjectId}`, 403);
    }

    const student = await tenantModel('students', tenantContext(req))
      .findOne({ schoolId, id: parsed.data.studentId }).select('id classId streamId').lean();
    if (!student) return E.notFound(res, 'Student not found.');
    if (student.classId !== assignment.classId) {
      return _bad(res, 'That student is not in this assignment’s class.');
    }
    if (Number(parsed.data.assignedGrade) > Number(assignment.maxPoints)) {
      return _bad(res, `Grade cannot exceed ${assignment.maxPoints} points.`);
    }

    const rawScore = Math.round(Math.min(100, Math.max(0,
      (Number(parsed.data.assignedGrade) / Number(assignment.maxPoints)) * 100,
    )) * 100) / 100;

    let markWriteStatus = 'NOT_LINKED';
    let skipReason = null;

    if (assignment.assessmentScheduleId) {
      const schedule = await tenantModel('assessment_schedule', tenantContext(req))
        .findOne({ schoolId, id: assignment.assessmentScheduleId }).lean();

      if (!schedule) {
        markWriteStatus = 'SKIPPED';
        skipReason = 'no_markbook_target';
      } else {
        if (schedule.academicYearId) {
          const archived = await firstArchivedYear(schoolId, [schedule.academicYearId]);
          if (archived) return _bad(res, 'That academic year is locked — marks cannot be changed.', 403);
        }

        const period = {
          schoolId,
          classId: assignment.classId,
          subjectId: assignment.subjectId,
          termNumber: schedule.termNumber,
          assessmentType: schedule.assessmentType,
          instance: schedule.instance ?? 1,
          academicYearId: schedule.academicYearId ?? null,
        };
        const existingMark = await tenantModel('assessment_marks', tenantContext(req))
          .findOne({ ...period, studentId: student.id }).lean();
        const underReview = !!(await tenantModel('mark_submissions', tenantContext(req))
          .findOne({ ...period, status: { $in: ['submitted', 'approved'] } }).lean());

        const plan = planClassroomMark({
          assignedGrade: parsed.data.assignedGrade,
          maxScore: assignment.maxPoints,
          schedule,
          courseLink: { classId: assignment.classId, subjectId: assignment.subjectId },
          studentRec: student,
          locks: {
            scheduleLocked: !!schedule.isLocked,
            markLocked: !!existingMark?.isLocked,
            underReview,
          },
        });

        if (plan.action === 'upsert') {
          await tenantModel('assessment_marks', tenantContext(req)).updateOne(
            { ...period, studentId: student.id },
            {
              $set: {
                rawScore: plan.rawScore,
                markState: plan.markState,
                classId: assignment.classId,
                streamId: student.streamId ?? null,
                label: assignment.title,
                isPublished: false,
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              },
              $setOnInsert: {
                id: uuidv4(),
                schoolId,
                studentId: student.id,
                createdBy: userId,
                createdAt: new Date().toISOString(),
                academicYearId: period.academicYearId,
                termNumber: period.termNumber,
                assessmentType: period.assessmentType,
                instance: period.instance,
                subjectId: assignment.subjectId,
              },
            },
            { upsert: true },
          );
          markWriteStatus = 'WRITTEN';
        } else {
          markWriteStatus = 'SKIPPED';
          skipReason = plan.reason;
          await _upsertException(req, _exceptionDoc(
            req, assignment, student.id, plan.reason,
            `Grade ${parsed.data.assignedGrade}/${assignment.maxPoints} could not reach the Markbook.`,
          ));
        }
      }
    }

    const now = new Date().toISOString();
    const Submissions = tenantModel('assignment_submissions', tenantContext(req));
    const existing = await Submissions.findOne({ schoolId, assignmentId: assignment.id, studentId: student.id, attemptNo: 1 }).lean();

    await Submissions.updateOne(
      { schoolId, assignmentId: assignment.id, studentId: student.id, attemptNo: 1 },
      {
        $set: {
          status: 'GRADED',
          assignedGrade: parsed.data.assignedGrade,
          rawScore,
          feedback: parsed.data.feedback || '',
          gradedAt: now,
          gradedBy: userId,
          markWriteStatus,
          skipReason,
          updatedAt: now,
        },
        $setOnInsert: {
          id: uuidv4(),
          schoolId,
          assignmentId: assignment.id,
          studentId: student.id,
          classId: assignment.classId,
          subjectId: assignment.subjectId,
          streamId: student.streamId ?? null,
          attemptNo: 1,
          source: 'native',
          submittedAt: existing?.submittedAt || null,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const submission = await Submissions.findOne({ schoolId, assignmentId: assignment.id, studentId: student.id, attemptNo: 1 }).lean();
    return ok(res, {
      submission,
      markWrite: { status: markWriteStatus, reason: skipReason },
    });
  } catch (err) {
    console.error('[assignments/:id/grade POST]', err);
    return E.serverError(res, 'Could not save the grade.');
  }
});

module.exports = router;
