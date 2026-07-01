/**
 * release-gate.js — Platform Release Readiness Certification
 *
 * Answers the three mandatory questions before any production release:
 *   1. What changed?       → git diff summary vs previous tag
 *   2. What could break?   → impact matrix per Tier (Critical / Standard / Support)
 *   3. Did anything break? → RBAC coverage, security scan, test status
 *
 * Also runs the advisor's 6 safety checks:
 *   ✓ Can this release lose data?
 *   ✓ Can this break RBAC?
 *   ✓ Can this break multi-tenancy?
 *   ✓ Can this break Finance?
 *   ✓ Can this break Exams?
 *   ✓ Does this need a DB migration?
 *
 * Usage:
 *   node scripts/release-gate.js              — full report
 *   node scripts/release-gate.js --ci         — exits 1 on any FAIL
 *   npm run platform:release-gate
 */
'use strict';

const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');
const scanRoutes  = require('./_rbac-scan');

const CI = process.argv.includes('--ci') || process.env.CI === 'true';

/* ── Visual helpers ─────────────────────────────────────────────── */
const PASS  = '✓';
const FAIL  = '✗';
const WARN  = '⚠';
const INFO  = '·';
const SKIP  = '○';

const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;

function row(icon, label, value, note = '') {
  const l = label.padEnd(32);
  const v = String(value).padEnd(20);
  const colorIcon = icon === PASS ? green(icon) : icon === FAIL ? red(icon) : icon === WARN ? yellow(icon) : dim(icon);
  console.log(`  ${colorIcon}  ${l} ${v}  ${dim(note)}`);
}

function section(title) {
  console.log(`\n${bold(title)}`);
  console.log('  ' + '─'.repeat(60));
}

/* ── Helpers ────────────────────────────────────────────────────── */
function readText(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function exec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); } catch { return null; }
}

/* ── Module Tier Classification ─────────────────────────────────── */
const TIERS = {
  critical: [
    'auth.js', 'students.js', 'teachers.js', 'finance.js',
    'exams.js', 'grades.js', 'report-cards.js', 'attendance.js',
    'billing.js', 'parent-portal.js', 'student-portal.js',
    'middleware/auth.js', 'middleware/rbac.js', 'middleware/tenant.js',
    'utils/academic-calc.js', 'utils/ranking.js',
  ],
  standard: [
    'behaviour.js', 'classes.js', 'departments.js', 'academic-config.js',
    'assessment.js', 'lesson-plans.js', 'events.js', 'notifications.js',
    'class-subjects.js', 'exam-series.js',
  ],
  support: [
    'hostel.js', 'library.js', 'transport.js', 'hr.js',
    'analytics.js', 'elearning.js', 'birthdays.js',
    'growth-projects.js', 'growth-records.js',
  ],
};

/* ── 1. Changed files (git diff since last tag or HEAD~1) ────────── */
function getChangedFiles() {
  const lastTag = exec('git describe --tags --abbrev=0 2>/dev/null');
  const base    = lastTag || 'HEAD~1';
  const diff    = exec(`git diff --name-only ${base} HEAD 2>/dev/null`);
  if (!diff) return { files: [], base: 'unknown' };
  return { files: diff.split('\n').filter(Boolean), base };
}

/* ── 2. Impact matrix ───────────────────────────────────────────── */
function classifyImpact(changedFiles) {
  const impact = { critical: [], standard: [], support: [], infra: [], tests: [], unknown: [] };

  for (const f of changedFiles) {
    const base = path.basename(f);
    if (f.includes('__tests__') || f.endsWith('.test.js') || f.endsWith('.spec.js')) {
      impact.tests.push(f);
    } else if (TIERS.critical.some(t => f.endsWith(t) || f.includes(t))) {
      impact.critical.push(f);
    } else if (TIERS.standard.some(t => f.endsWith(t) || f.includes(t))) {
      impact.standard.push(f);
    } else if (TIERS.support.some(t => f.endsWith(t) || f.includes(t))) {
      impact.support.push(f);
    } else if (f.startsWith('.github/') || f.startsWith('scripts/') || base === 'package.json') {
      impact.infra.push(f);
    } else {
      impact.unknown.push(f);
    }
  }
  return impact;
}

/* ── 3. Safety checks ───────────────────────────────────────────── */
const ROOT = path.join(__dirname, '..');

function checkRbac() {
  const scan     = scanRoutes();
  const baseline = parseFloat(readText(path.join(__dirname, '.rbac-baseline')) || '0');
  return { coverage: scan.coverage, baseline, pass: scan.coverage >= baseline, issues: scan.issues };
}

function checkSecurityPatterns() {
  const result = exec('node scripts/security-scan.js 2>&1');
  const pass   = result !== null && !result.toLowerCase().includes('fail') && !result.toLowerCase().includes('found');
  return { pass, output: result ? result.slice(0, 200) : 'Could not run' };
}

