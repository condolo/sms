/* ============================================================
   Msingi — Atomic Sequential ID Counter
   Uses MongoDB findOneAndUpdate with $inc for race-safe counters.

   Counter documents in the 'counters' collection:
   { _id: "admission_sch_abc_2026", seq: 42 }

   Usage:
     const { nextId } = require('../utils/counters');
     const seq = await nextId(`admission_${schoolId}_${year}`);
     const admNo = `ADM-${year}-${String(seq).padStart(5, '0')}`;
   ============================================================ */
const mongoose = require('mongoose');

/* Lazy model for counters collection */
let CounterModel;
function _getModel() {
  if (CounterModel) return CounterModel;
  if (mongoose.models.Counter) return mongoose.models.Counter;
  const schema = new mongoose.Schema(
    { _id: String, seq: { type: Number, default: 0 } },
    { _id: false, versionKey: false }
  );
  CounterModel = mongoose.model('Counter', schema, 'counters');
  return CounterModel;
}

/**
 * Atomically increment and return the next sequence number for a named counter.
 * Creates the counter at 1 if it doesn't exist yet.
 *
 * @param {string} name - Unique counter name, e.g. "admission_sch_abc_2026"
 * @returns {Promise<number>} The next sequence number
 */
async function nextId(name) {
  const Counter = _getModel();
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
}

/**
 * Peek at the current value without incrementing.
 * Returns 0 if counter doesn't exist.
 */
async function peekId(name) {
  const Counter = _getModel();
  const doc = await Counter.findOne({ _id: name }).lean();
  return doc?.seq || 0;
}

/* ── Admission number helpers ────────────────────────────────── */

/**
 * admissionConfig shape (stored on school document):
 *   prefix      {string}  — e.g. 'MLA-33' or '' for number-only  (default '')
 *   padding     {number}  — digit count, e.g. 4 → '0298'         (default 5)
 *   yearInPrefix{boolean} — append current year to prefix         (default true)
 *
 * Generated format examples:
 *   prefix='MLA-33', padding=4                → MLA-330298
 *   prefix='',       padding=5                → 00298
 *   prefix='KPS/',   padding=5, yearInPrefix  → KPS/2026/00001  (if prefix already has slash)
 *   no config (legacy)                        → ADM-2026-00001
 */
function _admCounterKey(schoolId, cfg = {}) {
  if (cfg.yearInPrefix !== false) {
    // Default behaviour (yearInPrefix true or unset): year-scoped counter — matches legacy keys
    return `admission_${schoolId}_${new Date().getFullYear()}`;
  }
  return `admission_${schoolId}`;
}

function _formatAdmNo(seq, cfg = {}) {
  const yearInPrefix = cfg.yearInPrefix !== false;
  const padding      = cfg.padding ?? 5;
  const num          = String(seq).padStart(padding, '0');

  if (cfg.prefix !== undefined) {
    // School has explicitly configured a prefix (may be empty string)
    if (yearInPrefix) {
      return `${cfg.prefix}${new Date().getFullYear()}-${num}`;
    }
    return `${cfg.prefix}${num}`;
  }
  // Legacy default: ADM-{year}-{num}
  return `ADM-${new Date().getFullYear()}-${num}`;
}

/**
 * Generate the next admission number for a school.
 * Pass admissionConfig from school document to use custom prefix/padding.
 * Omit cfg to use the legacy ADM-{year}-{seq} format.
 */
async function nextAdmissionNumber(schoolId, cfg = {}) {
  const seq = await nextId(_admCounterKey(schoolId, cfg));
  return _formatAdmNo(seq, cfg);
}

/**
 * Peek at the current counter value without incrementing.
 * Returns { seq, nextFormatted } for UI display.
 */
async function peekAdmissionCounter(schoolId, cfg = {}) {
  const seq = await peekId(_admCounterKey(schoolId, cfg));
  return { seq, nextFormatted: _formatAdmNo(seq + 1, cfg) };
}

/**
 * Explicitly set the admission counter to a value (for migrations / imports).
 * Only sets if value > current seq to prevent accidental resets; pass force=true to override.
 */
async function setAdmissionCounter(schoolId, value, cfg = {}, force = false) {
  const Counter = _getModel();
  const key     = _admCounterKey(schoolId, cfg);
  if (force) {
    await Counter.findOneAndUpdate({ _id: key }, { $set: { seq: value } }, { upsert: true });
  } else {
    // Only advance — never go backwards without explicit force flag
    await Counter.findOneAndUpdate(
      { _id: key, $or: [{ seq: { $lt: value } }, { seq: { $exists: false } }] },
      { $set: { seq: value } },
      { upsert: false }
    );
    // If doc didn't exist yet, create it
    await Counter.findOneAndUpdate({ _id: key }, { $setOnInsert: { seq: value } }, { upsert: true });
  }
  return peekAdmissionCounter(schoolId, cfg);
}

