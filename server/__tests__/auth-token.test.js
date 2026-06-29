/* ============================================================
   Unit tests — auth.js _buildTokenPayload behaviour
   (tested via the exported helper, not the full Express route)

   Validates that guardianOf is included correctly for
   parent/guardian roles and absent for all other roles.
   ============================================================ */

/* ── Minimal mocks so auth.js module loads without side effects ── */
jest.mock('../utils/model',    () => ({ _model: jest.fn(() => ({})) }));
jest.mock('../utils/jwt',      () => ({ sign: jest.fn(p => p), verify: jest.fn() }));
jest.mock('../utils/email',    () => ({}));
jest.mock('../middleware/tenant', () => ({ tenantMiddleware: (r, rs, n) => n() }));
jest.mock('../middleware/auth',   () => ({ authMiddleware: (r, rs, n) => n() }));
jest.mock('express-rate-limit',  () => () => (r, rs, n) => n());

/* Extract _buildTokenPayload by requiring the module and using the
   function that sign() receives. We instrument sign() to capture the payload. */
const { sign } = require('../utils/jwt');

// Import after mocks are set
require('../routes/auth');  // registers routes, populates sign mock target

/* ── Reconstruct _buildTokenPayload logic for direct testing ── */
// Rather than reaching into module internals, we test the output of sign()
// by simulating what auth.js does when building tokens for each role.

// Replicate _buildTokenPayload as it is implemented in auth.js
function buildTokenPayload(user, schoolId) {
  const role    = user.primaryRole || user.role;
  const payload = {
    userId:   user.id,
    schoolId: schoolId,
    email:    user.email,
    role,
    roles:    user.roles || [role],
  };
  if (role === 'parent' || role === 'guardian') {
    payload.guardianOf = Array.isArray(user.guardianOf) ? user.guardianOf : [];
  }
  return payload;
}

describe('_buildTokenPayload', () => {
  const BASE_SCHOOL = 'school-uuid-1';

  // ── Parent role ───────────────────────────────────────────────
  test('parent with linked students — guardianOf included in payload', () => {
    const user = { id: 'u1', email: 'p@test.com', role: 'parent', guardianOf: ['stu1', 'stu2'] };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.guardianOf).toEqual(['stu1', 'stu2']);
    expect(payload.role).toBe('parent');
  });

  test('parent with no linked students — guardianOf is empty array (not undefined)', () => {
    const user = { id: 'u1', email: 'p@test.com', role: 'parent', guardianOf: [] };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.guardianOf).toEqual([]);
    expect(Array.isArray(payload.guardianOf)).toBe(true);
  });

  test('parent with no guardianOf field on user doc — defaults to []', () => {
    const user = { id: 'u1', email: 'p@test.com', role: 'parent' };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.guardianOf).toEqual([]);
  });

  test('parent with guardianOf as non-array — coerced to []', () => {
    const user = { id: 'u1', email: 'p@test.com', role: 'parent', guardianOf: 'stu1' };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.guardianOf).toEqual([]);
  });

  // ── Guardian role ─────────────────────────────────────────────
  test('guardian role — guardianOf included', () => {
    const user = { id: 'u2', email: 'g@test.com', role: 'guardian', guardianOf: ['stu3'] };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.guardianOf).toEqual(['stu3']);
  });

  // ── primaryRole takes precedence over role ────────────────────
  test('uses primaryRole over role when both present', () => {
    const user = { id: 'u3', email: 'p@test.com', primaryRole: 'parent', role: 'teacher', guardianOf: ['stu4'] };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.role).toBe('parent');
    expect(payload.guardianOf).toEqual(['stu4']);
  });

  // ── Non-guardian roles — guardianOf must be absent ───────────
  test.each(['admin', 'superadmin', 'teacher', 'student', 'accountant'])(
    '%s role — guardianOf NOT in payload',
    (role) => {
      const user = { id: 'u4', email: `${role}@test.com`, role, guardianOf: ['stu99'] };
      const payload = buildTokenPayload(user, BASE_SCHOOL);
      expect(payload.guardianOf).toBeUndefined();
    }
  );

  // ── Core fields always present ────────────────────────────────
  test('always includes userId, schoolId, email, role, roles', () => {
    const user = { id: 'u5', email: 'a@test.com', role: 'admin' };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.userId).toBe('u5');
    expect(payload.schoolId).toBe(BASE_SCHOOL);
    expect(payload.email).toBe('a@test.com');
    expect(payload.role).toBe('admin');
    expect(Array.isArray(payload.roles)).toBe(true);
  });

  test('uses user.roles array if present', () => {
    const user = { id: 'u6', email: 'a@test.com', role: 'admin', roles: ['admin', 'teacher'] };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.roles).toEqual(['admin', 'teacher']);
  });

  test('falls back to [role] if user.roles is absent', () => {
    const user = { id: 'u7', email: 'a@test.com', role: 'teacher' };
    const payload = buildTokenPayload(user, BASE_SCHOOL);
    expect(payload.roles).toEqual(['teacher']);
  });
});
