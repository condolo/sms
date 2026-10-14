#!/usr/bin/env node
/* ============================================================
   Msingi — Reconcile catalog-compulsory vs curriculum-compulsory

   Reported directly (2026-10-15): "in one school almost all subjects
   are compulsory, when i select am not seeing the stream even for the
   compulsory subjects?" Confirmed live: the Markbook's stream-selection
   logic itself is correct (see diagnose-stream-ambiguous-assignments.js,
   0 findings) — the real cause is that "compulsory" is TWO independent
   flags that never synced:
     - subjects.isCompulsory          (Catalog, school-wide label —
                                        confirmed to have ZERO functional
                                        effect anywhere except as a list
                                        filter)
     - class_subjects.isCompulsoryForClass (Curriculum, per class — the
                                        ONLY flag that actually drives
                                        the stream-requirement rule and
                                        the Markbook/Attendance roster)
   class-subjects.js's POST / and POST /bulk now default a NEW link's
   isCompulsoryForClass from the subject's catalog isCompulsory flag
   (fixed alongside this script) — but that only helps links created
   AFTER the fix. It does nothing for links that already exist, which is
   exactly what left Trinitas International School with 19/20 catalog
   subjects marked compulsory but only 14/143 of its curriculum links
   actually compulsory (confirmed directly against the live database).

   This script finds the EXISTING mismatches. It does NOT fix them by
   default — same "human must decide" precedent as
   diagnose-stream-ambiguous-assignments.js and
   migrate-legacy-deputy-role.js: a class_subjects link currently
   `false` might be a deliberate, legitimate override (a subject
   compulsory school-wide but genuinely elective for one specific
   class), not every mismatch is this bug. --apply is offered because,
   unlike the stream-ambiguous case, there is no missing fact a human
   alone can supply (no "which stream" to guess) — but it should only be
   run after a human has read the dry-run report and confirmed these
   particular mismatches really are the catalog-drift bug, not a
   deliberate per-class override.

   Usage:
     node server/scripts/reconcile-catalog-compulsory.js                    # dry run (default) — reports only, writes nothing
     node server/scripts/reconcile-catalog-compulsory.js --apply            # set isCompulsoryForClass:true for every mismatch found
     node server/scripts/reconcile-catalog-compulsory.js --schoolId=sch_xxx [--apply]

   Output: JSON report to stdout + a human summary to stderr.
   Exit code: 0 = no mismatches found, 1 = mismatches found (reviewed or not), 2 = script error.
   ============================================================ */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { _model } = require('../utils/model');

/* ── Pure decision logic — exported for unit testing without a DB ──
   Given one class_subjects link and the catalog subject it belongs to,
   decide whether it's a catalog/curriculum compulsory mismatch. */
function isCompulsoryMismatch(classSubject, subject) {
  if (!classSubject || !subject) return false;
  if (!subject.isCompulsory) return false;              // catalog doesn't claim compulsory — nothing to reconcile
  if (classSubject.isCompulsoryForClass === true) return false; // already agrees
  return true;
}

module.exports = { isCompulsoryMismatch };

/* ── Everything below only runs when this file is executed directly,
   never when required by a test. ────────────────────────────────── */
if (require.main === module) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('[reconcile-catalog-compulsory] MONGODB_URI not set in environment. Exiting.');
    process.exit(2);
  }

  const args      = process.argv.slice(2);
  const apply     = args.includes('--apply');
  const schoolArg = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;

  async function run() {
    console.error(`[reconcile-catalog-compulsory] Mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (reporting only)'}${schoolArg ? ` — school ${schoolArg}` : ' — every school'}`);
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });

    const schoolFilter = schoolArg ? { schoolId: schoolArg } : {};
    if (schoolArg) {
      const exists = await _model('schools').findOne({ id: schoolArg }).lean();
      if (!exists) { console.error(`[reconcile-catalog-compulsory] School not found: ${schoolArg}`); process.exit(2); }
    }

    const compulsorySubjects = await _model('subjects').find({ ...schoolFilter, isCompulsory: true }).lean();
    const subjectById = new Map(compulsorySubjects.map(s => [s.id, s]));
    const subjectIds = [...subjectById.keys()];

    const links = subjectIds.length
      ? await _model('class_subjects').find({ ...schoolFilter, subjectId: { $in: subjectIds } }).lean()
      : [];

    const classIds = [...new Set(links.map(l => l.classId))];
    const classes = classIds.length
      ? await _model('classes').find({ schoolId: schoolArg ? schoolArg : undefined, id: { $in: classIds } }).lean()
      : [];
    const classById = new Map(classes.map(c => [c.id, c]));

    const findings = [];
    for (const link of links) {
      const subject = subjectById.get(link.subjectId);
      if (!isCompulsoryMismatch(link, subject)) continue;
      findings.push({
        schoolId:   link.schoolId,
        linkId:     link.id ?? String(link._id),
        classId:    link.classId,
        className:  classById.get(link.classId)?.name ?? link.classId,
        subjectId:  link.subjectId,
        subjectName: subject?.name ?? link.subjectId,
        currentIsCompulsoryForClass: link.isCompulsoryForClass ?? false,
      });
      if (apply) {
        const filter = link.id ? { schoolId: link.schoolId, id: link.id } : { _id: link._id };
        await _model('class_subjects').updateOne(filter, { $set: { isCompulsoryForClass: true, updatedAt: new Date().toISOString() } });
      }
    }

    // Per-school summary, so a multi-school scan reads at a glance.
    const bySchool = new Map();
    for (const f of findings) {
      if (!bySchool.has(f.schoolId)) bySchool.set(f.schoolId, 0);
      bySchool.set(f.schoolId, bySchool.get(f.schoolId) + 1);
    }

    await mongoose.disconnect();

    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  Catalog vs curriculum compulsory mismatches — summary');
    console.error('═══════════════════════════════════════════════════════');
    console.error(`  Found: ${findings.length}${apply ? ' (now fixed)' : ' (would fix with --apply)'}`);
    for (const [schoolId, count] of bySchool) {
      console.error(`     ${schoolId}: ${count} link(s)`);
    }
    if (findings.length && !apply) {
      console.error('\n  Each flagged link has a catalog-compulsory subject whose curriculum link is NOT');
      console.error('  marked compulsory for that class. Review before applying — a class may deliberately');
      console.error('  treat a school-wide-compulsory subject as elective. Re-run with --apply to set');
      console.error('  isCompulsoryForClass:true for every link listed above.');
    }
    console.error('═══════════════════════════════════════════════════════\n');

    process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', findings }, null, 2) + '\n');
    process.exit(findings.length ? 1 : 0);
  }

  run().catch(err => {
    console.error(`[reconcile-catalog-compulsory] Fatal error: ${err.message}\n${err.stack}`);
    mongoose.disconnect().finally(() => process.exit(2));
  });
}
