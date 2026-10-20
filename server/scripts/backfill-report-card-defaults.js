#!/usr/bin/env node
/* ============================================================
   Msingi — Production backfill: report-card defaults

   WHY THIS EXISTS
   Report cards resolve two things per school before they can render:
     1. a grade scale  (grade_boundaries) — without one, POST
        /api/report-cards/generate refuses with "No grade scale is set
        for this class's section" (this is exactly the failure the
        demo school had until this PR);
     2. a report-card template (report_card_templates) — without one
        the school falls back to the frozen legacy_tabular renderer,
        whose HTML (print) and PDF (download) renderers are two
        different documents, so a printed card and a downloaded batch
        never match.

   A school created before this PR has neither. This script adds the
   missing defaults so existing production schools can generate, publish
   and print report cards the same way a new one can.

   IT IS ADDITIVE ONLY
   - No existing document is rewritten, re-shaped or deleted.
   - A school that already has a grade scale keeps it untouched.
   - A school that already has report-card templates keeps them
     untouched (their default is reported, never overridden).
   - Published report-card snapshots are never touched: they keep the
     layout and the scores they were published with. Only FUTURE
     publishes pick up the new defaults.

   Usage
     node server/scripts/backfill-report-card-defaults.js              # dry run (default) — reports only
     node server/scripts/backfill-report-card-defaults.js --apply      # perform the backfill
     node server/scripts/backfill-report-card-defaults.js --schoolId=sch_xxx [--apply]

   Exit codes
     0 = clean, or every school handled
     1 = one or more schools need a human decision (see the report)
     2 = script error
   ============================================================ */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { _model } = require('../utils/model');

/* The same KCSE bands the demo seed uses, as the school-wide default.
   A school with its own scale keeps it — this only fills a gap. */
const DEFAULT_GRADE_BANDS = [
  { min: 80, grade: 'A',  points: 12, label: 'Excellent' },
  { min: 75, grade: 'A-', points: 11, label: 'Very Good' },
  { min: 70, grade: 'B+', points: 10, label: 'Good' },
  { min: 65, grade: 'B',  points: 9,  label: 'Good' },
  { min: 60, grade: 'B-', points: 8,  label: 'Satisfactory' },
  { min: 55, grade: 'C+', points: 7,  label: 'Satisfactory' },
  { min: 50, grade: 'C',  points: 6,  label: 'Average' },
  { min: 45, grade: 'C-', points: 5,  label: 'Average' },
  { min: 40, grade: 'D+', points: 4,  label: 'Below Average' },
  { min: 35, grade: 'D',  points: 3,  label: 'Below Average' },
  { min: 30, grade: 'D-', points: 2,  label: 'Weak' },
  { min: 0,  grade: 'E',  points: 1,  label: 'Fail' },
];

const TEMPLATE_LAYOUT_KEY = 'subject_paired';

/**
 * Decide what a school needs, without touching the database.
 * Pure function — exported for unit testing.
 *
 * @returns {{ action: 'none'|'backfill'|'review', reasons: string[], gradeScale?: object, template?: object }}
 */
function planSchool(schoolId, gradeScales, templates) {
  const reasons = [];

  const hasSchoolDefaultScale = gradeScales.some(
    s => (s.sectionId == null) && s.isDefault,
  );
  const hasAnyScale = gradeScales.length > 0;
  const schoolWideScales = gradeScales.filter(s => s.sectionId == null);

  let gradeScale = null;
  if (hasSchoolDefaultScale) {
    reasons.push('grade scale: school default already present');
  } else if (!hasAnyScale) {
    gradeScale = { kind: 'insert' };
    reasons.push('grade scale: MISSING - no scale of any kind for this school');
  } else if (schoolWideScales.length === 1) {
    gradeScale = { kind: 'mark-default', id: schoolWideScales[0].id };
    reasons.push('grade scale: one school-wide scale exists but is not marked default');
  } else {
    reasons.push('grade scale: scales exist but none is a school-wide default - a human must pick');
    return { action: 'review', reasons, gradeScale: null, template: null };
  }

  const hasTemplate = templates.length > 0;
  const hasDefaultTemplate = templates.some(t => t.isDefault);
  let template = null;
  if (hasTemplate) {
    reasons.push(hasDefaultTemplate
      ? 'template: default already present'
      : 'template: templates exist but none is marked default - left untouched (a human should pick)');
    if (!hasDefaultTemplate) {
      return { action: 'review', reasons, gradeScale, template: null };
    }
  } else {
    template = { kind: 'insert' };
    reasons.push('template: MISSING - publishing would fall back to the legacy layout');
  }

  const needsWrite = gradeScale || template;
  return {
    action: needsWrite ? 'backfill' : 'none',
    reasons,
    gradeScale,
    template,
  };
}

