/* ============================================================
   Msingi — records saved before a class had streams (v5.282.1)

   Marks and registers carry the stream the student had when they were
   saved. Saved before the class had a stream (or before the student was
   put in one), they carry none, and a filter by stream missed them: the
   Markbook and register looked empty to the stream's teacher, inviting
   the same work to be typed again over what was already saved.

   Called right AFTER ScopeEngine.applyToFilter. Where that left a stream
   condition, it also matches records with NO stream, of the students now
   in that stream, in that stream's own class. It never matches a record
   stamped with another stream, never another class's records, and adds
   nothing for a caller with no stream condition.
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');

const NONE = { $in: [null, ''] };   // null also matches a missing field

async function includeUnstamped(req, filter) {
  const wanted = filter.streamId;
  const explicit = typeof wanted === 'string' ? [wanted] : (Array.isArray(wanted?.$in) ? wanted.$in : null);
  // applyToFilter's shape when no class was asked for: own classes OR own streams.
  const ownStreams = (req.scope?.streamIds ?? []);
  const orShape = !explicit && Array.isArray(filter.$or) && ownStreams.length
    && filter.$or.some(c => c?.streamId?.$in === ownStreams || c?.streamId?.$in?.join?.() === ownStreams.join());
  if (!explicit && !orShape) return filter;

  const ids = (explicit || ownStreams).filter(x => typeof x === 'string' && x && x !== '__no_match__');
  if (!ids.length) return filter;

  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);
  const oids = ids.filter(x => /^[a-f0-9]{24}$/i.test(x));
  const [streams, students] = await Promise.all([
    tenantModel('streams', ctx).find({ schoolId, $or: [{ id: { $in: ids } }, ...(oids.length ? [{ _id: { $in: oids } }] : [])] }).select('id classId').lean(),
    tenantModel('students', ctx).find({ schoolId, streamId: { $in: ids } }).select('id streamId').lean(),
  ]);
  if (!students.length) return filter;

  // Per stream: its own students, in its own class.
  const clauses = [];
  for (const s of streams) {
    const forms = [s.id, s._id && String(s._id)].filter(Boolean);
    const mine = students.filter(p => forms.includes(String(p.streamId))).map(p => p.id || String(p._id));
    if (mine.length && s.classId) clauses.push({ streamId: NONE, classId: s.classId, studentId: { $in: mine } });
  }
  if (!clauses.length) return filter;

  if (explicit) {
    delete filter.streamId;
    filter.$and = [...(filter.$and || []), { $or: [{ streamId: { $in: ids } }, ...clauses] }];
  } else {
    filter.$or = [...filter.$or, ...clauses];
  }
  return filter;
}

module.exports = { includeUnstamped };
