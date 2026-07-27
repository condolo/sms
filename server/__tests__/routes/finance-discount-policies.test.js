/* ============================================================
   Discount policies (sibling discounts) — server/routes/finance.js

   Covers:
     1. /discount-policies CRUD — active-exclusivity (only one active
        'sibling' policy per school) and duplicate-nthChild rejection.
     2. The sections-scope regression fix in _resolveScopeStudents():
        a fee structure scoped to sections must resolve students via
        classes.sectionKey → classId, not a nonexistent
        Students.sectionId field.
     3. _resolveSiblingDiscounts(), exercised through
        POST /fee-structures/:id/generate — sibling ranking by
        enrollmentDate and tiered discount application.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/counters', () => ({
  nextInvoiceNumber: jest.fn().mockResolvedValue('INV-1'),
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-1'),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

/* ── Generic in-memory fake collection — enough Mongo-filter surface
   (equality, $ne, $in) to exercise real route logic without a DB. ─── */
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$in' in v) {
        // Mongo semantics: an array field matches $in when any element
        // intersects the given list (e.g. users.studentIds: {$in: [...]}).
        if (Array.isArray(doc[k])) return v.$in.some(x => doc[k].includes(x));
        return v.$in.includes(doc[k]);
      }
    }
    return doc[k] === v;
  });
}
function flattenUpdate(update) {
  if (update && update.$set) return { ...update.$set };
  return { ...update };
}
function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    distinct:         jest.fn(() => Promise.resolve([])),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      docs[idx] = { ...docs[idx], ...flattenUpdate(update) };
      return mockChainObj(docs[idx]);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve(null);
      return Promise.resolve(docs.splice(idx, 1)[0]);
    }),
    updateMany: jest.fn((filter, update) => {
      docs = docs.map(d => matchesFilter(d, filter) ? { ...d, ...flattenUpdate(update) } : d);
      return Promise.resolve({});
    }),
  };
}

let mockDiscountPolicies = makeFakeCollection();
let mockFeeStructures    = makeFakeCollection();
let mockStudents         = makeFakeCollection();
let mockUsers            = makeFakeCollection();
let mockClasses          = makeFakeCollection();
const mockInvoices = {
  find:             jest.fn(() => mockChainArr([])),
  distinct:         jest.fn(() => Promise.resolve([])),
  create:           jest.fn((d) => Promise.resolve({ ...d })),
  findOneAndUpdate: jest.fn(() => mockChainObj({})),
};

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'discount_policies') return mockDiscountPolicies;
    if (c === 'fee_structures')    return mockFeeStructures;
    if (c === 'students')          return mockStudents;
    if (c === 'users')             return mockUsers;
    if (c === 'classes')           return mockClasses;
    if (c === 'invoices')          return mockInvoices;
    if (c === 'audit_logs')        return { create: jest.fn().mockResolvedValue({}) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const financeRouter = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDiscountPolicies = makeFakeCollection();
  mockFeeStructures    = makeFakeCollection();
  mockStudents         = makeFakeCollection();
  mockUsers            = makeFakeCollection();
  mockClasses          = makeFakeCollection();
});

describe('discount policies — CRUD', () => {
  test('POST rejects tiers with duplicate nthChild', async () => {
    const res = await supertest(buildApp()).post('/api/finance/discount-policies').send({
      name: 'Bad policy',
      tiers: [{ nthChild: 2, discountPct: 10 }, { nthChild: 2, discountPct: 20 }],
    });
    expect(res.status).toBe(400);
    expect(mockDiscountPolicies.create).not.toHaveBeenCalled();
  });

  test('POST with active:true deactivates any other active sibling policy for the school', async () => {
    mockDiscountPolicies = makeFakeCollection([
      { id: 'dp_old', schoolId: SCHOOL_A, type: 'sibling', active: true, name: 'Old policy', tiers: [{ nthChild: 2, discountPct: 5 }] },
    ]);

    const res = await supertest(buildApp()).post('/api/finance/discount-policies').send({
      name: 'New policy', active: true, tiers: [{ nthChild: 2, discountPct: 15 }],
    });
    expect(res.status).toBe(201);
    const docs = mockDiscountPolicies._docs();
    expect(docs.find(d => d.id === 'dp_old').active).toBe(false);
    expect(docs.find(d => d.name === 'New policy').active).toBe(true);
  });

  test('DELETE removes the policy scoped to the caller\'s school', async () => {
    mockDiscountPolicies = makeFakeCollection([
      { id: 'dp_1', schoolId: SCHOOL_A, type: 'sibling', active: false, name: 'P1', tiers: [{ nthChild: 2, discountPct: 5 }] },
    ]);
    const res = await supertest(buildApp()).delete('/api/finance/discount-policies/dp_1');
    expect(res.status).toBe(200);
    expect(mockDiscountPolicies._docs().length).toBe(0);
  });
});

