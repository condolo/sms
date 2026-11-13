/* ============================================================
   Msingi — Which assessments a report covers (v5.271.0)

   Asked for by a school that sets homework and CA more than once a term
   (2026-11-13): "the Mid-Term report card fetches only assessments from
   the start of that term to the mid-term assessment; the End-Term report
   fetches all of them for that term."

   The timings already exist: every assessment instance has its own
   schedule window (assessment_schedule: termNumber + assessmentType +
   instance → dateFrom/dateTo), set up at the start of the term. A report
   published for a cycle (an assessment type, e.g. MT or ET — see
   report-cards.js's `cycle`) covers every assessment instance whose
   window STARTS on or before the end of that cycle's own window:

     HW 1   Jan 10 – Jan 20   ┐
     CA 1   Feb 01 – Feb 05   ├─ Mid-Term report (MT ends Mar 05)
     MT     Mar 01 – Mar 05   ┘
     HW 2   Mar 20 – Mar 30   ┐
     CA 2   Apr 05 – Apr 09   ├─ End-Term report adds these
     ET     Apr 20 – Apr 30   ┘  (ET is last, so it covers the term)

   Rules that keep this from ever guessing:
     - No cycle (the default "whole term" report): every mark, as before.
     - The cycle's own type has no window this term: every mark, with a
       note saying so — the school hasn't told us when it falls.
     - An instance with no window: only the term's LAST report (the one
       whose window ends latest) covers it; earlier reports leave it out
       and the preview names it, so nothing silently disappears.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

function key(type, instance) { return `${type}|${instance || 1}`; }


/* The term's schedule windows, one per type+instance. A window saved for
   this academic year wins over a legacy one saved without a year. */
async function _windows(ctx, schoolId, termNumber, academicYearId) {
  const yearOr = academicYearId
    ? [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }]
    : [{ academicYearId: null }, { academicYearId: { $exists: false } }];
  const rows = await tenantModel('assessment_schedule', ctx)
    .find({ schoolId, termNumber: Number(termNumber), $or: yearOr })
    .select('assessmentType instance dateFrom dateTo academicYearId label')
    .lean();
  const out = new Map();
  for (const r of rows) {
    if (!r.assessmentType || !r.dateFrom || !r.dateTo) continue;
    const k = key(r.assessmentType, r.instance);
    const prev = out.get(k);
    if (!prev || (!prev.academicYearId && r.academicYearId)) out.set(k, r);
  }
  return out;
}

/**
 * Which assessment instances a report covers.
 *
 * @returns {{
 *   mode: 'whole_term' | 'cycle_unscheduled' | 'by_schedule',
 *   include: Set<string> | null,   // 'TYPE|instance'; null = every mark
 *   cutoff: string | null,         // last day of the cycle's window
 *   included: string[],            // labels, e.g. ['HW 1', 'CA 1', 'MT']
 *   excluded: string[],            // scheduled after the cutoff
 *   unscheduled: string[],         // no window, left out of an earlier report
 *   combos: Array<{ assessmentType: string, instance: number }>,
 * }}
 */
async function reportCoverage(ctx, schoolId, { termNumber, academicYearId, cycle, customTypes }) {
  const whole = (mode) => ({ mode, include: null, cutoff: null, included: [], excluded: [], unscheduled: [], combos: null });
  if (!cycle || termNumber == null) return whole('whole_term');

  const windows = await _windows(ctx, schoolId, termNumber, academicYearId);
  const cycleWindows = [...windows.values()].filter(w => w.assessmentType === cycle);
  if (!cycleWindows.length) return whole('cycle_unscheduled');

  const cutoff = cycleWindows.map(w => w.dateTo).sort().pop();
  const termEnd = [...windows.values()].map(w => w.dateTo).sort().pop();
  const isLastReport = cutoff >= termEnd;

  const include = new Set();
  const combos = [];
  const included = [];
  const excluded = [];
  const unscheduled = [];
  for (const t of customTypes || []) {
    const n = Math.max(1, Number(t.instances) || 1);
    for (let i = 1; i <= n; i++) {
      const w = windows.get(key(t.key, i));
      const name = n > 1 ? `${t.key} ${i}` : t.key;   // "HW 1", "HW 2"; a single-instance type is just "MT"
      const covered = w ? w.dateFrom <= cutoff : isLastReport;
      if (covered) {
        include.add(key(t.key, i));
        combos.push({ assessmentType: t.key, instance: i });
        included.push(name);
      } else if (w) {
        excluded.push(name);
      } else {
        unscheduled.push(name);
      }
    }
  }
  return { mode: 'by_schedule', include, cutoff, included, excluded, unscheduled, combos };
}

/* A Mongo clause matching exactly the covered marks. Marks saved before
   instances existed have no `instance` field; they count as instance 1. */
function coverageMarkClause(coverage) {
  if (!coverage?.combos) return {};
  if (!coverage.combos.length) return { _id: { $exists: false } };   // covers nothing
  return {
    $or: coverage.combos.map(c => (c.instance === 1
      ? { assessmentType: c.assessmentType, $or: [{ instance: 1 }, { instance: null }, { instance: { $exists: false } }] }
      : { assessmentType: c.assessmentType, instance: c.instance })),
  };
}

/* What the report preview and the published snapshot record about it. */
function coverageSummary(coverage) {
  if (!coverage) return null;
  return {
    mode: coverage.mode,
    cutoff: coverage.cutoff,
    included: coverage.included,
    // 'TYPE|instance' — lets the report show only the columns it covers
    // (no ET column on a Mid-Term report; CA 1 but not CA 2).
    includedKeys: coverage.include ? [...coverage.include] : null,
    excluded: coverage.excluded,
    unscheduled: coverage.unscheduled,
  };
}

module.exports = { reportCoverage, coverageMarkClause, coverageSummary, _key: key };
