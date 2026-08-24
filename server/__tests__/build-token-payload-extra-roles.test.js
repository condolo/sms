/* ============================================================
   Unit tests — auth.js _buildTokenPayload's extraRoles/departmentId
   resolution (the HOD JWT-propagation fix)

   Deliberately calls the REAL exported _buildTokenPayload (router.
   _buildTokenPayload — see the bottom of auth.js), not a hand-copied
   reimplementation of its logic. server/__tests__/auth-token.test.js
   (pre-existing) tests a manually-reconstructed copy of this function,
   which is exactly the kind of drift risk that let extraRoles/
   departmentId go unnoticed for as long as it did — a reimplementation
   can silently diverge from what actually ships. This file exists
   specifically to test the real thing.

   Root cause: extraRoles (hod/class_teacher/timetabler/exam_officer/
   deputy/principal) and departmentId live only on the linked `teachers`
   record — auth.js's _buildTokenPayload never read either, so every
   server-side check gated on req.jwtUser.extraRoles/.departmentId
   (teaching-assignments.js, lessons.js, weekly-snapshots.js) silently
   evaluated as "nothing set" for every real login.

   Covers scenarios 1-4 of the requested test matrix:
     1. user without extra role
     2. user with hod
     3. user with multiple extra roles
     4. primary role + extra role combination
   (5-9 are covered in teachers-extra-roles-revocation.test.js and
   hod-department-scope-e2e.test.js.)

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

/* ── Minimal mocks so auth.js loads without side effects ── */
jest.mock('../utils/jwt', () => ({ sign: jest.fn(p => JSON.stringify(p)), verify: jest.fn() }));
jest.mock('../middleware/tenant', () => ({ tenantMiddleware: (r, rs, n) => n() }));
jest.mock('../middleware/auth',   () => ({ authMiddleware: (r, rs, n) => n() }));
jest.mock('express-rate-limit',   () => () => (r, rs, n) => n());
jest.mock('../utils/email', () => ({}));
jest.mock('../services/sessionService', () => ({}));
jest.mock('../utils/token-version', () => ({
  revokeUserTokens: jest.fn(), revokeIdentityTokens: jest.fn(),
  getIdentityTokenVersion: jest.fn().mockResolvedValue(0),
}));
jest.mock('../services/audit', () => ({ log: jest.fn() }));
jest.mock('../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../utils/identity-cutover', () => ({ isIdentityCutoverEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock('../config/moduleRegistry', () => ({ MODULE_REGISTRY: [] }));

let mockTeacher; // the linked teachers doc _buildTokenPayload should find (or null)

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools')       return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) };
    if (col === 'organizations') return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) };
    return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) };
  }),
}));
jest.mock('../utils/tenant-model', () => ({
  tenantContext: (ctx) => ctx,
  tenantModel: jest.fn((col) => {
    if (col === 'teachers') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockTeacher) }) }) };
    }
    return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) };
  }),
}));

const { _buildTokenPayload } = require('../routes/auth');

const SCHOOL_ID = 'sch_demo_001';

beforeEach(() => {
  mockTeacher = null;
});

describe('_buildTokenPayload — extraRoles resolution', () => {
  test('scenario 1: user with no linked teacher record — no extraRoles field on the payload at all', async () => {
    mockTeacher = null;
    const payload = await _buildTokenPayload({ id: 'u1', email: 'u1@x.com', role: 'teacher' }, SCHOOL_ID);
    expect(payload).not.toHaveProperty('extraRoles');
  });

  test('scenario 1b: linked teacher exists but has no extraRoles set — no field added (keeps tokens lean)', async () => {
    mockTeacher = { extraRoles: [], departmentId: null };
    const payload = await _buildTokenPayload({ id: 'u1', email: 'u1@x.com', role: 'teacher' }, SCHOOL_ID);
    expect(payload).not.toHaveProperty('extraRoles');
  });

  test('scenario 2: user with hod — extraRoles: ["hod"] on the payload', async () => {
    mockTeacher = { extraRoles: ['hod'], departmentId: 'dept_math' };
    const payload = await _buildTokenPayload({ id: 'u2', email: 'u2@x.com', role: 'teacher' }, SCHOOL_ID);
    expect(payload.extraRoles).toEqual(['hod']);
    expect(payload.departmentId).toBe('dept_math');
  });

  test('scenario 3: user with multiple extra roles — all present on the payload', async () => {
    mockTeacher = { extraRoles: ['hod', 'timetabler', 'exam_officer'], departmentId: 'dept_science' };
    const payload = await _buildTokenPayload({ id: 'u3', email: 'u3@x.com', role: 'teacher' }, SCHOOL_ID);
    expect(payload.extraRoles).toEqual(['hod', 'timetabler', 'exam_officer']);
  });

  test('scenario 4: primary role + extra role combination — both coexist correctly, primary role untouched', async () => {
    mockTeacher = { extraRoles: ['hod'], departmentId: 'dept_math' };
    const payload = await _buildTokenPayload({ id: 'u4', email: 'u4@x.com', role: 'teacher', roles: ['teacher'] }, SCHOOL_ID);
    expect(payload.role).toBe('teacher');       // primary role unaffected
    expect(payload.roles).toEqual(['teacher']); // roles[] unaffected
    expect(payload.extraRoles).toEqual(['hod']); // extra role additive, not a replacement
  });

  test('departmentId not added when teacher has none, even with extraRoles set', async () => {
    mockTeacher = { extraRoles: ['timetabler'], departmentId: null };
    const payload = await _buildTokenPayload({ id: 'u5', email: 'u5@x.com', role: 'teacher' }, SCHOOL_ID);
    expect(payload.extraRoles).toEqual(['timetabler']);
    expect(payload).not.toHaveProperty('departmentId');
  });

  test('a lookup failure is non-fatal — payload still builds, just without extraRoles', async () => {
    const { tenantModel } = require('../utils/tenant-model');
    tenantModel.mockImplementationOnce(() => { throw new Error('DB unavailable'); });
    const payload = await _buildTokenPayload({ id: 'u6', email: 'u6@x.com', role: 'teacher' }, SCHOOL_ID);
    expect(payload.userId).toBe('u6'); // rest of the payload still built correctly
    expect(payload).not.toHaveProperty('extraRoles');
  });

  test('non-teaching roles (e.g. parent) are unaffected — extraRoles lookup still runs (matched by email) but adds nothing when absent', async () => {
    mockTeacher = null;
    const payload = await _buildTokenPayload({ id: 'u7', email: 'parent@x.com', role: 'parent', guardianOf: ['stu1'] }, SCHOOL_ID);
    expect(payload.guardianOf).toEqual(['stu1']); // existing parent behavior unchanged
    expect(payload).not.toHaveProperty('extraRoles');
  });
});
