/* ============================================================
   server/routes/rc-templates.js — RBAC relocation (2026-10).

   The Kindergarten Templates UI moved out of the generic Settings
   page's RBAC scope (settings:{read,update}) to the Report Cards
   module's own scope (report_cards:{read,update}), in the SAME change
   that moved the UI out of Settings entirely. This verifies the gate
   actually moved — not just widened to accept both — using the REAL
   rbac.js (only its own DB read is mocked).
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

test('holding settings:read alone (the OLD scope) no longer grants access', async () => {
  mockRolePerms = { settings: ['read', 'update'] }; // old scope, deliberately not report_cards
  const res = await supertest(buildApp(NON_FLOOR)).get('/api/rc-templates');
  expect(res.status).toBe(403);
});

test('report_cards:read (the NEW scope) grants list access', async () => {
  mockRolePerms = { report_cards: ['read', 'update'] };
  const res = await supertest(buildApp(NON_FLOOR)).get('/api/rc-templates');
  expect(res.status).toBe(200);
});

test('report_cards:update grants create access', async () => {
  mockRolePerms = { report_cards: ['read', 'create', 'update'] };
  const res = await supertest(buildApp(NON_FLOOR)).post('/api/rc-templates').send({
    name: 'KG Competency Bands', performanceBands: [{ label: 'Good', grade: 'B' }],
  });
  expect(res.status).toBe(201);
});

test('report_cards:read alone (no update) is forbidden from creating', async () => {
  mockRolePerms = { report_cards: ['read'] };
  const res = await supertest(buildApp(NON_FLOOR)).post('/api/rc-templates').send({
    name: 'KG Competency Bands', performanceBands: [{ label: 'Good', grade: 'B' }],
  });
  expect(res.status).toBe(403);
});
