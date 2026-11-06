/* ============================================================
   server/routes/assignments.js — native assignment loop

   The three steps the product promises, tested with no MongoDB:
     1. a teacher assigned to the class+subject issues work;
     2. a student in that class submits it;
     3. the teacher grades it, and the mark reaches assessment_marks
        through the same planner Google Classroom uses.
   Plus the two guards that matter: an unassigned teacher cannot issue,
   and a locked Markbook window skips the write visibly (exception row)
   instead of failing silently.
   ============================================================ */
'use strict';

let mockUser = { userId: 'u_teacher', email: 't@demo.msingi.io', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

jest.mock('../../utils/subject-scope', () => ({
  isManagement: (req) => ['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy', 'hod'].includes(req.jwtUser.role),
  canWriteSubject: async (req, classId, subjectId) =>
    req.jwtUser.role === 'admin' ||
    (req.jwtUser.userId === 'u_teacher' && classId === 'cls_1' && subjectId === 'sub_math'),
  unassignedPairs: async (req, pairs) => {
    if (req.jwtUser.role === 'admin') return [];
    return pairs.filter(p => !(req.jwtUser.userId === 'u_teacher' && p.classId === 'cls_1' && p.subjectId === 'sub_math'));
  },
}));
jest.mock('../../utils/teaching-scope', () => ({
  taughtPairs: async (req) =>
    req.jwtUser.role === 'admin' ? null : [{ classId: 'cls_1', subjectId: 'sub_math', streamId: null }],
}));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: async () => null }));
jest.mock('../../utils/archival', () => ({ firstArchivedYear: async () => null }));

/* ── In-memory tenant collections ────────────────────────────── */

const mockDb = {
  assignments: [],
  assignment_submissions: [],
  assignment_sync_exceptions: [],
  assessment_schedule: [],
  assessment_marks: [],
  mark_submissions: [],
  students: [
    { id: 'std_1', schoolId: 'school_001', classId: 'cls_1', streamId: null, name: 'Amara Osei' },
    { id: 'std_2', schoolId: 'school_001', classId: 'cls_1', streamId: null, name: 'James Mwangi' },
  ],
  streams: [],
  classes: [],
};

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(f => mockMatches(doc, f));
    if (k === '$and') return v.every(f => mockMatches(doc, f));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) return v.$exists ? doc[k] !== undefined : doc[k] === undefined;
      return true;
    }
    if (v == null) return doc[k] == null;
    return doc[k] === v;
  });
}

function mockChain(value) {
  const arr = Array.isArray(value) ? value : null;
  const o = {
    select: () => o,
    sort:   () => o,
    limit:  () => o,
    skip:   () => o,
    lean:   () => Promise.resolve(value),
    then:   (resolve) => Promise.resolve(arr ?? value).then(resolve),
  };
  return o;
}

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    const rows = mockDb[collection] || (mockDb[collection] = []);
    return {
      find:     (filter = {}) => mockChain(rows.filter(r => mockMatches(r, filter))),
      findOne:  (filter = {}) => mockChain(rows.find(r => mockMatches(r, filter)) ?? null),
      create:   (doc) => { rows.push({ ...doc }); return Promise.resolve({ ...doc }); },
      deleteOne: (filter = {}) => {
        const i = rows.findIndex(r => mockMatches(r, filter));
        if (i >= 0) rows.splice(i, 1);
        return Promise.resolve({ deletedCount: i >= 0 ? 1 : 0 });
      },
      deleteMany: (filter = {}) => {
        let n = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (mockMatches(rows[i], filter)) { rows.splice(i, 1); n += 1; }
        }
        return Promise.resolve({ deletedCount: n });
      },
      updateOne: (filter = {}, update = {}, opts = {}) => {
        let doc = rows.find(r => mockMatches(r, filter));
        let upserted = 0;
        if (!doc) {
          if (!opts.upsert) return Promise.resolve({ matchedCount: 0, upsertedCount: 0 });
          const base = {};
          for (const [k, v] of Object.entries(filter)) {
            if (!k.startsWith('$') && (v == null || typeof v !== 'object')) base[k] = v;
          }
          doc = { ...base, ...(update.$setOnInsert || {}) };
          rows.push(doc);
          upserted = 1;
        }
        Object.assign(doc, update.$set || {});
        return Promise.resolve({ matchedCount: doc ? 1 : 0, upsertedCount: upserted });
      },
    };
  },
}));

const express = require('express');
const supertest = require('supertest');
const assignmentsRouter = require('../../routes/assignments');

const app = express();
app.use(express.json());
app.use('/api/assignments', assignmentsRouter);

const TEACHER = { userId: 'u_teacher', email: 't@demo.msingi.io', schoolId: 'school_001', role: 'teacher', roles: ['teacher'] };
const STUDENT = { userId: 'u_student', schoolId: 'school_001', role: 'student', roles: ['student'], studentId: 'std_1' };

beforeEach(() => {
  mockUser = TEACHER;
  for (const key of Object.keys(mockDb)) mockDb[key].length = 0;
  mockDb.students.push(
    { id: 'std_1', schoolId: 'school_001', classId: 'cls_1', streamId: null, name: 'Amara Osei' },
    { id: 'std_2', schoolId: 'school_001', classId: 'cls_1', streamId: null, name: 'James Mwangi' },
  );
});

