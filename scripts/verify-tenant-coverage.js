/**
 * verify-tenant-coverage.js — CI security gate (tenant-enforcement ratchet)
 *
 * Enforces ADR-0001 §6: the number of direct _model('<tenant-collection>')
 * call sites in server/routes/ may only ever DECREASE as routes migrate to
 * tenantModel(). New unprotected tenant access is blocked; the surface can
 * only shrink.
 *
 * This is the inverse of verify-rbac-coverage.js: there, coverage must not
 * fall below a floor; here, the direct-usage COUNT must not rise above a
 * ceiling.
 *
 * Usage:
 *   node scripts/verify-tenant-coverage.js                    # CI check
 *   node scripts/verify-tenant-coverage.js --update-baseline  # after migrating routes (count dropped)
 *   node scripts/verify-tenant-coverage.js --list             # show remaining sites per file
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const BASELINE_FILE = path.join(__dirname, '.tenant-baseline');
const scanTenantModelUsage = require('./_tenant-scan');

/* ── Read committed baseline (the ceiling) ─────────────────────────── */
let baseline = Infinity;
try {
  baseline = parseInt(fs.readFileSync(BASELINE_FILE, 'utf8').trim(), 10);
} catch {
  console.warn('No .tenant-baseline file found — first run; will accept current count as the ceiling.');
}

/* ── Scan ──────────────────────────────────────────────────────────── */
const { tenantOwnedCount, platformExemptCount, byFile, dynamic } = scanTenantModelUsage();
const current = tenantOwnedCount;
const delta   = current - (Number.isFinite(baseline) ? baseline : current);

console.log('\nTenant Enforcement Ratchet (ADR-0001 §6)');
console.log('━'.repeat(50));
console.log(`Direct _model() on tenant collections:  ${current}  (ceiling: ${Number.isFinite(baseline) ? baseline : 'unset'})`);
console.log(`Platform-exempt _model() (allowed):     ${platformExemptCount}`);
console.log(`Dynamic _model(<var>) (manual review):  ${dynamic.length}`);
console.log(`Route files still using _model():        ${Object.keys(byFile).length}`);

if (process.argv.includes('--list')) {
  console.log('\nRemaining direct-usage sites per file:');
  for (const [file, sites] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(sites.length).padStart(3)}  ${file}`);
  }
  if (dynamic.length) {
    console.log('\nDynamic _model(<var>) sites (classify + migrate manually):');
    dynamic.forEach(d => console.log(`  ${d.file}:${d.line}`));
  }
}

/* ── Ratchet check ─────────────────────────────────────────────────── */
console.log('');
let exitCode = 0;

if (!Number.isFinite(baseline)) {
  fs.writeFileSync(BASELINE_FILE, String(current));
  console.log(`✓ Baseline initialised at ${current}. Commit scripts/.tenant-baseline.`);
} else if (current > baseline) {
  console.error(`✗ REGRESSION: direct tenant _model() usage rose ${baseline} → ${current} (+${delta}). Pipeline blocked.`);
  console.error(`  New tenant data access must go through tenantModel(collection, tenantContext(req)) — see ADR-0001.`);
  console.error(`  Run with --list to find the new sites.`);
  exitCode = 1;
} else if (current === baseline) {
  console.log(`✓ Held at ${current} — no new unprotected tenant access.`);
} else {
  console.log(`✓ IMPROVED: ${baseline} → ${current} (${delta}). ${-delta} site(s) migrated to tenantModel().`);
  if (process.argv.includes('--update-baseline')) {
    fs.writeFileSync(BASELINE_FILE, String(current));
    console.log(`  Ceiling ratcheted down to ${current}. Commit scripts/.tenant-baseline with this change.`);
  } else {
    console.log(`  Run with --update-baseline to lock in the new, lower ceiling.`);
  }
}

process.exit(exitCode);
