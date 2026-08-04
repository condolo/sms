/**
 * backfill-teachers-permission-corruption.js — one-time data-quality backfill
 *
 * Companion to commit 3c7c717 (fix(rbac): hr role's Teachers-module grant
 * silently stripped on save). That commit fixed the code going forward but
 * explicitly did NOT touch already-corrupted stored data — this script does.
 *
 * ROOT CAUSE (unchanged since the earliest recoverable commit, 2026-06-29):
 * SettingsPage.jsx's DEFS.<role> functions compute the *default* value shown
 * for every Roles & Permissions checkbox before an admin has customized it.
 * Three roles' DEFS had a wrong default for the 'teachers' module:
 *   - hr:           no case at all -> fell through to N (no access).
 *                    Server default (ROLE_DEFAULTS.hr.teachers) is full access.
 *   - timetabler:    no case at all -> fell through to N (no access).
 *                    Server default is view-only.
 *   - section_head:  blanket fallback returned E (view+create+update) ->
 *                    over-granted. Server default is view-only.
 * Settings' Save always resends the ENTIRE byRole object for every role, not
 * just the row being edited — so the first time ANY admin at a school saved
 * R&P for ANY role, these wrong defaults got written into both
 * `schools.modulePermissions.byRole` (the UI's own source of truth for the
 * next Save) and, via settings.js's _deriveApiPerms sync, the `role_permissions`
 * collection (the actual RBAC enforcement data) — permanently and silently.
 * repairPermissions.js's self-heal never caught it: it only repairs malformed
 * documents, and these were well-formed, just wrong.
 *
 * WHAT THIS SCRIPT DOES
 * For every school that has ever saved R&P (i.e. has modulePermissions.byRole
 * at all), checks each of the three affected roles' stored 'teachers__<sub>'
 * cells. A cell is only corrected if it is bit-identical to the EXACT broken
 * value that role's old DEFS fallback would have produced — anything that
 * differs even slightly is left untouched, on the assumption an admin
 * deliberately customized it. This is deliberately conservative: it cannot
 * distinguish "never touched, defaulted from broken code" from "admin
 * explicitly chose the same value" for a cell that happens to match, but it
 * will never overwrite a cell that shows ANY sign of manual customization.
 *
 * Corrects both storage locations so the fix survives the next Settings Save:
 *   1. schools.modulePermissions.byRole.<role>.teachers__<sub>  (UI matrix)
 *   2. role_permissions { schoolId, roleKey }.permissions.teachers[*]  (RBAC enforcement)
 *
 * Does NOT touch any other module, any other role, or any cell that isn't
 * bit-identical to the known-broken default.
 *
 * Usage:
 *   node scripts/backfill-teachers-permission-corruption.js              # all schools
 *   node scripts/backfill-teachers-permission-corruption.js --dry-run    # preview only
 *   node scripts/backfill-teachers-permission-corruption.js --school <schoolId>
 *
 * Note: the live server's in-memory permission cache (rbac.js, 5-minute TTL)
 * is not shared with this standalone script's process. Affected users may
 * need to wait up to 5 minutes after this runs, or the server can be
 * restarted, for the corrected grants to take effect immediately.
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MODULE_REGISTRY } = require('../server/config/moduleRegistry');

const DRY_RUN   = process.argv.includes('--dry-run');
const TARGET_ID = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

const TEACHERS_SUBS = (MODULE_REGISTRY.find(m => m.key === 'teachers')?.subs ?? []).map(s => s.key);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

/* ── V/E/D cell shapes, matching SettingsPage.jsx's T/V/E/N constants ── */
const N = { v: false, e: false, d: false };
const V = { v: true,  e: false, d: false };
const E = { v: true,  e: true,  d: false };
const T = { v: true,  e: true,  d: true  };

function _cellEq(a, b) {
  return !!a?.v === !!b.v && !!a?.e === !!b.e && !!a?.d === !!b.d;
}

