'use strict';

/* Grade scales are section-scoped, like report-card templates.

   A report is generated for one class, and a class belongs to one section
   (classes.sectionKey → sections.key). So the scale is resolved once per
   report, from the class's section. Resolution order:
     section default → school default → legacy academic_config.gradingSchema
   Returns null when none exists. The caller must refuse to generate, not
   fall through to an undefined scale. */

const { tenantModel } = require('./tenant-model');

async function sectionIdForClass(schoolId, classId) {
  if (!classId) return null;
  const cls = await tenantModel('classes', { schoolId }).findOne({ schoolId, id: classId }).select('sectionKey').lean();
  if (!cls?.sectionKey) return null;
  const section = await tenantModel('sections', { schoolId }).findOne({ schoolId, key: cls.sectionKey }).select('id').lean();
  return section?.id ?? null;
}

async function resolveGradeScale(schoolId, sectionId, legacyBands) {
  const Scales = tenantModel('grade_boundaries', { schoolId });
  if (sectionId) {
    const sectionDefault = await Scales.findOne({ schoolId, sectionId, isDefault: true }).lean();
    if (sectionDefault) return { id: sectionDefault.id, name: sectionDefault.name, bands: sectionDefault.bands, source: 'section' };
  }
  const schoolDefault = await Scales.findOne({
    schoolId, isDefault: true, $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
  }).lean();
  if (schoolDefault) return { id: schoolDefault.id, name: schoolDefault.name, bands: schoolDefault.bands, source: 'school' };
  if (Array.isArray(legacyBands) && legacyBands.length) return { id: null, name: 'Legacy grading schema', bands: legacyBands, source: 'legacy' };
  return null;
}

module.exports = { sectionIdForClass, resolveGradeScale };
