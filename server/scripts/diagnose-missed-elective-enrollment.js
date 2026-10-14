#!/usr/bin/env node
/* ============================================================
   Msingi — Diagnose missed elective enrollment

   Reported directly (2026-10-15): "is there a way a student can appear
   in the attendance of the teacher but is missing in the teacher's
   markbook? Maryanne Makena [Kabui] 3D is missing in teacher's
   markbook."

   Confirmed directly against live data — NOT a code bug in either
   Attendance or the Markbook:
     - Attendance's roster is class/stream-scoped only; it has no
       subject concept at all, so an active student always appears
       there regardless of what they're enrolled in.
     - The Markbook's elective roster (elective-scope.js) is
       deliberately enrollment-gated — `student_subjects` — by design,
       so a genuinely optional elective correctly shows only the
       students who opted in.
   The real gap: admitting/assigning a student to a class never
   auto-enrols them in that class's elective subjects — enrollment is a
   fully separate, manual step (student-subjects.js), with no backfill
   or reminder when a student joins a class after the rest of their
   classmates were already enrolled. Confirmed: Trinitas International
   School's Year 3 has 47 active students, 45 enrolled in its one
   elective (Kiswahili) — the 2 NOT enrolled (Maryanne Kabui, Wren
   Mwanzia) were both created (2026-09-22/23) well after the class's
   other students (baseline 2026-09-07), consistent with "joined after
   the bulk enrollment pass, never individually enrolled afterward."

   This script finds the same pattern elsewhere: an elective subject
   where a large majority of a class's active students are enrolled but
   a few specific ones are not. It does NOT enroll anyone — unlike the
   Year 3/Kiswahili case, a low-coverage subject may be a genuine
   per-student elective CHOICE (not everyone is supposed to take it),
   and guessing would risk enrolling a student in something they
   deliberately didn't choose. Only a human who knows the school's real
   elective policy can decide whether a flagged student was missed or
   genuinely opted out.

   Usage:
     node server/scripts/diagnose-missed-elective-enrollment.js                    # every school
     node server/scripts/diagnose-missed-elective-enrollment.js --schoolId=sch_xxx  # one school
     node server/scripts/diagnose-missed-elective-enrollment.js --minCoverage=0.9   # default 0.8

   Output: JSON report to stdout + a human summary to stderr.
   Exit code: 0 = no findings, 1 = findings need human review, 2 = script error.
   ============================================================ */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { _model } = require('../utils/model');

/* ── Pure decision logic — exported for unit testing without a DB ──
   Given an elective subject's active class roster and the subset of
   it already enrolled, decide which students look like a missed
   enrollment rather than a deliberate opt-out: coverage among the
   REST of the class must already be high (>= minCoverage) — a subject
   nobody much takes is a genuine choice-elective, not a gap. */
function findLikelyMissedEnrollments(rosterIds, enrolledIds, minCoverage = 0.8) {
  if (rosterIds.length === 0) return [];
  const enrolledSet = new Set(enrolledIds);
  const missing = rosterIds.filter(id => !enrolledSet.has(id));
  if (missing.length === 0) return [];
  const coverage = (rosterIds.length - missing.length) / rosterIds.length;
  if (coverage < minCoverage) return []; // low uptake overall — a real choice-elective, not a gap
  return missing;
}

module.exports = { findLikelyMissedEnrollments };

/* ── Everything below only runs when this file is executed directly,
   never when required by a test. ────────────────────────────────── */
if (require.main === module) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('[diagnose-missed-elective-enrollment] MONGODB_URI not set in environment. Exiting.');
    process.exit(2);
  }

  const args        = process.argv.slice(2);
  const schoolArg    = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;
  const minCoverage  = Number((args.find(a => a.startsWith('--minCoverage=')) || '').replace('--minCoverage=', '') || 0.8);

  async function run() {
    console.error(`[diagnose-missed-elective-enrollment] Scanning${schoolArg ? ` school ${schoolArg}` : ' every school'} (minCoverage=${minCoverage})...`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

    const schoolFilter = schoolArg ? { schoolId: schoolArg } : {};
    if (schoolArg) {
      const exists = await _model('schools').findOne({ id: schoolArg }).lean();
      if (!exists) { console.error(`[diagnose-missed-elective-enrollment] School not found: ${schoolArg}`); process.exit(2); }
    }

    const electiveLinks = await _model('class_subjects').find({ ...schoolFilter, isCompulsoryForClass: false }).lean();
    const findings = [];

    for (const link of electiveLinks) {
      const roster = await _model('students')
        .find({ schoolId: link.schoolId, classId: link.classId, status: 'active' })
        .select('id firstName lastName createdAt').lean();
      if (roster.length === 0) continue;

      const rosterIds = roster.map(s => s.id);
      const enrolled = await _model('student_subjects')
        .find({ schoolId: link.schoolId, subjectId: link.subjectId, studentId: { $in: rosterIds } })
        .select('studentId').lean();

      const missingIds = findLikelyMissedEnrollments(rosterIds, enrolled.map(e => e.studentId), minCoverage);
      if (missingIds.length === 0) continue;

      const byId = Object.fromEntries(roster.map(s => [s.id, s]));
      const subject = await _model('subjects').findOne({ schoolId: link.schoolId, id: link.subjectId }).select('name').lean();
      const cls = await _model('classes').findOne({ schoolId: link.schoolId, id: link.classId }).select('name').lean();

      findings.push({
        schoolId:    link.schoolId,
        classId:     link.classId,
        className:   cls?.name ?? link.classId,
        subjectId:   link.subjectId,
        subjectName: subject?.name ?? link.subjectId,
        rosterSize:  roster.length,
        enrolledCount: roster.length - missingIds.length,
        missing: missingIds.map(id => ({
          studentId: id,
          name: `${byId[id]?.firstName ?? ''} ${byId[id]?.lastName ?? ''}`.trim(),
          createdAt: byId[id]?.createdAt ?? null,
        })),
      });
    }

    await mongoose.disconnect();

    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  Likely missed elective enrollments — summary');
    console.error('═══════════════════════════════════════════════════════');
    console.error(`  Found: ${findings.length} class/subject pair(s) with outlier students`);
    for (const f of findings) {
      console.error(`     ${f.className} / ${f.subjectName} (${f.schoolId}) — ${f.enrolledCount}/${f.rosterSize} enrolled, missing: ${f.missing.map(m => m.name).join(', ')}`);
    }
    if (findings.length) {
      console.error('\n  Each needs a human decision — go to Subjects → Curriculum → Enroll Students for the');
      console.error('  listed class/subject and confirm whether the named student(s) should be enrolled, or');
      console.error('  were deliberately left out. This script never writes anything.');
    }
    console.error('═══════════════════════════════════════════════════════\n');

    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n');
    process.exit(findings.length ? 1 : 0);
  }

  run().catch(err => {
    console.error(`[diagnose-missed-elective-enrollment] Fatal error: ${err.message}\n${err.stack}`);
    mongoose.disconnect().finally(() => process.exit(2));
  });
}
