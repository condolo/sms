/* aggregateAssessmentMarks — options.include (v5.271.0): a cycle report
   averages only the assessment instances it covers. */
'use strict';

const { createFakeDb } = require('./fixtures/fake-tenant-db');
let mockDb;
jest.mock('../utils/model', () => ({ _model: (name) => mockDb.model(name) }));

const { aggregateAssessmentMarks } = require('../utils/academic-calc');

const m = (assessmentType, instance, rawScore) => ({
  schoolId: 's', classId: 'c', termNumber: 1, studentId: 'st', subjectId: 'eng',
  assessmentType, ...(instance ? { instance } : {}), rawScore, isPublished: true,
});

beforeEach(() => {
  mockDb = createFakeDb({ assessment_marks: [m('HW', null, 60), m('HW', 2, 90), m('MT', 1, 70), m('ET', 1, 50)] });
});

test('without include, HW 1 and HW 2 are averaged and every type counts (unchanged)', async () => {
  const r = await aggregateAssessmentMarks('s', 'c', 1);
  expect(r.st.eng).toEqual({ HW: 75, MT: 70, ET: 50 });
});

test('a Mid-Term report covering HW 1 and MT ignores HW 2 and ET; a mark with no instance counts as instance 1', async () => {
  const r = await aggregateAssessmentMarks('s', 'c', 1, null, null, { include: new Set(['HW|1', 'MT|1']) });
  expect(r.st.eng).toEqual({ HW: 60, MT: 70 });
});
