/* ============================================================
   Unit tests — server/utils/counters.js nextReceiptNumber's collision walk

   Reported 2026-11-01 from the bursar's phone: recording the first payment
   from the app filed a receipt numbered RCP-2026-000001 — a number the demo
   seed's own first receipt already held. Same drift as admission numbers
   (see admission-number-collision.test.js): the receipt counter only
   advances when a payment is filed through it, so seeded, imported and
   hand-numbered receipts leave it behind, and payments has no unique index
   on receiptNumber to catch the collision at the DB layer either.

   The real walk (not mocked away) against an in-memory stand-in for the
   'counters' collection, so a regression reintroduces a duplicate receipt
   number into a failing test rather than a school's counterfoil book.
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

const { nextReceiptNumber } = require('../utils/counters');

const YEAR = new Date().getFullYear();
const fmt  = (seq) => `RCP-${YEAR}-${String(seq).padStart(6, '0')}`;
const key  = (schoolId) => `receipt_${schoolId}_${YEAR}`;

// The demo school's ledger before the fix: 20 receipts numbered from the
// seed's own index, with a receipt counter that never heard about them.
const SEEDED = (count) => new Set(Array.from({ length: count }, (_, i) => fmt(i + 1)));

beforeEach(() => mockStore.clear());

describe('nextReceiptNumber with a taken-number check', () => {
  test('hands out the first number when nothing collides', async () => {
    expect(await nextReceiptNumber('sch_1', () => false)).toBe(fmt(1));
  });

  test('walks past a run of seeded receipts to the first free number', async () => {
    const taken = SEEDED(20);
    const receipt = await nextReceiptNumber('sch_1', n => taken.has(n));
    expect(receipt).toBe(fmt(21));
    expect(taken.has(receipt)).toBe(false);
  });

  test('stops the walk on the number it handed out — a receipt book has no gaps', async () => {
    const taken = SEEDED(20);
    await nextReceiptNumber('sch_1', n => taken.has(n));
    expect(mockStore.get(key('sch_1')).seq).toBe(21);
    // and the next receipt continues where the walk stopped
    expect(await nextReceiptNumber('sch_1', n => taken.has(n))).toBe(fmt(22));
  });

  test('throws rather than filing a duplicate after 200 taken numbers', async () => {
    await expect(nextReceiptNumber('sch_1', () => true)).rejects.toThrow(/free receipt number/);
  });

  test('two schools never share a sequence', async () => {
    const taken = SEEDED(5);
    const a = await nextReceiptNumber('sch_a', n => taken.has(n));
    const b = await nextReceiptNumber('sch_b', n => taken.has(n));
    expect(a).toBe(fmt(6));
    expect(b).toBe(fmt(6)); // independent per-school counters, not a shared one
  });

  test('a caller that passes no check gets the plain counter, as before', async () => {
    expect(await nextReceiptNumber('sch_1')).toBe(fmt(1));
    expect(await nextReceiptNumber('sch_1')).toBe(fmt(2));
  });
});