function seedAssignment(overrides = {}) {
  const doc = {
    id: 'asg_1',
    schoolId: 'school_001',
    classId: 'cls_1',
    subjectId: 'sub_math',
    streamId: null,
    source: 'native',
    type: 'ASSIGNMENT',
    title: 'Fractions worksheet',
    description: 'Share your working.',
    status: 'PUBLISHED',
    maxPoints: 20,
    dueDate: '2030-01-01',
    dueTime: '23:59',
    assessmentScheduleId: null,
    teacherId: 'u_teacher',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  mockDb.assignments.push(doc);
  return doc;
}

describe('POST /api/assignments — a teacher issues work', () => {
  test('the assigned teacher can issue an assignment', async () => {
    const res = await supertest(app).post('/api/assignments').send({
      classId: 'cls_1', subjectId: 'sub_math', title: 'Fractions worksheet', maxPoints: 20,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.assignment).toMatchObject({
      classId: 'cls_1', subjectId: 'sub_math', source: 'native', status: 'PUBLISHED', maxPoints: 20,
    });
    expect(mockDb.assignments).toHaveLength(1);
  });

  test('a teacher not assigned to that subject is rejected', async () => {
    const res = await supertest(app).post('/api/assignments').send({
      classId: 'cls_1', subjectId: 'sub_eng', title: 'Reading log',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not assigned to teach/i);
    expect(mockDb.assignments).toHaveLength(0);
  });
});

describe('POST /api/assignments/:id/submit — a student turns work in', () => {
  test('a student in the class submits successfully', async () => {
    seedAssignment();
    mockUser = STUDENT;
    const res = await supertest(app).post('/api/assignments/asg_1/submit')
      .send({ textAnswer: '1/2 + 1/4 = 3/4' });
    expect(res.status).toBe(200);
    expect(res.body.data.submission).toMatchObject({ status: 'TURNED_IN', studentId: 'std_1' });
    expect(mockDb.assignment_submissions).toHaveLength(1);
  });

  test('a second submit before grading updates the same attempt', async () => {
    seedAssignment();
    mockUser = STUDENT;
    await supertest(app).post('/api/assignments/asg_1/submit').send({ textAnswer: 'first' });
    const res = await supertest(app).post('/api/assignments/asg_1/submit').send({ textAnswer: 'second' });
    expect(res.status).toBe(200);
    expect(mockDb.assignment_submissions).toHaveLength(1);
    expect(mockDb.assignment_submissions[0].textAnswer).toBe('second');
  });

  test('a passed deadline is refused unless the teacher allowed late work', async () => {
    seedAssignment({ dueDate: '2020-01-01', allowLate: false });
    mockUser = STUDENT;
    const res = await supertest(app).post('/api/assignments/asg_1/submit').send({ textAnswer: 'late' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deadline/i);
  });

  test('a student from another class cannot submit', async () => {
    seedAssignment();
    mockUser = { ...STUDENT, studentId: 'std_2' };
    mockDb.students.find(s => s.id === 'std_2').classId = 'cls_9';
    const res = await supertest(app).post('/api/assignments/asg_1/submit').send({ textAnswer: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/assignments/:id/grade — the mark reaches the Markbook', () => {
  test('grading writes assessment_marks through the planner', async () => {
    seedAssignment({ assessmentScheduleId: 'sched_1', maxPoints: 20 });
    mockDb.assessment_schedule.push({
      id: 'sched_1', schoolId: 'school_001', assessmentType: 'HW', termNumber: 3,
      instance: 1, academicYearId: 'ay_1', isLocked: false,
    });

    const res = await supertest(app).post('/api/assignments/asg_1/grade')
      .send({ studentId: 'std_1', assignedGrade: 16, feedback: 'Good working' });

    expect(res.status).toBe(200);
    expect(res.body.data.markWrite).toEqual({ status: 'WRITTEN', reason: null });
    expect(res.body.data.submission).toMatchObject({ status: 'GRADED', assignedGrade: 16, rawScore: 80 });
    expect(mockDb.assessment_marks).toHaveLength(1);
    expect(mockDb.assessment_marks[0]).toMatchObject({
      studentId: 'std_1', classId: 'cls_1', subjectId: 'sub_math',
      termNumber: 3, assessmentType: 'HW', instance: 1, rawScore: 80, isPublished: false,
    });
  });

  test('a locked Markbook window keeps the grade on the submission and records a visible exception', async () => {
    seedAssignment({ assessmentScheduleId: 'sched_1', maxPoints: 20 });
    mockDb.assessment_schedule.push({
      id: 'sched_1', schoolId: 'school_001', assessmentType: 'HW', termNumber: 3,
      instance: 1, academicYearId: 'ay_1', isLocked: true,
    });

    const res = await supertest(app).post('/api/assignments/asg_1/grade')
      .send({ studentId: 'std_1', assignedGrade: 12 });

    expect(res.status).toBe(200);
    expect(res.body.data.markWrite).toEqual({ status: 'SKIPPED', reason: 'schedule_locked' });
    expect(mockDb.assessment_marks).toHaveLength(0);
    expect(mockDb.assignment_sync_exceptions).toHaveLength(1);
    expect(mockDb.assignment_sync_exceptions[0]).toMatchObject({ kind: 'SCHEDULE_LOCKED', studentId: 'std_1' });
    expect(mockDb.assignment_submissions[0]).toMatchObject({ status: 'GRADED', markWriteStatus: 'SKIPPED', skipReason: 'schedule_locked' });
  });

  test('a grade above the assignment points is rejected', async () => {
    seedAssignment({ maxPoints: 20 });
    const res = await supertest(app).post('/api/assignments/asg_1/grade')
      .send({ studentId: 'std_1', assignedGrade: 25 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed/i);
  });
});
