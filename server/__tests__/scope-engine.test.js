/* ============================================================
   server/utils/scopeEngine.js — isClassInScope

   Direct unit coverage for the write-route allow/deny helper (used by
   attendance.js, grades.js's POST/PUT/DELETE, and lessons.js's
   /coverage — extracted from an inline pattern originally only in
   lessons.js once attendance.js/grades.js needed the identical check).
   Pure function over req.scope — no DB mocking needed.
   ============================================================ */
'use strict';

const { isClassInScope } = require('../utils/scopeEngine');

describe('isClassInScope', () => {
  test('unrestricted (req.scope === null, school-level role) always allows', () => {
    const req = { scope: null };
    expect(isClassInScope(req, 'attendance', 'cls_anything')).toBe(true);
  });

  test('module exempt via unrestrictedModules always allows', () => {
    const req = { scope: { level: 'assigned', classIds: [], unrestrictedModules: ['behaviour'] } };
    expect(isClassInScope(req, 'behaviour', 'cls_9')).toBe(true);
  });

  test('classId within the assigned list is allowed', () => {
    const req = { scope: { level: 'assigned', classIds: ['cls_1', 'cls_2'], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_1')).toBe(true);
  });

  test('classId NOT in the assigned list is denied', () => {
    const req = { scope: { level: 'assigned', classIds: ['cls_1', 'cls_2'], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_9')).toBe(false);
  });

  test('zero assigned classIds denies any specific classId', () => {
    const req = { scope: { level: 'assigned', classIds: [], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_1')).toBe(false);
  });

  test('a missing/undefined classId is allowed by default — nothing to check', () => {
    const req = { scope: { level: 'assigned', classIds: [], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'grades', undefined)).toBe(true);
    expect(isClassInScope(req, 'grades', '')).toBe(true);
  });

  test('an unmapped module (not in MODULE_SCOPE) always allows', () => {
    const req = { scope: { level: 'assigned', classIds: [], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'some_unmapped_module', 'cls_1')).toBe(true);
  });

  /* ── 4th param: streamId — Milestone 2 ─────────────────────── */
  test('streamId param is ignored (no crash) when omitted — every pre-existing call site is unaffected', () => {
    const req = { scope: { level: 'assigned', classIds: [], streamIds: ['strm_1'], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_9')).toBe(false); // classId still not in scope, streamId not passed
  });

  test('a stream-only teacher is allowed via streamId on a streamAware module even with zero classIds', () => {
    const req = { scope: { level: 'assigned', classIds: [], streamIds: ['strm_7i'], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_yr7', 'strm_7i')).toBe(true);
  });

  test('a stream-only teacher is denied for a stream they do not have', () => {
    const req = { scope: { level: 'assigned', classIds: [], streamIds: ['strm_7i'], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_yr7', 'strm_7ii')).toBe(false);
  });

  test('streamId is ignored for a non-streamAware module — classId-only decision, same as before', () => {
    const req = { scope: { level: 'assigned', classIds: [], streamIds: ['strm_7i'], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'lessons', 'cls_yr7', 'strm_7i')).toBe(false);
  });

  test('a whole-class grant still wins outright regardless of streamId', () => {
    const req = { scope: { level: 'assigned', classIds: ['cls_yr7'], streamIds: [], unrestrictedModules: [] } };
    expect(isClassInScope(req, 'attendance', 'cls_yr7', 'strm_anything')).toBe(true);
  });
});
