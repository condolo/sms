/* ============================================================
   Integration tests — organization-first login
   (POST /api/auth/org-login, POST /api/auth/complete-org-login,
   GET /api/public/resolve-portal)

   Completes the Organization/Identity/Membership layer's intended
   behavior (PLATFORM_ARCHITECTURE_EVOLUTION_v1.md §15): visit the
   org's shared URL, authenticate once, land directly in one school or
   pick from several. Reuses _resolveIdentitySchools (auth.js, proven
   by auth-switch-school.test.js/auth-session.test.js) as the sole
   source of truth for "which schools can this identity log into" —
   this file focuses on the credential-check and picker-redemption
   layers built on top of it.

   Two gates required for org-login to ever leave its "not found"
   posture: organizations.multiSchoolEnabled (originally two flags —
   orgSlugLoginEnabled removed 2026-07-20, ADR-0007 correction 6) and
   the platform-global IDENTITY_CUTOVER_ENABLED env var — each tested
   independently.

   The load-bearing security tests: complete-org-login must 403 when
   asked to redeem a schoolId outside the server-locked allowlist from
   org-login, and must 403 when the target school has been re-parented
   to a different organization since the code was minted (TOCTOU).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../services/sessionService', () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: 'sess_org_001',
    absoluteExpiry: new Date(Date.now() + 86_400_000).toISOString(),
  }),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail:       jest.fn().mockResolvedValue(undefined),
  clearFail:        jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/email', () => ({
  sendLoginOTP:        jest.fn().mockResolvedValue(undefined),
  sendTrialReminder:   jest.fn().mockResolvedValue(undefined),
}));

let mockOrgDocs = {};          // keyed by slug for organizations.findOne({slug})... and by id
let mockSchoolDocsById = {};   // keyed by id
let mockIdentityDoc = null;    // single identity doc, or null
let mockEligibleUserDocs = []; // {id, schoolId, identityId, isActive} — resolver's users.find() source
let mockTargetUserDocs = {};   // keyed by `${id}|${schoolId}` — final re-fetch source

function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }) };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'organizations') {
      return {
        findOne: jest.fn((filter) => mockChain(() => {
          if (filter.slug) return Object.values(mockOrgDocs).find(o => o.slug === filter.slug) || null;
          if (filter.id)   return mockOrgDocs[filter.id] || null;
          return null;
        })),
      };
    }
    if (collection === 'schools') {
      return {
        findOne: jest.fn((filter) => mockChain(() => {
          if (filter.slug) return Object.values(mockSchoolDocsById).find(s => s.slug === filter.slug) || null;
          if (filter.id)   return mockSchoolDocsById[filter.id] || null;
          return null;
        })),
        find:    jest.fn((filter) => mockChain(() => Object.values(mockSchoolDocsById).filter(s => s.organizationId === filter.organizationId))),
        countDocuments: jest.fn((filter) => Promise.resolve(Object.values(mockSchoolDocsById).filter(s => s.organizationId === filter.organizationId).length)),
      };
    }
    if (collection === 'identities') {
      return {
        findOne: jest.fn((filter) => mockChain(() => {
          if (!mockIdentityDoc) return null;
          if (mockIdentityDoc.orgId !== filter.orgId) return null;
          if (mockIdentityDoc.email !== filter.email) return null;
          if (filter.status && mockIdentityDoc.status !== filter.status) return null;
          if (filter.id && mockIdentityDoc.id !== filter.id) return null;
          return mockIdentityDoc;
        })),
      };
    }
    if (collection === 'users') {
      return {
        find: jest.fn((filter) => mockChain(() => mockEligibleUserDocs.filter(u =>
          u.identityId === filter.identityId &&
          (filter.schoolId?.$in || []).includes(u.schoolId) &&
          u.isActive !== false
        ))),
        findOne: jest.fn((filter) => mockChain(() => {
          const doc = mockTargetUserDocs[`${filter.id}|${filter.schoolId}`];
          if (!doc) return null;
          if (filter.isActive && doc.isActive === false) return null; // emulate isActive:{$ne:false}
          return doc;
        })),
        updateOne: jest.fn().mockResolvedValue({}),
      };
    }
    return {
      findOne:   jest.fn(() => mockChain(() => null)),
      find:      jest.fn(() => mockChain(() => [])),
      updateOne: jest.fn().mockResolvedValue({}),
    };
  }),
}));

const bcrypt = require('bcryptjs');
const express   = require('express');
const supertest = require('supertest');
const { verify } = require('../../utils/jwt');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  const authRouter   = require('../../routes/auth');
  const publicRouter = require('../../routes/public');
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  return app;
}

let HASHED;
beforeAll(async () => { HASHED = await bcrypt.hash('Secret123!', 10); });

beforeEach(() => {
  jest.clearAllMocks();
  mockOrgDocs = {};
  mockSchoolDocsById = {};
  mockIdentityDoc = null;
  mockEligibleUserDocs = [];
  mockTargetUserDocs = {};
  delete process.env.IDENTITY_CUTOVER_ENABLED;
});

function setupOptedInOrg({ schoolCount = 2 } = {}) {
  mockOrgDocs.org_x = { id: 'org_x', slug: 'green-valley', name: 'Green Valley', multiSchoolEnabled: true };
  mockSchoolDocsById.sch_a = { id: 'sch_a', organizationId: 'org_x', slug: 'gv-a', name: 'Campus A' };
  if (schoolCount >= 2) {
    mockSchoolDocsById.sch_b = { id: 'sch_b', organizationId: 'org_x', slug: 'gv-b', name: 'Campus B' };
  }
  process.env.IDENTITY_CUTOVER_ENABLED = 'true';
}

/* ══════════════════════════════════════════════════════════════ */
describe('GET /api/public/resolve-portal', () => {
  test('resolves a school when the slug matches one, even if an org also shares the slug (1:1-genesis case)', async () => {
    mockSchoolDocsById.sch_a = { id: 'sch_a', slug: 'gv', name: 'Campus A', isActive: true };
    const app = buildApp();
    const res = await supertest(app).get('/api/public/resolve-portal?slug=gv');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('school');
  });

  test('resolves an organization when opted in with 2+ schools', async () => {
    setupOptedInOrg();
    const app = buildApp();
    const res = await supertest(app).get('/api/public/resolve-portal?slug=green-valley');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('organization');
    expect(res.body.slug).toBe('green-valley');
  });

  test('404s with the SAME shape at the SAME slug whether an org exists there unopted-in or nothing exists there at all (no existence leakage)', async () => {
    const app = buildApp();

    // State 1: literally nothing at this slug.
    const nothingRes = await supertest(app).get('/api/public/resolve-portal?slug=green-valley');

    // State 2: a real organization exists at the exact same slug, just not opted in.
    mockOrgDocs.org_x = { id: 'org_x', slug: 'green-valley', multiSchoolEnabled: false };
    const notOptedInRes = await supertest(app).get('/api/public/resolve-portal?slug=green-valley');

    expect(nothingRes.status).toBe(404);
    expect(notOptedInRes.status).toBe(404);
    expect(notOptedInRes.body).toEqual(nothingRes.body);
  });

  test('404s when the org is opted in but has fewer than 2 schools', async () => {
    setupOptedInOrg({ schoolCount: 1 });
    const app = buildApp();
    const res = await supertest(app).get('/api/public/resolve-portal?slug=green-valley');
    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/org-login', () => {
  test('400s when a required field is missing', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('404s "Portal not found" when the org does not exist at all', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'nope', email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(404);
  });

  test('404s the SAME shape when multiSchoolEnabled is false', async () => {
    mockOrgDocs.org_x = { id: 'org_x', slug: 'green-valley', multiSchoolEnabled: false };
    process.env.IDENTITY_CUTOVER_ENABLED = 'true';
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(404);
  });

  test('404s the SAME shape when IDENTITY_CUTOVER_ENABLED is not set, even with multiSchoolEnabled true', async () => {
    mockOrgDocs.org_x = { id: 'org_x', slug: 'green-valley', multiSchoolEnabled: true };
    // IDENTITY_CUTOVER_ENABLED deliberately left unset
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(404);
  });

  test('429s when the account is locked out', async () => {
    setupOptedInOrg();
    const SecurityService = require('../../services/securityService');
    SecurityService.checkAccountLock.mockResolvedValueOnce(120);
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(429);
  });

  test('LOAD-BEARING: no identity, a collision_pending identity, and a wrong password all produce the byte-identical response (no enumeration side-channel)', async () => {
    setupOptedInOrg();
    const app = buildApp();

    const noIdentityRes = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'nobody@x.com', password: 'x' });

    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'a@b.com', status: 'collision_pending', passwordHash: HASHED };
    const collisionRes = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'Secret123!' });

    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'a@b.com', status: 'active', passwordHash: HASHED };
    const wrongPwRes = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'WrongPassword!' });

    expect(noIdentityRes.status).toBe(401);
    expect(collisionRes.status).toBe(401);
    expect(wrongPwRes.status).toBe(401);
    expect(noIdentityRes.body).toEqual(collisionRes.body);
    expect(collisionRes.body).toEqual(wrongPwRes.body);
  });

  test('403s when the identity has no eligible school in this organization', async () => {
    setupOptedInOrg();
    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'a@b.com', status: 'active', passwordHash: HASHED };
    mockEligibleUserDocs = []; // no real account anywhere in this org
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'Secret123!' });
    expect(res.status).toBe(403);
  });

  test('exactly one eligible school, no MFA: mints a session directly and sets the cookie', async () => {
    setupOptedInOrg({ schoolCount: 1 });
    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'a@b.com', status: 'active', passwordHash: HASHED, mfaEnabled: false };
    mockEligibleUserDocs = [{ id: 'usr_a', schoolId: 'sch_a', identityId: 'idt_1', isActive: true }];
    mockTargetUserDocs['usr_a|sch_a'] = { _id: 'oid_a', id: 'usr_a', schoolId: 'sch_a', email: 'a@b.com', name: 'Jane', role: 'teacher', primaryRole: 'teacher', roles: ['teacher'], isActive: true };

    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'Secret123!' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('usr_a');
    expect(res.body.school.id).toBe('sch_a');
    const cookies = [].concat(res.headers['set-cookie'] || []);
    expect(cookies.find(c => c.startsWith('token='))).toBeDefined();
  });

  test('exactly one eligible school, MFA required: no cookie set, response mirrors /login\'s mfaRequired shape plus schoolSlug', async () => {
    setupOptedInOrg({ schoolCount: 1 });
    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'admin@b.com', status: 'active', passwordHash: HASHED, mfaEnabled: true };
    mockEligibleUserDocs = [{ id: 'usr_a', schoolId: 'sch_a', identityId: 'idt_1', isActive: true }];
    mockTargetUserDocs['usr_a|sch_a'] = { _id: 'oid_a', id: 'usr_a', schoolId: 'sch_a', email: 'admin@b.com', name: 'Admin', role: 'admin', primaryRole: 'admin', roles: ['admin'], isActive: true };

    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'admin@b.com', password: 'Secret123!' });

    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.schoolId).toBe('sch_a');
    expect(res.body.schoolSlug).toBe('gv-a');
    const cookies = [].concat(res.headers['set-cookie'] || []);
    expect(cookies.find(c => c.startsWith('token='))).toBeUndefined();
  });

  test('2+ eligible schools: returns a picker code and school list, mints nothing', async () => {
    setupOptedInOrg({ schoolCount: 2 });
    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'a@b.com', status: 'active', passwordHash: HASHED, mfaEnabled: false };
    mockEligibleUserDocs = [
      { id: 'usr_a', schoolId: 'sch_a', identityId: 'idt_1', isActive: true },
      { id: 'usr_b', schoolId: 'sch_b', identityId: 'idt_1', isActive: true },
    ];

    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'Secret123!' });

    expect(res.status).toBe(200);
    expect(typeof res.body.code).toBe('string');
    expect(res.body.schools.map(s => s.id).sort()).toEqual(['sch_a', 'sch_b']);
    const cookies = [].concat(res.headers['set-cookie'] || []);
    expect(cookies.find(c => c.startsWith('token='))).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════ */
