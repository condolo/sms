/* ============================================================
   server/routes/import-export.js — GET /export/payroll
   (Payroll Phase 1, Step 8)

   moduleRegistry.js already declared hr.payroll_export with no
   implementing route (a real, pre-existing gap flagged in
   docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §10). This wires it
   into the existing generic CSV export route rather than building a
   bespoke new endpoint — same file, same toCSV helper, same pattern
   every other export type already uses.

   The one thing genuinely new here (not just "another type"): payroll
   export is gated on its own dedicated sub-permission ('payroll_export'
   under 'hr'), not the generic 'read' every other export type uses —
   verified below by spying on the exact (module, action, subKey) rbac()
   is invoked with. Uses rbac()'s subKey mechanism (server/middleware/
   rbac.js) rather than a standalone action string, so it falls back to
   plain hr:read until a school explicitly narrows it via Settings →
   Roles & Permissions instead of being ungrantable by default.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return {
    select: () => chain(result),
    sort:   (spec) => chain(Array.isArray(result) ? _sortDocs(result, spec) : result),
    lean:   () => Promise.resolve(result),
  };
}
function _sortDocs(docs, spec) {
  const [[field, dir]] = Object.entries(spec);
  return [...docs].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir);
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    find: (filter) => chain(docs.filter(d => matches(d, filter))),
  };
}

let mockStores;
let mockCurrentUser;
let mockRbacDeny;
const mockRbacCalls = [];

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: (mod, action, subKey) => (_req, res, next) => {
    mockRbacCalls.push(subKey ? [mod, action, subKey] : [mod, action]);
    if (mockRbacDeny) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'denied' } });
    next();
  },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const express        = require('express');
const supertest       = require('supertest');
const importExportRouter = require('../../routes/import-export');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRbacCalls.length = 0;
  mockRbacDeny = false;
  mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [], name: 'HR Person', email: 'hr@x.io' };
  mockStores = {
    payroll: makeStore([
      {
        id: 'pay_1', schoolId: SCHOOL, staffId: 'u_staff_1', staffName: 'Staff One',
        payPeriod: '2026-07', basicSalary: 50000, allowances: 5000, deductions: 2000,
        statutoryDeductions: { paye: 4000, nssf: 1200, shif: 1375, housingLevy: 750, total: 7325 },
        totalDeductions: 9325, grossSalary: 55000, netSalary: 45675,
        currency: 'KES', status: 'confirmed', updatedAt: '2026-07-20T10:00:00.000Z',
      },
      {
        id: 'pay_2', schoolId: SCHOOL, staffId: 'u_staff_2', staffName: 'Staff Two',
        payPeriod: '2026-06', basicSalary: 40000, allowances: 0, deductions: 0,
        statutoryDeductions: null, totalDeductions: 0, grossSalary: 40000, netSalary: 40000,
        currency: 'KES', status: 'paid', updatedAt: '2026-06-20T10:00:00.000Z',
      },
    ]),
  };
});

describe('GET /api/import-export/export/payroll', () => {
  test('exports a CSV with statutory columns flattened out of statutoryDeductions', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/import-export/export/payroll');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('msingi_payroll_');

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('staffId,staffName,payPeriod,basicSalary,allowances,deductions,paye,nssf,shif,housingLevy,totalDeductions,grossSalary,netSalary,currency,status,updatedAt');
    expect(lines).toHaveLength(3); // header + 2 records
    expect(lines.some(l => l.includes('u_staff_1') && l.includes('4000') && l.includes('45675'))).toBe(true);
  });

  test('a record with no statutoryDeductions (applyStatutory:false) leaves those columns blank, not "0"', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/import-export/export/payroll');
    const lines = res.text.trim().split('\n');
    const row2 = lines.find(l => l.includes('u_staff_2'));
    // paye/nssf/shif/housingLevy columns (positions 7-10) should be empty, not 0
    const cols = row2.split(',');
    expect(cols.slice(6, 10)).toEqual(['', '', '', '']);
  });

  test('an optional ?period filter narrows the export and is reflected in the filename', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/import-export/export/payroll').query({ period: '2026-07' });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('2026-07');
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 matching record
    expect(lines[1]).toContain('u_staff_1');
  });

  test('is gated on the dedicated hr.payroll_export sub-permission, not plain hr.read', async () => {
    const app = buildApp();
    await supertest(app).get('/api/import-export/export/payroll');
    expect(mockRbacCalls).toContainEqual(['hr', 'read', 'payroll_export']);
    expect(mockRbacCalls).not.toContainEqual(['hr', 'read']);
  });

  test('a denied rbac check blocks the export entirely — no CSV body is sent', async () => {
    mockRbacDeny = true;
    const app = buildApp();
    const res = await supertest(app).get('/api/import-export/export/payroll');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).not.toContain('text/csv');
  });

  test('the existing students/teachers/etc. export types are unaffected — still gated on the generic read action', async () => {
    mockStores.students = makeStore([]);
    mockStores.classes  = makeStore([]);
    const app = buildApp();
    await supertest(app).get('/api/import-export/export/classes');
    expect(mockRbacCalls).toContainEqual(['classes', 'read']);
  });
});
