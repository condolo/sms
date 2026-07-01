/**
 * release-cert.js — Production Release Certificate
 *
 * Generates a tamper-evident JSON artifact documenting exactly what
 * was in a release: version, commit, tests, RBAC, security, migration,
 * impacted modules. Stored under .release-certs/ and uploaded as a
 * CI artifact so every deploy has a permanent audit trail.
 *
 * Usage:
 *   node scripts/release-cert.js               — print + save to .release-certs/
 *   node scripts/release-cert.js --stdout      — JSON to stdout only (for piping)
 *   npm run platform:release-cert
 *
 * Output file: .release-certs/v{VERSION}-{COMMIT}-{DATE}.json
 */
'use strict';

const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const { execSync } = require('child_process');
const scanRoutes   = require('./_rbac-scan');

const STDOUT_ONLY = process.argv.includes('--stdout');
const ROOT        = path.join(__dirname, '..');
const CERTS_DIR   = path.join(ROOT, '.release-certs');

/* ── Helpers ─────────────────────────────────────────────────── */
function exec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch { return null; }
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

/* ── Git metadata ────────────────────────────────────────────── */
const commitHash  = exec('git rev-parse HEAD 2>/dev/null')         || 'unknown';
const commitShort = exec('git rev-parse --short HEAD 2>/dev/null') || 'unknown';
const commitMsg   = exec('git log -1 --pretty=%s 2>/dev/null')     || 'unknown';
const commitDate  = exec('git log -1 --pretty=%ci 2>/dev/null')    || new Date().toISOString();
const branch      = exec('git rev-parse --abbrev-ref HEAD 2>/dev/null') || 'unknown';
const author      = exec('git log -1 --pretty=%an 2>/dev/null')    || 'unknown';
const lastTag     = exec('git describe --tags --abbrev=0 2>/dev/null') || null;
const changedFiles = (exec(`git diff --name-only ${lastTag || 'HEAD~1'} HEAD 2>/dev/null`) || '')
  .split('\n').filter(Boolean);

/* ── Package info ────────────────────────────────────────────── */
const pkg     = readJson(path.join(ROOT, 'package.json')) || {};
const version = pkg.version || '0.0.0';

/* ── RBAC scan ───────────────────────────────────────────────── */
const rbacScan   = scanRoutes();
const rbacBase   = parseFloat(readText(path.join(__dirname, '.rbac-baseline')) || '0');
const rbacPassed = rbacScan.coverage >= rbacBase;

/* ── Security scan ───────────────────────────────────────────── */
let securityPassed = false;
let securityNote   = 'not run';
try {
  const output = execSync('node scripts/security-scan.js', {
    encoding: 'utf8', cwd: ROOT, stdio: ['pipe','pipe','pipe']
  });
  securityPassed = !output.toLowerCase().includes('fail') && !output.toLowerCase().includes('found');
  securityNote   = 'passed';
} catch {
  securityNote = 'failed or errored';
}

/* ── Test suite ──────────────────────────────────────────────── */
const testDir   = path.join(ROOT, 'server/__tests__');
const testFiles = fs.existsSync(testDir)
  ? fs.readdirSync(testDir, { recursive: true }).filter(f => String(f).endsWith('.test.js'))
  : [];

let testsPassed  = null;
let testsNote    = 'not run in cert generation (run npm test separately)';
const jestResult = readJson(path.join(ROOT, 'test-results.json'));
if (jestResult) {
  testsPassed = jestResult.success;
  testsNote   = `${jestResult.numPassedTests ?? '?'} passed, ${jestResult.numFailedTests ?? 0} failed`;
}

/* ── Module tier classification ──────────────────────────────── */
const CRITICAL_PATTERNS = [
  'auth.js','students.js','teachers.js','finance.js','exams.js','grades.js',
  'report-cards.js','attendance.js','billing.js','parent-portal.js','student-portal.js',
  'middleware/auth','middleware/rbac','middleware/tenant','utils/academic-calc','utils/ranking',
];
const criticalTouched = changedFiles.filter(f => CRITICAL_PATTERNS.some(p => f.includes(p)));
const migrationFiles  = changedFiles.filter(f => f.includes('indexes.js') || (f.includes('server/index.js')));
const hasMigration    = migrationFiles.length > 0;

/* ── History: read last cert to compute delta ─────────────────── */
let previousVersion = null;
let previousCoverage = null;
if (fs.existsSync(CERTS_DIR)) {
  const previous = fs.readdirSync(CERTS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'latest.json')
    .sort()
    .reverse()[0];
  if (previous) {
    const prev = readJson(path.join(CERTS_DIR, previous));
    previousVersion  = prev?.version    ?? null;
    previousCoverage = prev?.rbac?.coverage ?? null;
  }
}

