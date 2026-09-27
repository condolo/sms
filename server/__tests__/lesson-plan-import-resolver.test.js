'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveTopicSubtopic,
  getTopicAndSubtopic,
  resolveLessonDate,
  matchByName,
  resolveStreamFromAssignments,
} = require('../utils/lesson-plan-import-resolver');
const { extractDocxRows, extractLessonBlocks } = require('../utils/lesson-plan-docx-parser');

// Real Trinitas Term 1 2026-2027 span (verified live against the DB during
// Phase 1) — used as-is rather than an invented span, since this feature's
// whole point is not designing against assumptions.
const TERM_1_2026 = { id: 't1_sch_trinitas-tis_mrrikecu_2026', startDate: '2026-09-02', endDate: '2026-12-11' };

describe('resolveTopicSubtopic', () => {
  test('splits on an em-dash, as used throughout the real sample document', () => {
    expect(resolveTopicSubtopic('Unit 1: Adventure — Adventure Fiction Conventions')).toEqual({
      topicTitle: 'Unit 1: Adventure', subtopicTitle: 'Adventure Fiction Conventions',
    });
  });

  test('also splits on a plain hyphen or en-dash, not just em-dash', () => {
    expect(resolveTopicSubtopic('Unit 1: Adventure - Grammar: Active vs. Passive Voice')).toEqual({
      topicTitle: 'Unit 1: Adventure', subtopicTitle: 'Grammar: Active vs. Passive Voice',
    });
  });

  test('no separator: whole string becomes the topic, subtopic stays empty (never fails)', () => {
    expect(resolveTopicSubtopic('Fractions')).toEqual({ topicTitle: 'Fractions', subtopicTitle: '' });
  });

  test('blank input never throws', () => {
    expect(resolveTopicSubtopic('')).toEqual({ topicTitle: '', subtopicTitle: '' });
    expect(resolveTopicSubtopic(undefined)).toEqual({ topicTitle: '', subtopicTitle: '' });
  });
});

describe('resolveLessonDate — against the real Term 1 2026-2027 span', () => {
  test('"3 SEPTEMBER 2026" — explicit year, inside the term', () => {
    expect(resolveLessonDate('3 SEPTEMBER 2026', TERM_1_2026)).toEqual({ date: '2026-09-03' });
  });

  test('"4 SEPTEMBER 2026" — explicit year, inside the term', () => {
    expect(resolveLessonDate('4 SEPTEMBER 2026', TERM_1_2026)).toEqual({ date: '2026-09-04' });
  });

  test('"FROM: 2ND SEPTEMBER" — strips noise prefix + ordinal suffix, no year given, infers from term', () => {
    expect(resolveLessonDate('FROM: 2ND SEPTEMBER', TERM_1_2026)).toEqual({ date: '2026-09-02' });
  });

  test('real edge case: "1ST SEPTEMBER" falls ONE DAY BEFORE the real term start — flagged, not silently forced in', () => {
    const result = resolveLessonDate('1ST SEPTEMBER', TERM_1_2026);
    expect(result.error).toMatch(/does not fall within the selected term/);
  });

  test('a date late in the term correctly picks the term-end year, not term-start year', () => {
    expect(resolveLessonDate('10 DECEMBER', TERM_1_2026)).toEqual({ date: '2026-12-10' });
  });

  test('unparseable text is reported, never guessed', () => {
    expect(resolveLessonDate('sometime next week', TERM_1_2026).error).toMatch(/Could not parse/);
  });

  test('a real calendar date that is just outside the term is reported, not clamped', () => {
    expect(resolveLessonDate('25 DECEMBER 2026', TERM_1_2026).error).toMatch(/does not fall within/);
  });
});

