/* ============================================================
   Lesson Plan Import — .docx table extraction (2026-09)

   Reads a real, populated Word lesson-plan document and returns the raw
   text found in it, structured into "lesson blocks" — one per lesson the
   teacher wrote. This module does NO entity resolution and NO validation:
   it only answers "what text is in this table, in this shape". Resolving
   TEACHER/CLASS/SUBJECT/TERM text against real records, parsing DATE, and
   deciding what's importable happens one layer up.

   Why not just read <w:tbl> as "one table = one lesson":
   Real Trinitas documents pack lesson blocks two different ways — some
   authors give each lesson its own table, others stack several lesson
   blocks as repeating row-groups inside ONE table (confirmed against both
   the blank school-wide template and a real completed document). So this
   flattens every row across every table in document order and detects a
   new lesson block by content (a row whose first cell is "TEACHER"), not
   by table boundaries.
   ============================================================ */
'use strict';

const JSZip = require('jszip');

const TAG_RE = /<(\/?)([a-zA-Z0-9:]+)((?:\s+[a-zA-Z0-9:_-]+="(?:[^"\\]|\\.)*")*)\s*(\/?)>/g;
const STRUCTURAL = new Set(['w:tbl', 'w:tr', 'w:tc', 'w:p']);

function _decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/* Walks the WordprocessingML tag stream. Structural elements (table/row/
   cell/paragraph) are kept as a tree; property elements ("...Pr") are
   discarded; everything else (runs, hyperlinks, tracked-change wrappers,
   smart tags) is transparent — its children are spliced into the parent —
   so text inside them still surfaces without this needing to know about
   every element Word can wrap a run in. */
function _parseBody(xml) {
  TAG_RE.lastIndex = 0;

  function parseChildren(stopTag) {
    const children = [];
    let m;
    while ((m = TAG_RE.exec(xml)) !== null) {
      const [, closing, name, , selfClose] = m;
      if (closing) {
        if (name === stopTag) return children;
        continue;
      }
      if (name === 'w:t') {
        if (selfClose === '/') { children.push({ type: 'text', text: '' }); continue; }
        const start = TAG_RE.lastIndex;
        const endIdx = xml.indexOf('</w:t>', start);
        children.push({ type: 'text', text: _decode(xml.slice(start, endIdx)) });
        TAG_RE.lastIndex = endIdx + '</w:t>'.length;
        continue;
      }
      if (name === 'w:br' || name === 'w:cr') { children.push({ type: 'break' }); continue; }
      if (name === 'w:tab') { children.push({ type: 'tab' }); continue; }
      if (STRUCTURAL.has(name)) {
        if (selfClose === '/') continue;
        children.push({ type: name, children: parseChildren(name) });
        continue;
      }
      if (selfClose === '/') continue;
      if (/Pr$/.test(name)) { _skipSubtree(name); continue; }
      for (const c of parseChildren(name)) children.push(c);
    }
    return children;
  }

  function _skipSubtree(tagName) {
    let depth = 1;
    let m;
    while (depth > 0 && (m = TAG_RE.exec(xml)) !== null) {
      const [, closing, name, , selfClose] = m;
      if (name !== tagName) continue;
      if (selfClose === '/') continue;
      if (closing) depth--; else depth++;
    }
  }

  const bodyStart = xml.match(/<w:body[^>]*>/);
  if (!bodyStart) return [];
  TAG_RE.lastIndex = bodyStart.index + bodyStart[0].length;
  return parseChildren('w:body');
}

function _textOfParagraph(p) {
  let out = '';
  for (const c of p.children) {
    if (c.type === 'text') out += c.text;
    else if (c.type === 'tab') out += '\t';
    else if (c.type === 'break') out += '\n';
  }
  return out;
}

function _textOfCell(tc) {
  return tc.children.filter(c => c.type === 'w:p').map(_textOfParagraph).join('\n').trim();
}

/* Flattens every table row across the whole document, in order, regardless
   of which <w:tbl> it belongs to — see module comment for why. */
