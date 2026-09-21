/* ============================================================
   server/utils/subject-scope.js (RC6)

   canWriteSubject/unassignedPairs are unconditional as of 2026-09 —
   previously gated behind academic_config.subjectAssignmentEnforced,
   an opt-in flag with no Settings UI anywhere to turn it on, so it
   was permanently off for every real school. isSubjectAssignmentEnforced
   itself is unchanged (still reads the raw config value) but is no
   longer consulted by either enforcement function.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockAcademicConfig;
let mockAssignmentDocs;

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'academic_config') {
      return { findOne: jest.fn(() => mockChain(mockAcademicConfig)) };
    }
    if (col === 'teaching_assignments') {
      return {
        findOne: jest.fn(() => mockChain(mockAssignmentDocs[0] ?? null)),
        find:    jest.fn(() => mockChain(mockAssignmentDocs)),
      };
    }
    return { findOne: jest.fn(() => mockChain(null)), find: jest.fn(() => mockChain([])) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

const { isSubjectAssignmentEnforced, canWriteSubject, unassignedPairs } = require('../utils/subject-scope');

function reqAs(role, extra = {}) {
  return { jwtUser: { schoolId: 'school_001', userId: 'usr_teacher_1', role, ...extra } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAcademicConfig = { subjectAssignmentEnforced: true };
  mockAssignmentDocs = [];
});

describe('isSubjectAssignmentEnforced', () => {
  test('true when the school has turned the flag on', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: true };
    expect(await isSubjectAssignmentEnforced(reqAs('teacher'))).toBe(true);
  });

  test('false when the flag is off, absent, or no config doc exists', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: false };
    expect(await isSubjectAssignmentEnforced(reqAs('teacher'))).toBe(false);
    mockAcademicConfig = {};
    expect(await isSubjectAssignmentEnforced(reqAs('teacher'))).toBe(false);
    mockAcademicConfig = null;
    expect(await isSubjectAssignmentEnforced(reqAs('teacher'))).toBe(false);
  });
});

describe('canWriteSubject', () => {
  test('management-tier roles always pass, without even checking the flag', async () => {
    for (const role of ['admin', 'superadmin', 'deputy_principal', 'deputy', 'principal', 'hod']) {
      expect(await canWriteSubject(reqAs(role), 'cls_1', 'subj_math')).toBe(true);
    }
  });

  test('the academic_config flag no longer matters — a teacher with a matching assignment passes regardless of its value', async () => {
    for (const flagValue of [true, false, undefined]) {
      mockAcademicConfig = { subjectAssignmentEnforced: flagValue };
      mockAssignmentDocs = [{ id: 'ta_1' }];
      expect(await canWriteSubject(reqAs('teacher'), 'cls_1', 'subj_math')).toBe(true);
    }
  });

  test('the academic_config flag no longer matters — a teacher with NO matching assignment is denied regardless of its value', async () => {
    for (const flagValue of [true, false, undefined]) {
      mockAcademicConfig = { subjectAssignmentEnforced: flagValue };
      mockAssignmentDocs = [];
      expect(await canWriteSubject(reqAs('teacher'), 'cls_1', 'subj_math')).toBe(false);
    }
  });

  test('the academic_config lookup is never even queried — enforcement no longer depends on it', async () => {
    const { tenantModel } = require('../utils/tenant-model');
    mockAssignmentDocs = [{ id: 'ta_1' }];
    await canWriteSubject(reqAs('teacher'), 'cls_1', 'subj_math');
    expect(tenantModel).not.toHaveBeenCalledWith('academic_config');
  });
});

describe('unassignedPairs', () => {
  test('empty pairs list short-circuits to empty, no queries made', async () => {
    const { tenantModel } = require('../utils/tenant-model');
    const result = await unassignedPairs(reqAs('teacher'), []);
    expect(result).toEqual([]);
    expect(tenantModel).not.toHaveBeenCalled();
  });

  test('management-tier roles are never denied, even with zero assignments', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: true };
    mockAssignmentDocs = [];
    const result = await unassignedPairs(reqAs('admin'), [{ classId: 'cls_1', subjectId: 'subj_math' }]);
    expect(result).toEqual([]);
  });

  test('the academic_config flag no longer matters — zero assignments denies every pair regardless of its value', async () => {
    for (const flagValue of [true, false, undefined]) {
      mockAcademicConfig = { subjectAssignmentEnforced: flagValue };
      mockAssignmentDocs = [];
      const pairs = [{ classId: 'cls_1', subjectId: 'subj_math' }];
      const result = await unassignedPairs(reqAs('teacher'), pairs);
      expect(result).toEqual(pairs);
    }
  });

  test('a pair not covered by any assignment doc is returned as denied; a covered pair is not', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: true };
    mockAssignmentDocs = [{ classId: 'cls_1', subjectId: 'subj_math' }]; // assigned Math in cls_1 only
    const pairs = [
      { classId: 'cls_1', subjectId: 'subj_math' },   // assigned
      { classId: 'cls_1', subjectId: 'subj_english' }, // NOT assigned — same class, different subject
    ];
    const result = await unassignedPairs(reqAs('teacher'), pairs);
    expect(result).toEqual([{ classId: 'cls_1', subjectId: 'subj_english' }]);
  });
});
