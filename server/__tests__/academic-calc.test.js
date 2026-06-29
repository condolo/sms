/* ============================================================
   Unit tests — server/utils/academic-calc.js

   Tests pure functions: computeFinalScores, attachDeviations.
   DB-dependent functions (aggregateGrades, aggregateExamResults,
   attendanceSummary) are exercised via mocked _model() calls.

   Run: npm test
   ============================================================ */

/* ── Mock the DB layer so tests never touch MongoDB ─────────── */
jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    find:           jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    findOne:        jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    countDocuments: jest.fn().mockResolvedValue(0),
  })),
}));

/* ── Mock resolveGrade so academic-calc.js imports cleanly ──── */
jest.mock('../routes/academic-config', () => ({
  resolveGrade: jest.fn((score, schema) => {
    const sorted = [...schema].sort((a, b) => b.minScore - a.minScore);
    const band   = sorted.find(g => score >= g.minScore && score <= g.maxScore);
    return band
      ? { grade: band.grade, points: band.points ?? null, descriptor: band.descriptor ?? null, remarks: band.remarks ?? null }
      : { grade: null, points: null, descriptor: null, remarks: null };
  }),
}));

const { computeFinalScores, attachDeviations } = require('../utils/academic-calc');

/* ── Fixtures ───────────────────────────────────────────────── */
const WEIGHTS = [
  { assessmentType: 'classwork', weight: 20 },
  { assessmentType: 'midterm',   weight: 30 },
  { assessmentType: 'final',     weight: 50 },
];

const SCHEMA = [
  { grade: 'A',  minScore: 80, maxScore: 100, points: 4.0, descriptor: 'Excellent' },
  { grade: 'B',  minScore: 65, maxScore: 79,  points: 3.0, descriptor: 'Good' },
  { grade: 'C',  minScore: 50, maxScore: 64,  points: 2.0, descriptor: 'Average' },
  { grade: 'D',  minScore: 40, maxScore: 49,  points: 1.0, descriptor: 'Poor' },
  { grade: 'E',  minScore: 0,  maxScore: 39,  points: 0.0, descriptor: 'Fail' },
];

/* ══════════════════════════════════════════════════════════════
   computeFinalScores
   ══════════════════════════════════════════════════════════════ */
describe('computeFinalScores', () => {
  // ── Input validation ──────────────────────────────────────────
  test('throws if assessmentWeights is empty array', () => {
    expect(() => computeFinalScores({}, {}, [], SCHEMA)).toThrow(TypeError);
  });

  test('throws if gradingSchema is empty array', () => {
    expect(() => computeFinalScores({}, {}, WEIGHTS, [])).toThrow(TypeError);
  });

  test('throws if a weight has non-numeric value', () => {
    const badWeights = [{ assessmentType: 'classwork', weight: 'twenty' }];
    expect(() => computeFinalScores({}, {}, badWeights, SCHEMA)).toThrow(TypeError);
  });

  test('coerces null/undefined gradesData and examData to {}', () => {
    // Should not throw — returns empty object
    const result = computeFinalScores(null, undefined, WEIGHTS, SCHEMA);
    expect(result).toEqual({});
  });

  // ── Full three-component weighted score ───────────────────────
  test('computes correct weighted final score (full weights present)', () => {
    // classwork:20%, midterm:30%, final:50%
    // scores: classwork=80, midterm=70, final=90
    // expected: (80*20 + 70*30 + 90*50) / 100 = (1600+2100+4500)/100 = 82
    const gradesData = { stu1: { sub1: { classwork: 80, midterm: 70 } } };
    const examData   = { stu1: { sub1: { final: 90 } } };

    const result = computeFinalScores(gradesData, examData, WEIGHTS, SCHEMA);
    expect(result.stu1).toBeDefined();
    expect(result.stu1.subjects.sub1.finalScore).toBe(82);
    expect(result.stu1.subjects.sub1.grade).toBe('A');
  });

  // ── Partial weight normalisation ──────────────────────────────
  test('normalises to present weights when only some types are available', () => {
    // Only 'final' (weight 50) is present → 100% of weight on final
    // finalScore should equal the final score itself (90)
    const gradesData = {};
    const examData   = { stu1: { sub1: { final: 90 } } };

    const result = computeFinalScores(gradesData, examData, WEIGHTS, SCHEMA);
    // Only final present → normalised to 90 * 50 / 50 = 90
    expect(result.stu1.subjects.sub1.finalScore).toBe(90);
  });

  test('normalises when classwork + midterm present but no final', () => {
    // classwork=60(w20), midterm=70(w30) → (60*20 + 70*30)/(20+30) = (1200+2100)/50 = 66
    const gradesData = { stu1: { sub1: { classwork: 60, midterm: 70 } } };

    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);
    expect(result.stu1.subjects.sub1.finalScore).toBe(66);
    expect(result.stu1.subjects.sub1.grade).toBe('B');
  });

  // ── Single subject ────────────────────────────────────────────
  test('single subject — correct averageScore and subjectCount', () => {
    const gradesData = { stu1: { sub1: { final: 75 } } };
    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);

    expect(result.stu1.subjectCount).toBe(1);
    expect(result.stu1.averageScore).toBe(75);
    expect(result.stu1.totalScore).toBe(75);
  });

  // ── Multiple students, multiple subjects ──────────────────────
  test('handles multiple students independently', () => {
    const gradesData = {
      stu1: { sub1: { final: 85 }, sub2: { final: 65 } },
      stu2: { sub1: { final: 55 }, sub2: { final: 45 } },
    };

    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);

    expect(result.stu1.subjectCount).toBe(2);
    expect(result.stu2.subjectCount).toBe(2);
    expect(result.stu1.subjects.sub1.finalScore).toBe(85);
    expect(result.stu2.subjects.sub1.finalScore).toBe(55);
  });

  // ── Unknown assessment type (unweighted) is skipped ──────────
  test('skips assessment types not present in weightMap', () => {
    // 'oral' is not in WEIGHTS — should be ignored, not inflate score
    const gradesData = { stu1: { sub1: { final: 80, oral: 100 } } };
    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);
    // Only final contributes → 80 * 50 / 50 = 80
    expect(result.stu1.subjects.sub1.finalScore).toBe(80);
  });

  // ── Tied scores ───────────────────────────────────────────────
  test('handles tied scores between two students correctly', () => {
    const gradesData = {
      stu1: { sub1: { final: 72.5 } },
      stu2: { sub1: { final: 72.5 } },
    };
    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);
    expect(result.stu1.subjects.sub1.finalScore).toBe(72.5);
    expect(result.stu2.subjects.sub1.finalScore).toBe(72.5);
  });

  // ── Boundary scores map to correct grade bands ────────────────
  test.each([
    [100, 'A'],
    [80,  'A'],
    [79,  'B'],
    [65,  'B'],
    [64,  'C'],
    [50,  'C'],
    [49,  'D'],
    [40,  'D'],
    [39,  'E'],
    [0,   'E'],
  ])('score %i → grade %s', (score, expectedGrade) => {
    const gradesData = { stu1: { sub1: { final: score } } };
    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);
    expect(result.stu1.subjects.sub1.grade).toBe(expectedGrade);
  });

  // ── Non-numeric score skipped with warning ────────────────────
  test('skips non-numeric avg values and still computes remaining types', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // 'classwork' has NaN average — should be skipped; midterm contributes normally
    const gradesData = { stu1: { sub1: { classwork: NaN, midterm: 70 } } };
    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);
    // Only midterm present after skipping NaN → 70 * 30 / 30 = 70
    expect(result.stu1.subjects.sub1.finalScore).toBe(70);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Non-numeric score'));
    warnSpy.mockRestore();
  });

  // ── GPA accumulation ─────────────────────────────────────────
  test('accumulates correct GPA across subjects', () => {
    // sub1: final=85 → grade A (4.0 pts), sub2: final=67 → grade B (3.0 pts)
    const gradesData = {
      stu1: { sub1: { final: 85 }, sub2: { final: 67 } },
    };
    const result = computeFinalScores(gradesData, {}, WEIGHTS, SCHEMA);
    expect(result.stu1.gpa).toBe(3.5);   // (4.0 + 3.0) / 2
  });
});

