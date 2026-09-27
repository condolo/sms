/* ============================================================
   Lesson Plan Import — CSV parsing (2026-09)

   The docx path parses an existing Word document with a fixed layout
   (see lesson-plan-docx-parser.js) because that format already exists and
   had to be reverse-engineered from real files. CSV has no such
   pre-existing document to match — this defines Msingi's own lesson-plan
   CSV shape (one row per lesson), the same way import-export.js already
   defines its own CSV templates for students/teachers/timetable rather
   than reverse-engineering someone else's spreadsheet.

   Reuses the shared quoted-comma-aware parseCSV (utils/csv.js, extracted
   from routes/import-export.js) rather than a second CSV implementation.

   Produces the SAME intermediate block shape lesson-plan-docx-parser.js
   does (topicSubtopicRaw OR pre-split topicRaw/subtopicRaw, dateRaw,
   objectivesRaw, activitiesRaw, resourcesRaw, remarksRaw, differentiation,
   assessmentRaw, homeworkRaw) so the route layer runs both formats
   through the exact same resolver/review/commit pipeline.
   ============================================================ */
'use strict';

const { parseCSV } = require('./csv');

const HEADER_KEYWORDS = [
  { field: 'lessonNumberRaw', test: h => h === 'lesson' || h === 'lesson number' || h === 'lesson no' },
  { field: 'dateRaw', test: h => h === 'date' },
  { field: 'topicRaw', test: h => h === 'topic' },
  { field: 'subtopicRaw', test: h => h === 'subtopic' || h === 'sub-topic' || h === 'sub topic' },
  { field: 'topicSubtopicRaw', test: h => h.includes('topic/subtopic') || h.includes('topic / subtopic') },
  { field: 'objectivesRaw', test: h => h.includes('objective') },
  { field: 'activitiesRaw', test: h => h.includes('activit') },
  { field: 'resourcesRaw', test: h => h.includes('resource') || h.includes('reference') },
  { field: 'remarksRaw', test: h => h.includes('remark') },
  { field: 'diffLow', test: h => h.includes('low') && h.includes('abilit') },
  { field: 'diffMiddle', test: h => (h.includes('middle') || h.includes('medium')) && h.includes('abilit') },
  { field: 'diffHigh', test: h => h.includes('high') && h.includes('abilit') },
  { field: 'assessmentRaw', test: h => h.includes('assessment') },
  { field: 'homeworkRaw', test: h => h.includes('homework') || h.includes('assignment') },
];

function _mapHeader(header) {
  const norm = header.trim().toLowerCase();
  const hit = HEADER_KEYWORDS.find(k => k.test(norm));
  return hit ? hit.field : null;
}

/**
 * @param {string} csvText - raw CSV text, one row per lesson
 * @returns {{blocks: object[], warnings: string[]}}
 */
function extractCsvLessonBlocks(csvText) {
  const { headers, rows, error } = parseCSV(csvText);
  if (error) return { blocks: [], warnings: [error] };

  const fieldByHeader = headers.map(h => _mapHeader(h));
  if (!fieldByHeader.includes('dateRaw')) {
    return { blocks: [], warnings: ['CSV is missing a "Date" column — cannot import without it.'] };
  }

  const warnings = [];
  const blocks = rows.map((row, i) => {
    const block = { sourceRowStart: i + 2, sourceRowEnd: i + 2 }; // +2: 1-indexed, plus the header row
    headers.forEach((h, idx) => {
      const field = fieldByHeader[idx];
      if (!field) return;
      const value = (row[h] || '').trim();
      if (field === 'diffLow' || field === 'diffMiddle' || field === 'diffHigh') {
        block.differentiation = block.differentiation || { low: '', middle: '', high: '' };
        block.differentiation[field === 'diffLow' ? 'low' : field === 'diffMiddle' ? 'middle' : 'high'] = value;
      } else {
        block[field] = value;
      }
    });
    if (!block.dateRaw) warnings.push(`Row ${block.sourceRowStart}: missing a date — this lesson will need one before it can be imported.`);
    return block;
  });

  return { blocks, warnings };
}

module.exports = { extractCsvLessonBlocks };
