/* ============================================================
   server/routes/teaching-assignments.js — canManage()'s new
   Settings-permission path

   Root cause: canManage() (create/update/delete a teaching assignment
   — which teacher delivers which subject to which class, feeding
   Timetable) was closed to Settings entirely: only a hardcoded
   FULL_MANAGE role set (admin/superadmin/deputy/principal/
   acting_deputy/head_of_school) or a department-scoped HOD could pass,
   no matter what a school granted any other role in Settings → Roles
   & Permissions. Direct user request, following the identical
   v5.158.0 fix for the Teacher Edit button (which already unlocks this
   same Assignments tab client-side via can('teachers','update')):
   canManage() now ALSO allows anyone holding the real, Settings-granted
   'teachers' update permission — additive to the existing floor, never
   a replacement.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL = 'school_test_perm';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatches(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatches(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.includes(doc[k]);
    if (v && typeof v === 'object' && !Array.isArray(v)) return true;
    return doc[k] === v;
  });
}
function makeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:    jest.fn((filter) => ({ lean: () => Promise.resolve(docs.filter(d => mockMatches(d, filter))) })),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatches(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatches(d, filter)).length)),
    create:  jest.fn(async (doc) => { docs.push(doc); return { ...doc, toObject: () => doc }; }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatches(d, filter));
      if (!doc) return mockChainObj(null);
      Object.assign(doc, update);
      return mockChainObj(doc);
    }),
    deleteOne: jest.fn(async (filter) => {
      const idx = docs.findIndex(d => mockMatches(d, filter));
      if (idx !== -1) docs.splice(idx, 1);
    }),
    _docs: docs,
  };
}

let mockJwtUser;
const mockHasPermission = jest.fn().mockResolvedValue(false);

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  hasPermission: (...args) => mockHasPermission(...args),
}));
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: jest.fn() }));

const teacherDoc  = { id: 'teacher_1', userId: 'usr_teacher1', schoolId: SCHOOL, firstName: 'Agnes', lastName: 'Otieno' };
const electiveClass = { id: 'cls_1', schoolId: SCHOOL, name: 'Grade 6' };
const subject     = { id: 'subj_art', schoolId: SCHOOL, name: 'Art', isActive: true };

let mockClasses, mockTeachers, mockSubjects, mockRooms, mockAssignments, mockClassSubjects, mockStreams;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes')             return mockClasses;
    if (collection === 'teachers')             return mockTeachers;
    if (collection === 'subjects')             return mockSubjects;
    if (collection === 'rooms')                return mockRooms;
    if (collection === 'teaching_assignments') return mockAssignments;
    if (collection === 'class_subjects')       return mockClassSubjects;
    if (collection === 'streams')              return mockStreams;
    throw new Error(`unexpected collection: ${collection}`);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const taRouter  = require('../../routes/teaching-assignments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teaching-assignments', taRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasPermission.mockResolvedValue(false);
  // Admissions Officer — not in FULL_MANAGE, not HOD. The exact scenario
  // raised directly: granted full 'teachers' edit rights in Settings,
  // expected to be able to assign classes/subjects to a teacher.
  mockJwtUser = { userId: 'usr_admissions', schoolId: SCHOOL, role: 'admissions_officer', roles: [] };
  mockClasses       = makeCollection([electiveClass]);
  mockTeachers      = makeCollection([teacherDoc]);
  mockSubjects      = makeCollection([subject]);
  mockRooms         = makeCollection([]);
  mockAssignments   = makeCollection([]);
  mockClassSubjects = makeCollection([
    { schoolId: SCHOOL, classId: electiveClass.id, subjectId: subject.id, isCompulsoryForClass: false },
  ]);
  mockStreams = makeCollection([]);
});

const VALID_BODY = { teacherId: 'usr_teacher1', subjectId: 'subj_art', classId: 'cls_1' };

describe('POST /api/teaching-assignments — canManage() Settings-permission path', () => {
  test('a non-FULL_MANAGE, non-HOD role without the teachers:update grant is forbidden', async () => {
    mockHasPermission.mockResolvedValue(false);
    const res = await supertest(buildApp()).post('/api/teaching-assignments').send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), 'teachers', 'update');
  });

  test('the same role succeeds once granted the real teachers:update permission (the fix)', async () => {
    mockHasPermission.mockImplementation((_req, mod, action) => Promise.resolve(mod === 'teachers' && action === 'update'));
    const res = await supertest(buildApp()).post('/api/teaching-assignments').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.teacherId).toBe('usr_teacher1');
  });

  test('FULL_MANAGE roles are unaffected — hasPermission is never even called', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
    const res = await supertest(buildApp()).post('/api/teaching-assignments').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(mockHasPermission).not.toHaveBeenCalled();
  });
});

describe('PUT/DELETE /api/teaching-assignments/:id — same permission path', () => {
  async function seedAssignment() {
    mockAssignments = makeCollection([
      { id: 'ta_1', schoolId: SCHOOL, teacherId: 'usr_teacher1', subjectId: 'subj_art', classId: 'cls_1', departmentId: null },
    ]);
  }

  test('PUT is forbidden without the grant, allowed with it', async () => {
    await seedAssignment();
    mockHasPermission.mockResolvedValue(false);
    let res = await supertest(buildApp()).put('/api/teaching-assignments/ta_1').send({ periodsPerWeek: 4 });
    expect(res.status).toBe(403);

    mockHasPermission.mockResolvedValue(true);
    res = await supertest(buildApp()).put('/api/teaching-assignments/ta_1').send({ periodsPerWeek: 4 });
    expect(res.status).toBe(200);
  });

  test('DELETE is forbidden without the grant, allowed with it', async () => {
    await seedAssignment();
    mockHasPermission.mockResolvedValue(false);
    let res = await supertest(buildApp()).delete('/api/teaching-assignments/ta_1');
    expect(res.status).toBe(403);

    mockHasPermission.mockResolvedValue(true);
    res = await supertest(buildApp()).delete('/api/teaching-assignments/ta_1');
    expect(res.status).toBe(200);
  });
});
