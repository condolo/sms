/* ============================================================
   server/utils/kg-report.js — computeKgReport now reads indicator
   TEXT from indicator_definitions, not the template (2026-10-19).

   This is the actual report-card computation path (not just the
   Markbook's own display) — missing this fix would mean every
   published KG report card goes back to showing zero indicator rows
   per subject the moment rc_templates stops carrying indicator
   content, since computeKgReport used to read subj.indicators
   straight off the template.
   ============================================================ */
'use strict';

let mockIndicatorMarks = [];
let mockIndicatorDefinitions = [];
let mockTemplate = null;

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'indicator_marks') {
      return { find: (filter) => ({ lean: () => Promise.resolve(mockIndicatorMarks.filter(m => m.subjectId === filter.subjectId || !filter.subjectId)) }) };
    }
    if (col === 'indicator_definitions') {
      return { find: () => ({ lean: () => Promise.resolve(mockIndicatorDefinitions) }) };
    }
    throw new Error(`unexpected tenantModel('${col}') call in this test`);
  }),
}));

jest.mock('../utils/rc-template-scale', () => ({
  // Pure helpers — use the real implementations (no DB access), only
  // resolveRcTemplate (which does hit tenantModel) is mocked.
  ...jest.requireActual('../utils/rc-template-scale'),
  resolveRcTemplate: jest.fn(() => Promise.resolve(mockTemplate)),
}));

const { computeKgReport } = require('../utils/kg-report');

beforeEach(() => {
  mockTemplate = {
    id: 'tmplA', name: 'KG', display: {},
    performanceBands: [{ id: 'bandGood', label: 'Good', grade: 'B', color: 'blue' }],
    subjects: [{ subjectId: 'subj_sci', name: 'Science' }],
  };
  mockIndicatorMarks = [];
  mockIndicatorDefinitions = [];
});

describe('computeKgReport', () => {
  test('resolves indicators from indicator_definitions, not template.subjects[].indicators', async () => {
    mockIndicatorDefinitions = [
      { id: 'ind1', subjectId: 'subj_sci', text: 'Able to name colours', maxScore: 10, order: 0 },
    ];
    mockIndicatorMarks = [
      { subjectId: 'subj_sci', indicatorId: 'ind1', bandId: 'bandGood', score: 8 },
    ];

    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);

    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0].indicators).toEqual([
      expect.objectContaining({ indicatorId: 'ind1', text: 'Able to name colours', maxScore: 10, score: 8, bandLabel: 'Good', bandGrade: 'B' }),
    ]);
    expect(result.subjects[0].earned).toBe(8);
    expect(result.subjects[0].possible).toBe(10);
  });

  test('a template subject with zero indicator_definitions yet shows an empty indicator list, not an error', async () => {
    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    expect(result.subjects[0].indicators).toEqual([]);
    expect(result.subjects[0].possible).toBe(0);
  });

  test('returns null when the class has no resolved template', async () => {
    mockTemplate = null;
    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    expect(result).toBeNull();
  });
});

