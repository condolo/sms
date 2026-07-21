/**
 * recover-purged-superadmins.js — one-off recovery for the DELETE /orphans
 * incident (2026-07-21, fixed in server/routes/platform.js).
 *
 * That bug deleted valid superadmin `users` docs whose personal email
 * differed from their school's `adminEmail` contact field, even though
 * their schoolId pointed at a real, active school. This recreates the
 * specific accounts it deleted:
 *   - Collins Odhiambo <collins.odhiambo@trinitasinternationalschool.sc.ke>
 *     as superadmin at Trinity International SChool + Trinitas International SChool
 *   - c.ndolo@mla.ac.ke as superadmin at Demo school + Masict Lab
 *
 * Deleted passwords are unrecoverable (never backed up in plaintext) —
 * every recreated account gets a fresh random temp password and
 * mustChangePassword:true, forcing a real password on first login.
 *
 * Idempotent: skips any (email, schoolId) pair that already has a
 * superadmin user. Safe to re-run.
 *
 * When two target schools for the same person share one organization,
 * both accounts get the SAME identityId (one shared login/password
 * across those schools, matching the platform's Unified Identity model)
 * instead of going through the normal collision_pending path — this is
 * the explicit human confirmation ("these are definitely the same
 * person") that path exists to require, given directly by this recovery
 * script's author (you, running it) rather than inferred automatically.
 *
 * Usage:
 *   node scripts/recover-purged-superadmins.js              # execute
 *   node scripts/recover-purged-superadmins.js --dry-run    # preview only
 */
'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { provisionIdentityForUser } = require('../server/utils/provision-identities');

const DRY_RUN = process.argv.includes('--dry-run');

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

function _genPassword() {
  // 16 random bytes, base64url — short enough to type/copy, no ambiguous chars issue since it's copy-pasted, not hand-typed
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

function _uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

/* Each target: which schools (matched by case-insensitive substring on
   name) should have a superadmin account for this person. */
const TARGETS = [
  {
    label: 'Collins Odhiambo',
    email: 'collins.odhiambo@trinitasinternationalschool.sc.ke',
    name:  'Collins Odhiambo',
    schoolMatches: ['trinity international', 'trinitas international'],
  },
  {
    label: 'Platform operator (c.ndolo)',
    email: 'c.ndolo@mla.ac.ke',
    name:  'Collins Ndolo',
    schoolMatches: ['demo', 'masict'],
  },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Schools = _model('schools');
  const Users   = _model('users');

  const created = [];
  const skipped = [];
  const notFound = [];

  for (const target of TARGETS) {
    console.log(`\n== ${target.label} <${target.email}> ==`);

    // Resolve schools for this target by case-insensitive name substring match.
    const matchedSchools = [];
    for (const term of target.schoolMatches) {
      const school = await Schools.findOne({
        name: { $regex: term, $options: 'i' },
        isActive: { $ne: false },
      }).lean();
      if (school) matchedSchools.push(school);
      else notFound.push({ target: target.label, term });
    }

    if (matchedSchools.length === 0) {
      console.log(`  No matching schools found for terms: ${target.schoolMatches.join(', ')} — skipping.`);
      continue;
    }

    let sharedIdentityId = null;
    let sharedOrgId      = null;

    for (const school of matchedSchools) {
      const email = target.email.toLowerCase();
      const existing = await Users.findOne({ schoolId: school.id, email, role: 'superadmin' }).lean();
      if (existing) {
        console.log(`  [SKIP] ${school.name} (${school.id}) — superadmin already exists (id=${existing.id})`);
        skipped.push({ school: school.name, email });
        continue;
      }

      const tempPassword = _genPassword();
      const userId = _uid('u_recovered');
      const now = new Date().toISOString();

      const userDoc = {
        id: userId,
        schoolId: school.id,
        name: target.name,
        email,
        role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
        isActive: true,
        mustChangePassword: true,
        createdAt: now,
        _recoveryNote: 'Recreated by scripts/recover-purged-superadmins.js after the 2026-07-21 orphan-purge incident',
      };

      if (DRY_RUN) {
        console.log(`  [DRY RUN] would create superadmin at ${school.name} (${school.id}), temp password generated but not saved`);
        created.push({ school: school.name, email, tempPassword: '(not generated in dry-run)' });
        continue;
      }

      userDoc.password = await bcrypt.hash(tempPassword, 12);

      // Reuse one identity across schools that share the same org (same
      // person, confirmed by this script targeting them explicitly) —
      // same shape provision-identities.js's collision-merge path
      // produces, applied directly instead of via the async backfill.
      if (sharedOrgId && school.organizationId && school.organizationId === sharedOrgId && sharedIdentityId) {
        userDoc.identityId = sharedIdentityId;
      }

      const db = mongoose.connection.db;
      const insertResult = await db.collection('users').insertOne(userDoc);
      userDoc._id = insertResult.insertedId;

      if (!userDoc.identityId) {
        try {
          const identity = await provisionIdentityForUser(userDoc);
          if (identity) {
            sharedIdentityId = identity.id;
            sharedOrgId      = school.organizationId || sharedOrgId;
          }
        } catch (err) {
          console.error(`  [WARN] identity provisioning failed for ${school.name} (will self-heal at next server restart's boot backfill): ${err.message}`);
        }
      }

      console.log(`  [CREATED] ${school.name} (${school.id}) — id=${userId}  temp password: ${tempPassword}`);
      created.push({ school: school.name, email, tempPassword, mustChangePassword: true });
    }
  }

  await mongoose.disconnect();

  console.log('\n── Summary ──────────────────────────────────────────────');
  if (created.length) {
    console.log('Created (SAVE THESE TEMP PASSWORDS — shown once, not recoverable after this):');
    created.forEach(c => console.log(`  ${c.email} @ ${c.school} → ${c.tempPassword}`));
  }
  if (skipped.length) {
    console.log(`Skipped (already existed): ${skipped.length}`);
  }
  if (notFound.length) {
    console.log('Schools not found by name match — check spelling/status:');
    notFound.forEach(n => console.log(`  target="${n.target}" term="${n.term}"`));
  }
  if (DRY_RUN) console.log('\n[DRY RUN] No changes were written. Re-run without --dry-run to execute.');
}

run().catch(err => { console.error(err); process.exit(1); });
