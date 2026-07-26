/* ============================================================
   server/routes/report-cards.js — single-segment GET route ordering

   Real bug, found by accident while scoping RC8 (which adds a third
   single-segment GET route, /workflow-config, at this same prefix):
   GET /:id was registered before GET /bulk-pdf and GET /draft-comments.
   Express matches single-segment routes in registration order, so
   every request to those two routes was captured by GET /:id instead
   (id='bulk-pdf' / id='draft-comments', no matching snapshot, 404
   "Report card snapshot not found") — both handlers were completely
   unreachable. Confirmed via direct empirical testing before the fix
   (this file did not exist yet), zero existing test coverage had
   caught it. Fixed by registering both ahead of GET /:id.

   This file locks in the fix: both routes must be handled by their
   OWN logic, not GET /:id's not-found response.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin_1', schoolId: 'school_001', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

function mockChain(result) {
  return { select: () => mockChain(result), sort: () => mockChain(result), lean: () => Promise.resolve(result) };
}

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'report_card_draft_comments') {
      return { find: jest.fn(() => mockChain([{ id: 'dc_1', studentId: 'stu_1', subjectComments: {} }])) };
    }
    // report_card_snapshots: findOne always null — proves a request to
    // /bulk-pdf or /draft-comments never reaches GET /:id's snapshot
    // lookup at all (a shadowed request would 404 from exactly this call).
    return { findOne: jest.fn(() => mockChain(null)), find: jest.fn(() => mockChain([])), countDocuments: jest.fn(() => Promise.resolve(0)) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

const express       = require('express');
const supertest     = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

describe('GET /api/report-cards/draft-comments — not shadowed by GET /:id', () => {
  test('returns the draft-comments list, not a snapshot-not-found 404', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/draft-comments').query({ classId: 'cls_1', termNumber: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'dc_1', studentId: 'stu_1', subjectComments: {} }]);
  });
});

describe('GET /api/report-cards/bulk-pdf — not shadowed by GET /:id', () => {
  test('reaches its own handler (400 for the missing classId param it validates), never the :id snapshot 404', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/bulk-pdf'); // no classId — bulk-pdf's own validation fires
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/classId query parameter is required/);
    // The load-bearing negative assertion: if this were still shadowed by
    // GET /:id, the response would be a 404 with this exact message instead.
    expect(res.body.error.message).not.toMatch(/Report card snapshot not found/);
  });

  test('with classId supplied and zero matching published snapshots, returns its own 404 (not :id\'s)', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/bulk-pdf').query({ classId: 'cls_1' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/No published report cards found/);
  });
});
