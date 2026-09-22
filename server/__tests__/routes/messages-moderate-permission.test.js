/* ============================================================
   server/routes/messages.js — DELETE /:id moderation gate (2026-09).

   Reported alongside the same broader audit that fixed students.js's
   hardcoded action gates (v5.115.0): DELETE /:id let a role delete
   ANY message (not just their own) if role was hardcoded to
   ['superadmin','admin','deputy_principal'] — no Settings equivalent,
   and duplicated independently in MessagesPage.jsx's own canDelete.

   Pins the fix: a role holding only the ordinary 'Delete Own Messages'
   grant (coarse messages:delete) can delete their OWN message, but NOT
   someone else's, unless explicitly granted the new 'moderate' sub
   (enforced with hasExplicitSubGrant — no coarse-grant fallback). The 3
   real floor roles (superadmin/admin/deputy_principal) keep their exact
   pre-existing, unconditional moderation power.

   Uses the REAL rbac.js (hasExplicitSubGrant is not mocked) — only its
   own DB read (role_permissions) is mocked, same discipline as
   students-sensitive-permissions.test.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

let mockRolePerms = {};

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: mockRolePerms }) }) };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

const MESSAGES_SEED = [{ id: 'm1', schoolId: SCHOOL_A, senderId: 'usr_sender', subject: 'Hi' }];
let mockDeleted;
const mockMessagesColl = {
  findOne:   () => ({ lean: () => Promise.resolve(MESSAGES_SEED[0]) }),
  deleteOne: () => { mockDeleted = true; return Promise.resolve({ deletedCount: 1 }); },
};
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'messages') return mockMessagesColl;
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  },
}));

const express        = require('express');
const supertest      = require('supertest');
const messagesRouter = require('../../routes/messages');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/messages', messagesRouter);
  return app;
}

beforeEach(() => {
  invalidatePermCache(SCHOOL_A);
  mockRolePerms = {};
  mockDeleted = false;
});

const OTHER_SENDER = { userId: 'usr_other', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
const THE_SENDER   = { userId: 'usr_sender', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
const ADMIN        = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
const DEPUTY       = { userId: 'usr_deputy', schoolId: SCHOOL_A, role: 'deputy_principal', roles: ['deputy_principal'] };

describe('DELETE /api/messages/:id', () => {
  test('the sender can delete their own message with only the ordinary delete grant', async () => {
    mockRolePerms = { messages: ['read', 'delete'] };
    const res = await supertest(buildApp(THE_SENDER)).delete('/api/messages/m1');
    expect(res.status).toBe(200);
    expect(mockDeleted).toBe(true);
  });

  test('a non-floor role with ordinary delete but NO moderate grant is forbidden from deleting another sender\'s message', async () => {
    mockRolePerms = { messages: ['read', 'delete'] }; // has "Delete Own Messages" — must not imply moderation
    const res = await supertest(buildApp(OTHER_SENDER)).delete('/api/messages/m1');
    expect(res.status).toBe(403);
    expect(mockDeleted).toBe(false);
  });

  test('a non-floor role WITH explicit messages__moderate grant can delete another sender\'s message', async () => {
    mockRolePerms = { messages: ['read'], messages__moderate: ['read', 'delete'] };
    const res = await supertest(buildApp(OTHER_SENDER)).delete('/api/messages/m1');
    expect(res.status).toBe(200);
    expect(mockDeleted).toBe(true);
  });

  test('admin (floor) can delete another sender\'s message via the floor bypass alone', async () => {
    mockRolePerms = { messages: ['read', 'delete'] }; // real coarse grant so the outer rbac() gate passes; messages__moderate deliberately absent
    const res = await supertest(buildApp(ADMIN)).delete('/api/messages/m1');
    expect(res.status).toBe(200);
    expect(mockDeleted).toBe(true);
  });

  test('deputy_principal (floor) can delete another sender\'s message via the floor bypass alone', async () => {
    mockRolePerms = { messages: ['read', 'delete'] };
    const res = await supertest(buildApp(DEPUTY)).delete('/api/messages/m1');
    expect(res.status).toBe(200);
    expect(mockDeleted).toBe(true);
  });
});
