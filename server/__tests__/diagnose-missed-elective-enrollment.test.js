/* ============================================================
   Unit tests — server/scripts/diagnose-missed-elective-enrollment.js's
   pure decision logic (findLikelyMissedEnrollments).

   No MongoDB required — a pure function, exported specifically so this
   logic is testable independent of the script's DB-connecting shell
   (which only runs when the file is executed directly, guarded by
   require.main === module).
   ============================================================ */
'use strict';

const { findLikelyMissedEnrollments } = require('../scripts/diagnose-missed-elective-enrollment');

describe('findLikelyMissedEnrollments', () => {
  test('high coverage with a couple of outliers — flagged (the exact reported case)', () => {
    const roster = ['s1', 's2', 's3', 's4', 's5'];
    const enrolled = ['s1', 's2', 's3']; // 3/5 = 60% < default 0.8 — not flagged
    expect(findLikelyMissedEnrollments(roster, enrolled)).toEqual([]);
  });

  test('9/10 enrolled, 1 missing — flagged at default threshold', () => {
    const roster = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const enrolled = roster.slice(0, 9);
    expect(findLikelyMissedEnrollments(roster, enrolled)).toEqual(['s9']);
  });

  test('low uptake overall — a genuine choice-elective, never flagged', () => {
    const roster = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const enrolled = roster.slice(0, 3); // 30% uptake — real elective choice, not a gap
    expect(findLikelyMissedEnrollments(roster, enrolled)).toEqual([]);
  });

  test('everyone enrolled — nothing to flag', () => {
    const roster = ['s1', 's2'];
    expect(findLikelyMissedEnrollments(roster, ['s1', 's2'])).toEqual([]);
  });

  test('empty roster — nothing to flag', () => {
    expect(findLikelyMissedEnrollments([], [])).toEqual([]);
  });

  test('custom minCoverage threshold is honored', () => {
    const roster = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const enrolled = roster.slice(0, 7); // 70% coverage
    expect(findLikelyMissedEnrollments(roster, enrolled, 0.8)).toEqual([]); // below 0.8 — not flagged
    expect(findLikelyMissedEnrollments(roster, enrolled, 0.6)).toEqual(['s7', 's8', 's9']); // above 0.6 — flagged
  });
});
