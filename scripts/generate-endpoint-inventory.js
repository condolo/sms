/**
 * generate-endpoint-inventory.js — Platform Architecture Manifest
 *
 * Permanent engineering artifact. Documents every HTTP endpoint's complete
 * authorization posture. Becomes the platform contract — run after every
 * sprint to track progress across all six dimensions.
 *
 * Output: scripts/endpoint-inventory.json
 *
 * Dimensions per endpoint:
 *   category      — rbac | auth-only | public
 *   rbacModule    — permission module (extracted from rbac() arguments)
 *   rbacAction    — permission action (read | create | update | delete)
 *   hasAuth       — authMiddleware present
 *   hasPlan       — planGate / PLAN present
 *   tenantScoped  — schoolId referenced in handler context
 *   auditLogged   — audit log call present in handler
 *   rateLimit     — rate-limiting middleware present
 *
 * Usage: node scripts/generate-endpoint-inventory.js
 *   or:  npm run platform:manifest
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../server/routes');

const { classifyRisk } = require('./_risk-classify');

const ALLOWLISTED = new Set([
  'auth.js', 'mpesa.js', 'platform.js', 'public.js', 'portals.js',
  'sync.js', 'onboard.js', 'backup.js', 'billing.js', 'health.js',
  'parent-portal.js', 'student-portal.js',
]);

/* ── Regex patterns ─────────────────────────────────────────────────── */
const ROUTE_RE     = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const RBAC_RE      = /rbac\s*\(|\/[/*] rbac:/;
const RBAC_ARGS_RE = /rbac\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/;
const AUTH_RE      = /authMiddleware/;
const PLAN_RE      = /planGate|PLAN\b/;
const TENANT_RE    = /schoolId/;
const AUDIT_RE     = /AuditService\.log\s*\(|auditLog\s*\(|_audit\s*\(|auditTrail\s*\(/;
const RATE_RE      = /rateLimit\s*\(|rateLimiter\b|\blimiter\s*,|\blimiter\s*\)/;

/* ── Scan ───────────────────────────────────────────────────────────── */
const inventory = [];
const summary   = {
  total: 0, rbac: 0, authOnly: 0, public: 0,
  tenantScoped: 0, auditLogged: 0, rateLimited: 0,
  byRisk: { critical: 0, high: 0, medium: 0, low: 0 },
  businessTotal: 0, businessProtected: 0, coverage: 0,
};

for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js')).sort()) {
  const source      = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
  const lines       = source.split('\n');
  const isAllowlist = ALLOWLISTED.has(file);

  let match;
  ROUTE_RE.lastIndex = 0;

  while ((match = ROUTE_RE.exec(source)) !== null) {
    const method  = match[1].toUpperCase();
    const route   = match[2];
    const lineNum = source.slice(0, match.index).split('\n').length;

    /* Narrow context (4 lines): middleware detection */
    const lineCtx = lines.slice(Math.max(0, lineNum - 1), lineNum + 3).join(' ');
    /* Wide context (20 lines): handler-body detection */
    const wideCtx = lines.slice(Math.max(0, lineNum - 1), lineNum + 20).join(' ');

    const hasRbac     = RBAC_RE.test(lineCtx);
    const hasAuth     = AUTH_RE.test(lineCtx);
    const hasPlan     = PLAN_RE.test(lineCtx);
    const tenantScoped = TENANT_RE.test(wideCtx);
    const auditLogged  = AUDIT_RE.test(wideCtx);
    const rateLimit    = RATE_RE.test(lineCtx);
    const risk         = classifyRisk(file, method, route);

    /* Extract rbac module + action from middleware arguments */
    let rbacModule = null;
    let rbacAction = null;
    if (hasRbac) {
      const argsMatch = lineCtx.match(RBAC_ARGS_RE);
      if (argsMatch) {
        rbacModule = argsMatch[1];
        rbacAction = argsMatch[2];
      } else if (/\/[/*] rbac: dynamic/.test(lineCtx)) {
        rbacModule = 'dynamic';
        rbacAction = 'dynamic';
      }
    }

    const category = !hasAuth && !hasRbac ? 'public'
      : hasRbac ? 'rbac'
      : 'auth-only';

    inventory.push({
      file, method, path: route, line: lineNum,
      risk,
      category,
      rbacModule, rbacAction,
      hasAuth, hasPlan,
      tenantScoped, auditLogged, rateLimit,
      allowlisted: isAllowlist,
    });

    summary.total++;
    if (category === 'rbac')        summary.rbac++;
    else if (category === 'public') summary.public++;
    else                            summary.authOnly++;
    if (tenantScoped)  summary.tenantScoped++;
    if (auditLogged)   summary.auditLogged++;
    if (rateLimit)     summary.rateLimited++;
    if (risk) summary.byRisk[risk] = (summary.byRisk[risk] || 0) + 1;
  }
}

/* ── Business coverage ──────────────────────────────────────────────── */
const biz  = inventory.filter(e => !e.allowlisted && e.category !== 'public');
const bizP = biz.filter(e => e.category === 'rbac');
summary.businessTotal     = biz.length;
summary.businessProtected = bizP.length;
summary.coverage          = biz.length > 0
  ? parseFloat((bizP.length / biz.length * 100).toFixed(2))
  : 100;

/* ── Module coverage breakdown ──────────────────────────────────────── */
const byModule = {};
for (const e of inventory.filter(e => e.rbacModule && e.rbacModule !== 'dynamic')) {
  if (!byModule[e.rbacModule]) byModule[e.rbacModule] = { endpoints: 0, actions: new Set() };
  byModule[e.rbacModule].endpoints++;
  if (e.rbacAction) byModule[e.rbacModule].actions.add(e.rbacAction);
}
const moduleCoverage = Object.fromEntries(
  Object.entries(byModule).sort().map(([m, v]) => [m, {
    endpoints: v.endpoints,
    actions: [...v.actions].sort(),
  }])
);

/* ── Gap lists ──────────────────────────────────────────────────────── */
const noRbac        = inventory.filter(e => !e.allowlisted && e.category === 'auth-only');
const noAudit       = inventory.filter(e => !e.allowlisted && e.category === 'rbac' && !e.auditLogged);
const noRate        = inventory.filter(e => !e.allowlisted && e.hasAuth && !e.rateLimit);
/* Critical endpoints missing RBAC or audit — highest priority Sprint 1 work */
const criticalGaps  = inventory.filter(e =>
  !e.allowlisted && e.risk === 'critical' && (e.category !== 'rbac' || !e.auditLogged)
);

/* ── Write output ───────────────────────────────────────────────────── */
const output = {
  generatedAt:   new Date().toISOString(),
  schemaVersion: 2,
  description:   'Platform Architecture Manifest — authorization posture of every HTTP endpoint',
  summary,
  moduleCoverage,
  gaps: {
    criticalMissingGates: criticalGaps.map(e => ({
      endpoint:    `${e.method} ${e.file.replace('.js', '')}${e.path}`,
      missingRbac: e.category !== 'rbac',
      missingAudit: !e.auditLogged,
    })),
    noRbac:   noRbac.map(e  => `${e.method} ${e.file.replace('.js', '')}${e.path}`),
    noAudit:  noAudit.map(e => `${e.method} ${e.file.replace('.js', '')}${e.path}`),
    noRate:   noRate.slice(0, 20).map(e => `${e.method} ${e.file.replace('.js', '')}${e.path}`),
  },
  endpoints: inventory,
};

const outPath = path.join(__dirname, 'endpoint-inventory.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

/* ── Console report ─────────────────────────────────────────────────── */
const pad = n => String(n).padStart(4);
console.log('\n── Platform Architecture Manifest ──────────────────────────');
console.log(`Total endpoints:    ${pad(summary.total)}`);
console.log(`  rbac():           ${pad(summary.rbac)}  (${summary.coverage}% of business routes)`);
console.log(`  auth-only:        ${pad(summary.authOnly)}`);
console.log(`  public/webhook:   ${pad(summary.public)}`);
console.log(`Tenant-scoped:      ${pad(summary.tenantScoped)} / ${summary.total}`);
console.log(`Audit-logged:       ${pad(summary.auditLogged)} / ${summary.total}  ← Trust & Compliance Sprint target`);
console.log(`Rate-limited:       ${pad(summary.rateLimited)} / ${summary.total}  ← Trust & Compliance Sprint target`);
console.log(`\nRisk breakdown:`);
console.log(`  critical:         ${pad(summary.byRisk.critical)}  (all 8 gates required)`);
console.log(`  high:             ${pad(summary.byRisk.high)}  (auth, RBAC, tenant, audit, tests)`);
console.log(`  medium:           ${pad(summary.byRisk.medium)}  (auth, RBAC, tenant)`);
console.log(`  low:              ${pad(summary.byRisk.low)}  (auth, tenant)`);
if (criticalGaps.length > 0) {
  console.log(`\n⚠  Critical endpoints missing gates (${criticalGaps.length}):`);
  criticalGaps.forEach(e => {
    const missing = [e.category !== 'rbac' && 'RBAC', !e.auditLogged && 'Audit'].filter(Boolean).join(', ');
    console.log(`  ${e.method.padEnd(7)} ${e.file.padEnd(30)} ${e.path}  [missing: ${missing}]`);
  });
}
console.log(`\nModules with rbac():`);
Object.entries(moduleCoverage).forEach(([m, v]) =>
  console.log(`  ${m.padEnd(20)} ${v.endpoints} endpoints  [${v.actions.join(', ')}]`)
);
console.log(`\nManifest saved to:  ${outPath}`);

if (noRbac.length > 0) {
  console.log(`\n── Auth-only gaps (${noRbac.length}) — Sprint 1/2 work ─────────────`);
  noRbac.forEach(e => console.log(`  ${e.method.padEnd(7)} ${e.file.padEnd(30)} ${e.path}`));
}
