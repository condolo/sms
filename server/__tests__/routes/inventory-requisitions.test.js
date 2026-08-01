/* ============================================================
   Inventory milestone 3 — server/routes/inventory.js (Requisitions +
   Procurement)

   The real workflow-config.js module is NOT mocked — getWorkflowConfig/
   saveWorkflowConfig/resolveStep/resolveAssigneeLabel all run for real
   against fake workflow_configs/users/custom_roles collections, same
   discipline as hr-leave-workflow.test.js (the precedent this reuse is
   built on) not stubbing away the engine it's supposed to prove works.

   Covers: RBAC on create/list, self-scoping (a requester sees only
   their own requisitions, a manager sees all), the currentStepOrder
   state machine (approve advances or clears the chain, reject requires
   a reason and stops it), the workflow-step eligibility check (NOT an
   RBAC gate — a non-eligible authenticated user is 403'd even with a
   valid inventory grant), and /fulfill (blocked until 'approved',
   creates a real receive transaction, updates item quantity, marks the
   requisition 'fulfilled').

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
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (Array.isArray(doc[k]) && !Array.isArray(v)) return doc[k].includes(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    create:           jest.fn((doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return Promise.resolve(d); }),
    findOneAndUpdate: jest.fn((filter, update, opts = {}) => {
      let idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx === -1) {
        if (!opts.upsert) return mockChainObj(null);
        docs.push({ ...filter }); idx = docs.length - 1;
      }
      // Must handle $inc and $set independently (and combined) — the
      // fulfill route sends both in the same update, and a $set-only
      // branch would silently drop the $inc half (caught by this test
      // suite's own fulfill test failing on quantity before this fix).
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) docs[idx][k] = (docs[idx][k] ?? 0) + v;
      if (update.$set) Object.assign(docs[idx], update.$set);
      if (!update.$inc && !update.$set) Object.assign(docs[idx], update);
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

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'], name: 'Admin User' };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const mockRolePerms = {
  admin:   { inventory: ['read', 'create', 'update', 'delete'] },
  teacher: { inventory__requisition: ['read', 'create', 'update'] },
  finance: { finance: ['read', 'create', 'update', 'delete'] }, // no inventory grant at all
};

let mockReqs, mockItems, mockTxns, mockDepartments, mockWorkflowConfigs, mockUsers, mockCustomRoles;
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
    if (collection === 'inventory_requisitions') return mockReqs;
    if (collection === 'inventory_items')        return mockItems;
    if (collection === 'inventory_transactions') return mockTxns;
    if (collection === 'departments')            return mockDepartments;
    if (collection === 'workflow_configs')       return mockWorkflowConfigs;
    if (collection === 'users')                  return mockUsers;
    if (collection === 'custom_roles')           return mockCustomRoles;
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

function makeItem(overrides = {}) {
  return { id: 'i1', schoolId: SCHOOL_A, itemCode: 'ICT-001', name: 'Dell Laptop', categoryId: 'c1', categoryName: 'ICT', quantity: 10, unit: 'pcs', status: 'active', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'], name: 'Admin User' };
  mockReqs = mockMakeFakeCollection([]);
  mockItems = mockMakeFakeCollection([makeItem()]);
  mockTxns = mockMakeFakeCollection([]);
  mockDepartments = mockMakeFakeCollection([]);
  mockWorkflowConfigs = mockMakeFakeCollection([]);
  mockUsers = mockMakeFakeCollection([
    { id: 'usr_admin', schoolId: SCHOOL_A, name: 'Admin User', role: 'admin', isActive: true },
    { id: 'usr_finance', schoolId: SCHOOL_A, name: 'Finance Person', role: 'finance', isActive: true },
    { id: 'usr_teacher', schoolId: SCHOOL_A, name: 'A Teacher', role: 'teacher', isActive: true },
  ]);
  mockCustomRoles = mockMakeFakeCollection([]);
});

describe('POST /api/inventory/requisitions — RBAC', () => {
  test('admin can raise a requisition', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemId: 'i1', description: 'Need more laptops', quantity: 2 });
    expect(res.status).toBe(201);
  });

  test('a teacher (requisition-only grant) can also raise one', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], name: 'A Teacher' };
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemId: 'i1', description: 'Need more laptops', quantity: 2 });
    expect(res.status).toBe(201);
  });

  test('a role with no inventory grant at all is forbidden', async () => {
    mockJwtUser = { userId: 'usr_finance', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'], name: 'Finance Person' };
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemId: 'i1', description: 'Need more laptops', quantity: 2 });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/inventory/requisitions — denormalization and no-config state', () => {
  test('itemName is resolved server-side when omitted', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemId: 'i1', description: 'Need more laptops', quantity: 2 });
    expect(res.body.data.itemName).toBe('Dell Laptop');
  });

  test('a brand-new item request (no itemId) is accepted with a free-text itemName', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemName: 'Interactive Whiteboard', description: 'For Grade 7 classroom', quantity: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.itemId).toBeUndefined();
  });

  test('with no workflow config, currentStepOrder is null', async () => {
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemId: 'i1', description: 'Need more laptops', quantity: 2 });
    expect(res.body.data.currentStepOrder).toBeNull();
    expect(res.body.data.status).toBe('pending');
  });

  test('with a workflow config, currentStepOrder starts at 1', async () => {
    mockWorkflowConfigs = mockMakeFakeCollection([{ id: 'wfc', schoolId: SCHOOL_A, workflowKey: 'inventory_requisition', steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }] }]);
    const res = await supertest(buildApp()).post('/api/inventory/requisitions').send({ itemId: 'i1', description: 'Need more laptops', quantity: 2 });
    expect(res.body.data.currentStepOrder).toBe(1);
  });
});

describe('GET /api/inventory/requisitions — self-scoping', () => {
  beforeEach(() => {
    mockReqs = mockMakeFakeCollection([
      { id: 'r1', schoolId: SCHOOL_A, requesterId: 'usr_teacher', description: 'A', quantity: 1, unit: 'pcs', status: 'pending', createdAt: '2026-01-01' },
      { id: 'r2', schoolId: SCHOOL_A, requesterId: 'usr_admin',   description: 'B', quantity: 1, unit: 'pcs', status: 'pending', createdAt: '2026-01-02' },
    ]);
  });

  test('a teacher (requisition-only grant) sees only their own requisitions', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], name: 'A Teacher' };
    const res = await supertest(buildApp()).get('/api/inventory/requisitions');
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].requesterId).toBe('usr_teacher');
  });

  test('admin (full inventory grant) sees every requisition', async () => {
    const res = await supertest(buildApp()).get('/api/inventory/requisitions');
    expect(res.body.data.length).toBe(2);
  });
});

describe('PATCH /api/inventory/requisitions/:id/advance — workflow-step eligibility, not RBAC', () => {
  function seedPendingReq(overrides = {}) {
    mockReqs = mockMakeFakeCollection([{ id: 'r1', schoolId: SCHOOL_A, requesterId: 'usr_teacher', itemName: 'Dell Laptop', description: 'x', quantity: 2, unit: 'pcs', status: 'pending', currentStepOrder: 1, ...overrides }]);
  }

  test('a non-eligible authenticated user is 403 even with a valid inventory grant', async () => {
    mockWorkflowConfigs = mockMakeFakeCollection([{ id: 'wfc', schoolId: SCHOOL_A, workflowKey: 'inventory_requisition', steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }] }]);
    seedPendingReq();
    // admin has full inventory RBAC but is NOT resolved as the 'finance' step
    const res = await supertest(buildApp()).patch('/api/inventory/requisitions/r1/advance').send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  test('the resolved step approver can approve a single-step chain — requisition becomes approved', async () => {
    mockWorkflowConfigs = mockMakeFakeCollection([{ id: 'wfc', schoolId: SCHOOL_A, workflowKey: 'inventory_requisition', steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }] }]);
    seedPendingReq();
    mockJwtUser = { userId: 'usr_finance', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'], name: 'Finance Person', email: 'f@x.io' };

    const res = await supertest(buildApp()).patch('/api/inventory/requisitions/r1/advance').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  test('approving a non-final step just advances currentStepOrder and stays pending', async () => {
    mockWorkflowConfigs = mockMakeFakeCollection([{
      id: 'wfc', schoolId: SCHOOL_A, workflowKey: 'inventory_requisition',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }, { order: 2, assigneeType: 'role', assigneeValue: 'admin' }],
    }]);
    seedPendingReq();
    mockJwtUser = { userId: 'usr_finance', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'], name: 'Finance Person', email: 'f@x.io' };

    const res = await supertest(buildApp()).patch('/api/inventory/requisitions/r1/advance').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.currentStepOrder).toBe(2);
  });

  test('rejecting without a reason is rejected (the request itself, ironically, is not)', async () => {
    mockWorkflowConfigs = mockMakeFakeCollection([{ id: 'wfc', schoolId: SCHOOL_A, workflowKey: 'inventory_requisition', steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }] }]);
    seedPendingReq();
    mockJwtUser = { userId: 'usr_finance', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'], name: 'Finance Person', email: 'f@x.io' };

    const res = await supertest(buildApp()).patch('/api/inventory/requisitions/r1/advance').send({ status: 'rejected' });
    expect(res.status).toBe(400);
  });

  test('rejecting with a reason sets status to rejected', async () => {
    mockWorkflowConfigs = mockMakeFakeCollection([{ id: 'wfc', schoolId: SCHOOL_A, workflowKey: 'inventory_requisition', steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }] }]);
    seedPendingReq();
    mockJwtUser = { userId: 'usr_finance', schoolId: SCHOOL_A, role: 'finance', roles: ['finance'], name: 'Finance Person', email: 'f@x.io' };

    const res = await supertest(buildApp()).patch('/api/inventory/requisitions/r1/advance').send({ status: 'rejected', notes: 'Budget not available' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });

  test('no workflow config at all — advance is rejected with a clear message', async () => {
    seedPendingReq({ currentStepOrder: null });
    const res = await supertest(buildApp()).patch('/api/inventory/requisitions/r1/advance').send({ status: 'approved' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/inventory/requisitions/:id/fulfill — Procurement receipt', () => {
  test('blocked until the requisition is approved', async () => {
    mockReqs = mockMakeFakeCollection([{ id: 'r1', schoolId: SCHOOL_A, itemId: 'i1', quantity: 2, unit: 'pcs', status: 'pending' }]);
    const res = await supertest(buildApp()).post('/api/inventory/requisitions/r1/fulfill');
    expect(res.status).toBe(400);
    expect(mockItems._docs()[0].quantity).toBe(10); // untouched
  });

  test('an approved requisition can be fulfilled — creates a receive transaction and updates the item', async () => {
    mockReqs = mockMakeFakeCollection([{ id: 'r1', schoolId: SCHOOL_A, itemId: 'i1', quantity: 3, unit: 'pcs', status: 'approved' }]);
    const res = await supertest(buildApp()).post('/api/inventory/requisitions/r1/fulfill');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('fulfilled');
    expect(mockItems._docs()[0].quantity).toBe(13); // 10 + 3
    expect(mockTxns._docs().length).toBe(1);
    expect(mockTxns._docs()[0]).toEqual(expect.objectContaining({ type: 'receive', quantity: 3, itemId: 'i1', requisitionId: 'r1' }));
  });

  test('a requester without inventory:transact access is forbidden from fulfilling', async () => {
    mockReqs = mockMakeFakeCollection([{ id: 'r1', schoolId: SCHOOL_A, itemId: 'i1', quantity: 3, unit: 'pcs', status: 'approved' }]);
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'], name: 'A Teacher' };
    const res = await supertest(buildApp()).post('/api/inventory/requisitions/r1/fulfill');
    expect(res.status).toBe(403);
  });
});

describe('GET/PUT /api/inventory/requisitions/workflow-config', () => {
  test('GET returns an empty steps array when nothing is configured yet', async () => {
    const res = await supertest(buildApp()).get('/api/inventory/requisitions/workflow-config');
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toEqual([]);
  });

  test('PUT saves a valid single-step chain (schools may configure as few as one approver)', async () => {
    const res = await supertest(buildApp())
      .put('/api/inventory/requisitions/workflow-config')
      .send({ steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'finance' }], notifyOnly: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.steps.length).toBe(1);
  });

  test('PUT rejects an empty steps array', async () => {
    const res = await supertest(buildApp())
      .put('/api/inventory/requisitions/workflow-config')
      .send({ steps: [], notifyOnly: [] });
    expect(res.status).toBe(400);
  });
});
