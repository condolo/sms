'use strict';

/* Self-healing backfill: give every payment a `paidAt`, the only date field any
   read path sorts or range-filters on.

   Runs on every startup, recorded in app_migrations for observability only
   (lastRunAt / documentsUpdatedLastRun), never as a gate — the same shape as
   finance-permission-backfill.js, so a school whose receipts were written
   before this field existed gets healed on the next boot instead of staying
   out of order forever. Each run after that is a single indexed no-op.

   Reported 2026-11-01 while walking the bursar's phone screens: the demo seed
   wrote `date` and never `paidAt`, so all 23 seeded receipts tied on a missing
   sort key and GET /api/finance/payments returned them in insertion order — the
   finance overview's "recent receipts" panel listed the oldest payments — while
   a dateFrom/dateTo range matched none of them. */

const { _model } = require('./model');
const { isConnected } = require('../config/db');

const MIGRATION_KEY = 'payment_paid_at_v1';

/**
 * @returns {Promise<{skipped: true} | {updated: number}>}
 */
async function backfillPaymentPaidAt() {
  if (!isConnected()) return { skipped: true }; // no database configured: nothing to migrate

  // `{ paidAt: null }` matches both null and absent in MongoDB, so a row that
  // stored the field explicitly as null is healed too.
  //
  // Batched rather than one find(): it runs at boot on a production ledger, and
  // loading every undated receipt at once is a memory spike nobody asked for.
  // Each batch repairs itself out of the filter, so no cursor state is needed;
  // the loop stops if a pass repairs nothing (rows carrying neither a usable
  // `date` nor a `createdAt` would otherwise match forever).
  const Payments = _model('payments');
  const BATCH = 500;
  let updated = 0;

  for (let pass = 0; pass < 200; pass++) {
    const rows = await Payments.find({ paidAt: null })
      .select('date createdAt').limit(BATCH).lean();
    if (!rows.length) break;

    let repairedThisPass = 0;
    for (const row of rows) {
      // `date` is what the seed wrote; createdAt is the document's own timestamp,
      // always present, so a row with neither still gets a defensible paidAt
      // rather than staying invisible to every date-ranged query.
      const paidAt = _asIso(row.date) || _asIso(row.createdAt);
      if (!paidAt) continue;
      await Payments.updateOne({ _id: row._id }, { $set: { paidAt } });
      repairedThisPass++; updated++;
    }

    if (repairedThisPass === 0 || rows.length < BATCH) break;
  }

  const Migrations = _model('app_migrations');
  await Migrations.updateOne(
    { key: MIGRATION_KEY },
    { $set: { key: MIGRATION_KEY, lastRunAt: new Date().toISOString(), documentsUpdatedLastRun: updated } },
    { upsert: true },
  );
  return { updated };
}

/** paidAt is read as a string everywhere (`effectivePaidAt.slice(0, 10)` in
 *  finance.js), so a Date object would break the early-payment deadline
 *  comparison. Normalise, and reject anything unparseable. */
function _asIso(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

module.exports = { backfillPaymentPaidAt, MIGRATION_KEY };
