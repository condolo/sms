/* ============================================================
   Msingi — the subject teacher's name on a report card (v5.282.1)

   Report cards took the first teaching assignment found for a subject in
   the class and ignored the stream, so 7B's report could name 7A's
   teacher. One rule, used by every report card renderer:

     1. an assignment for the student's own stream;
     2. else a whole-class assignment;
     3. else, for an elective (one group across streams) any assignment;
     4. else, for a student with no stream (e.g. published before the class
        had streams), the class's only stream, or its only teacher;
     5. else no name. A blank is right where a guess could be wrong.

   Co-teachers: the report shows one name, the first entered.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

const nameOf = (t) => [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');

/** Pure: which assignment names the teacher of this subject for this student. */
function pickAssignment(rows, streamId, elective) {
  if (!rows?.length) return null;
  const sid = streamId ? String(streamId) : '';
  const own = sid && rows.find(a => String(a.streamId || '') === sid);
  if (own) return own;
  const whole = rows.find(a => !a.streamId);
  if (whole) return whole;
  if (elective) return rows[0];
  if (!sid) {
    if (new Set(rows.map(a => String(a.streamId))).size === 1) return rows[0];
    if (new Set(rows.map(a => String(a.teacherId))).size === 1) return rows[0];
  }
  return null;
}

/**
 * @returns {Promise<(streamId) => Object<subjectId, name>>}  never rejects:
 *   a failed lookup gives no names, as before, never a failed report card.
 */
async function subjectTeacherResolver(ctx, schoolId, classId, subjectIds = null) {
  if (!classId) return () => ({});
  try {
    const oid = /^[a-f0-9]{24}$/i.test(String(classId));
    let cls = null;
    try {
      cls = await tenantModel('classes', ctx)
        .findOne({ schoolId, $or: [{ id: classId }, ...(oid ? [{ _id: classId }] : [])] }).select('id').lean();
    } catch { /* the id as given still works */ }
    const forms = [...new Set([classId, cls?.id, cls?._id && String(cls._id)].filter(Boolean).map(String))];
    const classIn = forms.length > 1 ? { $in: forms } : forms[0];
    const rows = await tenantModel('teaching_assignments', ctx)
      .find({ schoolId, classId: classIn, ...(subjectIds ? { subjectId: { $in: subjectIds } } : {}) })
      .select('subjectId teacherId teacherName streamId createdAt').lean();

    let electives = new Set();
    try {
      const links = await tenantModel('class_subjects', ctx)
        .find({ schoolId, classId: classIn, isCompulsoryForClass: false }).select('subjectId').lean();
      electives = new Set(links.map(l => l.subjectId));
    } catch { /* treated as compulsory: a blank rather than another stream's teacher */ }

    // Imported rows carry no name: take it from the staff record.
    const missing = [...new Set(rows.filter(a => !a.teacherName && a.teacherId).map(a => a.teacherId))];
    const staff = new Map();
    if (missing.length) {
      try {
        const list = await tenantModel('teachers', ctx)
          .find({ schoolId, $or: [{ userId: { $in: missing } }, { id: { $in: missing } }] }).select('id userId title firstName lastName').lean();
        for (const t of list) for (const f of [t.id, t.userId].filter(Boolean)) staff.set(f, nameOf(t));
      } catch { /* left blank */ }
    }

    const bySubject = new Map();
    const order = (a) => { const n = a.createdAt ? new Date(a.createdAt).getTime() : 0; return Number.isNaN(n) ? 0 : n; };
    for (const a of [...rows].sort((x, y) => order(x) - order(y))) {   // stable: first entered first
      const name = a.teacherName || staff.get(a.teacherId) || '';
      if (!name) continue;
      if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, []);
      bySubject.get(a.subjectId).push({ ...a, name });
    }
    return (streamId) => {
      const out = {};
      for (const [subjectId, list] of bySubject) {
        const a = pickAssignment(list, streamId, electives.has(subjectId));
        if (a) out[subjectId] = a.name;
      }
      return out;
    };
  } catch (err) {
    console.error('[subject-teacher-names] (ignored):', err.message);
    return () => ({});
  }
}

/* ── Saved at publishing (v5.284.0) ──────────────────────────────
   A published report keeps the names it was published with: the comments
   are saved, so the name beside each must not change when the subject
   later gets another teacher. A subject with no name at publishing, and
   every report published before this, still follow the assignments. */

/** Names to save on a new snapshot. keep = the previous version's names, when the publisher chose to keep them. */
function namesToSave(subjectIds, names, keep = null) {
  const out = {};
  for (const id of subjectIds) {
    const name = keep?.[id] || names?.[id];
    if (name) out[id] = name;
  }
  return out;
}

/** Names to show on a snapshot: the saved ones, else today's. */
function namesToShow(snap, live) {
  const saved = Object.fromEntries(Object.entries(snap?.subjectTeacherNames || {}).filter(([, v]) => v));
  return { ...live, ...saved };
}

module.exports = { subjectTeacherResolver, pickAssignment, namesToSave, namesToShow };