async function runBackfill({ apply = false, onlySchool = null, log = console.log } = {}) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  // Already connected when the server's startup migration chain calls
  // this - mongoose.connect() is then a no-op.
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME || 'innolearn',
    });
  }

  const Schools    = _model('schools');
  const Boundaries = _model('grade_boundaries');
  const Templates  = _model('report_card_templates');

  const schoolFilter = { isActive: { $ne: false } };
  if (onlySchool) schoolFilter.id = onlySchool;
  const schools = await Schools.find(schoolFilter).select('id name slug').lean();

  const report = { mode: apply ? 'apply' : 'dry-run', schools: [], created: 0, updated: 0, review: 0 };
  const now = new Date().toISOString();

  for (const school of schools) {
    const [gradeScales, templates] = await Promise.all([
      Boundaries.find({ schoolId: school.id }).lean(),
      Templates.find({ schoolId: school.id }).lean(),
    ]);

    const plan = planSchool(school.id, gradeScales, templates);
    const entry = { schoolId: school.id, name: school.name, action: plan.action, reasons: plan.reasons };

    if (plan.action === 'review') {
      report.review++;
      report.schools.push(entry);
      continue;
    }

    if (plan.action === 'backfill' && apply) {
      if (plan.gradeScale?.kind === 'insert') {
        await Boundaries.create({
          id: `gb_backfill_${school.id}`,
          schoolId: school.id,
          name: 'Standard Grading Scale (A-E)',
          description: 'Default school-wide scale created by the report-card backfill.',
          sectionId: null,
          isDefault: true,
          bands: DEFAULT_GRADE_BANDS,
          createdBy: 'backfill-report-card-defaults',
          updatedBy: 'backfill-report-card-defaults',
          createdAt: now,
          updatedAt: now,
        });
        report.created++;
        entry.gradeScale = 'created';
      } else if (plan.gradeScale?.kind === 'mark-default') {
        await Boundaries.updateOne(
          { id: plan.gradeScale.id, schoolId: school.id },
          { $set: { isDefault: true, updatedBy: 'backfill-report-card-defaults', updatedAt: now } },
        );
        report.updated++;
        entry.gradeScale = 'marked default';
      }

      if (plan.template?.kind === 'insert') {
        await Templates.create({
          id: `rct_backfill_${school.id}`,
          schoolId: school.id,
          name: 'Standard Report Card',
          curriculumTag: null,
          sectionId: null,
          isDefault: true,
          layoutKey: TEMPLATE_LAYOUT_KEY,
          revision: 1,
          createdBy: 'backfill-report-card-defaults',
          updatedBy: 'backfill-report-card-defaults',
          createdAt: now,
          updatedAt: now,
        });
        report.created++;
        entry.template = 'created';
      }
    } else if (plan.action === 'backfill') {
      entry.gradeScale = plan.gradeScale?.kind || null;
      entry.template = plan.template?.kind || null;
    }

    report.schools.push(entry);
  }  if (log) log(JSON.stringify(report, null, 2));
  return report;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const schoolArg = process.argv.find(a => a.startsWith('--schoolId='));
  const onlySchool = schoolArg ? schoolArg.split('=')[1] : null;

  try {
    const report = await runBackfill({ apply, onlySchool });
    console.log(JSON.stringify(report, null, 2));
    console.error(`\n[backfill] ${apply ? 'APPLIED' : 'DRY RUN'} - ${report.schools.length} school(s) scanned, ` +
      `${report.created} created, ${report.updated} updated, ${report.review} need a human decision.`);
    if (!apply) {
      console.error('[backfill] Nothing was written. Re-run with --apply to perform the backfill.');
    }
    await mongoose.disconnect();
    process.exit(report.review > 0 ? 1 : 0);
  } catch (err) {
    console.error('[backfill] Fatal:', err.message);
    process.exit(2);
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('[backfill] Fatal:', err);
    process.exit(2);
  });
}

module.exports = { planSchool, runBackfill, DEFAULT_GRADE_BANDS, TEMPLATE_LAYOUT_KEY };
