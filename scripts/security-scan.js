#!/usr/bin/env node
/**
 * Msingi Security Pattern Scanner
 * Runs on every push/PR via GitHub Actions (see .github/workflows/security-scan.yml).
 * Enforces Architectural Invariant 8 — No Hidden Access.
 *
 * Exit 0 = clean. Exit 1 = violations found (CI fails).
 */

const fs   = require('fs');
const path = require('path');

/* ── Patterns that must never appear in production server code ── */
const FORBIDDEN = [
  {
    id:      'auth-bypass-env',
    pattern: /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*['"]production['"]\s*\)\s*return\s+next\(\)/,
    message: 'Auth bypass via NODE_ENV check — disables middleware in non-production, risk of accidental deployment',
    severity: 'CRITICAL',
  },
  {
    id:      'auth-disabled-flag',
    pattern: /AUTH_DISABLED|SKIP_AUTH|DISABLE_AUTH|NO_AUTH|AUTH_OFF/,
    message: 'Auth-disabling environment flag referenced — no bypass flags allowed (Invariant 8)',
    severity: 'CRITICAL',
  },
  {
    id:      'allow-all-flag',
    pattern: /ALLOW_ALL|MASTER_PASSWORD|GOD_MODE|DEBUG_AUTH/,
    message: 'Unrestricted-access flag referenced — prohibited by Invariant 8',
    severity: 'CRITICAL',
  },
  {
    id:      'hardcoded-credential',
    pattern: /['"](admin123|password123|secret123|test123|changeme|letmein|root123|pass123)['"]/i,
    message: 'Hardcoded weak credential detected',
    severity: 'CRITICAL',
  },
  {
    id:      'hidden-route',
    pattern: /router\.(get|post|put|patch|delete)\s*\(\s*['"]\/?(debug|master|dev-login|internal-login|admin-login|backdoor|bypass|god)['"]/i,
    message: 'Hidden or privileged debug route — no undocumented access routes allowed',
    severity: 'HIGH',
  },
  {
    id:      'todo-remove-auth',
    pattern: /\/\/\s*TODO.*remove.*auth|\/\/\s*TODO.*add.*auth.*later|\/\/\s*TODO.*skip.*auth/i,
    message: 'TODO to remove or defer auth — these become forgotten backdoors',
    severity: 'HIGH',
  },
  {
    id:      'commented-out-auth',
    pattern: /\/\/\s*(authMiddleware|requireAuth|authenticate|rbac\()/,
    message: 'Auth middleware commented out — remove the line entirely instead',
    severity: 'HIGH',
  },
];

/* ── Directories and files to scan ── */
const SCAN_DIRS  = ['server'];
const EXTENSIONS = ['.js', '.mjs', '.ts'];
const SKIP_DIRS  = new Set(['node_modules', '.git', 'dist', 'build']);

/* ── Allowed exceptions — patterns that look dangerous but are intentional ── */
const ALLOWLIST = [
  // M-Pesa callback validation is intentionally bypassed in non-production for local testing
  { file: 'server/routes/mpesa.js',      id: 'auth-bypass-env' },
  // Cache-control header is loosened in dev for faster iteration — not an auth bypass
  { file: 'server/index.js',             id: 'auth-bypass-env' },
  // jwt.js uses NODE_ENV check only to crash-on-missing-secret, not to skip auth
  { file: 'server/utils/jwt.js',         id: 'auth-bypass-env' },
  // ALLOW_IMPERSONATION is a documented, audited, production-disabled operator capability
  { file: 'server/routes/platform.js',   id: 'allow-all-flag'  },
];

function isAllowed(relPath, patternId) {
  const normalized = relPath.replace(/\\/g, '/');
  return ALLOWLIST.some(a => normalized.endsWith(a.file) && a.id === patternId);
}

/* ── Walk the directory tree ── */
function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      yield full;
    }
  }
}

/* ── Main scan ── */
const ROOT      = path.resolve(__dirname, '..');
const violations = [];

for (const dir of SCAN_DIRS) {
  const absDir = path.join(ROOT, dir);
  if (!fs.existsSync(absDir)) continue;

  for (const file of walkFiles(absDir)) {
    const relPath = path.relative(ROOT, file).replace(/\\/g, '/');
    const lines   = fs.readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, i) => {
      // Skip lines that are themselves comments about the scanner / allowlist
      if (line.trim().startsWith('//') && line.includes('security-scan')) return;

      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line) && !isAllowed(relPath, rule.id)) {
          violations.push({
            file:     relPath,
            line:     i + 1,
            severity: rule.severity,
            id:       rule.id,
            message:  rule.message,
            code:     line.trim(),
          });
        }
      }
    });
  }
}

/* ── Report ── */
if (violations.length === 0) {
  console.log('✅  Security scan passed — no dangerous patterns found.');
  process.exit(0);
}

const criticals = violations.filter(v => v.severity === 'CRITICAL');
const highs     = violations.filter(v => v.severity === 'HIGH');

console.error(`\n🚨  Security scan FAILED — ${violations.length} violation(s) found\n`);

for (const v of violations) {
  const icon = v.severity === 'CRITICAL' ? '🔴' : '🟠';
  console.error(`${icon} [${v.severity}] ${v.file}:${v.line}`);
  console.error(`   Rule:    ${v.id}`);
  console.error(`   Reason:  ${v.message}`);
  console.error(`   Code:    ${v.code}`);
  console.error('');
}

console.error('─'.repeat(60));
console.error(`CRITICAL: ${criticals.length}   HIGH: ${highs.length}`);
console.error('');
console.error('These patterns violate Architectural Invariant 8 — No Hidden Access.');
console.error('Fix the violations or add a documented allowlist entry in scripts/security-scan.js');
console.error('if the pattern is intentional (e.g. a documented operator capability).');

process.exit(1);
