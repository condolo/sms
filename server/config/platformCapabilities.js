/* ============================================================
   PLATFORM CAPABILITIES — single source of truth for what a
   Msingi platform operator (platform_operators account) may do.

   WHY THIS EXISTS
   Until now the only unit of platform permission was a binary
   `tier` ('support' | 'owner'): every GET was open to any tier and
   every mutating verb required owner. That made a platform "team
   member" impossible — the choice was full owner (delete schools,
   impersonate, grant entitlements) or read-only-everything.

   This file adds a capability layer on top of the existing tier,
   WITHOUT changing what the legacy tiers do:
     - tier 'owner'                        -> ['*']  (unchanged)
     - tier 'support' (no template set)    -> 'viewer' template
                                              (read-only, exactly what
                                              support tier could do
                                              before — no escalation)
     - any operator with `template` set    -> that template's caps
                                              + per-operator overrides

   So existing operators behave identically until someone explicitly
   assigns a template. That is the whole point of the default in
   resolveCapabilities() below.

   ADDING A CAPABILITY: add one entry to CAPABILITIES. It then shows
   up in the Team UI automatically and can be attached to templates.
   ADDING A ROUTE GUARD: add one rule to POLICY (see requiredCapability).
   ============================================================ */
'use strict';

/* ── Capabilities ─────────────────────────────────────────────
   `key` is what code checks; `group` clusters them in the Team UI. */
const CAPABILITIES = [
  { key: 'tickets.view',      group: 'Tickets',     label: 'View support tickets' },
  { key: 'tickets.manage',    group: 'Tickets',     label: 'Reply, assign and change ticket status' },

  { key: 'onboarding.view',   group: 'Onboarding',  label: 'View demo requests and pending schools' },
  { key: 'onboarding.manage', group: 'Onboarding',  label: 'Approve/reject, extend demos, provision schools' },

  { key: 'schools.view',      group: 'Schools',     label: 'View schools and organizations' },
  { key: 'schools.manage',    group: 'Schools',     label: 'Create/edit schools, roles, entitlements' },
  { key: 'schools.delete',    group: 'Schools',     label: 'Delete schools and wipe data (destructive)' },
  { key: 'impersonate',       group: 'Schools',     label: 'Sign in as a school user (audited)' },

  { key: 'users.search',      group: 'Schools',     label: 'Cross-school user search' },

  { key: 'billing.view',      group: 'Billing',     label: 'View billing' },

  { key: 'content.manage',    group: 'Content',     label: 'Announcements, branding, landing page, settings' },

  { key: 'diagnostics.view',  group: 'Diagnostics', label: 'Platform health, integrity and diagnostics' },

  { key: 'operators.manage',  group: 'Team',        label: 'Invite and manage platform team members' },
];

const CAPABILITY_KEYS = new Set(CAPABILITIES.map(c => c.key));

const CAPABILITY_GROUPS = [...new Set(CAPABILITIES.map(c => c.group))];

/* ── Roles / templates ────────────────────────────────────────
   A template is a named starting point; per-operator `capabilities`
   overrides are unioned on top of it (never removing, only adding —
   see resolveCapabilities). `owner` is special: always ['*']. */
const TEMPLATES = {
  owner: {
    label: 'Owner',
    description: 'Full access to everything, including destructive actions.',
    caps: ['*'],
  },
  support_agent: {
    label: 'Support agent',
    description: 'Answer and assign tickets; handle onboarding requests. No destructive actions.',
    caps: [
      'tickets.view', 'tickets.manage',
      'onboarding.view', 'onboarding.manage',
      'schools.view', 'diagnostics.view',
    ],
  },
  onboarding: {
    label: 'Onboarding',
    description: 'Process demo requests and pending school approvals; read tickets.',
    caps: ['onboarding.view', 'onboarding.manage', 'tickets.view', 'schools.view'],
  },
  billing: {
    label: 'Billing',
    description: 'View billing and school metadata.',
    caps: ['billing.view', 'schools.view'],
  },
  content: {
    label: 'Content',
    description: 'Manage announcements, branding, the landing page and platform settings.',
    caps: ['content.manage', 'schools.view'],
  },
  viewer: {
    label: 'Viewer (read-only)',
    description: 'Read-only access to tickets, onboarding, schools, billing and diagnostics.',
    caps: [
      'tickets.view', 'onboarding.view', 'schools.view',
      'billing.view', 'diagnostics.view',
    ],
  },
  custom: {
    label: 'Custom',
    description: 'Only the capabilities toggled individually below.',
    caps: [],
  },
};

