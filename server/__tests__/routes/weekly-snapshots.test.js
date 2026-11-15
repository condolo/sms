/* ============================================================
   GET /api/weekly-snapshots/* — staff-facing roster/detail/PDF routes.

   Covers: teacher-scoped vs. broad class list on /my-classes, ownership
   403 for a parent/student role reaching another child's snapshot
   (defense-in-depth — this route file is normally only reached by
   staff, since parent/student self-service goes through
   parent-portal.js/student-portal.js instead, per the confirmed
   architecture), medical-section redaction by module state + permission,
   and the PDF route actually producing a PDF response touching only the
   collections it should.

   All DB calls are mocked — no MongoDB required. pdfkit itself is the
   REAL installed dependency (not mocked) so the PDF route is verified
   end-to-end, matching how hr.js's payroll PDF route behaves in
   production.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
}
function mockMakeCollection(docs = []) {
  return {
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) ?? null)),
    deleteMany: jest.fn((filter) => {
      const before = docs.length;
      const keep = docs.filter(d => !mockMatchesFilter(d, filter));
      docs.length = 0;
      docs.push(...keep);
      return Promise.resolve({ deletedCount: before - keep.length });
    }),
    create: jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
  };
}

function mockStudentOwn()   { return { id: 'stu_own',   schoolId: SCHOOL_A, firstName: 'Own',   lastName: 'Kid', classId: 'cls_1', className: '5A' }; }
function mockStudentOther() { return { id: 'stu_other', schoolId: SCHOOL_A, firstName: 'Other', lastName: 'Kid', classId: 'cls_2', className: '5B' }; }

const mockSnapshot = {
  id: 'snap_1', schoolId: SCHOOL_A, studentId: 'stu_own',
  classId: 'cls_1', className: '5A', weekStart: '2026-08-03', weekEnd: '2026-08-09',
  generatedAt: '2026-08-08T10:05:00.000Z', schoolTimezone: 'Africa/Nairobi',
  sections: {
    topics: [], assignments: [],
    attendance: { present: 4, absent: 1, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0, total: 5, records: [] },
    behaviour: [], medical: [{ date: '2026-08-04', complaint: 'Headache', sentHome: false, referred: false }],
    library: [], growth: [],
  },
  notified: { emailSentAt: null, inAppSentAt: null, emailError: null },
};

let mockJwtUser;
let mockMedicalModuleEnabled;
let mockCanReadMedical;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasPermission: (...args) => mockHasPermission(...args),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({
  moduleGate: () => (_req, _res, next) => next(),
  isModuleEnabled: (...args) => mockIsModuleEnabled(...args),
}));

const mockHasPermission    = jest.fn((...args) => Promise.resolve(mockCanReadMedical));
const mockIsModuleEnabled  = jest.fn((...args) => Promise.resolve(mockMedicalModuleEnabled));

let mockCollections;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => mockCollections[c] ?? mockMakeCollection([])),
}));

const express   = require('express');
const supertest = require('supertest');
const weeklySnapshotsRouter = require('../../routes/weekly-snapshots');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/weekly-snapshots', weeklySnapshotsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMedicalModuleEnabled = true;
  mockCanReadMedical = true;
  mockCollections = {
    students: mockMakeCollection([mockStudentOwn(), mockStudentOther()]),
    classes: mockMakeCollection([
      { id: 'cls_1', schoolId: SCHOOL_A, name: '5A', status: 'active' },
      { id: 'cls_2', schoolId: SCHOOL_A, name: '5B', status: 'active' },
    ]),
    // Form/assistant teacher lives on the stream (resolveHomeroomStreamIds),
    // resolved via the teacher's real id, not the userId directly —
    // classes.formTeacherId above is deliberately absent now: it's a
    // legacy, never-written field in production (2026-10-29 fix).
    teachers: mockMakeCollection([
      { id: 'tch_1', schoolId: SCHOOL_A, userId: 'usr_teacher_1' },
      { id: 'tch_2', schoolId: SCHOOL_A, userId: 'usr_teacher_2' },
    ]),
    streams: mockMakeCollection([
      { id: 'str_1', schoolId: SCHOOL_A, classId: 'cls_1', formTeacherId: 'tch_1' },
      { id: 'str_2', schoolId: SCHOOL_A, classId: 'cls_2', formTeacherId: 'tch_2' },
    ]),
    weekly_snapshots: mockMakeCollection([mockSnapshot]),
  };
});

describe('GET /my-classes', () => {
  test('a plain teacher only sees their own class (via formTeacherId)', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/my-classes');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('cls_1');
  });

  test('a principal sees every active class, not just one', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'principal' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/my-classes');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('a teacher who is ALSO a section_head is treated as broad staff, not narrowed', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher', extraRoles: ['section_head'] };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/my-classes');
    expect(res.body.data).toHaveLength(2);
  });
});

describe('ownership scoping (defense-in-depth for a self-service role reaching this staff route)', () => {
  test('a student viewing their own weeks list succeeds', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/weeks');
    expect(res.status).toBe(200);
  });

  test('a student viewing another student\'s weeks list is forbidden', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_other/weeks');
    expect(res.status).toBe(403);
  });

  test('a parent viewing their own child\'s snapshot detail succeeds', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-08-03');
    expect(res.status).toBe(200);
  });

  test('a teacher (staff) is unrestricted by ownership', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-08-03');
    expect(res.status).toBe(200);
  });

  test('a missing week returns 404, not the whole roster', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-01-05');
    expect(res.status).toBe(404);
  });
});

describe('medical section redaction', () => {
  test('medical is included when the module is on and the caller can read it', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    mockMedicalModuleEnabled = true;
    mockCanReadMedical = true;
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-08-03');
    expect(res.body.data.snapshot.sections.medical).toHaveLength(1);
  });

  test('medical is stripped when the school has the medical module disabled', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    mockMedicalModuleEnabled = false;
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-08-03');
    expect(res.body.data.snapshot.sections.medical).toEqual([]);
  });

  test('medical is stripped when the caller lacks medical:read, even with the module on', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    mockMedicalModuleEnabled = true;
    mockCanReadMedical = false;
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-08-03');
    expect(res.body.data.snapshot.sections.medical).toEqual([]);
  });
});

describe('GET /:studentId/:weekStart/pdf', () => {
  test('returns a real application/pdf response, touching only students/classes(none)/weekly_snapshots', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2026-08-03/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0); // a real, non-empty PDF buffer
    expect(mockCollections.classes.find).not.toHaveBeenCalled();
    expect(mockCollections.classes.findOne).not.toHaveBeenCalled();
  });

  test('a missing week 404s before ever touching pdfkit', async () => {
    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/weekly-snapshots/stu_own/2099-01-01/pdf');
    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /regenerate — rebuild one frozen week after a data correction.

   The cron only fills missing students, so a snapshot generated from a
   wrong/missing lesson-coverage row could never pick up the correction.
   This is the one write on the surface: it replaces exactly the rows it
   rebuilds and sends no notifications.
   ══════════════════════════════════════════════════════════════ */
