/* ============================================================
   lesson-plan-docx-parser — extraction correctness against two REAL
   Trinitas documents (not synthetic fixtures):

     sample-filled-english-y7.docx — a real completed Week 1 (4 lessons,
       English, Year 7, Robert Mukhwana), provided during Phase 1 analysis
       of the lesson-plan import feature. Packs each lesson as its OWN
       <w:tbl>.

     blank-template.docx — the actual school-wide "Trinitas Template",
       unfilled. Packs TWO lesson blocks stacked as row-groups inside ONE
       <w:tbl> — the opposite packing from the filled sample — which is
       exactly why block detection is content-driven (a "TEACHER" row),
       not "one table = one lesson".

   These are real school documents (see docs/DEVELOPER_GUIDE.md's Lesson
   Plan Import section) kept as golden fixtures precisely because real
   Word output has quirks (a duplicated CLASS cell, truncated text, mixed
   date formats) synthetic fixtures wouldn't reproduce.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { extractDocxRows, extractLessonBlocks } = require('../utils/lesson-plan-docx-parser');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'lesson-plan-import');
const FILLED = () => fs.readFileSync(path.join(FIXTURE_DIR, 'sample-filled-english-y7.docx'));
const BLANK  = () => fs.readFileSync(path.join(FIXTURE_DIR, 'blank-template.docx'));

describe('extractDocxRows — real .docx → flattened table rows', () => {
  test('reads the filled sample without throwing and finds table rows', async () => {
    const rows = await extractDocxRows(FILLED());
    expect(rows.length).toBeGreaterThan(0);
  });

  test('rejects a buffer that is not a valid docx', async () => {
    await expect(extractDocxRows(Buffer.from('not a zip'))).rejects.toThrow();
  });
});

describe('extractLessonBlocks — filled real document (4 lessons, one <w:tbl> each)', () => {
  let blocks, warnings;
  beforeAll(async () => {
    const rows = await extractDocxRows(FILLED());
    ({ blocks, warnings } = extractLessonBlocks(rows));
  });

  test('detects exactly 4 lesson blocks', () => {
    expect(warnings).toEqual([]);
    expect(blocks).toHaveLength(4);
  });

  test('lesson 1: meta fields resolve from the label/value rows', () => {
    const b = blocks[0];
    expect(b.subjectRaw).toBe('ENGLISH');
    expect(b.classRaw).toBe('YEAR 7');
    expect(b.termYearRaw).toBe('1 2026 2027');
    expect(b.dateRaw).toBe('1ST SEPTEMBER');
    expect(b.teacherRaw).toBe('Mr Robert');
  });

  test('lesson 2-4: teacher cell is the fuller (but still truncated) "Mr Robert M"', () => {
    expect(blocks[1].teacherRaw).toBe('Mr Robert M');
    expect(blocks[2].teacherRaw).toBe('Mr Robert M');
    expect(blocks[3].teacherRaw).toBe('Mr Robert M');
  });

  test('lesson 1: content columns map correctly by header keyword, not fixed position', () => {
    const b = blocks[0];
    expect(b.topicSubtopicRaw).toContain('Unit 1: Adventure');
    expect(b.topicSubtopicRaw).toContain('Adventure Fiction Conventions');
    expect(b.objectivesRaw).toContain('Identify 3 core themes of adventure fiction');
    expect(b.activitiesRaw).toContain('Brainstorm core elements of adventure fiction');
    expect(b.resourcesRaw).toContain("Learner's Book Unit 1");
  });

  test('lesson 1: differentiation/assessment/homework extracted from their labeled rows', () => {
    const b = blocks[0];
    expect(b.differentiation.low).toContain('graphic organizer');
    expect(b.assessmentRaw).toContain('word choices');
    expect(b.homeworkRaw).toContain('Observation of pair brainstorming');
  });

  test('every block has a distinct topic (4 different lessons, not the same block repeated)', () => {
    const topics = blocks.map(b => b.topicSubtopicRaw);
    expect(new Set(topics).size).toBe(4);
  });

  test('dates are captured verbatim (inconsistent formatting is left to the resolver, not silently fixed here)', () => {
    expect(blocks.map(b => b.dateRaw)).toEqual([
      '1ST SEPTEMBER',
      'FROM: 2ND SEPTEMBER',
      '3 SEPTEMBER 2026',
      '4 SEPTEMBER 2026',
    ]);
  });
});

describe('extractLessonBlocks — blank school template (2 blocks packed in ONE <w:tbl>)', () => {
  test('still detects 2 lesson blocks by content, not table count', async () => {
    const rows = await extractDocxRows(BLANK());
    const { blocks, warnings } = extractLessonBlocks(rows);
    expect(blocks).toHaveLength(2);
    // Every field is blank in the unfilled template — proves detection
    // doesn't depend on there being real content in the row, only on the
    // "TEACHER" label appearing in cell 0.
    blocks.forEach(b => {
      expect(b.subjectRaw).toBe('');
      expect(b.teacherRaw).toBe('');
    });
    expect(warnings).toEqual([]);
  });

  test('the canonical template has only ONE CLASS field (row 2, with DATE) — not the duplicate seen in the filled sample', async () => {
    const rows = await extractDocxRows(BLANK());
    // Row 0 of the real template: TEACHER | WEEK | TERM & YEAR only — no CLASS.
    const teacherRowIdx = rows.findIndex(r => (r[0] || '').trim().toUpperCase() === 'TEACHER');
    expect(rows[teacherRowIdx].map(c => c.trim())).toEqual(['TEACHER', '', 'WEEK', '', 'TERM & YEAR', '']);
    expect(rows[teacherRowIdx + 1].map(c => c.trim())).toEqual(['SUBJECT', '', 'DATE', '', 'CLASS', '']);
  });
});

describe('extractLessonBlocks — defensive behavior', () => {
  test('empty input produces no blocks and a warning, never throws', () => {
    const { blocks, warnings } = extractLessonBlocks([]);
    expect(blocks).toEqual([]);
    expect(warnings).toEqual(['No lesson blocks found — no row starting with "TEACHER" was detected.']);
  });

  test('a TEACHER row with no "Lesson" column-header row underneath is reported, not thrown', () => {
    const { blocks, warnings } = extractLessonBlocks([['TEACHER', 'X', 'WEEK', '1']]);
    expect(blocks).toHaveLength(1);
    expect(warnings[0]).toMatch(/no data row found/);
  });
});

describe('extractDocxRows — decompression-bomb guard (security review, 2026-09)', () => {
  test('rejects a document.xml whose declared uncompressed size is absurd, before fully decompressing it', async () => {
    const JSZip = require('jszip');
    const zip = new JSZip();
    // Highly repetitive text compresses to a tiny zip while still
    // declaring a huge uncompressed size in the central directory —
    // exactly the shape of a real zip-bomb payload.
    const bomb = '<w:document><w:body>' + 'A'.repeat(60 * 1024 * 1024) + '</w:body></w:document>';
    zip.file('word/document.xml', bomb, { compression: 'DEFLATE' });
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(extractDocxRows(buffer)).rejects.toThrow(/too large to process/);
  });
});
