/* ============================================================
   POST /api/import-export/finance — audit logging
   (cross-module import parity audit, 2026-08)

   Root cause: finance.js's own POST /invoices and POST
   /fee-structures/:id/generate both log every invoice-creating action
   (finance.invoice_created / finance.bulk_invoices_generated) — the
   Finance import handler created real invoice + payment documents with
   no audit trail at all. Same fix, same "one summary entry per batch"
   choice bulk_invoices_generated already made for its equivalent case.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) ?? null),
    insertMany: async (newDocs) => { docs.push(...newDocs); return newDocs; },
    _docs: () => docs,
  };
}

const SCHOOL = 'school_test_001';
let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((col) => mockStores[col]),
}));
jest.mock('../../utils/counters', () => ({
  reserveAdmissionNumbers: jest.fn(),
  reserveStaffIds: jest.fn(),
  reserveInvoiceNumbers: jest.fn((schoolId, n) => Promise.resolve(Array.from({ length: n }, (_, i) => `INV-${i + 1}`))),
}));

const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const express   = require('express');
const supertest = require('supertest');
const importExportRouter = require('../../routes/import-export');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockStores = {
    students: makeStore([{ id: 'stu_1', schoolId: SCHOOL, admissionNumber: 'ADM-2026-001', firstName: 'Amara', lastName: 'Osei' }]),
    invoices: makeStore([]),
    payments: makeStore([]),
  };
});

test('a finance import that creates invoices logs finance.invoices_imported', async () => {
  const res = await supertest(buildApp())
    .post('/api/import-export/finance')
    .set('Content-Type', 'application/json')
    .send({ rows: [{ admissionNumber: 'ADM-2026-001', title: 'Term 1 Fees', description: 'Tuition', amount: '45000', amountPaid: '20000' }] });

  expect(res.status).toBe(201);
  expect(mockStores.invoices._docs()).toHaveLength(1);
  expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
    action: 'finance.invoices_imported',
    schoolId: SCHOOL,
    details: expect.objectContaining({ invoicesCreated: 1, paymentsCreated: 1 }),
  }));
});

test('a finance import where every row fails (unmatched admissionNumber) logs nothing', async () => {
  const res = await supertest(buildApp())
    .post('/api/import-export/finance')
    .set('Content-Type', 'application/json')
    .send({ rows: [{ admissionNumber: 'NOT-A-REAL-STUDENT', title: 'Term 1 Fees', description: 'Tuition', amount: '45000' }] });

  expect(res.body.data.created).toBe(0);
  expect(mockAuditLog).not.toHaveBeenCalled();
});
