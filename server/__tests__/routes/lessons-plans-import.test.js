/* ============================================================
   POST /api/lessons/plans/import/{preview,commit} — the .docx/.csv
   lesson-plan importer's API layer.

   Gates being tested (see server/routes/lessons.js's LESSON PLAN IMPORT
   header comment for the full rationale):
   1. preview NEVER writes a lesson_plans document.
   2. both routes require the dedicated lessons__import grant — plain
      lessons:create is not enough (floor roles bypass, same as
      lessons__template).
   3. ScopeEngine/tenantModel/AuditService reuse — not a parallel system.
   4. idempotency is (teacherId, classId, subjectId, streamId, date) +
      CONTENT hash, not date alone — a same-day, different-content row
      (a real double period) must never be flagged as a duplicate.
   5/6. importBatch provenance + exactly one AuditService entry per batch
      that actually created something.
   7/8. no free-text entity inference; multi-stream is never assumed.

   All DB calls are mocked — no MongoDB required. scopeMiddleware/
   ScopeEngine are NOT mocked, same discipline as lessons-plans.test.js.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';
const SCHOOL_B = 'school_B';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function _getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    const actual = k.includes('.') ? _getPath(doc, k) : doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(actual);
      if ('$exists' in v) {
        const has = actual !== undefined;
        return v.$exists ? has : !has;
      }
      if ('$gte' in v || '$lte' in v) {
        if ('$gte' in v && !(actual >= v.$gte)) return false;
        if ('$lte' in v && !(actual <= v.$lte)) return false;
        return true;
      }
      return true;
    }
    return actual === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    create:         jest.fn((data) => { const doc = { ...data }; docs.push(doc); return Promise.resolve(doc); }),
    _docs: () => docs,
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
let mockHasExplicitSubGrant = jest.fn(() => Promise.resolve(false));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: (...args) => mockHasExplicitSubGrant(...args),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockSchoolDoc, mockTeachingAssignments, mockLessonPlans, mockClasses, mockSubjects, mockAcademicYears;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChainObj(mockSchoolDoc)) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection, ctxOrOpts) => {
    // scopeMiddleware/ScopeEngine call tenantModel('teaching_assignments', {schoolId}) directly (not via a req)
    if (collection === 'teaching_assignments') return mockTeachingAssignments;
    if (collection === 'lesson_plans')         return mockLessonPlans;
    if (collection === 'classes')              return mockClasses;
    if (collection === 'subjects')             return mockSubjects;
    if (collection === 'academic_years')       return mockAcademicYears;
    return mockMakeFakeCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const lessonsRouter = require('../../routes/lessons');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');
const AuditService = require('../../services/audit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lessons', lessonsRouter);
  return app;
}

const TERM_1 = { id: 'term_1', term: 1, label: 'Term 1', name: 'Term 1', startDate: '2026-09-02', endDate: '2026-12-11' };
const ACADEMIC_YEAR = { id: 'ay_2026', schoolId: SCHOOL_A, name: '2026-2027', terms: [TERM_1] };

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockHasExplicitSubGrant = jest.fn(() => Promise.resolve(false));
  mockSchoolDoc = { id: SCHOOL_A, lessonPlanTemplate: null };
  mockLessonPlans = mockMakeFakeCollection([]);
  // Default: the admin caller has a WHOLE-CLASS (no stream split)
  // teaching assignment for cls_yr7/subj_eng, so admin-as-importer tests
  // resolve without needing a streamId on every row. Tests that care
  // about multi-stream/single-stream/no-assignment specifically override
  // this (see asTeacherWithGrant and the per-test overrides below).
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng' },
  ]);
  mockClasses = mockMakeFakeCollection([{ id: 'cls_yr7', schoolId: SCHOOL_A, name: 'Year 7' }]);
  mockSubjects = mockMakeFakeCollection([{ id: 'subj_eng', schoolId: SCHOOL_A, name: 'English' }]);
  mockAcademicYears = mockMakeFakeCollection([ACADEMIC_YEAR]);
  jest.spyOn(AuditService, 'log').mockImplementation(() => {});
  invalidateScopeCache('usr_admin', SCHOOL_A);
  invalidateScopeCache('usr_teacher', SCHOOL_A);
});

function asTeacherWithGrant({ streamId, grant = true } = {}) {
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
  mockHasExplicitSubGrant = jest.fn(() => Promise.resolve(grant));
  mockTeachingAssignments = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, teacherId: 'usr_teacher', classId: 'cls_yr7', subjectId: 'subj_eng', ...(streamId ? { streamId, streamName: 'A' } : {}) },
  ]);
}

const PREVIEW_QS = 'classId=cls_yr7&subjectId=subj_eng&academicYearId=ay_2026&termId=term_1';

// Minimal valid docx: a single lesson block, one <w:tbl>, matching the
// real structure confirmed against the actual Trinitas documents in
// lesson-plan-docx-parser.test.js.
async function buildMinimalDocxBuffer({ date = '3 September 2026', objectives = 'Identify themes' } = {}) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const cell = (text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="ns"><w:body><w:tbl>
    ${row('TEACHER', '', 'WEEK', '1', 'TERM &amp; YEAR', '1 2026 2027')}
    ${row('SUBJECT', 'ENGLISH', 'DATE', date, 'CLASS', 'YEAR 7')}
    ${row('Lesson', 'Topic/Subtopic', 'Lesson objectives', 'Learning Activities', 'Resources/References', 'Remarks')}
    ${row('1', 'Unit 1 — Conventions', objectives, 'Brainstorm', 'Learner Book', '')}
    ${row('DIFFERENTIATION', 'LOW ABILITY', 'MIDDLE ABILITY', 'HIGH ABILITY')}
    ${row('', 'Word bank', '', 'Extend')}
    ${row('ASSESSMENT &amp; EVALUATION', 'Explain choices')}
    ${row('LESSON / WEEK ASSIGNMENT', 'Write 5 sentences')}
    ${row('REFLECTION — What went well | Even better if | Areas for improvement', '')}
  </w:tbl></w:body></w:document>`;
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// A REAL double period: two separate lesson blocks (own w:tbl each, own
// block index) sharing the same date — the only correct way to represent
// one, per _classifyAgainstExisting's comment. Two SEPARATE single-block
// uploads that happen to share a date is a different scenario entirely
// (a corrected re-upload) and is covered by the conflict tests instead.
async function buildDoublePeriodDocxBuffer(date = '3 September 2026') {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const cell = (text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const block = (objectives) => `<w:tbl>
    ${row('TEACHER', '', 'WEEK', '1', 'TERM &amp; YEAR', '1 2026 2027')}
    ${row('SUBJECT', 'ENGLISH', 'DATE', date, 'CLASS', 'YEAR 7')}
    ${row('Lesson', 'Topic/Subtopic', 'Lesson objectives', 'Learning Activities', 'Resources/References', 'Remarks')}
    ${row('1', 'Unit 1 — Conventions', objectives, 'Brainstorm', 'Learner Book', '')}
    ${row('DIFFERENTIATION', 'LOW ABILITY', 'MIDDLE ABILITY', 'HIGH ABILITY')}
    ${row('', 'Word bank', '', 'Extend')}
    ${row('ASSESSMENT &amp; EVALUATION', 'Explain choices')}
    ${row('LESSON / WEEK ASSIGNMENT', 'Write 5 sentences')}
    ${row('REFLECTION — What went well | Even better if | Areas for improvement', '')}
  </w:tbl>`;
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="ns"><w:body>${block('Morning session objective')}${block('Afternoon session, different content entirely')}</w:body></w:document>`;
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('RBAC — lessons__import is a dedicated grant, not lessons:create', () => {
  test('a teacher without the explicit grant gets 403 on preview', async () => {
    asTeacherWithGrant({ streamId: 'strm_a', grant: false });
    const buf = await buildMinimalDocxBuffer();
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(buf);
    expect(res.status).toBe(403);
  });

  test('a teacher without the explicit grant gets 403 on commit', async () => {
    asTeacherWithGrant({ streamId: 'strm_a', grant: false });
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [{ date: '2026-09-03', objectives: 'x' }] });
    expect(res.status).toBe(403);
  });

  test('admin (floor role) bypasses without needing the explicit grant', async () => {
    const buf = await buildMinimalDocxBuffer();
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(buf);
    expect(res.status).toBe(200);
    expect(mockHasExplicitSubGrant).not.toHaveBeenCalled();
  });

  test('a teacher WITH the explicit grant succeeds', async () => {
    asTeacherWithGrant({ streamId: 'strm_a', grant: true });
    const buf = await buildMinimalDocxBuffer();
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(buf);
    expect(res.status).toBe(200);
  });
});

describe('POST .../import/preview — never writes, classifies every row', () => {
  test('a fresh, valid docx row is classified "ready" — and NO lesson_plans document is created', async () => {
    const buf = await buildMinimalDocxBuffer();
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(buf);
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].status).toBe('ready');
    expect(res.body.data.rows[0].date).toBe('2026-09-03');
    expect(mockLessonPlans._docs()).toHaveLength(0); // <-- the gate 1 assertion
  });

  test('missing required query params (classId/subjectId/academicYearId/termId) is rejected', async () => {
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/preview?classId=cls_yr7')
      .set('Content-Type', DOCX_MIME)
      .send(await buildMinimalDocxBuffer());
    expect(res.status).toBe(422);
  });

  test('a date that parses but falls outside the selected term is classified "invalid", not silently forced in', async () => {
    const buf = await buildMinimalDocxBuffer({ date: '25 December 2026' }); // after Term 1 ends
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(buf);
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].status).toBe('invalid');
  });

  test('multi-stream teacher, no streamIds given: rejected with the real available streams named, not guessed', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', streamId: 'strm_a', streamName: 'A' },
      { schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', streamId: 'strm_b', streamName: 'B' },
    ]);
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(await buildMinimalDocxBuffer());
    expect(res.status).toBe(400);
    expect(res.body.error.availableStreams.map(s => s.streamId).sort()).toEqual(['strm_a', 'strm_b']);
  });

  test('explicit streamIds targeting a stream the teacher does not actually teach is rejected', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', streamId: 'strm_a', streamName: 'A' },
    ]);
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}&streamIds=strm_ghost`)
      .set('Content-Type', DOCX_MIME)
      .send(await buildMinimalDocxBuffer());
    expect(res.status).toBe(400);
  });

  test('explicit multi-stream selection fans one lesson block out to one row per selected stream', async () => {
    mockTeachingAssignments = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', streamId: 'strm_a', streamName: 'A' },
      { schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', streamId: 'strm_b', streamName: 'B' },
    ]);
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}&streamIds=strm_a,strm_b`)
      .set('Content-Type', DOCX_MIME)
      .send(await buildMinimalDocxBuffer());
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows.map(r => r.streamId).sort()).toEqual(['strm_a', 'strm_b']);
  });

  test('an existing plan with the SAME content hash AND the same sourceRowRef (an identical re-import) is classified "duplicate"', async () => {
    const buf = await buildMinimalDocxBuffer();
    const preview1 = await supertest(buildApp()).post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`).set('Content-Type', DOCX_MIME).send(buf);
    const { contentHash, sourceRowRef } = preview1.body.data.rows[0];
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_existing', schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', date: '2026-09-03', importBatch: { contentHash, sourceRowRef } },
    ]);
    const preview2 = await supertest(buildApp()).post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`).set('Content-Type', DOCX_MIME).send(buf);
    expect(preview2.body.data.rows[0].status).toBe('duplicate');
  });

  test('same sourceRowRef, DIFFERENT content, is classified "conflict" (a corrected re-upload), not silently overwritten', async () => {
    const preview1 = await supertest(buildApp()).post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`).set('Content-Type', DOCX_MIME).send(await buildMinimalDocxBuffer());
    const { sourceRowRef } = preview1.body.data.rows[0];
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_existing', schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', date: '2026-09-03', topicTitle: 'Old topic', importBatch: { contentHash: 'some-other-hash', sourceRowRef } },
    ]);
    const res = await supertest(buildApp()).post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`).set('Content-Type', DOCX_MIME).send(await buildMinimalDocxBuffer());
    expect(res.body.data.rows[0].status).toBe('conflict');
    expect(res.body.data.rows[0].existingPlanId).toBe('plan_existing');
  });

  test('a genuine double period — two DIFFERENT blocks in the same document, same date — are both "ready", never flagged against each other', async () => {
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', DOCX_MIME)
      .send(await buildDoublePeriodDocxBuffer());
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows.every(r => r.status === 'ready')).toBe(true);
    expect(res.body.data.rows[0].contentHash).not.toBe(res.body.data.rows[1].contentHash);
    expect(res.body.data.rows[0].sourceRowRef).not.toBe(res.body.data.rows[1].sourceRowRef);
  });

  test('re-previewing the SAME double-period document a second time correctly detects both blocks as duplicates of themselves', async () => {
    const buf = await buildDoublePeriodDocxBuffer();
    const r1 = await supertest(buildApp()).post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`).set('Content-Type', DOCX_MIME).send(buf);
    mockLessonPlans = mockMakeFakeCollection(r1.body.data.rows.map((row, i) => ({
      id: `plan_${i}`, schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', date: row.date,
      importBatch: { contentHash: row.contentHash, sourceRowRef: row.sourceRowRef },
    })));
    const r2 = await supertest(buildApp()).post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`).set('Content-Type', DOCX_MIME).send(buf);
    expect(r2.body.data.rows.every(r => r.status === 'duplicate')).toBe(true);
  });

  test('csv upload produces the same shape of result as docx', async () => {
    const csv = ['Date,Lesson Objectives', '3 September 2026,Identify themes'].join('\n');
    const res = await supertest(buildApp())
      .post(`/api/lessons/plans/import/preview?${PREVIEW_QS}`)
      .set('Content-Type', 'text/csv')
      .send(csv);
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].status).toBe('ready');
    expect(res.body.data.rows[0].objectives).toBe('Identify themes');
  });
});

describe('POST .../import/commit — the only route that writes', () => {
  test('creates a lesson_plans document with importBatch provenance, and logs exactly one audit entry', async () => {
    const row = { sourceRowRef: 'block:0', date: '2026-09-03', topicTitle: 'Unit 1', subtopicTitle: 'Conventions', objectives: 'Identify themes' };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'batch_1', sourceFileName: 'y7-english.docx', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });

    expect(res.status).toBe(200);
    expect(res.body.data.created).toHaveLength(1);
    const [doc] = mockLessonPlans._docs();
    expect(doc.importBatch).toEqual(expect.objectContaining({ batchId: 'batch_1', sourceFileName: 'y7-english.docx', sourceRowRef: 'block:0' }));
    expect(doc.topicTitle).toBe('Unit 1');
    expect(doc.topicId).toBeUndefined(); // imported plans are not blocked on syllabus_topics
    expect(AuditService.log).toHaveBeenCalledTimes(1);
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'lessons.plans_imported' }));
  });

  test('re-committing the identical row is a safe no-op: skipped as a duplicate, nothing new created, no audit entry for a no-op batch', async () => {
    const row = { sourceRowRef: 'block:0', date: '2026-09-03', topicTitle: 'Unit 1', objectives: 'Identify themes' };
    const body = { batchId: 'batch_1', sourceFileName: 'f.docx', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] };
    await supertest(buildApp()).post('/api/lessons/plans/import/commit').send(body);
    AuditService.log.mockClear();

    const res2 = await supertest(buildApp()).post('/api/lessons/plans/import/commit').send({ ...body, batchId: 'batch_2' });
    expect(res2.body.data.created).toHaveLength(0);
    expect(res2.body.data.skippedDuplicate).toHaveLength(1);
    expect(mockLessonPlans._docs()).toHaveLength(1); // still just the one, no duplicate row
    expect(AuditService.log).not.toHaveBeenCalled();
  });

  test('committing a row whose content differs from an existing same-identity plan is a "conflict" — never overwrites the existing document', async () => {
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_existing', schoolId: SCHOOL_A, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', date: '2026-09-03', topicTitle: 'Old Topic', importBatch: { contentHash: 'different-hash', sourceRowRef: 'block:0' } },
    ]);
    const row = { sourceRowRef: 'block:0', date: '2026-09-03', topicTitle: 'New Topic', objectives: 'Something else' };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'batch_1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });

    expect(res.body.data.conflicts).toEqual([{ sourceRowRef: 'block:0', existingPlanId: 'plan_existing' }]);
    expect(res.body.data.created).toHaveLength(0);
    const existing = mockLessonPlans._docs().find(d => d.id === 'plan_existing');
    expect(existing.topicTitle).toBe('Old Topic'); // untouched
  });

  test('a real double period commits as TWO separate plans, not a duplicate/overwrite of each other', async () => {
    const morning = { sourceRowRef: 'block:0', date: '2026-09-03', topicTitle: 'Morning', objectives: 'Morning objective' };
    const afternoon = { sourceRowRef: 'block:1', date: '2026-09-03', topicTitle: 'Afternoon', objectives: 'Afternoon objective, totally different' };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'batch_1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [morning, afternoon] });

    expect(res.body.data.created).toHaveLength(2);
    expect(mockLessonPlans._docs()).toHaveLength(2);
  });

  test('a teacher cannot import into a class they are not assigned to (scope enforced, same as manual POST /plans)', async () => {
    asTeacherWithGrant({ streamId: undefined, grant: true });
    mockTeachingAssignments = mockMakeFakeCollection([]); // no assignment at all for cls_yr7
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [{ sourceRowRef: 'r', date: '2026-09-03', objectives: 'x' }] });
    expect(res.status).toBe(403);
  });

  test('tenant isolation: an identical row is NOT treated as a duplicate of another school\'s plan', async () => {
    mockLessonPlans = mockMakeFakeCollection([
      { id: 'plan_school_b', schoolId: SCHOOL_B, teacherId: 'usr_admin', classId: 'cls_yr7', subjectId: 'subj_eng', date: '2026-09-03', importBatch: { contentHash: 'whatever' } },
    ]);
    const row = { sourceRowRef: 'block:0', date: '2026-09-03', topicTitle: 'Unit 1', objectives: 'Identify themes' };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'batch_1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });
    expect(res.body.data.created).toHaveLength(1);
    expect(res.body.data.skippedDuplicate).toHaveLength(0);
  });
});

describe('POST .../import/commit — row shape validation (security review, 2026-09)', () => {
  test('a row missing sourceRowRef is rejected as invalid, not stored or crashed on', async () => {
    const row = { date: '2026-09-03', objectives: 'x' }; // no sourceRowRef
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toHaveLength(0);
    expect(res.body.data.invalid).toHaveLength(1);
    expect(mockLessonPlans._docs()).toHaveLength(0);
  });

  test('a non-object differentiation is rejected rather than stored as the wrong type', async () => {
    const row = { sourceRowRef: 'block:0', date: '2026-09-03', objectives: 'x', differentiation: 'not an object' };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });
    expect(res.body.data.created).toHaveLength(0);
    expect(res.body.data.invalid[0].sourceRowRef).toBe('block:0');
  });

  test('an oversized objectives field is rejected rather than silently truncated or stored raw', async () => {
    const row = { sourceRowRef: 'block:0', date: '2026-09-03', objectives: 'x'.repeat(5000) };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });
    expect(res.body.data.created).toHaveLength(0);
    expect(res.body.data.invalid).toHaveLength(1);
  });

  test('an object masquerading as a date string (NoSQL-injection-shaped payload) is rejected by the schema, never reaches a DB filter', async () => {
    const row = { sourceRowRef: 'block:0', date: { $gt: '' }, objectives: 'x' };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [row] });
    expect(res.body.data.created).toHaveLength(0);
    expect(res.body.data.invalid).toHaveLength(1);
    expect(mockLessonPlans.findOne).not.toHaveBeenCalledWith(expect.objectContaining({ date: expect.objectContaining({ $gt: '' }) }));
  });

  test('one bad row among several valid ones is rejected on its own — does not fail the whole batch', async () => {
    const good = { sourceRowRef: 'block:0', date: '2026-09-03', objectives: 'Fine' };
    const bad  = { sourceRowRef: 'block:1', date: '2026-09-04', differentiation: 12345 };
    const res = await supertest(buildApp())
      .post('/api/lessons/plans/import/commit')
      .send({ batchId: 'b1', classId: 'cls_yr7', subjectId: 'subj_eng', academicYearId: 'ay_2026', termId: 'term_1', rows: [good, bad] });
    expect(res.body.data.created).toHaveLength(1);
    expect(res.body.data.invalid).toHaveLength(1);
    expect(res.body.data.invalid[0].sourceRowRef).toBe('block:1');
  });
});
