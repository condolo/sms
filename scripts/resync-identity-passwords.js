/**
 * resync-identity-passwords.js — repairs identities.passwordHash for users
 * whose linked identity's password fell out of sync with users.password.
 *
 * Root cause this fixes (server/utils/provision-identities.js, already
 * patched so it can't happen again going forward): provisionIdentityForUser
 * upserts an Identity by {orgId, email}. If an Identity doc already existed
 * for that email (e.g. left behind by a user account that was later deleted
 * — DELETE /api/platform/orphans only ever touched `users`, never
 * `identities`), the old $setOnInsert-only upsert matched the existing doc
 * and silently skipped refreshing passwordHash. A brand new user recreated
 * with that email got identityId pointed at the stale doc, and org-login
 * (which checks identities.passwordHash exclusively) rejected their real,
 * freshly-generated password.
 *
 * The provisioning bug is fixed for every FUTURE account creation. This
 * script repairs already-broken records: for every user with identityId
 * set, if identities.passwordHash != users.password (null-normalized),
 * overwrite the identity's passwordHash (and mfaEnabled) with the user's —
 * same fields provisionIdentityForUser now keeps in sync, applied directly.
 *
 * Idempotent, safe to re-run. Reuses qa-health.js's own detection query
 * (_checkPasswordHashMismatch) so this script and the health-check gate
 * agree on what "broken" means.
 *
 * Usage:
 *   node scripts/resync-identity-passwords.js              # execute
 *   node scripts/resync-identity-passwords.js --dry-run    # preview only
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Users      = _model('users');
  const Identities = _model('identities');

  const linked = await Users.find({ identityId: { $exists: true, $ne: null } })
    .select('id email password identityId mfaEnabled').lean();
  console.log(`Users with a linked identity: ${linked.length}`);

  const ids = [...new Set(linked.map(u => u.identityId))];
  const identities = await Identities.find({ id: { $in: ids } }).select('id passwordHash mfaEnabled').lean();
  const byId = Object.fromEntries(identities.map(i => [i.id, i]));

  const mismatches = linked.filter(u => {
    const identity = byId[u.identityId];
    if (!identity) return false; // dangling FK — a different problem, not this script's job
    return identity.passwordHash !== (u.password ?? null);
  });

  console.log(`Password-hash mismatches found: ${mismatches.length}\n`);

  for (const u of mismatches) {
    console.log(`  ${u.email || u.id} → identity ${u.identityId}`);
    if (!DRY_RUN) {
      await Identities.updateOne(
        { id: u.identityId },
        { $set: { passwordHash: u.password ?? null, mfaEnabled: u.mfaEnabled ?? null, updatedAt: new Date().toISOString() } }
      );
    }
  }

  await mongoose.disconnect();
  console.log(DRY_RUN ? '\n[DRY RUN] No changes were written.' : `\nDone. ${mismatches.length} identity record(s) resynced.`);
}

run().catch(err => { console.error(err); process.exit(1); });
