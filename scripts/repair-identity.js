/**
 * repair-identity.js — Identity repair framework
 *
 * Finds entity records with a missing userId link and repairs them
 * by matching against the users collection. Designed to grow: add a
 * new ENTITY_CONFIGS entry to support any future user-linked entity.
 *
 * Currently supported:
 *   teachers — match by email → users.email
 *   students — match by email → users.email (portal accounts)
 *
 * Also patches role_permissions for schools missing hr / analytics
 * module entries (onboarded before those modules were added).
 *
 * Usage:
 *   node scripts/repair-identity.js                        # all entities, all schools
 *   node scripts/repair-identity.js --dry-run              # preview only
 *   node scripts/repair-identity.js --entity teachers      # one entity type
 *   node scripts/repair-identity.js --school <schoolId>    # one school
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN     = process.argv.includes('--dry-run');
const TARGET_ID   = (() => { const i = process.argv.indexOf('--school');  return i !== -1 ? process.argv[i + 1] : null; })();
const ENTITY_ONLY = (() => { const i = process.argv.indexOf('--entity'); return i !== -1 ? process.argv[i + 1] : null; })();

const RCUD = ['read', 'create', 'update', 'delete'];
const R    = ['read'];

/* ── Entity configurations ──────────────────────────────────────────── */
/*
 * Each config describes how to find unlinked entity records and how to
 * match them to a user account. Add new entries here to extend coverage.
 *
 * Fields:
 *   key           — matches --entity flag value
 *   label         — display name for reports
 *   collection    — MongoDB collection name
 *   userIdField   — field on the entity that should hold the linked userId
 *   emailField    — field on the entity to match against users.email
 *   userRoleHint  — optional: narrow user search to this role (reduces false matches)
 *
 * Entities that ARE users (parents, platform admins) don't need userId repair —
 * they live in the users collection. Their identity check is different:
 * verifying that their studentIds / schoolId references are valid.
 * That pattern will be added as 'parent-links' and 'staff-links' configs in Sprint 1.
 */
const ENTITY_CONFIGS = [
  {
    key:          'teachers',
    label:        'Teachers',
    collection:   'teachers',
    userIdField:  'userId',
    emailField:   'email',
    userRoleHint: null, // teachers may have any role (teacher, admin, hr, etc.)
  },
  {
    key:          'students',
    label:        'Students',
    collection:   'students',
    userIdField:  'userId',
    emailField:   'email',
    userRoleHint: 'student', // narrow to portal accounts only
  },
];

/* ── Default permissions to back-fill for pre-existing schools ──────── */
const MODULE_DEFAULTS = {
  hr: {
    admin:            RCUD,
    hr:               RCUD,
    deputy_principal: R,
    section_head:     [],
  },
  analytics: {
    admin:            RCUD,
    deputy_principal: R,
    section_head:     R,
  },
};

/* ── Mongoose helpers ───────────────────────────────────────────────── */
function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

/* ── Repair one entity type across one school ───────────────────────── */
async function _repairEntity(config, schoolId, dryRun) {
  const Entity = _model(config.collection);
  const Users  = _model('users');

  const result = { linked: 0, unresolved: [] };

  /* Find entity records missing userId */
  const orphans = await Entity.find({
    schoolId,
    $or: [{ [config.userIdField]: null }, { [config.userIdField]: { $exists: false } }],
  }).lean();

  if (orphans.length === 0) return result;

  /* Collect emails and look up matching user accounts */
  const emails = [...new Set(orphans.map(e => e[config.emailField]?.toLowerCase()).filter(Boolean))];
  const userFilter = { schoolId, email: { $in: emails } };
  if (config.userRoleHint) userFilter.role = config.userRoleHint;

  const userDocs  = await Users.find(userFilter).select('id email role').lean();
  const emailMap  = new Map(userDocs.map(u => [u.email.toLowerCase(), u.id]));

  for (const entity of orphans) {
    const email = entity[config.emailField]?.toLowerCase();
    const uid   = email ? emailMap.get(email) : null;

    if (uid) {
      if (!dryRun) {
        await Entity.updateOne(
          { id: entity.id, schoolId },
          { $set: { [config.userIdField]: uid } }
        );
      }
      result.linked++;
    } else {
      result.unresolved.push({ id: entity.id, email: entity[config.emailField] });
    }
  }

  return result;
}

