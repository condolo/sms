/* ============================================================
   Msingi — Auto-discount resolution (sibling / director / referral)

   Extracted from finance.js (2026-09) so server/utils/admission-billing.js
   can apply the exact same "only one discount, highest wins" logic to an
   enrollment-triggered invoice that POST /fee-structures/:id/generate
   already applies to bulk-generated ones — one implementation, not two.

   Early Payment is deliberately NOT here — it depends on when a family
   actually pays, unknowable at invoice-creation time. See finance.js's
   own comment above DiscountPolicySchema and its POST /payments handler.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

/* Resolves per-student sibling-discount percentages for a batch of
   target students, keyed by studentId — called once per run (never
   per-student: ranking a family's children requires each guardian's
   FULL child list, not just whichever of their kids are in this batch).

   Family grouping: `users` docs with role 'parent' carry a
   `studentIds` array (the reverse of the Link Parent relationship —
   see notify-students.js). A student can have >1 guardian, and two
   guardians of the same family may not list identical studentIds
   (e.g. one parent linked before a younger sibling enrolled), so
   families are merged via union-find over shared studentIds rather
   than assumed to match one guardian's list exactly.

   Ranking: within a merged family, children are ordered by
   enrollmentDate (earliest = 1st child, pays full price); a tier's
   discount applies from the matching nthChild onward using the
   highest tier for any child beyond the last defined tier. */
async function resolveSiblingDiscounts(schoolId, ctx, studentIds) {
  const result = new Map();
  if (!studentIds?.length) return result;

  const DiscountPolicies = tenantModel('discount_policies', ctx);
  const policy = await DiscountPolicies.findOne({ schoolId, type: 'sibling', active: true }).lean();
  if (!policy?.tiers?.length) return result;

  const Users = tenantModel('users', ctx);
  const guardians = await Users.find({ schoolId, role: 'parent', studentIds: { $in: studentIds }, isActive: { $ne: false } })
    .select('studentIds').lean();
  if (!guardians.length) return result;

  // Union-find: merge every guardian's children into one family group.
  const parentOf = new Map();
  function find(x) { while (parentOf.get(x) !== x) x = parentOf.get(x); return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parentOf.set(ra, rb); }
  for (const g of guardians) {
    const kids = (g.studentIds || []).filter(Boolean);
    for (const k of kids) if (!parentOf.has(k)) parentOf.set(k, k);
    for (let i = 1; i < kids.length; i++) union(kids[0], kids[i]);
  }
  if (parentOf.size === 0) return result;

  const families = new Map(); // root id -> [studentId, ...]
  for (const sid of parentOf.keys()) {
    const root = find(sid);
    if (!families.has(root)) families.set(root, []);
    families.get(root).push(sid);
  }

  const tierByNth = new Map(policy.tiers.map(t => [t.nthChild, t.discountPct]));
  const maxTierNth = Math.max(...policy.tiers.map(t => t.nthChild));
  const maxTierPct = tierByNth.get(maxTierNth);

  const Students = tenantModel('students', ctx);
  for (const familyIds of families.values()) {
    if (familyIds.length < 2) continue; // only child — no sibling discount
    const siblings = await Students.find({ schoolId, id: { $in: familyIds } }).select('id enrollmentDate createdAt').lean();
    siblings.sort((a, b) => new Date(a.enrollmentDate || a.createdAt || 0) - new Date(b.enrollmentDate || b.createdAt || 0));
    siblings.forEach((s, idx) => {
      const nth = idx + 1;
      if (nth === 1 || !studentIds.includes(s.id)) return;
      const pct = tierByNth.get(nth) ?? (nth > maxTierNth ? maxTierPct : 0);
      if (pct > 0) result.set(s.id, pct);
    });
  }
  return result;
}

/* Resolves a flat-rate discount ('director' or 'referral') for a batch
   of target students, keyed by studentId. Unlike sibling discounts,
   eligibility here is a direct boolean flag on the student record
   (isDirectorFamily / isReferralFamily) — an administrative decision a
   school makes, not something derivable from enrollment data. */
async function resolveFlatDiscount(schoolId, ctx, studentIds, type, flagField) {
  const result = new Map();
  if (!studentIds?.length) return result;

  const DiscountPolicies = tenantModel('discount_policies', ctx);
  const policy = await DiscountPolicies.findOne({ schoolId, type, active: true }).lean();
  if (!policy?.flatPct) return result;

  const Students = tenantModel('students', ctx);
  const flagged = await Students.find({ schoolId, id: { $in: studentIds }, [flagField]: true }).select('id').lean();
  for (const s of flagged) result.set(s.id, policy.flatPct);
  return result;
}

/* Single entry point for every automatic discount: computes sibling,
   director, and referral eligibility for a batch of students and keeps
   only the HIGHEST per student — "only one discount applies per child"
   was an explicit requirement, not a simplification of convenience. */
async function resolveAutoDiscounts(schoolId, ctx, studentIds) {
  const [sibling, director, referral] = await Promise.all([
    resolveSiblingDiscounts(schoolId, ctx, studentIds),
    resolveFlatDiscount(schoolId, ctx, studentIds, 'director', 'isDirectorFamily'),
    resolveFlatDiscount(schoolId, ctx, studentIds, 'referral', 'isReferralFamily'),
  ]);
  const result = new Map();
  for (const sid of studentIds) {
    const best = Math.max(sibling.get(sid) ?? 0, director.get(sid) ?? 0, referral.get(sid) ?? 0);
    if (best > 0) result.set(sid, best);
  }
  return result;
}

module.exports = { resolveSiblingDiscounts, resolveFlatDiscount, resolveAutoDiscounts };
