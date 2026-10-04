#!/usr/bin/env node
/* ============================================================
   Msingi — exam_results -> assessment_marks migration
   Phase 4 of the Markbook consolidation (all mark entry lives in the
   Markbook; Exams schedules sittings only).

   Each exam_results row is a mark that was entered through the retired
   Exams -> Results screen. This script re-homes it into assessment_marks,
   the single source of truth report cards read from.

   Rules (see the approved architecture contract):
   - rawScore is a 0-100 percentage: score / exam.maxScore * 100.
     Verified against GridCell (min 0, max 100) in the Markbook.
   - termNumber is the 1-based index of exam.termId in its academic year's
     terms array (same convention academic-config.js and lessons.js use).
   - instance defaults to 1. If several exams share a class/subject/term/
     type, they are numbered 1..n by date so they cannot collide.
   - An existing assessment_marks row with a DIFFERENT value is never
     overwritten. It is reported as a conflict and the Markbook value wins.
   - Re-running is idempotent: a row already migrated (matched by
     migratedFromExamResultId) is skipped.
   - exam_results itself is never deleted. It becomes legacy/read-only.
   - Exams in moderated/approved/locked/published/archived are remapped to
     completed, the 4-state scheduling tracker Phase 6 keeps.

   Usage:
     node server/scripts/migrate-exam-results-to-markbook.js                    # dry run (default), writes nothing
     node server/scripts/migrate-exam-results-to-markbook.js --schoolId=sch_x   # dry run, one school
     node server/scripts/migrate-exam-results-to-markbook.js --apply            # perform the migration

   Output: JSON report to stdout, human summary to stderr.
   Exit code: 0 = clean, 1 = conflicts or unresolved rows need review, 2 = error.
   ============================================================ */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { _model } = require('../utils/model');

const LEGACY_EXAM_STATUSES = ['moderated', 'approved', 'locked', 'published', 'archived'];

/* ── Pure planning logic (exported for unit tests, no DB) ─────────── */

function toRawScore(score, maxScore) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (typeof maxScore !== 'number' || !(maxScore > 0)) return null;
  const pct = (score / maxScore) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
}

