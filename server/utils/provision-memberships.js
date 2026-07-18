/* ============================================================
   Msingi — Membership Provisioning  (Phase 1 · C7)

   Every User must have a Membership recording which School(s) they
   have access to (ARCHITECTURE_CONSTITUTION §6-10 Stage 2). This
   backfills a Membership for every existing User that does not yet
   have one.

   DESIGN NOTES (deliberate, see docs/governance/):
   • NON-AUTHORITATIVE. auth.js, sessionService.js, rbac.js, and
     scopeMiddleware.js all still read `role`/`roles` directly off the
     JWT (req.jwtUser) — nothing reads this collection yet. This is a
     shadow collection, not a login path change.
   • Self-heals: if the user's school has no organizationId yet, this
     calls the existing provisionOrganizationForSchool() inline so a
     Membership is never created without a resolvable orgId.
   • Idempotent — keyed on {userId, schoolId} (see indexes.js
     mem_user_school unique index); re-running is a no-op for users
     that already have a membership for that school.
   • Interruption-safe — upsert, same pattern as provisionOrganizations.
   • Reversible — drop the collection. Nothing downstream reads it.
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { _model } = require('./model');
const { provisionOrganizationForSchool } = require('./provision-organizations');

/**
 * Get-or-create the Membership linking one User to one School and shared by
 * the batch backfill below and by immediate, synchronous calls at grant time
 * (platform.js's POST /memberships). Idempotent, crash-safe upsert keyed on
 * {userId, schoolId}.
 *
 * `user` must have `_id` (a real Mongo ObjectId) and, ideally, `id`, `role`/
 * `roles`, `schoolId`. Returns the membership doc, or null if the user or
 * their school has no usable identifier.
 */
async function provisionMembershipForUser(user, { Schools, Orgs, Memberships, opts } = {}) {
  Schools     = Schools     || _model('schools');
  Orgs        = Orgs        || _model('organizations');
  Memberships = Memberships || _model('memberships');

  const userId = user.id || (user._id && user._id.toString());
  const schoolId = user.schoolId;
  if (!userId || !schoolId) return null;   // malformed doc — never crash the caller

  const school = await Schools.findOne({ id: schoolId }).lean();
  if (!school) return null;   // dangling schoolId — skip rather than crash

  let orgId = school.organizationId || null;
  if (!orgId) {
    const org = await provisionOrganizationForSchool(school, { Schools, Orgs });
    orgId = org ? org.id : null;
  }

  const now = new Date().toISOString();

  const membership = await Memberships.findOneAndUpdate(
    { userId, schoolId },
    {
      $setOnInsert: {
        id:         `mem_${uuidv4()}`,
        orgId,
        userId,
        schoolId,
        role:       user.role || null,
        roles:      user.roles || (user.role ? [user.role] : []),
        isActive:   user.isActive !== false,
        status:     'active',
        isPrimary:  opts?.isPrimary !== undefined ? opts.isPrimary : true,
        source:     opts?.source || 'user_backfill',
        createdBy:  opts?.createdBy || 'system:provision',
        createdAt:  now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true, new: true }
  ).lean();

  return membership;
}

async function provisionMemberships() {
  try {
    const Users       = _model('users');
    const Schools     = _model('schools');
    const Orgs        = _model('organizations');
    const Memberships = _model('memberships');

    const existing = await Memberships.find({}).select('userId schoolId').lean();
    const already = new Set(existing.map(m => `${m.userId}:${m.schoolId}`));

    const cursor = Users.find({}).lean().cursor();

    let count = 0;
    for await (const user of cursor) {
      const userId = user.id || (user._id && user._id.toString());
      if (!userId || !user.schoolId) continue;
      if (already.has(`${userId}:${user.schoolId}`)) continue;

      const membership = await provisionMembershipForUser(user, { Schools, Orgs, Memberships });
      if (membership) count++;
    }

    if (count > 0) {
      console.log(`[Migration] memberships: provisioned ${count} user(s) with a membership`);
    }
    return { provisioned: count };
  } catch (err) {
    // Non-fatal — next startup retries. Provisioning must never block boot.
    console.error('[Migration] provisionMemberships failed:', err.message);
    return { provisioned: 0, error: err.message };
  }
}

module.exports = { provisionMemberships, provisionMembershipForUser };
