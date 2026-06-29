/* ============================================================
   Unit tests — server/utils/ranking.js

   Covers: rankStudents, computeRankingScore, mergeRankings,
           bestPerSubject

   Run: npm test
   ============================================================ */
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('../utils/ranking');

/* ══════════════════════════════════════════════════════════════
   rankStudents
   ══════════════════════════════════════════════════════════════ */
describe('rankStudents', () => {
  // ── Empty input ───────────────────────────────────────────────
  test('returns [] for empty array', () => {
    expect(rankStudents([])).toEqual([]);
    expect(rankStudents(null)).toEqual([]);
  });

  // ── Single student ────────────────────────────────────────────
  test('single student gets rank 1, outOf 1', () => {
    const result = rankStudents([{ studentId: 's1', totalScore: 75 }]);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
    expect(result[0].outOf).toBe(1);
  });

  // ── Standard ranking: 1, 2, 2, 4 ─────────────────────────────
  test('standard ranking: ties get same rank, next rank skips (1,2,2,4)', () => {
    const students = [
      { studentId: 's1', totalScore: 90 },
      { studentId: 's2', totalScore: 80 },
      { studentId: 's3', totalScore: 80 },
      { studentId: 's4', totalScore: 70 },
    ];
    const result = rankStudents(students, 'standard');
    const ranks  = Object.fromEntries(result.map(r => [r.studentId, r.rank]));
    expect(ranks.s1).toBe(1);
    expect(ranks.s2).toBe(2);
    expect(ranks.s3).toBe(2);
    expect(ranks.s4).toBe(4);  // skip 3 — standard competition ranking
  });

  // ── Dense ranking: 1, 2, 2, 3 ────────────────────────────────
  test('dense ranking: ties get same rank, no gap (1,2,2,3)', () => {
    const students = [
      { studentId: 's1', totalScore: 90 },
      { studentId: 's2', totalScore: 80 },
      { studentId: 's3', totalScore: 80 },
      { studentId: 's4', totalScore: 70 },
    ];
    const result = rankStudents(students, 'dense');
    const ranks  = Object.fromEntries(result.map(r => [r.studentId, r.rank]));
    expect(ranks.s1).toBe(1);
    expect(ranks.s2).toBe(2);
    expect(ranks.s3).toBe(2);
    expect(ranks.s4).toBe(3);  // no gap — dense ranking
  });

  // ── All tied ─────────────────────────────────────────────────
  test('all students tied — standard: all rank 1', () => {
    const students = [
      { studentId: 's1', totalScore: 80 },
      { studentId: 's2', totalScore: 80 },
      { studentId: 's3', totalScore: 80 },
    ];
    const result = rankStudents(students, 'standard');
    result.forEach(r => {
      expect(r.rank).toBe(1);
      expect(r.outOf).toBe(3);
    });
  });

  test('all students tied — dense: all rank 1', () => {
    const students = [
      { studentId: 's1', totalScore: 80 },
      { studentId: 's2', totalScore: 80 },
    ];
    const result = rankStudents(students, 'dense');
    result.forEach(r => expect(r.rank).toBe(1));
  });

  // ── Sorted output is descending by score ─────────────────────
  test('results are sorted descending by totalScore', () => {
    const students = [
      { studentId: 's3', totalScore: 55 },
      { studentId: 's1', totalScore: 90 },
      { studentId: 's2', totalScore: 72 },
    ];
    const result = rankStudents(students);
    expect(result[0].totalScore).toBeGreaterThanOrEqual(result[1].totalScore);
    expect(result[1].totalScore).toBeGreaterThanOrEqual(result[2].totalScore);
  });

  // ── outOf is always the full cohort size ─────────────────────
  test('outOf equals number of students', () => {
    const students = [
      { studentId: 's1', totalScore: 90 },
      { studentId: 's2', totalScore: 80 },
      { studentId: 's3', totalScore: 70 },
    ];
    const result = rankStudents(students);
    result.forEach(r => expect(r.outOf).toBe(3));
  });

  // ── Multiple ties in a row ────────────────────────────────────
  test('standard: two consecutive tied groups — 1,1,3,3,5', () => {
    const students = [
      { studentId: 's1', totalScore: 90 },
      { studentId: 's2', totalScore: 90 },
      { studentId: 's3', totalScore: 80 },
      { studentId: 's4', totalScore: 80 },
      { studentId: 's5', totalScore: 70 },
    ];
    const result = rankStudents(students, 'standard');
    const ranks  = Object.fromEntries(result.map(r => [r.studentId, r.rank]));
    expect(ranks.s1).toBe(1);
    expect(ranks.s2).toBe(1);
    expect(ranks.s3).toBe(3);
    expect(ranks.s4).toBe(3);
    expect(ranks.s5).toBe(5);
  });
});

/* ══════════════════════════════════════════════════════════════
   computeRankingScore
   ══════════════════════════════════════════════════════════════ */