function _cellToActions(cell) {
  const actions = [];
  if (cell.v) actions.push('read');
  if (cell.e) { actions.push('create'); actions.push('update'); }
  if (cell.d) actions.push('delete');
  return actions;
}

// role -> the exact broken value its old DEFS fallback produced, and the
// correct value matching repairPermissions.js's ROLE_DEFAULTS.<role>.teachers
const ROLE_FIXES = {
  hr:           { broken: N, correct: T },
  timetabler:   { broken: N, correct: V },
  section_head: { broken: E, correct: V },
};

async function _fixSchool(school, Schools, RolePerms, dryRun) {
  const byRole = school.modulePermissions?.byRole;
  if (!byRole) return null; // R&P never saved here — nothing to backfill

  const report = {};

  for (const [role, { broken, correct }] of Object.entries(ROLE_FIXES)) {
    const roleCell = byRole[role];
    if (!roleCell) continue;

    const correctedSubs = [];
    for (const sub of TEACHERS_SUBS) {
      const cell = roleCell[`teachers__${sub}`];
      if (!cell) continue; // key not present — nothing stored to correct
      if (_cellEq(cell, broken)) correctedSubs.push(sub);
    }
    if (correctedSubs.length === 0) continue;

    report[role] = correctedSubs;
    if (dryRun) continue;

    // 1) Correct the school's own stored matrix — the source Settings' next
    //    Save will resend, so this must be fixed or the corruption returns.
    const schoolSet = {};
    for (const sub of correctedSubs) {
      schoolSet[`modulePermissions.byRole.${role}.teachers__${sub}`] = correct;
    }
    await Schools.updateOne(
      { id: school.id },
      { $set: { ...schoolSet, updatedAt: new Date().toISOString() } }
    );

    // 2) Recompute permissions.teachers / permissions.teachers__<sub> on the
    //    role_permissions doc exactly as settings.js's _deriveApiPerms would,
    //    using the corrected cells merged with whatever else was stored.
    const mergedCells = { ...roleCell };
    for (const sub of correctedSubs) mergedCells[`teachers__${sub}`] = correct;

    const unionActions = new Set();
    const rpSet = {};
    for (const sub of TEACHERS_SUBS) {
      const cell = mergedCells[`teachers__${sub}`];
      if (!cell) continue;
      const actions = _cellToActions(cell);
      rpSet[`permissions.teachers__${sub}`] = actions;
      actions.forEach(a => unionActions.add(a));
    }
    rpSet['permissions.teachers'] = [...unionActions];
    rpSet['updatedAt'] = new Date().toISOString();

    await RolePerms.updateOne({ schoolId: school.id, roleKey: role }, { $set: rpSet });
  }

  return Object.keys(report).length ? report : null;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Schools   = _model('schools');
  const RolePerms = _model('role_permissions');

  const schools = await Schools.find(TARGET_ID ? { id: TARGET_ID } : {})
    .select('id name modulePermissions').lean();
  console.log(`Scanning ${schools.length} school(s) for stale 'teachers' module grants (hr / timetabler / section_head)...\n`);

  let affectedSchools = 0;
  let correctedCells  = 0;

  for (const school of schools) {
    const report = await _fixSchool(school, Schools, RolePerms, DRY_RUN);
    if (!report) continue;
    affectedSchools++;
    console.log(`── ${school.name} (${school.id}) ──`);
    for (const [role, subs] of Object.entries(report)) {
      console.log(`  ${role}.teachers: ${subs.join(', ')}`);
      correctedCells += subs.length;
    }
  }

  console.log(`\n${DRY_RUN ? 'Would correct' : 'Corrected'} ${correctedCells} permission cell(s) across ${affectedSchools} school(s).`);
  if (!DRY_RUN && affectedSchools > 0) {
    console.log(`\nNote: the live server's in-memory permission cache (5-minute TTL) is not`);
    console.log(`shared with this script. Affected users may need to wait up to 5 minutes,`);
    console.log(`or the server can be restarted, for the fix to take effect immediately.`);
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
