/* ============================================================
   Msingi — Capability/Entitlement Registry  (C3)

   Records that a specific School holds a specific capability,
   independent of its plan tier (PLATFORM_ARCHITECTURE_EVOLUTION_v1.md
   §8: "plans and features must never be coupled").

   NOT YET WIRED UP. `server/middleware/plan.js`'s FEATURE_PLAN /
   planGate() do not call this — nothing in the app makes an access
   decision from this collection yet. This file exists so that future
   work (dependency graph C10 — flipping the plan gate to a dual-read
   entitlement check) has a tested primitive to call instead of writing
   raw queries against a new collection for the first time under a
   Kernel-tier change.
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