describe('POST /regenerate', () => {
  const WEEK = '2026-11-09';

  test('rebuilds the week: first run replaces nothing, the second replaces the first run', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin' };
    mockCollections.schools = mockMakeCollection([{ id: SCHOOL_A, timezone: 'Africa/Nairobi' }]);
    mockCollections.students = mockMakeCollection([
      { id: 'stu_own', schoolId: SCHOOL_A, firstName: 'Own', lastName: 'Kid', classId: 'cls_1', className: '5A', status: 'active' },
    ]);

    const first = await supertest(buildApp())
      .post('/api/weekly-snapshots/regenerate')
      .send({ weekStart: WEEK });
    expect(first.status).toBe(200);
    expect(first.body.data.weekStart).toBe(WEEK);
    expect(first.body.data.generated).toBe(1);
    expect(first.body.data.replaced).toBe(0);
    expect(mockCollections.weekly_snapshots.create).toHaveBeenCalledTimes(1);
    expect(mockCollections.weekly_snapshots.create.mock.calls[0][0].sections.topics).toEqual([]);

    const second = await supertest(buildApp())
      .post('/api/weekly-snapshots/regenerate')
      .send({ weekStart: WEEK });
    expect(second.status).toBe(200);
    expect(second.body.data.generated).toBe(1);
    expect(second.body.data.replaced).toBe(1);
  });

  test('a malformed weekStart is a 422, not a silent wrong week', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin' };
    const res = await supertest(buildApp())
      .post('/api/weekly-snapshots/regenerate')
      .send({ weekStart: '09-11-2026' });
    expect(res.status).toBe(422);
  });
});
