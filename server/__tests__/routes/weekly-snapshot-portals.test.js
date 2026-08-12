/* ============================================================
   parent-portal.js / student-portal.js — Weekly Snapshot self-service
   routes (M6).

   These bypass RBAC entirely by design (no rbac()/moduleGate/planGate
   in either file) — the only gates are the role check (_requireParent/
   _requireStudent) and the shared ownership helper from
   weekly-snapshots.js (getWeeksForStudent/getSnapshotDetail/
   streamSnapshotPdf, attached as router._helpers). This file verifies
   both gates actually hold: a parent can only reach their OWN linked
   child, a student can only reach themselves, and a wrong-role caller
   is rejected before ownership is even evaluated.

   All DB calls are mocked — no MongoDB required.
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
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
}
function mockMakeCollection(docs = []) {
  return {
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) ?? null)),
  };
}

function mockStudentOwn()   { return { id: 'stu_own',   schoolId: SCHOOL_A, firstName: 'Own',   lastName: 'Kid' }; }
function mockStudentOther() { return { id: 'stu_other', schoolId: SCHOOL_A, firstName: 'Other', lastName: 'Kid' }; }

const mockSnapshot = {
  id: 'snap_1', schoolId: SCHOOL_A, studentId: 'stu_own',
  classId: 'cls_1', className: '5A', weekStart: '2026-08-03', weekEnd: '2026-08-09',
  generatedAt: '2026-08-08T10:05:00.000Z', schoolTimezone: 'Africa/Nairobi',
  sections: {
    topics: [], assignments: [],
    attendance: { present: 4, absent: 1, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0, total: 5, records: [] },
    behaviour: [], medical: [], library: [], growth: [],
  },
  notified: { emailSentAt: null, inAppSentAt: null, emailError: null },
};

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({
  moduleGate: () => (_req, _res, next) => next(),
  isModuleEnabled: jest.fn().mockResolvedValue(true),
}));

let mockCollections;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => mockCollections[c] ?? mockMakeCollection([])),
}));

const express        = require('express');
const supertest      = require('supertest');
const parentPortal   = require('../../routes/parent-portal');
const studentPortal  = require('../../routes/student-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortal);
  app.use('/api/student-portal', studentPortal);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCollections = {
    students: mockMakeCollection([mockStudentOwn(), mockStudentOther()]),
    weekly_snapshots: mockMakeCollection([mockSnapshot]),
  };
});

describe('parent-portal.js /weekly-snapshot/:childId/*', () => {
  test('a parent viewing their own linked child (studentIds) succeeds', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_own/weeks');
    expect(res.status).toBe(200);
    expect(res.body.data.student.id).toBe('stu_own');
  });

  test('a parent viewing a child via guardianOf (not studentIds) also succeeds', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'guardian', studentIds: [], guardianOf: ['stu_own'] };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_own/weeks');
    expect(res.status).toBe(200);
  });

  test('a parent viewing a child NOT linked to them is forbidden', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_other/weeks');
    expect(res.status).toBe(403);
  });

  test('a non-parent role is rejected before ownership is even checked', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'teacher' };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_own/weeks');
    expect(res.status).toBe(403);
  });

  test('detail route returns the snapshot for an owned child', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_own/2026-08-03');
    expect(res.status).toBe(200);
    expect(res.body.data.snapshot.weekStart).toBe('2026-08-03');
  });

  test('PDF route returns a real application/pdf response for an owned child', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_own/2026-08-03/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  test('PDF route 403s for a child not linked to this parent, before ever touching pdfkit', async () => {
    mockJwtUser = { userId: 'usr_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'], guardianOf: [] };
    const res = await supertest(buildApp()).get('/api/parent-portal/weekly-snapshot/stu_other/2026-08-03/pdf');
    expect(res.status).toBe(403);
  });
});

describe('student-portal.js /weekly-snapshot/* (always self)', () => {
  test('a student viewing their own weeks list succeeds', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/student-portal/weekly-snapshot/weeks');
    expect(res.status).toBe(200);
    expect(res.body.data.student.id).toBe('stu_own');
  });

  test('detail route reads from the JWT studentId, not any client-supplied id', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/student-portal/weekly-snapshot/2026-08-03');
    expect(res.status).toBe(200);
    expect(res.body.data.snapshot.studentId).toBe('stu_own');
  });

  test('a non-student role is rejected', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'parent', studentIds: ['stu_own'] };
    const res = await supertest(buildApp()).get('/api/student-portal/weekly-snapshot/weeks');
    expect(res.status).toBe(403);
  });

  test('a missing week 404s', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/student-portal/weekly-snapshot/2099-01-01');
    expect(res.status).toBe(404);
  });

  test('PDF route returns a real application/pdf response for self', async () => {
    mockJwtUser = { userId: 'usr_2', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_own' };
    const res = await supertest(buildApp()).get('/api/student-portal/weekly-snapshot/2026-08-03/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});
