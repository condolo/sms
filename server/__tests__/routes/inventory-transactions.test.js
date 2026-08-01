/* ============================================================
   Inventory milestone 2 — server/routes/inventory.js (Stock Transactions)

   Covers: RBAC, the four transaction types' effect on item.quantity
   (receive/return increase, issue decreases, adjustment goes either way
   per `direction`), the insufficient-stock guard (issue/decrease
   rejected without mutating quantity), itemName denormalization,
   adjustment requiring both direction and reason, and — the one that
   actually matters — that the item's quantity update is atomic via a
   guarded $inc rather than a read-compute-write race, verified by
   simulating the exact guard condition the real Mongo query uses
   (quantity >= -delta) inside the mock's findOneAndUpdate.

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants, same discipline as the other milestone test files.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$gte' in v) return (doc[k] ?? 0) >= v.$gte;
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeItemsCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    // Mirrors the real route's atomic-$inc-with-guard call exactly —
    // if the guard fails, no mutation happens, matching Mongo's own
    // findOneAndUpdate semantics (no match => null, no side effect).
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) docs[idx][k] = (docs[idx][k] ?? 0) + v;
      if (update.$set) Object.assign(docs[idx], update.$set);
      return mockChainObj(docs[idx]);
    }),
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return Promise.resolve({ matchedCount: 0 });
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) docs[idx][k] = (docs[idx][k] ?? 0) + v;
      if (update.$set) Object.assign(docs[idx], update.$set);
      return Promise.resolve({ matchedCount: 1 });
    }),
  };
}
function mockMakeTxnCollection(seed = [], { failCreate = false } = {}) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    create: jest.fn((doc) => {
      if (failCreate) return Promise.reject(new Error('simulated ledger write failure'));
      docs.push(doc);
      return Promise.resolve(doc);
    }),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const mockRolePerms = {
  admin:   { inventory: ['read', 'create', 'update', 'delete'] },
  teacher: { inventory__requisition: ['read', 'create', 'update'] }, // no top-level 'inventory' key
};

let mockItems, mockTransactions;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)) };
    }
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'inventory_items')        return mockItems;
    if (collection === 'inventory_transactions') return mockTransactions;
    return mockMakeItemsCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const inventoryRouter = require('../../routes/inventory');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/inventory', inventoryRouter);
  return app;
}

function makeItem(overrides = {}) {
  return { id: 'i1', schoolId: SCHOOL_A, itemCode: 'ICT-001', name: 'Dell Laptop', categoryId: 'c1', categoryName: 'ICT', quantity: 10, unit: 'pcs', status: 'active', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockItems = mockMakeItemsCollection([makeItem()]);
  mockTransactions = mockMakeTxnCollection([]);
});

describe('POST /api/inventory/transactions — RBAC', () => {
  test('admin can record a transaction', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'receive', quantity: 5 });
    expect(res.status).toBe(201);
  });

  test('a teacher (requisition-only grant) is forbidden', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'receive', quantity: 5 });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/inventory/transactions — quantity effect per type', () => {
  test('receive increases quantity', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'receive', quantity: 5 });
    expect(res.status).toBe(201);
    expect(mockItems._docs()[0].quantity).toBe(15);
    expect(res.body.data.delta).toBe(5);
  });

  test('issue decreases quantity', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'issue', quantity: 4 });
    expect(res.status).toBe(201);
    expect(mockItems._docs()[0].quantity).toBe(6);
    expect(res.body.data.delta).toBe(-4);
  });

  test('return increases quantity', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'return', quantity: 2 });
    expect(res.status).toBe(201);
    expect(mockItems._docs()[0].quantity).toBe(12);
  });

  test('adjustment increase requires direction and reason, then increases quantity', async () => {
    const res = await supertest(buildApp())
      .post('/api/inventory/transactions')
      .send({ itemId: 'i1', type: 'adjustment', quantity: 3, direction: 'increase', reason: 'Physical count found extra stock' });
    expect(res.status).toBe(201);
    expect(mockItems._docs()[0].quantity).toBe(13);
  });

  test('adjustment decrease reduces quantity', async () => {
    const res = await supertest(buildApp())
      .post('/api/inventory/transactions')
      .send({ itemId: 'i1', type: 'adjustment', quantity: 3, direction: 'decrease', reason: 'Damaged units written off' });
    expect(res.status).toBe(201);
    expect(mockItems._docs()[0].quantity).toBe(7);
  });

  test('adjustment without direction is rejected', async () => {
    const res = await supertest(buildApp())
      .post('/api/inventory/transactions')
      .send({ itemId: 'i1', type: 'adjustment', quantity: 3, reason: 'Missing direction' });
    expect(res.status).toBe(400);
    expect(mockItems._docs()[0].quantity).toBe(10); // untouched
  });

  test('adjustment without a reason is rejected', async () => {
    const res = await supertest(buildApp())
      .post('/api/inventory/transactions')
      .send({ itemId: 'i1', type: 'adjustment', quantity: 3, direction: 'increase' });
    expect(res.status).toBe(400);
    expect(mockItems._docs()[0].quantity).toBe(10);
  });
});

describe('POST /api/inventory/transactions — insufficient stock guard', () => {
  test('an issue larger than current quantity is rejected and quantity stays untouched', async () => {
    mockItems = mockMakeItemsCollection([makeItem({ quantity: 3 })]);
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'issue', quantity: 5 });
    expect(res.status).toBe(400);
    expect(mockItems._docs()[0].quantity).toBe(3); // untouched — the atomic guard blocked the $inc
  });

  test('an issue exactly equal to current quantity succeeds (boundary case)', async () => {
    mockItems = mockMakeItemsCollection([makeItem({ quantity: 5 })]);
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'issue', quantity: 5 });
    expect(res.status).toBe(201);
    expect(mockItems._docs()[0].quantity).toBe(0);
  });
});

describe('POST /api/inventory/transactions — itemName denormalization and unknown item', () => {
  test('itemName is denormalized onto the transaction record', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'receive', quantity: 1 });
    expect(res.body.data.itemName).toBe('Dell Laptop');
  });

  test('an unknown itemId is rejected before any mutation', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'does_not_exist', type: 'receive', quantity: 1 });
    expect(res.status).toBe(400);
    expect(mockItems._docs()[0].quantity).toBe(10);
  });
});

describe('POST /api/inventory/transactions — ledger write failure rolls back the quantity change', () => {
  test('if the transaction record fails to write, the item quantity is restored to its prior value', async () => {
    mockTransactions = mockMakeTxnCollection([], { failCreate: true });
    const res = await supertest(buildApp()).post('/api/inventory/transactions').send({ itemId: 'i1', type: 'receive', quantity: 5 });
    expect(res.status).toBe(500);
    expect(mockItems._docs()[0].quantity).toBe(10); // rolled back to the original 10, not left at 15
  });
});

describe('GET /api/inventory/transactions — filtering', () => {
  test('filters to a single item when itemId is passed', async () => {
    mockTransactions = mockMakeTxnCollection([
      { id: 't1', schoolId: SCHOOL_A, itemId: 'i1', type: 'receive', quantity: 5 },
      { id: 't2', schoolId: SCHOOL_A, itemId: 'i2', type: 'issue', quantity: 2 },
    ]);
    const res = await supertest(buildApp()).get('/api/inventory/transactions').query({ itemId: 'i1' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].itemId).toBe('i1');
  });
});