/**
 * Generate a formatted staff ID for a teacher/staff member.
 * Format: STF-{year}-{5-digit seq}, e.g. STF-2026-00001
 */
async function nextStaffId(schoolId) {
  const year = new Date().getFullYear();
  const seq  = await nextId(`staff_${schoolId}_${year}`);
  return `STF-${year}-${String(seq).padStart(5, '0')}`;
}

/**
 * Shared walk for the numbered documents whose counter can drift behind the
 * data — receipts and invoices. Take the next number; if the caller says this
 * school already holds it, take the next one.
 *
 * The drift is structural: `nextId` only advances when *this* function is
 * called, so any row written another way — the demo seed numbering documents
 * from its own index, a CSV import, a school continuing a paper counterfoil
 * book — leaves the counter behind, and the next number handed out is one the
 * ledger already holds. Neither collection has a unique index on its number, so
 * nothing at the DB layer stops it either. Same drift, same remedy as
 * reserveFreeAdmissionNumbers above.
 *
 * One number per attempt, so walking past a taken run costs one indexed lookup
 * per number but never reserves further than it consumes — a book that skips
 * from 000021 to 000040 with nothing in between is an audit question a bursar
 * should not have to answer. Bounded rather than infinite, in case every
 * candidate really is taken.
 *
 * @param {string}   key      the counter's document id
 * @param {(seq:number) => string} fmt
 * @param {((n:string) => boolean|Promise<boolean>)} [isTaken]  omit for the old, unchecked behaviour
 */
