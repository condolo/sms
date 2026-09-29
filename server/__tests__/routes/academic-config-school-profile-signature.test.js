/* ============================================================
   server/routes/academic-config.js — PATCH /school-profile's
   principalSignatureUrl/schoolStampUrl validation (2026-09-29)

   These two fields had no upload UI anywhere in the app (confirmed by
   an exam-to-report-card audit) despite report-cards.js's PDF renderer
   already drawing them in — this adds the missing Settings UI and,
   here, the server-side validation that UI relies on: a real image
   data URI, size-capped, or null to clear. The route previously
   accepted ANY string for these two fields with no validation at all.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_ID = 'sch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { schoolId: SCHOOL_ID, userId: 'u1', role: 'admin' }; next(); },
}));

let mockSchoolDoc;
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(mockSchoolDoc) }),
    findOneAndUpdate: jest.fn((_filter, update) => {
      mockSchoolDoc = { ...mockSchoolDoc, ...update.$set };
      return { lean: () => Promise.resolve(mockSchoolDoc) };
    }),
  })),
}));

const express = require('express');
const supertest = require('supertest');
const academicConfigRouter = require('../../routes/academic-config');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/academic-config', academicConfigRouter);
  return app;
}

// A tiny valid 1x1 PNG, well under any size cap.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeEach(() => {
  mockSchoolDoc = { id: SCHOOL_ID, schoolId: SCHOOL_ID, name: 'Test School' };
});

describe('PATCH /api/academic-config/school-profile — signature/stamp validation', () => {
  test('accepts a valid image data URI for principalSignatureUrl', async () => {
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ principalSignatureUrl: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.data.principalSignatureUrl).toBe(TINY_PNG);
  });

  test('accepts a valid image data URI for schoolStampUrl', async () => {
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ schoolStampUrl: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.data.schoolStampUrl).toBe(TINY_PNG);
  });

  test('null clears an existing signature', async () => {
    mockSchoolDoc.principalSignatureUrl = TINY_PNG;
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ principalSignatureUrl: null });
    expect(res.status).toBe(200);
    expect(res.body.data.principalSignatureUrl).toBeNull();
  });

  test('rejects a non-image string', async () => {
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ principalSignatureUrl: 'not-an-image' });
    expect(res.status).toBe(400);
  });

  test('rejects a non-data: URL (e.g. an http link) — _fetchImageBuf can\'t use a relative/absolute URL reliably here', async () => {
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ schoolStampUrl: 'https://example.com/stamp.png' });
    expect(res.status).toBe(400);
  });

  test('rejects an oversized image', async () => {
    const bigData = 'A'.repeat(200 * 1024); // ~200KB of base64 chars, over the 100KB cap
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ schoolStampUrl: `data:image/png;base64,${bigData}` });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too large/i);
  });

  test('rejects an unsupported image format (svg, gif)', async () => {
    const res = await supertest(buildApp())
      .patch('/api/academic-config/school-profile')
      .send({ principalSignatureUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    expect(res.status).toBe(400);
  });

  test('a non-admin role is rejected before any validation runs', async () => {
    const app = express();
    app.use(express.json());
    // Re-require with a non-admin jwtUser for this one test
    jest.resetModules();
    jest.doMock('../../middleware/auth', () => ({
      authMiddleware: (req, _res, next) => { req.jwtUser = { schoolId: SCHOOL_ID, userId: 'u2', role: 'teacher' }; next(); },
    }));
    const freshRouter = require('../../routes/academic-config');
    app.use('/api/academic-config', freshRouter);
    const res = await supertest(app)
      .patch('/api/academic-config/school-profile')
      .send({ principalSignatureUrl: TINY_PNG });
    expect(res.status).toBe(403);
  });
});
