/* ============================================================
   server/routes/teaching-assignments.js — POST / self-heals
   teacher.userId by email before keying the new assignment

   Confirmed live the same day as the fix one layer up (canonicalTeacherId
   preferring teacher.userId over data.teacherId): a teacher's record can
   have userId unset even though an active login with the EXACT matching
   email already exists — teachers.js's own one-time email-match only
   fires at teacher-creation time; a login created afterward via a plain
   invite (no staffId, so no "Create Login Account" backlink) never links
   back. Real example: Priscar Oloo's teacher record had userId: undefined
   despite her login existing with the same email — every assignment
   created for her that day was keyed by her teacher.id and invisible to
   her in the Markbook. This self-heals the link right here, the one
   place that can't wait for her to visit Timetable first (timetable.js's
   own lazy self-heal only fires on GET /my).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_linkheal';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatches(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatches(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.includes(doc[k]);
    if (v && typeof v === 'object' && !Array.isArray(v) && '$ne' in v) return doc[k] !== v.$ne;
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
    updateOne: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatches(d, filter));
      if (doc) Object.assign(doc, update.$set ?? update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    _docs: docs,
  };
}

let mockJwtUser;
const mockHasPermission = jest.fn().mockResolvedValue(true); // admin floor — canManage() passes

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  hasPermission: (...args) => mockHasPermission(...args),
}));
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: jest.fn() }));

const electiveClass = { id: 'cls_1', schoolId: SCHOOL, name: 'Year 10' };
const subject       = { id: 'subj_eng', schoolId: SCHOOL, name: 'English Language', isActive: true };

let mockTeachers, mockUsers, mockClasses, mockSubjects, mockRooms, mockAssignments, mockClassSubjects, mockStreams;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes')             return mockClasses;
    if (collection === 'teachers')             return mockTeachers;
    if (collection === 'users')                return mockUsers;
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
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockClasses       = makeCollection([electiveClass]);
  mockSubjects      = makeCollection([subject]);
  mockRooms         = makeCollection([]);
  mockAssignments   = makeCollection([]);
  mockClassSubjects = makeCollection([{ schoolId: SCHOOL, classId: electiveClass.id, subjectId: subject.id, isCompulsoryForClass: false }]);
  mockStreams       = makeCollection([]);
});

describe('POST /api/teaching-assignments — teacher.userId self-heal', () => {
  test('a teacher with no userId but a matching active login is keyed by the login id, and the link is written back', async () => {
    mockTeachers = makeCollection([
      { id: 'tch_priscar', schoolId: SCHOOL, userId: undefined, email: 'priscar@school.com', firstName: 'Priscar', lastName: 'Oloo' },
    ]);
    mockUsers = makeCollection([
      { id: 'usr_priscar', schoolId: SCHOOL, email: 'priscar@school.com', isActive: true, role: 'teacher' },
    ]);

    const res = await supertest(buildApp())
      .post('/api/teaching-assignments')
      .send({ teacherId: 'tch_priscar', subjectId: subject.id, classId: electiveClass.id });

    expect(res.status).toBe(201);
    expect(res.body.data.teacherId).toBe('usr_priscar');
    // Self-heal: the teacher doc now carries the FK so every future lookup
    // (Attendance/Markbook/Lessons, Timetable) resolves directly.
    expect(mockTeachers.updateOne).toHaveBeenCalledWith(
      { schoolId: SCHOOL, id: 'tch_priscar' },
      { $set: { userId: 'usr_priscar' } },
    );
  });

  test('a teacher with no userId and no matching login falls back to their own id (unchanged behaviour)', async () => {
    mockTeachers = makeCollection([
      { id: 'tch_no_login', schoolId: SCHOOL, userId: undefined, email: 'nologin@school.com', firstName: 'No', lastName: 'Login' },
    ]);
    mockUsers = makeCollection([]); // no matching user at all

    const res = await supertest(buildApp())
      .post('/api/teaching-assignments')
      .send({ teacherId: 'tch_no_login', subjectId: subject.id, classId: electiveClass.id });

    expect(res.status).toBe(201);
    expect(res.body.data.teacherId).toBe('tch_no_login');
  });

  test('an inactive login with the same email is not treated as a match', async () => {
    mockTeachers = makeCollection([
      { id: 'tch_x', schoolId: SCHOOL, userId: undefined, email: 'x@school.com', firstName: 'X', lastName: 'Y' },
    ]);
    mockUsers = makeCollection([
      { id: 'usr_removed', schoolId: SCHOOL, email: 'x@school.com', isActive: false, role: 'teacher' },
    ]);

    const res = await supertest(buildApp())
      .post('/api/teaching-assignments')
      .send({ teacherId: 'tch_x', subjectId: subject.id, classId: electiveClass.id });

    expect(res.status).toBe(201);
    expect(res.body.data.teacherId).toBe('tch_x');
  });

  test('a teacher whose userId is already set is never looked up by email at all', async () => {
    mockTeachers = makeCollection([
      { id: 'tch_linked', schoolId: SCHOOL, userId: 'usr_linked', email: 'linked@school.com', firstName: 'Already', lastName: 'Linked' },
    ]);
    mockUsers = makeCollection([]);

    const res = await supertest(buildApp())
      .post('/api/teaching-assignments')
      .send({ teacherId: 'tch_linked', subjectId: subject.id, classId: electiveClass.id });

    expect(res.status).toBe(201);
    expect(res.body.data.teacherId).toBe('usr_linked');
    expect(mockUsers.findOne).not.toHaveBeenCalled();
  });
});
