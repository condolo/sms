/* ============================================================
   staffType/role separation audit — the fix, proven end-to-end

   Root cause fixed: teachers.js's PUT /:id (and POST /) silently synced
   `data.staffType` onto the linked user's `role` on every save that
   included it — which, since the HR edit form resubmits the whole
   record, meant on essentially every save. staffType is an HR job-title
   field ("Marketing", "Front Office Assistant", ...), not a controlled
   RBAC vocabulary. An admin fixing someone's phone number could silently
   change their system role. Role assignment now happens ONLY through the
   explicit, validated Settings -> Users path (server/utils/role-
   validation.js, shared by settings.js's invite/bulk-invite/PUT and
   users.js's invite/bulk-invite — a second, previously-unvalidated route
   file found live at /api/users during this same audit).

   Real authMiddleware + real rbac() throughout — per the audit's
   explicit requirement, this is not mocked away. Only the DB layer
   (tenantModel/_model) is mocked.

   Covers (numbering matches the requested test list):
     1. Editing phone/email/address does not change RBAC role.
     2. Editing staffType does not silently change RBAC role.
     3. Explicit role assignment still works.
     7. A user cannot grant themselves an unauthorized role.
     8. Admin cannot use HR profile editing as an indirect
        privilege-escalation path.
     9. Existing valid teacher/admin/HR/finance accounts continue to work.
   (4/5/6 — extra-role changes, department/HOD scope, revocation on
   removal — are covered by teachers-extra-roles-revocation.test.js and
   hod-department-scope-e2e.test.js; not duplicated here.)

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_ID = 'sch_demo_001';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}

let mockTeachers, mockUsers, mockCustomRoles, mockRolePerms;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'role_permissions') {
      return { findOne: (filter) => mockChainObj(mockRolePerms.find(d => d.schoolId === filter.schoolId && d.roleKey === filter.roleKey) ?? null) };
    }
    if (col === 'schools') return { findOne: () => mockChainObj({ id: SCHOOL_ID, name: 'Demo School' }) };
    return { findOne: () => mockChainObj(null), updateOne: () => Promise.resolve({}) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'teachers') {
      return {
        findOne: (filter) => mockChainObj(mockTeachers.find(d =>
          (filter.id ? d.id === filter.id : true) &&
          (filter.$or ? filter.$or.some(c => (c.userId && d.userId === c.userId) || (c.email && d.email === c.email)) : true) &&
          d.schoolId === filter.schoolId
        ) ?? null),
        findOneAndUpdate: (filter, update) => {
          // Two call shapes exist in teachers.js: PUT /:id filters by {id,
          // schoolId}; PUT /me filters by {schoolId, email} (resolved via
          // the caller's own user record) — support both.
          const doc = mockTeachers.find(d =>
            d.schoolId === filter.schoolId &&
            (filter.id ? d.id === filter.id : d.email === filter.email)
          );
          if (!doc) return { lean: () => Promise.resolve(null) };
          Object.assign(doc, update.$set);
          doc._v = (doc._v ?? 0) + 1;
          return { lean: () => Promise.resolve({ ...doc }) };
        },
        updateOne: (filter, update) => {
          const doc = mockTeachers.find(d =>
            (filter.$or ? filter.$or.some(c => (c.userId && d.userId === c.userId) || (c.email && d.email === c.email)) : d.id === filter.id) &&
            d.schoolId === filter.schoolId
          );
          if (doc && update.$set) Object.assign(doc, update.$set);
          return Promise.resolve({ matchedCount: doc ? 1 : 0 });
        },
      };
    }
    if (col === 'users') {
      return {
        findOne: (filter) => mockChainObj(mockUsers.find(d =>
          (filter.id ? d.id === filter.id : true) &&
          (filter.email ? d.email === filter.email : true) &&
          d.schoolId === filter.schoolId
        ) ?? null),
        updateOne: (filter, update) => {
          const doc = mockUsers.find(d => d.id === filter.id && d.schoolId === filter.schoolId);
          if (doc && update.$set) Object.assign(doc, update.$set);
          return Promise.resolve({ matchedCount: doc ? 1 : 0 });
        },
      };
    }
    if (col === 'custom_roles') {
      return { findOne: (filter) => mockChainObj(mockCustomRoles.find(d => d.schoolId === filter.schoolId && d.key === filter.key) ?? null) };
    }
    return { findOne: () => mockChainObj(null), find: () => mockChainArr([]) };
  }),
}));

const mockRevokeUserTokens = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: (...args) => mockRevokeUserTokens(...args),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
  getIdentityTokenVersion: jest.fn(),
  getTokenVersion: jest.fn(),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');
const teachersRouter = require('../../routes/teachers');
const settingsRouter = require('../../routes/settings');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/teachers', teachersRouter);
  app.use('/api/settings', settingsRouter);
  return app;
}

function cookieFor(user) {
  return `token=${sign({ userId: user.id, schoolId: SCHOOL_ID, role: user.role, roles: user.roles ?? [user.role] })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCustomRoles = [];
  mockRolePerms = [
    { schoolId: SCHOOL_ID, roleKey: 'admin',   permissions: { settings: ['read', 'create', 'update', 'delete'], teachers: ['read', 'create', 'update', 'delete'] } },
    { schoolId: SCHOOL_ID, roleKey: 'hr',      permissions: { teachers: ['read', 'create', 'update', 'delete'] } }, // HR can edit staff profiles but NOT settings
    { schoolId: SCHOOL_ID, roleKey: 'teacher', permissions: { teachers: ['read'] } },
    { schoolId: SCHOOL_ID, roleKey: 'finance', permissions: { finance: ['read'] } },
  ];
  mockUsers = [
    { id: 'usr_admin',   schoolId: SCHOOL_ID, email: 'admin@x.com',   role: 'admin',   roles: ['admin'] },
    { id: 'usr_hr',      schoolId: SCHOOL_ID, email: 'hr@x.com',      role: 'hr',      roles: ['hr'] },
    { id: 'usr_teacher', schoolId: SCHOOL_ID, email: 'amina@x.com',   role: 'teacher', roles: ['teacher'], phone: '0700000000' },
  ];
  mockTeachers = [
    { id: 'tch_amina', schoolId: SCHOOL_ID, firstName: 'Amina', lastName: 'Otieno', email: 'amina@x.com', userId: 'usr_teacher', staffType: 'teacher', phone: '0700000000', extraRoles: [], _v: 0 },
  ];
});

describe('1 & 2 — HR profile edits never touch RBAC role', () => {
  test('editing phone does not change the linked user\'s role', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_amina')
      .set('Cookie', cookieFor(mockUsers[0])) // admin editing
      .send({ phone: '0711111111' });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('0711111111');
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher'); // unchanged
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });

  test('editing staffType to a free-text, non-role value does not change the linked user\'s role', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_amina')
      .set('Cookie', cookieFor(mockUsers[0]))
      .send({ staffType: 'Marketing Coordinator' }); // not a real role at all

    expect(res.status).toBe(200);
    expect(res.body.data.staffType).toBe('Marketing Coordinator'); // HR label updates freely
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher'); // RBAC role untouched
  });

  test('editing staffType to a string that HAPPENS to be a real role key STILL does not change RBAC role — no implicit conversion at all, ever', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_amina')
      .set('Cookie', cookieFor(mockUsers[0]))
      .send({ staffType: 'finance' }); // coincidentally a real role key

    expect(res.status).toBe(200);
    expect(res.body.data.staffType).toBe('finance');
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher'); // still unchanged — no conversion, ever
  });
});

describe('3 — explicit role assignment via Settings -> Users still works', () => {
  test('admin can still change a user\'s role through the validated path, tokens revoked, HR label cascades as a courtesy', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/users/usr_teacher')
      .set('Cookie', cookieFor(mockUsers[0]))
      .send({ role: 'finance' });

    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('finance');
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_teacher');
    // Deliberately-kept direction: an explicit RBAC role change DOES
    // still cascade to the HR staffType label (unlike the removed
    // reverse direction) — this is the "deliberate, not accidental"
    // interaction the target model calls for.
    expect(mockTeachers.find(t => t.id === 'tch_amina').staffType).toBe('finance');
  });

  test('a real, unrecognized role string is still rejected (validation intact after the shared-module extraction)', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/users/usr_teacher')
      .set('Cookie', cookieFor(mockUsers[0]))
      .send({ role: 'Not A Real Role' });

    expect(res.status).toBe(400);
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher'); // unchanged
  });
});

describe('7 — a user cannot grant themselves an unauthorized role', () => {
  test('self-service PUT /teachers/me silently ignores staffType (not in the self-editable allowlist) — no role change possible via self-edit', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/me')
      .set('Cookie', cookieFor(mockUsers[2])) // as the teacher themselves
      .send({ staffType: 'admin', phone: '0722222222' }); // staffType smuggled in alongside an allowed field

    expect(res.status).toBe(200);
    expect(res.body.data.staffType).toBe('teacher'); // untouched — staffType silently dropped, not applied
    expect(res.body.data.phone).toBe('0722222222');   // allowed field still went through
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher'); // definitely unchanged
  });
});

describe('8 — HR profile editing cannot be used as an indirect privilege-escalation path', () => {
  test('an HR-role caller (teachers:update, but NO settings:update) editing staffType cannot escalate the linked user to admin', async () => {
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_amina')
      .set('Cookie', cookieFor(mockUsers[1])) // hr role — has teachers:update, per fixture NOT settings:*
      .send({ staffType: 'admin' });

    expect(res.status).toBe(200); // HR is allowed to edit the HR-facing field
    expect(res.body.data.staffType).toBe('admin'); // the label itself can say anything — it's just a label
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher'); // but RBAC role is provably untouched

    // Confirm the ONLY route that could actually grant admin is properly
    // gated: the same HR account attempting the real, validated path is
    // correctly rejected, since HR lacks settings:update in this fixture.
    const escalation = await supertest(buildApp())
      .put('/api/settings/users/usr_teacher')
      .set('Cookie', cookieFor(mockUsers[1]))
      .send({ role: 'admin' });
    expect(escalation.status).toBe(403);
    expect(mockUsers.find(u => u.id === 'usr_teacher').role).toBe('teacher');
  });
});

describe('9 — existing valid accounts continue to work across the standard roles', () => {
  test.each(['admin', 'hr'])('%s can still edit a staff record via PUT /teachers/:id (management-tier access, unaffected by this fix)', async (roleKey) => {
    const user = mockUsers.find(u => u.role === roleKey);
    const res = await supertest(buildApp())
      .put(`/api/teachers/tch_amina`)
      .set('Cookie', cookieFor(user))
      .send({ phone: '0733333333' });
    expect(res.status).toBe(200);
  });

  test('a plain teacher (RBAC: teachers:read only, no update) still can\'t PUT /teachers/:id — correctly uses PUT /teachers/me for their own record instead', async () => {
    const denied = await supertest(buildApp())
      .put('/api/teachers/tch_amina')
      .set('Cookie', cookieFor(mockUsers[2]))
      .send({ phone: '0733333333' });
    expect(denied.status).toBe(403); // unaffected by this fix — always required teachers:update

    const selfEdit = await supertest(buildApp())
      .put('/api/teachers/me')
      .set('Cookie', cookieFor(mockUsers[2]))
      .send({ phone: '0733333333' });
    expect(selfEdit.status).toBe(200); // their actual, correct, unaffected workflow
  });

  test('finance role (no teachers grant at all) is correctly still rejected — RBAC boundaries unaffected by this fix', async () => {
    const financeUser = { id: 'usr_finance', schoolId: SCHOOL_ID, email: 'fin@x.com', role: 'finance', roles: ['finance'] };
    const res = await supertest(buildApp())
      .put('/api/teachers/tch_amina')
      .set('Cookie', cookieFor(financeUser))
      .send({ phone: '0744444444' });
    expect(res.status).toBe(403);
  });
});