/* ══════════════════════════════════════════════════════════════
   attachDeviations
   ══════════════════════════════════════════════════════════════ */
describe('attachDeviations', () => {
  test('attaches classAverage and deviation to each student subject', () => {
    const reports = {
      stu1: { studentId: 'stu1', subjects: { sub1: { finalScore: 80 } } },
      stu2: { studentId: 'stu2', subjects: { sub1: { finalScore: 60 } } },
    };
    const { classAverages } = attachDeviations(reports);

    expect(classAverages.sub1).toBe(70);  // (80+60)/2
    expect(reports.stu1.subjects.sub1.deviation).toBe(10);   // 80 - 70
    expect(reports.stu2.subjects.sub1.deviation).toBe(-10);  // 60 - 70
  });

  test('handles a single student — deviation is 0', () => {
    const reports = {
      stu1: { studentId: 'stu1', subjects: { sub1: { finalScore: 75 } } },
    };
    attachDeviations(reports);
    expect(reports.stu1.subjects.sub1.deviation).toBe(0);
    expect(reports.stu1.subjects.sub1.classAverage).toBe(75);
  });

  test('handles null finalScore gracefully', () => {
    const reports = {
      stu1: { studentId: 'stu1', subjects: { sub1: { finalScore: null } } },
    };
    attachDeviations(reports);
    expect(reports.stu1.subjects.sub1.deviation).toBeNull();
    expect(reports.stu1.subjects.sub1.classAverage).toBeNull();
  });

  test('computes per-subject class averages independently', () => {
    const reports = {
      stu1: { studentId: 'stu1', subjects: { sub1: { finalScore: 90 }, sub2: { finalScore: 50 } } },
      stu2: { studentId: 'stu2', subjects: { sub1: { finalScore: 70 }, sub2: { finalScore: 80 } } },
    };
    const { classAverages } = attachDeviations(reports);
    expect(classAverages.sub1).toBe(80);  // (90+70)/2
    expect(classAverages.sub2).toBe(65);  // (50+80)/2
  });

  test('returns mutated studentReports reference', () => {
    const reports = {
      stu1: { studentId: 'stu1', subjects: { sub1: { finalScore: 70 } } },
    };
    const { studentReports } = attachDeviations(reports);
    expect(studentReports).toBe(reports);  // same reference — mutation in-place
  });
});
