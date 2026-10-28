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
  // mobile.js is the app's own surface, same reasoning as auth.js: /bootstrap
  // is public by design (a build that is too old must learn that BEFORE it can
  // authenticate), and /devices* act only on the caller's OWN registration —
  // push.registerDevice/unregisterDevice take schoolId from req.jwtUser, and the
  // DELETE is scoped to the caller's own tokens so a leaked token string cannot
  // unsubscribe another school's parent. There is no module+action permission
  // that could express "manage my own device", and inventing one to satisfy
  // this gate would be a gate that never denies anyone.
  'mobile.js',
]);

const OWN_ACCOUNT_PATTERNS = [
  /\/leave$/, /\/my$/, /\/my-children$/, /\/my-classes$/,
  /\/me$/, /\/me\//,
  /\/sessions$/, /\/sessions\/:sessionId$/, /\/sessions\/:sessionId\/attend$/,
  /\/auth\//, /\/gc-webhook$/, /\/zoom-webhook$/, /\/zoom\/status$/, /\/drive\/upload$/,
];

const ROUTE_RE = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
// Recognised protection patterns:
//   rbac(                    — standard RBAC middleware
//   // rbac:                 — manual annotation for intentional non-rbac guards
//   planGate(                — plan-tier gate (bell-schedule, elearning, etc.)
//   _pdfAccess               — custom PDF access guard (report-cards /:id/pdf)
//   _can(                    — teacher/admin inline guard (lesson-plans)
//   _typeGuard               — growth-records type-based access guard
//   behaviourAccess(         — behaviour.js's rbac('behaviour', action) wrapper;
//                              also lets the assigned Behaviour Officer through
//   timetableManageAccess(   — timetable.js's own floor-role/hasExplicitSubGrant
//                              wrapper (module 'timetable', action 'manage');
//                              confirmed real (not a naming coincidence) against
//                              every one of the 19 routes it gated before this
//                              scanner recognized it — none were actually open
//   attendanceConflictAccess( — same shape, attendance.js's conflict-resolution
//                              routes (module 'attendance', action varies)
//   _hasBulkImportGrant(      — lessons.js's own hasExplicitSubGrant('lessons',
//                              'import', ...) wrapper for the two bulk-import
//                              routes; the inline call sits inside the handler
//                              body (this scanner's 4-line context window),
//                              not on the route registration line itself
//   hasExplicitSubGrant(      — the real primitive several routes call
//                              directly inline (floor-role bypass, else a
//                              school-configurable per-role sub-permission),
//                              rather than through a named wrapper — same
//                              authorization mechanism rbac() itself uses
//                              internally, just invoked by hand for a check
//                              rbac()'s own coarse module+action shape can't
//                              express (e.g. attendance.js's absentee-officer
//                              config, gated on a distinct 'absentees' sub-key)
//   explicitSub(              — explicit-sub.js's finance sub-permission
//                              wrapper (term_billing/early_payment/activities);
//                              fails closed via the same hasExplicitSubGrant,
//                              used on finance.js's and extracurricular.js's
//                              own write routes in place of rbac('finance',...)
//   payrollManageAccess(      — hr.js's own floor-role-or-explicit-sub-grant
//                              wrapper for payroll write/config routes, tied
//                              to the 'payroll_view' sub-key (see hr.js's own
//                              comment on why a bare rbac('hr', action) can't
//                              be scoped correctly for these)
//   hrFloorOnly               — hr.js's HR_ROLES-only floor guard for
//                              capabilities with no dedicated sub-permission
//                              of their own (e.g. GET /summary)
//   !isAdmin\(req\)\)\s*return — lessons.js's own inline deny-and-return
//                              idiom (isAdmin is local to this file; checked
//                              to confirm every other isAdmin(req) use in
//                              lessons.js is a scope-narrowing check, not a
//                              stand-in for a missing gate, before adding it)
const RBAC_RE  = /rbac\s*\(|\/[/*] rbac:|planGate\(|_pdfAccess|_can\(|_typeGuard|behaviourAccess\(|timetableManageAccess\(|attendanceConflictAccess\(|_hasBulkImportGrant\(|hasExplicitSubGrant\(|explicitSub\(|payrollManageAccess\(|hrFloorOnly|!isAdmin\(req\)\)\s*return/;
const AUTH_RE  = /authMiddleware/;
// Some files apply authMiddleware once, file-wide, via router.use(...)
// rather than repeating it on every individual route line (e.g.
// library.js, hostel.js, transport.js, hr.js, messages.js, events.js,
// subjects.js, birthdays.js). AUTH_RE's local-context check never sees
// that string next to any specific route in those files, which used to
// make every route in them invisible to this scanner — not counted as a
// gap, not counted as protected, just silently excluded from `total`.
const ROUTER_USE_AUTH_RE = /^\s*router\.use\s*\(\s*authMiddleware\b/m;

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
    const fileWideAuth = ROUTER_USE_AUTH_RE.test(source);
    let match;
    ROUTE_RE.lastIndex = 0;

    while ((match = ROUTE_RE.exec(source)) !== null) {
      const method    = match[1].toUpperCase();
      const routePath = match[2];
      const lineNum   = source.slice(0, match.index).split('\n').length;
      const lineCtx   = lines.slice(Math.max(0, lineNum - 1), lineNum + 3).join(' ');

      if (!fileWideAuth && !AUTH_RE.test(lineCtx)) continue;
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
