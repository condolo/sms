/* ============================================================
   InnoLearn — Atomic Sequential ID Counter
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

/**
 * Generate a formatted admission number for a student.
 * Format: ADM-{year}-{5-digit seq}, e.g. ADM-2026-00001
 */
async function nextAdmissionNumber(schoolId) {
  const year = new Date().getFullYear();
  const seq  = await nextId(`admission_${schoolId}_${year}`);
  return `ADM-${year}-${String(seq).padStart(5, '0')}`;
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

module.exports = {
  nextId,
  peekId,
  nextAdmissionNumber,
  nextStaffId,
  nextInvoiceNumber,
  nextReceiptNumber
};
