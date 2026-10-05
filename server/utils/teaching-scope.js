/* ============================================================
   Msingi — What a teacher may read: the subjects they teach.

   Class and stream scope (scopeEngine.js) narrows reads to a class or
   stream, but not to a subject. A Maths teacher with a whole-class grant
   would otherwise read every subject's marks for that class, and a stream
   teacher every subject's marks for that stream. This narrows marks,
   submissions and report data to the {class, subject[, stream]} pairs the
   caller teaches.

   Management roles are not narrowed (subject-scope.js's MANAGEMENT_ROLES).
   Electives are one group across streams, so an elective assignment counts
   for every stream of the class (elective-scope.js).
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');
const { isManagement } = require('./subject-scope');

/**
 * The caller's taught pairs, or null when the caller is management and sees
 * everything. Each pair is { classId, subjectId, streamId } — streamId is null
 * for a whole-class grant or an elective.
 */
async function taughtPairs(req) {
  if (isManagement(req)) return null;
  const { schoolId, userId } = req.jwtUser;
  const rows = await tenantModel('teaching_assignments', tenantContext(req))
    .find({ schoolId, teacherId: userId }).select('classId subjectId streamId').lean();
  if (rows.length === 0) return [];

  const classIds = [...new Set(rows.map(r => r.classId))];
  const electives = await tenantModel('class_subjects', tenantContext(req))
    .find({ schoolId, classId: { $in: classIds }, isCompulsoryForClass: false })
    .select('classId subjectId').lean();
  const electiveKeys = new Set(electives.map(e => `${e.classId}::${e.subjectId}`));

  return rows.map(r => ({
    classId:   r.classId,
    subjectId: r.subjectId,
    streamId:  electiveKeys.has(`${r.classId}::${r.subjectId}`) ? null : (r.streamId ?? null),
  }));
}

/**
 * A Mongo condition matching only the taught pairs. Use it with $and so it
 * combines with the class/stream scope already on the filter. A null result
 * (management) means no condition is needed.
 *
 * `streamField` names the stream field on the collection being queried. For
 * a stream pair the match is that stream, or a legacy row with no stream.
 */
function taughtCondition(pairs, { streamField = 'streamId' } = {}) {
  if (pairs === null) return null;
  if (pairs.length === 0) return { _id: { $in: [] } };
  return {
    $or: pairs.map(p => {
      const c = { classId: p.classId, subjectId: p.subjectId };
      if (p.streamId) c[streamField] = { $in: [p.streamId, null] };
      return c;
    }),
  };
}

/** Adds the taught-pairs condition to a filter, in place. No-op for management. */
async function restrictToTaught(req, filter, opts) {
  const pairs = await taughtPairs(req);
  const cond = taughtCondition(pairs, opts);
  if (cond) filter.$and = [...(filter.$and || []), cond];
  return filter;
}

/** The set of subject ids the caller teaches in a class, or null for management. */
async function taughtSubjectIds(req, classId) {
  const pairs = await taughtPairs(req);
  if (pairs === null) return null;
  return new Set(pairs.filter(p => p.classId === classId).map(p => p.subjectId));
}

module.exports = { taughtPairs, taughtCondition, restrictToTaught, taughtSubjectIds };
