/* ============================================================
   PUT /api/students/:id — class/stream reassignment guard

   Reported directly (2026-10-13): a student moved to a different class
   via this form vanished from that class's Markbook/Attendance for any
   non-floor teacher, while still showing up fine on the Classes page —
   streamId silently reset to null on class change, never re-validated.

   Reported again, directly, against LIVE data (2026-10-15): a student
   who was already correctly assigned to a stream was later found with
   streamId:null while STILL in the same class, after an unrelated
   profile edit — a second trigger for the identical symptom, closed by
   the second guard below.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

function mockChain(result) {
  const snapshot = Array.isArray(result) ? [...result] : (result && typeof result === 'object' ? { ...result } : result);
  return { select: () => mockChain(snapshot), lean: () => Promise.resolve(snapshot) };
}

let mockStudentDoc;
let mockStreams;

jest.mock('../../utils/optimistic-lock', () => ({
  applyOptimisticLock: jest.fn(async (_Model, _filter, updateFields) => {
    Object.assign(mockStudentDoc, updateFields);
    return { doc: { ...mockStudentDoc }, conflict: false };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((collection) => {
    if (collection === 'students') {
      return {
        findOne: (filter) => mockChain(
          (mockStudentDoc && (filter.id === mockStudentDoc.id || filter._id === mockStudentDoc._id))
            ? mockStudentDoc
            : null
        ),
      };
    }
    if (collection === 'streams') {
      return { find: (filter) => mockChain(mockStreams.filter(s => s.classId === filter.classId)) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

const express       = require('express');
const supertest      = require('supertest');
const studentsRouter = require('../../routes/students');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}

function makeStudent(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    id:  'stu_001',
    schoolId: SCHOOL,
    firstName: 'Imani', lastName: 'Ngibuini', _v: 1,
    classId: 'cls_old', streamId: 'str_old', streamName: 'Old Stream',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = makeStudent();
  mockStreams = [];
});

describe('PUT /api/students/:id — class changed, new class has streams', () => {
  test('new class has exactly one stream — auto-resolved, not blocked', async () => {
    mockStreams = [{ id: 'str_new', name: 'Diamond', classId: 'cls_new' }];
    const res = await supertest(buildApp()).put('/api/students/stu_001').send({ classId: 'cls_new' });
    expect(res.status).toBe(200);
    expect(mockStudentDoc.streamId).toBe('str_new');
    expect(mockStudentDoc.streamName).toBe('Diamond');
  });

  test('new class has 2+ streams, no streamId supplied — refused', async () => {
    mockStreams = [
      { id: 'str_a', name: 'Diamond', classId: 'cls_new' },
      { id: 'str_b', name: 'Sapphire', classId: 'cls_new' },
    ];
    const res = await supertest(buildApp()).put('/api/students/stu_001').send({ classId: 'cls_new' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/more than one stream/i);
    expect(mockStudentDoc.classId).toBe('cls_old'); // never applied
  });

  test('new class has 2+ streams, a valid streamId for it IS supplied — accepted, streamName normalized server-side', async () => {
    mockStreams = [
      { id: 'str_a', name: 'Diamond', classId: 'cls_new' },
      { id: 'str_b', name: 'Sapphire', classId: 'cls_new' },
    ];
    const res = await supertest(buildApp()).put('/api/students/stu_001')
      .send({ classId: 'cls_new', streamId: 'str_b', streamName: 'Wrong Cached Name' });
    expect(res.status).toBe(200);
    expect(mockStudentDoc.streamId).toBe('str_b');
    expect(mockStudentDoc.streamName).toBe('Sapphire'); // never trusts the client's denormalized name
  });

  test('new class has 2+ streams, a stale streamId from the OLD class is supplied — refused, not silently accepted', async () => {
    mockStreams = [
      { id: 'str_a', name: 'Diamond', classId: 'cls_new' },
      { id: 'str_b', name: 'Sapphire', classId: 'cls_new' },
    ];
    const res = await supertest(buildApp()).put('/api/students/stu_001')
      .send({ classId: 'cls_new', streamId: 'str_old' }); // belongs to the OLD class, not cls_new
    expect(res.status).toBe(400);
  });

  test('new class has no streams at all — streamId/streamName cleared, not carried over from the old class', async () => {
    mockStreams = [];
    const res = await supertest(buildApp()).put('/api/students/stu_001').send({ classId: 'cls_new' });
    expect(res.status).toBe(200);
    expect(mockStudentDoc.streamId).toBeNull();
    expect(mockStudentDoc.streamName).toBeNull();
  });
});

describe('PUT /api/students/:id — same class, stream explicitly cleared (the exact live-data report)', () => {
  test('clearing an existing stream while staying in the same (streamed) class is refused', async () => {
    mockStreams = [
      { id: 'str_old', name: 'Old Stream', classId: 'cls_old' },
      { id: 'str_other', name: 'Other Stream', classId: 'cls_old' },
    ];
    const res = await supertest(buildApp()).put('/api/students/stu_001').send({ streamId: null });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/No stream/i);
    expect(mockStudentDoc.streamId).toBe('str_old'); // never applied
  });

  test('an unrelated field edit that never touches streamId is unaffected', async () => {
    mockStreams = [{ id: 'str_old', name: 'Old Stream', classId: 'cls_old' }];
    const res = await supertest(buildApp()).put('/api/students/stu_001').send({ religion: 'Christian' });
    expect(res.status).toBe(200);
    expect(mockStudentDoc.streamId).toBe('str_old'); // untouched
  });

  test('a student who already had no stream (legacy data) is never blocked by this guard', async () => {
    mockStudentDoc = makeStudent({ streamId: null, streamName: null });
    mockStreams = [{ id: 'str_old', name: 'Old Stream', classId: 'cls_old' }];
    const res = await supertest(buildApp()).put('/api/students/stu_001').send({ religion: 'Christian' });
    expect(res.status).toBe(200);
  });
});
