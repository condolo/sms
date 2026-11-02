/* ============================================================
   server/utils/indexes.js — migration safety for a changed index key

   Audit finding (2026-11), live-breaking: report_card_draft_comments'
   unique index was {schoolId,studentId,termNumber} — unique per
   student+term, full stop. v5.251.0 made this collection one doc per
   student+term+CYCLE (so a Mid-Term and an End-of-Term comment can
   coexist), but the index's KEY was never updated to include `cycle`.

   ensureIndexes() (this file) runs createIndex() for every entry in
   INDEXES on every server startup — but createIndex() with a NAME that
   already exists, carrying a DIFFERENT key spec than requested, throws
   IndexKeySpecsConflict (code 86), which this file's own ensureIndexes()
   catches and treats as "skipped — no action needed" (see the comment
   there). So editing an index's `key` in place, keeping the same `name`,
   is a silent no-op against a live database — the OLD key spec stays
   enforced forever, and the very first school to save a second cycle's
   comment for a student who already had one for that term would hit a
   real MongoDB E11000 duplicate-key error (500) — exactly the workflow
   this feature exists for.

   This file had ZERO test coverage before this audit, which is exactly
   how that slipped through a full, green Jest run (the mocks used
   elsewhere in this codebase have no concept of unique-index
   enforcement at all). This test doesn't attempt to stand up a real
   ensureIndexes() harness (a much larger undertaking for a file with no
   existing test infrastructure) — it narrowly guards against this EXACT
   regression class for report_card_draft_comments specifically: whenever
   its INDEXES entry's key changes, DROP_INDEXES must carry a matching
   drop-by-old-name entry, under a NEW name, not the same one.
   ============================================================ */
'use strict';

const { INDEXES, DROP_INDEXES } = require('../utils/indexes');

describe('report_card_draft_comments index — cycle migration safety', () => {
  const entry = INDEXES.find(e => e.col === 'report_card_draft_comments');

  test('the live unique index key includes `cycle`', () => {
    expect(entry).toBeTruthy();
    const idx = entry.indexes.find(i => i.unique);
    expect(idx.key).toEqual({ schoolId: 1, studentId: 1, termNumber: 1, cycle: 1 });
  });

  test('the old, pre-cycle index name is explicitly dropped, never just redefined', () => {
    // The whole point: createIndex() silently NO-OPs when a same-named
    // index already exists with a different key — so the current
    // index's name must NOT be 'rcdc_student_term' (the old name), and
    // that old name must appear in DROP_INDEXES so a live database
    // actually sheds the stale, too-narrow unique constraint.
    const idx = entry.indexes.find(i => i.unique);
    expect(idx.name).not.toBe('rcdc_student_term');
    expect(DROP_INDEXES).toEqual(
      expect.arrayContaining([{ col: 'report_card_draft_comments', name: 'rcdc_student_term' }])
    );
  });

  test('general regression guard: every unique index\'s key must contain every field DROP_INDEXES is dropping it in favour of — i.e. no OTHER collection has this same silent-skip trap today', () => {
    // Not exhaustive (can't detect a key change with no matching drop at
    // all, since there's nothing to cross-reference) — but for every
    // {col, name} this file already drops, confirm the CURRENT index for
    // that collection is never defined under that exact dropped name
    // (which would mean createIndex() is about to silently skip it too).
    for (const drop of DROP_INDEXES) {
      const colEntry = INDEXES.find(e => e.col === drop.col);
      if (!colEntry) continue;
      const stillUsesDroppedName = colEntry.indexes.some(i => i.name === drop.name);
      expect(stillUsesDroppedName).toBe(false);
    }
  });
});
