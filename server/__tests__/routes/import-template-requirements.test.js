/* ============================================================
   GET /api/import-export/template/students — dynamic requirement notes
   (2026-09-07)

   Found while auditing the per-school Admission Requirements feature
   for assumptions it might have missed: the downloadable student CSV
   template's "#"-comment notes said "dateOfBirth, gender — REQUIRED"
   and "at least ONE parent ... REQUIRED" unconditionally — text baked
   into a static TEMPLATES object, blind to the very Settings toggle
   this feature just introduced. A school that turned one off would
   download a template flatly contradicting what the importer actually
   enforces for them.

   Covers: the template now reports THIS school's real, resolved
   settings, in both directions (required and not required), and a
   school that never touched the setting still sees the original,
   fully-required message.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';
let mockJwtUser;
let mockSchoolDoc;

function mockChain(result) { return { select: () => mockChain(result), lean: () => Promise.resolve(result) }; }
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return { findOne: () => mockChain(mockSchoolDoc) };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const importExportRouter = require('../../routes/import-export');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockSchoolDoc = { id: SCHOOL, admissionConfig: {} };
});

describe('GET /api/import-export/template/students — per-school requirement notes', () => {
  test('a school that has never touched the setting sees the original, fully-required message', async () => {
    const res = await supertest(buildApp()).get('/api/import-export/template/students');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Your school currently REQUIRES:.*Date of Birth.*Gender.*at least one parent named.*a named parent's email/);
    expect(res.text).not.toMatch(/does NOT require/);
  });

  test('a school with dateOfBirth turned off sees it listed under "does NOT require"', async () => {
    mockSchoolDoc = { id: SCHOOL, admissionConfig: { requiredFields: { dateOfBirth: false } } };
    const res = await supertest(buildApp()).get('/api/import-export/template/students');
    expect(res.text).toMatch(/does NOT require: Date of Birth/);
    expect(res.text).toMatch(/REQUIRES:.*Gender/);
  });

  test('a school with everything turned off sees "none of these" required', async () => {
    mockSchoolDoc = {
      id: SCHOOL,
      admissionConfig: { requiredFields: { dateOfBirth: false, gender: false, guardianRequired: false, guardianEmailRequired: false } },
    };
    const res = await supertest(buildApp()).get('/api/import-export/template/students');
    expect(res.text).toMatch(/REQUIRES: none of these/);
    expect(res.text).toMatch(/does NOT require:.*Date of Birth.*Gender/);
  });

  test('the placeholder marker never leaks into the downloaded file', async () => {
    const res = await supertest(buildApp()).get('/api/import-export/template/students');
    expect(res.text).not.toMatch(/REQUIREMENT_NOTES_PLACEHOLDER/);
  });

  test('other template types (unaffected) are returned unchanged, no school lookup needed', async () => {
    mockSchoolDoc = undefined; // would break if teachers template tried to read admissionConfig off it
    const res = await supertest(buildApp()).get('/api/import-export/template/teachers');
    expect(res.status).toBe(200);
  });
});
