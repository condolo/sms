/* ============================================================
   Inventory milestone 1 — server/routes/inventory.js (Categories + Items)

   Covers: RBAC (nobody but admin/principal/deputy_principal gets the
   full 'inventory' grant by default — a teacher's inventory__requisition
   -only grant does NOT unlock category/item management), category
   auto-seeding, duplicate-name/duplicate-itemCode rejection, category
   deletion blocked while items still reference it, item deletion
   blocked once stock transactions exist, categoryName resolved
   server-side when the caller omits it, and quantity being stripped
   from PUT (it only ever moves through the transaction ledger).

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants, same discipline as the other milestone test files this
   session.

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
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    insertMany:       jest.fn((newDocs) => { docs.push(...newDocs); return Promise.resolve(newDocs); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    findOneAndDelete: jest.fn((filter) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) return Promise.resolve(null);
      return Promise.resolve(docs.splice(idx, 1)[0]);
    }),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

/* Matches repairPermissions.js's real defaults exactly. */
const mockRolePerms = {
  admin:   { inventory: ['read', 'create', 'update', 'delete'] },
  teacher: { inventory__requisition: ['read', 'create', 'update'] }, // no top-level 'inventory' key
};

let mockCategories, mockItems, mockTransactions;
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
    if (collection === 'inventory_categories')   return mockCategories;
    if (collection === 'inventory_items')        return mockItems;
    if (collection === 'inventory_transactions') return mockTransactions;
    return mockMakeFakeCollection([]);
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

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockCategories = mockMakeFakeCollection([]);
  mockItems = mockMakeFakeCollection([]);
  mockTransactions = mockMakeFakeCollection([]);
});

describe('GET /api/inventory/categories — auto-seed + RBAC', () => {
  test('auto-seeds the 7 default categories the first time a school has none', async () => {
    const res = await supertest(buildApp()).get('/api/inventory/categories');
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.name).sort()).toEqual(
      ['Cleaning', 'Furniture', 'ICT', 'Kitchen', 'Laboratory', 'Office', 'Sports'].sort()
    );
  });

  test('does not reseed once categories already exist', async () => {
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'Custom', isActive: true }]);
    const res = await supertest(buildApp()).get('/api/inventory/categories');
    expect(res.body.data.length).toBe(1);
  });

  test('a teacher (requisition-only grant, no top-level inventory key) is forbidden from listing categories', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/inventory/categories');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/inventory/categories', () => {
  test('rejects a duplicate name for the same school', async () => {
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'ICT', isActive: true }]);
    const res = await supertest(buildApp()).post('/api/inventory/categories').send({ name: 'ICT' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/inventory/categories/:id', () => {
  test('blocked while items still reference the category', async () => {
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'ICT', isActive: true }]);
    mockItems = mockMakeFakeCollection([{ id: 'i1', schoolId: SCHOOL_A, categoryId: 'c1', name: 'Laptop' }]);
    const res = await supertest(buildApp()).delete('/api/inventory/categories/c1');
    expect(res.status).toBe(400);
    expect(mockCategories._docs().length).toBe(1); // untouched
  });

  test('succeeds once no items reference it', async () => {
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'ICT', isActive: true }]);
    const res = await supertest(buildApp()).delete('/api/inventory/categories/c1');
    expect(res.status).toBe(200);
    expect(mockCategories._docs().length).toBe(0);
  });
});

describe('POST /api/inventory/items', () => {
  test('resolves categoryName server-side when the caller omits it', async () => {
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'ICT', isActive: true }]);
    const res = await supertest(buildApp())
      .post('/api/inventory/items')
      .send({ itemCode: 'ICT-001', name: 'Dell Laptop', categoryId: 'c1', quantity: 5, unit: 'pcs' });

    expect(res.status).toBe(201);
    expect(res.body.data.categoryName).toBe('ICT');
  });

  test('rejects an unknown categoryId', async () => {
    const res = await supertest(buildApp())
      .post('/api/inventory/items')
      .send({ itemCode: 'ICT-002', name: 'Projector', categoryId: 'does_not_exist' });
    expect(res.status).toBe(400);
  });

  test('rejects a duplicate itemCode for the same school', async () => {
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'ICT', isActive: true }]);
    mockItems = mockMakeFakeCollection([{ id: 'i1', schoolId: SCHOOL_A, itemCode: 'ICT-001', name: 'Existing' }]);
    const res = await supertest(buildApp())
      .post('/api/inventory/items')
      .send({ itemCode: 'ICT-001', name: 'Duplicate', categoryId: 'c1' });
    expect(res.status).toBe(409);
  });

  test('a teacher (requisition-only grant) is forbidden from creating an item', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    mockCategories = mockMakeFakeCollection([{ id: 'c1', schoolId: SCHOOL_A, name: 'ICT', isActive: true }]);
    const res = await supertest(buildApp())
      .post('/api/inventory/items')
      .send({ itemCode: 'ICT-003', name: 'Keyboard', categoryId: 'c1' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/inventory/items/:id — quantity is server-owned', () => {
  test('a quantity field in the request body is silently stripped, never applied directly', async () => {
    mockItems = mockMakeFakeCollection([{ id: 'i1', schoolId: SCHOOL_A, itemCode: 'ICT-001', name: 'Laptop', categoryId: 'c1', categoryName: 'ICT', quantity: 5, unit: 'pcs', status: 'active' }]);
    const res = await supertest(buildApp())
      .put('/api/inventory/items/i1')
      .send({ quantity: 999, location: 'ICT Store' });

    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(5); // unchanged — quantity moves only through transactions
    expect(res.body.data.location).toBe('ICT Store');
  });
});

describe('DELETE /api/inventory/items/:id', () => {
  test('blocked once the item has recorded stock transactions', async () => {
    mockItems = mockMakeFakeCollection([{ id: 'i1', schoolId: SCHOOL_A, name: 'Laptop' }]);
    mockTransactions = mockMakeFakeCollection([{ id: 't1', schoolId: SCHOOL_A, itemId: 'i1' }]);
    const res = await supertest(buildApp()).delete('/api/inventory/items/i1');
    expect(res.status).toBe(400);
    expect(mockItems._docs().length).toBe(1); // untouched
  });

  test('succeeds for an item with no transaction history', async () => {
    mockItems = mockMakeFakeCollection([{ id: 'i1', schoolId: SCHOOL_A, name: 'Laptop' }]);
    const res = await supertest(buildApp()).delete('/api/inventory/items/i1');
    expect(res.status).toBe(200);
    expect(mockItems._docs().length).toBe(0);
  });
});