describe('fee-structures/:id/generate — sections scope regression (classes.sectionKey, not Students.sectionId)', () => {
  test('scopeType "sections" resolves students via classes in that section, not a direct student field', async () => {
    mockFeeStructures = makeFakeCollection([{
      id: 'fs_1', schoolId: SCHOOL_A, name: 'Term 1 Fees', scopeType: 'sections', sectionIds: ['primary'],
      lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
    }]);
    mockClasses = makeFakeCollection([
      { id: 'cls_primary', _id: 'oid_primary', schoolId: SCHOOL_A, sectionKey: 'primary' },
      { id: 'cls_secondary', _id: 'oid_secondary', schoolId: SCHOOL_A, sectionKey: 'secondary' },
    ]);
    mockStudents = makeFakeCollection([
      { id: 's1', schoolId: SCHOOL_A, status: 'active', classId: 'cls_primary',   firstName: 'A', lastName: 'One' },
      { id: 's2', schoolId: SCHOOL_A, status: 'active', classId: 'cls_primary',   firstName: 'B', lastName: 'Two' },
      { id: 's3', schoolId: SCHOOL_A, status: 'active', classId: 'cls_secondary', firstName: 'C', lastName: 'Three' },
    ]);

    const res = await supertest(buildApp()).post('/api/finance/fee-structures/fs_1/generate');
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);
    const invoicedIds = res.body.data.invoices.map(i => i.studentId).sort();
    expect(invoicedIds).toEqual(['s1', 's2']);
  });
});

describe('fee-structures/:id/generate — sibling discount application', () => {
  test('ranks siblings by enrollmentDate and applies the matching tier, eldest pays full price', async () => {
    mockFeeStructures = makeFakeCollection([{
      id: 'fs_2', schoolId: SCHOOL_A, name: 'Term 1 Fees', scopeType: 'all',
      lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
    }]);
    mockStudents = makeFakeCollection([
      { id: 's_eldest', schoolId: SCHOOL_A, status: 'active', firstName: 'E', lastName: 'Kid', enrollmentDate: '2020-01-01' },
      { id: 's_middle', schoolId: SCHOOL_A, status: 'active', firstName: 'M', lastName: 'Kid', enrollmentDate: '2021-01-01' },
      { id: 's_youngest', schoolId: SCHOOL_A, status: 'active', firstName: 'Y', lastName: 'Kid', enrollmentDate: '2022-01-01' },
    ]);
    mockDiscountPolicies = makeFakeCollection([{
      id: 'dp_active', schoolId: SCHOOL_A, type: 'sibling', active: true, name: 'Sibling Discount',
      tiers: [{ nthChild: 2, discountPct: 10 }, { nthChild: 3, discountPct: 20 }],
    }]);
    mockUsers = makeFakeCollection([
      { id: 'guardian_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['s_eldest', 's_middle', 's_youngest'] },
    ]);

    const res = await supertest(buildApp()).post('/api/finance/fee-structures/fs_2/generate');
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(3);

    const byId = Object.fromEntries(res.body.data.invoices.map(i => [i.studentId, i]));
    expect(byId.s_eldest.discountPct).toBe(0);
    expect(byId.s_middle.discountPct).toBe(10);
    expect(byId.s_youngest.discountPct).toBe(20);
    expect(byId.s_middle.total).toBe(900);
    expect(byId.s_youngest.total).toBe(800);
  });

  test('no active policy → no discounts applied', async () => {
    mockFeeStructures = makeFakeCollection([{
      id: 'fs_3', schoolId: SCHOOL_A, name: 'Term 1 Fees', scopeType: 'all',
      lineItems: [{ description: 'Tuition', quantity: 1, unitPrice: 1000 }],
    }]);
    mockStudents = makeFakeCollection([
      { id: 's_a', schoolId: SCHOOL_A, status: 'active', firstName: 'A', lastName: 'Kid', enrollmentDate: '2020-01-01' },
      { id: 's_b', schoolId: SCHOOL_A, status: 'active', firstName: 'B', lastName: 'Kid', enrollmentDate: '2021-01-01' },
    ]);
    mockUsers = makeFakeCollection([
      { id: 'guardian_1', schoolId: SCHOOL_A, role: 'parent', studentIds: ['s_a', 's_b'] },
    ]);
    // mockDiscountPolicies stays empty — no active policy

    const res = await supertest(buildApp()).post('/api/finance/fee-structures/fs_3/generate');
    expect(res.status).toBe(201);
    for (const inv of res.body.data.invoices) {
      expect(inv.discountPct).toBe(0);
      expect(inv.total).toBe(1000);
    }
  });
});
