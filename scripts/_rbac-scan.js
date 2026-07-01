/**
 * _rbac-scan.js — shared route scanner (internal module)
 *
 * Used by verify-rbac-coverage.js and platform-health.js so both
 * report identical numbers with identical allowlist logic.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../server/routes');

const ALLOWLISTED_FILES = new Set([
  'auth.js', 'mpesa.js', 'platform.js', 'public.js', 'portals.js',
  'sync.js', 'onboard.js', 'backup.js', 'billing.js', 'health.js',
  'parent-portal.js', 'student-portal.js',
  // teacher-portal uses _requireTeacher() role guard — same portal pattern
  'teacher-portal.js',
]);

const OWN_ACCOUNT_PATTERNS = [
  /\/leave$/, /\/my$/, /\/my-children$/, /\/my-classes$/,
  /\/me$/, /\/me\//,
  /\/sessions$/, /\/sessions\/:sessionId$/, /\/sessions\/:sessionId\/attend$/,
  /\/auth\//, /\/gc-webhook$/, /\/zoom-webhook$/, /\/zoom\/status$/, /\/drive\/upload$/,
];

const ROUTE_RE = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
// Recognised protection patterns:
//   rbac(         — standard RBAC middleware
//   // rbac:      — manual annotation for intentional non-rbac guards
//   planGate(     — plan-tier gate (bell-schedule, elearning, etc.)
//   _pdfAccess    — custom PDF access guard (report-cards /:id/pdf)
//   _can(         — teacher/admin inline guard (lesson-plans)
//   _typeGuard    — growth-records type-based access guard
const RBAC_RE  = /rbac\s*\(|\/[/*] rbac:|planGate\(|_pdfAccess|_can\(|_typeGuard/;
const AUTH_RE  = /authMiddleware/;

/**
 * Scan server/routes and return coverage stats.
 * @returns {{ total: number, protected: number, coverage: number, issues: Array }}
 */
module.exports = function scanRoutes() {
  const issues = [];
  let total = 0, protectedCount = 0;

  for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js')).sort()) {
    if (ALLOWLISTED_FILES.has(file)) continue;

    const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const lines  = source.split('\n');
    let match;
    ROUTE_RE.lastIndex = 0;

    while ((match = ROUTE_RE.exec(source)) !== null) {
      const method    = match[1].toUpperCase();
      const routePath = match[2];
      const lineNum   = source.slice(0, match.index).split('\n').length;
      const lineCtx   = lines.slice(Math.max(0, lineNum - 1), lineNum + 3).join(' ');

      if (!AUTH_RE.test(lineCtx)) continue;
      total++;

      if (RBAC_RE.test(lineCtx) || OWN_ACCOUNT_PATTERNS.some(p => p.test(routePath))) {
        protectedCount++;
      } else {
        issues.push({ file, method, path: routePath, line: lineNum });
      }
    }
  }

  const coverage = total > 0
    ? parseFloat((protectedCount / total * 100).toFixed(2))
    : 100;

  return { total, protected: protectedCount, coverage, issues };
};
