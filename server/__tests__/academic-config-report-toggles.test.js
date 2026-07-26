/* ============================================================
   server/routes/academic-config.js — RCE1 report-card toggle wiring

   showDeviation/showClassAverage already existed in the schema/merge
   but were never read anywhere (dead). showBehaviour/showClassTeacherRemark/
   showPrincipalRemark are genuinely new fields. This covers _mergeConfig's
   defaults and that PATCH's Zod schema actually accepts the 3 new fields
   (a field missing from ConfigSchema would be silently stripped, not
   rejected — the failure mode this test guards against).
   ============================================================ */
'use strict';

const { mergeConfig } = require('../routes/academic-config');

describe('academic-config _mergeConfig — RCE1 report-card toggles', () => {
  test('defaults every new/dead toggle to true when nothing is saved', () => {
    const cfg = mergeConfig(null);
    expect(cfg.showDeviation).toBe(true);
    expect(cfg.showClassAverage).toBe(true);
    expect(cfg.showBehaviour).toBe(true);
    expect(cfg.showClassTeacherRemark).toBe(true);
    expect(cfg.showPrincipalRemark).toBe(true);
  });

  test('an explicit false is preserved through the merge, not overridden by the default', () => {
    const cfg = mergeConfig({
      showDeviation: false, showClassAverage: false,
      showBehaviour: false, showClassTeacherRemark: false, showPrincipalRemark: false,
    });
    expect(cfg.showDeviation).toBe(false);
    expect(cfg.showClassAverage).toBe(false);
    expect(cfg.showBehaviour).toBe(false);
    expect(cfg.showClassTeacherRemark).toBe(false);
    expect(cfg.showPrincipalRemark).toBe(false);
  });
});

describe('academic-config ConfigSchema (via the exported router) — RCE1 fields are PATCH-able', () => {
  // The route module isn't required elsewhere in this file, so pulling
  // its internal Zod schema would need a new export; instead this proves
  // the same thing at the level that actually matters — PATCH persists
  // the field and GET reflects it back — via a light supertest pass with
  // tenant-model mocked, mirroring the established pattern for small
  // config routers in this codebase.
  jest.resetModules();
  jest.doMock('../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = { schoolId: 'sch_1', userId: 'u1' }; next(); } }));
  jest.doMock('../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
  jest.doMock('../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

  let saved = null;
  jest.doMock('../utils/tenant-model', () => ({
    tenantModel: () => ({
      findOne: () => ({ lean: () => Promise.resolve(saved) }),
      findOneAndUpdate: (_f, update) => ({ lean: () => { saved = { ...(saved || {}), ...update.$set }; return Promise.resolve(saved); } }),
    }),
    tenantContext: () => ({}),
  }));

  const express = require('express');
  const supertest = require('supertest');
  const router = require('../routes/academic-config');

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/academic-config', router);
    return app;
  }

  beforeEach(() => { saved = null; });

  test('PUT persists showBehaviour/showClassTeacherRemark/showPrincipalRemark, GET reflects them back', async () => {
    const app = buildApp();
    const putRes = await supertest(app).put('/api/academic-config').send({
      showBehaviour: false, showClassTeacherRemark: false, showPrincipalRemark: true,
    });
    expect(putRes.status).toBe(200);

    const getRes = await supertest(app).get('/api/academic-config');
    expect(getRes.body.data.showBehaviour).toBe(false);
    expect(getRes.body.data.showClassTeacherRemark).toBe(false);
    expect(getRes.body.data.showPrincipalRemark).toBe(true);
  });
});
