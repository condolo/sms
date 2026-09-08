/* ============================================================
   Msingi — Invoice total math

   Extracted from finance.js (2026-09) so server/utils/admission-billing.js
   can generate an enrollment-triggered draft invoice with the exact same
   totals logic finance.js itself uses — one implementation, not two that
   could drift on rounding.
   ============================================================ */
'use strict';

/** Round to 2 decimal places to avoid floating-point drift */
function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Recalculate invoice totals from line items.
 * Returns: { subtotal, discountAmount, taxAmount, total }
 */
function calcInvoiceTotals(lineItems = [], discountPct = 0, taxPct = 0) {
  const subtotal       = round(lineItems.reduce((s, i) => s + round((i.unitPrice || 0) * (i.quantity || 1)), 0));
  const discountAmount = round(subtotal * (Math.min(Math.max(discountPct, 0), 100) / 100));
  const taxableAmount  = round(subtotal - discountAmount);
  const taxAmount      = round(taxableAmount * (Math.min(Math.max(taxPct, 0), 100) / 100));
  const total          = round(taxableAmount + taxAmount);
  return { subtotal, discountAmount, taxAmount, total };
}

module.exports = { round, calcInvoiceTotals };
