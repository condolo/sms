/* ============================================================
   GET /api/public/school-asset/:type — cache + ETag contract.

   Verifies the route uses the hardened cache: first request reads Mongo,
   repeated requests and If-None-Match do not, and an explicit invalidation
   makes a changed asset visible immediately.
   ============================================================ */
'use strict';

const toDataUri = (bytes, mime = 'image/png') => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

let mockSchoolDoc = { id: 'sch_asset_route', logoBase64: toDataUri('first-logo') };
const mockFindOne = jest.fn(() => ({
  select: () => ({ lean: async () => mockSchoolDoc }),
}));

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({ findOne: (...args) => mockFindOne(...args) })),
}));
jest.mock('../utils/email', () => ({
  sendContactEnquiry: jest.fn(),
  sendContactConfirmation: jest.fn(),
}));

const express = require('express');
const supertest = require('supertest');
const router = require('../routes/public');
const assetCache = require('../utils/school-asset-cache');

const app = express();
app.use('/api/public', router);
const URL = '/api/public/school-asset/logo?slug=sch_asset_route';

describe('public school asset route — cache and ETags', () => {
  beforeEach(() => {
    assetCache.invalidate('sch_asset_route');
    mockFindOne.mockClear();
    mockSchoolDoc = { id: 'sch_asset_route', logoBase64: toDataUri('first-logo') };
  });

  test('first request reads Mongo; cache hit and 304 do not', async () => {
    const first = await supertest(app).get(URL);
    expect(first.status).toBe(200);
    expect(first.body.toString()).toBe('first-logo');
    expect(first.headers.etag).toBeTruthy();
    expect(mockFindOne).toHaveBeenCalledTimes(1);

    const cached = await supertest(app).get(URL);
    expect(cached.status).toBe(200);
    expect(cached.body.toString()).toBe('first-logo');
    expect(mockFindOne).toHaveBeenCalledTimes(1);

    const revalidated = await supertest(app).get(URL).set('If-None-Match', first.headers.etag);
    expect(revalidated.status).toBe(304);
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  test('invalidation makes an uploaded asset visible immediately', async () => {
    const first = await supertest(app).get(URL);
    expect(first.body.toString()).toBe('first-logo');

    mockSchoolDoc = { id: 'sch_asset_route', logoBase64: toDataUri('second-logo') };
    assetCache.invalidate('sch_asset_route', 'logo');
    const changed = await supertest(app).get(URL);

    expect(changed.status).toBe(200);
    expect(changed.body.toString()).toBe('second-logo');
    expect(changed.headers.etag).not.toBe(first.headers.etag);
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });
});
