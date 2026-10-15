/* ============================================================
   GET /api/teachers, GET /api/teachers/:id — full-data visibility
   tied to the real teachers:update permission, not a hardcoded role list

   Reported directly (2026-10-15): "each time we edit a teacher's
   profile, we have to re-add the email and gender otherwise the
   changes will not save." Root cause: email/gender/phone/etc were
   stripped from the response by a hardcoded FULL_ACCESS_ROLES set
   ({admin, superadmin, principal, hr}) completely independent of the
   real teachers:update RBAC permission a school actually grants via
   Roles & Permissions. deputy_principal — treated as management-tier
   everywhere else in this codebase, and able to pass the
   rbac('teachers','update') middleware on this very file — was never
   in that list, so the edit form silently got blank email/gender, and
   PUT /:id then failed validation (gender's enum rejects '') unless
   the admin manually re-typed both fields every time.

   Fixed: full-data visibility now follows hasPermission(req,
   'teachers', 'update') directly — any role a school grants edit
   access to (built-in or custom) sees what it can edit.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_fulldata';

// Real Mongoose .select() semantics, since this is exactly what the fix
// under test depends on: an inclusive string ("id firstName ...") keeps
// ONLY those fields; an exclusive string ("-__v") keeps everything except
// the named ones. Applied lazily, at .lean() time, to whatever doc(s) are
// in scope — mirrors how the real projection narrows the DB response.
function _applyProjection(doc, projection) {
  if (!doc || !projection) return doc;
  const tokens = projection.split(/\s+/).filter(Boolean);
  const exclusive = tokens.every(t => t.startsWith('-'));
  if (exclusive) {
    const drop = new Set(tokens.map(t => t.slice(1)));
    return Object.fromEntries(Object.entries(doc).filter(([k]) => !drop.has(k)));
  }
  const keep = new Set(tokens);
  return Object.fromEntries(Object.entries(doc).filter(([k]) => keep.has(k)));
}
function mockChain(result, projection = null) {
  const withProjection = (p) => mockChain(result, p);
  return {
    sort: () => mockChain(result, projection), skip: () => mockChain(result, projection), limit: () => mockChain(result, projection),
    select: (p) => withProjection(p),
    lean: () => Promise.resolve(
      Array.isArray(result) ? result.map(d => _applyProjection(d, projection)) : _applyProjection(result, projection)
    ),
  };
}

let mockJwtUser;
let mockTeacherDoc;
const mockHasPermission = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(), // entry to the route is unconditional here — this file tests the field-visibility gate behind it, not the route guard
  hasPermission: (...args) => mockHasPermission(...args),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'teachers') {
      return {
        find:           () => mockChain([mockTeacherDoc]),
        findOne:        () => mockChain(mockTeacherDoc),
        countDocuments: () => Promise.resolve(1),
      };
    }
    if (collection === 'subjects') return { find: () => mockChain([]) };
    return { find: () => mockChain([]), findOne: () => mockChain(null) };
  },
}));

const express       = require('express');
const supertest      = require('supertest');
const teachersRouter = require('../../routes/teachers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teachers', teachersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTeacherDoc = {
    id: 't_1', schoolId: SCHOOL, firstName: 'Alice', lastName: 'Makori',
    email: 'alice@school.ac.ke', gender: 'female', phone: '0700000000',
    staffType: 'teacher', subjects: [], status: 'active',
  };
});

describe('a role holding teachers:update sees full data, regardless of which role it is', () => {
  test('deputy_principal — the exact reported gap — now sees email/gender on GET /:id', async () => {
    mockJwtUser = { userId: 'usr_dep', schoolId: SCHOOL, role: 'deputy_principal', roles: [] };
    mockHasPermission.mockResolvedValue(true);
    const res = await supertest(buildApp()).get('/api/teachers/t_1');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('alice@school.ac.ke');
    expect(res.body.data.gender).toBe('female');
    expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), 'teachers', 'update');
  });

  test('deputy_principal also sees full data on the list route GET /', async () => {
    mockJwtUser = { userId: 'usr_dep', schoolId: SCHOOL, role: 'deputy_principal', roles: [] };
    mockHasPermission.mockResolvedValue(true);
    const res = await supertest(buildApp()).get('/api/teachers');
    expect(res.status).toBe(200);
    expect(res.body.data[0].email).toBe('alice@school.ac.ke');
  });

  test('a custom role granted teachers:update also sees full data — no hardcoded role list to keep in sync', async () => {
    mockJwtUser = { userId: 'usr_custom', schoolId: SCHOOL, role: 'academic_director', roles: [] };
    mockHasPermission.mockResolvedValue(true);
    const res = await supertest(buildApp()).get('/api/teachers/t_1');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('alice@school.ac.ke');
  });
});

describe('a role without teachers:update still gets the limited, sensitive-field-free projection', () => {
  test('GET /:id strips email/gender/phone when hasPermission resolves false', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    mockHasPermission.mockResolvedValue(false);
    const res = await supertest(buildApp()).get('/api/teachers/t_1');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBeUndefined();
    expect(res.body.data.gender).toBeUndefined();
    expect(res.body.data.phone).toBeUndefined();
    expect(res.body.data.firstName).toBe('Alice'); // public fields still present
  });

  test('GET / list also strips sensitive fields when hasPermission resolves false', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
    mockHasPermission.mockResolvedValue(false);
    const res = await supertest(buildApp()).get('/api/teachers');
    expect(res.status).toBe(200);
    expect(res.body.data[0].email).toBeUndefined();
  });
});
