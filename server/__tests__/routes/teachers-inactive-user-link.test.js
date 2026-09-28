/* ============================================================
   POST /api/teachers — userId link must skip a soft-deleted account
   (2026-09-28, real customer report)

   Root cause: a soft-deleted user (DELETE /api/settings/users/:id sets
   isActive:false, never purges the document) keeps its email forever.
   POST /teachers's own userId-backfill ("bind userId from the linked
   user account") matched by email with no isActive filter at all, so
   creating a brand-new staff record for that same email silently bound
   it to the DEAD login — the staff record showed up as active in HR
   while the actual account behind it couldn't sign in, with nothing
   surfacing the mismatch. Confirmed live against a real school's data:
   a teacher invited by mistake, then removed, then re-added properly
   through HR ended up in exactly this state.

   Fix: the email match now requires isActive: {$ne: false}. A staff
   record created against a dead account's email gets userId: null
   (same as "no match at all"), same as before this bug ever mattered —
   an admin must explicitly grant login via HR's own "Create Login
   Account" flow, which creates a fresh account.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/counters', () => ({ nextStaffId: jest.fn().mockResolvedValue('STF-0001') }));

const SCHOOL_ID = 'sch_demo_001';
let mockJwtUser;
let mockTeachers;
let mockUsers;

function mockChain(result) {
  const c = { select: () => c, lean: () => Promise.resolve(result) };
  return c;
}
function mockMatches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    return doc[k] === v;
  });
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') return { findOne: () => mockChain({ id: SCHOOL_ID, staffResponsibilities: [] }) };
    return { findOne: () => mockChain(null) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'teachers') {
      return {
        findOne: (filter) => mockChain(mockTeachers.find(d => mockMatches(d, filter)) ?? null),
        create: jest.fn(async (doc) => { const d = { ...doc, toObject: () => d }; mockTeachers.push(d); return d; }),
      };
    }
    if (col === 'users') {
      return { findOne: (filter) => mockChain(mockUsers.find(d => mockMatches(d, filter)) ?? null) };
    }
    return { findOne: () => mockChain(null), create: jest.fn() };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const teachersRouter = require('../../routes/teachers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teachers', teachersRouter);
  return app;
}

const BASE_BODY = { firstName: 'Angela', lastName: 'Gitau', email: 'angela.gitau@trinitas.example' };

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_hr_001', schoolId: SCHOOL_ID, role: 'hr', roles: ['hr'] };
  mockTeachers = [];
  mockUsers = [];
});

describe('POST /api/teachers — userId link skips a soft-deleted account', () => {
  test('a DEACTIVATED user with the same email is never linked — userId stays null', async () => {
    mockUsers = [{ id: 'usr_old', schoolId: SCHOOL_ID, email: BASE_BODY.email, isActive: false }];
    const res = await supertest(buildApp()).post('/api/teachers').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBeNull();
  });

  test('an ACTIVE user with the same email is still linked (unchanged behavior)', async () => {
    mockUsers = [{ id: 'usr_active', schoolId: SCHOOL_ID, email: BASE_BODY.email, isActive: true }];
    const res = await supertest(buildApp()).post('/api/teachers').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe('usr_active');
  });

  test('a user with isActive unset (legacy shape, no explicit flag) is still treated as active', async () => {
    mockUsers = [{ id: 'usr_legacy', schoolId: SCHOOL_ID, email: BASE_BODY.email }];
    const res = await supertest(buildApp()).post('/api/teachers').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe('usr_legacy');
  });

  test('no matching user at all — userId stays null (baseline, unchanged)', async () => {
    const res = await supertest(buildApp()).post('/api/teachers').send(BASE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBeNull();
  });
});
