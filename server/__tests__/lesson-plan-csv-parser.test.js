'use strict';

const { extractCsvLessonBlocks } = require('../utils/lesson-plan-csv-parser');

describe('extractCsvLessonBlocks', () => {
  test('parses a well-formed CSV with combined Topic/Subtopic column', () => {
    const csv = [
      'Lesson,Date,Topic/Subtopic,Lesson Objectives,Learning Activities,Resources/References,Remarks,Low Ability,Middle Ability,High Ability,Assessment & Evaluation,Homework',
      '1,3 September 2026,Unit 1: Adventure — Conventions,Identify themes,Brainstorm in pairs,Learner Book Unit 1,,Use word bank,,Extend vocabulary,Explain word choices,Write 5 sentences',
    ].join('\n');

    const { blocks, warnings } = extractCsvLessonBlocks(csv);
    expect(warnings).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(expect.objectContaining({
      lessonNumberRaw: '1',
      dateRaw: '3 September 2026',
      topicSubtopicRaw: 'Unit 1: Adventure — Conventions',
      objectivesRaw: 'Identify themes',
      activitiesRaw: 'Brainstorm in pairs',
      resourcesRaw: 'Learner Book Unit 1',
      assessmentRaw: 'Explain word choices',
      homeworkRaw: 'Write 5 sentences',
    }));
    expect(blocks[0].differentiation).toEqual({ low: 'Use word bank', middle: '', high: 'Extend vocabulary' });
  });

  test('parses separate Topic and Subtopic columns instead of a combined cell', () => {
    const csv = [
      'Date,Topic,Subtopic,Objectives',
      '4 September 2026,Unit 1: Adventure,Active vs Passive Voice,Convert sentences',
    ].join('\n');
    const { blocks } = extractCsvLessonBlocks(csv);
    expect(blocks[0].topicRaw).toBe('Unit 1: Adventure');
    expect(blocks[0].subtopicRaw).toBe('Active vs Passive Voice');
  });

  test('header matching is case-insensitive and tolerant of extra wording', () => {
    const csv = [
      'date,LESSON OBJECTIVES,learning activities',
      '1 Sept 2026,Objective text,Activity text',
    ].join('\n');
    const { blocks } = extractCsvLessonBlocks(csv);
    expect(blocks[0]).toEqual(expect.objectContaining({ objectivesRaw: 'Objective text', activitiesRaw: 'Activity text' }));
  });

  test('a quoted field containing a comma is parsed correctly (reuses import-export.js\'s CSV parser)', () => {
    const csv = [
      'Date,Objectives',
      '"3 September 2026","Identify themes, then discuss them"',
    ].join('\n');
    const { blocks } = extractCsvLessonBlocks(csv);
    expect(blocks[0].objectivesRaw).toBe('Identify themes, then discuss them');
  });

  test('missing a Date column entirely is rejected up front with a clear reason', () => {
    const csv = ['Lesson,Objectives', '1,Some objective'].join('\n');
    const { blocks, warnings } = extractCsvLessonBlocks(csv);
    expect(blocks).toEqual([]);
    expect(warnings[0]).toMatch(/missing a "Date" column/);
  });

  test('a row with a blank date is kept but flagged, not silently dropped', () => {
    const csv = ['Date,Objectives', ',Some objective'].join('\n');
    const { blocks, warnings } = extractCsvLessonBlocks(csv);
    expect(blocks).toHaveLength(1);
    expect(warnings[0]).toMatch(/missing a date/);
  });

  test('malformed CSV (no data rows) reports the underlying parseCSV error', () => {
    const { blocks, warnings } = extractCsvLessonBlocks('Date,Objectives');
    expect(blocks).toEqual([]);
    expect(warnings[0]).toMatch(/header row and at least one data row/);
  });
});
