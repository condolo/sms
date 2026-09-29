/* ============================================================
   GET /api/teachers?teachingOnly=true — exclude non-teaching staff
   from the Teachers module's own list

   Root cause: the `teachers` collection is the general staff directory
   (HR's "Add Staff" writes here too, with staffType covering admin/hr/
   finance/admissions_officer/etc., not just 'teacher') — but the
   Teachers MODULE page is specifically for teaching staff. Real report:
   two accounts with no teaching staffType, no subjects, and no teaching
   assignments were showing up in the Teachers list purely because they
   exist in this shared collection.

   Filtering on staffType==='teacher' alone would be wrong: most real
   schools never bother setting staffType at all for their (majority)
   teaching headcount, so that would hide genuinely-teaching records.
   The inclusion rule instead requires ANY positive teaching signal:
   staffType==='teacher', a non-empty subjects list, or at least one
   teaching_assignments record. HR's own Staff tab (HRPage.jsx) never
   sends ?teachingOnly=true, so it is completely unaffected and keeps
   showing every staff type.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL = 'school_test_teaching_only';

function mockChain(resultPromiseOrValue) {
  const c = {
    sort:   () => c,
    skip:   () => c,
    limit:  () => c,
    select: () => c,
    lean:   () => Promise.resolve(resultPromiseOrValue),
  };
  return c;
}

function mockFieldMatches(docVal, v) {
  // v is a plain operator object, e.g. { $exists: true, $ne: [] } — every
  // operator present must independently hold (real Mongo semantics).
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v).every(([op, opVal]) => {
      if (op === '$in') return opVal.includes(docVal);
      if (op === '$exists') return (docVal !== undefined) === opVal;
      if (op === '$ne') {
        if (Array.isArray(docVal) && Array.isArray(opVal)) return JSON.stringify(docVal) !== JSON.stringify(opVal);
        return docVal !== opVal;
      }
      return true; // unhandled operator: don't filter on it
    });
  }
  return docVal === v;
}
function mockMatches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$and') return v.every(sub => mockMatches(doc, sub));
    if (k === '$or')  return v.some(sub => mockMatches(doc, sub));
    return mockFieldMatches(doc[k], v);
  });
}

let mockTeachers, mockAssignments, mockSubjects;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'teachers') {
      return {
        find:           (filter) => mockChain(mockTeachers.filter(d => mockMatches(d, filter))),
        countDocuments: (filter) => Promise.resolve(mockTeachers.filter(d => mockMatches(d, filter)).length),
      };
    }
    if (collection === 'teaching_assignments') {
      return { distinct: (field, filter) => Promise.resolve([...new Set(mockAssignments.filter(d => mockMatches(d, filter)).map(d => d[field]))]) };
    }
    if (collection === 'subjects') {
      return { find: (filter) => mockChain(mockSubjects.filter(d => mockMatches(d, filter))) };
    }
    throw new Error(`unexpected collection: ${collection}`);
  },
}));

let mockJwtUser;
const express   = require('express');
const supertest = require('supertest');
const teachersRouter = require('../../routes/teachers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teachers', teachersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admissions', schoolId: SCHOOL, role: 'admissions_officer', roles: [], isActive: true };
  mockSubjects = [];
  mockAssignments = [];
  mockTeachers = [
    { id: 't_explicit_teacher', schoolId: SCHOOL, firstName: 'Gideon', lastName: 'Nadolo', staffType: 'teacher', subjects: [], status: 'active' },
    { id: 't_unset_but_teaching', schoolId: SCHOOL, firstName: 'Hezron', lastName: 'Khatima', staffType: undefined, subjects: ['subj_1', 'subj_2'], status: 'active' },
    { id: 't_admissions', schoolId: SCHOOL, firstName: 'Ann', lastName: 'Wanjiku', staffType: 'admissions_officer', subjects: [], status: 'active' },
    { id: 't_no_signal_1', schoolId: SCHOOL, firstName: 'Ann', lastName: 'Thuita', staffType: undefined, subjects: undefined, status: 'active' },
    { id: 't_no_signal_2', schoolId: SCHOOL, firstName: 'Natali', lastName: 'Otieno', staffType: undefined, subjects: undefined, status: 'active' },
    { id: 't_via_assignment', userId: 'usr_via_assignment', schoolId: SCHOOL, firstName: 'Priscar', lastName: 'Oloo', staffType: undefined, subjects: [], status: 'active' },
  ];
});

describe('GET /api/teachers?teachingOnly=true', () => {
  test('without the param, every staff record shows regardless of staffType (HR\'s own Staff tab behavior, unaffected)', async () => {
    const res = await supertest(buildApp()).get('/api/teachers');
    expect(res.status).toBe(200);
    expect(res.body.data.map(d => d.id).sort()).toEqual(
      mockTeachers.map(t => t.id).sort()
    );
  });

  test('with the param, an explicit non-teaching staffType is excluded', async () => {
    const res = await supertest(buildApp()).get('/api/teachers').query({ teachingOnly: 'true' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map(d => d.id);
    expect(ids).not.toContain('t_admissions');
  });

  test('with the param, accounts with zero teaching signal (no staffType, no subjects, no assignment) are excluded — the exact reported bug', async () => {
    const res = await supertest(buildApp()).get('/api/teachers').query({ teachingOnly: 'true' });
    const ids = res.body.data.map(d => d.id);
    expect(ids).not.toContain('t_no_signal_1');
    expect(ids).not.toContain('t_no_signal_2');
  });

  test('with the param, staffType===teacher is included', async () => {
    const res = await supertest(buildApp()).get('/api/teachers').query({ teachingOnly: 'true' });
    expect(res.body.data.map(d => d.id)).toContain('t_explicit_teacher');
  });

  test('with the param, a record with subjects but no staffType is still included — must not require staffType to be set', async () => {
    const res = await supertest(buildApp()).get('/api/teachers').query({ teachingOnly: 'true' });
    expect(res.body.data.map(d => d.id)).toContain('t_unset_but_teaching');
  });

  test('with the param, a record with no staffType/subjects but a real teaching_assignments row is still included', async () => {
    mockAssignments = [{ schoolId: SCHOOL, teacherId: 'usr_via_assignment', classId: 'cls_1', subjectId: 'subj_1' }];
    const res = await supertest(buildApp()).get('/api/teachers').query({ teachingOnly: 'true' });
    expect(res.body.data.map(d => d.id)).toContain('t_via_assignment');
  });
});
