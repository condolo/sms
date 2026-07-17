/* ============================================================
   Cross-tenant isolation — batch of mechanical routes migrated to
   tenantModel() (C4 · ADR-0001): subjects, behaviour, library,
   transport, hostel.

   These are simple own-collection CRUD routes. Rather than a full
   dedicated suite each (the mechanism is proven + real-DB-validated),
   this hits one live endpoint per router to confirm two things at
   RUNTIME (which a module-load check can't): (1) the tenantModel /
   tenantContext imports resolve — no ReferenceError in a handler — and
   (2) the query the DB receives is scoped to the active school.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));

const mockSeen = {};
jest.mock('../../utils/model', () => {
  const chain = (r) => { const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(r) }; return c; };
  return {
    _model: jest.fn((coll) => ({
      find:           jest.fn((f) => { (mockSeen[coll] = mockSeen[coll] || []).push(f); return chain([]); }),
      countDocuments: jest.fn(() => Promise.resolve(0)),
      findOne:        jest.fn(() => chain(null)),
      aggregate:      jest.fn(() => Promise.resolve([])),
    })),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app(mount, router) {
  const a = express();
  a.use(express.json());
  a.use(mount, router);
  return a;
}

beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(mockSeen)) delete mockSeen[k]; });

/* [file, mount, listPath, collection queried] */
const CASES = [
  // batch 1
  ['subjects',  '/api/subjects',  '/',          'subjects'],
  ['behaviour', '/api/behaviour', '/incidents', 'behaviour_incidents'],
  ['library',   '/api/library',   '/books',     'library_books'],
  ['transport', '/api/transport', '/routes',    'transport_routes'],
  ['hostel',    '/api/hostel',    '/hostels',   'hostels'],
  // batch 2 (representative — full batch is capture-sed + import-verified + load-checked)
  ['exam-series',          '/api/exam-series',          '/', 'exam_series'],
  ['teaching-assignments', '/api/teaching-assignments', '/', 'teaching_assignments'],
  ['mark-submissions',     '/api/mark-submissions',     '/', 'mark_submissions'],
];

describe('collections.js — generic CRUD router, tenant isolation (authenticated as School A)', () => {
  test('GET /api/collections/subjects (tenant-owned col) scopes the query to School A', async () => {
    const router = require('../../routes/collections');
    const res = await supertest(app('/api/collections', router)).get('/api/collections/subjects');
    expect(res.status).toBeLessThan(500);
    expect(mockSeen['subjects']).toBeDefined();
    expect(mockSeen['subjects'][0].schoolId).toBe(SCHOOL_A);
  });
  // 'schools' (platform-exempt) and 'behaviour_matrix' (GLOBAL) both route
  // through collections.js's own local _model(), which uses real Mongoose —
  // not the mocked utils/model — so they can't be exercised here without a
  // live DB. Covered instead by code review: _accessor()'s
  // GLOBAL.has(col) || PLATFORM_COLLECTIONS.has(col) check is a plain
  // synchronous branch, and a module-load check confirms no ReferenceError.
});

describe('mechanical routes — tenant isolation (authenticated as School A)', () => {
  for (const [file, mount, listPath, coll] of CASES) {
    test(`${file}: GET ${listPath} scopes the ${coll} query to School A (and imports resolve at runtime)`, async () => {
      const router = require(`../../routes/${file}`);
      const res = await supertest(app(mount, router)).get(mount + listPath);
      // Not 500 → no ReferenceError from the tenantModel/tenantContext imports
      expect(res.status).toBeLessThan(500);
      // The DB received a School-A-scoped query
      expect(mockSeen[coll]).toBeDefined();
      expect(mockSeen[coll][0].schoolId).toBe(SCHOOL_A);
    });
  }
});