async function _nextFreeNumber(key, fmt, isTaken, label, schoolId) {
  if (!isTaken) return fmt(await nextId(key));
  for (let attempt = 0; attempt < 200; attempt++) {
    const candidate = fmt(await nextId(key));
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free ${label} number for school ${schoolId} — check the ${label} counter state`);
}

/**
 * Generate a formatted invoice number.
 * Format: INV-{year}-{6-digit seq}, e.g. INV-2026-000001
 *
 * @param {string} schoolId
 * @param {(invoiceNumber: string) => boolean|Promise<boolean>} [isTaken]
 *        See _nextFreeNumber. Pass it on every path that files a real invoice.
 */
async function nextInvoiceNumber(schoolId, isTaken) {
  const year = new Date().getFullYear();
  return _nextFreeNumber(
    `invoice_${schoolId}_${year}`,
    (seq) => `INV-${year}-${String(seq).padStart(6, '0')}`,
    isTaken, 'invoice', schoolId,
  );
}

/**
 * Generate a receipt number for payments.
 * Format: RCP-{year}-{6-digit seq}, e.g. RCP-2026-000001
 *
 * @param {string} schoolId
 * @param {(receiptNumber: string) => boolean|Promise<boolean>} [isTaken]
 *        See _nextFreeNumber. Pass it on every path that files a real receipt.
 */
async function nextReceiptNumber(schoolId, isTaken) {
  const year = new Date().getFullYear();
  return _nextFreeNumber(
    `receipt_${schoolId}_${year}`,
    (seq) => `RCP-${year}-${String(seq).padStart(6, '0')}`,
    isTaken, 'receipt', schoolId,
  );
}

/**
 * Atomically reserve a contiguous range of N sequence numbers in a single DB round-trip.
 * Returns the FIRST number in the range; caller uses start, start+1, ... start+n-1.
 *
 * Example: reserveRange('admission_sch_abc_2026', 500)
 *   → counter goes from 0 → 500 in one $inc, returns 1
 *   → caller generates ADM-2026-00001 … ADM-2026-00500
 *
 * @param {string} name   Counter name
 * @param {number} count  Number of IDs to reserve (must be >= 1)
 * @returns {Promise<number>} First sequence number in the range
 */
async function reserveRange(name, count) {
  if (!count || count < 1) count = 1;
  const Counter = _getModel();
  // $inc by count → new seq = end of range; first = newSeq - count + 1
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: count } },
    { upsert: true, new: true }
  );
  return doc.seq - count + 1;
}

/**
 * Reserve a batch of formatted admission numbers in one DB call.
 * Pass admissionConfig from school document to use custom prefix/padding.
 */
async function reserveAdmissionNumbers(schoolId, count, cfg = {}) {
  const start = await reserveRange(_admCounterKey(schoolId, cfg), count);
  return Array.from({ length: count }, (_, i) => _formatAdmNo(start + i, cfg));
}

/**
 * Reserve a batch of formatted staff IDs in one DB call.
 */
async function reserveStaffIds(schoolId, count) {
  const year  = new Date().getFullYear();
  const start = await reserveRange(`staff_${schoolId}_${year}`, count);
  return Array.from({ length: count }, (_, i) =>
    `STF-${year}-${String(start + i).padStart(5, '0')}`
  );
}

/**
 * Reserve a batch of formatted invoice numbers in one DB call.
 */
async function reserveInvoiceNumbers(schoolId, count) {
  const year  = new Date().getFullYear();
  const start = await reserveRange(`invoice_${schoolId}_${year}`, count);
  return Array.from({ length: count }, (_, i) =>
    `INV-${year}-${String(start + i).padStart(6, '0')}`
  );
}

/**
 * Reserve `count` invoice numbers, skipping any this school already holds.
 * The bulk counterpart of nextInvoiceNumber's walk, and the same shape as
 * reserveFreeAdmissionNumbers: one round-trip reserves the whole range in the
 * common case, and only a collision costs another round — which also leaves the
 * counter past the drifted run for next time.
 *
 * @param {string} schoolId
 * @param {number} count
 * @param {(invoiceNumber: string) => boolean|Promise<boolean>} isTaken
 *        Pass a Set.has bound function when the caller already loaded the
 *        existing numbers (bulk import); an async DB lookup for a small batch.
 * @returns {Promise<string[]>}
 */
async function reserveFreeInvoiceNumbers(schoolId, count, isTaken) {
  const out = [];
  let remaining = count;
  let round = 0;
  // Bounded: each round only repeats because a collision was found, so this
  // only loops long if the counter is drifting deep into used territory.
  while (remaining > 0 && round < 20) {
    round++;
    for (const candidate of await reserveInvoiceNumbers(schoolId, remaining)) {
      if (await isTaken(candidate)) continue; // already issued — walk past it
      out.push(candidate);
    }
    remaining = count - out.length;
  }
  if (out.length < count) {
    throw new Error(`Could not reserve enough free invoice numbers for school ${schoolId} — check the invoice counter state`);
  }
  return out;
}

/**
 * Reserve `count` admission numbers, skipping any that collide with an
 * already-used one. Needed because the counter and real usage can drift
 * apart: a manually-supplied admission number (an existing student
 * imported with their real-world number, or a manual override on
 * individual enrollment) never advances this counter — see
 * setAdmissionCounter's own comment ("only sets... for migrations"). Left
 * unchecked, the counter can later hand out a number that's already taken,
 * producing a genuine duplicate student record (students_admission is a
 * lookup index, not a unique one, so nothing at the DB layer would stop it).
 *
 * Reserves the full range in one round-trip in the common case (no
 * collisions); only takes extra rounds — walking further past the
 * counter's current position — when a reserved number turns out to
 * already be in use, which also self-heals the drift for next time.
 *
 * @param {string} schoolId
 * @param {number} count
 * @param {object} cfg        admissionConfig from the school document
 * @param {(admissionNumber: string) => boolean|Promise<boolean>} isTaken
 *        Checked against existing students. Pass a Set.has bound function
 *        when the caller already loaded every existing number (bulk
 *        import); pass an async DB lookup for a single-record create.
 * @returns {Promise<string[]>}
 */
async function reserveFreeAdmissionNumbers(schoolId, count, cfg, isTaken) {
  const out = [];
  let remaining = count;
  let round = 0;
  // Bounded rather than infinite: each round only repeats because a
  // collision was found, so this only loops long if the counter is
  // drifting deep into already-used territory — 20 rounds is far more
  // than any realistic amount of drift would ever need.
  while (remaining > 0 && round < 20) {
    round++;
    const batch = await reserveAdmissionNumbers(schoolId, remaining, cfg);
    for (const candidate of batch) {
      if (await isTaken(candidate)) continue; // already used — walk past it
      out.push(candidate);
    }
    remaining = count - out.length;
  }
  if (out.length < count) {
    throw new Error('Could not reserve enough free admission numbers — check admissionConfig/counter state');
  }
  return out;
}

/** Single-number convenience wrapper around reserveFreeAdmissionNumbers. */
async function nextFreeAdmissionNumber(schoolId, cfg, isTaken) {
  const [num] = await reserveFreeAdmissionNumbers(schoolId, 1, cfg, isTaken);
  return num;
}

module.exports = {
  nextId,
  peekAdmissionCounter,
  setAdmissionCounter,
  peekId,
  nextAdmissionNumber,
  nextFreeAdmissionNumber,
  reserveFreeAdmissionNumbers,
  nextStaffId,
  nextInvoiceNumber,
  nextReceiptNumber,
  reserveRange,
  reserveAdmissionNumbers,
  reserveStaffIds,
  reserveInvoiceNumbers,
  reserveFreeInvoiceNumbers,
};
