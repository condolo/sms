/* ============================================================
   Organization branding — self-service edit (2026-09-28)

   Before this, an organization's logoUrl/primaryColor/tagline could
   only ever be set ONCE, at creation time (POST /organizations), by
   hand — there was no PATCH support for the branding fields and no
   upload route at all for a logo or login background image. Requested
   directly: "is there an option where I can configure these by myself,
   edit the color and upload or update the logos and images as
   required?" This closes that gap:
   - PATCH /organizations/:id now also accepts primaryColor + tagline
     (name stays required, unchanged contract; slug still never accepted)
   - PUT/DELETE /organizations/:id/logo and .../login-bg mirror
     settings.js's school-branding upload routes exactly (base64 image,
     validated, stored on the document, served back through a public
     no-auth route — see public-org-asset.test.js for that half)

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => { req.platformOperatorTier = 'owner'; next(); },
  requireOwnerTier: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

let mockOrgDoc = null;

// The real PATCH/PUT/DELETE routes under test all resolve their model via
// _model('organizations') (utils/model.js), not raw mongoose.model() — so
// only this needs mocking. (Other platform.js routes not touched by these
// tests, like POST /organizations, use mongoose.model() directly instead;
// that path isn't exercised here.)
jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col !== 'organizations') return { find: () => ({ lean: () => Promise.resolve([]) }) };
    return {
      findOne: (filter) => ({
        lean: () => Promise.resolve(mockOrgDoc && mockOrgDoc.id === filter.id ? { ...mockOrgDoc } : null),
      }),
      findOneAndUpdate: (filter, update) => ({
        lean: () => {
          if (!mockOrgDoc || mockOrgDoc.id !== filter.id) return Promise.resolve(null);
          if (update.$set) Object.assign(mockOrgDoc, update.$set);
          return Promise.resolve({ ...mockOrgDoc });
        },
      }),
      updateOne: jest.fn((filter, update) => {
        if (!mockOrgDoc || mockOrgDoc.id !== filter.id) return Promise.resolve({ matchedCount: 0 });
        if (update.$set) Object.assign(mockOrgDoc, update.$set);
        if (update.$unset) for (const k of Object.keys(update.$unset)) delete mockOrgDoc[k];
        return Promise.resolve({ matchedCount: 1 });
      }),
    };
  }),
}));

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json({ limit: '10mb' })); // matches server/index.js's real limit
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeEach(() => {
  jest.clearAllMocks();
  mockOrgDoc = { id: 'org_tis', name: 'TIS Group of Schools', slug: 'tis' };
});

describe('PATCH /api/platform/organizations/:id — branding fields', () => {
  test('accepts a valid hex primaryColor alongside name', async () => {
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ name: 'TIS Group of Schools', primaryColor: '#059669' });
    expect(res.status).toBe(200);
    expect(res.body.organization.primaryColor).toBe('#059669');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.organization_updated' }));
  });

  test('rejects a malformed primaryColor', async () => {
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ name: 'TIS Group of Schools', primaryColor: 'emerald-green' });
    expect(res.status).toBe(400);
    expect(mockOrgDoc.primaryColor).toBeUndefined();
  });

  test('an empty-string primaryColor clears it back to null', async () => {
    mockOrgDoc.primaryColor = '#4f46e5';
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ name: 'TIS Group of Schools', primaryColor: '' });
    expect(res.status).toBe(200);
    expect(res.body.organization.primaryColor).toBeNull();
  });

  test('accepts and trims a tagline', async () => {
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ name: 'TIS Group of Schools', tagline: '  Excellence Across Every Campus  ' });
    expect(res.status).toBe(200);
    expect(res.body.organization.tagline).toBe('Excellence Across Every Campus');
  });

  test('rejects a tagline over 200 characters', async () => {
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ name: 'TIS Group of Schools', tagline: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  test('name is still required, unchanged', async () => {
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ primaryColor: '#059669' });
    expect(res.status).toBe(400);
  });

  test('omitting primaryColor/tagline entirely leaves them untouched', async () => {
    mockOrgDoc.primaryColor = '#4f46e5';
    mockOrgDoc.tagline = 'Existing tagline';
    const res = await supertest(app())
      .patch('/api/platform/organizations/org_tis')
      .send({ name: 'Renamed Only' });
    expect(res.status).toBe(200);
    expect(res.body.organization.primaryColor).toBe('#4f46e5');
    expect(res.body.organization.tagline).toBe('Existing tagline');
  });
});

describe('PUT/DELETE /api/platform/organizations/:id/logo', () => {
  test('uploads a valid logo and sets a resolvable logoUrl', async () => {
    const res = await supertest(app())
      .put('/api/platform/organizations/org_tis/logo')
      .send({ logoBase64: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('/api/public/org-asset/logo?slug=org_tis');
    expect(mockOrgDoc.logoBase64).toBe(TINY_PNG);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.organization_branding_updated' }));
  });

  test('rejects a non-image data URL', async () => {
    const res = await supertest(app())
      .put('/api/platform/organizations/org_tis/logo')
      .send({ logoBase64: 'data:text/plain;base64,aGVsbG8=' });
    expect(res.status).toBe(400);
  });

  test('rejects an oversized logo (>500KB)', async () => {
    const bigData = 'A'.repeat(700 * 1024); // base64 chars; well past the 500KB decoded ceiling
    const res = await supertest(app())
      .put('/api/platform/organizations/org_tis/logo')
      .send({ logoBase64: `data:image/png;base64,${bigData}` });
    expect(res.status).toBe(400);
  });

  test('404s for a nonexistent organization', async () => {
    const res = await supertest(app())
      .put('/api/platform/organizations/does-not-exist/logo')
      .send({ logoBase64: TINY_PNG });
    expect(res.status).toBe(404);
  });

  test('DELETE clears logoBase64 and logoUrl', async () => {
    mockOrgDoc.logoBase64 = TINY_PNG;
    mockOrgDoc.logoUrl = '/api/public/org-asset/logo?slug=org_tis';
    const res = await supertest(app()).delete('/api/platform/organizations/org_tis/logo');
    expect(res.status).toBe(200);
    expect(mockOrgDoc.logoBase64).toBeUndefined();
    expect(mockOrgDoc.logoUrl).toBeUndefined();
  });
});

describe('PUT/DELETE /api/platform/organizations/:id/login-bg', () => {
  test('uploads a valid login background and sets a resolvable loginBgUrl', async () => {
    const res = await supertest(app())
      .put('/api/platform/organizations/org_tis/login-bg')
      .send({ loginBgBase64: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.loginBgUrl).toBe('/api/public/org-asset/login-bg?slug=org_tis');
    expect(mockOrgDoc.loginBgBase64).toBe(TINY_PNG);
  });

  test('rejects an oversized login background (>2MB)', async () => {
    const bigData = 'A'.repeat(3000 * 1024); // decodes to ~2.15MB, past the 2048KB ceiling
    const res = await supertest(app())
      .put('/api/platform/organizations/org_tis/login-bg')
      .send({ loginBgBase64: `data:image/png;base64,${bigData}` });
    expect(res.status).toBe(400);
  });

  test('DELETE clears loginBgBase64 and loginBgUrl', async () => {
    mockOrgDoc.loginBgBase64 = TINY_PNG;
    mockOrgDoc.loginBgUrl = '/api/public/org-asset/login-bg?slug=org_tis';
    const res = await supertest(app()).delete('/api/platform/organizations/org_tis/login-bg');
    expect(res.status).toBe(200);
    expect(mockOrgDoc.loginBgBase64).toBeUndefined();
    expect(mockOrgDoc.loginBgUrl).toBeUndefined();
  });

  test('404s for a nonexistent organization', async () => {
    const res = await supertest(app())
      .put('/api/platform/organizations/does-not-exist/login-bg')
      .send({ loginBgBase64: TINY_PNG });
    expect(res.status).toBe(404);
  });
});
