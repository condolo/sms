/* ============================================================
   server/routes/parent-portal.js — multi-role access to the parent face.

   A staff member who is also a parent holds both roles on ONE account
   (mobile role switching reuses the same token for both faces). The parent
   guard used to reject anything whose PRIMARY role was not parent/guardian,
   which made the parent face a dead end for exactly those people.

   Pins:
     • teacher-primary + parent role  → parent reads are allowed
     • parent-primary (unchanged)     → allowed
     • teacher-primary without parent → still refused
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));

const SCHOOL = 'school_A';
const CHILD = 'stu_1';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn(), getSnapshotDetail: jest.fn(), streamSnapshotPdf: jest.fn() },
}));
jest.mock('../../routes/messages', () => ({
  _inboxQuery: jest.fn(),
  createDirectMessage: jest.fn(),
}));
jest.mock('../../utils/parent-message-recipients', () => ({
  resolveMessageCategories: jest.fn(async () => ([{ key: 'class_teacher', label: 'Class Teacher' }])),
  resolveOneCategory: jest.fn(async () => ['usr_t1']),
}));

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({ findOne: () => mockChain({ name: 'Jane', email: 'jane@example.com' }), find: () => mockChain([]) }),
}));
jest.mock('../../utils/model', () => ({ _model: () => ({ findOne: () => mockChain(null) }) }));

const express = require('express');
const supertest = require('supertest');
const parentPortalRouter = require('../../routes/parent-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parent-portal access for multi-role accounts', () => {
  test('teacher-primary with a parent role may read parent data', async () => {
    mockJwtUser = {
      userId: 'usr_teacher_parent', schoolId: SCHOOL,
      role: 'teacher', roles: ['teacher', 'parent'],
      guardianOf: [CHILD], studentIds: [CHILD],
    };
    const res = await supertest(buildApp())
      .get(`/api/parent-portal/message-recipients?childId=${CHILD}`);
    expect(res.status).toBe(200);
  });

  test('parent-primary is unchanged', async () => {
    mockJwtUser = {
      userId: 'usr_parent', schoolId: SCHOOL,
      role: 'parent', roles: ['parent'], guardianOf: [CHILD], studentIds: [CHILD],
    };
    const res = await supertest(buildApp())
      .get(`/api/parent-portal/message-recipients?childId=${CHILD}`);
    expect(res.status).toBe(200);
  });

  test('a teacher without the parent role is still refused', async () => {
    mockJwtUser = {
      userId: 'usr_teacher', schoolId: SCHOOL,
      role: 'teacher', roles: ['teacher'],
    };
    const res = await supertest(buildApp())
      .get(`/api/parent-portal/message-recipients?childId=${CHILD}`);
    expect(res.status).toBe(403);
  });
});
