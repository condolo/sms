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
});
