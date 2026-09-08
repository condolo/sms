/* ============================================================
   Msingi — Guardian linking at enrollment (2026-09)

   Fixes the billing-sequencing gap the self-audit found in
   v5.65.0's CHANGELOG entry: sibling discount eligibility depends on
   a guardian's `studentIds` array already listing the new student, but
   nothing ever added it there before the admission invoice was
   generated in the same request — a genuine second child was always
   billed at 0% discount on the initial invoice.

   This does ONE narrow thing: link a newly-enrolled student onto any
   guardian ACCOUNT that already exists, so discount-resolution.js's
   family grouping sees the family correctly. It deliberately does NOT
   create a new parent portal account — that's students.js's
   POST /:id/parent-account, a bigger, explicit, credential-issuing
   action (temp password, portal-tier plan gate, admin-only) that
   should stay a deliberate staff action, not a side effect of billing
   sequencing. A family with no existing guardian account yet has no
   sibling to discount anyway — nothing is lost by leaving account
   creation as its own step.

   Two ways an existing guardian is found, tried together:
     1. `siblingStudentId` — if staff recorded which sibling this is
        (the application's existing, previously-unused `sibling`/
        `siblingStudentId` fields), link every guardian of THAT
        student directly. The strongest signal when it's given.
     2. Email match — motherEmail/fatherEmail/parentEmail against an
        existing `users` doc with role 'parent'. The automatic path
        that needs no staff action at all.
   Both may find the same guardian; results are deduped by user id.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

function _emails(student) {
  const raw = [student.motherEmail, student.fatherEmail, student.parentEmail];
  return [...new Set(raw.filter(Boolean).map(e => e.toLowerCase().trim()))];
}

/* Links `student` onto every existing guardian account it can find via
   siblingStudentId and/or email match. Never creates a new guardian
   account. Returns the list of guardian user ids linked (for logging/
   tests) — empty when no existing guardian account matched anything,
   which is the ordinary case for a family's first child. */
async function linkExistingGuardians(schoolId, ctx, student) {
  const Users = tenantModel('users', ctx);
  const studentId = student.id ?? student._id?.toString();
  if (!studentId) return [];

  const candidateIds = new Set();

  if (student.siblingStudentId) {
    const siblingGuardians = await Users.find({
      schoolId, role: 'parent', studentIds: student.siblingStudentId, isActive: { $ne: false },
    }).select('id').lean();
    for (const g of siblingGuardians) candidateIds.add(g.id ?? String(g._id));
  }

  const emails = _emails(student);
  if (emails.length) {
    const emailGuardians = await Users.find({
      schoolId, role: 'parent', email: { $in: emails }, isActive: { $ne: false },
    }).select('id').lean();
    for (const g of emailGuardians) candidateIds.add(g.id ?? String(g._id));
  }

  if (candidateIds.size === 0) return [];

  const now = new Date().toISOString();
  const linked = [];
  for (const guardianId of candidateIds) {
    await Users.findOneAndUpdate(
      { id: guardianId, schoolId },
      { $addToSet: { studentIds: studentId, guardianOf: studentId }, $set: { updatedAt: now } },
    );
    linked.push(guardianId);
  }
  return linked;
}

module.exports = { linkExistingGuardians };
