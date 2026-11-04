/* ============================================================
   GET /api/finance/invoices and /payments — skip-paging must not
   repeat or drop rows.

   Reported 2026-11-01 from the bursar's phone: the ledger asked for 20
   invoices at a time and page 2 handed back three rows page 1 had already
   shown, while three other invoices never appeared in any page. Not a
   client bug — the route sorted on createdAt alone, and the demo school's
   invoices were bulk-written inside one millisecond, so 16 rows share a
   sort value. MongoDB gives tied documents no defined order between two
   queries, so the second page is a reshuffled window over a different
   order. A sort that includes a unique key (_id) is a total order, which
   is what these tests pin down.

   The fake collection below reproduces the server's behaviour rather than
   JavaScript's: it sorts by the keys the route asked for, then rotates any
   run of still-tied documents by the skip it was given — "arbitrary order,
   and a different one per query". With the old single-key sort that loses
   rows; it cannot with a total order.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_paging';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_bursar', schoolId: SCHOOL, role: 'finance', roles: ['finance'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => true),
  hasPermission: () => true,
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockInvoices = [];
let mockPayments = [];
jest.mock('../../utils/tenant-model', () => {
  const actual = jest.requireActual('../../utils/tenant-model');
  return {
    ...actual,
    tenantModel: (col, ctx) => {
      if (col === 'invoices') return mockPagingStore(() => mockInvoices);
      if (col === 'payments') return mockPagingStore(() => mockPayments);
      return actual.tenantModel(col, ctx);
    },
  };
});

const express   = require('express');
const supertest = require('supertest');
const financeRouter = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRouter);
  return app;
}

/** Compare two docs on the sort keys the route declared. */
function compare(a, b, entries) {
  for (const [key, dir] of entries) {
    const av = a[key] ?? null;
    const bv = b[key] ?? null;
    const asc = av === bv ? 0 : av === null ? -1 : bv === null ? 1 : av < bv ? -1 : 1;
    if (asc !== 0) return dir === -1 ? -asc : asc;
  }
  return 0;
}

/**
 * Order rows the way a real mongod does for this query: honour the declared
 * sort keys, and leave everything still tied in an order that varies from one
 * query to the next. `skip` is the only thing that varies between the two page
 * requests, so it stands in for the server's arbitrary tie order.
 */
function orderLikeMongo(rows, spec, skip) {
  const entries = Object.entries(spec || {});
  const sorted = rows.slice().sort((a, b) => compare(a, b, entries));
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && compare(sorted[i], sorted[j], entries) === 0) j++;
    const run = sorted.slice(i, j);
    const rotate = run.length > 1 ? skip % run.length : 0;
    out.push(...run.slice(rotate), ...run.slice(0, rotate));
    i = j;
  }
  return out;
}

function mockPagingStore(rowsOf) {
  return {
    find: (filter) => {
      const matched = rowsOf().filter(d => d.schoolId === filter.schoolId);
      let spec = {};
      let skip = 0;
      let limit = matched.length;
      const chain = {
        sort: (s) => { spec = s; return chain; },
        skip: (n) => { skip = n; return chain; },
        limit: (n) => { limit = n; return chain; },
        select: () => chain,
        lean: () => Promise.resolve(orderLikeMongo(matched, spec, skip).slice(skip, skip + limit)),
      };
      return chain;
    },
    countDocuments: async (filter) => rowsOf().filter(d => d.schoolId === filter.schoolId).length,
    findOne: () => ({ lean: () => Promise.resolve(null) }),
  };
}

// Twenty-six invoices, the size the walk hit, written in four batches — exactly
// how a school ends up with ties: one bulk fee-structure generate, or a seed.
const BATCHES = ['2026-10-19T19:55:25.521Z', '2026-10-19T19:55:25.522Z', '2026-10-19T19:55:25.523Z', '2026-10-20T10:32:34.095Z'];
const SIZES   = [1, 16, 3, 6];

beforeEach(() => {
  let n = 0;
  mockInvoices = [];
  SIZES.forEach((size, batch) => {
    for (let i = 0; i < size; i++) {
      n++;
      mockInvoices.push({
        id: `inv_${String(n).padStart(3, '0')}`,
        _id: `oid_${String(n).padStart(3, '0')}`,
        schoolId: SCHOOL,
        invoiceNumber: `INV-2026-${String(n).padStart(6, '0')}`,
        status: 'unpaid',
        total: 1000,
        balance: 1000,
        createdAt: BATCHES[batch],
      });
    }
  });
  // Twenty-three receipts, none with a paidAt — the shape every seeded ledger
  // had before the backfill, so all of them tie on the sort key.
  mockPayments = Array.from({ length: 23 }, (_, i) => ({
    id: `pay_${String(i + 1).padStart(3, '0')}`,
    _id: `poid_${String(i + 1).padStart(3, '0')}`,
    schoolId: SCHOOL,
    receiptNumber: `RCP-2026-${String(i + 1).padStart(6, '0')}`,
    amount: 500,
    date: BATCHES[i % BATCHES.length],
  }));
});

/** Walk the list the way an infinite-scroll client does. */
async function walkAll(path, pageSize) {
  const seen = [];
  const meta = [];
  for (let page = 1; page <= 10; page++) {
    const res = await supertest(buildApp()).get(`${path}?page=${page}&limit=${pageSize}`);
    expect(res.status).toBe(200);
    const rows = res.body.data ?? [];
    meta.push(res.body.pagination);
    seen.push(...rows.map(r => r.id));
    if (rows.length === 0) break;
  }
  return { seen, meta };
}

describe('GET /finance/invoices paging', () => {
  test('every invoice comes back exactly once across the pages the app walks', async () => {
    const { seen, meta } = await walkAll('/api/finance/invoices', 20);

    expect(new Set(seen).size).toBe(seen.length);            // no row on two pages
    expect(seen).toHaveLength(26);                            // none unreachable
    expect(new Set(seen).size).toBe(mockInvoices.length);
    expect(meta[0].total).toBe(26);
  });

  test('the order is stable between page requests', async () => {
    const first  = await supertest(buildApp()).get('/api/finance/invoices?page=1&limit=20');
    const again  = await supertest(buildApp()).get('/api/finance/invoices?page=1&limit=20');
    const second = await supertest(buildApp()).get('/api/finance/invoices?page=2&limit=20');

    expect(first.body.data.map(i => i.id)).toEqual(again.body.data.map(i => i.id));
    const page1 = new Set(first.body.data.map(i => i.id));
    for (const invoice of second.body.data) expect(page1.has(invoice.id)).toBe(false);
  });

  test('the sort is a total order, so any page window is well-defined', async () => {
    const res = await supertest(buildApp()).get('/api/finance/invoices?page=2&limit=20');
    // newest-first stays newest-first; a tie would let an older batch sit
    // beside a newer one in unpredictable order.
    const stamps = res.body.data.map(i => i.createdAt);
    expect(stamps).toEqual([...stamps].sort().reverse());
  });
});

describe('GET /finance/payments paging', () => {
  test('every receipt comes back exactly once, even with no paidAt on any of them', async () => {
    const { seen } = await walkAll('/api/finance/payments', 20);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(mockPayments.length);
  });

  test('no receipt appears on both pages', async () => {
    const first  = await supertest(buildApp()).get('/api/finance/payments?page=1&limit=20');
    const second = await supertest(buildApp()).get('/api/finance/payments?page=2&limit=20');
    const page1 = new Set(first.body.data.map(p => p.id));
    for (const payment of second.body.data) expect(page1.has(payment.id)).toBe(false);
  });
});
