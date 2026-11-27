/* ============================================================
   Marks must belong to a student of the mark's class (v5.291.0)
   Used by routes/assessment.js POST /marks and /marks/bulk.
   ============================================================ */
'use strict';

const mongoose = require('mongoose');
const { tenantModel } = require('./tenant-model');

/* A mark must belong to a real student of this school who is, or was, in the
   mark's class (v5.291.0). Before this, POST /marks and /marks/bulk saved a mark
   for any studentId string, for any class, as long as the class/subject checks
   passed, so a typo or a stale id created a mark for nobody or for a pupil of
   another class. Accepted when the student exists here and either:
     - is in that class now (student.classId, matched by the class's id or _id), or
     - has a student_class_history row for it (an earlier year), or
     - already has a mark in that class (a correction after a move with no history).
   Status is not checked, so a withdrawn student's marks can still be corrected.
   Returns [{ studentId, classId, problem: 'not_found' | 'other_class' }]. */
async function studentClassProblems(ctx, schoolId, pairs) {
  const isOid = v => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
  const oids = vs => vs.filter(isOid).map(v => new mongoose.Types.ObjectId(v));
  const uniq = arr => [...new Set(arr.filter(Boolean).map(String))];
  const studentIds = uniq(pairs.map(p => p.studentId));
  const classIds = uniq(pairs.map(p => p.classId));

  const [students, classes] = await Promise.all([
    tenantModel('students', ctx).find({ schoolId, $or: [{ id: { $in: studentIds } }, ...(oids(studentIds).length ? [{ _id: { $in: oids(studentIds) } }] : [])] }).select('id classId').lean(),
    tenantModel('classes', ctx).find({ schoolId, $or: [{ id: { $in: classIds } }, ...(oids(classIds).length ? [{ _id: { $in: oids(classIds) } }] : [])] }).select('id').lean(),
  ]);
  const studentOf = new Map();
  for (const s of students) { if (s.id) studentOf.set(String(s.id), s); if (s._id) studentOf.set(String(s._id), s); }
  const formsOf = new Map(classIds.map(c => [c, new Set([c])]));
  for (const c of classes) {
    const forms = uniq([c.id, c._id && String(c._id)]);
    for (const f of forms) if (formsOf.has(f)) forms.forEach(x => formsOf.get(f).add(x));
  }

  const problems = [];
  const pending = [];
  for (const p of pairs) {
    const s = studentOf.get(String(p.studentId));
    if (!s) { problems.push({ studentId: p.studentId, classId: p.classId, problem: 'not_found' }); continue; }
    if (s.classId && formsOf.get(String(p.classId))?.has(String(s.classId))) continue;
    pending.push(p);
  }
  if (!pending.length) return problems;

  const pIds = uniq(pending.map(p => p.studentId));
  const pForms = uniq(pending.flatMap(p => [...(formsOf.get(String(p.classId)) || [p.classId])]));
  const [hist, prior] = await Promise.all([
    tenantModel('student_class_history', ctx).find({ schoolId, studentId: { $in: pIds }, classId: { $in: pForms } }).select('studentId classId').lean(),
    tenantModel('assessment_marks', ctx).find({ schoolId, studentId: { $in: pIds }, classId: { $in: pForms } }).select('studentId classId').limit(5000).lean(),
  ]);
  const known = new Set([...hist, ...prior].map(r => `${r.studentId}|${r.classId}`));
  for (const p of pending) {
    const forms = [...(formsOf.get(String(p.classId)) || [p.classId])];
    if (!forms.some(f => known.has(`${p.studentId}|${f}`))) problems.push({ studentId: p.studentId, classId: p.classId, problem: 'other_class' });
  }
  return problems;
}

module.exports = { studentClassProblems };
