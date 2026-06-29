/**
 * platform-health.js — Unified Platform Health Check
 *
 * Aggregates static artifacts (manifest, baseline, history, repair report)
 * into one health summary. No database connection required — runs on any
 * machine that has the built artifacts.
 *
 * Usage:
 *   node scripts/platform-health.js
 *   npm run platform:health
 *
 * Exit codes:
 *   0 — all checks pass or warn
 *   1 — one or more critical checks fail
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const ROOT_DIR    = path.join(SCRIPTS_DIR, '..');

const scanRoutes  = require('./_rbac-scan');

/* ── Helpers ─────────────────────────────────────────────────────────── */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch { return null; }
}

const PASS = '✓';
const WARN = '⚠';
const FAIL = '✗';
const INFO = '·';

function row(icon, label, value, note = '') {
  const l = label.padEnd(26);
  const v = String(value).padEnd(16);
  console.log(`  ${icon}  ${l} ${v}  ${note}`);
}

/* ── Gather artifacts ────────────────────────────────────────────────── */
const manifest      = readJson(path.join(SCRIPTS_DIR, 'endpoint-inventory.json'));
const baseline      = readText(path.join(SCRIPTS_DIR, '.rbac-baseline'));
const historyRaw    = readText(path.join(SCRIPTS_DIR, '.rbac-history'));
const repairReport  = readJson(path.join(SCRIPTS_DIR, 'repair-identity-report.json'));
const pkg           = readJson(path.join(ROOT_DIR, 'package.json'));

const historyLines  = (historyRaw || '')
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split('\t'));

let criticalFailures = 0;

/* ── Print report ────────────────────────────────────────────────────── */
console.log('\n┌─────────────────────────────────────────────────────────┐');
console.log(`│  Msingi Platform Health Report  v${(pkg?.version || '?').padEnd(8)}               │`);
console.log(`│  ${new Date().toISOString().replace('T', ' ').slice(0, 19).padEnd(55)} │`);
console.log('└─────────────────────────────────────────────────────────┘');

/* ── 1. RBAC Coverage (live scan — same logic as CI gate) ───────────── */
console.log('\n  RBAC Coverage');
console.log('  ' + '─'.repeat(55));

const scan = scanRoutes();
const bl   = parseFloat(baseline || '0');
const icon = scan.coverage >= bl ? PASS : FAIL;
if (scan.coverage < bl) criticalFailures++;
row(icon, 'Coverage', `${scan.coverage.toFixed(2)}%`, `baseline ${bl.toFixed(2)}%`);
row(INFO, 'Protected endpoints', `${scan.protected}/${scan.total}`);
row(INFO, 'Remaining gaps',      scan.total - scan.protected);
row(INFO, 'Target',              '100.00%', 'see PLATFORM_ROADMAP.md');

/* ── 2. Coverage history ────────────────────────────────────────────── */
if (historyLines.length > 0) {
  console.log('\n  Coverage History');
  console.log('  ' + '─'.repeat(55));
  historyLines.slice(-5).forEach(([date, version, cov, range]) => {
    row(INFO, `${date} ${version}`, cov, range || '');
  });
}

/* ── 3. Audit Infrastructure ────────────────────────────────────────── */
console.log('\n  Audit Infrastructure');
console.log('  ' + '─'.repeat(55));

const auditLogged = manifest?.summary?.auditLogged ?? 0;
const auditTotal  = manifest?.summary?.total ?? 1;
const auditPct    = Math.round(auditLogged / auditTotal * 100);

if (auditLogged === 0) {
  criticalFailures++;
  row(FAIL, 'Audit coverage', `${auditLogged}/${auditTotal} (0%)`, 'Sprint 1 — build AuditService');
} else {
  const icon = auditPct >= 80 ? PASS : WARN;
  row(icon, 'Audit coverage', `${auditLogged}/${auditTotal} (${auditPct}%)`);
}
row(INFO, 'AuditService',     auditLogged > 0 ? 'present' : 'NOT BUILT', 'server/services/audit.js');
row(INFO, 'Immutable logs',   auditLogged > 0 ? 'verify'  : 'N/A',       'no UPDATE/DELETE on audit_logs');