describe('computeKgReport — band-only scoring (2026-10-23)', () => {
  const BANDS = [
    { id: 'bandEmerging',   label: 'Emerging',   defaultScore: 3, grade: 'C' },
    { id: 'bandDeveloping', label: 'Developing', defaultScore: 6, grade: 'B' },
    { id: 'bandSecure',     label: 'Secure',      defaultScore: 9, grade: 'A' },
  ];

  beforeEach(() => {
    mockTemplate = {
      id: 'tmplA', name: 'KG', display: {},
      performanceBands: BANDS,
      bandOnlyScoring: true, // template default — every subject below inherits it
      subjects: [{ subjectId: 'subj_sci', name: 'Science' }],
    };
  });

  test("the band's own scale point is shown (2026-10-26, reported directly) — score is the picked band's defaultScore, maxScore is the band scale's own ceiling", async () => {
    mockIndicatorDefinitions = [{ id: 'ind1', subjectId: 'subj_sci', text: 'Names colours', maxScore: 10, order: 0 }];
    mockIndicatorMarks = [{ subjectId: 'subj_sci', indicatorId: 'ind1', bandId: 'bandSecure', score: 9 }];

    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    const ind = result.subjects[0].indicators[0];
    expect(ind.score).toBe(9);
    expect(ind.maxScore).toBe(9); // ceiling = max(BANDS.defaultScore) = Secure's own 9
    expect(ind.bandLabel).toBe('Secure');
    expect(ind.bandGrade).toBe('A');
  });

  test("a lower band shows its own lower point against the same ceiling, e.g. Emerging(3)/9", async () => {
    mockIndicatorDefinitions = [{ id: 'ind1', subjectId: 'subj_sci', text: 'Names colours', maxScore: 10, order: 0 }];
    mockIndicatorMarks = [{ subjectId: 'subj_sci', indicatorId: 'ind1', bandId: 'bandEmerging', score: 3 }];

    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    const ind = result.subjects[0].indicators[0];
    expect(ind.score).toBe(3);
    expect(ind.maxScore).toBe(9);
    expect(ind.bandLabel).toBe('Emerging');
  });

  test('subject grade is the SNAPPED band nearest the average of the picked bands\' points, not a numeric-scale lookup', async () => {
    mockIndicatorDefinitions = [
      { id: 'ind1', subjectId: 'subj_sci', text: 'A', maxScore: 10, order: 0 },
      { id: 'ind2', subjectId: 'subj_sci', text: 'B', maxScore: 10, order: 1 },
      { id: 'ind3', subjectId: 'subj_sci', text: 'C', maxScore: 10, order: 2 },
    ];
    // Secure(9), Secure(9), Emerging(3) -> average 7 -> closer to Developing(6) than Secure(9)
    mockIndicatorMarks = [
      { subjectId: 'subj_sci', indicatorId: 'ind1', bandId: 'bandSecure', score: 9 },
      { subjectId: 'subj_sci', indicatorId: 'ind2', bandId: 'bandSecure', score: 9 },
      { subjectId: 'subj_sci', indicatorId: 'ind3', bandId: 'bandEmerging', score: 3 },
    ];

    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    const subj = result.subjects[0];
    expect(subj.bandOnly).toBe(true);
    expect(subj.subjectBandLabel).toBe('Developing');
    expect(subj.subjectGrade).toBe('B');
    // Never touches resolveGrade/grade_boundaries for a band-only subject —
    // implicitly proven by `scale` being passed as null throughout this
    // test file and the grade still resolving correctly above.
  });

  test('overall grade follows the TEMPLATE\'s own default, independent of a subject\'s override', async () => {
    // This subject overrides OFF — numeric entry for Science specifically —
    // while the template itself stays band-only by default.
    mockTemplate.subjects = [{ subjectId: 'subj_sci', name: 'Science', bandOnlyScoring: false }];
    mockIndicatorDefinitions = [{ id: 'ind1', subjectId: 'subj_sci', text: 'A', maxScore: 10, order: 0 }];
    mockIndicatorMarks = [{ subjectId: 'subj_sci', indicatorId: 'ind1', score: 7 }]; // no bandId — numeric entry

    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    expect(result.subjects[0].bandOnly).toBe(false);
    // scale is null in this test harness, so a non-band-only subject's
    // grade can't resolve — but the OVERALL figure must still attempt the
    // template's own band-only path (it doesn't need `scale` at all).
    expect(result.overallBandOnly).toBe(true);
    // 7 points out of a possible 10 (numeric ceiling) -> 70% -> on the
    // template's OWN band scale (max 9) that's 6.3 points -> snaps to
    // Developing(6), not Secure(9).
    expect(result.overallBandLabel).toBe('Developing');
  });

  test('a subject that is NOT band-only keeps earning/possible from the numeric score/maxScore, unaffected by the template default', async () => {
    mockTemplate.subjects = [{ subjectId: 'subj_sci', name: 'Science', bandOnlyScoring: false }];
    mockIndicatorDefinitions = [{ id: 'ind1', subjectId: 'subj_sci', text: 'A', maxScore: 20, order: 0 }];
    mockIndicatorMarks = [{ subjectId: 'subj_sci', indicatorId: 'ind1', score: 15 }];

    const result = await computeKgReport({}, 'sch_1', 'cls_1', 'stu_1', 2, null, null);
    const subj = result.subjects[0];
    expect(subj.bandOnly).toBe(false);
    expect(subj.earned).toBe(15);
    expect(subj.possible).toBe(20); // the indicator's own maxScore, not a band ceiling
    expect(subj.indicators[0].score).toBe(15);
    expect(subj.indicators[0].maxScore).toBe(20);
  });
});
