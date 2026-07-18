/* ============================================================
   GET /api/platform/organizations — unit test with mocked DB.

   Verifies the new organizations dashboard endpoint: schools are
   correctly grouped under their organization by organizationId,
   plan/status rollups are computed, and unlinked schools are counted
   separately rather than silently dropped.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

let mockOrgDocs = [];
let mockSchoolDocs = [];
let mockOrgCreateCalls = [];

// platform.js defines its OWN local _model(col) — a lazy schema-less
// mongoose.model() factory, not the shared utils/model._model — so the
// mock has to intercept mongoose.model() itself, keyed on the collection
// name (3rd arg), not utils/model.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    model: jest.fn((_name, _schema, col) => {
      if (col === 'organizations') {
        return {
          find:    () => ({ sort: () => ({ lean: () => Promise.resolve(mockOrgDocs) }) }),
          findOne: (filter) => ({ lean: () => Promise.resolve(mockOrgDocs.find(o => o.slug === filter.slug || o.id === filter.id) || null) }),
          create:  jest.fn((doc) => { mockOrgCreateCalls.push(doc); mockOrgDocs.push(doc); return Promise.resolve(doc); }),
        };
      }
      if (col === 'schools') {
        return { find: () => ({ select: () => ({ lean: () => Promise.resolve(mockSchoolDocs) }) }) };
      }
      return { find: () => ({ lean: () => Promise.resolve([]) }) };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOrgDocs = [];
  mockSchoolDocs = [];
  mockOrgCreateCalls = [];
});

describe('GET /api/platform/organizations', () => {
  test('groups schools under their organization and rolls up plan/status stats', async () => {
    mockOrgDocs = [
      { id: 'org_a', name: 'Green Valley Schools', slug: 'green-valley', status: 'active', multiSchoolEnabled: true, createdAt: '2026-01-01' },
      { id: 'org_b', name: 'St Marys', slug: 'st-marys', status: 'active', multiSchoolEnabled: false, createdAt: '2026-02-01' },
    ];
    mockSchoolDocs = [
      { id: 'sch_a1', organizationId: 'org_a', name: 'Green Valley Nairobi', plan: 'student', isActive: true, status: 'active' },
      { id: 'sch_a2', organizationId: 'org_a', name: 'Green Valley Eldoret', plan: 'family', isActive: true, status: 'active' },
      { id: 'sch_b1', organizationId: 'org_b', name: 'St Marys Academy', plan: 'base', isActive: false, status: 'active' },
    ];

    const res = await supertest(app()).get('/api/platform/organizations');

    expect(res.status).toBe(200);
    expect(res.body.organizations).toHaveLength(2);

    const orgA = res.body.organizations.find(o => o.id === 'org_a');
    expect(orgA._stats.schoolCount).toBe(2);
    expect(orgA._stats.activeCount).toBe(2);
    expect(orgA._stats.byPlan).toEqual({ student: 1, family: 1 });
    expect(orgA.schools.map(s => s.name).sort()).toEqual(['Green Valley Eldoret', 'Green Valley Nairobi']);

    const orgB = res.body.organizations.find(o => o.id === 'org_b');
    expect(orgB._stats.schoolCount).toBe(1);
    expect(orgB._stats.activeCount).toBe(0); // inactive school

    expect(res.body.unlinkedSchools).toBe(0);
  });

  test('counts schools with no organizationId as unlinked, without crashing', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', status: 'active', createdAt: '2026-01-01' }];
    mockSchoolDocs = [
      { id: 'sch_1', organizationId: 'org_a', name: 'Linked School', plan: 'base', isActive: true },
      { id: 'sch_2', organizationId: null, name: 'Orphaned School', plan: 'base', isActive: true },
      { id: 'sch_3', name: 'No FK At All', plan: 'base', isActive: true },
    ];

    const res = await supertest(app()).get('/api/platform/organizations');

    expect(res.status).toBe(200);
    expect(res.body.unlinkedSchools).toBe(2);
    expect(res.body.organizations[0]._stats.schoolCount).toBe(1);
  });

  test('an organization with zero linked schools still renders (empty schools array, not a crash)', async () => {
    mockOrgDocs = [{ id: 'org_empty', name: 'Empty Org', slug: 'empty', status: 'active', createdAt: '2026-01-01' }];
    mockSchoolDocs = [];

    const res = await supertest(app()).get('/api/platform/organizations');

    expect(res.status).toBe(200);
    expect(res.body.organizations[0].schools).toEqual([]);
    expect(res.body.organizations[0]._stats).toEqual({ schoolCount: 0, activeCount: 0, byPlan: {} });
  });

  test('returns an empty list, not an error, when there are no organizations', async () => {
    mockOrgDocs = [];
    mockSchoolDocs = [];

    const res = await supertest(app()).get('/api/platform/organizations');

    expect(res.status).toBe(200);
    expect(res.body.organizations).toEqual([]);
    expect(res.body.unlinkedSchools).toBe(0);
  });
});

describe('POST /api/platform/organizations', () => {
  test('creates an organization with a sanitised slug and multiSchoolEnabled always false', async () => {
    const res = await supertest(app())
      .post('/api/platform/organizations')
      .send({ name: 'Green Valley Schools', slug: 'Green Valley!!' });

    expect(res.status).toBe(201);
    expect(res.body.organization).toMatchObject({
      name: 'Green Valley Schools',
      slug: 'green-valley',
      status: 'active',
      multiSchoolEnabled: false,
    });
    expect(mockOrgCreateCalls).toHaveLength(1);
  });

  test('auto-derives the slug from the name when no slug is given', async () => {
    const res = await supertest(app())
      .post('/api/platform/organizations')
      .send({ name: 'St Mary\'s Academy' });

    expect(res.status).toBe(201);
    expect(res.body.organization.slug).toBe('st-marys-academy');
  });

  test('rejects a missing name', async () => {
    const res = await supertest(app()).post('/api/platform/organizations').send({ slug: 'no-name' });
    expect(res.status).toBe(400);
    expect(mockOrgCreateCalls).toHaveLength(0);
  });

  test('rejects a slug already taken by another organization', async () => {
    mockOrgDocs = [{ id: 'org_existing', name: 'Existing', slug: 'green-valley', status: 'active' }];

    const res = await supertest(app())
      .post('/api/platform/organizations')
      .send({ name: 'Green Valley Again', slug: 'green-valley' });

    expect(res.status).toBe(409);
    expect(mockOrgCreateCalls).toHaveLength(0);
  });

  // multiSchoolEnabled is deliberately not accepted from the request body —
  // per Constitution §10 Stage 3 it specifically means "auth begins reading
  // Memberships", which isn't built yet (gated behind D-001). This route
  // must never let a caller set it true.
  test('ignores an attempt to set multiSchoolEnabled via the request body', async () => {
    const res = await supertest(app())
      .post('/api/platform/organizations')
      .send({ name: 'Sneaky Org', multiSchoolEnabled: true });

    expect(res.status).toBe(201);
    expect(res.body.organization.multiSchoolEnabled).toBe(false);
  });
});

describe('_deriveSlugForOrg (school slug namespacing under an organization, school first)', () => {
  const { _deriveSlugForOrg } = require('../../routes/platform');

  test('suffixes a plain campus slug with the organization slug', () => {
    expect(_deriveSlugForOrg('green-valley', 'eldoret')).toBe('eldoret-green-valley');
  });

  test('does not double-suffix a slug the admin already typed with the org suffix', () => {
    expect(_deriveSlugForOrg('green-valley', 'eldoret-green-valley')).toBe('eldoret-green-valley');
  });

  test('sanitises the raw slug before suffixing (spaces, punctuation, case)', () => {
    expect(_deriveSlugForOrg('green-valley', 'Eldoret Campus!!')).toBe('eldoret-campus-green-valley');
  });

  test('returns just the sanitised slug when the organization has no slug', () => {
    expect(_deriveSlugForOrg(null, 'Eldoret')).toBe('eldoret');
    expect(_deriveSlugForOrg('', 'Eldoret')).toBe('eldoret');
  });

  test('caps the result at 60 characters, truncating the school part and preserving the org suffix intact', () => {
    const long = 'a'.repeat(80);
    const result = _deriveSlugForOrg('org', long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('-org')).toBe(true);
  });
});
