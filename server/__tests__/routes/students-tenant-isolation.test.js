/* ============================================================
   Cross-tenant isolation regression — server/routes/students.js
   (C4 · ADR-0001 §5)

   students.js is the most complex tenant route (cross-collection
   dual-id logic, portal/user provisioning, a bulk hard-purge that
   cascades into invoices + payments). The existing students.test.js
   proves behavior-preservation; this adds the isolation guarantee for
   the highest-risk surface it doesn't cover: the DELETE /purge cascade
   must NEVER reach across schools — deleting another school's financial
   records would be catastrophic.

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
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_q, _s, n) => n() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), hasNoAssignments: jest.fn(() => false) }));

const seen = { stuFind: [], stuCount: [], stuDeleteMany: [], invDeleteMany: [], payDeleteMany: [] };

function mockChain(r) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(r) };
  return c;
}

const mockStudents = {
  find:           jest.fn((f) => { seen.stuFind.push(f); return mockChain([{ id: 's1', _id: 'oid_s1' }]); }),
  countDocuments: jest.fn((f) => { seen.stuCount.push(f); return Promise.resolve(0); }),
  deleteMany:     jest.fn((f) => { seen.stuDeleteMany.push(f); return Promise.resolve({ deletedCount: 1 }); }),
};
const mockInvoices = { deleteMany: jest.fn((f) => { seen.invDeleteMany.push(f); return Promise.resolve({ deletedCount: 1 }); }) };
const mockPayments = { deleteMany: jest.fn((f) => { seen.payDeleteMany.push(f); return Promise.resolve({ deletedCount: 1 }); }) };

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'students') return mockStudents;
    if (c === 'invoices') return mockInvoices;
    if (c === 'payments') return mockPayments;
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const studentsRouter = require('../../routes/students');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}
function assertScopedToA(f) { expect(f).toBeDefined(); expect(f.schoolId).toBe(SCHOOL_A); }

beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(seen)) seen[k] = []; });

describe('students — cross-tenant isolation (authenticated as School A)', () => {
  test('GET / scopes list find + count to School A', async () => {
    await supertest(buildApp()).get('/api/students');
    assertScopedToA(seen.stuFind[0]);
    assertScopedToA(seen.stuCount[0]);
  });

  test('DELETE /purge — the delete AND the invoice/payment cascade are all School-A-scoped', async () => {
    const res = await supertest(buildApp())
      .delete('/api/students/purge')
      .send({ ids: ['s1'] });
    expect(res.status).toBe(200);

    // student find scoped
    assertScopedToA(seen.stuFind[0]);
    // the hard delete scoped
    assertScopedToA(seen.stuDeleteMany[0]);
    // the cross-collection financial cascade — the dangerous part — scoped to A
    assertScopedToA(seen.invDeleteMany[0]);
    assertScopedToA(seen.payDeleteMany[0]);
    // and it targets this school's student, not a foreign one
    expect(seen.invDeleteMany[0].studentId).toEqual({ $in: ['s1'] });
  });
});
