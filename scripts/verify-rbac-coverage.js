/**
 * verify-rbac-coverage.js — CI security gate (non-regression ratchet)
 *
 * NEVER allows RBAC coverage to decrease below the committed baseline.
 * Baseline is stored to two decimal places so tiny regressions are caught.
 * When coverage improves, run --update-baseline to ratchet the floor up;
 * that also appends an entry to .rbac-history for management visibility.
 *
 * Usage:
 *   node scripts/verify-rbac-coverage.js                    # CI check
 *   node scripts/verify-rbac-coverage.js --update-baseline  # after improving coverage
 *
 * Sprint milestones (see PLATFORM_ROADMAP.md):
 *   Sprint 0 baseline:  73.48%
 *   Sprint 1 target:    85.00%
 *   Final target:      100.00%
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const BASELINE_FILE = path.join(__dirname, '.rbac-baseline');
const HISTORY_FILE  = path.join(__dirname, '.rbac-history');

const scanRoutes = require('./_rbac-scan');

/* ── Read committed baseline ────────────────────────────────────────── */
let baseline = 0;
try {
  baseline = parseFloat(fs.readFileSync(BASELINE_FILE, 'utf8').trim());
} catch {
  console.warn('No .rbac-baseline file found — treating 0% as baseline (first run).');
}

/* ── Scan routes ────────────────────────────────────────────────────── */
const { total, protected: protected_, coverage, issues } = scanRoutes();

/* ── Render report ──────────────────────────────────────────────────── */
const BAR_WIDTH = 30;
const filled    = Math.round((coverage / 100) * BAR_WIDTH);
const bar       = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
const delta     = parseFloat((coverage - baseline).toFixed(2));
const deltaStr  = delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : '±0.00%';

console.log('\nRBAC Coverage Report');
console.log('━'.repeat(50));
console.log(`Current:   ${coverage.toFixed(2)}%  (${protected_}/${total} endpoints)`);
console.log(`Baseline:  ${baseline.toFixed(2)}%`);
console.log(`Change:    ${deltaStr}`);
console.log(`Target:    100.00%  (${total - protected_} endpoints remaining)`);
console.log(`Progress:  [${bar}]  ${coverage.toFixed(2)}%`);

if (issues.length > 0) {
  console.log(`\nEndpoints missing rbac() (${issues.length}):`);
  issues.forEach(e => {
    console.log(`  MISSING  ${e.method.padEnd(7)} ${e.file.padEnd(30)} ${e.path}  (line ${e.line})`);
  });
}

/* ── Non-regression check ───────────────────────────────────────────── */
console.log('');
let exitCode = 0;

if (coverage < baseline) {
  console.error(`✗ REGRESSION: coverage dropped ${baseline.toFixed(2)}% → ${coverage.toFixed(2)}% (${deltaStr}). Pipeline blocked.`);
  console.error(`  Fix: restore rbac() on the ${Math.abs(delta)}% missing endpoints, then re-run.`);
  exitCode = 1;
} else if (coverage === baseline) {
  console.log(`✓ Coverage maintained at ${coverage.toFixed(2)}% — no regression.`);
} else {
  console.log(`✓ Coverage IMPROVED: ${baseline.toFixed(2)}% → ${coverage.toFixed(2)}% (${deltaStr})`);

  if (process.argv.includes('--update-baseline')) {
    /* Ratchet the baseline */
    fs.writeFileSync(BASELINE_FILE, coverage.toFixed(2));

    /* Append to history file for management visibility */
    const pkg     = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const date    = new Date().toISOString().slice(0, 10);
    const version = pkg.version || 'unknown';
    const line    = `${date}\tv${version}\t${coverage.toFixed(2)}%\t(${protected_}/${total})\n`;

    let history = '';
    try { history = fs.readFileSync(HISTORY_FILE, 'utf8'); } catch { /* first entry */ }
    if (!history) {
      history = '# RBAC Coverage History — Msingi\n# date\tversion\tcoverage\tprotected/total\n';
    }
    fs.writeFileSync(HISTORY_FILE, history + line);

    console.log(`  Baseline ratcheted to ${coverage.toFixed(2)}%.`);
    console.log(`  History updated in scripts/.rbac-history.`);
    console.log(`  Commit both files with this change.`);
  } else {
    console.log(`  Run with --update-baseline to lock in the new floor.`);
  }
}

process.exit(exitCode);
