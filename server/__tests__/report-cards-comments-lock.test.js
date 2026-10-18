/* ============================================================
   server/routes/report-cards.js — comments lock the same way marks do
   (2026-10-18, direct request)

   Before this: /publish auto-locks every mark it was built from
   (assessment_marks.isLocked), but a report card's comments had no
   equivalent — PUT /draft-comments/:studentId and its subject-comment
   counterpart stayed writable forever, even for a term that had
   already been published, with no unlock ceremony at all (a comment
   write was never blocked by mark-submission state either, per the
   2026-10-11 decision in comment-scope.js — a DIFFERENT, pre-publish
   axis this does not touch). This closes that gap: a published,
   non-superseded snapshot's commentsLocked flag now blocks every
   draft-comment write route the same way assessment_marks.isLocked
   blocks POST /marks, with a matching admin-only + mandatory-reason +
   24h-auto-relock unlock route.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        const doc = docs.find(d => matches(d, filter));
        if (!doc) return null;
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
    updateOne: async (filter, update) => {
      const doc = docs.find(d => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { modifiedCount: doc ? 1 : 0 };
    },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;
let mockEnqueued;
const mockAuditLog = jest.fn().mockResolvedValue(undefined);

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n(), hasExplicitSubGrant: jest.fn() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
jest.mock('../utils/job-queue', () => ({
  enqueueJob: jest.fn((job) => { mockEnqueued.push(job); return Promise.resolve('job_1'); }),
  registerHandler: jest.fn(),
}));
jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => mockStores[col]),
  tenantContext: jest.fn(() => ({})),
}));
jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const express   = require('express');
const supertest = require('supertest');
const reportCardsRouter = require('../routes/report-cards');
const { _publishedCommentsLockFor, _autoRelockComments } = reportCardsRouter;

const SCHOOL = 'sch_1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueued = [];
  mockCurrentUser = { schoolId: SCHOOL, userId: 'u_admin', role: 'admin', name: 'Admin', email: 'a@b.com' };
  mockStores = {
    students: makeStore([{ id: 'stu_1', schoolId: SCHOOL, classId: 'cls_1', streamId: 'strm_a' }]),
    report_card_draft_comments: makeStore([]),
    report_card_snapshots: makeStore([]),
  };
});

describe('_publishedCommentsLockFor', () => {
  test('true when a current (non-superseded) published snapshot has commentsLocked:true', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: true },
    ]);
    await expect(_publishedCommentsLockFor(SCHOOL, {}, 'stu_1', 2)).resolves.toBe(true);
  });

  test('false when no published snapshot exists at all (never published)', async () => {
    await expect(_publishedCommentsLockFor(SCHOOL, {}, 'stu_1', 2)).resolves.toBe(false);
  });

  test('false when the current snapshot has already been unlocked', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: false },
    ]);
    await expect(_publishedCommentsLockFor(SCHOOL, {}, 'stu_1', 2)).resolves.toBe(false);
  });

  test('a SUPERSEDED locked snapshot does not block — only the current version counts', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_old', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: true, commentsLocked: true },
    ]);
    await expect(_publishedCommentsLockFor(SCHOOL, {}, 'stu_1', 2)).resolves.toBe(false);
  });
});

describe('PUT /draft-comments/:studentId — blocked once the term\'s report card is published and locked', () => {
  test('rejects with the same wording as a locked mark', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: true },
    ]);
    const res = await supertest(buildApp())
      .put('/report-cards/draft-comments/stu_1')
      .send({ termNumber: 2, classTeacherName: 'Mrs. Otieno' });

    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? res.body.error).toMatch(/locked.*ask an admin/i);
  });

  test('still allowed when nothing has been published for this term', async () => {
    const res = await supertest(buildApp())
      .put('/report-cards/draft-comments/stu_1')
      .send({ termNumber: 2, classTeacherName: 'Mrs. Otieno' });
    expect(res.status).toBe(200);
  });

  test('allowed again once an admin has unlocked it', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: false },
    ]);
    const res = await supertest(buildApp())
      .put('/report-cards/draft-comments/stu_1')
      .send({ termNumber: 2, classTeacherName: 'Mrs. Otieno' });
    expect(res.status).toBe(200);
  });
});

describe('POST /:id/comments/unlock', () => {
  beforeEach(() => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: true },
    ]);
  });

  test('requires a reason', async () => {
    const res = await supertest(buildApp()).post('/report-cards/snap_1/comments/unlock').send({});
    expect(res.status).toBe(400);
  });

  test('refuses a non-admin caller', async () => {
    mockCurrentUser = { ...mockCurrentUser, role: 'teacher' };
    const res = await supertest(buildApp()).post('/report-cards/snap_1/comments/unlock').send({ reason: 'Parent asked for a correction' });
    expect(res.status).toBe(403);
  });

  test('an admin with a reason unlocks it, logs the action, and schedules a 24h auto-relock', async () => {
    const res = await supertest(buildApp()).post('/report-cards/snap_1/comments/unlock').send({ reason: 'Wrong spelling fixed' });

    expect(res.status).toBe(200);
    expect(res.body.data.commentsLocked).toBe(false);
    expect(mockStores.report_card_snapshots._docs()[0].commentsLocked).toBe(false);
    expect(mockStores.report_card_snapshots._docs()[0].commentsUnlockReason).toBe('Wrong spelling fixed');

    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'report_card.comments_unlocked' }));

    expect(mockEnqueued).toHaveLength(1);
    expect(mockEnqueued[0].type).toBe('comments_relock');
    expect(mockEnqueued[0].payload).toEqual({ snapshotId: 'snap_1', schoolId: SCHOOL });
    const delayMs = new Date(mockEnqueued[0].runAt).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(delayMs).toBeLessThan(25 * 60 * 60 * 1000);
  });
});

describe('_autoRelockComments (the 24h background job)', () => {
  test('re-locks a snapshot still sitting unlocked', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: false },
    ]);
    await _autoRelockComments({ snapshotId: 'snap_1', schoolId: SCHOOL });
    expect(mockStores.report_card_snapshots._docs()[0].commentsLocked).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'report_card.comments_auto_relocked' }));
  });

  test('does nothing if an admin already re-locked it manually', async () => {
    mockStores.report_card_snapshots = makeStore([
      { id: 'snap_1', schoolId: SCHOOL, studentId: 'stu_1', termNumber: 2, superseded: false, commentsLocked: true },
    ]);
    await _autoRelockComments({ snapshotId: 'snap_1', schoolId: SCHOOL });
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  test('does nothing if the snapshot no longer exists', async () => {
    await expect(_autoRelockComments({ snapshotId: 'gone', schoolId: SCHOOL })).resolves.toBeUndefined();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
