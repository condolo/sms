/* ============================================================
   InnoLearn — Archival Utilities
   Single source of truth for year-archival checks.

   Imported by any route that needs to guard write operations
   against archived academic years:
     - server/routes/grades.js
     - server/routes/exams.js
     - server/routes/report-cards.js

   DO NOT duplicate _isYearArchived inline in individual routes.
   ============================================================ */
const { _model } = require('./model');

/**
 * Returns true if the given academicYearId has been archived
 * for this school (i.e. it appears in academic_config.archivedAcademicYears).
 *
 * Safe for missing/null inputs — returns false rather than throwing.
 * Uses a projection so only the archivedAcademicYears field is loaded.
 *
 * @param {string} schoolId
 * @param {string|null|undefined} academicYearId
 * @returns {Promise<boolean>}
 */
async function isYearArchived(schoolId, academicYearId) {
  if (!schoolId || !academicYearId) return false;
  const cfg = await _model('academic_config')
    .findOne({ schoolId }, { archivedAcademicYears: 1 })
    .lean();
  return (
    Array.isArray(cfg?.archivedAcademicYears) &&
    cfg.archivedAcademicYears.includes(academicYearId)
  );
}

/**
 * Given an array of academicYearIds (may contain duplicates / nulls),
 * returns the first one that is archived — or null if none are.
 * Used by bulk-write endpoints to check all distinct years in one pass.
 *
 * Runs checks sequentially (not in parallel) to avoid N concurrent reads;
 * since the number of distinct years per bulk payload is typically 1–2,
 * this is negligible.
 *
 * @param {string}   schoolId
 * @param {string[]} yearIds
 * @returns {Promise<string|null>}  first archived yearId found, or null
 */
async function firstArchivedYear(schoolId, yearIds) {
  const distinct = [...new Set(yearIds.filter(Boolean))];
  for (const yid of distinct) {
    if (await isYearArchived(schoolId, yid)) return yid;
  }
  return null;
}

module.exports = { isYearArchived, firstArchivedYear };