/* ── 4. Rate Limiting ───────────────────────────────────────────────── */
console.log('\n  Rate Limiting');
console.log('  ' + '─'.repeat(55));

const rateLimited = manifest?.summary?.rateLimited ?? 0;
const rateTotal   = manifest?.summary?.total ?? 1;
const ratePct     = Math.round(rateLimited / rateTotal * 100);
const rateIcon    = ratePct >= 80 ? PASS : ratePct > 0 ? WARN : WARN;
row(rateIcon, 'Rate-limited', `${rateLimited}/${rateTotal} (${ratePct}%)`, 'Sprint 4 target: 100%');

/* ── 5. Tenant Isolation ────────────────────────────────────────────── */
console.log('\n  Tenant Isolation');
console.log('  ' + '─'.repeat(55));

const tenantScoped = manifest?.summary?.tenantScoped ?? 0;
const tenantTotal  = manifest?.summary?.total ?? 1;
const tenantPct    = Math.round(tenantScoped / tenantTotal * 100);
const tenantIcon   = tenantPct >= 95 ? PASS : WARN;
row(tenantIcon, 'Tenant-scoped', `${tenantScoped}/${tenantTotal} (${tenantPct}%)`);
row(INFO, 'schoolId on JWT',  'enforced via authMiddleware');

/* ── 6. Identity Health ─────────────────────────────────────────────── */
console.log('\n  Identity Health');
console.log('  ' + '─'.repeat(55));

if (!repairReport) {
  row(WARN, 'Repair report', 'NOT FOUND', 'run: node scripts/repair-identity.js --dry-run');
} else {
  const totals = repairReport.totals || {};
  for (const [entity, stats] of Object.entries(totals)) {
    if (entity === 'permDocsPatched') continue;
    const unresolved = typeof stats === 'object' ? stats.unresolved : stats;
    const icon = unresolved === 0 ? PASS : WARN;
    row(icon, entity.padEnd(12), unresolved === 0 ? 'Healthy' : `${unresolved} unresolved`);
  }
  row(INFO, 'Perms patched', totals.permDocsPatched ?? '?');
}
row(WARN, 'Parents', 'Not yet validated', 'architecture deferred — see PLATFORM_ROADMAP.md');
row(WARN, 'Staff',   'Not yet validated', 'same pattern as teachers (Sprint 1)');

/* ── 7. Security Manifest ───────────────────────────────────────────── */
console.log('\n  Security Manifest');
console.log('  ' + '─'.repeat(55));

if (!manifest) {
  row(WARN, 'Manifest file', 'NOT FOUND', 'run: npm run platform:manifest');
} else {
  const age = manifest.generatedAt
    ? Math.round((Date.now() - new Date(manifest.generatedAt)) / 3600000)
    : null;
  const ageStr = age === null ? 'unknown' : age < 1 ? 'just now' : `${age}h ago`;
  row(PASS, 'Manifest exists',  `schema v${manifest.schemaVersion}`, `generated ${ageStr}`);
  row(INFO, 'Total endpoints',  manifest.summary?.total ?? '?');
  row(INFO, 'Modules covered',  manifest.moduleCoverage ? Object.keys(manifest.moduleCoverage).length : '?');
}

/* ── Summary ────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(59));
if (criticalFailures === 0) {
  console.log(`  ${PASS}  Platform health: PASSING  (${criticalFailures} critical failures)`);
} else {
  console.log(`  ${FAIL}  Platform health: ${criticalFailures} CRITICAL FAILURE${criticalFailures > 1 ? 'S' : ''}`);
}
console.log(`       See PLATFORM_ROADMAP.md for sprint targets.\n`);

process.exit(criticalFailures > 0 ? 1 : 0);
