/* ============================================================
   Msingi — Organization Provisioning  (Phase A · C1/C2)

   Every School must belong to exactly one Organization
   (ARCHITECTURE_CONSTITUTION §3; PLATFORM_ARCHITECTURE_EVOLUTION §5/§14).
   This backfills a 1:1 Organization for every existing School that does
   not yet have one, and sets `school.organizationId`.

   DESIGN NOTES (deliberate, see docs/governance/):
   • The link is a single authoritative FK on the SCHOOL
     (`school.organizationId`). There is intentionally NO `schools[]`
     array on the Organization — that would be a second, drift-prone
     source of truth for the same fact (Operating Model Principle 6:
     one authoritative source per datum).
   • Organizations are platform/org-level documents — they carry no
     `schoolId` (Engineering Standards §2.1 platform-level exception,
     same as `schools` and `release_certificates`).

   SAFETY:
   • Purely additive — a new `organizations` collection nothing reads
     yet, and a new nullable `organizationId` field on schools. No
     existing behavior changes; nothing user-visible.
   • Reversible — drop the collection and unset the field.
   • Interruption-safe — the Organization is created via an upsert keyed
     on `provisionedFromSchoolId`, so a crash between "org created" and
     "FK set" cannot create a duplicate org on the next run.
   • Idempotent — only processes schools whose `organizationId` is
     missing or null; a fully-provisioned platform is a no-op.
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { _model } = require('./model');

async function provisionOrganizations() {
  try {
    const Schools = _model('schools');
    const Orgs    = _model('organizations');

    const cursor = Schools.find({
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    }).lean().cursor();

    let count = 0;
    for await (const school of cursor) {
      // Stable external id when present; fall back to the Mongo _id string.
      const schoolId = school.id || (school._id && school._id.toString());
      if (!schoolId) continue;   // malformed doc — skip, never crash the run

      const now = new Date().toISOString();

      // Get-or-create the 1:1 Organization for this School, deterministically
      // keyed on provenance so re-runs (or crash recovery) never duplicate it.
      const org = await Orgs.findOneAndUpdate(
        { provisionedFromSchoolId: schoolId },
        {
          $setOnInsert: {
            id:                      `org_${uuidv4()}`,
            name:                    school.name || school.shortName || 'Organization',
            slug:                    school.slug || null,
            status:                  'active',
            multiSchoolEnabled:      false,   // opt-in later (Constitution §10 Stage 3)
            provisionedFromSchoolId: schoolId,
            createdBy:               'system:provision',
            createdAt:               now,
          },
          $set: { updatedAt: now },
        },
        { upsert: true, new: true }
      ).lean();

      // Set the authoritative FK on the school. Filter by _id (always
      // present on the cursor doc) to sidestep the custom-id vs _id
      // ambiguity entirely.
      await Schools.updateOne(
        { _id: school._id },
        { $set: { organizationId: org.id } }
      );
      count++;
    }

    if (count > 0) {
      console.log(`[Migration] organizations: provisioned ${count} school(s) with a 1:1 organization`);
    }
    return { provisioned: count };
  } catch (err) {
    // Non-fatal — next startup retries. Provisioning must never block boot.
    console.error('[Migration] provisionOrganizations failed:', err.message);
    return { provisioned: 0, error: err.message };
  }
}

module.exports = { provisionOrganizations };