function _flattenRows(bodyChildren) {
  const rows = [];
  for (const el of bodyChildren) {
    if (el.type !== 'w:tbl') continue;
    for (const tr of el.children.filter(c => c.type === 'w:tr')) {
      rows.push(tr.children.filter(c => c.type === 'w:tc').map(_textOfCell));
    }
  }
  return rows;
}

// Security review (2026-09): the 10MB cap on the raw upload
// (express.raw({limit:'10mb'}) in lessons.js) only bounds the COMPRESSED
// size — a specially crafted docx (a "zip bomb") can decompress to many
// times that in memory. JSZip's central-directory metadata exposes the
// declared uncompressed size before the expensive decompression runs, so
// this rejects anything absurd up front. 50MB is generous — the two real
// Trinitas sample documents used to validate this parser were under 4MB
// including embedded logo images. This is defense in depth, not the only
// safeguard: `_data` is a jszip internal, not a stable public API, so if
// a future version removes it this check silently no-ops (`??`) rather
// than breaking ordinary imports — the raw-size cap upstream still holds.
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

async function extractDocxRows(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Not a valid .docx file (missing word/document.xml)');
  const declaredSize = entry._data?.uncompressedSize ?? 0;
  if (declaredSize > MAX_DECOMPRESSED_BYTES) {
    throw new Error(`This document's content is too large to process (${Math.round(declaredSize / 1024 / 1024)}MB uncompressed).`);
  }
  const xml = await entry.async('string');
  return _flattenRows(_parseBody(xml));
}

/* ── Lesson-block detection ──────────────────────────────────────
   A block is: TEACHER/WEEK/TERM&YEAR row, SUBJECT/DATE/CLASS row, a
   "Lesson" column-header row, one data row, a DIFFERENTIATION header row,
   one differentiation data row, an ASSESSMENT row, a HOMEWORK row, and a
   REFLECTION row (always blank on import — filled in after the lesson is
   taught). Detected by each row's own first-cell label rather than a
   fixed row offset, so a stray blank spacer row doesn't misalign it. */

function _norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}
function _cellStartsWith(cell, label) {
  return _norm(cell).toUpperCase().startsWith(label);
}

// Pulls {teacher, week, termYear, subject, date, class} out of the two
// meta rows by label, not fixed position — a school's row 0 sometimes
// carries an extra duplicate CLASS cell (seen in one real document). The
// first occurrence of a label wins; when a later occurrence disagrees with
// it (confirmed against real data: one lesson block's row 0 gave "x" and
// row 1 gave "YEAR" — a genuine authoring error in the source document,
// not a harmless repeat), that's surfaced as a warning rather than
// silently discarded, so the operator has a concrete reason for a
// downstream "class could not be resolved" error instead of no clue at
// all.
function _parseMetaRows(row0, row1) {
  const meta = {};
  const warnings = [];
  const FIELD_BY_LABEL = { CLASS: 'classRaw' };
  const pairs = (row) => {
    for (let i = 0; i + 1 < row.length; i += 2) {
      const label = _norm(row[i]).toUpperCase();
      const value = _norm(row[i + 1]);
      if (!label) continue;
      if (label === 'TEACHER') meta.teacherRaw = value;
      else if (label === 'WEEK') meta.weekRaw = value;
      else if (label.startsWith('TERM')) meta.termYearRaw = value;
      else if (label === 'SUBJECT') meta.subjectRaw = value;
      else if (label === 'DATE') meta.dateRaw = value;
      else if (label in FIELD_BY_LABEL) {
        const field = FIELD_BY_LABEL[label];
        if (!meta[field]) meta[field] = value;
        else if (value && value !== meta[field]) {
          warnings.push(`Conflicting ${label} values found ("${meta[field]}" vs "${value}") — using "${meta[field]}"; verify this lesson's class is correct.`);
        }
      }
    }
  };
  pairs(row0);
  pairs(row1);
  return { meta, warnings };
}

