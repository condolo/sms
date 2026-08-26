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
  // Supports the filter shapes PUT /:id actually issues: {id, schoolId},
  // {_id, schoolId} (the dual-id-safe fallback + every downstream op now
  // that they target _id, which — unlike `id` — always exists), and the
  // email-conflict exclusion {schoolId, email, _id: {$ne: ...}}.
  function mockMatches(doc, filter) {
    // String-compare, not strict ===: the real code wraps _id lookups in
    // `new mongoose.Types.ObjectId(...)`, an object, while this mock
    // stores _id as a plain string — real Mongoose does ObjectId-value
    // equality regardless of representation, so the mock must too.
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$ne' in v) return String(doc[k]) !== String(v.$ne);
      return String(doc[k]) === String(v);
    });
  }
  return {
    tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
    tenantModel: jest.fn((col) => {
      if (col !== 'teachers') return { findOne: () => mockChain(null) };
      return {
        findOne: (filter) => mockChain(mockTeachers.find(d => mockMatches(d, filter)) ?? null),
        findOneAndUpdate: (filter, update) => {
          const doc = mockTeachers.find(d => mockMatches(d, filter));
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
      id: 'tch_1', _id: 'mongo_id_tch_1', schoolId: SCHOOL_ID, firstName: 'Amina', lastName: 'Otieno',
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

describe('PUT /api/teachers/:id — dual-id-safe email-conflict check (live bug: false self-collision)', () => {
  // Confirmed live: editing "Ms. Ann Wanjiku" — a staff record with no
  // UUID `id` field, findable only by Mongo _id — got "Email ... already
  // used by another staff member" on every save, even with the email
  // completely unchanged. Root cause: the old exclusion filter compared
  // req.params.id against the document's `id` FIELD, which is undefined
  // on exactly this kind of record, so `undefined !== req.params.id` was
  // trivially true and the record matched itself.
  const NO_UUID_ID = '507f1f77bcf86cd799439011'; // realistic 24-hex Mongo _id

  beforeEach(() => {
    mockTeachers.push({
      // Deliberately NO `id` field — the exact shape that broke.
      _id: NO_UUID_ID, schoolId: SCHOOL_ID, firstName: 'Ann', lastName: 'Wanjiku',
      email: 'ann.wanjiku@demo.school', userId: 'usr_ann', staffType: 'admin',
      extraRoles: [], departmentId: null, _v: 0,
    });
  });

  test('saving a record with no UUID id, unchanged email, no longer false-positives as a duplicate', async () => {
    const res = await supertest(buildApp())
      .put(`/api/teachers/${NO_UUID_ID}`)
      .send({ email: 'ann.wanjiku@demo.school', phone: '0722000000' });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('0722000000');
  });

  test('a genuine collision with a DIFFERENT staff member\'s email is still correctly rejected', async () => {
    const res = await supertest(buildApp())
      .put(`/api/teachers/${NO_UUID_ID}`)
      .send({ email: 'amina@demo.school' }); // belongs to mockTeachers[0], a different person

    expect(res.status).toBe(409);
  });

  test('a genuine collision is still rejected the other direction too — a UUID-id record saving another record\'s email', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_1')
      .send({ email: 'ann.wanjiku@demo.school' }); // belongs to the no-UUID record

    expect(res.status).toBe(409);
  });

  test('an unrelated field change on the no-UUID record works end-to-end (not just the email check)', async () => {
    const res = await supertest(buildApp())
      .put(`/api/teachers/${NO_UUID_ID}`)
      .send({ extraRoles: ['hod'] });

    expect(res.status).toBe(200);
    expect(res.body.data.extraRoles).toEqual(['hod']);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_ann');
  });
});
