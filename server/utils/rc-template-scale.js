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

module.exports = { resolveRcTemplate, effectiveBandsForSubject };
