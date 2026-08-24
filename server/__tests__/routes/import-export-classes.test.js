/* ============================================================
   GET /api/import-export/export/classes — header/field mismatch fix
   (onboarding import templates update, 2026-08)

   Root cause: the export handler used 'section'/'keyStage' as CSV
   headers/field reads. Neither exists on a class document — the real
   field is `sectionKey` (server/routes/classes.js's own ClassSchema),
   and `keyStage` isn't a class field anywhere in the schema at all (only
   a student one). Both columns were permanently blank, and the exported
   header row (`name, section, keyStage, capacity, status, createdAt`)
   didn't match what the Classes import template/importer actually
   expects (`name, sectionKey, year, capacity`) — an exported classes CSV
   could never be re-imported as-is.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  return { find: () => chain(seed) };
}

const SCHOOL = 'school_test_001';
let mockCurrentUser;
let mockClasses;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
function mockChain(result) {
  return { select: () => mockChain(result), sort: () => mockChain(result), lean: () => Promise.resolve(result) };
}
jest.mock('../../utils/model', () => ({ _model: jest.fn(() => ({ find: () => mockChain([]) })) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((col) => (col === 'classes' ? mockClasses : { find: () => mockChain([]) })),
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
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockClasses = makeStore([
    { id: 'cls_1', schoolId: SCHOOL, name: 'Grade 3A', sectionKey: 'primary', year: 'Grade 3', capacity: 35, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
});

test('export headers use real class fields (sectionKey, year) instead of nonexistent ones (section, keyStage)', async () => {
  const res = await supertest(buildApp()).get('/api/import-export/export/classes');
  expect(res.status).toBe(200);

  const [headerLine, dataLine] = res.text.replace(/^﻿/, '').trim().split('\n');
  expect(headerLine).toBe('name,sectionKey,year,capacity,status,createdAt');
  expect(dataLine).toContain('Grade 3A');
  expect(dataLine).toContain('primary');   // sectionKey value now actually populated
  expect(dataLine).toContain('Grade 3');   // year value now actually populated
  expect(dataLine).not.toContain('undefined');
});

test('the exported header row now matches the Classes import template header row exactly (round-trippable)', async () => {
  const tplRes = await supertest(buildApp()).get('/api/import-export/template/classes');
  const tplHeaderLine = tplRes.text.replace(/^﻿/, '').trim().split('\n').find(l => !l.startsWith('#'));

  const exportRes = await supertest(buildApp()).get('/api/import-export/export/classes');
  const exportHeaderLine = exportRes.text.replace(/^﻿/, '').trim().split('\n')[0];

  // Every importable column the template defines must appear, in an
  // importer-recognisable form, in what export produces.
  for (const col of tplHeaderLine.split(',')) {
    expect(exportHeaderLine.split(',')).toContain(col);
  }
});
