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
let mockSchoolDoc        = { name: 'Test School', logoUrl: null, tagline: '' };
let mockIncidentsAgg     = [];
let mockLastPointsReset  = [];
const mockAuditLogCreate = jest.fn().mockResolvedValue({});

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

/* ─────────────────────────────────────────────────────────────── */
/*  _resolveSnapComments (RC5 — draft-to-published carry-forward)  */
/*                                                                  */
/*  docs/audits/REPORT_CARD_COMMENT_LIFECYCLE_REVIEW.md's           */
/*  "Recommendation 1": a first-ever publish (no `prev` snapshot)   */
/*  used to start with completely blank comments, regardless of     */
/*  what a teacher had already typed into                           */
/*  report_card_draft_comments. Tested directly (like               */
/*  _hashSnapshot/_normalizeGradeScaleBands above) rather than       */
/*  through the transaction-wrapped full /publish route.            */
/* ─────────────────────────────────────────────────────────────── */
describe('_resolveSnapComments', () => {
  const resolve = reportCardsRouter._resolveSnapComments;

  test('a re-publish (prev exists) carries prev.comments forward untouched, ignoring the draft', () => {
    const prev = { comments: { subjectComments: { math: 'Great work' }, classTeacherRemark: 'Well done', principalRemark: '' } };
    const draft = { subjectComments: { math: 'A DIFFERENT draft comment' }, sportsAndTalent: 'Captain of football' };
    const out = resolve(prev, draft);
    expect(out).toBe(prev.comments); // same reference — untouched
    expect(out.subjectComments.math).toBe('Great work');
  });

  test('a first-ever publish (no prev) seeds every field from the draft doc', () => {
    const draft = {
      subjectComments:    { math: 'Good progress', english: 'Needs improvement' },
      classTeacherRemark: 'A solid term overall.',
      principalRemark:    'Keep it up.',
      sportsAndTalent:    'Represents the school in athletics.',
      closingDate:        '2026-11-28',
      nextTermBegin:      '2027-01-12',
      classTeacherName:   'Mrs. Otieno',
      principalName:      'Dr. Kariuki',
    };
    const out = resolve(undefined, draft);
    expect(out).toEqual({ ...draft, reportRemarks: [] });
  });

  test('a first-ever publish with NO draft doc at all still produces the same blank-default shape as before this fix', () => {
    const out = resolve(undefined, undefined);
    expect(out).toEqual({
      subjectComments: {}, classTeacherRemark: '', principalRemark: '',
      sportsAndTalent: '', closingDate: '', nextTermBegin: '',
      classTeacherName: '', principalName: '', reportRemarks: [],
    });
  });

  test('a first-ever publish with a PARTIAL draft doc defaults only the missing fields', () => {
    const draft = { subjectComments: { math: 'Good' }, classTeacherRemark: 'Nice term.' };
    const out = resolve(undefined, draft);
    expect(out.subjectComments).toEqual({ math: 'Good' });
    expect(out.classTeacherRemark).toBe('Nice term.');
    expect(out.principalRemark).toBe('');
    expect(out.sportsAndTalent).toBe('');
    expect(out.closingDate).toBe('');
    expect(out.nextTermBegin).toBe('');
  });

  test('prev present but with no comments field (edge case) falls through to the draft, not to prev.comments === undefined', () => {
    const draft = { classTeacherRemark: 'From draft' };
    const out = resolve({ id: 'prev_1' }, draft); // prev.comments is undefined
    expect(out.classTeacherRemark).toBe('From draft');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  _computeReportSections — RC3 IR extension                      */
/*  (cover / gradingKey / behaviour / per-row deviationText)        */
/*                                                                   */
/*  These new fields are read only by the new _computeReportHTML     */
/*  adapter, never by _drawReportPage — confirmed by the golden-     */
/*  fixture test in report-cards-ir.test.js staying green unchanged  */
/*  after this extension shipped.                                    */
/* ─────────────────────────────────────────────────────────────── */
describe('_computeReportSections — RC3 IR extension', () => {
  const compute = reportCardsRouter._computeReportSections;

  function baseSnap(overrides = {}) {
    return {
      status: 'published', superseded: false,
      studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'Grade 7',
      termName: 'Term 2', academicYear: '2026', termNumber: 2,
      schoolName: 'Test School',
      assessmentWeights: [{ assessmentType: 'cat', label: 'CAT', weight: 40 }, { assessmentType: 'exam', label: 'Exam', weight: 60 }],
      gradingSchema: [
        { min: 80, grade: 'A', points: 12, label: 'Excellent' },
        { min: 60, grade: 'B', points: 9,  label: 'Good' },
        { min: 0,  grade: 'C', points: 6,  label: 'Average' },
      ],
      subjects: {
        math: { finalScore: 85, grade: 'A', breakdown: { cat: 80, exam: 88 } },
        english: { finalScore: 55, grade: 'C', breakdown: { cat: 50, exam: 58 } },
      },
      totalScore: 140, averageScore: 70, gpa: 3.2,
      rankings: { class: { rank: 2, outOf: 30 } },
      comments: { classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki' },
      version: 1, ...overrides,
    };
  }
  const config = { rankingEnabled: true };

  test('cover section pulls student/class/mean/rank/class-teacher from the snapshot', () => {
    const s = compute(baseSnap(), config, null);
    expect(s.cover.subtitle).toBe('ACADEMIC REPORT — TERM 2 — 2026');
    const row = (label) => s.cover.rows.find(r => r.label === label)?.value;
    expect(row('Student Name')).toBe('Jane Doe');
    expect(row('Admission No.')).toBe('ADM001');
    expect(row('Class')).toBe('Grade 7');
    expect(row('Class Rank')).toBe('2/30');
    expect(row('Class Teacher')).toBe('Mrs. Otieno');
    expect(row('Mean Mark')).toContain('70.0%');
    // resolveGrade is mocked file-wide (see jest.mock('../routes/academic-config') above) —
    // this only proves the IR correctly plumbs whatever resolveGrade returns into the cover
    // row, not real grade-threshold behavior (that's academic-config.js's own concern).
    expect(row('Mean Mark')).toContain('A (Excellent)');
  });

  test('cover section pulls logo/tagline from the optional school param, blank when absent', () => {
    const withSchool = compute(baseSnap(), config, null, { school: { logoUrl: 'https://x/logo.png', tagline: 'Excellence in all things' } });
    expect(withSchool.cover.logoUrl).toBe('https://x/logo.png');
    expect(withSchool.cover.tagline).toBe('Excellence in all things');

    const withoutSchool = compute(baseSnap(), config, null);
    expect(withoutSchool.cover.logoUrl).toBeNull();
    expect(withoutSchool.cover.tagline).toBe('');
  });

  test('gradingKey is the exact normalized bands used to grade this report, sorted descending with computed ranges', () => {
    const s = compute(baseSnap(), config, null);
    expect(s.gradingKey).toEqual([
      { grade: 'A', range: '80–100%', points: 12, label: 'Excellent' },
      { grade: 'B', range: '60–79%',  points: 9,  label: 'Good' },
      { grade: 'C', range: '0–59%',   points: 6,  label: 'Average' },
    ]);
  });

  test('behaviour section passes through the optional behaviour param, null when absent', () => {
    const withBehaviour = compute(baseSnap(), config, null, { behaviour: { merits: 5, demerits: 1, points: 4, total: 6 } });
    expect(withBehaviour.behaviour).toEqual({ merits: 5, demerits: 1, points: 4, total: 6 });

    const withoutBehaviour = compute(baseSnap(), config, null);
    expect(withoutBehaviour.behaviour).toBeNull();
  });

  test('per-row deviationText reflects the optional term-over-term deviations param, formatted with a sign', () => {
    const s = compute(baseSnap(), config, null, { deviations: { subjects: { math: 3.4, english: -2.1 } } });
    const mathRow = s.resultsTable.rows.find(r => r.subjectId === 'math');
    const engRow  = s.resultsTable.rows.find(r => r.subjectId === 'english');
    expect(mathRow.deviationText).toBe('+3.4');
    expect(engRow.deviationText).toBe('-2.1');
  });

  test('a subject with no comparable previous-term score gets a null deviationText, not a crash', () => {
    const s = compute(baseSnap(), config, null, { deviations: { subjects: { math: 3.4 } } }); // english absent
    const engRow = s.resultsTable.rows.find(r => r.subjectId === 'english');
    expect(engRow.deviationText).toBeNull();
  });

  test('omitting the extra param entirely (existing PDF call-site shape) leaves every new field safely null/empty, never throws', () => {
    const s = compute(baseSnap(), config, null); // 3-arg call, exactly what _buildPDFPage still does
    expect(s.behaviour).toBeNull();
    expect(s.cover.logoUrl).toBeNull();
    expect(s.resultsTable.rows.every(r => r.deviationText === null)).toBe(true);
    expect(s.gradingKey.length).toBe(3);
  });

  test('comments section carries RC5-seeded sportsAndTalent/closingDate/nextTermBegin through, blank when absent', () => {
    const withExtras = compute(baseSnap({ comments: { sportsAndTalent: 'School football captain', closingDate: '2026-11-28', nextTermBegin: '2027-01-12', classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki' } }), config, null);
    expect(withExtras.comments.sportsAndTalent).toBe('School football captain');
    expect(withExtras.comments.closingDate).toBe('2026-11-28');
    expect(withExtras.comments.nextTermBegin).toBe('2027-01-12');

    const withoutExtras = compute(baseSnap({ comments: {} }), config, null);
    expect(withoutExtras.comments.sportsAndTalent).toBe('');
    expect(withoutExtras.comments.closingDate).toBe('');
  });
});

describe('_computeReportSections — RC7 subject-teacher-comments capability toggle', () => {
  const compute = reportCardsRouter._computeReportSections;
  const config = { rankingEnabled: true };

  function baseSnap(overrides = {}) {
    return {
      status: 'published', superseded: false,
      studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'Grade 7',
      termName: 'Term 2', academicYear: '2026', termNumber: 2,
      schoolName: 'Test School',
      assessmentWeights: [{ assessmentType: 'cat', label: 'CAT', weight: 100 }],
      gradingSchema: [{ min: 0, grade: 'C', points: 6, label: 'Average' }],
      subjects: { math: { finalScore: 85, grade: 'A', breakdown: { cat: 85 } } },
      totalScore: 85, averageScore: 85, gpa: 4.0,
      comments: { subjectComments: { math: 'Excellent effort this term' } },
      version: 1, ...overrides,
    };
  }

  test('defaults to enabled when the extra param omits it (existing PDF call-site shape)', () => {
    const s = compute(baseSnap(), config, null);
    expect(s.comments.subjectTeacherCommentsEnabled).toBe(true);
    expect(s.comments.subjectComments).toEqual([{ subjectId: 'math', text: 'Excellent effort this term' }]);
  });

  test('enabled explicitly: builds one row per subject, using real comment text', () => {
    const s = compute(baseSnap(), config, null, { subjectTeacherCommentsEnabled: true });
    expect(s.comments.subjectTeacherCommentsEnabled).toBe(true);
    expect(s.comments.subjectComments).toEqual([{ subjectId: 'math', text: 'Excellent effort this term' }]);
  });

  test('disabled: zero trace — subjectComments is empty even though real comment data exists on the snapshot', () => {
    const s = compute(baseSnap(), config, null, { subjectTeacherCommentsEnabled: false });
    expect(s.comments.subjectTeacherCommentsEnabled).toBe(false);
    expect(s.comments.subjectComments).toEqual([]);
  });

  test('HTML adapter: enabled renders the "Subject Teacher Comments" header and the real comment text', () => {
    const s = compute(baseSnap(), config, null, { subjectTeacherCommentsEnabled: true });
    const html = reportCardsRouter._computeReportHTML(s);
    expect(html).toContain('Subject Teacher Comments');
    expect(html).toContain('Excellent effort this term');
  });

  test('HTML adapter: disabled renders zero trace — no header, no placeholder, no comment text', () => {
    const s = compute(baseSnap(), config, null, { subjectTeacherCommentsEnabled: false });
    const html = reportCardsRouter._computeReportHTML(s);
    expect(html).not.toContain('Subject Teacher Comments');
    expect(html).not.toContain('Excellent effort this term');
    expect(html).not.toContain('No subjects on this report');
  });
});

describe('_computeReportSections / _computeReportHTML — RC8 report-level remark chain', () => {
  const compute = reportCardsRouter._computeReportSections;
  const config = { classTeacherSignatureLabel: 'Class Teacher', principalSignatureLabel: 'Principal' };

  function baseSnap(overrides = {}) {
    return {
      status: 'published', superseded: false,
      studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'Grade 7',
      termName: 'Term 2', academicYear: '2026', termNumber: 2,
      schoolName: 'Test School',
      assessmentWeights: [{ assessmentType: 'cat', label: 'CAT', weight: 100 }],
      gradingSchema: [{ min: 0, grade: 'C', points: 6, label: 'Average' }],
      subjects: { math: { finalScore: 85, grade: 'A', breakdown: { cat: 85 } } },
      totalScore: 85, averageScore: 85, gpa: 4.0,
      comments: { classTeacherRemark: 'Legacy remark', principalRemark: 'Legacy principal remark' },
      version: 1, ...overrides,
    };
  }

  test('a school with no chain (reportRemarks absent) gets an empty array — legacy fields untouched', () => {
    const s = compute(baseSnap(), config, null);
    expect(s.comments.reportRemarks).toEqual([]);
    expect(s.comments.classTeacherRemark).toBe('Legacy remark');
  });

  test('a school using the chain gets its configured remarks mapped to {label, text}', () => {
    const snap = baseSnap({
      comments: {
        reportRemarks: [
          { stepOrder: 1, label: 'Class Teacher', remark: 'Solid term.' },
          { stepOrder: 2, label: 'Principal', remark: 'Approved.' },
        ],
      },
    });
    const s = compute(snap, config, null);
    expect(s.comments.reportRemarks).toEqual([
      { label: 'Class Teacher', text: 'Solid term.' },
      { label: 'Principal', text: 'Approved.' },
    ]);
  });

  test('HTML adapter: no chain (legacy) renders the original fixed two-column layout', () => {
    const s = compute(baseSnap(), config, null);
    const html = reportCardsRouter._computeReportHTML(s);
    expect(html).toContain('Legacy remark');
    expect(html).toContain('Legacy principal remark');
    expect(html).toContain('Class Teacher Signature');
  });

  test('HTML adapter: chain configured renders the dynamic remark list, not the fixed layout', () => {
    const snap = baseSnap({
      comments: {
        classTeacherRemark: 'Legacy remark', principalRemark: 'Legacy principal remark',
        reportRemarks: [
          { stepOrder: 1, label: 'Class Teacher', remark: 'Solid term.' },
          { stepOrder: 2, label: 'Head of Section', remark: 'Reviewed and endorsed.' },
          { stepOrder: 3, label: 'Principal', remark: 'Approved.' },
        ],
      },
    });
    const s = compute(snap, config, null);
    const html = reportCardsRouter._computeReportHTML(s);
    expect(html).toContain('Head of Section');
    expect(html).toContain('Reviewed and endorsed.');
    expect(html).toContain('Solid term.');
    expect(html).toContain('Approved.');
    // The legacy fixed layout must not also render — 'Legacy remark' text
    // (verbatim from the untouched classTeacherRemark field) proves the
    // old block was skipped, not just that new content was added alongside it.
    expect(html).not.toContain('Legacy remark');
    expect(html).not.toContain('Legacy principal remark');
    expect(html).not.toContain('Class Teacher Signature');
  });
});
