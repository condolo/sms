'use strict';

/* Self-healing backfill: give every existing role and per-user override
   that holds a finance action the matching explicit finance sub-permission
   (see middleware/explicit-sub.js). Without this, the explicit checks
   would refuse bursars who can use these actions today.

   Runs on every startup, not just once (2026-10-13 — see below for why),
   recorded in app_migrations for observability only (lastRunAt/
   documentsUpdatedLastRun), never as a gate. It never overwrites a key
   that is already set, so a grant an administrator changed on purpose is
   left alone — each run is a cheap, idempotent no-op for every role that's
   already correct, and only ever fills a genuinely missing key.

   Previously gated behind a one-time app_migrations flag ("run once per
   database, skip forever after"). Reported directly: a school's admin/
   principal/deputy_principal/finance/deputy roles had a real `finance`
   grant but none of the 3 explicit sub-keys, and Roles & Permissions
   could never save as a result (nothing — not even an admin — could ever
   hold an action nothing had ever granted them). The one-time design
   assumed every school's role_permissions docs already existed in their
   final form at the moment the migration first ran — false for any role
   whose coarse `finance` grant was set (or a role_permissions doc
   created) after that point, which then could never be caught, since the
   flag permanently skipped the entire function regardless of what was
   still missing. Removing the flag's gating effect (keeping it only as a
   timestamp/count for diagnostics) makes this scan-and-fill-gaps
   behavior, not a one-shot migration. */

const { _model } = require('./model');
const { isConnected } = require('../config/db');
const { withFinanceSubGrants, FINANCE_SUB_GRANTS } = require('../middleware/explicit-sub');

const MIGRATION_KEY = 'finance_sub_permissions_v1';

async function backfillFinanceSubPermissions() {
  if (!isConnected()) return { skipped: true }; // no database configured: nothing to migrate

  const RolePerms = _model('role_permissions');
  const docs = await RolePerms.find({ 'permissions.finance': { $exists: true } }).lean();

  let updated = 0;
  for (const doc of docs) {
    const before = doc.permissions || {};
    const after  = withFinanceSubGrants(before);
    const $set = {};
    for (const key of Object.keys(FINANCE_SUB_GRANTS)) {
      if (!Array.isArray(before[key]) && Array.isArray(after[key])) {
        $set[`permissions.${key}`] = after[key];
      }
    }
    if (Object.keys($set).length) {
      await RolePerms.updateOne({ _id: doc._id }, { $set });
      updated++;
    }
  }

  const Migrations = _model('app_migrations');
  await Migrations.updateOne(
    { key: MIGRATION_KEY },
    { $set: { key: MIGRATION_KEY, lastRunAt: new Date().toISOString(), documentsUpdatedLastRun: updated } },
    { upsert: true },
  );
  return { updated };
}

module.exports = { backfillFinanceSubPermissions, MIGRATION_KEY };
