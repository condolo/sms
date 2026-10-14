/* ============================================================
   Unit tests — server/scripts/diagnose-stream-ambiguous-assignments.js's
   pure decision logic (isStreamAmbiguous).

   No MongoDB required — a pure function, exported specifically so this
   logic is testable independent of the script's DB-connecting shell
   (which only runs when the file is executed directly, guarded by
   require.main === module).
   ============================================================ */
'use strict';

const { isStreamAmbiguous } = require('../scripts/diagnose-stream-ambiguous-assignments');

describe('isStreamAmbiguous', () => {
  test('already stream-specific — never ambiguous, regardless of anything else', () => {
    const a = { streamId: 'str_1' };
    expect(isStreamAmbiguous(a, { isCompulsoryForClass: true }, 3)).toBe(false);
  });

  test('compulsory subject, multi-stream class, no streamId — the exact reported bug', () => {
    const a = { streamId: null };
    const classSubject = { isCompulsoryForClass: true };
    expect(isStreamAmbiguous(a, classSubject, 3)).toBe(true);
  });

  test('elective subject — whole-class with no stream is the correct default, not ambiguous', () => {
    const a = { streamId: null };
    const classSubject = { isCompulsoryForClass: false };
    expect(isStreamAmbiguous(a, classSubject, 3)).toBe(false);
  });

  test('class has only one stream — nothing to be ambiguous between', () => {
    const a = { streamId: null };
    const classSubject = { isCompulsoryForClass: true };
    expect(isStreamAmbiguous(a, classSubject, 1)).toBe(false);
  });

  test('class has zero streams — same, not ambiguous', () => {
    const a = { streamId: null };
    const classSubject = { isCompulsoryForClass: true };
    expect(isStreamAmbiguous(a, classSubject, 0)).toBe(false);
  });

  test('subject not in this class\'s curriculum at all — a different problem, not flagged here', () => {
    const a = { streamId: null };
    expect(isStreamAmbiguous(a, null, 3)).toBe(false);
  });

  test('streamId present but falsy-empty-string is still treated as missing', () => {
    const a = { streamId: '' };
    const classSubject = { isCompulsoryForClass: true };
    expect(isStreamAmbiguous(a, classSubject, 2)).toBe(true);
  });
});
