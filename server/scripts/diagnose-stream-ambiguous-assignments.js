#!/usr/bin/env node
/* ============================================================
   Msingi — Diagnose stream-ambiguous teaching assignments
   Reported directly (2026-10-15): "the markbook does not honor the
   stream... even if a teacher has two streams in a class, still the
   stream has to be selected... I thought we implemented this?!"

   The Markbook's stream picker (ExamsPage.jsx's `subjectStreams` /
   `needsStreamSelection`) is driven entirely by the REAL per-stream
   teaching_assignments rows for a teacher+class+subject — it counts
   only rows that actually have a `streamId` set. `POST /teaching-
   assignments` correctly REFUSES to create a new assignment with no
   streamId when the subject is compulsory for a class that has
   streams (teaching-assignments.js's "Stream rule," added as a
   deliberate fix). But that check only runs at CREATE time, going
   forward — it does nothing for an assignment row that was already
   persisted before this rule existed. Such a row looks, to the
   Markbook, exactly like a legitimate whole-class grant: no stream
   prompt ever appears, and the teacher sees the WHOLE class's
   roster instead of just their own stream's — the exact symptom
   reported. Same bug class as the 'timetabler' responsibility-tag
   collision closed two days before this: a validation rule added
   later, with no backfill for data that predates it.

   This script finds those rows. It does NOT fix them — unlike a
   lossless rename, "which stream should this assignment actually be"
   is a fact only a human (the admin who knows the real timetable)
   can supply; auto-guessing would risk silently assigning a teacher
   to the WRONG stream, which is worse than today's ambiguity. Every
   finding needs a human decision: either split the one whole-class
   row into the correct per-stream row(s) via the Assignments UI (or
   directly), or confirm the subject is genuinely meant to be taught
   identically to every stream by this one teacher and mark it
   deliberately exempt (not something this script can know).

   Usage:
     node server/scripts/diagnose-stream-ambiguous-assignments.js                    # report only, writes nothing — this script never writes
     node server/scripts/diagnose-stream-ambiguous-assignments.js --schoolId=sch_xxx  # scope to one school

   Output: JSON report to stdout + a human summary to stderr.
   Exit code: 0 = no ambiguous assignments found, 1 = findings need
   human review, 2 = script error.
   ============================================================ */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { _model } = require('../utils/model');

/* ── Pure decision logic — exported for unit testing without a DB ──
   Given one teaching_assignments row plus the class_subjects curriculum
   entry it belongs to and how many active streams its class has,
   decide whether it's stream-ambiguous. */
function isStreamAmbiguous(assignment, classSubject, activeStreamCount) {
  if (assignment.streamId) return false;              // already stream-specific — fine
  if (!classSubject) return false;                     // not in curriculum at all — a different problem, not this one
  if (!classSubject.isCompulsoryForClass) return false; // elective: whole-class is the correct default, by design
  if (activeStreamCount <= 1) return false;             // no streams to be ambiguous between
  return true;
}

module.exports = { isStreamAmbiguous };

/* ── Everything below only runs when this file is executed directly,
   never when required by a test. ────────────────────────────────── */
if (require.main === module) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('[diagnose-stream-ambiguous-assignments] MONGODB_URI not set in environment. Exiting.');
    process.exit(2);
  }

  const args      = process.argv.slice(2);
  const schoolArg = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;

  async function run() {
    console.error(`[diagnose-stream-ambiguous-assignments] Scanning${schoolArg ? ` school ${schoolArg}` : ' every school'}...`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

    const schoolFilter = schoolArg ? { schoolId: schoolArg } : {};
    if (schoolArg) {
      const exists = await _model('schools').findOne({ id: schoolArg }).lean();
      if (!exists) { console.error(`[diagnose-stream-ambiguous-assignments] School not found: ${schoolArg}`); process.exit(2); }
    }

    const assignments = await _model('teaching_assignments').find({ ...schoolFilter, streamId: null }).lean();
    const findings = [];

    // Group by (schoolId, classId) so the stream-count and class_subjects
    // lookups happen once per class, not once per assignment row.
    const byClass = new Map();
    for (const a of assignments) {
      const key = `${a.schoolId}::${a.classId}`;
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key).push(a);
    }

    for (const [key, rows] of byClass) {
      const [schoolId, classId] = key.split('::');
      const activeStreamCount = await _model('streams').countDocuments({ schoolId, classId, status: 'active' });
      if (activeStreamCount <= 1) continue; // fast skip — nothing in this class can be ambiguous

      const classDoc = await _model('classes').findOne({ schoolId, id: classId }).lean();
      for (const a of rows) {
        const classSubject = await _model('class_subjects').findOne({ schoolId, classId, subjectId: a.subjectId }).lean();
        if (!isStreamAmbiguous(a, classSubject, activeStreamCount)) continue;

        const teacher = await _model('teachers').findOne({ schoolId, id: a.teacherId }).lean();
        const subject = await _model('subjects').findOne({ schoolId, id: a.subjectId }).lean();
        findings.push({
          schoolId,
          assignmentId:   a.id ?? String(a._id),
          teacherId:      a.teacherId,
          teacherName:    teacher ? `${teacher.firstName ?? ''} ${teacher.lastName ?? ''}`.trim() : a.teacherName ?? a.teacherId,
          classId,
          className:      classDoc?.name ?? classId,
          subjectId:      a.subjectId,
          subjectName:    subject?.name ?? a.subjectId,
          activeStreamCount,
          reason: `Compulsory for this class, which has ${activeStreamCount} streams, but this assignment names no stream — the teacher is silently being treated as whole-class.`,
        });
      }
    }

    await mongoose.disconnect();

    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  Stream-ambiguous teaching assignments — summary');
    console.error('═══════════════════════════════════════════════════════');
    console.error(`  Found: ${findings.length}`);
    for (const f of findings) {
      console.error(`     ${f.teacherName} — ${f.subjectName} in ${f.className} (${f.activeStreamCount} streams, school ${f.schoolId})`);
    }
    if (findings.length) {
      console.error('\n  Each needs a human decision — go to Classes → Assignments (or HR → Staff → Assignments) for the');
      console.error('  listed teacher/class/subject, remove the ambiguous whole-class row, and create the correct');
      console.error('  per-stream assignment(s) instead. This script never writes anything.');
    }
    console.error('═══════════════════════════════════════════════════════\n');

    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n');
    process.exit(findings.length ? 1 : 0);
  }

  run().catch(err => {
    console.error(`[diagnose-stream-ambiguous-assignments] Fatal error: ${err.message}\n${err.stack}`);
    mongoose.disconnect().finally(() => process.exit(2));
  });
}
