/* ============================================================
   Unit tests — resolveGrade (from routes/academic-config.js)
   Pure function — no mocks needed.
   ============================================================ */

/* academic-config.js imports _model but never uses it in resolveGrade — mock it */
jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({})),
}));

const { resolveGrade, DEFAULT_GRADING_SCHEMA } = require('../routes/academic-config');

describe('resolveGrade', () => {
  const SCHEMA = DEFAULT_GRADING_SCHEMA;

  // ── Exact boundary — upper limit ──────────────────────────────
  test('score 100 → grade A', () => {
    const result = resolveGrade(100, SCHEMA);
    expect(result.grade).toBe('A');
    expect(result.points).toBe(4.0);
  });

  // ── Exact boundary — lower limit of A ────────────────────────
  test('score 80 → grade A', () => {
    expect(resolveGrade(80, SCHEMA).grade).toBe('A');
  });

  // ── One below A boundary ─────────────────────────────────────
  test('score 79 → grade B+', () => {
    expect(resolveGrade(79, SCHEMA).grade).toBe('B+');
  });

  // ── Minimum pass mark (default passMark is 40 → grade D) ─────
  test('score 40 → grade D', () => {
    const r = resolveGrade(40, SCHEMA);
    expect(r.grade).toBe('D');
  });

  // ── Fail boundary ─────────────────────────────────────────────
  test('score 39 → grade E (fail)', () => {
    expect(resolveGrade(39, SCHEMA).grade).toBe('E');
    expect(resolveGrade(39, SCHEMA).points).toBe(0.0);
  });

  test('score 0 → grade E', () => {
    expect(resolveGrade(0, SCHEMA).grade).toBe('E');
  });

  // ── Score outside all bands ────────────────────────────────────
  test('score above 100 → grade null (not in any band)', () => {
    const r = resolveGrade(105, SCHEMA);
    expect(r.grade).toBeNull();
  });

  // ── Decimal scores ────────────────────────────────────────────
  test('decimal score 72.5 resolves correctly', () => {
    const r = resolveGrade(72.5, SCHEMA);
    expect(r.grade).toBe('B');  // 65–74 → B
  });

  // ── Custom schema ─────────────────────────────────────────────
  test('uses custom schema when provided', () => {
    const custom = [
      { grade: 'Pass', minScore: 50, maxScore: 100, points: 1 },
      { grade: 'Fail', minScore: 0,  maxScore: 49,  points: 0 },
    ];
    expect(resolveGrade(60, custom).grade).toBe('Pass');
    expect(resolveGrade(40, custom).grade).toBe('Fail');
  });

  // ── Falls back to DEFAULT_GRADING_SCHEMA when none provided ──
  test('uses DEFAULT_GRADING_SCHEMA when schema omitted', () => {
    const r = resolveGrade(85);
    expect(r.grade).toBe('A');
  });
});
