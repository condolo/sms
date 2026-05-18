/* ============================================================
   Msingi — Grade Calculation Engine (CA / HW / MT / ET system)

   Single source of truth for the weighted assessment system.
   DO NOT duplicate these calculations in routes or reports.

   Assessment types:
     CA  – Continuous Assessment  (default weight: 20%)
     HW  – Homework / Assignment  (default weight: 10%)
     MT  – Mid-Term               (default weight: 30%)
     ET  – End-Term               (default weight: 40%)

   Rules:
     · All marks entered out of 100 (rawScore 0–100)
     · Multiple instances (CA1, CA2…) → averaged → weight applied
     · Weights must sum to exactly 100 — validated on save
     · Half-term report: CA + HW + MT only, re-scaled to 100%
     · Term 2 / Term 3 final grade blends term total with ET running avg
   ============================================================ */

'use strict';

/* ── Helpers ────────────────────────────────────────────────── */

function _round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function _avg(arr) {
  if (!arr || arr.length === 0) return null;
  const valid = arr.filter(n => n != null && !isNaN(Number(n)));
  if (valid.length === 0) return null;
  return _round(valid.reduce((s, n) => s + Number(n), 0) / valid.length);
}

/* ── Weight validation ──────────────────────────────────────── */

/**
 * Validate that weights object sums to 100.
 * @param {Object} weights  e.g. { CA: 20, HW: 10, MT: 30, ET: 40 }
 * @returns {{ valid: boolean, total: number }}
 */
function validateWeights(weights) {
  const total = Object.values(weights).reduce((s, n) => s + Number(n), 0);
  return { valid: Math.abs(total - 100) < 0.01, total: _round(total) };
}

/* ── Mark aggregation ───────────────────────────────────────── */

/**
 * Given an array of mark documents for one student / one subject / one term,
 * return per-type averages and a full breakdown.
 *
 * Each mark document must have: { assessmentType, instance, rawScore, label }
 *
 * @returns {{
 *   typeAvgs:  { CA?: number, HW?: number, MT?: number, ET?: number },
 *   breakdown: { CA?: [{instance, rawScore, label}], HW?: [...], ... }
 * }}
 */
function aggregateMarks(marks) {
  const byType = {};

  for (const m of marks) {
    const type = (m.assessmentType || '').toUpperCase();
    if (!type) continue;
    byType[type] = byType[type] || [];
    byType[type].push({
      instance: m.instance,
      rawScore: m.rawScore,
      label:    m.label || `${type} ${m.instance}`,
    });
  }

  const typeAvgs  = {};
  const breakdown = {};

  for (const [type, instances] of Object.entries(byType)) {
    const scores = instances.map(i => i.rawScore).filter(s => s != null);
    typeAvgs[type]  = _avg(scores);
    breakdown[type] = instances;
  }

  return { typeAvgs, breakdown };
}

/* ── Term total (full) ──────────────────────────────────────── */

/**
 * Weighted term total for a complete term (all four types).
 * Missing types are excluded; remaining weights are normalised so
 * partial data doesn't artificially depress the score.
 *
 * @param {{ CA?, HW?, MT?, ET? }} typeAvgs
 * @param {{ CA: number, HW: number, MT: number, ET: number }} weights  (sum = 100)
 * @returns {number|null}
 */
function computeTermTotal(typeAvgs, weights) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [type, w] of Object.entries(weights)) {
    const avg = typeAvgs[type];
    if (avg != null && !isNaN(avg)) {
      weightedSum += Number(avg) * Number(w);
      totalWeight += Number(w);
    }
  }

  if (totalWeight === 0) return null;
  return _round(weightedSum / totalWeight);
}

/* ── Half-term total (CA + HW + MT, re-scaled to 100%) ─────── */