/* Back-compat: an operator with no explicit `template` keeps exactly the
   access its legacy tier already had. 'support' was read-only, so it maps
   to 'viewer' — deliberately NOT to 'support_agent', so creating the
   capability layer can never silently widen an existing account. */
const LEGACY_TIER_TEMPLATE = { owner: 'owner', support: 'viewer' };

/* ── Route policy ─────────────────────────────────────────────
   Maps (method, path) -> capability. Patterns use ':param' for one
   segment. The MOST SPECIFIC match wins (most literal segments), so a
   generic later rule cannot shadow an earlier specific one.

   Unmatched routes fall back to legacy behaviour in
   requirePlatformCapability(): GET is allowed for any authenticated
   operator, any other verb requires owner ('*'). That keeps every route
   not listed here exactly as permissive/restrictive as before. */
const POLICY = [
  /* Tickets */
  { method: 'GET',    pattern: '/tickets',                              cap: 'tickets.view' },
  { method: 'GET',    pattern: '/tickets/:id',                          cap: 'tickets.view' },
  { method: 'POST',   pattern: '/tickets',                              cap: 'tickets.manage' },
  { method: 'PATCH',  pattern: '/tickets/:id',                          cap: 'tickets.manage' },
  { method: 'POST',   pattern: '/tickets/:id/messages',                 cap: 'tickets.manage' },
  { method: 'POST',   pattern: '/tickets/:id/assign',                   cap: 'tickets.manage' },

  /* Onboarding — demo requests, pending schools, provisioning */
  { method: 'GET',    pattern: '/demo-requests',                        cap: 'onboarding.view' },
  { method: 'POST',   pattern: '/demo-requests/:id/assign',             cap: 'onboarding.manage' },
  { method: 'GET',    pattern: '/demo-requests/:id',                    cap: 'onboarding.view' },
  { method: 'POST',   pattern: '/demo-requests/:id/approve',            cap: 'onboarding.manage' },
  { method: 'POST',   pattern: '/demo-requests/:id/reject',             cap: 'onboarding.manage' },
  { method: 'GET',    pattern: '/demo-sweep',                           cap: 'onboarding.view' },
  { method: 'GET',    pattern: '/schools/pending',                      cap: 'onboarding.view' },
  { method: 'POST',   pattern: '/schools/:id/assign',                   cap: 'onboarding.manage' },
  { method: 'POST',   pattern: '/schools/:id/approve',                  cap: 'onboarding.manage' },
  { method: 'POST',   pattern: '/schools/:id/reject',                   cap: 'onboarding.manage' },
  { method: 'POST',   pattern: '/schools/:id/extend-demo',              cap: 'onboarding.manage' },

  /* Work queue — any authenticated operator sees only their own items */
  { method: 'GET',    pattern: '/my-work',                              cap: null },

  /* Who am I — any authenticated operator */
  { method: 'GET',    pattern: '/me',                                   cap: null },

  /* Schools */
  { method: 'GET',    pattern: '/schools',                              cap: 'schools.view' },
  { method: 'POST',   pattern: '/schools',                              cap: 'onboarding.manage' },
  { method: 'GET',    pattern: '/schools/:id/superadmins',              cap: 'schools.view' },
  { method: 'POST',   pattern: '/schools/:id/superadmins',              cap: 'schools.manage' },
  { method: 'POST',   pattern: '/schools/:id/superadmins/promote',      cap: 'schools.manage' },
  { method: 'GET',    pattern: '/schools/:id/roles',                    cap: 'schools.view' },
  { method: 'POST',   pattern: '/schools/:id/superadmins/:userId/change-role',   cap: 'schools.manage' },
  { method: 'POST',   pattern: '/schools/:id/superadmins/:userId/reset-password', cap: 'schools.manage' },
  { method: 'GET',    pattern: '/schools/:id/entitlements',             cap: 'schools.view' },
  { method: 'POST',   pattern: '/schools/:id/entitlements',             cap: 'schools.manage' },
  { method: 'DELETE', pattern: '/schools/:id/entitlements/:key',        cap: 'schools.manage' },
  { method: 'PATCH',  pattern: '/schools/:id',                          cap: 'schools.manage' },
  { method: 'POST',   pattern: '/schools/:id/impersonate',              cap: 'impersonate' },
  { method: 'POST',   pattern: '/impersonation-sessions/:sessionId/revoke', cap: 'impersonate' },
  { method: 'DELETE', pattern: '/schools/all',                          cap: 'schools.delete' },
  { method: 'DELETE', pattern: '/schools/:id',                          cap: 'schools.delete' },

  /* Organizations */
  { method: 'GET',    pattern: '/organizations',                        cap: 'schools.view' },
  { method: 'POST',   pattern: '/organizations',                        cap: 'schools.manage' },
  { method: 'POST',   pattern: '/organizations/:id/director',           cap: 'schools.manage' },
  { method: 'PATCH',  pattern: '/organizations/:id',                    cap: 'schools.manage' },
  { method: 'PUT',    pattern: '/organizations/:id/logo',               cap: 'schools.manage' },
  { method: 'DELETE', pattern: '/organizations/:id/logo',               cap: 'schools.manage' },
  { method: 'PUT',    pattern: '/organizations/:id/login-bg',           cap: 'schools.manage' },
  { method: 'DELETE', pattern: '/organizations/:id/login-bg',           cap: 'schools.manage' },
  { method: 'POST',   pattern: '/organizations/:id/enable-multi-school',  cap: 'schools.manage' },
  { method: 'POST',   pattern: '/organizations/:id/disable-multi-school', cap: 'schools.manage' },
  { method: 'POST',   pattern: '/memberships',                          cap: 'schools.manage' },

  /* Sensitive reads */
  { method: 'GET',    pattern: '/users/search',                         cap: 'users.search' },

  /* Billing */
  { method: 'GET',    pattern: '/billing/all',                          cap: 'billing.view' },

  /* Diagnostics */
  { method: 'GET',    pattern: '/stats',                                cap: 'diagnostics.view' },
  { method: 'GET',    pattern: '/test-email',                           cap: 'diagnostics.view' },
  { method: 'DELETE', pattern: '/orphans',                              cap: 'schools.delete' },

  /* Content & platform settings */
  { method: 'GET',    pattern: '/announcements',                        cap: 'content.manage' },
  { method: 'POST',   pattern: '/announcements',                        cap: 'content.manage' },
  { method: 'PATCH',  pattern: '/announcements/:id',                    cap: 'content.manage' },
  { method: 'DELETE', pattern: '/announcements/:id',                    cap: 'content.manage' },
  { method: 'PUT',    pattern: '/settings',                             cap: 'content.manage' },
  { method: 'PUT',    pattern: '/settings/logo',                        cap: 'content.manage' },
  { method: 'DELETE', pattern: '/settings/logo',                        cap: 'content.manage' },
  { method: 'PUT',    pattern: '/settings/favicon',                     cap: 'content.manage' },
  { method: 'DELETE', pattern: '/settings/favicon',                     cap: 'content.manage' },
  { method: 'PUT',    pattern: '/landing-content',                      cap: 'content.manage' },

  /* Team management */
  { method: 'GET',    pattern: '/operators',                            cap: 'operators.manage' },
  { method: 'GET',    pattern: '/operators/capabilities',               cap: null },
  { method: 'GET',    pattern: '/operators/directory',                  cap: null },  { method: 'POST',   pattern: '/operators/invite',                     cap: 'operators.manage' },
  { method: 'POST',   pattern: '/operators/:id/resend-invite',          cap: 'operators.manage' },
  { method: 'PATCH',  pattern: '/operators/:id',                        cap: 'operators.manage' },
  { method: 'POST',   pattern: '/operators/:id/suspend',                cap: 'operators.manage' },
  { method: 'POST',   pattern: '/operators/:id/reactivate',             cap: 'operators.manage' },
  { method: 'POST',   pattern: '/operators/:id/revoke-sessions',        cap: 'operators.manage' },
  { method: 'DELETE', pattern: '/operators/:id',                        cap: 'operators.manage' },
];

