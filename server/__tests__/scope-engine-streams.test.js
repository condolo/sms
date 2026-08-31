/* ============================================================
   server/utils/scopeEngine.js — stream-aware applyToFilter /
   hasNoAssignments

   A teacher's compulsory-subject teaching assignment is now
   stream-scoped whenever the class actually has streams (e.g. 7i's
   Maths teacher isn't 7ii's) — see teaching-assignments.js. This
   covers the ScopeEngine side: a teacher with ONLY a stream-scoped
   grant (classIds empty, streamIds non-empty for a streamAware
   module) must be narrowed to their own streams, never granted the
   whole class and never treated as having no assignments at all.

   Pure function over req.scope — no DB mocking needed, same style as
   scope-engine.test.js.
   ============================================================ */
'use strict';

const { applyToFilter, hasNoAssignments } = require('../utils/scopeEngine');

function streamOnlyReq(streamIds, classIds = []) {
  return { scope: { level: 'assigned', classIds, subjectIds: [], streamIds, unrestrictedModules: [] } };
}

describe('applyToFilter — stream-aware modules (students, classes)', () => {
  test('stream-only teacher, no caller-supplied classId: filter narrows to classId-in-classIds OR streamId-in-streamIds', () => {
    const req = streamOnlyReq(['strm_7i']);
    const filter = {};
    applyToFilter(req, 'students', filter);
    expect(filter.$or).toEqual([
      { classId: { $in: [] } },
      { streamId: { $in: ['strm_7i'] } },
    ]);
  });

  test('stream-only teacher requesting the specific class their stream belongs to: classId kept, streamId narrowed', () => {
    const req = streamOnlyReq(['strm_7i']);
    const filter = { classId: 'cls_yr7' };
    applyToFilter(req, 'students', filter);
    expect(filter.classId).toBe('cls_yr7');
    expect(filter.streamId).toEqual({ $in: ['strm_7i'] });
  });

  test('stream-only teacher requesting a DIFFERENT class than any of their streams: still resolves via streamId narrowing, not a blanket deny', () => {
    // No cross-check against which class a stream actually belongs to is
    // needed here — streamIds are globally unique per class (streams.js),
    // so if strm_7i doesn't belong to cls_other, the query naturally
    // returns zero rows without ScopeEngine having to know that itself.
    const req = streamOnlyReq(['strm_7i']);
    const filter = { classId: 'cls_other' };
    applyToFilter(req, 'students', filter);
    expect(filter.classId).toBe('cls_other');
    expect(filter.streamId).toEqual({ $in: ['strm_7i'] });
  });

  test('whole-class grant still wins outright — no stream narrowing applied when the class itself is fully granted', () => {
    const req = { scope: { level: 'assigned', classIds: ['cls_yr7'], subjectIds: [], streamIds: ['strm_7i'], unrestrictedModules: [] } };
    const filter = { classId: 'cls_yr7' };
    applyToFilter(req, 'students', filter);
    expect(filter.classId).toBe('cls_yr7');
    expect(filter.streamId).toBeUndefined(); // untouched — full class access, no narrowing
  });

  test('a caller-supplied streamId is intersected with, not overwritten by, the stream-only narrowing', () => {
    const req = streamOnlyReq(['strm_7i', 'strm_7ii']);
    const filter = { classId: 'cls_yr7', streamId: 'strm_7i' };
    applyToFilter(req, 'students', filter);
    expect(filter.streamId).toBe('strm_7i'); // already within scope — kept as-is

    const filter2 = { classId: 'cls_yr7', streamId: 'strm_9x' };
    applyToFilter(req, 'students', filter2);
    expect(filter2.streamId).toBe('__no_match__'); // outside scope — denied
  });

  test('non-streamAware module (e.g. attendance today) ignores streamIds entirely — unchanged behaviour', () => {
    const req = streamOnlyReq(['strm_7i']);
    const filter = {};
    applyToFilter(req, 'attendance', filter);
    // No whole-class grant and streamIds don't apply to this module yet →
    // strict deny, same as a teacher with zero assignments at all.
    expect(filter.classId).toEqual({ $in: [] });
    expect(filter.$or).toBeUndefined();
  });

  test('a teacher with neither classIds nor streamIds is strictly denied, same as before', () => {
    const req = streamOnlyReq([]);
    const filter = {};
    applyToFilter(req, 'students', filter);
    expect(filter.classId).toEqual({ $in: [] });
  });
});

describe('hasNoAssignments — stream-only grant counts as having an assignment', () => {
  test('stream-only teacher (classIds empty, streamIds non-empty) is NOT reported as having no assignments, for a streamAware module', () => {
    const req = streamOnlyReq(['strm_7i']);
    expect(hasNoAssignments(req, 'students')).toBe(false);
  });

  test('a genuinely unassigned teacher (both empty) IS reported as having no assignments', () => {
    const req = streamOnlyReq([]);
    expect(hasNoAssignments(req, 'students')).toBe(true);
  });

  test('stream-only teacher on a non-streamAware module still reports no assignments (streamIds not consulted there)', () => {
    const req = streamOnlyReq(['strm_7i']);
    expect(hasNoAssignments(req, 'attendance')).toBe(true);
  });
});
