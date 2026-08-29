/**
 * create-platform-operator.js — Security Baseline Register, PLAT-01.
 *
 * Creates (or updates the tier/name of) a named platform_operators
 * account. This is the replacement for the single shared
 * PLATFORM_ADMIN_USER/PLATFORM_ADMIN_PASS_HASH credential —
 * server/routes/platform.js's login route checks platform_operators
 * FIRST and only falls back to the legacy env-var credential while
 * platform_operators is empty (see that route's own comment). The
 * moment this script creates the first operator, the env-var path
 * stops being reachable at all — no separate "now delete the old
 * credential" step required.
 *
 * Two tiers (matching the register's own stated scope):
 *   support — read-only: can view schools/organizations/billing/stats,
 *             cannot impersonate, delete a school, or grant entitlements.
 *   owner   — full access, same capability the shared credential always had.
 *
 * The generated password is shown ONCE, on this terminal, and is never
 * written to any log file or stored anywhere in plaintext — copy it
 * immediately. Re-running for an existing email updates name/tier only;
 * pass --reset-password explicitly to issue that account a new one (so
 * running this script again by habit can never silently lock out or
 * silently rotate someone else's working credential).
 *
 * Usage:
 *   node scripts/create-platform-operator.js --name "Jane Doe" --email jane@msingi.io --tier owner
 *   node scripts/create-platform-operator.js --name "Jane Doe" --email jane@msingi.io --tier support
 *   node scripts/create-platform-operator.js --email jane@msingi.io --reset-password
 *   node scripts/create-platform-operator.js ... --dry-run
 */
'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

function _arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const DRY_RUN        = process.argv.includes('--dry-run');
const RESET_PASSWORD = process.argv.includes('--reset-password');
const name  = _arg('name');
const email = (_arg('email') || '').trim().toLowerCase();
const tier  = _arg('tier') || 'support'; // safer default — owner must be explicit

function _model(col) {
  const modelName = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                        .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(modelName, schema, col);
}

function _genPassword() {
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}
function _uid() {
  return `plop_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

async function run() {
  if (!email) {
    console.error('Usage: node scripts/create-platform-operator.js --name "Jane Doe" --email jane@msingi.io --tier owner|support [--dry-run]');
    console.error('       node scripts/create-platform-operator.js --email jane@msingi.io --reset-password [--dry-run]');
    process.exit(1);
  }
  if (!['owner', 'support'].includes(tier)) {
    console.error(`--tier must be "owner" or "support", got: ${tier}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'innolearn' });
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Operators = _model('platform_operators');
  const existing = await Operators.findOne({ email }).lean();

  if (existing && !RESET_PASSWORD) {
    console.log(`Operator already exists: ${existing.name} <${existing.email}> [${existing.tier}]`);
    const update = {};
    if (name && name !== existing.name) update.name = name;
    if (tier && tier !== existing.tier) update.tier = tier;
    if (Object.keys(update).length === 0) {
      console.log('No changes (name/tier match what is already stored). Pass --reset-password to issue a new password.');
    } else {
      console.log(`Would update: ${JSON.stringify(update)}`);
      if (!DRY_RUN) {
        await Operators.updateOne({ email }, { $set: { ...update, updatedAt: new Date().toISOString() } });
        console.log('Updated.');
      }
    }
    await mongoose.disconnect();
    return;
  }

  if (existing && RESET_PASSWORD) {
    const newPassword = _genPassword();
    console.log(`Resetting password for ${existing.name} <${existing.email}> [${existing.tier}]`);
    if (!DRY_RUN) {
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await Operators.updateOne({ email }, { $set: { passwordHash, updatedAt: new Date().toISOString() } });
    }
    console.log(`\nNew password (shown once — copy now, not stored anywhere in plaintext):\n  ${DRY_RUN ? '(dry run — not generated for real)' : newPassword}\n`);
    await mongoose.disconnect();
    return;
  }

  // New operator.
  if (!name) {
    console.error('--name is required when creating a new operator.');
    process.exit(1);
  }
  const password = _genPassword();
  console.log(`Creating operator: ${name} <${email}> [${tier}]`);
  if (!DRY_RUN) {
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    await Operators.create({
      id: _uid(), name, email, tier, passwordHash,
      isActive: true, lastLoginAt: null, createdAt: now, updatedAt: now,
    });
  }
  console.log(`\nPassword (shown once — copy now, not stored anywhere in plaintext):\n  ${DRY_RUN ? '(dry run — not generated for real)' : password}\n`);
  console.log('Once any operator exists, the legacy PLATFORM_ADMIN_USER/PLATFORM_ADMIN_PASS_HASH credential stops working — this is the first and only time that happens automatically, with no separate cleanup step.');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
