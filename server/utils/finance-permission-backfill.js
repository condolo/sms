'use strict';

/* One-time backfill: give every existing role and per-user override that holds
   a finance action the matching explicit finance sub-permission (see
   middleware/explicit-sub.js). Without this, the new checks would refuse
   bursars who can use these actions today.

   Runs once per database, recorded in app_migrations. It never overwrites a
   key that is already set, so a grant an administrator changed on purpose is
   left alone. A failed run is not recorded and runs again at the next start. */

const { _model } = require('./model');
const { isConnected } = require('../config/db');
const { withFinanceSubGrants, FINANCE_SUB_GRANTS } = require('../middleware/explicit-sub');

const MIGRATION_KEY = 'finance_sub_permissions_v1';

async function backfillFinanceSubPermissions() {
  if (!isConnected()) return { skipped: true }; // no database configured: nothing to migrate
  const Migrations = _model('app_migrations');
  const done = await Migrations.findOne({ key: MIGRATION_KEY }).lean();
  if (done) return { skipped: true };

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

  await Migrations.updateOne(
    { key: MIGRATION_KEY },
    { $set: { key: MIGRATION_KEY, appliedAt: new Date().toISOString(), documentsUpdated: updated } },
    { upsert: true },
  );
  return { updated };
}

module.exports = { backfillFinanceSubPermissions, MIGRATION_KEY };
