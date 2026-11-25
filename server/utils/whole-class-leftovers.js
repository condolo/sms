/* ============================================================
   Msingi — leftover whole-class assignments (v5.282.0)

   A subject that is compulsory for a class WITH streams needs one
   assignment per stream (the stream rule in teaching-assignments.js).
   A teacher assigned to the whole class BEFORE the class had a stream,
   or before the subject was made compulsory there, keeps the old row:
   a "leftover". It still gives access to every stream, and no teacher
   can be added to it.

   Nothing is ever moved automatically: which stream the teacher takes
   is the school's decision (Timetable → Subject allocation → Move to
   stream). This only lists them, so the screens that create leftovers
   can say so.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

const str = (v) => (v == null ? '' : String(v));

/**
 * @param {object} ctx       tenantContext(req)
 * @param {string} schoolId
 * @param {object} p
 * @param {string[]} p.classIds       classes to look in (any id form)
 * @param {string[]} [p.subjectIds]   only these subjects
 * @param {{classId, subjectId}[]} [p.assumeCompulsory]  class+subject about to become compulsory
 * @returns {Promise<{assignmentId, classId, subjectId, subjectName, teacherName}[]>}
 */
async function findLeftovers(ctx, schoolId, { classIds = [], subjectIds = null, assumeCompulsory = [] }) {
  const wanted = [...new Set(classIds.filter(Boolean).map(String))];
  if (!wanted.length) return [];
  const oids = wanted.filter(x => /^[a-f\d]{24}$/i.test(x));
  const classes = await tenantModel('classes', ctx)
    .find({ schoolId, $or: [{ id: { $in: wanted } }, ...(oids.length ? [{ _id: { $in: oids } }] : [])] }).select('id').lean();
  const key = new Map(wanted.map(w => [w, w]));
  for (const c of classes) {
    const k = c.id || str(c._id);
    for (const f of [c.id, str(c._id)].filter(Boolean)) key.set(String(f), k);
  }
  const ck = (id) => key.get(str(id)) || str(id);
  const forms = [...key.keys()];

  const [streams, links, rows] = await Promise.all([
    tenantModel('streams', ctx).find({ schoolId, classId: { $in: forms }, status: 'active' }).select('classId').lean(),
    tenantModel('class_subjects', ctx).find({ schoolId, classId: { $in: forms }, isActive: { $ne: false }, isCompulsoryForClass: true }).select('classId subjectId').lean(),
    tenantModel('teaching_assignments', ctx)
      .find({ schoolId, classId: { $in: forms }, $or: [{ streamId: null }, { streamId: '' }], ...(subjectIds ? { subjectId: { $in: subjectIds } } : {}) })
      .select('id classId subjectId subjectName teacherId teacherName streamId').lean(),
  ]);
  const streamed = new Set(streams.map(s => ck(s.classId)));
  const compulsory = new Set([...links, ...assumeCompulsory].map(l => `${ck(l.classId)}|${l.subjectId}`));
  const left = rows.filter(a => streamed.has(ck(a.classId)) && compulsory.has(`${ck(a.classId)}|${a.subjectId}`));

  // Imported and older rows have no stored names: take them from the staff and subject records.
  const noTeacher = [...new Set(left.filter(a => !a.teacherName && a.teacherId).map(a => a.teacherId))];
  const noSubject = [...new Set(left.filter(a => !a.subjectName).map(a => a.subjectId))];
  const [staff, subjects] = await Promise.all([
    noTeacher.length ? tenantModel('teachers', ctx).find({ schoolId, $or: [{ userId: { $in: noTeacher } }, { id: { $in: noTeacher } }] }).select('id userId title firstName lastName').lean() : [],
    noSubject.length ? tenantModel('subjects', ctx).find({ schoolId, id: { $in: noSubject } }).select('id name').lean() : [],
  ]);
  const teacherName = new Map();
  for (const t of staff) for (const f of [t.id, t.userId].filter(Boolean)) teacherName.set(f, [t.title, t.firstName, t.lastName].filter(Boolean).join(' '));
  const subjectName = new Map(subjects.map(x => [x.id, x.name]));
  return left.map(a => ({
    assignmentId: a.id, classId: ck(a.classId), subjectId: a.subjectId,
    subjectName: a.subjectName || subjectName.get(a.subjectId) || '', teacherName: a.teacherName || teacherName.get(a.teacherId) || '',
  }));
}

/* Same, but never fails the caller: the stream or curriculum change it is
   reporting on has already been made. */
async function leftoversOrNone(...args) {
  try { return await findLeftovers(...args); } catch (err) {
    console.error('[whole-class-leftovers] (ignored):', err.message);
    return [];
  }
}

module.exports = { findLeftovers, leftoversOrNone };