/* ── Build certificate ────────────────────────────────────────── */
const cert = {
  /* Identity */
  certId:      crypto.randomBytes(8).toString('hex'),
  generatedAt: new Date().toISOString(),
  certVersion: '1',

  /* Release identity */
  version,
  previousVersion,
  branch,
  commit: { hash: commitHash, short: commitShort, message: commitMsg, date: commitDate, author },
  lastTag,

  /* What changed */
  changes: {
    totalFiles:       changedFiles.length,
    criticalTouched:  criticalTouched.map(f => path.basename(f)),
    hasMigration,
    migrationFiles:   migrationFiles.map(f => path.basename(f)),
    files:            changedFiles,
  },

  /* Gate results */
  gates: {
    rbac: {
      passed:   rbacPassed,
      coverage: rbacScan.coverage,
      baseline: rbacBase,
      delta:    previousCoverage !== null ? parseFloat((rbacScan.coverage - previousCoverage).toFixed(2)) : null,
      protected: rbacScan.protected,
      total:     rbacScan.total,
      gaps:      rbacScan.issues.length,
    },
    security: {
      passed: securityPassed,
      note:   securityNote,
    },
    tests: {
      passed:    testsPassed,
      fileCount: testFiles.length,
      note:      testsNote,
    },
  },

  /* Safety questions */
  safety: {
    couldLoseData:        hasMigration,
    couldBreakRbac:       !rbacPassed,
    couldBreakTenancy:    changedFiles.some(f => f.includes('tenant') || f.includes('model.js')),
    couldBreakFinance:    changedFiles.some(f => f.includes('finance') || f.includes('billing')),
    couldBreakExams:      changedFiles.some(f => f.includes('exam') || f.includes('grade') || f.includes('report-card')),
    requiresMigration:    hasMigration,
  },

  /* Overall verdict */
  verdict: rbacPassed && securityPassed ? 'CERTIFIED' : 'BLOCKED',
  blockers: [
    ...(!rbacPassed      ? [`RBAC coverage ${rbacScan.coverage}% below baseline ${rbacBase}%`] : []),
    ...(!securityPassed  ? ['Security pattern scan failed'] : []),
  ],
};

/* Seal the certificate with a hash of its own content */
cert.seal = crypto.createHash('sha256')
  .update(JSON.stringify({ ...cert, seal: undefined }))
  .digest('hex');

/* ── Output ──────────────────────────────────────────────────── */
if (STDOUT_ONLY) {
  process.stdout.write(JSON.stringify(cert, null, 2));
  process.exit(cert.verdict === 'CERTIFIED' ? 0 : 1);
}

/* Save to .release-certs/ */
fs.mkdirSync(CERTS_DIR, { recursive: true });
const dateStr  = new Date().toISOString().slice(0, 10);
const filename = `v${version}-${commitShort}-${dateStr}.json`;
const filepath = path.join(CERTS_DIR, filename);
fs.writeFileSync(filepath, JSON.stringify(cert, null, 2));

/* Always overwrite latest.json for easy reading */
fs.writeFileSync(path.join(CERTS_DIR, 'latest.json'), JSON.stringify(cert, null, 2));

/* Pretty print */
const c  = s => `\x1b[36m${s}\x1b[0m`;
const g  = s => `\x1b[32m${s}\x1b[0m`;
const r  = s => `\x1b[31m${s}\x1b[0m`;
const b  = s => `\x1b[1m${s}\x1b[0m`;
const d  = s => `\x1b[2m${s}\x1b[0m`;

const icon = (pass) => pass === true ? g('✓') : pass === false ? r('✗') : d('○');

console.log('\n' + b('┌─────────────────────────────────────────────────────┐'));
console.log(b(`│  Msingi Release Certificate                         │`));
console.log(b('└─────────────────────────────────────────────────────┘'));
console.log(`\n  ${b('Version')}     ${c('v' + version)}  ${d('← ' + (previousVersion ? 'was v' + previousVersion : 'first cert'))}`);
console.log(`  ${b('Commit')}      ${commitShort}  ${d(commitMsg)}`);
console.log(`  ${b('Branch')}      ${branch}`);
console.log(`  ${b('Date')}        ${dateStr}`);
console.log(`  ${b('Cert ID')}     ${cert.certId}`);

console.log(`\n  ${b('Gate Results')}`);
console.log(`  ${icon(rbacPassed)}  RBAC Coverage    ${rbacScan.coverage.toFixed(2)}%  ${d('baseline ' + rbacBase.toFixed(2) + '%')}`);
console.log(`  ${icon(securityPassed)}  Security Scan    ${securityPassed ? 'PASS' : 'FAIL'}`);
console.log(`  ${icon(testsPassed)}  Test Suite       ${testFiles.length} file(s)  ${d(testsNote)}`);
console.log(`  ${icon(!hasMigration)}  Migration        ${hasMigration ? 'YES — review before deploy' : 'None'}`);

console.log(`\n  ${b('Changed')}     ${changedFiles.length} file(s)`);
if (criticalTouched.length)
  console.log(`  ${r('!')}  Critical tier: ${criticalTouched.map(f => path.basename(f)).join(', ')}`);

console.log(`\n  ${b('Verdict')}     ${cert.verdict === 'CERTIFIED' ? g(b('CERTIFIED')) : r(b('BLOCKED'))}`);
if (cert.blockers.length) cert.blockers.forEach(bl => console.log(`             ${r('✗')} ${bl}`));

console.log(`\n  ${d('Certificate saved → .release-certs/' + filename)}\n`);

process.exit(cert.verdict === 'CERTIFIED' ? 0 : 1);