function checkTests() {
  // Just check if test files exist — we don't run Jest here (takes time, needs env)
  const testDir  = path.join(ROOT, 'server/__tests__');
  const files    = fs.existsSync(testDir)
    ? fs.readdirSync(testDir, { recursive: true }).filter(f => f.endsWith('.test.js'))
    : [];
  return { count: files.length, files };
}

function checkMigrations(changedFiles) {
  // Heuristic: if index.js or utils/indexes.js changed, a migration likely ran
  const migrationFiles = changedFiles.filter(f =>
    f.includes('indexes.js') || (f.includes('index.js') && f.includes('server/'))
  );
  const hasMigration = migrationFiles.length > 0;
  return { hasMigration, files: migrationFiles };
}

function checkMultiTenancy(changedFiles) {
  const tenantFiles = changedFiles.filter(f =>
    f.includes('tenant') || f.includes('schoolId') || f.includes('model.js')
  );
  return { affected: tenantFiles.length > 0, files: tenantFiles };
}

function checkFinanceExams(changedFiles) {
  const finance = changedFiles.filter(f => f.includes('finance') || f.includes('billing'));
  const exams   = changedFiles.filter(f => f.includes('exam') || f.includes('grade') || f.includes('report-card'));
  return { finance, exams };
}

/* ── Version info ────────────────────────────────────────────────── */
function getVersionInfo() {
  const pkg       = readJson(path.join(ROOT, 'package.json'));
  const commitHash = exec('git rev-parse --short HEAD 2>/dev/null') || 'unknown';
  const commitMsg  = exec('git log -1 --pretty=%s 2>/dev/null') || 'unknown';
  const branch     = exec('git rev-parse --abbrev-ref HEAD 2>/dev/null') || 'unknown';
  return { version: pkg?.version || '?', commitHash, commitMsg, branch };
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  MAIN                                                              */
/* ═══════════════════════════════════════════════════════════════════ */

let failures = 0;
let warnings = 0;

const ver       = getVersionInfo();
const { files: changedFiles, base } = getChangedFiles();
const impact    = classifyImpact(changedFiles);
const rbac      = checkRbac();
const security  = checkSecurityPatterns();
const tests     = checkTests();
const migration = checkMigrations(changedFiles);
const tenancy   = checkMultiTenancy(changedFiles);
const { finance, exams } = checkFinanceExams(changedFiles);

/* ── Header ─────────────────────────────────────────────────────── */
console.log('\n' + bold('┌─────────────────────────────────────────────────────────────┐'));
console.log(bold(`│  Msingi Release Readiness Gate  v${ver.version.padEnd(8)}                    │`));
console.log(bold(`│  ${new Date().toISOString().replace('T',' ').slice(0,19).padEnd(61)} │`));
console.log(bold('└─────────────────────────────────────────────────────────────┘'));

console.log(`\n  Branch:  ${bold(ver.branch)}`);
console.log(`  Commit:  ${ver.commitHash}  ${dim(ver.commitMsg)}`);
console.log(`  Diff vs: ${base}`);

/* ── Section 1: What changed? ───────────────────────────────────── */
section('1  WHAT CHANGED?');
if (changedFiles.length === 0) {
  row(INFO, 'Changed files', 'none detected', 'clean working tree or no previous tag');
} else {
  row(INFO, 'Total files changed', changedFiles.length);
  if (impact.critical.length)  row(WARN, 'Critical tier files',  impact.critical.length,  impact.critical.map(f => path.basename(f)).join(', '));
  if (impact.standard.length)  row(INFO, 'Standard tier files',  impact.standard.length,  impact.standard.map(f => path.basename(f)).join(', '));
  if (impact.support.length)   row(INFO, 'Support tier files',   impact.support.length,   impact.support.map(f => path.basename(f)).join(', '));
  if (impact.infra.length)     row(INFO, 'Infra/config files',   impact.infra.length,     impact.infra.map(f => path.basename(f)).join(', '));
  if (impact.tests.length)     row(PASS, 'Test files',           impact.tests.length,     'tests updated alongside code ✓');
  if (impact.unknown.length)   row(INFO, 'Other files',          impact.unknown.length,   impact.unknown.map(f => path.basename(f)).join(', '));
}

/* ── Section 2: What existing functionality could break? ─────────── */
section('2  IMPACT MATRIX');

const hasCritical = impact.critical.length > 0;
row(hasCritical ? WARN : PASS,
  'Critical modules touched',
  hasCritical ? `YES (${impact.critical.length})` : 'No',
  hasCritical ? 'Manual QA required on: Auth, RBAC, Finance, Exams, Report Cards' : ''
);

row(migration.hasMigration ? WARN : PASS,
  'DB migration present',
  migration.hasMigration ? 'YES' : 'No',
  migration.hasMigration ? 'Verify backup taken before deploy' : ''
);

row(tenancy.affected ? WARN : PASS,
  'Multi-tenancy files touched',
  tenancy.affected ? 'YES' : 'No',
  tenancy.affected ? 'Verify schoolId isolation after deploy' : ''
);

row(finance.length > 0 ? WARN : PASS,
  'Finance module touched',
  finance.length > 0 ? 'YES' : 'No',
  finance.length > 0 ? 'Test invoice, receipt, M-Pesa, statements' : ''
);

row(exams.length > 0 ? WARN : PASS,
  'Exams/Report Cards touched',
  exams.length > 0 ? 'YES' : 'No',
  exams.length > 0 ? 'Test marks entry, grades, PDF, publish, verify' : ''
);

const testsUpdated = impact.tests.length > 0 || impact.critical.length === 0;
row(testsUpdated ? PASS : WARN,
  'Tests updated with code',
  testsUpdated ? 'Yes' : 'NOT DETECTED',
  testsUpdated ? '' : 'Consider adding tests for changed critical files'
);
if (!testsUpdated) warnings++;

/* ── Section 3: Did anything break? ─────────────────────────────── */
section('3  AUTOMATED CHECKS');

// RBAC
const rbacIcon = rbac.pass ? PASS : FAIL;
row(rbacIcon,
  'RBAC coverage',
  `${rbac.coverage.toFixed(2)}%`,
  `baseline ${rbac.baseline.toFixed(2)}% — ${rbac.issues.length} gap(s)`
);
if (!rbac.pass) failures++;

// Security patterns
const secIcon = security.pass ? PASS : FAIL;
row(secIcon, 'Security pattern scan', security.pass ? 'PASS' : 'FAIL');
if (!security.pass) failures++;

// Test files
row(tests.count > 0 ? PASS : WARN,
  'Test suite',
  `${tests.count} test file(s)`,
  'run `npm test` to execute'
);
if (tests.count === 0) warnings++;

/* ── Section 4: The 6 Safety Questions ──────────────────────────── */
section('4  RELEASE SAFETY CERTIFICATION');

const dataRisk    = migration.hasMigration;
const rbacRisk    = !rbac.pass;
const tenantRisk  = tenancy.affected;
const financeRisk = finance.length > 0;
const examRisk    = exams.length > 0;

row(dataRisk    ? WARN : PASS, 'Could this lose data?',          dataRisk    ? 'POSSIBLE — migration detected'      : 'Low risk');
row(rbacRisk    ? FAIL : PASS, 'Could this break RBAC?',         rbacRisk    ? 'YES — coverage below baseline'       : 'No — coverage passes');
row(tenantRisk  ? WARN : PASS, 'Could this break multi-tenancy?',tenantRisk  ? 'POSSIBLE — tenant files changed'     : 'No — tenant layer untouched');
row(financeRisk ? WARN : PASS, 'Could this break Finance?',      financeRisk ? 'POSSIBLE — finance files changed'    : 'No — finance untouched');
row(examRisk    ? WARN : PASS, 'Could this break Exams?',        examRisk    ? 'POSSIBLE — exam files changed'       : 'No — exam files untouched');
row(migration.hasMigration ? WARN : PASS, 'Migration required?', migration.hasMigration ? 'YES — review server/index.js' : 'No');

/* ── Rollback checklist ──────────────────────────────────────────── */
section('5  ROLLBACK READINESS');
row(INFO, 'Rollback command',    'git revert HEAD && git push');
row(INFO, 'DB backup required',  migration.hasMigration ? 'YES — before deploying' : 'Recommended always');
row(INFO, 'Last commit',         ver.commitHash, ver.commitMsg);
row(INFO, 'To revert to',        exec('git log --oneline HEAD~1 2>/dev/null')?.slice(0,50) || 'unknown');

/* ── Smoke test checklist ────────────────────────────────────────── */
section('6  PRE-RELEASE SMOKE CHECKLIST');
const smokeItems = [
  ['Can log in?',                       true ],
  ['Dashboard loads?',                  true ],
  ['Students list opens?',              true ],
  ['Can save a student record?',        true ],
  ['Attendance can be submitted?',      !impact.critical.some(f => f.includes('attendance')) || true ],
  ['Report card PDF downloads?',        !exams.length || true ],
  ['Parent portal accessible?',         true ],
  ['Can log out?',                       true ],
];
console.log(dim('  (Manual checklist — run against staging before production deploy)\n'));
for (const [label] of smokeItems) {
  console.log(`  ${dim('□')}  ${label}`);
}

/* ── Final verdict ───────────────────────────────────────────────── */
console.log('\n' + bold('═'.repeat(65)));
if (failures > 0) {
  console.log(red(bold(`\n  ✗  RELEASE BLOCKED — ${failures} critical check(s) failed.\n`)));
  console.log('     Fix RBAC coverage and security scan failures before deploying.\n');
} else if (warnings > 0) {
  console.log(yellow(bold(`\n  ⚠  RELEASE READY WITH WARNINGS — ${warnings} item(s) need attention.\n`)));
  console.log('     Review warnings above. Deploy to staging first.\n');
} else {
  console.log(green(bold('\n  ✓  RELEASE CERTIFIED — All automated checks pass.\n')));
  console.log('     Complete the smoke checklist above on staging before production.\n');
}
console.log(bold('═'.repeat(65)) + '\n');

if (CI && failures > 0) process.exit(1);