/* ── Patch role_permissions for hr and analytics ────────────────────── */
async function _repairPermissions(schoolId, dryRun) {
  const RolePerms = _model('role_permissions');
  const permDocs  = await RolePerms.find({ schoolId }).lean();
  const permMap   = new Map(permDocs.map(d => [d.roleKey, d]));

  const patched = [];

  for (const [module, roleDefaults] of Object.entries(MODULE_DEFAULTS)) {
    for (const [roleKey, actions] of Object.entries(roleDefaults)) {
      const doc = permMap.get(roleKey);
      if (!doc) continue;

      const current = doc.permissions?.[module];
      if (Array.isArray(current) && current.length > 0) continue; // already set

      if (!dryRun) {
        await RolePerms.updateOne(
          { schoolId, roleKey },
          { $set: { [`permissions.${module}`]: actions } }
        );
      }
      patched.push({ roleKey, module, actions });
    }
  }

  return patched;
}

/* ── Main ───────────────────────────────────────────────────────────── */
async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const activeConfigs = ENTITY_ONLY
    ? ENTITY_CONFIGS.filter(c => c.key === ENTITY_ONLY)
    : ENTITY_CONFIGS;

  if (activeConfigs.length === 0) {
    console.error(`Unknown entity '${ENTITY_ONLY}'. Valid: ${ENTITY_CONFIGS.map(c => c.key).join(', ')}`);
    process.exit(1);
  }

  const Schools = _model('schools');
  const schools = await Schools.find(TARGET_ID ? { id: TARGET_ID } : {}).select('id name').lean();
  console.log(`Processing ${schools.length} school(s) for entities: ${activeConfigs.map(c => c.label).join(', ')}\n`);

  const report = {
    runAt:    new Date().toISOString(),
    dryRun:   DRY_RUN,
    entities: activeConfigs.map(c => c.key),
    schools:  [],
    totals:   {},
  };

  /* Initialise totals */
  for (const cfg of activeConfigs) {
    report.totals[cfg.key] = { linked: 0, unresolved: 0 };
  }
  report.totals.permDocsPatched = 0;

  for (const school of schools) {
    const schoolId = school.id;
    const entry    = { schoolId, name: school.name, entities: {}, permDocsPatched: [] };

    /* Repair each entity type */
    for (const cfg of activeConfigs) {
      const res = await _repairEntity(cfg, schoolId, DRY_RUN);
      entry.entities[cfg.key]           = res;
      report.totals[cfg.key].linked    += res.linked;
      report.totals[cfg.key].unresolved += res.unresolved.length;
    }

    /* Repair permissions */
    if (!ENTITY_ONLY) { // skip if scoped to one entity
      const patched = await _repairPermissions(schoolId, DRY_RUN);
      entry.permDocsPatched     = patched;
      report.totals.permDocsPatched += patched.length;
    }

    report.schools.push(entry);

    /* Console summary per school */
    const hasWork = activeConfigs.some(c => entry.entities[c.key]?.linked || entry.entities[c.key]?.unresolved?.length)
      || entry.permDocsPatched?.length;

    if (hasWork) {
      const parts = activeConfigs.map(c => {
        const r = entry.entities[c.key];
        return `${c.key}: linked=${r.linked} unresolved=${r.unresolved.length}`;
      });
      if (entry.permDocsPatched?.length) parts.push(`perms_patched=${entry.permDocsPatched.length}`);
      console.log(`  ${school.name} (${schoolId}): ${parts.join('  ')}`);
    }
  }

  await mongoose.disconnect();

  /* ── Final summary ──────────────────────────────────────────────── */
  console.log('\n── Summary ──────────────────────────────────────────────');
  for (const cfg of activeConfigs) {
    const t = report.totals[cfg.key];
    console.log(`${cfg.label.padEnd(12)} linked: ${t.linked}   unresolved: ${t.unresolved}`);
  }
  if (!ENTITY_ONLY) {
    console.log(`Perms patched:  ${report.totals.permDocsPatched}`);
  }
  if (DRY_RUN) console.log('\n[DRY RUN] No changes were written.');

  const outPath = path.join(__dirname, 'repair-identity-report.json');
  require('fs').writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report: ${outPath}`);
}

run().catch(err => { console.error(err); process.exit(1); });
