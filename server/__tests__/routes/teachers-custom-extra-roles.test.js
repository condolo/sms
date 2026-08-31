/* ============================================================
   POST /api/teachers, PUT /api/teachers/:id — custom extraRoles
   (Settings -> Staff Roles & Responsibilities)

   extraRoles used to validate against a hardcoded 6-value enum
   (hod/class_teacher/timetabler/exam_officer/deputy/principal) — but
   Settings' own "Staff Roles & Responsibilities" panel lets a school
   define MORE responsibility types (e.g. "KS3 Academic Coordinator")
   and StaffFormModal.jsx renders them as the exact same kind of
   checkbox. Checking one and saving used to fail Zod validation
   outright — rejecting the WHOLE save, not just that field — the
   moment a school actually used the customization feature Settings
   itself offers. Reported directly: a school had added a custom
   responsibility and it silently would not save.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/counters', () => ({ nextStaffId: jest.fn().mockResolvedValue('STF-0001') }));

const SCHOOL_ID = 'sch_demo_001';
let mockJwtUser;
let mockTeachers;
let mockSchoolResponsibilities; // [{value,label}] — what the school has customized

function mockChain(result) {
  const c = { select: () => c, lean: () => Promise.resolve(result) };
  return c;
}
function mockMatches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return String(doc[k]) !== String(v.$ne);
    return String(doc[k]) === String(v);
  });
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return { findOne: () => mockChain({ id: SCHOOL_ID, staffResponsibilities: mockSchoolResponsibilities }) };
    }
    return { findOne: () => mockChain(null) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col !== 'teachers') return { findOne: () => mockChain(null), create: jest.fn() };
    return {
      findOne: (filter) => mockChain(mockTeachers.find(d => mockMatches(d, filter)) ?? null),
      findOneAndUpdate: (filter, update) => {
        const doc = mockTeachers.find(d => mockMatches(d, filter));
        if (!doc) return { lean: () => Promise.resolve(null) };
        Object.assign(doc, update.$set);
        doc._v = (doc._v ?? 0) + 1;
        return { lean: () => Promise.resolve({ ...doc }) };
      },
      create: jest.fn(async (doc) => { const d = { ...doc, toObject: () => d }; mockTeachers.push(d); return d; }),
    };
  }),
}));

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
  mockJwtUser = { userId: 'usr_hr_001', schoolId: SCHOOL_ID, role: 'hr', roles: ['hr'] };
  mockSchoolResponsibilities = [{ value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' }];
  mockTeachers = [
    { id: 'tch_1', _id: 'oid_1', schoolId: SCHOOL_ID, firstName: 'A', lastName: 'B', email: 'a@demo.school', extraRoles: [], _v: 0 },
  ];
});

describe('PUT /api/teachers/:id — custom extraRoles', () => {
  test('a custom responsibility the school has actually defined now saves successfully', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ _v: 0, extraRoles: ['ks3_academic_coordinator'] });

    expect(res.status).toBe(200);
    expect(res.body.data.extraRoles).toEqual(['ks3_academic_coordinator']);
  });

  test('a built-in responsibility still saves without ever consulting the school record', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ _v: 0, extraRoles: ['hod'] });

    expect(res.status).toBe(200);
    expect(res.body.data.extraRoles).toEqual(['hod']);
  });

  test('a value that is neither built-in nor defined by this school is still rejected — not a blanket bypass', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ _v: 0, extraRoles: ['made_up_nonsense'] });

    expect(res.status).toBe(422);
    expect(res.body.error?.issues?.[0]?.message ?? JSON.stringify(res.body)).toMatch(/made_up_nonsense/);
  });

  test('a mix of one valid custom value and one bogus value is still rejected wholesale, naming only the bogus one', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ _v: 0, extraRoles: ['ks3_academic_coordinator', 'not_real'] });

    expect(res.status).toBe(422);
    const msg = res.body.error?.issues?.[0]?.message ?? JSON.stringify(res.body);
    expect(msg).toMatch(/not_real/);
    expect(msg).not.toMatch(/ks3_academic_coordinator/);
  });
});

describe('POST /api/teachers — custom extraRoles', () => {
  test('creating a staff member with a custom responsibility checked succeeds', async () => {
    const res = await supertest(buildApp())
      .post('/api/teachers')
      .send({ firstName: 'New', lastName: 'Staff', email: 'new@demo.school', extraRoles: ['ks3_academic_coordinator'] });

    expect(res.status).toBe(201);
    expect(res.body.data.extraRoles).toEqual(['ks3_academic_coordinator']);
  });
});
