/* ============================================================
   Student class history — which class (and stream) a student was in
   for each academic year.

   Why it exists (v5.278.0): a student's own record only holds TODAY's
   class. Promotion overwrites classId, so before this nothing said that
   a Grade 6 learner was in Grade 5 last year. Schools importing past
   years' results (e.g. Trinitas and Trinity, 2026-11) need that, and so
   does anything that looks back at a past year by class.

   One row per student per academic year:
     { id, schoolId, studentId, academicYearId, classId, className,
       streamId, streamName, source: 'promotion' | 'past_import',
       importBatchId?, createdBy, createdAt }

   Written by:
     - POST /api/students/promote: the class each student is LEAVING, for
       the year they spent in it (see yearForClass below);
     - the past-results import (routes/past-results.js).
   A row is never silently overwritten: the first record for a student
   and year stands, and a later, different class is reported back to the
   caller instead.
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { tenantModel } = require('./tenant-model');

const COLLECTION = 'student_class_history';

const yearIdOf = (y) => (y ? (y.id || (y._id != null ? String(y._id) : null)) : null);

/**
 * Upsert history rows without overwriting an existing one.
 * @param ctx      tenantContext(req)
 * @param entries  [{ studentId, academicYearId, classId, className, streamId, streamName }]
 * @returns { created, unchanged, differs: [{ studentId, academicYearId, existingClassId, existingClassName, classId }] }
 */
async function recordClassHistory(ctx, schoolId, entries, { source, importBatchId = null, userId = null, dryRun = false } = {}) {
  const out = { created: 0, unchanged: 0, differs: [] };
  const valid = (entries || []).filter(e => e && e.studentId && e.academicYearId && e.classId);
  if (!valid.length) return out;

  const History = tenantModel(COLLECTION, ctx);
  const existing = await History.find({
    schoolId,
    $or: valid.map(e => ({ studentId: e.studentId, academicYearId: e.academicYearId })),
  }).lean();
  const byKey = new Map(existing.map(r => [`${r.studentId}|${r.academicYearId}`, r]));

  const now = new Date().toISOString();
  const seen = new Set();
  const ops = [];
  for (const e of valid) {
    const key = `${e.studentId}|${e.academicYearId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = byKey.get(key);
    if (prev) {
      if (prev.classId === e.classId) out.unchanged++;
      else out.differs.push({ studentId: e.studentId, academicYearId: e.academicYearId, existingClassId: prev.classId, existingClassName: prev.className || '', classId: e.classId });
      continue;
    }
    out.created++;
    ops.push({
      updateOne: {
        filter: { schoolId, studentId: e.studentId, academicYearId: e.academicYearId },
        update: {
          $setOnInsert: {
            id: uuidv4(), schoolId,
            studentId: e.studentId, academicYearId: e.academicYearId,
            classId: e.classId, className: e.className || '',
            streamId: e.streamId || null, streamName: e.streamName || null,
            source, ...(importBatchId ? { importBatchId } : {}),
            createdBy: userId, createdAt: now,
          },
        },
        upsert: true,
      },
    });
  }
  if (!dryRun && ops.length) await History.bulkWrite(ops, { ordered: false });
  return out;
}

/**
 * The academic year the students being promoted spent in this class —
 * used when promoting, since by then the school may already have switched
 * to the new year. The latest year (by start date) in which THESE students
 * have marks in this class; failing that, the school's current year.
 * Only these students' marks count: a class's older years (imported past
 * results for earlier cohorts) must never decide this cohort's year.
 */
async function yearForClass(ctx, schoolId, classId, years, currentYearId, studentIds = []) {
  if (!studentIds.length) return currentYearId || null;
  const ids = await tenantModel('assessment_marks', ctx)
    .distinct('academicYearId', { schoolId, classId, studentId: { $in: studentIds }, academicYearId: { $nin: [null, ''] } })
    .catch(() => []);
  const known = (years || []).filter(y => ids.includes(yearIdOf(y)));
  if (known.length) {
    known.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    return yearIdOf(known[0]);
  }
  return currentYearId || null;
}

module.exports = { COLLECTION, recordClassHistory, yearForClass, yearIdOf };
