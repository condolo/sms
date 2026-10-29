/* ============================================================
   server/routes/report-cards.js — POST /preview-pdf (2026-10-24)

   Direct-download PDF counterpart to POST /preview-html, added on
   request: before this route existed, downloading a PDF of an
   unpublished report card meant Print → the browser's own "Save as
   PDF" dialog over the HTML preview. This route shares the exact same
   validation/snap/sections construction as /preview-html (see
   report-cards-html.test.js's own mocks, mirrored here) — only the
   adapter differs (renderPdf instead of renderHtml).

   RCE9 (2026-10-29): this route now prints the same HTML
   GET /:id/html/POST /preview-html return, via html-to-pdf.js's shared
   headless-Chromium instance, instead of a separate PDFKit renderer —
   see that file's own header for why. html-to-pdf.js is mocked here
   (a real Puppeteer launch is slow, and some of its dependencies are
   ESM-only, which Jest's default transform can't parse) — the actual
   rendering correctness is covered by report-layouts-*.test.js's direct
   renderHtml() assertions and by a manual end-to-end Puppeteer render
   against real data (see CHANGELOG). What this test verifies is that
   the route builds the right sections/HTML and returns a 200 with
   application/pdf — not whether a real browser can render HTML, which
   doesn't belong in a unit-test suite. All DB calls are mocked — no
   MongoDB required.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockCurrentUser;
let mockSchoolDoc;
let mockAssessmentConfig = { customTypes: [], subjectTeacherCommentsEnabled: true };
let mockAcademicConfig = { rankingEnabled: true, showRankOnReport: true, showGPA: true };
let mockTeachingAssignments = [];
const mockSnapshotFindOne = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../../utils/html-to-pdf', () => ({
  htmlToPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake pdf for tests')),
}));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn(() => Promise.resolve(mockSchoolDoc)) }) };
    }
    return {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      find:    jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'report_card_snapshots') return { findOne: mockSnapshotFindOne };
    if (col === 'teaching_assignments')  return { find: jest.fn(() => mockChain(mockTeachingAssignments)) };
    if (col === 'assessment_config')     return { findOne: jest.fn(() => mockChain(mockAssessmentConfig)) };
    if (col === 'academic_config')       return { findOne: jest.fn(() => mockChain(mockAcademicConfig)) };
    return { findOne: jest.fn(() => mockChain(null)), find: jest.fn(() => mockChain([])) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req?.jwtUser?.schoolId ?? null })),
}));

jest.mock('../../utils/academic-calc', () => ({
  aggregateGrades:          jest.fn().mockResolvedValue({}),
  aggregateExamResults:     jest.fn().mockResolvedValue({ data: {}, examStatuses: [] }),
  aggregateAssessmentMarks: jest.fn().mockResolvedValue({}),
  computeFinalScores:       jest.fn().mockReturnValue({}),
  attendanceSummary:        jest.fn().mockResolvedValue({ daysPresent: 0, daysAbsent: 0, totalSchoolDays: 0, percentage: null }),
  behaviourSummary:         jest.fn().mockResolvedValue({ merits: 0, demerits: 0, points: 0, total: 0 }),
  attachDeviations: jest.fn(r => r),
  computeTermDeviation: jest.fn(() => ({ subjects: {} })),
}));

jest.mock('../../routes/academic-config', () => ({
  mergeConfig: jest.fn(c => c ?? {}),
  resolveGrade: jest.fn((score) => ({ grade: score >= 80 ? 'A' : 'B', points: 10, descriptor: 'Good', remarks: '' })),
}));

const express   = require('express');
const supertest = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/report-cards', reportCardsRouter);
  return app;
}

function validBody(overrides = {}) {
  return {
    student: {
      studentId: 'stu_1',
      subjects: { math: { finalScore: 85, grade: 'A', breakdown: { cat: 80, exam: 88 } } },
      totalScore: 85, averageScore: 85, gpa: 4.0, subjectCount: 1,
      rankings: { class: { rank: 1, outOf: 20 } },
      classTeacherName: 'Mrs O',
    },
    studentInfo: { firstName: 'Jane', lastName: 'Doe', admissionNumber: 'ADM001' },
    className: 'Grade 7', termNum: 1, academicYear: '2026',
    school: { name: 'Test School', logoUrl: null, tagline: '' },
    draftComment: { classTeacherRemark: 'Great term', principalRemark: '', subjectComments: { math: 'Good' } },
    studentDeviations: { subjects: { math: 3.2 } },
    behaviourSummary: { merits: 2, demerits: 0, points: 2, total: 2 },
    config: { gradeScale: { bands: [{ min: 80, grade: 'A', points: 12, label: 'Excellent' }, { min: 0, grade: 'C', points: 6, label: 'Average' }] } },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { schoolId: SCHOOL, role: 'admin', userId: 'u_admin', guardianOf: [] };
  mockSchoolDoc = { name: 'Test School', logoUrl: null, tagline: '', portalConfig: {} };
  mockAssessmentConfig = { customTypes: [], subjectTeacherCommentsEnabled: true };
  mockAcademicConfig = { rankingEnabled: true, showRankOnReport: true, showGPA: true };
  mockTeachingAssignments = [];
  mockSnapshotFindOne.mockReturnValue(mockChain(null));
});

describe('POST /api/report-cards/preview-pdf', () => {
  test('422s when the required student field is missing', async () => {
    const res = await supertest(buildApp()).post('/report-cards/preview-pdf').send({});
    expect(res.status).toBe(422);
    expect(mockSnapshotFindOne).not.toHaveBeenCalled();
  });

  test('returns a real, non-empty application/pdf response for a full draft body', async () => {
    const res = await supertest(buildApp()).post('/report-cards/preview-pdf').send(validBody());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
  });

  // The whole point: no persisted snapshot is needed, or even looked at —
  // this is the pre-publish case /preview-html already covers for HTML.
  test('never touches report_card_snapshots — a draft has no persisted record to read', async () => {
    const res = await supertest(buildApp()).post('/report-cards/preview-pdf').send(validBody());
    expect(res.status).toBe(200);
    expect(mockSnapshotFindOne).not.toHaveBeenCalled();
  });

  test('missing optional fields (school/draftComment/behaviour/deviations) do not crash — safe defaults', async () => {
    const res = await supertest(buildApp()).post('/report-cards/preview-pdf').send({
      student: { studentId: 'stu_1', subjects: {} },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('resolves the subject teacher\'s name from teaching_assignments once classId is sent (same live lookup preview-html uses)', async () => {
    mockTeachingAssignments = [{ subjectId: 'math', teacherName: 'Mr. Kamau' }];
    const res = await supertest(buildApp()).post('/report-cards/preview-pdf').send(validBody({ classId: 'cls_7a' }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});
