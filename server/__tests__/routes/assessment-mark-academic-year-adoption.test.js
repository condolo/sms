/* ============================================================
   Regression test — server/routes/assessment.js mark-entry
   academic-year adoption (Academic Year & Term Dependency Map,
   finding #2: CA marks were effectively unscoped by year).

   Every assessment_marks document saved before this fix has
   academicYearId: null — the Markbook UI (ExamsPage.jsx) never sent
   one. Once the client starts sending a real academicYearId, a naive
   upsert keyed on {student, subject, term, type, instance,
   academicYearId} would silently miss that legacy null-tagged row and
   INSERT A DUPLICATE instead of updating it — real data corruption on
   the first re-save after this fix ships.

   This suite proves the adoption path instead: an incoming real-year
   mark for a key whose only existing record is legacy-null updates
   that same document (id preserved, academicYearId backfilled) rather
   than creating a second one, for both the single-mark and bulk
   endpoints — and that the version-conflict check still fires
   correctly against an adopted record.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_teacher_001', schoolId: 'school_test_001', role: 'teacher', roles: ['teacher'] };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/plan', () => ({
  planGate: () => (_req, _res, next) => next(),
}));

jest.mock('../../utils/archival', () => ({
  isYearArchived:    jest.fn().mockResolvedValue(false),
  firstArchivedYear: jest.fn().mockResolvedValue(null),
}));

/* One legacy record: stu_001/subj_001/T1/CA/instance 1, saved before this
   fix, so academicYearId is null. Its Mongo _id is what a wrongly-scoped
   upsert would orphan. */
const LEGACY_MARK = {
  id: 'mark_legacy_001', schoolId: 'school_test_001', studentId: 'stu_001', subjectId: 'subj_001',
  termNumber: 1, assessmentType: 'CA', instance: 1,
  rawScore: 70, academicYearId: null, _v: 2,
};

function mockChain(resolveFn) {
  const lean = () => Promise.resolve(resolveFn());
  return { lean, select: () => ({ lean }), sort: () => ({ lean }) };
}

let marksStore;
const mockConfigFindOne   = jest.fn(() => mockChain(() => null));
const mockConfigCreate    = jest.fn().mockResolvedValue({});
const mockScheduleFindOne = jest.fn(() => mockChain(() => null));

const mockMarksFindOne = jest.fn((filter) => mockChain(() => {
  // Emulates Mongo semantics: top-level fields sibling to $or must ALL
  // match (AND), and at least one $or clause must also match (OR) — e.g.
  // { ...naturalKey, $or: [{academicYearId: X}, {academicYearId: null}] }
  // means "this natural key, with either academicYearId".
  const { $or, isLocked, ...rest } = filter;
  const fieldsMatch = (m, obj) => Object.entries(obj).every(([k, v]) => (m[k] ?? null) === (v ?? null));
  return marksStore.find(m =>
    fieldsMatch(m, rest) &&
    ($or ? $or.some(c => fieldsMatch(m, c)) : true) &&
    (isLocked === undefined || m.isLocked === isLocked)
  ) ?? null;
}));

const mockMarksFind = jest.fn((filter) => mockChain(() => {
  const clauses = filter.$or ?? [];
  return marksStore.filter(m =>
    clauses.some(c =>
      m.studentId === c.studentId && m.subjectId === c.subjectId &&
      m.termNumber === c.termNumber && m.assessmentType === c.assessmentType &&
      m.instance === c.instance && (m.academicYearId ?? null) === (c.academicYearId ?? null)
    )
  );
}));

const mockFindOneAndUpdate = jest.fn((filter, update) => {
  let doc = marksStore.find(m =>
    m.studentId === filter.studentId && m.subjectId === filter.subjectId &&
    m.termNumber === filter.termNumber && m.assessmentType === filter.assessmentType &&
    m.instance === filter.instance && (m.academicYearId ?? null) === (filter.academicYearId ?? null)
  );
  if (doc) {
    Object.assign(doc, update.$set);
  } else {
    doc = { id: 'mark_new_001', ...filter, ...update.$set, ...update.$setOnInsert };
    marksStore.push(doc);
  }
  return mockChain(() => doc);
});

