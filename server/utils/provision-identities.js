/* ============================================================
   Msingi — Identity Provisioning  (C8/MR-001 Phase 0 · Shadow)

   Backfills a shared, credential-owning Identity for every existing
   User that has an email (staff/parent accounts — student/username-only
   accounts have no email and are permanently skipped, see below).

   DESIGN NOTES (ADR-0003 — see docs/adr/ADR-0003-identity-separation-index-migration.md):
   • NOT YET CONSULTED. auth.js still authenticates against
     users.password exclusively. This is a shadow collection, exactly
     like provision-memberships.js was for C7 — it changes nothing
     about how anyone logs in.
   • `users` is NOT restructured. Only a new `identityId` FK is added.
     The existing {schoolId,email} unique index stays — it serves
     per-school lookup, a different concern from credential storage.
   • Collision policy: NEVER auto-merge on email match alone. Two
     unrelated schools' admins may have registered the same email as
     two different people (today's uniqueness is only per-school).
     Only merge into one Identity when an existing `memberships` grant
     (the shipped Link Identity flow, ADR-0002) already links the two
     users across schools — i.e. a human already vouched they're the
     same person. Otherwise: status 'collision_pending', both/all
     accounts keep authenticating via users.password exactly as today,
     PERMANENTLY (not a temporary blocking state), until a platform
     admin resolves it via a future extended Link Identity flow.
   • Self-heals: if the user's school has no organizationId yet, this
     calls the existing provisionOrganizationForSchool() inline, same
     as provision-memberships.js.
   • Idempotent — a user with users.identityId already set is a no-op;
     the merge/collision paths use their own DB-enforced unique keys
     ({orgId,email} and collisionKey respectively) so re-running is
     always safe.
   • Interruption-safe — every write is an upsert.
   • Reversible — drop the collection, unset users.identityId. Nothing
     downstream reads either yet.
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { _model } = require('./model');
const { provisionOrganizationForSchool } = require('./provision-organizations');

/* Preserve tri-state instead of coercing to boolean. Found live (real-DB
   production validation, not a mock): `!!user.mfaEnabled` turns "never
   explicitly set" into an explicit `false` on the identity doc. Every MFA
   check in auth.js reads `mfaEnabled !== false` to decide whether an
   MFA_ROLES user gets challenged — intentionally "on unless explicitly
   opted out." Coercing an unset value to `false` silently opts EVERY
   identity-linked MFA-eligible user OUT the moment their identity is
   provisioned (which is unconditional and happens for virtually every
   email-bearing account) — an MFA bypass for superadmin/admin/deputy/
   principal/finance, not a hypothetical: it fires the first time any of
   those roles' identities resolve, including on every org-login call. */
function _mfaTriState(user) {
  if (user.mfaEnabled === true)  return true;
  if (user.mfaEnabled === false) return false;
  return null;
}

/**
 * Get-or-create the Identity owning one User's credentials, handling the
 * collision policy above. Shared by the batch backfill below and by
 * immediate, synchronous calls at account-creation time (every users.create()
 * call site — see ADR-0003's AST-verified creation-site list).
 *
 * `user` must have `_id`, `id`, `schoolId`, and (for this to do anything)
 * `email`. Returns the identity doc (status 'active' or 'collision_pending'),
 * or null if the user has no email, no resolvable school/org, or is
 * malformed.
 */
