/* ============================================================
   server/utils/elective-scope.js — isInCurriculum / pairsNotInCurriculum

   Reported directly (2026-10-15): logged in as admin, picking a class
   then a subject the class's curriculum never offered, the roster
   still loaded (the whole class) and marks could be entered for it —
   "I can enter marks for a subject no student is enrolled for." Root
   cause: `isElective` returns false both for a genuinely compulsory
   subject AND for a subject with no class_subjects row at all, so
   every write path's branch on that boolean silently treated "never
   added to this class's curriculum" exactly like "compulsory, whole
   class" — and `canWriteSubject`/`canTeachElective` bypass ALL checks
   for management roles, so nothing else ever asked "does this class
   even teach this subject at all?"

   This guard is a curriculum-integrity question, not a who's-assigned
   question — it applies to every role including management, unlike
   every other check in subject-scope.js/elective-scope.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockClassSubjects;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'class_subjects') {
      return {
        findOne: (filter) => mockChain(mockClassSubjects.find(d => d.classId === filter.classId && d.subjectId === filter.subjectId) ?? null),
        find: (filter) => mockChain(mockClassSubjects.filter(d => (filter.$or ?? []).some(o => o.classId === d.classId && o.subjectId === d.subjectId))),
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  },
}));

const { isInCurriculum, pairsNotInCurriculum } = require('../../utils/elective-scope');

function req() {
  return { jwtUser: { schoolId: SCHOOL, userId: 'usr_admin', role: 'admin', roles: ['admin'] } };
}

beforeEach(() => {
  mockClassSubjects = [
    { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_math', isCompulsoryForClass: true },
    { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_art', isCompulsoryForClass: false },
  ];
});

describe('isInCurriculum', () => {
  test('true for a subject genuinely linked to the class, compulsory or elective', async () => {
    expect(await isInCurriculum(req(), 'cls_1', 'sub_math')).toBe(true);
    expect(await isInCurriculum(req(), 'cls_1', 'sub_art')).toBe(true);
  });

  test('false for a subject never added to this class\'s curriculum — the exact reported bug', async () => {
    expect(await isInCurriculum(req(), 'cls_1', 'sub_never_added')).toBe(false);
  });

  test('false for the right subject in the wrong class', async () => {
    expect(await isInCurriculum(req(), 'cls_999', 'sub_math')).toBe(false);
  });
});

describe('pairsNotInCurriculum', () => {
  test('returns only the pairs with no class_subjects link', async () => {
    const result = await pairsNotInCurriculum(req(), [
      { classId: 'cls_1', subjectId: 'sub_math' },
      { classId: 'cls_1', subjectId: 'sub_never_added' },
    ]);
    expect(result).toEqual([{ classId: 'cls_1', subjectId: 'sub_never_added' }]);
  });

  test('empty array in, empty array out', async () => {
    expect(await pairsNotInCurriculum(req(), [])).toEqual([]);
  });

  test('every pair linked returns empty', async () => {
    const result = await pairsNotInCurriculum(req(), [{ classId: 'cls_1', subjectId: 'sub_math' }]);
    expect(result).toEqual([]);
  });
});
