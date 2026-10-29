/* ============================================================
   server/routes/streams.js — GET / 's studentCount enrichment
   (2026-10-29)

   Reported directly: a stream with zero ACTIVE students — confirmed
   safely deletable by DELETE /streams/:id's own guard — still had its
   Delete button silently disabled client-side (ClassDetail.jsx gates
   on this field), with no error or explanation at all. Root cause:
   this aggregation counted status NOT IN ['withdrawn','graduated'],
   while DELETE /streams/:id's own guard (and this field's own
   "(active only)" comment) always meant status === 'active'. A real
   student status this app actually uses ('inactive', 'transferred' —
   confirmed against live production data) was never excluded by the
   old filter, inflating the count past zero for a stream the server
   would have happily deleted. classes.js's analogous studentCount
   aggregation had the identical bug, fixed alongside this one.

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
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v)  return v.$in.includes(doc[k]);
      if ('$nin' in v) return !v.$nin.includes(doc[k]);
      return true;
    }
    return doc[k] === v;
  });
}
function makeStore(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => {
        if (filter.$or) return filter.$or.some(sub => matchesFilter(d, { ...sub, schoolId: filter.schoolId }));
        return matchesFilter(d, filter);
      });
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    // Real $match + $group('$streamId'/'$classId') support — this is the
    // exact pair of stages both routes' real aggregations use.
    aggregate: jest.fn((pipeline) => {
      const match = Object.assign({}, ...pipeline.filter(s => s.$match).map(s => s.$match));
      const groupStage = pipeline.find(s => s.$group);
      const groupKey = groupStage.$group._id.slice(1); // '$streamId' -> 'streamId'
      const filtered = docs.filter(d => matchesFilter(d, match));
      const byKey = {};
      for (const d of filtered) byKey[d[groupKey]] = (byKey[d[groupKey]] ?? 0) + 1;
      return Promise.resolve(Object.entries(byKey).map(([_id, count]) => ({ _id, count })));
    }),
  };
}

let mockStreams, mockClasses, mockStudents, mockTeachers;
let mockJwtUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    const stores = { streams: mockStreams, classes: mockClasses, students: mockStudents, teachers: mockTeachers };
    return stores[collection] ?? { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  },
}));

const express       = require('express');
const supertest     = require('supertest');
const streamsRouter = require('../../routes/streams');
const classesRouter = require('../../routes/classes');

function buildStreamsApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/streams', streamsRouter);
  return app;
}
function buildClassesApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockTeachers = makeStore([]);

  mockStreams = makeStore([
    { id: 'str_diamond', schoolId: SCHOOL_A, classId: 'cls_y5', name: 'Diamond', status: 'active' },
  ]);
  mockClasses = makeStore([
    { id: 'cls_y5', schoolId: SCHOOL_A, name: 'Year 5', status: 'active' },
  ]);
  // The exact real-world scenario reported: a stream whose only students
  // are 'inactive' and 'transferred' — zero genuinely ACTIVE students.
  mockStudents = makeStore([
    { id: 'stu_1', schoolId: SCHOOL_A, classId: 'cls_y5', streamId: 'str_diamond', status: 'inactive' },
    { id: 'stu_2', schoolId: SCHOOL_A, classId: 'cls_y5', streamId: 'str_diamond', status: 'transferred' },
  ]);
});

describe('GET /api/streams — studentCount counts ACTIVE students only', () => {
  test('a stream whose only students are inactive/transferred reports studentCount: 0, not 2', async () => {
    const res = await supertest(buildStreamsApp()).get('/api/streams').query({ classId: 'cls_y5' });
    expect(res.status).toBe(200);
    const diamond = res.body.data.find(s => s.id === 'str_diamond');
    expect(diamond.studentCount).toBe(0);
  });

  test('an active student in the stream is counted; inactive/transferred siblings are not', async () => {
    mockStudents = makeStore([
      { id: 'stu_1', schoolId: SCHOOL_A, classId: 'cls_y5', streamId: 'str_diamond', status: 'inactive' },
      { id: 'stu_2', schoolId: SCHOOL_A, classId: 'cls_y5', streamId: 'str_diamond', status: 'transferred' },
      { id: 'stu_3', schoolId: SCHOOL_A, classId: 'cls_y5', streamId: 'str_diamond', status: 'active' },
    ]);
    const res = await supertest(buildStreamsApp()).get('/api/streams').query({ classId: 'cls_y5' });
    expect(res.status).toBe(200);
    expect(res.body.data.find(s => s.id === 'str_diamond').studentCount).toBe(1);
  });
});

describe('DELETE /api/streams/:id — the scenario studentCount:0 promises actually succeeds', () => {
  test('a stream with only inactive/transferred students (studentCount: 0 per GET /) is genuinely deletable, not silently blocked', async () => {
    const listRes = await supertest(buildStreamsApp()).get('/api/streams').query({ classId: 'cls_y5' });
    expect(listRes.body.data.find(s => s.id === 'str_diamond').studentCount).toBe(0);

    const delRes = await supertest(buildStreamsApp()).delete('/api/streams/str_diamond');
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);
  });

  test('a stream with a genuinely active student is correctly blocked, with a clear reason', async () => {
    mockStudents = makeStore([
      { id: 'stu_3', schoolId: SCHOOL_A, classId: 'cls_y5', streamId: 'str_diamond', status: 'active' },
    ]);
    const delRes = await supertest(buildStreamsApp()).delete('/api/streams/str_diamond');
    expect(delRes.status).toBe(409);
    expect(delRes.body.error.message).toMatch(/active student/i);
  });
});

describe('GET /api/classes — studentCount counts ACTIVE students only (same bug, same fix)', () => {
  test('a class whose only students are inactive/transferred reports studentCount: 0, not 2', async () => {
    const res = await supertest(buildClassesApp()).get('/api/classes');
    expect(res.status).toBe(200);
    const y5 = res.body.data.find(c => c.id === 'cls_y5');
    expect(y5.studentCount).toBe(0);
  });
});
