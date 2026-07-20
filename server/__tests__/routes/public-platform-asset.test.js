/* ============================================================
   GET /api/public/platform-asset/:type — unit test with mocked DB.

   Serves the platform's own logo/favicon as binary image bytes — the
   half of the upload feature that makes an uploaded logo actually
   render in an <img src>, mirroring the already-shipped
   GET /api/public/school-asset/:type exactly, minus the slug lookup
   (a single global platform_settings doc, not one per school).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockSettingsDoc = null;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'platform_settings') {
      return { findOne: jest.fn(() => ({ lean: () => Promise.resolve(mockSettingsDoc) })) };
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
  mockSettingsDoc = null;
});

describe('GET /api/public/platform-asset/:type', () => {
  test('400s for a type other than logo/favicon', async () => {
    const res = await supertest(app()).get('/api/public/platform-asset/login-bg');
    expect(res.status).toBe(400);
  });

  test('404s when no logo has been uploaded', async () => {
    mockSettingsDoc = { id: 'global' };
    const res = await supertest(app()).get('/api/public/platform-asset/logo');
    expect(res.status).toBe(404);
  });

  test('404s when the settings doc does not exist at all yet', async () => {
    mockSettingsDoc = null;
    const res = await supertest(app()).get('/api/public/platform-asset/favicon');
    expect(res.status).toBe(404);
  });

  test('serves the logo as binary image bytes with the correct Content-Type', async () => {
    mockSettingsDoc = { id: 'global', logoBase64: TINY_PNG };
    const res = await supertest(app()).get('/api/public/platform-asset/logo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('serves the favicon from faviconBase64, independent of logoBase64', async () => {
    mockSettingsDoc = { id: 'global', logoBase64: TINY_PNG, faviconBase64: TINY_PNG.replace('image/png', 'image/x-icon') };
    const res = await supertest(app()).get('/api/public/platform-asset/favicon');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/x-icon');
  });
});
