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
//
// `streamAware: true` marks a module whose underlying records carry a real
// `streamId` field that can be trusted for scope narrowing. A teacher's
// compulsory-subject teaching assignment is now stream-scoped whenever the
// class actually has streams (see teaching-assignments.js) — e.g. 7i's Maths
// teacher is a different person from 7ii's — so a plain classId grant is too
// broad for that assignment; streamMiddleware.js computes `scope.streamIds`
// alongside `scope.classIds` for exactly this. Only mark a module
// streamAware once its own write path actually stamps streamId onto every
// record (students already does, natively) — turning this on for a module
// whose records have no streamId yet doesn't leak anything (a stream-scoped
// teacher just sees nothing there until it's wired up), but it's cleaner to
// leave it off until that's true.
// Milestone 1: students + classes (students natively carry streamId).
// Milestone 2: attendance/grades/assessment/report_cards/growth_profile/
// growth_records now stamp streamId at write time too (resolved from the
// referenced student's own record — see each route's create/update path).
// `lessons` stays deferred — it's a class+subject coverage log, not a
// per-student record, so there's no student to resolve a streamId from;
// making it stream-aware would need its own schema field and its own
// write-time source, a different shape of change from the rest of this
// batch.
const MODULE_SCOPE = {
  students:        { field: 'classId',   source: 'classIds', streamAware: true },
  classes:         { field: 'id',        source: 'classIds', streamAware: true },
  'class-subjects':{ field: 'classId',   source: 'classIds'   },
  attendance:      { field: 'classId',   source: 'classIds', streamAware: true },
  grades:          { field: 'classId',   source: 'classIds', streamAware: true },
  assessment:      { field: 'classId',   source: 'classIds', streamAware: true },
  report_cards:    { field: 'classId',   source: 'classIds', streamAware: true },
  growth_profile:  { field: 'classId',   source: 'classIds', streamAware: true },
  growth_records:  { field: 'classId',   source: 'classIds', streamAware: true },
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
 * Stream narrowing (streamAware modules only): a teacher can hold a
 * whole-class grant (`scope.classIds`, e.g. an elective, or a compulsory
 * subject in a class with no streams) AND/OR a stream-scoped grant
 * (`scope.streamIds`, a compulsory subject in a specific stream). Whichever
 * of the two shapes below `filter[field]` already has, stream-scoped access
 * is folded in as an additional way to match — never as a way to see LESS
 * than a plain classId grant already would.
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

  const { field, source, streamAware } = mapping;

  // timetable: scope by the teacher's own userId, not a list of IDs
  if (source === 'userId') {
    filter[field] = scope.userId;
    return filter;
  }

  const allowed   = scope[source] ?? [];
  const streamIds = streamAware ? (scope.streamIds ?? []) : [];

  if (allowed.length === 0 && streamIds.length === 0) {
    // Strict deny: teacher has no assignments at all (whole-class or
    // stream-scoped) → guaranteed empty result set
    filter[field] = { $in: [] };
    return filter;
  }

  const existing = filter[field];

  if (existing === undefined) {
    // No caller-provided filter on this field: apply full scope
    if (streamIds.length) {
      filter.$or = [{ [field]: { $in: allowed } }, { streamId: { $in: streamIds } }];
    } else {
      filter[field] = { $in: allowed };
    }

  } else if (typeof existing === 'string') {
    // Caller requested a specific ID (e.g. ?classId=cls_4a)
    if (allowed.includes(existing)) {
      // Whole-class grant covers it — unchanged, full access to this class
    } else if (streamIds.length) {
      // No whole-class grant, but this user does have stream-level access
      // somewhere — keep the requested class filter AND further narrow to
      // the user's own streams. Resolves correctly to zero results if none
      // of their streams belong to this particular class, since streamIds
      // are globally unique per class (see streams.js) — no separate
      // class↔stream cross-check needed here.
      _narrowToOwnStreams(filter, streamIds);
    } else {
      filter[field] = '__no_match__';
    }

  } else if (existing?.$in) {
    // Caller already restricted to a list (e.g. multiple equivalent id-forms
    // for one class): a whole-class grant on ANY form covers the whole
    // class, since they all denote the same class.
    const wholeClassGrant = existing.$in.some(id => allowed.includes(id));
    if (wholeClassGrant) {
      // unchanged — full access
    } else if (streamIds.length) {
      _narrowToOwnStreams(filter, streamIds);
    } else {
      filter[field] = { $in: [] };
    }
  }
  // Any other shape (e.g. { $ne: ... }) is left unchanged — caller's intent

  return filter;
}

/* Narrow an already-classId-filtered query to the caller's own streams,
   intersecting with any streamId filter the caller already supplied rather
   than silently overwriting it. */
function _narrowToOwnStreams(filter, streamIds) {
  const existingStream = filter.streamId;
  if (existingStream === undefined) {
    filter.streamId = { $in: streamIds };
  } else if (typeof existingStream === 'string') {
    filter.streamId = streamIds.includes(existingStream) ? existingStream : '__no_match__';
  } else if (existingStream?.$in) {
    filter.streamId = { $in: existingStream.$in.filter(id => streamIds.includes(id)) };
  }
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
  // A stream-only assignment (compulsory subject, a specific stream) is a
  // real assignment even though it never contributes to `classIds` — a
  // teacher in that position has something to see, just narrower than a
  // whole class, so this must not report them as having no assignments.
  const streamCount = mapping.streamAware ? (scope.streamIds ?? []).length : 0;
  return (scope.level === 'assigned' || scope.level === 'section') && allowed.length === 0 && streamCount === 0;
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
 * `streamId` (optional, 4th param): for a streamAware module, a teacher with
 * ONLY a stream-scoped grant (a compulsory subject in one specific stream —
 * see teaching-assignments.js) never appears in `classIds` at all, so the
 * classId check alone would wrongly deny them writing to their own stream's
 * records. Existing call sites that don't pass this are completely
 * unaffected — the stream branch simply never triggers.
 *
 * @param {import('express').Request} req
 * @param {string} module
 * @param {string} [classId]
 * @param {string} [streamId]
 * @returns {boolean} true if this classId (or, for a streamAware module,
 *   this streamId) is within scope, or there's nothing to check, or the
 *   module is unrestricted for this user
 */
function isClassInScope(req, module, classId, streamId) {
  if (!classId) return true;
  const scope = req.scope;
  if (!scope) return true; // school-level: unrestricted
  if (scope.unrestrictedModules?.includes(module)) return true;

  const mapping = MODULE_SCOPE[module];
  if (!mapping || mapping.source === 'userId') return true; // not class-scoped

  const allowed = scope[mapping.source] ?? [];
  if (allowed.includes(classId)) return true;

  if (mapping.streamAware && streamId) {
    return (scope.streamIds ?? []).includes(streamId);
  }
  return false;
}

module.exports = { applyToFilter, hasNoAssignments, isUnrestricted, isClassInScope };
