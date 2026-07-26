/* ============================================================
   server/routes/report-cards.js — _loadRenderExtras (RCE3c)

   Was previously inlined in GET /:id/html only; GET /:id/pdf never
   loaded school/behaviour/deviations/subjectTeacherCommentsEnabled at
   all, which was invisible while legacy_tabular's PDF renderer ignored
   all of them but became a real gap once subject_paired started
   reading them. This is the shared resolver both routes now call —
   including the new subjectTeacherNames map, resolved from
   teaching_assignments.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

let mockSchoolDoc = null;
let mockAssignments = [];
let mockCaConfig = { subjectTeacherCommentsEnabled: true };

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return { findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) };
    }
    throw new Error(`unexpected _model('${col}') call in this test`);
  }),
}));

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'report_card_snapshots') {
      return { findOne: () => ({ lean: () => Promise.resolve(null) }) }; // no prior-term snapshot
    }
    if (col === 'teaching_assignments') {
      return {
        find: () => ({ select: () => ({ lean: () => Promise.resolve(mockAssignments) }) }),
      };
    }
    throw new Error(`unexpected tenantModel('${col}') call in this test`);
  }),
  tenantContext: jest.fn(() => ({})),
}));

jest.mock('../utils/academic-calc', () => ({
  aggregateGrades: jest.fn(), aggregateExamResults: jest.fn(), aggregateAssessmentMarks: jest.fn(),
  computeFinalScores: jest.fn(), attachDeviations: jest.fn(),
  behaviourSummary: jest.fn(() => Promise.resolve({ merits: 3, demerits: 1, points: 2, total: 2 })),
  computeTermDeviation: jest.fn(() => ({ subjects: {} })),
}));

jest.mock('../routes/assessment', () => ({
  getConfig: jest.fn(() => Promise.resolve(mockCaConfig)),
}));

const reportCardsRouter = require('../routes/report-cards');

function baseSnap(overrides = {}) {
  return {
    studentId: 'stu_1', classId: 'cls_1', termNumber: 2, academicYearId: 'ay_1',
    subjects: { math: {}, english: {} },
    ...overrides,
  };
}

beforeEach(() => {
  mockSchoolDoc = { logoUrl: 'https://x/logo.png', tagline: 'Excellence', address: '123 Main St', phone: '0700', email: 'a@b.com', website: 'x.ac.ke' };
  mockAssignments = [
    { subjectId: 'math', teacherName: 'Collins Ndolo' },
    { subjectId: 'english', teacherName: 'Jane Wambui' },
  ];
  mockCaConfig = { subjectTeacherCommentsEnabled: true };
});

describe('_loadRenderExtras', () => {
  test('resolves school, behaviour, deviations, and subjectTeacherCommentsEnabled', async () => {
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.school).toEqual(mockSchoolDoc);
    expect(extra.behaviour).toEqual({ merits: 3, demerits: 1, points: 2, total: 2 });
    expect(extra.subjectTeacherCommentsEnabled).toBe(true);
    expect(extra.deviations).toEqual({ subjects: {} });
  });

  test('builds subjectTeacherNames keyed by subjectId from teaching_assignments', async () => {
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherNames).toEqual({ math: 'Collins Ndolo', english: 'Jane Wambui' });
  });

  test('a subject with no teaching_assignments doc is simply absent from the map, not an error', async () => {
    mockAssignments = [{ subjectId: 'math', teacherName: 'Collins Ndolo' }]; // english has none
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherNames).toEqual({ math: 'Collins Ndolo' });
    expect(extra.subjectTeacherNames.english).toBeUndefined();
  });

  test('the first assignment found per subject wins when more than one exists (co-teaching)', async () => {
    mockAssignments = [
      { subjectId: 'math', teacherName: 'Collins Ndolo' },
      { subjectId: 'math', teacherName: 'Second Teacher' },
    ];
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherNames.math).toBe('Collins Ndolo');
  });

  test('respects the school\'s subjectTeacherCommentsEnabled=false setting', async () => {
    mockCaConfig = { subjectTeacherCommentsEnabled: false };
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherCommentsEnabled).toBe(false);
  });
});