const mockBulkWrite = jest.fn((ops) => {
  let upsertedCount = 0, modifiedCount = 0;
  for (const { updateOne } of ops) {
    const { filter, update } = updateOne;
    let doc = marksStore.find(m =>
      m.studentId === filter.studentId && m.subjectId === filter.subjectId &&
      m.termNumber === filter.termNumber && m.assessmentType === filter.assessmentType &&
      m.instance === filter.instance && (m.academicYearId ?? null) === (filter.academicYearId ?? null)
    );
    if (doc) {
      Object.assign(doc, update.$set);
      if (update.$inc?._v) doc._v = (doc._v ?? 0) + update.$inc._v;
      modifiedCount++;
    } else {
      doc = { id: `mark_new_${marksStore.length}`, ...filter, ...update.$set, ...update.$setOnInsert, _v: update.$inc?._v ?? 0 };
      marksStore.push(doc);
      upsertedCount++;
    }
  }
  return Promise.resolve({ upsertedCount, modifiedCount });
});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'assessment_config')   return { findOne: mockConfigFindOne, create: mockConfigCreate };
    if (collection === 'assessment_schedule') return { findOne: mockScheduleFindOne };
    if (collection === 'assessment_marks') {
      return {
        findOne:         mockMarksFindOne,
        find:            mockMarksFind,
        findOneAndUpdate: mockFindOneAndUpdate,
        bulkWrite:       mockBulkWrite,
      };
    }
    return { findOne: jest.fn(() => mockChain(() => null)) };
  }),
}));

const express          = require('express');
const supertest        = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  marksStore = [{ ...LEGACY_MARK }];
  mockConfigFindOne.mockReturnValue(mockChain(() => null));
  mockConfigCreate.mockResolvedValue({});
  mockScheduleFindOne.mockReturnValue(mockChain(() => null));
});

describe('POST /api/assessment/marks — legacy null-academicYearId adoption', () => {
  test('a real-year save for an existing legacy-null mark updates it in place, not a duplicate', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/assessment/marks')
      .send({
        studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001',
        academicYearId: 'ay_2026', termNumber: 1, assessmentType: 'CA', instance: 1,
        rawScore: 85,
      });

    expect(res.status).toBe(201);
    // Still exactly one document for this key — no duplicate created.
    expect(marksStore).toHaveLength(1);
    expect(marksStore[0].id).toBe('mark_legacy_001');
    // Backfilled with the real year and the new score.
    expect(marksStore[0].academicYearId).toBe('ay_2026');
    expect(marksStore[0].rawScore).toBe(85);
  });

  test('a genuinely new key (no legacy record) still inserts normally', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/assessment/marks')
      .send({
        studentId: 'stu_999', subjectId: 'subj_001', classId: 'cls_001',
        academicYearId: 'ay_2026', termNumber: 1, assessmentType: 'CA', instance: 1,
        rawScore: 50,
      });

    expect(res.status).toBe(201);
    expect(marksStore).toHaveLength(2);
    expect(marksStore.find(m => m.studentId === 'stu_999').academicYearId).toBe('ay_2026');
  });
});

describe('POST /api/assessment/marks/bulk — legacy null-academicYearId adoption', () => {
  test('adopts the legacy record instead of creating a duplicate, and version-conflict still works against it', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          // Same key as LEGACY_MARK, now tagged with a real year and the
          // correct current _v (2) — should adopt, not duplicate.
          { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', academicYearId: 'ay_2026', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 90, _v: 2 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toHaveLength(0);
    expect(marksStore).toHaveLength(1);
    expect(marksStore[0].academicYearId).toBe('ay_2026');
    expect(marksStore[0].rawScore).toBe(90);
    expect(marksStore[0]._v).toBe(3);
  });

  test('a stale _v against the legacy record is still reported as a conflict, not silently adopted', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          // LEGACY_MARK is at _v 2 — this client last read version 1.
          { studentId: 'stu_001', subjectId: 'subj_001', classId: 'cls_001', academicYearId: 'ay_2026', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 90, _v: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0]).toMatchObject({ yourVersion: 1, currentVersion: 2, currentRawScore: 70 });
    // Untouched — no adoption, no duplicate, on a rejected write.
    expect(marksStore).toHaveLength(1);
    expect(marksStore[0].academicYearId).toBeNull();
  });

  test('a locked mark in a DIFFERENT academic year no longer blocks writing this year\'s mark for the same key', async () => {
    marksStore.push({
      id: 'mark_locked_prior_year', schoolId: 'school_test_001', studentId: 'stu_002', subjectId: 'subj_001',
      termNumber: 1, assessmentType: 'CA', instance: 1,
      rawScore: 60, academicYearId: 'ay_2025', isLocked: true, _v: 0,
    });

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/assessment/marks/bulk')
      .send({
        marks: [
          { studentId: 'stu_002', subjectId: 'subj_001', classId: 'cls_001', academicYearId: 'ay_2026', termNumber: 1, assessmentType: 'CA', instance: 1, rawScore: 77 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toHaveLength(0);
    const newRecord = marksStore.find(m => m.studentId === 'stu_002' && m.academicYearId === 'ay_2026');
    expect(newRecord).toBeDefined();
    expect(newRecord.rawScore).toBe(77);
  });
});