/* ── Internals ──────────────────────────────────────────────── */

/** Compile '/a/:b/c' into a regex with a literal-segment count for ranking. */
function _compile(pattern) {
  const segs = pattern.split('/').filter(Boolean);
  let literals = 0;
  const re = segs.map(seg => {
    if (seg.startsWith(':')) return '[^/]+';
    if (seg === '*') return '.*';
    literals += 1;
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { re: new RegExp(`^/${re}/?$`, 'i'), literals };
}
const _COMPILED_POLICY = POLICY.map(rule => ({ ...rule, ..._compile(rule.pattern) }));

/**
 * Which capability does (method, path) require?
 *   'null'      -> no capability needed (any authenticated operator)
 *   '*'         -> owner only
 *   '<key>'     -> that capability
 *   undefined   -> no rule (caller applies the legacy default)
 */
function requiredCapability(method, path) {
  const m = String(method || '').toUpperCase();
  const p = String(path || '').split('?')[0] || '/';
  let best = null;
  for (const rule of _COMPILED_POLICY) {
    if (rule.method !== m) continue;
    if (!rule.re.test(p)) continue;
    if (!best || rule.literals > best.literals) best = rule;
  }
  return best ? best.cap : undefined;
}

/** Template caps as a plain array (owner -> ['*']). */
function templateCaps(template) {
  const t = TEMPLATES[template];
  return t ? [...t.caps] : [];
}

/** Drop unknown capability keys (defensive: never trust a stored list). */
function sanitizeCapabilities(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(k => typeof k === 'string' && CAPABILITY_KEYS.has(k)))];
}

/**
 * The effective capability set for an operator document.
 * Reads `template` first (falling back to the legacy tier mapping), then
 * unions any per-operator `capabilities` overrides. Owner tier is always
 * ['*'] regardless of the fields stored, so an owner can never lock
 * themselves out of their own account by editing a template.
 */
function resolveCapabilities(operator = {}) {
  if (operator.tier === 'owner') return ['*'];
  const template = operator.template || LEGACY_TIER_TEMPLATE[operator.tier] || 'custom';
  if (template === 'owner') return ['*'];
  return [...new Set([...templateCaps(template), ...sanitizeCapabilities(operator.capabilities)])];
}

/** Does `caps` satisfy `required`? `required` falsy -> yes; '*' -> owner only. */
function hasCapability(caps, required) {
  if (!required) return true;
  if (!Array.isArray(caps)) return false;
  return caps.includes('*') || caps.includes(required);
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_KEYS,
  CAPABILITY_GROUPS,
  TEMPLATES,
  LEGACY_TIER_TEMPLATE,
  POLICY,
  requiredCapability,
  templateCaps,
  sanitizeCapabilities,
  resolveCapabilities,
  hasCapability,
};