describe('computeRankingScore', () => {
  const subjects = {
    math:    { finalScore: 90 },
    english: { finalScore: 70 },
    science: { finalScore: 80 },
    history: { finalScore: 60 },
    art:     { finalScore: 50 },
  };

  // ── 'all' strategy ────────────────────────────────────────────
  test("strategy 'all': averages all subjects", () => {
    const { rankingScore, subjectsUsed } = computeRankingScore(subjects, 'all');
    // (90+70+80+60+50)/5 = 70
    expect(rankingScore).toBe(70);
    expect(subjectsUsed).toHaveLength(5);
  });

  // ── 'best_n' strategy ─────────────────────────────────────────
  test("strategy 'best_n' n=3: takes top 3 scores", () => {
    const { rankingScore, subjectsUsed } = computeRankingScore(subjects, 'best_n', 3);
    // Best 3: 90, 80, 70 → avg = 80
    expect(rankingScore).toBe(80);
    expect(subjectsUsed).toHaveLength(3);
    expect(subjectsUsed.sort()).toEqual(['english', 'math', 'science'].sort());
  });

  test("strategy 'best_n' where n >= total subjects: uses all", () => {
    const { rankingScore, subjectsUsed } = computeRankingScore(subjects, 'best_n', 10);
    expect(subjectsUsed).toHaveLength(5);
  });

  // ── 'compulsory_only' strategy ────────────────────────────────
  test("strategy 'compulsory_only': filters to specified subjects", () => {
    const { rankingScore, subjectsUsed } = computeRankingScore(
      subjects, 'compulsory_only', 7, ['math', 'english']
    );
    // (90+70)/2 = 80
    expect(rankingScore).toBe(80);
    expect(subjectsUsed.sort()).toEqual(['english', 'math'].sort());
  });

  test("strategy 'compulsory_only' with empty compulsorySubjects falls through to 'all'", () => {
    // Spec: if compulsorySubjects is empty, behaves like 'all'
    const { subjectsUsed } = computeRankingScore(subjects, 'compulsory_only', 7, []);
    expect(subjectsUsed).toHaveLength(5);
  });

  // ── Null finalScore skipped ───────────────────────────────────
  test('subjects with null finalScore are excluded', () => {
    const mixed = {
      math:    { finalScore: 80 },
      english: { finalScore: null },
      science: { finalScore: 60 },
    };
    const { rankingScore, subjectsUsed } = computeRankingScore(mixed, 'all');
    // (80+60)/2 = 70
    expect(rankingScore).toBe(70);
    expect(subjectsUsed).toHaveLength(2);
  });

  // ── Empty subjects ────────────────────────────────────────────
  test('empty subjects returns rankingScore 0 and empty subjectsUsed', () => {
    const { rankingScore, subjectsUsed } = computeRankingScore({});
    expect(rankingScore).toBe(0);
    expect(subjectsUsed).toHaveLength(0);
  });

  test('null subjects returns rankingScore 0', () => {
    const { rankingScore } = computeRankingScore(null);
    expect(rankingScore).toBe(0);
  });

  // ── KCSE best-7-of-8 real-world scenario ─────────────────────
  test("KCSE 'best_n' n=7: student with 8 subjects, lowest dropped", () => {
    const kcse = {
      math:      { finalScore: 70 },
      english:   { finalScore: 65 },
      kiswahili: { finalScore: 72 },
      biology:   { finalScore: 68 },
      chemistry: { finalScore: 75 },
      physics:   { finalScore: 80 },
      history:   { finalScore: 60 },
      cre:       { finalScore: 30 },   // lowest — should be dropped
    };
    const { rankingScore, subjectsUsed } = computeRankingScore(kcse, 'best_n', 7);
    expect(subjectsUsed).toHaveLength(7);
    expect(subjectsUsed).not.toContain('cre');   // 30 is lowest, should be excluded
    // Best 7: 80,75,72,70,68,65,60 → avg = 490/7 = 70
    expect(rankingScore).toBe(70);
  });
});

/* ══════════════════════════════════════════════════════════════
   mergeRankings
   ══════════════════════════════════════════════════════════════ */
describe('mergeRankings', () => {
  const classRanks = [
    { studentId: 's1', rank: 1, outOf: 30, totalScore: 85 },
    { studentId: 's2', rank: 2, outOf: 30, totalScore: 75 },
    { studentId: 's3', rank: 3, outOf: 30, totalScore: 65 },
  ];
  const overallRanks = [
    { studentId: 's1', rank: 5, outOf: 200, totalScore: 85 },
    { studentId: 's2', rank: 10, outOf: 200, totalScore: 75 },
  ];

  test('extracts rank and outOf for each scope', () => {
    const merged = mergeRankings('s1', { class: classRanks, overall: overallRanks });
    expect(merged.class).toEqual({ rank: 1, outOf: 30 });
    expect(merged.overall).toEqual({ rank: 5, outOf: 200 });
  });

  test('omits scope if student not found in that scope', () => {
    const merged = mergeRankings('s3', { class: classRanks, overall: overallRanks });
    expect(merged.class).toEqual({ rank: 3, outOf: 30 });
    expect(merged.overall).toBeUndefined();  // s3 not in overallRanks
  });

  test('returns empty object if student not in any scope', () => {
    const merged = mergeRankings('unknown', { class: classRanks });
    expect(merged).toEqual({});
  });
});

/* ══════════════════════════════════════════════════════════════
   bestPerSubject
   ══════════════════════════════════════════════════════════════ */
describe('bestPerSubject', () => {
  test('returns correct winner per subject', () => {
    const reports = [
      { studentId: 's1', subjects: { math: { finalScore: 90 }, english: { finalScore: 70 } } },
      { studentId: 's2', subjects: { math: { finalScore: 80 }, english: { finalScore: 95 } } },
    ];
    const best = bestPerSubject(reports);
    expect(best.math).toBe('s1');
    expect(best.english).toBe('s2');
  });

  test('skips null finalScore', () => {
    const reports = [
      { studentId: 's1', subjects: { math: { finalScore: null } } },
      { studentId: 's2', subjects: { math: { finalScore: 75 } } },
    ];
    const best = bestPerSubject(reports);
    expect(best.math).toBe('s2');
  });

  test('empty input returns empty object', () => {
    expect(bestPerSubject([])).toEqual({});
  });

  test('one student per subject — that student wins', () => {
    const reports = [
      { studentId: 's1', subjects: { art: { finalScore: 55 } } },
    ];
    const best = bestPerSubject(reports);
    expect(best.art).toBe('s1');
  });
});
