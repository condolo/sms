/* ============================================================
   GET /api/public/schools/search — unit test with mocked DB.

   Verifies the school-finder search (used on the public login page)
   matches on the school's own name/shortName/slug AND on its
   organization's name/slug — so searching an organization's name
   surfaces every campus under it, not just a school whose own name
   happens to match. Results are grouped by organization (2026-07-20
   restructure): every school belongs to exactly one organization, so
   resolving to organizations is universal, not a special case for
   multi-school customers. See server/routes/public.js's handler
   comment for the three result types this covers.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockSchoolDocs = [];
let mockOrgDocs = [];

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return {
        find: jest.fn((filter) => ({
          select: () => ({
            limit: () => ({
              lean: () => Promise.resolve(mockSchoolDocs.filter(s => mockMatchesSchoolFilter(s, filter))),
            }),
          }),
        })),
        countDocuments: jest.fn((filter) =>
          Promise.resolve(mockSchoolDocs.filter(s => s.organizationId === filter.organizationId).length)
        ),
      };
    }
    if (collection === 'organizations') {
      return {
        find: jest.fn((filter) => ({
          select: () => ({
            limit: () => ({ lean: () => Promise.resolve(mockOrgDocs.filter(o => mockMatchesOrgFilter(o, filter))) }),
            lean:  () => Promise.resolve(mockOrgDocs.filter(o => mockMatchesOrgFilter(o, filter))),
          }),
        })),
      };
    }
    return { find: () => ({ lean: () => Promise.resolve([]) }) };
  }),
}));

/* Minimal filter emulation — enough for this route's actual query shapes */
function mockMatchesSchoolFilter(s, filter) {
  if (s.isActive === false && filter.isActive) return false;
  const orClauses = filter.$or || [];
  return orClauses.some(clause => {
    if (clause.name) return clause.name.test(s.name || '');
    if (clause.shortName) return clause.shortName.test(s.shortName || '');
    if (clause.slug) return clause.slug.test(s.slug || '');
    if (clause.organizationId) return (clause.organizationId.$in || []).includes(s.organizationId);
    return false;
  });
}
function mockMatchesOrgFilter(o, filter) {
  if (filter.id) return (filter.id.$in || []).includes(o.id);
  const orClauses = filter.$or || [];
  return orClauses.some(clause => {
    if (clause.name) return clause.name.test(o.name || '');
    if (clause.slug) return clause.slug.test(o.slug || '');
    return false;
  });
}

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use('/api/public', require('../../routes/public'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDocs = [];
  mockOrgDocs = [];
});

describe('GET /api/public/schools/search', () => {
  test('matches a school by its own name — plain school result, no org', async () => {
    mockSchoolDocs = [{ slug: 'greenwood', name: 'Greenwood Academy', isActive: true }];

    const res = await supertest(app()).get('/api/public/schools/search?q=greenwood');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ type: 'school', slug: 'greenwood' });
  });

  test('a 1:1-genesis org (one school) still returns a plain school result, not a group', async () => {
    mockOrgDocs = [{ id: 'org_solo', name: 'Solo Academy', slug: 'solo', multiSchoolEnabled: false }];
    mockSchoolDocs = [{ slug: 'solo', name: 'Solo Academy', isActive: true, organizationId: 'org_solo' }];

    const res = await supertest(app()).get('/api/public/schools/search?q=solo');

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].type).toBe('school');
  });

  test('a real multi-school org with multiSchoolEnabled OFF groups its matching schools without promising a live portal', async () => {
    // The exact Trinity/Trinitas scenario this restructure was triggered by.
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis', multiSchoolEnabled: false }];
    mockSchoolDocs = [
      { slug: 'trinitas-tis', name: 'Trinitas International School', isActive: true, organizationId: 'org_trinity' },
      { slug: 'trinity-tis',  name: 'Trinity International School',  isActive: true, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=tis');

    expect(res.body.results).toHaveLength(1); // ONE grouped entry, not two confusing near-duplicates
    const group = res.body.results[0];
    expect(group.type).toBe('organization-group');
    expect(group.orgSlug).toBe('tis');
    expect(group.schools.map(s => s.slug).sort()).toEqual(['trinitas-tis', 'trinity-tis']);
  });

  test('the SAME org with multiSchoolEnabled ON collapses to a single portal-navigable entry instead', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis', multiSchoolEnabled: true }];
    mockSchoolDocs = [
      { slug: 'trinitas-tis', name: 'Trinitas International School', isActive: true, organizationId: 'org_trinity' },
      { slug: 'trinity-tis',  name: 'Trinity International School',  isActive: true, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=tis');

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ type: 'organization', slug: 'tis', name: 'Trinity-Trinitas Schools' });
  });

  test('matches every school under an organization when the query matches the ORG name, not any school name', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis', multiSchoolEnabled: false }];
    mockSchoolDocs = [
      { slug: 'nairobi-tis', name: 'Trinitas Nairobi', isActive: true, organizationId: 'org_trinity' },
      { slug: 'eldoret-tis', name: 'Trinitas Eldoret', isActive: true, organizationId: 'org_trinity' },
      { slug: 'unrelated', name: 'Some Other School', isActive: true, organizationId: 'org_other' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=Trinity-Trinitas');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].schools.map(s => s.slug).sort()).toEqual(['eldoret-tis', 'nairobi-tis']);
  });

  test('matches by the organization slug too (e.g. a short code)', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis', multiSchoolEnabled: false }];
    mockSchoolDocs = [
      { slug: 'nairobi-tis', name: 'Trinitas Nairobi', isActive: true, organizationId: 'org_trinity' },
      { slug: 'eldoret-tis', name: 'Trinitas Eldoret', isActive: true, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=tis');

    expect(res.status).toBe(200);
    expect(res.body.results[0].type).toBe('organization-group');
    expect(res.body.results[0].schools.map(s => s.slug).sort()).toEqual(['eldoret-tis', 'nairobi-tis']);
  });

  test('a school with no organizationId returns a plain school result, not a crash', async () => {
    mockSchoolDocs = [{ slug: 'orphan', name: 'Orphan School', isActive: true }];

    const res = await supertest(app()).get('/api/public/schools/search?q=orphan');

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ type: 'school', slug: 'orphan' });
  });

  test('inactive schools are excluded even if their org matches', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis', multiSchoolEnabled: false }];
    mockSchoolDocs = [
      { slug: 'closed-tis', name: 'Trinitas Closed Campus', isActive: false, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=Trinity-Trinitas');

    expect(res.body.results).toEqual([]);
  });

  test('returns an empty list for a query shorter than 2 characters', async () => {
    const res = await supertest(app()).get('/api/public/schools/search?q=a');
    expect(res.body.results).toEqual([]);
  });
});
