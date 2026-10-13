'use strict';

/* Kindergarten / competency-band report computation (2026-10).

   Deliberately separate from academic-calc.js's numeric pipeline
   (aggregateAssessmentMarks/computeFinalScores) — ranking and
   deviation-from-class-average don't have an agreed meaning for
   indicator-based marks (explicitly deferred, not built here), so
   this does not reuse or extend that pipeline.

   Subject/overall average grade resolves through the SAME
   grade_boundaries system every other subject's grade comes from —
   not a separate, parallel grading concept. Per-indicator grade comes
   from the performance band itself, a different, qualitative mapping
   the school defines in the template (see rc-templates.js). Both
   appear on the report, clearly distinguished — see
   report-layouts.js's _renderKindergartenPdf/Html. */

const { tenantModel } = require('./tenant-model');
const { resolveRcTemplate } = require('./rc-template-scale');
const { resolveGrade } = require('../routes/academic-config');

/**
 * One student's KG report for one term. `scale` is the already-resolved
 * grade_boundaries scale (resolved ONCE per batch by the caller, same
 * convention the numeric /generate route already uses — not re-resolved
 * per student). Returns null when the class has no resolved template —
 * the caller should fall back to the ordinary numeric pipeline in that
 * case, not treat it as an error.
 */
async function computeKgReport(ctx, schoolId, classId, studentId, termNumber, academicYearId, scale) {
  const template = await resolveRcTemplate(schoolId, classId);
  if (!template) return null;

  const marks = await tenantModel('indicator_marks', ctx).find({
    schoolId, studentId, classId, termNumber,
  }).lean();
  const markByIndicator = Object.fromEntries(marks.map(m => [`${m.subjectId}::${m.indicatorId}`, m]));

  let overallEarned = 0, overallPossible = 0;
  const subjects = (template.subjects ?? []).map(subj => {
    // A subject's own bands override the template's entirely — never
    // merged (same rule rc-template-scale.js's effectiveBandsForSubject
    // enforces server-side for the Markbook; duplicated here rather than
    // imported since the shapes differ slightly — this needs the FULL
    // band object including color, that util only returns the array).
    const bands = subj.performanceBands?.length ? subj.performanceBands : (template.performanceBands ?? []);
    let earned = 0, possible = 0;
    const indicators = [...(subj.indicators ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(ind => {
        const mark = markByIndicator[`${subj.subjectId}::${ind.id}`];
        const band = mark?.bandId ? bands.find(b => b.id === mark.bandId) : null;
        if (mark && mark.score != null) { earned += mark.score; possible += ind.maxScore; }
        return {
          indicatorId: ind.id,
          text:        ind.text,
          maxScore:    ind.maxScore,
          score:       mark?.score ?? null,
          bandLabel:   band?.label ?? null,
          bandGrade:   band?.grade ?? null,
          bandColor:   band?.color ?? null,
        };
      });
    const subjectAvgPct = possible > 0 ? (earned / possible) * 100 : null;
    const subjectGrade  = (subjectAvgPct != null && scale) ? (resolveGrade(subjectAvgPct, scale.bands).grade ?? null) : null;
    overallEarned   += earned;
    overallPossible += possible;
    return {
      subjectId: subj.subjectId, name: subj.name, indicators,
      earned, possible, subjectAvgPct, subjectGrade,
    };
  });

  const overallAvgPct = overallPossible > 0 ? (overallEarned / overallPossible) * 100 : null;
  const overallGrade  = (overallAvgPct != null && scale) ? (resolveGrade(overallAvgPct, scale.bands).grade ?? null) : null;

  return {
    templateId:   template.id,
    templateName: template.name,
    display:      template.display ?? {},
    subjects,
    overallAvgPct,
    overallGrade,
  };
}

module.exports = { computeKgReport };
