/* ============================================================
   server/utils/subject-scope.js (RC6)

   academic_config.subjectAssignmentEnforced existed since it was
   added to academic-config.js's schema, but nothing anywhere read
   it. These tests cover the new enforcement primitive directly.

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

  test('a teacher passes when enforcement is off, regardless of assignment', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: false };
    mockAssignmentDocs = [];
    expect(await canWriteSubject(reqAs('teacher'), 'cls_1', 'subj_math')).toBe(true);
  });

  test('a teacher with a matching teaching_assignments record passes when enforced', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: true };
    mockAssignmentDocs = [{ id: 'ta_1' }];
    expect(await canWriteSubject(reqAs('teacher'), 'cls_1', 'subj_math')).toBe(true);
  });

  test('a teacher with no matching assignment is denied when enforced', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: true };
    mockAssignmentDocs = [];
    expect(await canWriteSubject(reqAs('teacher'), 'cls_1', 'subj_math')).toBe(false);
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

  test('enforcement off returns no denials regardless of assignment', async () => {
    mockAcademicConfig = { subjectAssignmentEnforced: false };
    mockAssignmentDocs = [];
    const result = await unassignedPairs(reqAs('teacher'), [{ classId: 'cls_1', subjectId: 'subj_math' }]);
    expect(result).toEqual([]);
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
