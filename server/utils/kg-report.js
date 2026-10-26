'use strict';

/* Kindergarten / competency-band report computation (2026-10).

   Deliberately separate from academic-calc.js's numeric pipeline
   (aggregateAssessmentMarks/computeFinalScores) — ranking and
   deviation-from-class-average don't have an agreed meaning for
   indicator-based marks (explicitly deferred, not built here), so
   this does not reuse or extend that pipeline.

   Two grading mechanisms coexist, per subject (2026-10-23, direct
   request — see rc-template-scale.js's isBandOnlySubject):
     - Numeric (the original, still the default): a subject's grade
       resolves through the SAME grade_boundaries system every other
       subject's grade comes from, off the earned/possible numeric
       percentage. Per-indicator bandLabel/bandGrade are a SEPARATE,
       purely decorative teacher pick in this mode — never what the
       subject's own grade is computed from.
     - Band-only (opt-in per template or per subject): the teacher
       picks a band per indicator, no number typed. The subject's
       grade is the SNAPPED band nearest the average of the picked
       bands' own points — never the grade_boundaries scale. The
       "percentage" is still computed internally (earned/possible,
       exactly as today) purely as the normalized unit that lets
       subjects on different band/point scales combine into one
       overall figure — it is not shown to the teacher or printed.
   Overall grade follows the TEMPLATE's own default bandOnlyScoring,
   regardless of what any individual subject overrode — a mixed
   template (some band-only subjects, some not) still needs ONE
   unambiguous rule for its single overall grade, and the template's
   own setting is the natural "whole report" default. */

const { tenantModel } = require('./tenant-model');
const {
  resolveRcTemplate, effectiveBandsForSubjectId, isBandOnlySubject,
  maxBandScore, snapToNearestBand,
} = require('./rc-template-scale');
const { resolveGrade } = require('../routes/academic-config');

/* A requested academicYearId must also match an indicator_definitions
   doc stored with no year at all — same tolerant posture every other
   mark-adjacent collection in this codebase uses. */
function _yearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : {};
}

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

  // Indicator TEXT is teacher-managed per class+subject+term, not
  // template content (2026-10-19) — see indicator-marks.js's header.
  // Fetched once for the whole class/term here (not per-subject), then
  // grouped below — same "resolve once per batch" discipline `scale`
  // already follows.
  const [marks, allDefs] = await Promise.all([
    tenantModel('indicator_marks', ctx).find({ schoolId, studentId, classId, termNumber }).lean(),
    tenantModel('indicator_definitions', ctx).find({ schoolId, classId, termNumber, ..._yearFilterPart(academicYearId) }).lean(),
  ]);
  const markByIndicator = Object.fromEntries(marks.map(m => [`${m.subjectId}::${m.indicatorId}`, m]));
  const defsBySubject = {};
  for (const d of allDefs) (defsBySubject[d.subjectId] ??= []).push(d);

  let overallEarned = 0, overallPossible = 0;
  const subjects = (template.subjects ?? []).map(subj => {
    const bands    = effectiveBandsForSubjectId(template, subj.subjectId);
    const bandOnly = isBandOnlySubject(template, subj.subjectId);
    const ceiling  = bandOnly ? maxBandScore(bands) : null; // one constant for the whole subject, not per-indicator
    let earned = 0, possible = 0;
    const indicators = [...(defsBySubject[subj.subjectId] ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(ind => {
        const mark = markByIndicator[`${subj.subjectId}::${ind.id}`];
        const band = mark?.bandId ? bands.find(b => b.id === mark.bandId) : null;
        if (mark && mark.score != null) { earned += mark.score; possible += bandOnly ? ceiling : ind.maxScore; }
        return {
          indicatorId: ind.id,
          text:        ind.text,
          // Band-only (reported directly, 2026-10-26): no number was
          // TYPED by the teacher, but one WAS captured — indicator-
          // marks.js resolves it server-side as the picked band's own
          // `defaultScore` (the school's own 1–5-style scale), stored
          // on the mark exactly like a numeric entry. Previously nulled
          // out here on the reasoning that nothing was typed, which
          // hid that already-captured number from the report for no
          // reason — the school wants to see where each band actually
          // sits on the scale they configured, not just its label.
          maxScore:    bandOnly ? ceiling : ind.maxScore,
          score:       mark?.score ?? null,
          bandLabel:   band?.label ?? null,
          bandGrade:   band?.grade ?? null,
          bandColor:   band?.color ?? null,
        };
      });
    const subjectAvgPct = possible > 0 ? (earned / possible) * 100 : null;
    // earned/possible is already a plain average when every indicator's
    // "possible" is the same constant (ceiling) — this just converts
    // that average back onto the band scale's own points, so snapping
    // can compare it against each band's defaultScore directly.
    const subjectAvgPoints = bandOnly && subjectAvgPct != null ? (subjectAvgPct / 100) * ceiling : null;
    const snappedSubject = bandOnly ? snapToNearestBand(subjectAvgPoints, bands) : null;
    const subjectGrade = bandOnly
      ? (snappedSubject?.grade ?? null)
      : ((subjectAvgPct != null && scale) ? (resolveGrade(subjectAvgPct, scale.bands).grade ?? null) : null);
    const subjectBandLabel = bandOnly ? (snappedSubject?.label ?? null) : null;
    overallEarned   += earned;
    overallPossible += possible;
    return {
      subjectId: subj.subjectId, name: subj.name, indicators,
      earned, possible, subjectAvgPct, subjectGrade,
      bandOnly, subjectBandLabel,
    };
  });

  // Overall follows the TEMPLATE's own default, not any one subject's
  // override — see this file's header for why a mixed template needs
  // one unambiguous rule for its single overall figure.
  const overallBandOnly = !!template.bandOnlyScoring;
  const overallAvgPct = overallPossible > 0 ? (overallEarned / overallPossible) * 100 : null;
  let overallGrade = null, overallBandLabel = null;
  if (overallBandOnly) {
    const templateBands = template.performanceBands ?? [];
    const ceiling = maxBandScore(templateBands);
    const overallAvgPoints = overallAvgPct != null && ceiling > 0 ? (overallAvgPct / 100) * ceiling : null;
    const snappedOverall = snapToNearestBand(overallAvgPoints, templateBands);
    overallGrade = snappedOverall?.grade ?? null;
    overallBandLabel = snappedOverall?.label ?? null;
  } else {
    overallGrade = (overallAvgPct != null && scale) ? (resolveGrade(overallAvgPct, scale.bands).grade ?? null) : null;
  }

  return {
    templateId:   template.id,
    templateName: template.name,
    display:      template.display ?? {},
    subjects,
    overallAvgPct,
    overallGrade,
    overallBandOnly,
    overallBandLabel,
  };
}

module.exports = { computeKgReport };