function resolveTermNumber(yearTerms, termId) {
  if (!termId || !Array.isArray(yearTerms)) return null;
  const idx = yearTerms.findIndex(t => t.id === termId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Number exams that share (classId, subjectId, termNumber, assessmentType)
 * 1..n by date so two sittings of the same type cannot collide on instance.
 * Returns Map<examId, instance>.
 */
function assignInstances(examsWithTerm) {
  const groups = new Map();
  for (const e of examsWithTerm) {
    const key = [e.classId, e.subjectId, e.termNumber, e.assessmentType].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = new Map();
  for (const members of groups.values()) {
    members.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.id).localeCompare(String(b.id)));
    members.forEach((e, i) => out.set(e.id, i + 1));
  }
  return out;
}

/**
 * Decide what to do with one exam_results row.
 *   action: 'migrate' | 'already_migrated' | 'conflict' | 'skip'
 */
function planResult({ result, exam, studentStreamId, termNumber, instance, existingMark, alreadyMigrated }) {
  if (alreadyMigrated) return { action: 'already_migrated' };
  if (!exam) return { action: 'skip', reason: 'orphan_exam' };
  if (!exam.assessmentType) return { action: 'skip', reason: 'exam_has_no_assessment_type' };
  if (termNumber == null) return { action: 'skip', reason: 'term_unresolved' };

  const markState = result.markState ?? (result.absent === true ? 'ABS' : 'present');
  let rawScore = null;
  if (markState === 'present') {
    rawScore = toRawScore(result.score, exam.maxScore);
    if (rawScore == null) return { action: 'skip', reason: 'invalid_score_or_max' };
  }

  const doc = {
    studentId:      result.studentId,
    subjectId:      exam.subjectId,
    classId:        exam.classId,
    streamId:       studentStreamId ?? null,
    termNumber,
    assessmentType: exam.assessmentType,
    instance,
    academicYearId: exam.academicYearId || null,
    markState,
    rawScore,
    label:          exam.assessmentLabel || exam.assessmentType,
    isPublished:    true,
  };

  if (existingMark) {
    const sameValue = existingMark.markState === doc.markState && (existingMark.rawScore ?? null) === doc.rawScore;
    if (sameValue) return { action: 'already_migrated', doc };
    return { action: 'conflict', reason: 'markbook_value_differs', existing: { markState: existingMark.markState, rawScore: existingMark.rawScore ?? null }, doc };
  }
  return { action: 'migrate', doc };
}

/* What the old exam status proves about approval. Only states that mean the
   exam was approved are carried forward as a mark_submissions record. completed,
   moderated, in_progress and scheduled prove nothing was approved, so the marks
   stay unapproved (provisional) rather than having a state invented for them. */
function legacyApprovalFor(examStatus) {
  if (examStatus === 'approved') return 'approved';
  if (examStatus === 'locked' || examStatus === 'published' || examStatus === 'archived') return 'locked';
  return null;
}

function planExamStatusRemap(exam) {
  if (LEGACY_EXAM_STATUSES.includes(exam.status)) return { action: 'remap', from: exam.status, to: 'completed' };
  return { action: 'none' };
}

/* ── DB driver (only when executed directly) ─────────────────────── */
if (require.main === module) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('[migrate-exam-results] MONGODB_URI not set. Exiting.');
    process.exit(2);
  }

  const args      = process.argv.slice(2);
  const apply     = args.includes('--apply');
  const schoolArg = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;

  async function migrateSchool(schoolId, { apply }) {
    const report = {
      schoolId, resultsTotal: 0, migrate: 0, alreadyMigrated: 0, conflicts: [], skipped: {},
      examStatusRemap: 0, applied: { inserted: 0, examStatusUpdated: 0 }, plannedDocs: [],
    };

    const [results, exams, students, years] = await Promise.all([
      _model('exam_results').find({ schoolId }).lean(),
      _model('exams').find({ schoolId }).lean(),
      _model('students').find({ schoolId }).select('id streamId').lean(),
      _model('academic_years').find({ schoolId }).select('id terms').lean(),
    ]);
    report.resultsTotal = results.length;

    // Term ids are unique UUIDs, so one termId -> termNumber map across all
    // years is unambiguous (and avoids a flat-array index mistake).
    const termNumberById = {};
    for (const y of years) {
      (y.terms || []).forEach((t, i) => { termNumberById[t.id] = i + 1; });
    }
    const studentStream = Object.fromEntries(students.map(s => [s.id, s.streamId ?? null]));
    const examById = Object.fromEntries(exams.map(e => [e.id, e]));

    const examsWithTerm = exams
      .filter(e => e.assessmentType && e.classId && e.subjectId)
      .map(e => ({ ...e, termNumber: e.termId ? (termNumberById[e.termId] ?? null) : null }))
      .filter(e => e.termNumber != null);
    const instanceByExam = assignInstances(examsWithTerm);

    const alreadyIds = new Set(
      (await _model('assessment_marks').find({ schoolId, migratedFromExamResultId: { $exists: true } })
        .select('migratedFromExamResultId').lean()).map(m => m.migratedFromExamResultId)
    );

    const planned = [];
    for (const result of results) {
      const exam = examById[result.examId];
      const termNumber = exam?.termId ? (termNumberById[exam.termId] ?? null) : null;
      const instance = exam ? (instanceByExam.get(exam.id) ?? 1) : 1;

      // Year-tolerant match, same as POST /marks' legacy adoption: a
      // null-year Markbook row for this key is the same mark, so it must
      // be seen as a conflict, not silently duplicated.
      let existingMark = null;
      if (exam && termNumber != null) {
        const yearOr = exam.academicYearId
          ? [{ academicYearId: exam.academicYearId }, { academicYearId: null }]
          : [{ academicYearId: null }];
        existingMark = await _model('assessment_marks').findOne({
          schoolId, studentId: result.studentId, subjectId: exam.subjectId,
          termNumber, assessmentType: exam.assessmentType, instance,
          $or: yearOr,
        }).sort({ academicYearId: -1 }).lean();
      }

      const plan = planResult({
        result, exam, studentStreamId: studentStream[result.studentId], termNumber, instance,
        existingMark, alreadyMigrated: alreadyIds.has(result.id),
      });

      if (plan.action === 'migrate') {
        report.migrate++;
        planned.push({ plan, resultId: result.id, examId: exam.id });
        report.plannedDocs.push({ resultId: result.id, examId: exam.id, examTitle: exam.title, ...plan.doc });
      }
      else if (plan.action === 'already_migrated') report.alreadyMigrated++;
      else if (plan.action === 'conflict') report.conflicts.push({ resultId: result.id, examId: exam?.id, studentId: result.studentId, ...plan.existing, proposed: { markState: plan.doc.markState, rawScore: plan.doc.rawScore } });
      else report.skipped[plan.reason] = (report.skipped[plan.reason] || 0) + 1;
    }

    for (const exam of exams) {
      if (planExamStatusRemap(exam).action === 'remap') report.examStatusRemap++;
    }

    // Approval state the old system actually recorded, carried into mark_submissions.
    const submissionKey = d => [d.classId, d.subjectId, d.termNumber, d.assessmentType, d.instance].join('|');
    const legacySubs = new Map();
    for (const { plan, examId } of planned) {
      const approval = legacyApprovalFor(examById[examId]?.status);
      if (!approval) continue;
      const k = submissionKey(plan.doc);
      if (!legacySubs.has(k)) legacySubs.set(k, { status: approval, examId, doc: plan.doc });
    }
    report.legacySubmissions = [...legacySubs.values()].map(v => ({ status: v.status, examId: v.examId, classId: v.doc.classId, subjectId: v.doc.subjectId, termNumber: v.doc.termNumber, assessmentType: v.doc.assessmentType, instance: v.doc.instance }));
    report.provisionalByLegacyStatus = planned.filter(({ examId }) => !legacyApprovalFor(examById[examId]?.status)).length;

    if (apply) {
      for (const v of legacySubs.values()) {
        const exists = await _model('mark_submissions').findOne({ schoolId, classId: v.doc.classId, subjectId: v.doc.subjectId, termNumber: v.doc.termNumber, assessmentType: v.doc.assessmentType, instance: v.doc.instance }).lean();
        if (exists) continue;
        const now = new Date().toISOString();
        await _model('mark_submissions').insertOne({
          id: crypto.randomUUID(), schoolId,
          classId: v.doc.classId, subjectId: v.doc.subjectId, termNumber: v.doc.termNumber,
          assessmentType: v.doc.assessmentType, instance: v.doc.instance, academicYearId: v.doc.academicYearId,
          examSeriesId: null, notes: null, status: v.status,
          submittedBy: 'migration:exam_results', submittedAt: now,
          reviewedBy: 'migration:exam_results', reviewedAt: now, rejectionReason: null,
          marksSnapshot: [], createdAt: now, updatedAt: now,
          migratedFromExamId: v.examId,
        });
        report.applied.submissionsInserted = (report.applied.submissionsInserted || 0) + 1;
      }
      if (planned.length) {
        const ops = planned.map(({ plan, resultId }) => ({
          insertOne: { document: {
            id: crypto.randomUUID(), schoolId, ...plan.doc, _v: 1,
            createdBy: 'migration:exam_results', updatedBy: 'migration:exam_results',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            migratedFromExamResultId: resultId,
          } },
        }));
        const r = await _model('assessment_marks').bulkWrite(ops, { ordered: false });
        report.applied.inserted = r.insertedCount ?? 0;
      }
      const remapFrom = exams.filter(e => LEGACY_EXAM_STATUSES.includes(e.status)).map(e => e.id);
      if (remapFrom.length) {
        const r = await _model('exams').updateMany(
          { schoolId, id: { $in: remapFrom } },
          { $set: { status: 'completed', updatedAt: new Date().toISOString() } },
        );
        report.applied.examStatusUpdated = r.modifiedCount ?? 0;
      }
    }
    return report;
  }

  (async () => {
    console.error(`[migrate-exam-results] Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (reporting only)'}`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    const schools = schoolArg
      ? await _model('schools').find({ id: schoolArg }).lean()
      : await _model('schools').find({}).lean();
    if (!schools.length) { console.error('[migrate-exam-results] No matching school.'); await mongoose.disconnect(); process.exit(2); }

    const reports = [];
    for (const s of schools) {
      if (!s.id) continue;
      reports.push(await migrateSchool(s.id, { apply }));
    }
    await mongoose.disconnect();

    const conflicts = reports.reduce((n, r) => n + r.conflicts.length, 0);
    console.error('\n═══════════════════════════════════════════════════════');
    console.error(`  exam_results -> assessment_marks (${apply ? 'APPLIED' : 'DRY RUN'})`);
    console.error('═══════════════════════════════════════════════════════');
    for (const r of reports) {
      console.error(`  ${r.schoolId}: results=${r.resultsTotal} migrate=${r.migrate} alreadyMigrated=${r.alreadyMigrated} conflicts=${r.conflicts.length} examStatusRemap=${r.examStatusRemap}`);
      if (Object.keys(r.skipped).length) console.error(`    skipped: ${JSON.stringify(r.skipped)}`);
    }
    console.error('═══════════════════════════════════════════════════════\n');

    process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', reports }, null, 2) + '\n');
    process.exit(conflicts > 0 ? 1 : 0);
  })().catch(err => {
    console.error(`[migrate-exam-results] Fatal: ${err.message}\n${err.stack}`);
    mongoose.disconnect().finally(() => process.exit(2));
  });
}

module.exports = { toRawScore, resolveTermNumber, assignInstances, planResult, planExamStatusRemap, legacyApprovalFor, LEGACY_EXAM_STATUSES };
