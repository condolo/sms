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
 * Generate a formatted invoice number.
 * Format: INV-{year}-{6-digit seq}, e.g. INV-2026-000001
 */
async function nextInvoiceNumber(schoolId) {
  const year = new Date().getFullYear();
  const seq  = await nextId(`invoice_${schoolId}_${year}`);
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Generate a receipt number for payments.
 * Format: RCP-{year}-{6-digit seq}, e.g. RCP-2026-000001
 */
async function nextReceiptNumber(schoolId) {
  const year = new Date().getFullYear();
  const seq  = await nextId(`receipt_${schoolId}_${year}`);
  return `RCP-${year}-${String(seq).padStart(6, '0')}`;
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

module.exports = {
  nextId,
  peekAdmissionCounter,
  setAdmissionCounter,
  peekId,
  nextAdmissionNumber,
  nextStaffId,
  nextInvoiceNumber,
  nextReceiptNumber,
  reserveRange,
  reserveAdmissionNumbers,
  reserveStaffIds,
  reserveInvoiceNumbers,
};
