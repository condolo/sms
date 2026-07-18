/* ============================================================
   GET /api/public/schools/search — unit test with mocked DB.

   Verifies the school-finder search (used on the public login page)
   matches on the school's own name/shortName/slug AND on its
   organization's name/slug — so searching an organization's name
   surfaces every campus under it, not just a school whose own name
   happens to match. Also verifies organizationName is only surfaced
   when it adds information (auto-created 1:1 orgs share the school's
   own name and shouldn't be shown redundantly by the frontend, but
   the backend always returns it — that filtering is a frontend
   concern, tested here only at the data level).

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
  test('matches a school by its own name', async () => {
    mockSchoolDocs = [{ slug: 'greenwood', name: 'Greenwood Academy', isActive: true }];

    const res = await supertest(app()).get('/api/public/schools/search?q=greenwood');

    expect(res.status).toBe(200);
    expect(res.body.schools).toHaveLength(1);
    expect(res.body.schools[0].slug).toBe('greenwood');
  });

  test('matches every school under an organization when the query matches the ORG name, not any school name', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis' }];
    mockSchoolDocs = [
      { slug: 'nairobi-tis', name: 'Trinitas Nairobi', isActive: true, organizationId: 'org_trinity' },
      { slug: 'eldoret-tis', name: 'Trinitas Eldoret', isActive: true, organizationId: 'org_trinity' },
      { slug: 'unrelated', name: 'Some Other School', isActive: true, organizationId: 'org_other' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=Trinity-Trinitas');

    expect(res.status).toBe(200);
    const slugs = res.body.schools.map(s => s.slug).sort();
    expect(slugs).toEqual(['eldoret-tis', 'nairobi-tis']);
  });

  test('matches by the organization slug too (e.g. a short code)', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis' }];
    mockSchoolDocs = [
      { slug: 'nairobi-tis', name: 'Trinitas Nairobi', isActive: true, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=tis');

    expect(res.status).toBe(200);
    expect(res.body.schools.map(s => s.slug)).toEqual(['nairobi-tis']);
  });

  test('every result carries its organization name for display', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis' }];
    mockSchoolDocs = [
      { slug: 'nairobi-tis', name: 'Trinitas Nairobi', isActive: true, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=nairobi');

    expect(res.body.schools[0].organizationName).toBe('Trinity-Trinitas Schools');
  });

  test('a school with no organizationId returns organizationName: null, not a crash', async () => {
    mockSchoolDocs = [{ slug: 'orphan', name: 'Orphan School', isActive: true }];

    const res = await supertest(app()).get('/api/public/schools/search?q=orphan');

    expect(res.status).toBe(200);
    expect(res.body.schools[0].organizationName).toBeNull();
  });

  test('inactive schools are excluded even if their org matches', async () => {
    mockOrgDocs = [{ id: 'org_trinity', name: 'Trinity-Trinitas Schools', slug: 'tis' }];
    mockSchoolDocs = [
      { slug: 'closed-tis', name: 'Trinitas Closed Campus', isActive: false, organizationId: 'org_trinity' },
    ];

    const res = await supertest(app()).get('/api/public/schools/search?q=Trinity-Trinitas');

    expect(res.body.schools).toEqual([]);
  });

  test('returns an empty list for a query shorter than 2 characters', async () => {
    const res = await supertest(app()).get('/api/public/schools/search?q=a');
    expect(res.body.schools).toEqual([]);
  });
});
