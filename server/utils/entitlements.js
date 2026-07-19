/* ============================================================
   Msingi — Capability/Entitlement Registry  (C3)

   Records that a specific School holds a specific capability,
   independent of its plan tier (PLATFORM_ARCHITECTURE_EVOLUTION_v1.md
   §8: "plans and features must never be coupled").

   Consulted by `server/middleware/plan.js`'s `planGate()` as an
   additive override (ADR-0004, dependency graph C10) — only checked
   when a school's plan tier alone would deny a feature; never
   consulted, and never able to suppress access, when the plan already
   grants it.
   ============================================================ */
'use strict';

const { _model } = require('./model');

/**
 * Whether a school currently holds an active, non-expired entitlement
 * for the given capability key. Pure read — no side effects.
 */
async function hasEntitlement(schoolId, key, { Entitlements } = {}) {
  Entitlements = Entitlements || _model('entitlements');

  if (!schoolId || !key) return false;

  const doc = await Entitlements.findOne({ schoolId, key }).lean();
  if (!doc || doc.status !== 'active') return false;
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) return false;

  return true;
}

module.exports = { hasEntitlement };
