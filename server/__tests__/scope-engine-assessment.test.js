/* ============================================================
   server/utils/scopeEngine.js — resolveAssessmentScope

   Raised directly: an exams_officer granted every Settings box for
   Exams/Assessment/Report Cards, including reports__mark_list_school_wide
   with every action ticked, still saw only their own assigned classes in
   the Markbook — this floor only ever bypassed for ASSESSMENT_FLOOR_ROLES
   (admin/superadmin/principal/deputy_principal/deputy), with no grant-
   based override. Covers the fix: the same explicit grant MarkList and
   full report-card visibility already honor now also unrestricts this.
   ============================================================ */
'use strict';

let mockGrant;
let mockAssigned;

jest.mock('../middleware/rbac', () => ({
  hasExplicitSubGrant: jest.fn(() => Promise.resolve(mockGrant)),
}));
jest.mock('../middleware/scopeMiddleware', () => ({
  _loadAssigned: jest.fn(() => Promise.resolve(mockAssigned)),
}));

const { resolveAssessmentScope } = require('../utils/scopeEngine');

function reqAs(role) {
  return { jwtUser: { schoolId: 'school_001', userId: 'usr_1', role } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrant = false;
  mockAssigned = { classIds: ['cls_1'], subjectIds: ['subj_math'], streamIds: [] };
});

describe('resolveAssessmentScope', () => {
  test('a floor role (e.g. principal) is unrestricted without even checking the grant', async () => {
    expect(await resolveAssessmentScope(reqAs('principal'))).toBeNull();
  });

  test('a non-floor role with no grant is narrowed to their own assignments', async () => {
    const scope = await resolveAssessmentScope(reqAs('exams_officer'));
    expect(scope).toEqual({ level: 'assigned', classIds: ['cls_1'], subjectIds: ['subj_math'], streamIds: [] });
  });

  test('a non-floor role WITH the explicit reports__mark_list_school_wide grant is unrestricted', async () => {
    mockGrant = true;
    expect(await resolveAssessmentScope(reqAs('exams_officer'))).toBeNull();
  });
});
