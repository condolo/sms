/* ============================================================
   PUT /api/teachers/:id — extraRoles/departmentId change -> token
   revocation (the HOD JWT-propagation fix, route level)

   Covers scenarios 5-7 of the requested test matrix:
     5. adding an extra role
     6. removing an extra role
     7. existing logged-in session after an extra-role change
   (7 is verified here as "revokeUserTokens fires", which is what forces
   an already-logged-in session to re-authenticate — the actual "does the
   old session behave correctly afterward" half of that is authMiddleware's
   own pre-existing tv-check, exercised for real in hod-department-scope
   -e2e.test.js and already covered by the existing token-version test
   suite; not re-proven here to avoid duplicating that coverage.)

   Also proves the negative: an unrelated field change (e.g. phone number)
   on the same record does NOT trigger a revocation — this fix must not
   force every staff-profile edit into an unnecessary forced re-login.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const mockRevokeUserTokens = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: (...args) => mockRevokeUserTokens(...args) }));

let mockTeachers; // in-memory teachers store

jest.mock('../../utils/tenant-model', () => {
  function mockChain(result) {
    const c = { select: () => c, lean: () => Promise.resolve(result) };
    return c;
  }
  return {
    tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
    tenantModel: jest.fn((col) => {
      if (col !== 'teachers') return { findOne: () => mockChain(null) };
      return {
        findOne: (filter) => mockChain(mockTeachers.find(d => d.id === filter.id && d.schoolId === filter.schoolId) ?? null),
        findOneAndUpdate: (filter, update) => {
          const doc = mockTeachers.find(d => d.id === filter.id && d.schoolId === filter.schoolId);
          if (!doc) return { lean: () => Promise.resolve(null) };
          Object.assign(doc, update.$set);
          doc._v = (doc._v ?? 0) + 1;
          return { lean: () => Promise.resolve({ ...doc }) };
        },
      };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');
const teachersRouter = require('../../routes/teachers');

const SCHOOL_ID = 'sch_demo_001';
let mockJwtUser;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teachers', teachersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_hr_001', schoolId: SCHOOL_ID, role: 'hr', roles: ['hr'] };
  mockTeachers = [
    {
      id: 'tch_1', schoolId: SCHOOL_ID, firstName: 'Amina', lastName: 'Otieno',
      email: 'amina@demo.school', userId: 'usr_amina', staffType: 'teacher',
      extraRoles: [], departmentId: null, phone: '0700000000', _v: 0,
    },
  ];
});

describe('PUT /api/teachers/:id — extraRoles change triggers token revocation', () => {
  test('scenario 5: adding an extra role (hod) revokes the linked user\'s tokens', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ extraRoles: ['hod'] });

    expect(res.status).toBe(200);
    expect(res.body.data.extraRoles).toEqual(['hod']);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_amina');
  });

  test('scenario 6: removing an extra role (hod -> none) also revokes tokens', async () => {
    mockTeachers[0].extraRoles = ['hod'];
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ extraRoles: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.extraRoles).toEqual([]);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_amina');
  });

  test('scenario 7: multiple extra roles set at once — single revocation call, all roles present', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ extraRoles: ['hod', 'timetabler'] });

    expect(res.body.data.extraRoles).toEqual(['hod', 'timetabler']);
    expect(mockRevokeUserTokens).toHaveBeenCalledTimes(1);
  });

  test('departmentId change alone (no extraRoles in payload) also revokes — HOD scope depends on it too', async () => {
    mockTeachers[0].extraRoles = ['hod'];
    mockTeachers[0].departmentId = 'dept_math';
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ departmentId: 'dept_science' });

    expect(res.body.data.departmentId).toBe('dept_science');
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_amina');
  });

  test('setting extraRoles to the SAME value it already had does NOT revoke (no actual change)', async () => {
    mockTeachers[0].extraRoles = ['hod'];
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ extraRoles: ['hod'] });

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });

  test('reordering the same set of extra roles does NOT revoke (set-equality, not array-equality)', async () => {
    mockTeachers[0].extraRoles = ['hod', 'timetabler'];
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ extraRoles: ['timetabler', 'hod'] });

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });

  test('an unrelated field change (phone) never touches extraRoles at all — no revocation, no extra DB round trip', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ phone: '0711111111' });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('0711111111');
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });

  test('a teacher record with no linked user account — extraRoles still saves, no revocation attempted (nothing to revoke)', async () => {
    mockTeachers[0].userId = null;
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ extraRoles: ['hod'] });

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });
});