async function provisionIdentityForUser(user, { Schools, Orgs, Users, Identities, Memberships, opts } = {}) {
  Schools     = Schools     || _model('schools');
  Orgs        = Orgs        || _model('organizations');
  Users       = Users       || _model('users');
  Identities  = Identities  || _model('identities');
  Memberships = Memberships || _model('memberships');

  const userId = user.id || (user._id && user._id.toString());
  const schoolId = user.schoolId;
  if (!userId || !schoolId) return null;   // malformed doc — never crash the caller

  const email = typeof user.email === 'string' && user.email.trim()
    ? user.email.trim().toLowerCase()
    : null;
  if (!email) return null;   // student/username-only account — Identity is meaningless here, permanent skip

  if (user.identityId) {
    const already = await Identities.findOne({ id: user.identityId }).lean();
    if (already) return already;   // already provisioned — idempotent no-op
  }

  const school = await Schools.findOne({ id: schoolId }).lean();
  if (!school) return null;   // dangling schoolId — skip rather than crash

  let orgId = school.organizationId || null;
  if (!orgId) {
    const org = await provisionOrganizationForSchool(school, { Schools, Orgs });
    orgId = org ? org.id : null;
  }
  if (!orgId) return null;   // cannot scope an org-scoped identity without an org

  const now = new Date().toISOString();

  // Every OTHER users doc in the same organization sharing this email
  // (case-insensitive app-level compare — avoids regex injection/ReDoS on
  // untrusted stored strings; org-scoped query keeps this cheap).
  const orgSchools   = await Schools.find({ organizationId: orgId }).select('id').lean();
  const orgSchoolIds = orgSchools.map(s => s.id);
  const candidates = await Users.find({
    schoolId: { $in: orgSchoolIds },
    _id:      { $ne: user._id },
    email:    { $exists: true, $type: 'string' },
  }).select('id schoolId identityId email').lean();
  const siblings = candidates.filter(c => c.email.trim().toLowerCase() === email);

  if (siblings.length === 0) {
    const identity = await Identities.findOneAndUpdate(
      { orgId, email },
      {
        $setOnInsert: {
          id:            `idt_${uuidv4()}`,
          orgId,
          email,
          passwordHash:  user.password || null,
          mfaEnabled:    _mfaTriState(user),
          tokenVersion:  0,
          status:        'active',
          mergedInto:    null,
          sourceUserIds: [userId],
          createdBy:     opts?.createdBy || 'system:provision',
          createdAt:     now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true, new: true }
    ).lean();
    await Users.updateOne({ _id: user._id }, { $set: { identityId: identity.id } });
    return identity;
  }

  // Collision candidates exist. Only trust a sibling as "the same person" if
  // an existing membership grant already links the two across schools — the
  // shipped Link Identity flow (ADR-0002) is the sole source of truth for
  // sameness. Never infer it from a matching email alone.
  const vouched = [];
  for (const sib of siblings) {
    const linked = await Memberships.findOne({
      $or: [
        { userId, schoolId: sib.schoolId },
        { userId: sib.id, schoolId },
      ],
    }).lean();
    if (linked) vouched.push(sib);
  }

  if (vouched.length === siblings.length) {
    // Every sibling is vouched for — safe to merge into one shared Identity.
    const existingIdentityId = vouched.find(s => s.identityId)?.identityId;
    const identityId = existingIdentityId || `idt_${uuidv4()}`;
    const allUserIds = [userId, ...vouched.map(s => s.id)];

    const identity = await Identities.findOneAndUpdate(
      { id: identityId },
      {
        $setOnInsert: {
          id:           identityId,
          orgId,
          email,
          passwordHash: user.password || null,
          mfaEnabled:   _mfaTriState(user),
          tokenVersion: 0,
          status:       'active',
          mergedInto:   null,
          createdBy:    opts?.createdBy || 'system:provision',
          createdAt:    now,
        },
        $set:      { updatedAt: now },
        $addToSet: { sourceUserIds: { $each: allUserIds } },
      },
      { upsert: true, new: true }
    ).lean();

    await Users.updateMany({ id: { $in: allUserIds } }, { $set: { identityId: identity.id } });
    return identity;
  }

  // Unvouched collision — never auto-merge. Flag for human review; every
  // account involved keeps authenticating via users.password exactly as
  // today, permanently, until resolved via a future extended Link Identity
  // flow. users.identityId is deliberately left unset.
  const collisionKey = `${orgId}::${email}`;
  const collision = await Identities.findOneAndUpdate(
    { collisionKey },
    {
      $setOnInsert: {
        id:            `idt_${uuidv4()}`,
        orgId,
        email:         null,
        collisionKey,
        passwordHash:  null,
        mfaEnabled:    false,
        tokenVersion:  0,
        status:        'collision_pending',
        mergedInto:    null,
        createdBy:     opts?.createdBy || 'system:provision',
        createdAt:     now,
      },
      $set:      { updatedAt: now },
      $addToSet: { sourceUserIds: userId },
    },
    { upsert: true, new: true }
  ).lean();

  return collision;
}

async function provisionIdentities() {
  try {
    const Schools     = _model('schools');
    const Orgs        = _model('organizations');
    const Users       = _model('users');
    const Identities  = _model('identities');
    const Memberships = _model('memberships');

    // Re-scans collision_pending/unset users on every boot by design — each
    // pass is idempotent and cheap at shadow-phase scale, and this is how a
    // collision self-heals once a human resolves it (no separate "retry"
    // mechanism needed).
    const cursor = Users.find({
      email: { $exists: true, $type: 'string' },
      identityId: { $exists: false },
    }).lean().cursor();

    let count = 0;
    for await (const user of cursor) {
      const identity = await provisionIdentityForUser(user, { Schools, Orgs, Users, Identities, Memberships });
      if (identity) count++;
    }

    if (count > 0) {
      console.log(`[Migration] identities: processed ${count} user(s) (includes any newly collision-flagged)`);
    }
    return { provisioned: count };
  } catch (err) {
    // Non-fatal — next startup retries. Provisioning must never block boot.
    console.error('[Migration] provisionIdentities failed:', err.message);
    return { provisioned: 0, error: err.message };
  }
}

module.exports = { provisionIdentities, provisionIdentityForUser };