describe('matchByName', () => {
  const classes = [
    { id: 'c1', name: 'Year 6' },
    { id: 'c2', name: 'Year 7' },
    { id: 'c3', name: 'Year 8' },
  ];

  test('exact case-insensitive match', () => {
    expect(matchByName('YEAR 7', classes)).toEqual({ id: 'c2', name: 'Year 7' });
    expect(matchByName('year 7', classes)).toEqual({ id: 'c2', name: 'Year 7' });
  });

  test('no match returns null, never a fuzzy guess', () => {
    expect(matchByName('Year 9', classes)).toBeNull();
  });

  test('blank input returns null', () => {
    expect(matchByName('', classes)).toBeNull();
  });
});

describe('resolveStreamFromAssignments — mirrors the real Robert Mukhwana / English / Year 7 case', () => {
  // Shape matches real teaching_assignments docs queried live during Phase 1.
  const assignments = [
    { classId: 'year4', subjectId: 'english', streamId: 'diamond', streamName: 'Diamond' },
    { classId: 'year6', subjectId: 'english', streamId: 'sapphire', streamName: 'Sapphire' },
    { classId: 'year7', subjectId: 'english', streamId: 'a', streamName: 'A' },
    { classId: 'year7', subjectId: 'globalperspective', streamId: 'a', streamName: 'A' },
  ];

  test('exactly one matching stream resolves unambiguously', () => {
    expect(resolveStreamFromAssignments(assignments, 'year7', 'english')).toEqual({ streamId: 'a', streamName: 'A' });
  });

  test('no matching assignment returns null', () => {
    expect(resolveStreamFromAssignments(assignments, 'year3', 'english')).toBeNull();
  });

  test('more than one stream for the same class+subject is ambiguous — returns null, never guesses', () => {
    const multi = [
      ...assignments,
      { classId: 'year7', subjectId: 'english', streamId: 'b', streamName: 'B' },
    ];
    expect(resolveStreamFromAssignments(multi, 'year7', 'english')).toBeNull();
  });
});

describe('end-to-end: real docx blocks -> resolver, against the real Term 1 2026-2027 span', () => {
  test('3 of 4 real lessons resolve cleanly; lesson 1 is correctly flagged, not force-fit', async () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'lesson-plan-import', 'sample-filled-english-y7.docx'));
    const rows = await extractDocxRows(fixture);
    const { blocks } = extractLessonBlocks(rows);
    expect(blocks).toHaveLength(4);

    const resolved = blocks.map(b => ({
      ...resolveTopicSubtopic(b.topicSubtopicRaw),
      ...resolveLessonDate(b.dateRaw, TERM_1_2026),
    }));

    expect(resolved[0].error).toMatch(/does not fall within the selected term/); // "1ST SEPTEMBER"
    expect(resolved[1]).toEqual(expect.objectContaining({ date: '2026-09-02', topicTitle: 'Unit 1: Adventure' }));
    expect(resolved[2]).toEqual(expect.objectContaining({ date: '2026-09-03' }));
    expect(resolved[3]).toEqual(expect.objectContaining({ date: '2026-09-04' }));

    // Every lesson still gets a usable topic/subtopic split even though
    // none of them exist in syllabus_topics — the whole point of B.4.
    resolved.forEach(r => expect(r.topicTitle).toBe('Unit 1: Adventure'));
    expect(resolved.map(r => r.subtopicTitle)).toEqual([
      'Adventure Fiction Conventions',
      'Characterization Descriptors',
      'Narrative Pacing & Suspense',
      'Grammar: Active vs. Passive Voice',
    ]);
  });
});

describe('getTopicAndSubtopic — format-agnostic entry point used by the route layer', () => {
  test('docx-style block (combined cell): falls back to splitting topicSubtopicRaw', () => {
    expect(getTopicAndSubtopic({ topicSubtopicRaw: 'Unit 1: Adventure — Conventions' })).toEqual({
      topicTitle: 'Unit 1: Adventure', subtopicTitle: 'Conventions',
    });
  });

  test('CSV-style block (separate columns): those are authoritative, never re-split', () => {
    expect(getTopicAndSubtopic({ topicRaw: 'Unit 1: Adventure - Part A', subtopicRaw: 'Conventions' })).toEqual({
      topicTitle: 'Unit 1: Adventure - Part A', subtopicTitle: 'Conventions',
    });
  });
});