describe('POST /api/auth/complete-org-login', () => {
  async function pickerCode(schoolIds) {
    setupOptedInOrg({ schoolCount: schoolIds.length });
    mockIdentityDoc = { id: 'idt_1', orgId: 'org_x', email: 'a@b.com', status: 'active', passwordHash: HASHED, mfaEnabled: false };
    mockEligibleUserDocs = schoolIds.map(sid => ({ id: `usr_${sid}`, schoolId: sid, identityId: 'idt_1', isActive: true }));
    schoolIds.forEach(sid => {
      mockTargetUserDocs[`usr_${sid}|${sid}`] = { _id: `oid_${sid}`, id: `usr_${sid}`, schoolId: sid, email: 'a@b.com', name: 'Jane', role: 'teacher', primaryRole: 'teacher', roles: ['teacher'], isActive: true };
    });
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/org-login').send({ orgSlug: 'green-valley', email: 'a@b.com', password: 'Secret123!' });
    return { app, code: res.body.code };
  }

  test('400s when code or schoolId is missing', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code: 'x' });
    expect(res.status).toBe(400);
  });

  test('400s on an unknown/expired code', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code: 'nonexistent', schoolId: 'sch_a' });
    expect(res.status).toBe(400);
  });

  test('LOAD-BEARING: 403s when schoolId is outside the locked allowedSchools set from org-login, even if that school exists elsewhere', async () => {
    const { app, code } = await pickerCode(['sch_a', 'sch_b']);
    // sch_c is a real school but was never in this identity's picker options.
    mockSchoolDocsById.sch_c = { id: 'sch_c', organizationId: 'org_x', slug: 'gv-c', name: 'Campus C' };
    mockTargetUserDocs['usr_c|sch_c'] = { _id: 'oid_c', id: 'usr_c', schoolId: 'sch_c', email: 'attacker@b.com', role: 'teacher', primaryRole: 'teacher', roles: ['teacher'], isActive: true };

    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_c' });
    expect(res.status).toBe(403);
  });

  test('LOAD-BEARING (adversarial): still 403s even when a real, active user doc happens to exist under the allowlist\'s OTHER school\'s userId at the requested out-of-set school — proves the allowlist check itself gates this, not just the fresh re-fetch', async () => {
    const { app, code } = await pickerCode(['sch_a', 'sch_b']);
    mockSchoolDocsById.sch_c = { id: 'sch_c', organizationId: 'org_x', slug: 'gv-c', name: 'Campus C' };
    // Deliberately reuses 'usr_sch_a' (the legitimate userId for sch_a in
    // this identity's OWN allowlist) at sch_c — a real, active, fetchable
    // doc, so the downstream fresh-refetch step alone would NOT reject
    // this. Only the allowlist membership check can.
    mockTargetUserDocs['usr_sch_a|sch_c'] = { _id: 'oid_c', id: 'usr_sch_a', schoolId: 'sch_c', email: 'someone-else@b.com', role: 'teacher', primaryRole: 'teacher', roles: ['teacher'], isActive: true };

    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_c' });
    expect(res.status).toBe(403);
  });

  test('LOAD-BEARING: TOCTOU — 403s when the target school has been re-parented to a different organization since the code was minted', async () => {
    const { app, code } = await pickerCode(['sch_a', 'sch_b']);
    // Simulate re-parenting: sch_a now belongs to a different org.
    mockSchoolDocsById.sch_a = { ...mockSchoolDocsById.sch_a, organizationId: 'org_y' };

    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_a' });
    expect(res.status).toBe(403);
  });

  test('the code is single-use — a second redemption attempt fails even with a valid schoolId', async () => {
    const { app, code } = await pickerCode(['sch_a', 'sch_b']);
    const first  = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_a' });
    const second = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_a' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });

  test('403s when the resolved user has been deactivated since org-login ran', async () => {
    const { app, code } = await pickerCode(['sch_a', 'sch_b']);
    mockTargetUserDocs['usr_sch_a|sch_a'] = { ...mockTargetUserDocs['usr_sch_a|sch_a'], isActive: false };
    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_a' });
    expect(res.status).toBe(403);
  });

  test('happy path: valid pick, no MFA — mints a session scoped to the chosen school', async () => {
    const { app, code } = await pickerCode(['sch_a', 'sch_b']);
    const res = await supertest(app).post('/api/auth/complete-org-login').send({ code, schoolId: 'sch_b' });

    expect(res.status).toBe(200);
    expect(res.body.school.id).toBe('sch_b');
    expect(res.body.user.id).toBe('usr_sch_b');
    const cookies = [].concat(res.headers['set-cookie'] || []);
    const tokenCookie = cookies.find(c => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
    const payload = verify(tokenCookie.split(';')[0].split('=')[1]);
    expect(payload.schoolId).toBe('sch_b');
    expect(payload.userId).toBe('usr_sch_b');
  });
});
