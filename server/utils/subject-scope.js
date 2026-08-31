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

/* A teaching_assignments row with no streamId is a whole-class grant and
   covers every stream of that class; one WITH a streamId only covers that
   exact stream (a compulsory subject in a class that has streams — see
   teaching-assignments.js, e.g. 7i's Maths teacher isn't 7ii's). Matches
   either shape so a whole-class grant still passes when the caller doesn't
   know or pass a streamId (existing callers, unaffected). */
function _streamOr(streamId) {
  const or = [{ streamId: null }, { streamId: { $exists: false } }];
  if (streamId) or.push({ streamId });
  return or;
}

/**
 * Single {classId, subjectId[, streamId]} check for one write. Returns true
 * when the write may proceed — enforcement is off for this school, the
 * caller is a management-tier role, or a matching teaching_assignments
 * record exists (a whole-class grant, or one scoped to this exact stream).
 *
 * `streamId` is optional and backward compatible: omitting it (as every
 * pre-Milestone-2 caller does) only ever matches whole-class assignments,
 * same as before — it never widens what an existing caller could already do.
 */
async function canWriteSubject(req, classId, subjectId, streamId) {
  if (_isManagement(req)) return true;
  if (!(await isSubjectAssignmentEnforced(req))) return true;

  const { schoolId, userId } = req.jwtUser;
  const doc = await tenantModel('teaching_assignments', tenantContext(req))
    .findOne({ schoolId, teacherId: userId, classId, subjectId, $or: _streamOr(streamId) }).select('id').lean();
  return !!doc;
}

/**
 * Bulk variant — checks every distinct {classId, subjectId[, streamId]}
 * triple in one query instead of one round-trip per mark. Returns the
 * subset of `pairs` the caller is NOT permitted to write (empty when
 * enforcement is off, the caller is management-tier, or every pair is
 * assigned to them). Each pair's `streamId` is optional, same backward-
 * compatibility contract as canWriteSubject above.
 */
async function unassignedPairs(req, pairs) {
  if (pairs.length === 0) return [];
  if (_isManagement(req)) return [];
  if (!(await isSubjectAssignmentEnforced(req))) return [];

  const { schoolId, userId } = req.jwtUser;
  const assigned = await tenantModel('teaching_assignments', tenantContext(req))
    .find({
      schoolId, teacherId: userId,
      $or: pairs.map(({ classId, subjectId, streamId }) => ({
        classId, subjectId, $or: _streamOr(streamId),
      })),
    })
    .select('classId subjectId streamId').lean();

  // A pair with a streamId is satisfied by either a whole-class assignment
  // row (streamId null/absent) or one matching that exact stream; a pair
  // with no streamId (unknown / not resolved) only matches a whole-class row.
  function isAssigned({ classId, subjectId, streamId }) {
    return assigned.some(a =>
      a.classId === classId && a.subjectId === subjectId &&
      (!a.streamId || (streamId && a.streamId === streamId))
    );
  }
  return pairs.filter(p => !isAssigned(p));
}

module.exports = { isSubjectAssignmentEnforced, canWriteSubject, unassignedPairs };