/**
 * Half-term report uses only CA, HW, MT — re-scaled so they sum to 100%.
 *
 * Example (defaults):  CA=20, HW=10, MT=30  → half-sum=60
 *   re-scaled: CA = 20/60×100 = 33.3%
 *              HW = 10/60×100 = 16.7%
 *              MT = 30/60×100 = 50.0%
 *
 * @param {{ CA?, HW?, MT? }} typeAvgs
 * @param {{ CA: number, HW: number, MT: number }} weights
 * @returns {number|null}
 */
function computeHalfTermTotal(typeAvgs, weights) {
  const HALF_TYPES = ['CA', 'HW', 'MT'];

  const halfWeightSum = HALF_TYPES.reduce((s, t) => s + (Number(weights[t]) || 0), 0);
  if (halfWeightSum === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const type of HALF_TYPES) {
    const avg = typeAvgs[type];
    if (avg != null && !isNaN(avg) && weights[type]) {
      const rescaled = (Number(weights[type]) / halfWeightSum) * 100;
      weightedSum += Number(avg) * rescaled;
      totalWeight += rescaled;
    }
  }

  if (totalWeight === 0) return null;
  return _round(weightedSum / totalWeight);
}

/* ── Term final grades ──────────────────────────────────────── */

/**
 * Term 1 final grade — just the term total (no previous ETs).
 *
 * @returns {{ termTotal: number|null, finalGrade: number|null }}
 */
function computeTerm1Grade(typeAvgs, weights) {
  const termTotal = computeTermTotal(typeAvgs, weights);
  return { termTotal, finalGrade: termTotal };
}

/**
 * Term 2 final grade.
 * finalGrade = (term2Total + etRunningAvg) / 2
 * etRunningAvg = avg(ET1, ET2)
 *
 * ET1 appears as a reference column — does NOT re-enter the term total.
 * Only the blended finalGrade uses it.
 *
 * @param {{ CA?, HW?, MT?, ET? }} term2TypeAvgs
 * @param {{ CA, HW, MT, ET }} weights
 * @param {number|null} et1Score  — ET score from Term 1
 * @returns {{ termTotal, etRunningAvg, finalGrade }}
 */
function computeTerm2Grade(term2TypeAvgs, weights, et1Score) {
  const termTotal = computeTermTotal(term2TypeAvgs, weights);
  const et2Score  = term2TypeAvgs['ET'] ?? null;

  if (termTotal == null) {
    return { termTotal: null, etRunningAvg: null, finalGrade: null };
  }

  const etRunningAvg = _avg([et1Score, et2Score].filter(s => s != null));

  const finalGrade = etRunningAvg != null
    ? _round((termTotal + etRunningAvg) / 2)
    : termTotal;  // fallback: no prior ET → just use term total

  return { termTotal, etRunningAvg, finalGrade };
}

/**
 * Term 3 final grade.
 * finalGrade = (term3Total + etRunningAvg) / 2
 * etRunningAvg = avg(ET1, ET2, ET3)
 *
 * @param {{ CA?, HW?, MT?, ET? }} term3TypeAvgs
 * @param {{ CA, HW, MT, ET }} weights
 * @param {number|null} et1Score
 * @param {number|null} et2Score
 * @returns {{ termTotal, etRunningAvg, finalGrade }}
 */
function computeTerm3Grade(term3TypeAvgs, weights, et1Score, et2Score) {
  const termTotal = computeTermTotal(term3TypeAvgs, weights);
  const et3Score  = term3TypeAvgs['ET'] ?? null;

  if (termTotal == null) {
    return { termTotal: null, etRunningAvg: null, finalGrade: null };
  }

  const etRunningAvg = _avg([et1Score, et2Score, et3Score].filter(s => s != null));

  const finalGrade = etRunningAvg != null
    ? _round((termTotal + etRunningAvg) / 2)
    : termTotal;

  return { termTotal, etRunningAvg, finalGrade };
}

/* ── Template B — annual summary ────────────────────────────── */

