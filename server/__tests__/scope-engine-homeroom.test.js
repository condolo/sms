/* ============================================================
   server/utils/scopeEngine.js — homeroom/form-teacher scope
   (2026-09, prompted directly: "the class teacher/homeroom teacher can
   take daily attendance for each stream they have been allocated")

   Confirmed live against real production data before this fix: a
   designated form teacher (streams.js's formTeacherId) with ZERO
   teaching_assignments for their own homeroom class got an empty class
   picker and a 403 everywhere in Attendance — formTeacherId was never
   consulted by scope resolution at all.

   Deliberately verifies the fix is narrow: resolveHomeroomStreamIds/
   foldHomeroomScope are used ONLY by Attendance's own routes/pickers
   (see attendance.js, streams.js, and resolveClassPickerScope's own
   callers classes.js/assessment.js) — NEVER by the generic
   scopeMiddleware pipeline that grades/assessment/report_cards/
   growth_profile/growth_records/lessons all read from identically. A
   form teacher must never gain grade-entry or curriculum-coverage
   access to a stream purely from being its pastoral homeroom teacher.

   resolveTeacher is mocked directly — its own userId/email resolution
   logic is covered by its own dependents' tests elsewhere; this file
   tests only scopeEngine.js's use of it.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  return {
    find: jest.fn((filter) => mockChainArr(seed.filter(d => mockMatchesFilter(d, filter)))),
  };
}

let mockTeacherResult;
jest.mock('../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve(mockTeacherResult)),
}));

let mockStreams;
jest.mock('../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'streams') return mockStreams;
    return mockMakeFakeCollection([]);
  },
}));

const ScopeEngine = require('../utils/scopeEngine');
const { resolveTeacher } = require('../utils/resolveTeacher');

beforeEach(() => {
  jest.clearAllMocks();
  mockTeacherResult = { id: 'tch_1', userId: 'usr_teacher' };
  mockStreams = mockMakeFakeCollection([
    { id: 'strm_diamond', schoolId: SCHOOL_A, classId: 'cls_yr2', formTeacherId: 'tch_1' },
    { id: 'strm_sapphire', schoolId: SCHOOL_A, classId: 'cls_yr2', formTeacherId: 'tch_other' },
  ]);
});

describe('resolveHomeroomStreamIds', () => {
  test('returns the streams where the caller is the designated form teacher', async () => {
    const req = { jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A, email: 't@x.com' } };
    const ids = await ScopeEngine.resolveHomeroomStreamIds(req);
    expect(ids).toEqual(['strm_diamond']); // NOT strm_sapphire — that's a different form teacher
  });

  test('returns [] when the caller has no linked teacher record at all', async () => {
    mockTeacherResult = null;
    const req = { jwtUser: { userId: 'usr_admin', schoolId: SCHOOL_A } };
    expect(await ScopeEngine.resolveHomeroomStreamIds(req)).toEqual([]);
  });

  test('returns [] when the teacher is not the form teacher of anything', async () => {
    mockTeacherResult = { id: 'tch_no_homeroom', userId: 'usr_teacher' };
    const req = { jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A } };
    expect(await ScopeEngine.resolveHomeroomStreamIds(req)).toEqual([]);
  });

  test('never throws when resolveTeacher itself throws — fails safe to empty, not a 500', async () => {
    resolveTeacher.mockImplementationOnce(() => { throw new Error('DB unavailable'); });
    const req = { jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A } };
    await expect(ScopeEngine.resolveHomeroomStreamIds(req)).resolves.toEqual([]);
  });

  test('returns [] with no userId/schoolId on the request at all', async () => {
    expect(await ScopeEngine.resolveHomeroomStreamIds({ jwtUser: {} })).toEqual([]);
  });
});

describe('foldHomeroomScope', () => {
  test('an unrestricted caller (scope === null) is an untouched no-op', async () => {
    const req = { jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A }, scope: null };
    expect(await ScopeEngine.foldHomeroomScope(req)).toBeNull();
    // Confirms the no-op path never even queries for homeroom streams —
    // an admin's every attendance request shouldn't pay this DB cost.
    expect(resolveTeacher).not.toHaveBeenCalled();
  });

  test('folds the homeroom stream into a scoped teacher\'s streamIds, alongside any teaching-assignment streams', async () => {
    const req = {
      jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A },
      scope: { level: 'assigned', classIds: [], streamIds: ['strm_from_teaching_assignment'], unrestrictedModules: [] },
    };
    const folded = await ScopeEngine.foldHomeroomScope(req);
    expect(folded.streamIds.sort()).toEqual(['strm_diamond', 'strm_from_teaching_assignment']);
  });

  test('a teacher with zero homeroom streams gets their scope back completely unchanged (same object, not a copy)', async () => {
    mockTeacherResult = null;
    const originalScope = { level: 'assigned', classIds: [], streamIds: ['strm_x'], unrestrictedModules: [] };
    const req = { jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A }, scope: originalScope };
    expect(await ScopeEngine.foldHomeroomScope(req)).toBe(originalScope);
  });

  test('never mutates req.scope in place — the caller\'s original object is untouched', async () => {
    const originalScope = { level: 'assigned', classIds: [], streamIds: [], unrestrictedModules: [] };
    const req = { jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A }, scope: originalScope };
    const folded = await ScopeEngine.foldHomeroomScope(req);
    expect(folded).not.toBe(originalScope);
    expect(originalScope.streamIds).toEqual([]); // the original is untouched
  });
});

describe('resolveClassPickerScope — homeroom-aware (classes.js / assessment.js pickers)', () => {
  test('a teacher with ONLY a homeroom stream (no teaching assignment anywhere) still resolves to that stream\'s parent class', async () => {
    const req = {
      jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A },
      scope: { level: 'assigned', classIds: [], streamIds: [], unrestrictedModules: [] },
    };
    const picked = await ScopeEngine.resolveClassPickerScope(req);
    expect(picked.classIds).toEqual(['cls_yr2']);
  });

  test('a teacher with no homeroom AND no teaching assignment resolves to nothing (unchanged, not a crash)', async () => {
    mockTeacherResult = null;
    const req = {
      jwtUser: { userId: 'usr_teacher', schoolId: SCHOOL_A },
      scope: { level: 'assigned', classIds: [], streamIds: [], unrestrictedModules: [] },
    };
    const picked = await ScopeEngine.resolveClassPickerScope(req);
    expect(picked.classIds).toEqual([]);
  });
});
