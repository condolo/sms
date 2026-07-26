/* ============================================================
   Msingi — Subject-Teacher Scope Enforcement (RC6)

   academic_config.subjectAssignmentEnforced ("if true, only assigned
   teacher can enter marks") has existed since it was added to
   academic-config.js's schema — validated, persisted, returned by
   GET /api/academic-config — but never read anywhere else in the
   codebase. This closes that gap: when a school turns it on, a
   teacher may only write marks or the Subject Teacher Comment for a
   {classId, subjectId} pair they hold a teaching_assignments record
   for. Management-tier roles are never restricted by this rule — the
   same bypass set teaching-assignments.js's own canManage() uses for
   who may CREATE an assignment is reused here for who is EXEMPT from
   needing one.

   Deliberately does NOT reuse scopeMiddleware/scopeEngine.js: that
   system scopes by two independent flat lists (classIds, subjectIds)
   — a teacher assigned Math-in-4A and English-in-4B would pass a
   flat-list check for English-in-4A too, which is exactly the wrong
   pairing. This enforces the exact {classId, subjectId} tuple.
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');

/* Same bypass set as teaching-assignments.js's canManage() FULL_MANAGE,
   plus 'hod' — a HOD may only *create* assignments within their own
   department there, but is never restricted from entering marks/comments
   here (mirrors admin/principal/deputy — a management-tier role, not a
   subject teacher whose marks another department manages). */
const MANAGEMENT_ROLES = new Set(['admin', 'superadmin', 'deputy_principal', 'deputy', 'principal', 'hod']);

function _effectiveRoles(req) {
  const role  = req.jwtUser?.role  ?? '';
  const roles = req.jwtUser?.roles ?? [];
  return new Set([role, ...roles]);
}

function _isManagement(req) {
  const eff = _effectiveRoles(req);
  return [...MANAGEMENT_ROLES].some(r => eff.has(r));
}

/** Whether this school has opted into subject-teacher scoping. */
async function isSubjectAssignmentEnforced(req) {
  const { schoolId } = req.jwtUser;
  const cfg = await tenantModel('academic_config', tenantContext(req))
    .findOne({ schoolId }).select('subjectAssignmentEnforced').lean();
  return cfg?.subjectAssignmentEnforced === true;
}

/**
 * Single {classId, subjectId} check for one write. Returns true when the
 * write may proceed — enforcement is off for this school, the caller is a
 * management-tier role, or a matching teaching_assignments record exists.
 */
async function canWriteSubject(req, classId, subjectId) {
  if (_isManagement(req)) return true;
  if (!(await isSubjectAssignmentEnforced(req))) return true;

  const { schoolId, userId } = req.jwtUser;
  const doc = await tenantModel('teaching_assignments', tenantContext(req))
    .findOne({ schoolId, teacherId: userId, classId, subjectId }).select('id').lean();
  return !!doc;
}

/**
 * Bulk variant — checks every distinct {classId, subjectId} pair in one
 * query instead of one round-trip per mark. Returns the subset of `pairs`
 * the caller is NOT permitted to write (empty when enforcement is off, the
 * caller is management-tier, or every pair is assigned to them).
 */
async function unassignedPairs(req, pairs) {
  if (pairs.length === 0) return [];
  if (_isManagement(req)) return [];
  if (!(await isSubjectAssignmentEnforced(req))) return [];

  const { schoolId, userId } = req.jwtUser;
  const assigned = await tenantModel('teaching_assignments', tenantContext(req))
    .find({
      schoolId, teacherId: userId,
      $or: pairs.map(({ classId, subjectId }) => ({ classId, subjectId })),
    })
    .select('classId subjectId').lean();

  const assignedKeys = new Set(assigned.map(a => `${a.classId}::${a.subjectId}`));
  return pairs.filter(({ classId, subjectId }) => !assignedKeys.has(`${classId}::${subjectId}`));
}

module.exports = { isSubjectAssignmentEnforced, canWriteSubject, unassignedPairs };
