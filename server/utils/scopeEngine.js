/**
 * scopeEngine.js — Data Access Scope helpers for route handlers
 *
 * After scopeMiddleware runs, every handler can call:
 *
 *   ScopeEngine.applyToFilter(req, 'students', filter)
 *
 * to enforce data scope without duplicating logic across routes.
 *
 * The filter is mutated in place and also returned for chaining.
 */
'use strict';

/* ── Module → MongoDB field mapping ────────────────────────── */
// Maps each module to the field used to restrict records and which scope
// array to source the allowed IDs from.
const MODULE_SCOPE = {
  students:        { field: 'classId',   source: 'classIds'   },
  classes:         { field: 'id',        source: 'classIds'   },
  'class-subjects':{ field: 'classId',   source: 'classIds'   },
  attendance:      { field: 'classId',   source: 'classIds'   },
  grades:          { field: 'classId',   source: 'classIds'   },
  assessment:      { field: 'classId',   source: 'classIds'   },
  report_cards:    { field: 'classId',   source: 'classIds'   },
  growth_profile:  { field: 'classId',   source: 'classIds'   },
  growth_records:  { field: 'classId',   source: 'classIds'   },
  lessons:         { field: 'classId',   source: 'classIds'   },
  exams:           { field: 'subjectId', source: 'subjectIds' },
  timetable:       { field: 'teacherId', source: 'userId'     },
};

/**
 * Enforce the current user's data scope on a MongoDB filter object.
 *
 * Mutates `filter` in place. Returns `filter` for chaining.
 *
 * Behaviour:
 * - No scope (school-level role)  → filter unchanged
 * - Module in unrestrictedModules → filter unchanged
 * - Assigned IDs = 0 (no assignments) → sets an impossible filter so the
 *   result is always empty. The frontend should check `meta.noAssignments`.
 * - Filter already has the scope field set to a string (caller passed ?classId=x):
 *     → validates that the requested ID is within scope; replaces with __no_match__
 *       if it is not. This prevents scope escalation via query params.
 * - Filter does not have the scope field:
 *     → adds { field: { $in: allowedIds } }
 *
 * @param {import('express').Request} req
 * @param {string} module   — key from MODULE_SCOPE above
 * @param {object} filter   — the MongoDB filter being built
 * @returns {object}        — the same filter object, mutated
 */
function applyToFilter(req, module, filter) {
  const scope = req.scope;
  if (!scope) return filter;                                   // school-level: unrestricted
  if (scope.unrestrictedModules?.includes(module)) return filter; // module exempt

  const mapping = MODULE_SCOPE[module];
  if (!mapping) return filter;                                 // unknown module: no filter

  const { field, source } = mapping;

  // timetable: scope by the teacher's own userId, not a list of IDs
  if (source === 'userId') {
    filter[field] = scope.userId;
    return filter;
  }

  const allowed = scope[source] ?? [];

  if (allowed.length === 0) {
    // Strict deny: teacher has no assignments → guaranteed empty result set
    filter[field] = { $in: [] };
    return filter;
  }

  const existing = filter[field];

  if (existing === undefined) {
    // No caller-provided filter on this field: apply full scope
    filter[field] = { $in: allowed };

  } else if (typeof existing === 'string') {
    // Caller requested a specific ID (e.g. ?classId=cls_4a)
    // Validate it is within scope; deny silently if not
    filter[field] = allowed.includes(existing) ? existing : '__no_match__';

  } else if (existing?.$in) {
    // Caller already restricted to a list: intersect with scope
    const intersection = existing.$in.filter(id => allowed.includes(id));
    filter[field] = { $in: intersection };
  }
  // Any other shape (e.g. { $ne: ... }) is left unchanged — caller's intent

  return filter;
}

/**
 * Returns true if the user has an 'assigned' or 'section' scope with zero
 * classIds. Route handlers can use this to return a structured "no assignments"
 * response instead of a silent empty array.
 *
 * @param {import('express').Request} req
 * @param {string} module
 */
function hasNoAssignments(req, module) {
  const scope = req.scope;
  if (!scope) return false;
  if (scope.unrestrictedModules?.includes(module)) return false;
  const mapping = MODULE_SCOPE[module];
  if (!mapping || mapping.source === 'userId') return false;
  const allowed = scope[mapping.source] ?? [];
  return (scope.level === 'assigned' || scope.level === 'section') && allowed.length === 0;
}

/**
 * Returns true if this user's scope places no restrictions on the module.
 * Shorthand for "is this user a school-level or exempt role for this module?".
 *
 * @param {import('express').Request} req
 * @param {string} module
 */
function isUnrestricted(req, module) {
  if (!req.scope) return true;
  return req.scope.unrestrictedModules?.includes(module) ?? false;
}

/**
 * Straight allow/deny check for a single classId — the write-route
 * counterpart to applyToFilter's read-side filtering. Extracted once
 * attendance.js and grades.js needed the identical check lessons.js's
 * /coverage route already had inline on their write routes (POST/PUT/
 * DELETE previously ran scopeMiddleware nowhere — scope was only ever
 * enforced on the GET list, so a caller who could pick any class from an
 * unrelated, unscoped dropdown could write to a class outside their own
 * assigned scope regardless of what the list endpoint would have shown
 * them).
 *
 * Deliberately does NOT reuse applyToFilter's mutate-an-object trick the
 * original inline version did: applyToFilter's `allowed.length === 0`
 * branch (a scoped user with literally zero assigned classIds) returns
 * early with `filter[field] = { $in: [] }` — an object, not the string
 * '__no_match__' — before ever reaching the string-comparison branch that
 * check relies on. A zero-assignment user is the clearest possible
 * out-of-scope case, and that early-return meant the old pattern silently
 * ALLOWED them through instead of denying (caught by direct unit tests on
 * this function — see scope-engine.test.js — before it shipped anywhere).
 * This reimplements the check independently against `req.scope` so both
 * "zero assignments" and "assigned to different classes" deny correctly.
 *
 * `classId` may legitimately be absent (e.g. grades.js's GradeSchema makes
 * it optional) — with nothing to check, this allows by default rather than
 * denying a request that was never scoped by class in the first place.
 *
 * @param {import('express').Request} req
 * @param {string} module
 * @param {string} [classId]
 * @returns {boolean} true if this classId is within scope (or there's
 *   nothing to check, or the module is unrestricted for this user)
 */
function isClassInScope(req, module, classId) {
  if (!classId) return true;
  const scope = req.scope;
  if (!scope) return true; // school-level: unrestricted
  if (scope.unrestrictedModules?.includes(module)) return true;

  const mapping = MODULE_SCOPE[module];
  if (!mapping || mapping.source === 'userId') return true; // not class-scoped

  const allowed = scope[mapping.source] ?? [];
  return allowed.includes(classId);
}

module.exports = { applyToFilter, hasNoAssignments, isUnrestricted, isClassInScope };
