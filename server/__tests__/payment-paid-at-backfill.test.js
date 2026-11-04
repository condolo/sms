/* ============================================================
   server/utils/payment-paid-at-backfill.js

   The demo seed wrote a receipt's date as `date` and never `paidAt`, while
   every read path sorts and range-filters on paidAt — so the bursar's
   "recent receipts" listed the oldest payments, and a dateFrom/dateTo range
   matched none of them. This backfill gives those rows a paidAt, runs on
   every startup, and is a no-op once nothing is missing.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

let mockStores;
let mockConnected;

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../config/db', () => ({ isConnected: () => mockConnected }));

const { backfillPaymentPaidAt, MIGRATION_KEY } = require('../utils/payment-paid-at-backfill');

/**
 * Fake payments collection. `{ paidAt: null }` in MongoDB matches both a null
 * and an absent field, and `$set` writes plain fields, so the fake mirrors just
 * enough of that for these tests to mean something.
 */
function makePayments(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const missingOrNull = (doc, key) => !(key in doc) || doc[key] === null || doc[key] === undefined;
  let findCalls = 0;
  return {
    _docs: () => docs,
    _findCalls: () => findCalls,
    find: (filter) => {
      findCalls++;
      const wantsPaidAtMissing = filter && 'paidAt' in filter && filter.paidAt === null;
      let rows = wantsPaidAtMissing ? docs.filter(d => missingOrNull(d, 'paidAt')) : docs;
      // The real chain is .select().limit().lean(); the backfill reads in
      // batches, so `limit` has to actually cut the result for these tests to
      // exercise the loop rather than a single pass.
      const chain = {
        select: () => chain,
        limit: (n) => { rows = rows.slice(0, n); return chain; },
        lean: () => Promise.resolve(rows),
      };
      return chain;
    },
    updateOne: jest.fn(async (filter, update) => {
      const doc = docs.find(d => d._id === filter._id);
      if (doc) Object.assign(doc, update.$set);
      return { modifiedCount: doc ? 1 : 0 };
    }),
  };
}

function makeMigrations() {
  const docs = [];
  return {
    _docs: () => docs,
    updateOne: jest.fn(async (filter, update) => {
      const doc = docs.find(d => d.key === filter.key);
      if (doc) Object.assign(doc, update.$set);
      else docs.push({ ...update.$set, key: filter.key });
      return { upsertedCount: 1 };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnected = true;
  mockStores = { payments: makePayments(), app_migrations: makeMigrations() };
});

describe('backfillPaymentPaidAt', () => {
  test('a seeded receipt that only recorded `date` gets a paidAt from it', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', receiptNumber: 'RCP-2026-000001', amount: 500,
        date: '2026-09-14T06:30:00.000Z', createdAt: '2026-10-19T19:55:25.522Z' },
    ]);

    const { updated } = await backfillPaymentPaidAt();

    expect(updated).toBe(1);
    expect(mockStores.payments._docs()[0].paidAt).toBe('2026-09-14T06:30:00.000Z');
  });

  test('falls back to the document timestamp when a row recorded no date at all', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', amount: 500, createdAt: '2026-10-19T19:55:25.522Z' },
    ]);

    const { updated } = await backfillPaymentPaidAt();

    expect(updated).toBe(1);
    expect(mockStores.payments._docs()[0].paidAt).toBe('2026-10-19T19:55:25.522Z');
  });

  test('writes a string, never a Date — paidAt is sliced as text by the payment route', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', amount: 500, date: new Date('2026-09-14T06:30:00.000Z'),
        createdAt: new Date('2026-10-19T19:55:25.522Z') },
    ]);

    await backfillPaymentPaidAt();

    const paidAt = mockStores.payments._docs()[0].paidAt;
    expect(typeof paidAt).toBe('string');
    expect(paidAt).toBe('2026-09-14T06:30:00.000Z');
    expect(paidAt.slice(0, 10)).toBe('2026-09-14'); // the early-payment deadline comparison
  });

  test('a receipt that already has paidAt is left exactly as it was', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', amount: 500, date: '2026-09-01T00:00:00.000Z',
        paidAt: '2026-09-05T11:11:11.000Z' },
    ]);

    const { updated } = await backfillPaymentPaidAt();

    expect(updated).toBe(0);
    expect(mockStores.payments._docs()[0].paidAt).toBe('2026-09-05T11:11:11.000Z');
    expect(mockStores.payments.updateOne).not.toHaveBeenCalled();
  });

  test('an explicit paidAt: null is healed too, and the second run does nothing', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', amount: 500, date: '2026-09-14T06:30:00.000Z', paidAt: null,
        createdAt: '2026-10-19T19:55:25.522Z' },
    ]);

    expect((await backfillPaymentPaidAt()).updated).toBe(1);
    expect((await backfillPaymentPaidAt()).updated).toBe(0);
    expect(mockStores.payments._docs()[0].paidAt).toBe('2026-09-14T06:30:00.000Z');
  });

  test('unparseable dates are left alone rather than given a wrong paidAt', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', amount: 500, date: 'not a date' },
    ]);

    const { updated } = await backfillPaymentPaidAt();

    expect(updated).toBe(0);
    expect(mockStores.payments._docs()[0].paidAt).toBeUndefined();
  });

  test('records the run in app_migrations for observability, without gating a later run', async () => {
    mockStores.payments = makePayments([
      { _id: 'p1', schoolId: 'sch_1', amount: 500, date: '2026-09-14T06:30:00.000Z' },
    ]);

    await backfillPaymentPaidAt();
    const recorded = mockStores.app_migrations._docs().find(d => d.key === MIGRATION_KEY);
    expect(recorded.documentsUpdatedLastRun).toBe(1);
    expect(recorded.lastRunAt).toBeTruthy();

    // the key exists now, and the next startup still heals a row seeded after it
    mockStores.payments = makePayments([
      { _id: 'p2', schoolId: 'sch_1', amount: 700, date: '2026-09-20T08:00:00.000Z' },
    ]);
    expect((await backfillPaymentPaidAt()).updated).toBe(1);
  });

  test('no database configured means nothing to migrate', async () => {
    mockConnected = false;
    await expect(backfillPaymentPaidAt()).resolves.toEqual({ skipped: true });
  });

  test('a ledger larger than one batch is repaired in bounded passes', async () => {
    // 600 rows against a 500-row batch: the loop must take more than one pass
    // and still date every receipt (this runs at boot on a real ledger).
    const seed = Array.from({ length: 600 }, (_, i) => ({
      _id: `p${i}`, schoolId: 'sch_1', amount: 100,
      date: '2026-09-14T06:30:00.000Z', createdAt: '2026-10-19T19:55:25.522Z',
    }));
    mockStores.payments = makePayments(seed);

    const { updated } = await backfillPaymentPaidAt();

    expect(updated).toBe(600);
    expect(mockStores.payments._docs().every(d => d.paidAt === '2026-09-14T06:30:00.000Z')).toBe(true);
    expect(mockStores.payments._findCalls()).toBeGreaterThan(1);
  });
});
