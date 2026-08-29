/* ============================================================
   server/routes/report-cards.js — GET /:id/html + POST /preview-html
   (Consolidation Plan Phase 4 step 3 / RC3)

   Separate file from ../report-cards.test.js because these routes
   need a real req.jwtUser (that file's authMiddleware mock is a bare
   pass-through, suited to the public /verify endpoint it tests) —
   same "one file per testing concern" convention
   report-cards-tenant-isolation.test.js / report-cards-notify.test.js
   already use for this router.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockCurrentUser;
let mockSnapshot;
let mockPrevSnapshot;
let mockSchoolDoc;
let mockIncidentsAgg;
let mockLastPointsReset;
let mockAssessmentConfig = { customTypes: [], subjectTeacherCommentsEnabled: true };
let mockInvoices = [];
const mockAuditLogCreate = jest.fn().mockResolvedValue({});

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return { findOne: jest.fn().mockReturnValue({ lean: jest.fn(() => Promise.resolve(mockSchoolDoc)) }) };
    }
    if (col === 'behaviour_incidents') {
      return { aggregate: jest.fn(() => Promise.resolve(mockIncidentsAgg)) };
    }
    if (col === 'behaviour_points_resets') {
      return { find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn(() => Promise.resolve(mockLastPointsReset)) }) }) }) };
    }
    if (col === 'mark_audit_log') {
      return { create: mockAuditLogCreate };
    }
    return {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      find:    jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'report_card_snapshots') {
      return {
        findOne: jest.fn((filter) => {
          // First call (by id) returns the primary snapshot; the
          // previous-term lookup (by termNumber) returns mockPrevSnapshot.
          if (filter.id) return mockChain(mockSnapshot);
          return mockChain(mockPrevSnapshot);
        }),
      };
    }
    if (col === 'invoices') return { find: jest.fn(() => mockChain(mockInvoices)) };
    if (col === 'mark_audit_log') return { create: mockAuditLogCreate };
    if (col === 'assessment_config') return { findOne: jest.fn(() => mockChain(mockAssessmentConfig)) };
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
  behaviourSummary:         jest.fn(async () => (mockIncidentsAgg[0]
    ? { merits: mockIncidentsAgg[0].merits, demerits: mockIncidentsAgg[0].demerits, points: mockIncidentsAgg[0].points, total: mockIncidentsAgg[0].total }
    : { merits: 0, demerits: 0, points: 0, total: 0 })),
  attachDeviations: jest.fn(r => r),
  computeTermDeviation: jest.fn((current, prev) => {
    const subjects = {};
    for (const [id, d] of Object.entries(current || {})) {
      const c = d?.finalScore ?? null, p = prev?.[id]?.finalScore ?? null;
      subjects[id] = (c != null && p != null) ? c - p : null;
    }
    return { subjects };
  }),
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

function baseSnapshot(overrides = {}) {
  return {
    id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', status: 'published', superseded: false,
    studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'Grade 7',
    termName: 'Term 1', academicYear: '2026', termNumber: 1, academicYearId: 'ay1', classId: 'cls1',
    schoolName: 'Test School',
    assessmentWeights: [{ assessmentType: 'cat', label: 'CAT', weight: 40 }, { assessmentType: 'exam', label: 'Exam', weight: 60 }],
    gradingSchema: [{ min: 80, grade: 'A', points: 12, label: 'Excellent' }, { min: 0, grade: 'C', points: 6, label: 'Average' }],
    subjects: { math: { finalScore: 85, grade: 'A', breakdown: { cat: 80, exam: 88 } } },
    totalScore: 85, averageScore: 85, gpa: 4.0,
    rankings: { class: { rank: 1, outOf: 20 } },
    comments: { classTeacherName: 'Mrs O', principalName: 'Dr K', classTeacherRemark: 'Great', principalRemark: 'Well done' },
    version: 1, financialBlock: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { schoolId: SCHOOL, role: 'admin', userId: 'u_admin', guardianOf: [] };
  mockSnapshot = baseSnapshot();
  mockPrevSnapshot = null;
  mockSchoolDoc = { name: 'Test School', logoUrl: null, tagline: '', portalConfig: {} };
  mockIncidentsAgg = [];
  mockLastPointsReset = [];
  mockAssessmentConfig = { customTypes: [], subjectTeacherCommentsEnabled: true };
  mockInvoices = [];
});

describe('GET /api/report-cards/:id/html', () => {
  test('404s when the snapshot does not exist', async () => {
    mockSnapshot = null;
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_missing/html');
    expect(res.status).toBe(404);
  });

  test('returns rendered HTML containing the student name and school name for a valid snapshot', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('Jane Doe');
    expect(res.body.data.html).toContain('Test School');
    expect(res.body.data.html).toContain('<!DOCTYPE html>');
  });

  test('a student can only fetch their own report card', async () => {
    mockCurrentUser = { schoolId: SCHOOL, role: 'student', studentId: 'stu_OTHER', guardianOf: [] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(403);
  });

  test('a guardian not linked to the student is denied and an audit entry is logged', async () => {
    mockCurrentUser = { schoolId: SCHOOL, role: 'guardian', userId: 'u_g1', guardianOf: ['stu_someone_else'] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(403);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'GUARDIAN_ACCESS_DENIED' }));
  });

  test('a linked guardian CAN fetch the html', async () => {
    mockCurrentUser = { schoolId: SCHOOL, role: 'guardian', userId: 'u_g1', guardianOf: ['stu_1'] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(200);
  });

  test('a superseded snapshot is blocked for restricted roles (parent/student/guardian)', async () => {
    mockSnapshot = baseSnapshot({ superseded: true });
    mockCurrentUser = { schoolId: SCHOOL, role: 'student', studentId: 'stu_1', guardianOf: [] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(403);
  });

  test('renders a HISTORICAL... draft watermark for a non-published status, none for published', async () => {
    const appPublished = buildApp();
    const pubRes = await supertest(appPublished).get('/report-cards/snap_1/html');
    expect(pubRes.body.data.html).not.toContain('DRAFT');

    mockSnapshot = baseSnapshot({ status: 'draft' });
    const appDraft = buildApp();
    const draftRes = await supertest(appDraft).get('/report-cards/snap_1/html');
    expect(draftRes.body.data.html).toContain('DRAFT');
  });

  test('includes behaviour stats in the rendered html when incidents exist', async () => {
    mockIncidentsAgg = [{ _id: 'stu_1', merits: 5, demerits: 1, points: 4, total: 6 }];
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(200);
    expect(res.body.data.html).toMatch(/Merits[\s\S]*?>5</);
  });
});

/* ── Security Baseline Register, CFG-03 ────────────────────────
   The fee-clearance gate's ?force=1 override used to be available to
   ANY role that reaches _checkSnapshotAccess — including self-service
   parent/student/guardian callers — with no authorization check and no
   audit trail, despite the code's own comment saying "Admins and
   force=1 always bypass" (i.e. force=1 was meant to be an admin-only
   escape hatch, not a universal one). Fixed: force=1 now requires
   admin/superadmin, is denied+audited otherwise, and is itself
   audited when a genuine admin uses it. ───────────────────────── */
