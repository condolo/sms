/* ============================================================
   Unit tests — server/utils/counters.js
   reserveFreeAdmissionNumbers / nextFreeAdmissionNumber (2026-09)

   Reported directly: two students with the exact same admission number,
   auto-generated with no error or warning at all. Root cause: the
   atomic counter and real usage can drift apart — a manually-supplied
   admission number (an existing student imported with their real-world
   number, or a manual override on individual enrollment) never advances
   the counter (see setAdmissionCounter's own comment, "only sets... for
   migrations"). Left unchecked, the counter can later hand out a number
   that's already taken — students_admission is a lookup index, not a
   unique one, so nothing at the DB layer stops it either.

   These tests exercise the REAL skip-and-retry logic (not mocked away)
   against an in-memory stand-in for the 'counters' collection, so a
   regression in the walk-past-a-collision behavior actually fails a
   test rather than silently reintroducing the duplicate.
   ============================================================ */

// In-memory stand-in for the 'counters' collection — a Map keyed by
// counter name, mirroring the real { _id, seq } document shape closely
// enough for findOneAndUpdate's $inc/upsert semantics.
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

const { reserveFreeAdmissionNumbers, nextFreeAdmissionNumber } = require('../utils/counters');

// Plain 5-digit numbers, no prefix/year — matches a school that imported
// its own pre-existing admission numbers rather than using Msingi's
// legacy ADM-{year}-{seq} default.
const cfg = { prefix: '', padding: 5, yearInPrefix: false };

beforeEach(() => mockStore.clear());

describe('reserveFreeAdmissionNumbers / nextFreeAdmissionNumber', () => {
  test('hands out the next number untouched when nothing collides', async () => {
    const num = await nextFreeAdmissionNumber('sch_1', cfg, () => false);
    expect(num).toBe('00001');
  });

  test('skips a run of already-used numbers to find the first free one', async () => {
    // Simulates the exact drift that caused the real duplicate: the
    // counter has never been told that 00001-00003 are already taken
    // (e.g. imported manually), so it must walk past all three.
    const taken = new Set(['00001', '00002', '00003']);
    const num = await nextFreeAdmissionNumber('sch_1', cfg, n => taken.has(n));
    expect(num).toBe('00004');
    expect(taken.has(num)).toBe(false);
  });

  test('reserving a batch skips collisions and still returns the full requested count, all unique', async () => {
    const taken = new Set(['00002', '00004']);
    const nums = await reserveFreeAdmissionNumbers('sch_1', 3, cfg, n => taken.has(n));
    expect(nums).toHaveLength(3);
    expect(new Set(nums).size).toBe(3); // no internal duplicates
    for (const n of nums) expect(taken.has(n)).toBe(false);
  });

  test('throws rather than looping forever when nothing is ever free', async () => {
    await expect(
      reserveFreeAdmissionNumbers('sch_1', 1, cfg, () => true) // everything reports as taken
    ).rejects.toThrow(/Could not reserve/);
  });

  test('two schools never share a sequence', async () => {
    const a = await nextFreeAdmissionNumber('sch_a', cfg, () => false);
    const b = await nextFreeAdmissionNumber('sch_b', cfg, () => false);
    expect(a).toBe('00001');
    expect(b).toBe('00001'); // independent per-school counters, not a shared one
  });
});
