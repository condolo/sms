/* ============================================================
   server/routes/teaching-assignments.js POST / — legacy class id

   A class created before the `id` (UUID) field existed only has a
   Mongo `_id`. GET /classes normalises that into `id` for every
   frontend dropdown (see that route's own "Normalize" comment), so
   the class displays and selects fine everywhere — but this route's
   classId lookup used to match only the literal `id` field, so
   creating an assignment against one of these legacy classes always
   failed with a false "Class not found", even though the class is
   right there in the picker. class-subjects.js already handles this
   correctly via its own _classQuery helper; this brings
   teaching-assignments.js's POST route in line with that same
   pattern.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const LEGACY_OID = '507f1f77bcf86cd799439011'; // 24-hex — looks like a Mongo ObjectId

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatchesFilter(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !('$in' in v)) return true;
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:    jest.fn(() => ({ sort: () => ({ lean: () => Promise.resolve([]) }) })),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    create:  jest.fn(async (doc) => ({ ...doc, toObject: () => doc })),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: jest.fn() }));

// The legacy class: only ever had a Mongo _id, never got a real `id`.
const legacyClass = { _id: LEGACY_OID, schoolId: SCHOOL_A, name: 'Year 10' };
const teacherDoc  = { id: 'teacher_1', userId: 'usr_teacher1', schoolId: SCHOOL_A, firstName: 'Agnes', lastName: 'Otieno' };
const subjectDoc  = { id: 'subj_math', schoolId: SCHOOL_A, name: 'Mathematics', isActive: true };

let mockClasses, mockTeachers, mockSubjects, mockRooms, mockAssignments;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes')             return mockClasses;
    if (collection === 'teachers')             return mockTeachers;
    if (collection === 'subjects')             return mockSubjects;
    if (collection === 'rooms')                return mockRooms;
    if (collection === 'teaching_assignments') return mockAssignments;
    throw new Error(`unexpected collection: ${collection}`);
  },
}));

const express = require('express');
const supertest = require('supertest');
const taRouter = require('../../routes/teaching-assignments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teaching-assignments', taRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockClasses     = mockMakeFakeCollection([legacyClass]);
  mockTeachers    = mockMakeFakeCollection([teacherDoc]);
  mockSubjects    = mockMakeFakeCollection([subjectDoc]);
  mockRooms       = mockMakeFakeCollection([]);
  mockAssignments = mockMakeFakeCollection([]);
});

describe('POST /api/teaching-assignments — legacy (Mongo _id) class id', () => {
  test('creating an assignment against a class that only has _id (no real id) succeeds, not "Class not found"', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: subjectDoc.id, classId: LEGACY_OID });

    expect(res.status).toBe(201);
    expect(res.body?.data?.classId).toBe(LEGACY_OID);
    expect(res.body?.data?.className).toBe('Year 10');
  });

  test('a classId that genuinely matches nothing still 404s as "Class not found"', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: subjectDoc.id, classId: '000000000000000000000000' });

    expect(res.status).toBe(404);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/class not found/i);
  });

  test('a normal UUID-form classId still resolves via the plain id match (no regression)', async () => {
    mockClasses = mockMakeFakeCollection([{ id: 'cls_uuid_1', schoolId: SCHOOL_A, name: 'Grade 6' }]);
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: subjectDoc.id, classId: 'cls_uuid_1' });

    expect(res.status).toBe(201);
    expect(res.body?.data?.className).toBe('Grade 6');
  });
});