// Column headers aren't assumed to be in a fixed order — matched by
// keyword so a school that relabels/reorders the header row (the same
// customization lessonPlanTemplate already allows for manual entry)
// still parses correctly.
const COLUMN_KEYWORDS = [
  { field: 'lessonNumberRaw', test: h => h === 'lesson' },
  { field: 'topicSubtopicRaw', test: h => h.includes('topic') },
  { field: 'objectivesRaw', test: h => h.includes('objective') },
  { field: 'activitiesRaw', test: h => h.includes('activit') },
  { field: 'resourcesRaw', test: h => h.includes('resource') || h.includes('reference') },
  { field: 'remarksRaw', test: h => h.includes('remark') },
];
function _mapColumns(headerRow) {
  const map = [];
  headerRow.forEach((h, i) => {
    const norm = _norm(h).toLowerCase();
    const hit = COLUMN_KEYWORDS.find(k => k.test(norm));
    if (hit) map.push({ index: i, field: hit.field });
  });
  return map;
}

/**
 * @param {string[][]} rows - flattened table rows, e.g. from extractDocxRows
 * @returns {{blocks: object[], warnings: string[]}}
 */
function extractLessonBlocks(rows) {
  const blockStarts = [];
  rows.forEach((row, i) => { if (_cellStartsWith(row[0], 'TEACHER')) blockStarts.push(i); });

  const blocks = [];
  const warnings = [];

  blockStarts.forEach((start, bi) => {
    const end = bi + 1 < blockStarts.length ? blockStarts[bi + 1] : rows.length;
    const slice = rows.slice(start, end);
    const block = { sourceRowStart: start, sourceRowEnd: end };

    const { meta, warnings: metaWarnings } = _parseMetaRows(slice[0] || [], slice[1] || []);
    Object.assign(block, meta);
    metaWarnings.forEach(w => warnings.push(`Lesson block at row ${start}: ${w}`));

    const headerIdx = slice.findIndex(r => _norm(r[0]).toLowerCase() === 'lesson');
    if (headerIdx === -1 || !slice[headerIdx + 1]) {
      warnings.push(`Lesson block at row ${start}: no data row found under the column headers — skipped.`);
      blocks.push(block);
      return;
    }
    const colMap = _mapColumns(slice[headerIdx]);
    const dataRow = slice[headerIdx + 1];
    for (const { index, field } of colMap) block[field] = _norm(dataRow[index]);

    // Matched by the DIFFERENTIATION header row's OWN labels (confirmed
    // against the real sample document: "LOW ABILITY" / "MIDDLE ABILITY" /
    // "HIGH ABILITY"), not fixed column positions — same reasoning as
    // COLUMN_KEYWORDS above. A positional assumption (data row cells 1/2/3
    // = low/middle/high) happened to work for that one document only
    // because its columns are in that exact order; a school whose template
    // reorders or relabels them (e.g. "SUPPORT"/"CORE"/"EXTENSION") would
    // have silently misassigned every value.
    const diffHeaderIdx = slice.findIndex(r => _cellStartsWith(r[0], 'DIFFERENTIATION'));
    if (diffHeaderIdx !== -1 && slice[diffHeaderIdx + 1]) {
      const headerRow = slice[diffHeaderIdx];
      const dataRow   = slice[diffHeaderIdx + 1];
      const diff = { low: '', middle: '', high: '' };
      headerRow.forEach((h, i) => {
        if (i === 0) return; // the "DIFFERENTIATION" label cell itself
        const norm = _norm(h).toLowerCase();
        if (norm.includes('low')) diff.low = _norm(dataRow[i]);
        else if (norm.includes('middle') || norm.includes('medium') || norm.includes('average')) diff.middle = _norm(dataRow[i]);
        else if (norm.includes('high')) diff.high = _norm(dataRow[i]);
      });
      block.differentiation = diff;
    }

    const assessRow = slice.find(r => _cellStartsWith(r[0], 'ASSESSMENT'));
    if (assessRow) block.assessmentRaw = _norm(assessRow[1]);

    const homeworkRow = slice.find(r => _cellStartsWith(r[0], 'LESSON / WEEK') || _cellStartsWith(r[0], 'LESSON/WEEK'));
    if (homeworkRow) block.homeworkRaw = _norm(homeworkRow[1]);

    blocks.push(block);
  });

  if (!blockStarts.length) warnings.push('No lesson blocks found — no row starting with "TEACHER" was detected.');

  return { blocks, warnings };
}

module.exports = { extractDocxRows, extractLessonBlocks };
