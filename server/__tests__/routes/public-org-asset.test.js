/* ============================================================
   GET /api/public/org-asset/:type — unit test with mocked DB.

   Serves an ORGANIZATION's logo/login-background as binary image
   bytes — the half of the upload feature that makes an uploaded image
   actually render in an <img src>, mirroring GET /api/public/school-
   asset/:type exactly, against the organizations collection instead of
   schools. Added alongside PUT /api/platform/organizations/:id/logo
   and .../login-bg (2026-09-28) — before this route existed, an org's
   branding could only ever be set once at creation, by hand, with no
   way to actually SEE it anywhere.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockOrgDoc = null;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'organizations') {
      return { findOne: jest.fn((filter) => ({ lean: () => Promise.resolve(mockOrgDoc?.id === filter.id ? mockOrgDoc : null) })) };
    }
    return { find: () => ({ lean: () => Promise.resolve([]) }) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use('/api/public', require('../../routes/public'));
  return a;
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeEach(() => {
  mockOrgDoc = null;
});

describe('GET /api/public/org-asset/:type', () => {
  test('400s for a type other than logo/login-bg', async () => {
    const res = await supertest(app()).get('/api/public/org-asset/favicon').query({ slug: 'org_tis' });
    expect(res.status).toBe(400);
  });

  test('400s when slug is missing', async () => {
    const res = await supertest(app()).get('/api/public/org-asset/logo');
    expect(res.status).toBe(400);
  });

  test('404s when the org has no logo set', async () => {
    mockOrgDoc = { id: 'org_tis' };
    const res = await supertest(app()).get('/api/public/org-asset/logo').query({ slug: 'org_tis' });
    expect(res.status).toBe(404);
  });

  test('404s for a slug that matches no organization at all', async () => {
    mockOrgDoc = { id: 'org_other', logoBase64: TINY_PNG };
    const res = await supertest(app()).get('/api/public/org-asset/logo').query({ slug: 'org_tis' });
    expect(res.status).toBe(404);
  });

  test('serves the logo as binary image bytes with the correct Content-Type', async () => {
    mockOrgDoc = { id: 'org_tis', logoBase64: TINY_PNG };
    const res = await supertest(app()).get('/api/public/org-asset/logo').query({ slug: 'org_tis' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('serves the login background from loginBgBase64, independent of logoBase64', async () => {
    mockOrgDoc = { id: 'org_tis', logoBase64: TINY_PNG, loginBgBase64: TINY_PNG.replace('image/png', 'image/webp') };
    const res = await supertest(app()).get('/api/public/org-asset/login-bg').query({ slug: 'org_tis' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });
});
