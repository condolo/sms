/* ============================================================
   Lesson Plan Import — entity resolution (2026-09)

   Pure functions only — no DB access here. The route layer fetches
   candidates (classes/subjects/streams/teaching_assignments for the
   ALREADY-SELECTED teacher) and passes them in; this module never
   guesses across a whole school's data on its own.

   Design context (Phase 1 approved decisions):
   - Teacher, class, subject, term are pre-selected by the operator
     before upload (same pattern as the existing manual Lesson Plan
     entry picker) — this module does NOT resolve teacher identity from
     document text at all, ever.
   - Stream is inferred from teaching_assignments when the pre-selected
     (teacherId, classId, subjectId) has exactly one stream; ambiguous
     otherwise (caller must ask the operator, never guess).
   - Topic/Subtopic become free text on the plan (topicTitle/
     subtopicTitle) — resolveTopicSubtopic never touches syllabus_topics
     and never blocks on a missing curriculum topic, per the explicit
     "topics/subtopics are part of the lesson plan, not a separate
     lookup" decision.
   ============================================================ */
'use strict';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Splits a "Unit 1: Adventure — Adventure Fiction Conventions" style cell
 * into topic/subtopic. Falls back to the whole string as the topic with no
 * subtopic when there's no separator — this never fails, since topic text
 * is stored as-is either way (no FK to validate against).
 */
function resolveTopicSubtopic(topicSubtopicRaw) {
  const raw = (topicSubtopicRaw || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { topicTitle: '', subtopicTitle: '' };
  const sepMatch = raw.match(/^(.*?)\s*[—–-]\s*(.+)$/);
  if (!sepMatch) return { topicTitle: raw, subtopicTitle: '' };
  return { topicTitle: sepMatch[1].trim(), subtopicTitle: sepMatch[2].trim() };
}

/**
 * Format-agnostic entry point for topic/subtopic: the CSV format can give
 * Topic and Subtopic as separate columns (block.topicRaw/subtopicRaw), in
 * which case that's authoritative and never dash-split; otherwise falls
 * back to splitting the combined docx-style cell (block.topicSubtopicRaw).
 */
function getTopicAndSubtopic(block) {
  if (block.topicRaw || block.subtopicRaw) {
    return { topicTitle: (block.topicRaw || '').trim(), subtopicTitle: (block.subtopicRaw || '').trim() };
  }
  return resolveTopicSubtopic(block.topicSubtopicRaw);
}

/**
 * Parses a free-text date like "1ST SEPTEMBER", "FROM: 2ND SEPTEMBER",
 * "3 SEPTEMBER 2026" against a known term span. The year is never guessed
 * independently of the term — it's whichever of the term's own start/end
 * years makes the parsed day+month fall inside [term.startDate,
 * term.endDate]. Returns {date} on success or {error} when the text can't
 * be parsed or falls outside the term entirely (never silently picks a
 * wrong year).
 */
function resolveLessonDate(dateRaw, term) {
  const cleaned = (dateRaw || '')
    .replace(/^\s*FROM:?\s*/i, '')
    .replace(/(\d+)(ST|ND|RD|TH)/i, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (!m) return { error: `Could not parse date "${dateRaw}"` };
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return { error: `Unrecognized month in date "${dateRaw}"` };

  const candidateYears = m[3]
    ? [parseInt(m[3], 10)]
    : [new Date(term.startDate).getFullYear(), new Date(term.endDate).getFullYear()];

  for (const year of [...new Set(candidateYears)]) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (iso >= term.startDate && iso <= term.endDate) return { date: iso };
  }
  return { error: `Date "${dateRaw}" does not fall within the selected term (${term.startDate} to ${term.endDate})` };
}

/**
 * Matches free text like "YEAR 7" / "Year 7" against a list of real
 * classes/subjects ({id, name}). Exact case-insensitive match only — no
 * fuzzy scoring, since a wrong guess here silently misfiles a whole
 * lesson plan under the wrong class. Ambiguous/no-match both return
 * null; the caller decides how to surface that to the operator.
 */
function matchByName(raw, candidates) {
  const norm = (raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!norm) return null;
  const matches = candidates.filter(c => (c.name || '').trim().toLowerCase() === norm);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Given teaching_assignments already filtered to one teacher, resolves
 * the stream for (classId, subjectId): exactly one match → that stream;
 * zero or more than one → null (caller must ask, never guess). This is
 * also what lets "the document doesn't mention a stream at all" work —
 * most teachers only teach one stream of a given class+subject.
 */
function resolveStreamFromAssignments(assignments, classId, subjectId) {
  const matches = assignments.filter(a => a.classId === classId && a.subjectId === subjectId && a.streamId);
  return matches.length === 1 ? { streamId: matches[0].streamId, streamName: matches[0].streamName } : null;
}

module.exports = {
  resolveTopicSubtopic,
  getTopicAndSubtopic,
  resolveLessonDate,
  matchByName,
  resolveStreamFromAssignments,
};
