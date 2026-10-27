/* ============================================================
   server/utils/report-layouts.js — _gradeColWidth()

   Reported directly, 2026-10-27: Cambridge Primary/Lower Secondary
   grades with WORDS ("Outstanding", "Unclassified", …) instead of
   single letters, and the Grade column in every report-card layout
   was sized (and the matching Settings forms capped) for ~1-2 letter
   grades — "Outstanding" or "Unclassified" would clip or overlap.
   This pins the shared PDF sizing helper: it grows only as much as
   the actual grade text in THIS report needs, never shrinks below
   the old fixed widths, and degrades safely for a test double that
   doesn't stub real text metrics.
   ============================================================ */
'use strict';

const { _gradeColWidth } = require('../utils/report-layouts');

/* A doc stand-in with a real (if approximate) widthOfString, so the
   "grows with content" behaviour is actually exercised, not just the
   no-op fallback. */
function makeMeasuringDoc() {
  let currentSize = 10;
  return {
    font() { return this; },
    fontSize(s) { currentSize = s; return this; },
    widthOfString(text) { return String(text).length * currentSize * 0.6; }, // rough but monotonic in length
  };
}

describe('_gradeColWidth()', () => {
  test('a single-letter grade set stays close to the old minimum width', () => {
    const doc = makeMeasuringDoc();
    const w = _gradeColWidth(doc, ['A', 'B+', 'C', '—'], { font: 'X', size: 9.5 });
    expect(w).toBe(42); // the floor every numeric layout already used
  });

  test('a word-based grade set ("Outstanding") grows past the minimum', () => {
    const doc = makeMeasuringDoc();
    const w = _gradeColWidth(doc, ['Grade', 'Outstanding', 'High', 'Good', 'Aspiring', 'Basic', 'Unclassified'], { font: 'X', size: 9.5 });
    expect(w).toBeGreaterThan(42);
  });

  test('the widest string in the set determines the result, not the average', () => {
    const doc = makeMeasuringDoc();
    const shortOnly = _gradeColWidth(doc, ['A', 'B'], { font: 'X', size: 9.5 });
    const withOneLong = _gradeColWidth(doc, ['A', 'B', 'Unclassified'], { font: 'X', size: 9.5 });
    expect(withOneLong).toBeGreaterThan(shortOnly);
  });

  test('a freak long value is capped at `max`, never blows out the whole table', () => {
    const doc = makeMeasuringDoc();
    const w = _gradeColWidth(doc, ['A very unreasonably long grade label nobody should ever type'], { font: 'X', size: 9.5, max: 120 });
    expect(w).toBe(120);
  });

  test('a custom `min` (the Kindergarten layout\'s own floor) is respected for short content', () => {
    const doc = makeMeasuringDoc();
    const w = _gradeColWidth(doc, ['GRADE', 'A'], { font: 'X', size: 9.5, min: 48 });
    expect(w).toBe(48);
  });

  test('degrades to the fixed `min` for a test-double doc with no real widthOfString, instead of throwing', () => {
    const bareSpy = { font: () => bareSpy, fontSize: () => bareSpy }; // no widthOfString at all
    const w = _gradeColWidth(bareSpy, ['Outstanding'], { font: 'X', size: 9.5, min: 42 });
    expect(w).toBe(42);
  });

  test('null/undefined entries in the text list are tolerated, not thrown', () => {
    const doc = makeMeasuringDoc();
    expect(() => _gradeColWidth(doc, ['Grade', null, undefined, 'A'], { font: 'X', size: 9.5 })).not.toThrow();
  });
});
