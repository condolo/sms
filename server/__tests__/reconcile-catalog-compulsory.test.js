/* ============================================================
   Unit tests — server/scripts/reconcile-catalog-compulsory.js's
   pure decision logic (isCompulsoryMismatch).

   No MongoDB required — a pure function, exported specifically so this
   logic is testable independent of the script's DB-connecting shell
   (which only runs when the file is executed directly, guarded by
   require.main === module).
   ============================================================ */
'use strict';

const { isCompulsoryMismatch } = require('../scripts/reconcile-catalog-compulsory');

describe('isCompulsoryMismatch', () => {
  test('catalog-compulsory subject, curriculum link not marked compulsory — the exact reported bug', () => {
    expect(isCompulsoryMismatch({ isCompulsoryForClass: false }, { isCompulsory: true })).toBe(true);
  });

  test('catalog-compulsory subject, curriculum link field entirely unset — also a mismatch', () => {
    expect(isCompulsoryMismatch({}, { isCompulsory: true })).toBe(true);
  });

  test('catalog-compulsory subject, curriculum link already agrees — not a mismatch', () => {
    expect(isCompulsoryMismatch({ isCompulsoryForClass: true }, { isCompulsory: true })).toBe(false);
  });

  test('catalog-elective subject — never flagged regardless of the curriculum flag', () => {
    expect(isCompulsoryMismatch({ isCompulsoryForClass: false }, { isCompulsory: false })).toBe(false);
    expect(isCompulsoryMismatch({ isCompulsoryForClass: true }, { isCompulsory: false })).toBe(false);
  });

  test('missing classSubject or subject — nothing to compare, not flagged', () => {
    expect(isCompulsoryMismatch(null, { isCompulsory: true })).toBe(false);
    expect(isCompulsoryMismatch({ isCompulsoryForClass: false }, null)).toBe(false);
  });
});
