'use strict';

/* Kindergarten / competency-band template resolution — mirrors
   grade-scale.js's resolveGradeScale exactly, on purpose, rather than
   inventing a second scoping convention for "which config applies to
   this class." The one real difference: there is no school-wide
   fallback tier here. A grade scale is something EVERY class needs
   (resolveGradeScale's caller must refuse to generate without one);
   an indicator-based template is opt-in per class/section — a class
   with no match simply isn't using this assessment model and falls
   through to the ordinary numeric Markbook, which is correct for most
   classes, not a missing-config error.

   Resolution order: explicit classIds (most specific) -> section
   default (isDefault:true for the class's section) -> null. */

const { tenantModel } = require('./tenant-model');
const { sectionIdForClass } = require('./grade-scale');

async function resolveRcTemplate(schoolId, classId) {
  if (!classId) return null;
  const Templates = tenantModel('rc_templates', { schoolId });

  const explicit = await Templates.findOne({ schoolId, classIds: classId, status: 'active' }).lean();
  if (explicit) return explicit;

  const sectionId = await sectionIdForClass(schoolId, classId);
  if (sectionId) {
    const sectionDefault = await Templates.findOne({ schoolId, sectionId, isDefault: true, status: 'active' }).lean();
    if (sectionDefault) return sectionDefault;
  }

  return null;
}

/* A subject's effective performance bands — its own override if it has
   one, otherwise the template's. Never both merged: an override
   replaces the template's bands for that subject entirely, since a
   partial merge would leave it ambiguous which labels/scores apply. */
function effectiveBandsForSubject(template, subjectId) {
  const subject = template?.subjects?.find(s => s.id === subjectId);
  if (subject?.performanceBands?.length) return subject.performanceBands;
  return template?.performanceBands ?? [];
}

/* Band-only scoring (2026-10-23, direct request) — a subject can be
   switched from numeric indicator entry to picking a performance band
   directly, no number typed at all. Same override convention as the
   bands themselves: a subject's own bandOnlyScoring wins entirely over
   the template's default when set; undefined means "inherit the
   template." Looked up by the subject's REAL catalog subjectId (what
   every actual caller — kg-report.js, indicator-marks.js — already
   keys subjects by), not the template-subject's own generated `id`
   (effectiveBandsForSubject above uses that `id` form instead; kept as-
   is since it's untouched elsewhere and has its own tests, but don't
   copy that key for new code — subjectId is the one every real route
   actually has in hand). */
function effectiveBandsForSubjectId(template, subjectId) {
  const subject = template?.subjects?.find(s => s.subjectId === subjectId);
  if (subject?.performanceBands?.length) return subject.performanceBands;
  return template?.performanceBands ?? [];
}

function isBandOnlySubject(template, subjectId) {
  const subject = template?.subjects?.find(s => s.subjectId === subjectId);
  if (subject?.bandOnlyScoring != null) return !!subject.bandOnlyScoring;
  return !!template?.bandOnlyScoring;
}

/* The ceiling a band-only subject's indicators are scored against —
   every indicator in the subject shares the same band set, so this is
   one constant per subject, not per indicator (unlike the legacy
   numeric maxScore, which genuinely varies indicator to indicator). */
function maxBandScore(bands) {
  return bands?.length ? Math.max(...bands.map(b => b.defaultScore ?? 0)) : 0;
}

/* Nearest band to a points value, by |band.defaultScore - points|. A
   tie (the average lands exactly between two bands) prefers the HIGHER
   band — rounds up, not down. Returns null for no bands or no value. */
function snapToNearestBand(points, bands) {
  if (!bands?.length || points == null) return null;
  return [...bands].sort((a, b) => {
    const da = Math.abs((a.defaultScore ?? 0) - points);
    const db = Math.abs((b.defaultScore ?? 0) - points);
    return da !== db ? da - db : (b.defaultScore ?? 0) - (a.defaultScore ?? 0);
  })[0];
}

module.exports = {
  resolveRcTemplate, effectiveBandsForSubject,
  effectiveBandsForSubjectId, isBandOnlySubject, maxBandScore, snapToNearestBand,
};
