/* ============================================================
   PUT/GET /api/settings/school — roleLabels (2026-09)

   A school can already rename a CUSTOM role's display name (its own
   `label` field on custom_roles), but had no way at all to rename a
   BUILT-IN role's display name ("Teacher", "Finance", ...) — reported
   directly. roleLabels is the built-in equivalent: a school-doc field,
   `{ [systemRoleKey]: displayLabel }`, that never touches the role's
   actual machine key or its permissions — purely what's shown.

   Covers:
     1. A valid roleLabels object is saved and echoed back.
     2. Unknown role keys are stripped, not saved (can't invent a role
        name override for something that isn't a real system role).
     3. Non-string values are stripped.
     4. Labels are trimmed and capped at 60 characters.
     5. An empty object clears every override (used by "reset to
        default" for the last remaining custom label).
     6. GET /settings/school returns roleLabels for BOTH an admin (full
        school doc) and a non-admin (the restricted "safe" projection —
        this used to omit roleLabels entirely).

   Real authMiddleware runs against a signed JWT cookie, same as
   settings-audit.test.js — only model/tenant-model are mocked.
   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
}));
jest.mock('../../middleware/module-gate', () => ({ invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../middleware/scopeMiddleware', () => ({
  invalidateScopeCache: jest.fn(),
  invalidateScopeCacheForRole: jest.fn(),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

let mockSchools;

function mockMakeStore(initialDocs, matcher) {
  return {
    docs: [...initialDocs],
    find(filter) { return this.docs.find(d => matcher(d, filter)); },
    apply(doc, update) {
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    },
  };
}
function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue((() => { const d = store.find(filter); return d ? { ...d } : null; })()),
    })),
    updateOne: jest.fn((filter, update) => {
      const doc = store.find(filter);
      if (doc) store.apply(doc, update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    find: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(store.docs) })),
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return mockMakeCollection(mockSchools);
    return mockMakeCollection(mockMakeStore([], () => false));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => mockMakeCollection(mockMakeStore([], () => false)),
}));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}

function authCookie(payload) {
  return `token=${sign({ role: 'admin', ...payload })}`;
}

const SCHOOL_ID = 'sch_demo_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockSchools = mockMakeStore(
    [{ id: SCHOOL_ID, name: 'Demo School' }],
    (d, f) => d.id === f.id
  );
});

describe('PUT /api/settings/school — roleLabels', () => {
  test('a valid roleLabels object is saved and echoed back on GET', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const putRes = await supertest(app).put('/api/settings/school')
      .set('Cookie', cookie)
      .send({ roleLabels: { teacher: 'Educator', finance: 'Bursar' } });
    expect(putRes.status).toBe(200);

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.roleLabels).toEqual({ teacher: 'Educator', finance: 'Bursar' });
  });

  test('an unknown role key is stripped, not saved', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ roleLabels: { teacher: 'Educator', not_a_real_role: 'Ghost Role' } });

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.roleLabels).toEqual({ teacher: 'Educator' });
  });

  test('superadmin can never get a label override (not a real assignable SYSTEM_ROLES entry)', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ roleLabels: { superadmin: 'God Mode' } });

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.roleLabels).toEqual({});
  });

  test('a non-string value is stripped', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ roleLabels: { teacher: 123, finance: 'Bursar' } });

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.roleLabels).toEqual({ finance: 'Bursar' });
  });

  test('a label is trimmed and capped at 60 characters', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });
    const tooLong = 'X'.repeat(100);

    await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ roleLabels: { teacher: `  Educator  `, finance: tooLong } });

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.roleLabels.teacher).toBe('Educator');
    expect(getRes.body.data.roleLabels.finance).toHaveLength(60);
  });

  test('sending an empty object clears every override ("reset to default")', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ roleLabels: { teacher: 'Educator' } });
    await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ roleLabels: {} });

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.roleLabels).toEqual({});
  });
});

describe('GET /api/settings/school — roleLabels visible to non-admins too', () => {
  test('a non-admin still sees roleLabels (used to be silently omitted from the restricted projection)', async () => {
    const app = buildApp();
    const adminCookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });
    await supertest(app).put('/api/settings/school').set('Cookie', adminCookie)
      .send({ roleLabels: { teacher: 'Educator' } });

    const teacherCookie = authCookie({ userId: 'u2', schoolId: SCHOOL_ID, role: 'teacher' });
    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', teacherCookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.roleLabels).toEqual({ teacher: 'Educator' });
  });
});
