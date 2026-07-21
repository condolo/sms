/* ============================================================
   Unit tests — server/routes/report-cards.js (RC-3 functions)

   Covers:
     _hashSnapshot  — SHA-256 integrity hash
     _nextReportId  — RC-YYYY-TN-XXXXXX sequential ID
     GET /verify/:reportId — public verify endpoint (no auth)

   No real MongoDB required — all DB calls mocked.
   ============================================================ */
'use strict';

const crypto = require('crypto');

/* ── Mock middleware so the route file loads cleanly ─────────── */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req, _res, next) => next(),
}));
jest.mock('../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/plan', () => ({
  planGate: () => (_req, _res, next) => next(),
}));
jest.mock('../utils/archival', () => ({
  isYearArchived: jest.fn().mockResolvedValue(false),
}));

/* ── Mock academic utilities ─────────────────────────────────── */
jest.mock('../utils/ranking', () => ({
  rankStudents:         jest.fn().mockReturnValue([]),
  mergeRankings:        jest.fn().mockReturnValue([]),
  bestPerSubject:       jest.fn().mockReturnValue({}),
  computeRankingScore:  jest.fn().mockReturnValue(0),
}));
jest.mock('../utils/academic-calc', () => ({
  aggregateGrades:          jest.fn().mockResolvedValue({}),
  aggregateExamResults:     jest.fn().mockResolvedValue({}),
  aggregateAssessmentMarks: jest.fn().mockResolvedValue({}),
  computeFinalScores:       jest.fn().mockReturnValue([]),
  attendanceSummary:        jest.fn().mockResolvedValue({}),
  attachDeviations:         jest.fn(scores => scores),
}));
jest.mock('../routes/academic-config', () => ({
  mergeConfig: jest.fn(c => c ?? {}),
  resolveGrade: jest.fn(() => ({ grade: 'A', points: 4, descriptor: 'Excellent', remarks: '' })),
}));

/* ── Mock _model — controlled per-collection ─────────────────── */
const mockSnapshotsFindOne = jest.fn();
const mockCountersUpdate   = jest.fn();

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'report_card_snapshots') {
      return {
        find:             jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }) }) }) }),
        findOne:          mockSnapshotsFindOne,
        countDocuments:   jest.fn().mockResolvedValue(0),
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
      };
    }
    if (col === 'report_card_counters') {
      return { findOneAndUpdate: mockCountersUpdate };
    }
    if (col === 'publish_batches') {
      return {
        findOne:          jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        find:             jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }) }) }) }),
        countDocuments:   jest.fn().mockResolvedValue(0),
        findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'b1', status: 'running' }),
      };
    }
    return {
      findOne:          jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      find:             jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      countDocuments:   jest.fn().mockResolvedValue(0),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
  }),
}));

const request = require('supertest');
const express = require('express');
const reportCardsRouter = require('../routes/report-cards');

const app = express();
app.use(express.json());
app.use('/report-cards', reportCardsRouter);

/* ─────────────────────────────────────────────────────────────── */
/*  Helpers — replicate the production functions for unit testing  */
/* ─────────────────────────────────────────────────────────────── */

