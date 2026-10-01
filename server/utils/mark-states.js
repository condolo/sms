/* ============================================================
   Shared mark-state vocabulary — present/absent/missing/exempt/incomplete.

   Originally lived only in exams.js (the Results-entry feature). Moved
   here so the Markbook (assessment.js's assessment_marks) can use the
   identical states as part of consolidating all mark entry into the
   Markbook — see DEVELOPER_GUIDE.md's architecture-lock entry.
   ============================================================ */
'use strict';

const MARK_STATES = ['present', 'ABS', 'MIS', 'EXM', 'INC'];
// present = has a valid score
// ABS     = absent (not treated as zero — excluded from averages)
// MIS     = missing mark — teacher has not entered score yet (flags for action)
// EXM     = exempted — excluded from averaging entirely
// INC     = incomplete — blocks report approval until resolved

/** Resolve markState + score for backward compat with a plain `absent` boolean.
 *  If markState is given, it's authoritative (score nulled unless 'present').
 *  If only absent is given, derive markState from it. */
function resolveMarkState(data) {
  if (data.markState && data.markState !== 'present') {
    return { markState: data.markState, absent: data.markState === 'ABS', score: null };
  }
  if (data.absent === true && (!data.markState || data.markState === 'present')) {
    return { markState: 'ABS', absent: true, score: null };
  }
  return { markState: 'present', absent: false, score: data.score ?? null };
}

module.exports = { MARK_STATES, resolveMarkState };