describe('GET /:id/html — fee-clearance ?force=1 override (CFG-03)', () => {
  function setUnpaidBelowThreshold() {
    mockSchoolDoc = { ...mockSchoolDoc, portalConfig: { reportCardFeeThreshold: 100 } };
    mockInvoices = [{ total: 1000, balance: 1000 }]; // 0% cleared, well below any threshold
  }

  test('a non-admin below the fee threshold is blocked (no force param)', async () => {
    setUnpaidBelowThreshold();
    mockCurrentUser = { schoolId: SCHOOL, role: 'student', studentId: 'stu_1', guardianOf: [] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(403);
    expect(res.body.financialBlock).toBe(true);
  });

  test.each(['student', 'parent', 'guardian', 'teacher'])(
    'role=%s sending ?force=1 is denied, not granted a bypass, and the attempt is audited',
    async (role) => {
      setUnpaidBelowThreshold();
      mockCurrentUser = role === 'student'
        ? { schoolId: SCHOOL, role, studentId: 'stu_1', guardianOf: [] }
        : role === 'teacher'
        ? { schoolId: SCHOOL, role, userId: 'u_t1', guardianOf: [] }
        : { schoolId: SCHOOL, role, userId: 'u_g1', guardianOf: ['stu_1'] }; // parent/guardian, correctly linked
      const app = buildApp();
      const res = await supertest(app).get('/report-cards/snap_1/html?force=1');
      expect(res.status).toBe(403);
      expect(res.body.error?.message ?? res.body.error).toMatch(/administrator/i);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_CLEARANCE_OVERRIDE_DENIED', requestedRole: role }));
    }
  );

  test('an admin is never blocked by fee status, with or without force=1', async () => {
    setUnpaidBelowThreshold();
    mockCurrentUser = { schoolId: SCHOOL, role: 'admin', userId: 'u_admin', guardianOf: [] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html');
    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_CLEARANCE_OVERRIDDEN' }));
  });

  test('an admin explicitly using ?force=1 succeeds AND the override itself is audited', async () => {
    setUnpaidBelowThreshold();
    mockCurrentUser = { schoolId: SCHOOL, role: 'superadmin', userId: 'u_sa', guardianOf: [] };
    const app = buildApp();
    const res = await supertest(app).get('/report-cards/snap_1/html?force=1');
    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_CLEARANCE_OVERRIDDEN', requestedRole: 'superadmin', snapshotId: 'snap_1' }));
  });
});

describe('POST /api/report-cards/preview-html', () => {
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
      config: { gradeScale: { bands: [{ min: 80, grade: 'A', points: 12, label: 'Excellent' }, { min: 0, grade: 'C', points: 6, label: 'Average' }] }, rankingEnabled: true, showGPA: true },
      ...overrides,
    };
  }

  test('422s when the required student field is missing', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/report-cards/preview-html').send({});
    expect(res.status).toBe(422);
  });

  test('returns rendered HTML echoing the client-supplied student/class/comments data, no DB round trip needed', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/report-cards/preview-html').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('Jane Doe');
    expect(res.body.data.html).toContain('Grade 7');
    expect(res.body.data.html).toContain('Great term');
    expect(res.body.data.html).toContain('+3.2'); // client-supplied term-over-term deviation
  });

  test('always renders a DRAFT watermark, regardless of input (preview is never "published")', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/report-cards/preview-html').send(validBody());
    expect(res.body.data.html).toContain('DRAFT');
  });

  test('carries the class rank straight through from the client-supplied student.rankings (no re-aggregation)', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/report-cards/preview-html').send(validBody());
    expect(res.body.data.html).toContain('1/20');
  });

  test('missing optional fields (school/draftComment/behaviour/deviations) do not crash — safe defaults', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/report-cards/preview-html').send({
      student: { studentId: 'stu_1', subjects: {} },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('<!DOCTYPE html>');
  });
});