/**
 * Template B: equal-weight average of all term totals.
 * finalAvg = (T1_total + T2_total + T3_total) / 3
 * Uses each term's *total* (not final grade) for clean equal comparison.
 *
 * @param {number|null} t1  Term 1 term total
 * @param {number|null} t2  Term 2 term total
 * @param {number|null} t3  Term 3 term total
 * @returns {number|null}
 */
function computeSummaryAverage(t1, t2, t3) {
  const scores = [t1, t2, t3].filter(s => s != null && !isNaN(s));
  if (scores.length === 0) return null;
  return _round(scores.reduce((s, n) => s + n, 0) / scores.length);
}

/* ── Full report card for one student / one subject ─────────── */

/**
 * Build a complete subject row for a student's report card.
 * Works for Template A (detailed) and provides the data Template B needs.
 *
 * @param {Object} params
 * @param {Array}  params.marks          — all assessment_marks for this student+subject (all terms)
 * @param {Object} params.weights        — { CA, HW, MT, ET }
 * @param {string} params.reportTemplate — 'detailed' | 'summary'
 * @returns {Object}  structured report data for this subject
 */
function buildSubjectReport({ marks, weights }) {
  // Group marks by term
  const byTerm = { 1: [], 2: [], 3: [] };
  for (const m of marks) {
    const t = m.termNumber;
    if (byTerm[t]) byTerm[t].push(m);
  }

  const terms = {};

  // ── Term 1 ──
  const { typeAvgs: ta1, breakdown: bd1 } = aggregateMarks(byTerm[1]);
  const halfT1 = computeHalfTermTotal(ta1, weights);
  const { termTotal: tt1, finalGrade: fg1 } = computeTerm1Grade(ta1, weights);
  terms[1] = {
    typeAvgs:     ta1,
    breakdown:    bd1,
    halfTermTotal: halfT1,
    termTotal:    tt1,
    etScore:      ta1['ET'] ?? null,
    etRunningAvg: ta1['ET'] ?? null,   // T1: running avg = ET1 itself
    finalGrade:   fg1,
  };

  // ── Term 2 ──
  const { typeAvgs: ta2, breakdown: bd2 } = aggregateMarks(byTerm[2]);
  const halfT2 = computeHalfTermTotal(ta2, weights);
  const { termTotal: tt2, etRunningAvg: era2, finalGrade: fg2 } =
    computeTerm2Grade(ta2, weights, terms[1].etScore);
  terms[2] = {
    typeAvgs:     ta2,
    breakdown:    bd2,
    halfTermTotal: halfT2,
    termTotal:    tt2,
    etScore:      ta2['ET'] ?? null,
    etRef:        { ET1: terms[1].etScore },          // reference columns
    etRunningAvg: era2,
    finalGrade:   fg2,
  };

  // ── Term 3 ──
  const { typeAvgs: ta3, breakdown: bd3 } = aggregateMarks(byTerm[3]);
  const halfT3 = computeHalfTermTotal(ta3, weights);
  const { termTotal: tt3, etRunningAvg: era3, finalGrade: fg3 } =
    computeTerm3Grade(ta3, weights, terms[1].etScore, terms[2].etScore);
  terms[3] = {
    typeAvgs:     ta3,
    breakdown:    bd3,
    halfTermTotal: halfT3,
    termTotal:    tt3,
    etScore:      ta3['ET'] ?? null,
    etRef:        { ET1: terms[1].etScore, ET2: terms[2].etScore },
    etRunningAvg: era3,
    finalGrade:   fg3,
  };

  // ── Template B summary ──
  const summaryAverage = computeSummaryAverage(tt1, tt2, tt3);

  return { terms, summaryAverage };
}

/* ── Exports ─────────────────────────────────────────────────── */

module.exports = {
  validateWeights,
  aggregateMarks,
  computeTermTotal,
  computeHalfTermTotal,
  computeTerm1Grade,
  computeTerm2Grade,
  computeTerm3Grade,
  computeSummaryAverage,
  buildSubjectReport,
};
