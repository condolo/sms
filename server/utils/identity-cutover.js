/* ============================================================
   Msingi — Identity Cutover Kill Switch  (C8/MR-001 Phase 3)

   Single source of truth for whether auth.js/settings.js's credential
   checks read identities.passwordHash/mfaEnabled (when a user has an
   identityId) instead of users.password/mfaEnabled. Imported by both
   files so the three cutover-aware check sites can never drift out of
   sync with each other.

   Ships DISABLED by default — merging Phase 3's code changes nothing
   in any running deployment until an operator explicitly sets
   IDENTITY_CUTOVER_ENABLED=true, and rollback is flipping it back off,
   instantly, no code revert or redeploy needed. Only flip this on
   after confirming GET /api/qa/health's `identity` gate reports
   status: 'complete' against real data (ADR-0003 Phase 2).
   ============================================================ */
'use strict';

function isIdentityCutoverEnabled() {
  return process.env.IDENTITY_CUTOVER_ENABLED === 'true';
}

module.exports = { isIdentityCutoverEnabled };
