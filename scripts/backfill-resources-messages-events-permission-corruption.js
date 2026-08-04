/**
 * backfill-resources-messages-events-permission-corruption.js
 * — one-time data-quality backfill
 *
 * Companion fix to the SettingsPage.jsx DEFS corrections shipped alongside
 * this script (server/routes/onboard.js's _defaultPerms() was fixed too,
 * plus a new permission-defaults-consistency.test.js guarding the
 * server-side pair going forward). Those fix the code going forward; this
 * script repairs already-corrupted stored data, same split as the earlier
 * scripts/backfill-teachers-permission-corruption.js.
 *
 * ROOT CAUSE (same class of bug as the 'teachers' module fix, commit
 * 3c7c717, now confirmed recurring for a second, larger set of modules):
 * SettingsPage.jsx's DEFS.<role> functions compute the *default* value
 * shown for every Roles & Permissions checkbox before an admin has
 * customized it. The 'resources', 'messages', and 'events' modules were
 * added to the module registry after most DEFS.<role> functions were
 * written, and were never revisited — so for a role/module pair with no
 * explicit rule, the function's own generic fallback (often 'N' — no
 * access, sometimes an over/under-granting blanket 'E') silently
 * disagreed with the real server-seeded default in
 * repairPermissions.js's ROLE_DEFAULTS. Settings' Save always resends the
 * ENTIRE byRole object for every role, not just the row being edited — so
 * the first time ANY admin at a school saved R&P for ANY role, these wrong
 * defaults got permanently baked into both `schools.modulePermissions.byRole`
 * and (via settings.js's _deriveApiPerms sync) the `role_permissions`
 * collection — the actual RBAC enforcement data.
 *
 * Affected role -> module -> {what the broken default produced, what it
 * should have produced}, confirmed by reading both DEFS.<role> and
 * ROLE_DEFAULTS.<role> directly before writing this table (not assumed):
 *
 *   finance / hr / exams_officer:  resources N->E, messages N->E, events N->V
 *   timetabler:                    resources N->E, messages N->E, events N->T
 *   admissions_officer:            resources N->E
 *   discipline_committee:          resources N->E, events N->V
 *   teacher:                       resources V->E  (under-grant, not a full strip)
 *   principal / deputy_principal / deputy:
 *                                  resources E->T, messages E->T, events E->T
 *                                  (blanket RCU fallback under-granting the
 *                                  'delete' action the server actually seeds)
 *   section_head:                  events E->V     (OVER-grant being tightened,
 *                                  not a stripped-access case)
 *   parent:                        resources N->V  (module wasn't in the
 *                                  role's allowlist array at all)
 *   student:                       resources N->V, messages N->V (same)
 *
 * WHAT THIS SCRIPT DOES
 * For every school that has ever saved R&P (i.e. has
 * modulePermissions.byRole at all), for every (role, module) pair above,
 * checks each of that module's '<module>__<sub>' cells. A cell is only
 * corrected if it is bit-identical to the EXACT broken value that
 * role/module's old DEFS fallback would have produced — anything that
 * differs even slightly is left untouched, on the assumption an admin
 * deliberately customized it. Same deliberately-conservative approach as
 * the teachers-module script: it cannot distinguish "never touched,
 * defaulted from broken code" from "admin explicitly chose the same
 * value" for a cell that happens to match, but it will never overwrite a
 * cell that shows ANY sign of manual customization.
 *
 * Corrects both storage locations so the fix survives the next Settings Save:
 *   1. schools.modulePermissions.byRole.<role>.<module>__<sub>  (UI matrix)
 *   2. role_permissions { schoolId, roleKey }.permissions.<module>[*]  (RBAC enforcement)
 *
 * Does NOT touch any other module, any other role, or any cell that isn't
 * bit-identical to the known-broken default for that specific role/module
 * pair. Does NOT touch the 'hr' role's own 'hr' module grant — that's a
 * separate, deeper issue (the server-side 'manage_workflow' action isn't
 * representable by ANY combination of the client's read/create/update/
 * delete checkboxes at all, since no 'hr' module sub-key maps to it — a
 * product/UI decision, not a data-correction problem this script can fix).
 *
 * Usage:
 *   node scripts/backfill-resources-messages-events-permission-corruption.js              # all schools
 *   node scripts/backfill-resources-messages-events-permission-corruption.js --dry-run    # preview only
 *   node scripts/backfill-resources-messages-events-permission-corruption.js --school <schoolId>
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

function _subsFor(moduleKey) {
  return (MODULE_REGISTRY.find(m => m.key === moduleKey)?.subs ?? []).map(s => s.key);
}
const MODULE_SUBS = {
  resources: _subsFor('resources'),
  messages:  _subsFor('messages'),
  events:    _subsFor('events'),
};

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

// role -> module -> the exact broken value that role's old DEFS fallback
// produced for that module, and the correct value matching
// repairPermissions.js's ROLE_DEFAULTS.<role>.<module> — see the header
// comment above for how each of these was derived.
const ROLE_MODULE_FIXES = {
  finance:              { resources: { broken: N, correct: E }, messages: { broken: N, correct: E }, events: { broken: N, correct: V } },
  hr:                    { resources: { broken: N, correct: E }, messages: { broken: N, correct: E }, events: { broken: N, correct: V } },
  exams_officer:         { resources: { broken: N, correct: E }, messages: { broken: N, correct: E }, events: { broken: N, correct: V } },
  timetabler:            { resources: { broken: N, correct: E }, messages: { broken: N, correct: E }, events: { broken: N, correct: T } },
  admissions_officer:    { resources: { broken: N, correct: E } },
  discipline_committee:  { resources: { broken: N, correct: E }, events: { broken: N, correct: V } },
  teacher:               { resources: { broken: V, correct: E } },
  principal:             { resources: { broken: E, correct: T }, messages: { broken: E, correct: T }, events: { broken: E, correct: T } },
  deputy_principal:      { resources: { broken: E, correct: T }, messages: { broken: E, correct: T }, events: { broken: E, correct: T } },
  deputy:                { resources: { broken: E, correct: T }, messages: { broken: E, correct: T }, events: { broken: E, correct: T } },
  section_head:          { events: { broken: E, correct: V } },
  parent:                { resources: { broken: N, correct: V } },
  student:                { resources: { broken: N, correct: V }, messages: { broken: N, correct: V } },
};

async function _fixSchool(school, Schools, RolePerms, dryRun) {
  const byRole = school.modulePermissions?.byRole;
  if (!byRole) return null; // R&P never saved here — nothing to backfill

  const report = {};

  for (const [role, moduleFixes] of Object.entries(ROLE_MODULE_FIXES)) {
    const roleCell = byRole[role];
    if (!roleCell) continue;

    const roleReport = {};

    for (const [mod, { broken, correct }] of Object.entries(moduleFixes)) {
      const subs = MODULE_SUBS[mod];
      if (!subs || subs.length === 0) continue;

      const correctedSubs = [];
      for (const sub of subs) {
        const cell = roleCell[`${mod}__${sub}`];
        if (!cell) continue; // key not present — nothing stored to correct
        if (_cellEq(cell, broken)) correctedSubs.push(sub);
      }
      if (correctedSubs.length === 0) continue;

      roleReport[mod] = correctedSubs;
      if (dryRun) continue;

      // 1) Correct the school's own stored matrix — the source Settings' next
      //    Save will resend, so this must be fixed or the corruption returns.
      const schoolSet = {};
      for (const sub of correctedSubs) {
        schoolSet[`modulePermissions.byRole.${role}.${mod}__${sub}`] = correct;
      }
      await Schools.updateOne(
        { id: school.id },
        { $set: { ...schoolSet, updatedAt: new Date().toISOString() } }
      );

      // 2) Recompute permissions.<mod> / permissions.<mod>__<sub> on the
      //    role_permissions doc exactly as settings.js's _deriveApiPerms
      //    would, using the corrected cells merged with whatever else was
      //    stored for this module.
      const mergedCells = { ...roleCell };
      for (const sub of correctedSubs) mergedCells[`${mod}__${sub}`] = correct;

      const unionActions = new Set();
      const rpSet = {};
      for (const sub of subs) {
        const cell = mergedCells[`${mod}__${sub}`];
        if (!cell) continue;
        const actions = _cellToActions(cell);
        rpSet[`permissions.${mod}__${sub}`] = actions;
        actions.forEach(a => unionActions.add(a));
      }
      rpSet[`permissions.${mod}`] = [...unionActions];
      rpSet['updatedAt'] = new Date().toISOString();

      await RolePerms.updateOne({ schoolId: school.id, roleKey: role }, { $set: rpSet });
    }

    if (Object.keys(roleReport).length) report[role] = roleReport;
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
  console.log(`Scanning ${schools.length} school(s) for stale 'resources'/'messages'/'events' grants across ${Object.keys(ROLE_MODULE_FIXES).length} roles...\n`);

  let affectedSchools = 0;
  let correctedCells  = 0;

  for (const school of schools) {
    const report = await _fixSchool(school, Schools, RolePerms, DRY_RUN);
    if (!report) continue;
    affectedSchools++;
    console.log(`── ${school.name} (${school.id}) ──`);
    for (const [role, mods] of Object.entries(report)) {
      for (const [mod, subs] of Object.entries(mods)) {
        console.log(`  ${role}.${mod}: ${subs.join(', ')}`);
        correctedCells += subs.length;
      }
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
