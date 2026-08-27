/* ============================================================
   resolveAcademicPeriod — resolves + validates {academicYearId,
   termId} against a school's real academic_years records.

   Extracted from finance.js (originally written for invoices/fee
   structures) since it's fully generic and behaviour.js needs the
   exact same resolution for incidents. Mirrors report-cards.js's
   _resolveTermScope (same resolveCurrentPeriod fallback-to-current-
   period behavior when nothing is given), but errors on an
   explicitly-given id that doesn't exist for this school (matching
   exams.js's FK-validation style) instead of silently discarding it —
   a typo'd id should surface, not vanish. An academicYearId with no
   termId is valid (year-wide scope). Neither given → live-resolves
   the current year+term together, same as useCurrentAcademicPeriod
   client-side.

   Also blocks resolving to an archived year (Academic Year & Term
   Dependency Map, finding #5) — centralized here rather than at each
   of finance.js's and behaviour.js's call sites specifically because
   this utility already IS the single shared resolution point for both
   files; duplicating an isYearArchived() call at every call site is
   exactly the kind of duplicate mechanism archival.js's own header
   comment warns against. In the ordinary case, a caller resolving with
   neither academicYearId nor termId given lands on the live-current
   year, which is normally not archived — but nothing actually
   prevents POST /archive-year from archiving a year that's still
   flagged isCurrent (no such guard exists today), so this check is not
   purely defensive: it also correctly blocks that edge case rather
   than assuming it away.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');
const { resolveCurrentPeriod } = require('../routes/academic-config');
const { isYearArchived } = require('./archival');

async function resolveAcademicPeriod(schoolId, ctx, { academicYearId, termId }) {
  const years = await tenantModel('academic_years', ctx).find({ schoolId }).lean();
  if (!years.length) return { academicYearId: null, termId: null };

  const current = resolveCurrentPeriod(years);

  let year = null;
  if (academicYearId) {
    year = years.find(y => (y.id || y._id?.toString()) === academicYearId);
    if (!year) return { error: `academicYearId "${academicYearId}" does not match any academic year for this school` };
  } else {
    year = current.year;
  }
  if (!year) return { academicYearId: null, termId: null };

  const resolvedYearId = year.id || year._id?.toString();

  if (await isYearArchived(schoolId, resolvedYearId)) {
    return { error: `Academic year "${year.name}" is locked — no further changes are permitted for this period.` };
  }

  const terms = Array.isArray(year.terms) ? year.terms : [];

  let resolvedTermId = null;
  if (termId) {
    const term = terms.find(t => t.id === termId);
    if (!term) return { error: `termId "${termId}" does not match any term in academic year "${year.name}"` };
    resolvedTermId = term.id;
  } else if (!academicYearId) {
    resolvedTermId = current.term?.id ?? null;
  }
  // else: explicit academicYearId with no termId → year-wide scope, term left unset

  return { academicYearId: resolvedYearId, termId: resolvedTermId };
}

module.exports = { resolveAcademicPeriod };
