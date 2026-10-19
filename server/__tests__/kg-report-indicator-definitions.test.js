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
