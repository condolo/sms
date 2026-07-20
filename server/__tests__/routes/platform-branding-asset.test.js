/* ============================================================
   Platform branding asset upload — unit tests with mocked DB.

   Covers PUT/DELETE /api/platform/settings/logo and .../favicon —
   direct file upload replacing the old plain-URL text fields, which
   only ever accepted a real direct image URL (a pasted Google Drive
   "file" share link is an HTML viewer page, never raw image bytes,
   so it silently rendered nothing). Mirrors the already-shipped
   school-side PUT /api/settings/school/logo pattern exactly: base64
   validated and stored directly on the platform_settings doc, served
   back via a public binary-serving GET route
   (see public-platform-asset.test.js for that half).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({
  provisionOrganizationForSchool: jest.fn(),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

let mockSettingsDoc = null;
const mockUpdateOne = jest.fn((filter, update) => {
  mockSettingsDoc = { ...(mockSettingsDoc || {}), ...(update.$set || {}) };
  if (update.$unset) Object.keys(update.$unset).forEach(k => delete mockSettingsDoc[k]);
  return Promise.resolve({});
});

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    model: jest.fn((_name, _schema, col) => {
      if (col === 'platform_settings') {
        return { updateOne: mockUpdateOne };
      }
      return { find: () => ({ lean: () => Promise.resolve([]) }) };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json({ limit: '2mb' }));
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

// A tiny valid 1x1 PNG, base64-encoded — real image bytes, not just a
// plausible-looking string, so the mime-sniffing in the GET route (tested
// separately) has something genuine to parse.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeEach(() => {
  jest.clearAllMocks();
  mockSettingsDoc = null;
});

describe('PUT /api/platform/settings/logo', () => {
  test('400s when logoBase64 is missing', async () => {
    const res = await supertest(app()).put('/api/platform/settings/logo').send({});
    expect(res.status).toBe(400);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('400s for a non-image data URL (e.g. a pasted Google Drive link, or any non-base64-image string)', async () => {
    const res = await supertest(app()).put('/api/platform/settings/logo').send({ logoBase64: 'https://drive.google.com/file/d/xyz/view' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid image/i);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('400s when the image exceeds the 500KB cap', async () => {
    const bigData = 'A'.repeat(700 * 1024); // base64 chars, well past 500KB decoded
    const res = await supertest(app()).put('/api/platform/settings/logo').send({ logoBase64: `data:image/png;base64,${bigData}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  test('accepts a valid image, stores it, and returns the public asset URL', async () => {
    const res = await supertest(app()).put('/api/platform/settings/logo').send({ logoBase64: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('/api/public/platform-asset/logo');
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { id: 'global' },
      expect.objectContaining({ $set: expect.objectContaining({ logoBase64: TINY_PNG, logoUrl: '/api/public/platform-asset/logo' }) }),
      { upsert: true }
    );
  });
});

describe('DELETE /api/platform/settings/logo', () => {
  test('clears logoUrl/logoBase64', async () => {
    const res = await supertest(app()).delete('/api/platform/settings/logo');
    expect(res.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { id: 'global' },
      expect.objectContaining({ $set: expect.objectContaining({ logoUrl: null }), $unset: { logoBase64: '' } }),
      { upsert: true }
    );
  });
});

describe('PUT /api/platform/settings/favicon', () => {
  test('400s when faviconBase64 is missing', async () => {
    const res = await supertest(app()).put('/api/platform/settings/favicon').send({});
    expect(res.status).toBe(400);
  });

  test('400s when the image exceeds the 100KB cap (tighter than logo)', async () => {
    const bigData = 'A'.repeat(150 * 1024);
    const res = await supertest(app()).put('/api/platform/settings/favicon').send({ faviconBase64: `data:image/png;base64,${bigData}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  test('accepts a valid image, stores it, and returns the public asset URL', async () => {
    const res = await supertest(app()).put('/api/platform/settings/favicon').send({ faviconBase64: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.faviconUrl).toBe('/api/public/platform-asset/favicon');
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { id: 'global' },
      expect.objectContaining({ $set: expect.objectContaining({ faviconBase64: TINY_PNG, faviconUrl: '/api/public/platform-asset/favicon' }) }),
      { upsert: true }
    );
  });
});

describe('DELETE /api/platform/settings/favicon', () => {
  test('clears faviconUrl/faviconBase64', async () => {
    const res = await supertest(app()).delete('/api/platform/settings/favicon');
    expect(res.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { id: 'global' },
      expect.objectContaining({ $set: expect.objectContaining({ faviconUrl: null }), $unset: { faviconBase64: '' } }),
      { upsert: true }
    );
  });
});
