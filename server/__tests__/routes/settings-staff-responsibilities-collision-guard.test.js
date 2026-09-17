/* ============================================================
   PUT /api/settings/school — staffResponsibilities collision guard
   (2026-09 security fix)

   A custom staff responsibility (Settings -> Staff Roles &
   Responsibilities) lives on teacher.extraRoles — a per-teacher
   organizational tag, NOT a real account role. Found live: two
   built-in responsibility values ('deputy', 'principal', since
   renamed — see server/config/staffResponsibilities.js) used to be
   the exact same strings SYSTEM_ROLES uses for real account roles,
   and several authorization checks merge extraRoles into the same
   Set as role/roles, so tagging a teacher with a colliding value
   silently granted them that role's actual access. This guard is
   the authoritative block against a school ever recreating that by
   hand with a CUSTOM entry (the client has the same check for
   immediate feedback, but that alone is trivially bypassed).

   Real authMiddleware runs against a signed JWT cookie, same as
   settings-role-labels.test.js — only model/tenant-model are mocked.
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

const SCHOOL_ID = 'sch_demo_002';

beforeEach(() => {
  jest.clearAllMocks();
  mockSchools = mockMakeStore(
    [{ id: SCHOOL_ID, name: 'Demo School' }],
    (d, f) => d.id === f.id
  );
});

describe('PUT /api/settings/school — staffResponsibilities collision guard', () => {
  test('a legitimate custom responsibility saves normally', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const res = await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ staffResponsibilities: [{ value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' }] });
    expect(res.status).toBe(200);

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.staffResponsibilities).toEqual([{ value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' }]);
  });

  test('a custom responsibility whose value equals a real system role ("principal") is rejected outright, not silently dropped', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const res = await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ staffResponsibilities: [{ value: 'principal', label: 'Head Teacher' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/reserved for a real system role/i);

    // Confirm it truly never saved — this must be a hard rejection of the
    // WHOLE request, not a silent per-entry filter (unlike roleLabels'
    // deliberately tolerant "unknown key dropped" behavior — an admin
    // must know their responsibility didn't save, since the reason is
    // security-relevant, not a typo).
    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.staffResponsibilities ?? []).toEqual([]);
  });

  test('the same guard catches "section_head" — a real system role never yet used as a built-in responsibility, but reachable by typing it', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const res = await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ staffResponsibilities: [{ value: 'section_head', label: 'Section Head' }] });
    expect(res.status).toBe(400);
  });

  test('a request mixing one legitimate and one colliding entry is rejected in full, not partially saved', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const res = await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ staffResponsibilities: [
        { value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' },
        { value: 'deputy_principal', label: 'Deputy Head' },
      ] });
    expect(res.status).toBe(400);

    const getRes = await supertest(app).get('/api/settings/school').set('Cookie', cookie);
    expect(getRes.body.data.staffResponsibilities ?? []).toEqual([]); // the legitimate entry did NOT sneak through either
  });

  test('the renamed built-in values (acting_deputy, head_of_school) are NOT reserved — the actual fix this guard exists alongside', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const res = await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ staffResponsibilities: [
        { value: 'acting_deputy', label: 'Deputy Head' },
        { value: 'head_of_school', label: 'Head of School' },
      ] });
    expect(res.status).toBe(200);
  });

  test('a non-array payload is rejected with a clear error rather than silently coerced', async () => {
    const app = buildApp();
    const cookie = authCookie({ userId: 'u1', schoolId: SCHOOL_ID, role: 'admin' });

    const res = await supertest(app).put('/api/settings/school').set('Cookie', cookie)
      .send({ staffResponsibilities: { value: 'oops' } });
    expect(res.status).toBe(400);
  });
});
