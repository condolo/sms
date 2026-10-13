/* ============================================================
   server/routes/rc-templates.js — RBAC relocation (2026-10-13).

   The Kindergarten Templates UI moved out of the Report Cards module's
   RBAC scope (report_cards:{read,update}) to Exams' own assessment-
   configuration scope (assessment:{read,update}), in the SAME change
   that moved the UI out of Report Cards entirely into ExamsPage.jsx's
   own top-level tab. This verifies the gate actually moved — not just
   widened to accept both — using the REAL rbac.js (only its own DB
   read is mocked).
   ============================================================ */

const SCHOOL_A = 'school_A';
let mockRolePerms = {};

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: mockRolePerms }) }) };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({
    find:   () => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) }),
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
    create: (doc) => Promise.resolve({ ...doc, toObject: () => doc }),
  }),
}));

const express       = require('express');
const supertest     = require('supertest');
const rcTemplatesRouter = require('../../routes/rc-templates');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/rc-templates', rcTemplatesRouter);
  return app;
}

beforeEach(() => {
  invalidatePermCache(SCHOOL_A);
  mockRolePerms = {};
});

const NON_FLOOR = { userId: 'usr_t', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

test('holding report_cards:read alone (the OLD scope) no longer grants access', async () => {
  mockRolePerms = { report_cards: ['read', 'update'] }; // old scope, deliberately not assessment
  const res = await supertest(buildApp(NON_FLOOR)).get('/api/rc-templates');
  expect(res.status).toBe(403);
});

test('assessment:read (the NEW scope) grants list access', async () => {
  mockRolePerms = { assessment: ['read', 'update'] };
  const res = await supertest(buildApp(NON_FLOOR)).get('/api/rc-templates');
  expect(res.status).toBe(200);
});

test('assessment:update grants create access', async () => {
  mockRolePerms = { assessment: ['read', 'create', 'update'] };
  const res = await supertest(buildApp(NON_FLOOR)).post('/api/rc-templates').send({
    name: 'KG Competency Bands', performanceBands: [{ label: 'Good', grade: 'B' }],
  });
  expect(res.status).toBe(201);
});

test('assessment:read alone (no update) is forbidden from creating', async () => {
  mockRolePerms = { assessment: ['read'] };
  const res = await supertest(buildApp(NON_FLOOR)).post('/api/rc-templates').send({
    name: 'KG Competency Bands', performanceBands: [{ label: 'Good', grade: 'B' }],
  });
  expect(res.status).toBe(403);
});