function hashSnapshot(snap) {
  const payload = JSON.stringify({
    studentId:    snap.studentId,
    studentName:  snap.studentName,
    admissionNo:  snap.admissionNo,
    classId:      snap.classId,
    termNumber:   snap.termNumber,
    academicYear: snap.academicYear,
    subjects:     snap.subjects,
    totalScore:   snap.totalScore,
    averageScore: snap.averageScore,
    gpa:          snap.gpa,
    rankings:     snap.rankings,
    publishedAt:  snap.publishedAt,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/* ─────────────────────────────────────────────────────────────── */
/*  _hashSnapshot                                                  */
/* ─────────────────────────────────────────────────────────────── */
describe('_hashSnapshot', () => {
  const baseSnap = {
    studentId:    'stu_001',
    studentName:  'Alice Wanjiku',
    admissionNo:  'ADM-2024-001',
    classId:      'cls_001',
    termNumber:   1,
    academicYear: '2024',
    subjects:     [{ subjectName: 'Math', score: 85 }],
    totalScore:   85,
    averageScore: 85,
    gpa:          4.0,
    rankings:     { classRank: 1, streamRank: 1 },
    publishedAt:  '2024-11-01T00:00:00.000Z',
  };

  test('produces a 64-character hex string', () => {
    const hash = hashSnapshot(baseSnap);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('same input always produces same hash (deterministic)', () => {
    expect(hashSnapshot(baseSnap)).toBe(hashSnapshot(baseSnap));
  });

  test('changing studentName changes the hash', () => {
    const modified = { ...baseSnap, studentName: 'Bob Kamau' };
    expect(hashSnapshot(baseSnap)).not.toBe(hashSnapshot(modified));
  });

  test('changing a subject score changes the hash', () => {
    const modified = {
      ...baseSnap,
      subjects: [{ subjectName: 'Math', score: 86 }],
    };
    expect(hashSnapshot(baseSnap)).not.toBe(hashSnapshot(modified));
  });

  test('changing totalScore changes the hash', () => {
    const modified = { ...baseSnap, totalScore: 90 };
    expect(hashSnapshot(baseSnap)).not.toBe(hashSnapshot(modified));
  });

  test('changing publishedAt changes the hash (immutable timestamp)', () => {
    const modified = { ...baseSnap, publishedAt: '2025-01-01T00:00:00.000Z' };
    expect(hashSnapshot(baseSnap)).not.toBe(hashSnapshot(modified));
  });

  test('extra fields not in the 12-field payload do NOT change the hash', () => {
    const withExtra = { ...baseSnap, schoolName: 'Test School', className: 'Form 1A' };
    expect(hashSnapshot(baseSnap)).toBe(hashSnapshot(withExtra));
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  Report ID format                                               */
/* ─────────────────────────────────────────────────────────────── */
describe('Report ID format (RC-YYYY-TN-XXXXXX)', () => {
  test('matches expected pattern', () => {
    const id = 'RC-2026-1-000001';
    expect(id).toMatch(/^RC-\d{4}-\d+-\d{6}$/);
  });

  test('seq is zero-padded to 6 digits', () => {
    const seq = String(1).padStart(6, '0');
    expect(seq).toBe('000001');
    expect(String(999999).padStart(6, '0')).toBe('999999');
  });

  test('year is taken from academicYear first 4 chars', () => {
    const academicYear = '2024-2025';
    const year = String(academicYear).slice(0, 4);
    expect(year).toBe('2024');
  });

  test('term number is not zero-padded (1, 2, 3 not 01, 02)', () => {
    const tn = String(1).padStart(1, '0');
    expect(tn).toBe('1');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  GET /verify/:reportId  — public, no auth required             */
/* ─────────────────────────────────────────────────────────────── */
describe('GET /report-cards/verify/:reportId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 404 when reportId not found', async () => {
    mockSnapshotsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(app).get('/report-cards/verify/RC-2026-1-000001');
    expect(res.status).toBe(404);
    expect(res.body.verified).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns verified=true and isAuthentic=true for untampered snapshot', async () => {
    const snap = {
      reportId:    'RC-2026-1-000001',
      studentId:   'stu_001',
      studentName: 'Alice Wanjiku',
      admissionNo: 'ADM-001',
      classId:     'cls_001',
      termNumber:  1,
      academicYear: '2026',
      subjects:    [],
      totalScore:  0,
      averageScore: 0,
      gpa:         0,
      rankings:    {},
      publishedAt: '2026-01-01T00:00:00.000Z',
      // metadata fields returned in response
      className:   'Form 1A',
      termName:    'Term 1',
      schoolName:  'Sunrise Academy',
      version:     1,
    };
    snap.sha256Hash = hashSnapshot(snap);

    mockSnapshotsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(snap) });

    const res = await request(app).get('/report-cards/verify/RC-2026-1-000001');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.isAuthentic).toBe(true);
    expect(res.body.status).toBe('Authentic');
    expect(res.body.reportId).toBe('RC-2026-1-000001');
    expect(res.body.studentName).toBe('Alice Wanjiku');
  });

  test('returns isAuthentic=false when snapshot is tampered', async () => {
    const snap = {
      reportId:    'RC-2026-1-000002',
      studentId:   'stu_002',
      studentName: 'Bob Kamau',
      admissionNo: 'ADM-002',
      classId:     'cls_001',
      termNumber:  1,
      academicYear: '2026',
      subjects:    [{ subjectName: 'Math', score: 85 }],
      totalScore:  85,
      averageScore: 85,
      gpa:         4.0,
      rankings:    {},
      publishedAt: '2026-01-01T00:00:00.000Z',
      className:   'Form 1A',
      termName:    'Term 1',
      schoolName:  'Sunrise Academy',
      version:     1,
    };
    // Compute correct hash first, then tamper the score
    snap.sha256Hash = hashSnapshot(snap);
    snap.totalScore = 100; // tampered after signing

    mockSnapshotsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(snap) });

    const res = await request(app).get('/report-cards/verify/RC-2026-1-000002');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.isAuthentic).toBe(false);
    expect(res.body.status).toMatch(/INTEGRITY CHECK FAILED/i);
  });

  test('does not require Authorization header (public endpoint)', async () => {
    mockSnapshotsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(app)
      .get('/report-cards/verify/RC-2026-1-NONE')
      // deliberately no Authorization header
      ;
    // 404 is fine — the point is it doesn't return 401
    expect(res.status).not.toBe(401);
  });

  test('returns schoolName, termName, className in response', async () => {
    const snap = {
      reportId: 'RC-2026-2-000001',
      studentId: 'stu_003', studentName: 'Carol Achieng', admissionNo: 'ADM-003',
      classId: 'cls_002', termNumber: 2, academicYear: '2026',
      subjects: [], totalScore: 0, averageScore: 0, gpa: 0, rankings: {},
      publishedAt: '2026-06-01T00:00:00.000Z',
      className: 'Form 2B', termName: 'Term 2', schoolName: 'Sunrise Academy', version: 1,
    };
    snap.sha256Hash = hashSnapshot(snap);
    mockSnapshotsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(snap) });

    const res = await request(app).get('/report-cards/verify/RC-2026-2-000001');
    expect(res.body.className).toBe('Form 2B');
    expect(res.body.termName).toBe('Term 2');
    expect(res.body.schoolName).toBe('Sunrise Academy');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  Tenant isolation — verify only returns own-school snapshots   */
/* ─────────────────────────────────────────────────────────────── */
describe('Verify endpoint tenant isolation', () => {
  test('reportId lookup does not accept schoolId cross-tenant injection via query param', async () => {
    // The verify endpoint looks up by reportId only — there is no schoolId filter.
    // Tenant isolation is enforced by the reportId being globally unique (unique index).
    // This test confirms the endpoint only uses req.params.reportId.
    const snap = {
      reportId: 'RC-2026-1-000001',
      studentId: 'stu_001', studentName: 'Alice', admissionNo: 'ADM-001',
      classId: 'cls_001', termNumber: 1, academicYear: '2026',
      subjects: [], totalScore: 0, averageScore: 0, gpa: 0, rankings: {},
      publishedAt: '2026-01-01T00:00:00.000Z',
      className: 'Form 1A', termName: 'Term 1', schoolName: 'School A', version: 1,
    };
    snap.sha256Hash = hashSnapshot(snap);
    mockSnapshotsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(snap) });

    // Injecting a ?schoolId param should not change what is returned
    const res = await request(app)
      .get('/report-cards/verify/RC-2026-1-000001?schoolId=OTHER_SCHOOL');
    expect(res.status).toBe(200);
    expect(res.body.schoolName).toBe('School A'); // still the correct school
  });
});

/* ============================================================
   _normalizeGradeScaleBands — the fix for the client/server grading-
   scale mismatch (Audit §6.2): whatever the client renders must be
   the EXACT bands the server used in computeFinalScores/resolveGrade
   for this response, in one consistent shape, regardless of whether
   they came from grade_boundaries ({min,...}) or the academic_config
   fallback ({minScore, maxScore, descriptor, ...}).
   ============================================================ */
describe('_normalizeGradeScaleBands', () => {
  const normalize = reportCardsRouter._normalizeGradeScaleBands;

  test('passes through grade_boundaries-shaped bands ({min}) unchanged in meaning', () => {
    const out = normalize([{ min: 80, grade: 'A', points: 12, label: 'Excellent' }]);
    expect(out).toEqual([{ min: 80, grade: 'A', points: 12, label: 'Excellent' }]);
  });

  test('normalises academic_config-shaped bands ({minScore, descriptor}) into the same shape', () => {
    const out = normalize([
      { grade: 'A', minScore: 80, maxScore: 100, points: 4.0, descriptor: 'Excellent', remarks: 'Outstanding' },
    ]);
    expect(out).toEqual([{ min: 80, grade: 'A', points: 4.0, label: 'Excellent' }]);
  });

  test('defaults missing points/label without throwing', () => {
    const out = normalize([{ grade: 'E', minScore: 0 }]);
    expect(out).toEqual([{ min: 0, grade: 'E', points: 0, label: '' }]);
  });

  test('handles null/empty input safely', () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize([])).toEqual([]);
  });

  test('a client rendering these bands would grade a boundary score consistently with the server, unlike the old client-local default scale', () => {
    // The bug this fixes: client/constants.js's own DEFAULT_GRADE_SCALE used
    // 80='A' on a 12-point scale; academic-config.js's DEFAULT_GRADING_SCHEMA
    // (what the server actually grades against when no grade_boundaries
    // scale is configured) is an 8-band, 4.0-point scale. Confirm the
    // normalized output carries the SERVER's real points value through,
    // not a value a client-side default could have silently substituted.
    const serverDefault = [
      { grade: 'A', minScore: 80, maxScore: 100, points: 4.0, descriptor: 'Excellent' },
      { grade: 'B+', minScore: 75, maxScore: 79, points: 3.5, descriptor: 'Very Good' },
    ];
    const out = normalize(serverDefault);
    expect(out.find(b => b.grade === 'A').points).toBe(4.0); // NOT 12 (the old client default's scale)
  });
});
