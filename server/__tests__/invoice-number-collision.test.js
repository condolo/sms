/* ============================================================
   Unit tests — server/utils/counters.js invoice-number collision walk

   The invoice side of the drift that made the bursar's first app payment
   duplicate a seeded receipt number (see receipt-number-collision.test.js).
   The invoice counter is only advanced by the paths that draw from it, so the
   demo seed's 26 invoices, opening-balance imports and hand-numbered
   historical rows all leave it behind — and invoices has no unique index on
   invoiceNumber, so nothing at the DB layer stops the collision either.
   (It is deliberately not unique: a school whose history already holds a
   repeat must still be able to build its indexes.)

   Covers both shapes of the fix: nextInvoiceNumber's single walk and
   reserveFreeInvoiceNumbers' batch walk, which the two importers use.

   The real walk (not mocked away) against an in-memory stand-in for the
   'counters' collection.
   ============================================================ */
'use strict';

const mockStore = new Map();

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {}, // force _getModel() through mongoose.model() every time it isn't already cached
    model: jest.fn(() => ({
      findOneAndUpdate: jest.fn(async (filter, update) => {
        const id  = filter._id;
        const cur = mockStore.get(id) ?? { _id: id, seq: 0 };
        cur.seq  += update.$inc.seq;
        mockStore.set(id, cur);
        return { ...cur };
      }),
    })),
  };
});

const { nextInvoiceNumber, reserveFreeInvoiceNumbers } = require('../utils/counters');

const YEAR = new Date().getFullYear();
const fmt  = (seq) => `INV-${YEAR}-${String(seq).padStart(6, '0')}`;
const key  = (schoolId) => `invoice_${schoolId}_${YEAR}`;

// A school that arrived with paper history: invoices already numbered from 1
// by whoever exported the old system, with a counter that never heard of them.
const SEEDED = (count) => new Set(Array.from({ length: count }, (_, i) => fmt(i + 1)));

beforeEach(() => mockStore.clear());

describe('nextInvoiceNumber with a taken-number check', () => {
  test('hands out the first number when nothing collides', async () => {
    expect(await nextInvoiceNumber('sch_1', () => false)).toBe(fmt(1));
  });

  test('walks past a run of hand-numbered invoices to the first free number', async () => {
    const taken = SEEDED(26);
    const invoice = await nextInvoiceNumber('sch_1', n => taken.has(n));
    expect(invoice).toBe(fmt(27));
    expect(taken.has(invoice)).toBe(false);
  });

  test('stops the walk on the number it handed out — no gap, and it self-heals', async () => {
    const taken = SEEDED(26);
    await nextInvoiceNumber('sch_1', n => taken.has(n));
    expect(mockStore.get(key('sch_1')).seq).toBe(27);
    // and the next invoice continues where the walk stopped
    expect(await nextInvoiceNumber('sch_1', n => taken.has(n))).toBe(fmt(28));
  });

  test('throws rather than filing a duplicate after 200 taken numbers', async () => {
    await expect(nextInvoiceNumber('sch_1', () => true)).rejects.toThrow(/free invoice number/);
  });

  test('two schools never share a sequence', async () => {
    const taken = SEEDED(5);
    const a = await nextInvoiceNumber('sch_a', n => taken.has(n));
    const b = await nextInvoiceNumber('sch_b', n => taken.has(n));
    expect(a).toBe(fmt(6));
    expect(b).toBe(fmt(6)); // independent per-school counters, not a shared one
  });

  test('a caller that passes no check gets the plain counter, as before', async () => {
    expect(await nextInvoiceNumber('sch_1')).toBe(fmt(1));
    expect(await nextInvoiceNumber('sch_1')).toBe(fmt(2));
  });
});

describe('reserveFreeInvoiceNumbers (the bulk path the importers use)', () => {
  test('reserves the whole batch in one round when nothing collides', async () => {
    const taken = new Set();
    const batch = await reserveFreeInvoiceNumbers('sch_1', 3, n => taken.has(n));
    expect(batch).toEqual([fmt(1), fmt(2), fmt(3)]);
    expect(mockStore.get(key('sch_1')).seq).toBe(3);
  });

  test('walks past a drifted run and still returns the full count', async () => {
    const taken = SEEDED(10);
    const batch = await reserveFreeInvoiceNumbers('sch_1', 3, n => taken.has(n));
    expect(batch).toEqual([fmt(11), fmt(12), fmt(13)]);
  });

  test('never returns the same number twice, even across rounds', async () => {
    // Every number from 1-10 and 13-20 is taken, so a 5-number batch needs a
    // second round; the round-1 range and the round-2 range must not overlap.
    const taken = new Set([...Array.from({ length: 10 }, (_, i) => fmt(i + 1)),
                           ...Array.from({ length: 8 },  (_, i) => fmt(i + 13))]);
    const batch = await reserveFreeInvoiceNumbers('sch_1', 5, n => taken.has(n));
    expect(batch).toHaveLength(5);
    expect(new Set(batch).size).toBe(5);
    for (const n of batch) expect(taken.has(n)).toBe(false);
  });

  test('throws rather than handing back a short batch', async () => {
    await expect(reserveFreeInvoiceNumbers('sch_1', 3, () => true)).rejects.toThrow(/enough free invoice numbers/);
  });

  test('a count of zero touches the counter not at all', async () => {
    const batch = await reserveFreeInvoiceNumbers('sch_1', 0, () => false);
    expect(batch).toEqual([]);
    expect(mockStore.size).toBe(0);
  });
});
