/* ============================================================
   server/routes/report-cards.js — draft-comments routes
   (classId drift fix, 2026-10-11)

   Two routes shared one draft doc per {studentId, termNumber}, but
   resolved classId differently: PUT /draft-comments/:studentId trusted
   a client-supplied classId, while PUT .../subject/:subjectId (the
   Markbook's own comment save) always resolved it server-side from the
   student's current placement. If the two ever disagreed, the doc's
   stored classId could silently flip to a value that no longer matched
   what the Markbook's classId-filtered GET was asking for — a comment
   genuinely in the database, invisible from the Markbook (and reported
   directly: "comments were entered, but it's like I can't trace them").

   Fixed two ways:
     1. PUT /draft-comments/:studentId now always resolves classId from
        studentPlacement, same as the subject-comment route already did
        — removes the drift at its source.
     2. GET /draft-comments resolves the roster for ?classId= from the
        students collection and matches drafts by studentId, never by
        the draft doc's own (possibly still-stale, for any doc saved
        before fix #1) classId field — removes the exposure for every
        existing doc too, not just new saves.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../services/audit', () => ({ log: jest.fn() }));

let mockStudentDoc = null;
let mockDraftDocs = [];
let mockRosterIds = [];
const mockFindOneAndUpdate = jest.fn();

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'students') {
      return {
        findOne:  () => ({ select: () => ({ lean: () => Promise.resolve(mockStudentDoc) }) }),
        distinct: () => Promise.resolve(mockRosterIds),
      };
    }
    if (col === 'report_card_draft_comments') {
      return {
        find:    () => ({ lean: () => Promise.resolve(mockDraftDocs) }),
        findOne: () => ({ lean: () => Promise.resolve(null) }),
        findOneAndUpdate: (...args) => { mockFindOneAndUpdate(...args); return { lean: () => Promise.resolve({ ...args[1].$set }) }; },
      };
    }
    // _publishedCommentsLockFor's own lookup — no published/locked report
    // in any of this file's scenarios, same as before comments-locking existed.
    if (col === 'report_card_snapshots') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) };
    }
    throw new Error(`unexpected tenantModel('${col}') call in this test`);
  }),
  tenantContext: jest.fn(() => ({})),
}));

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({ findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) })),
}));

const request = require('supertest');
const express = require('express');
const reportCardsRouter = require('../routes/report-cards');

function makeApp(jwtUser) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => {
  mockStudentDoc = { id: 'stu_1', classId: 'cls_real', streamId: 'strm_a' };
  mockDraftDocs = [];
  mockRosterIds = [];
  mockFindOneAndUpdate.mockClear();
});

describe('PUT /draft-comments/:studentId — classId is always server-resolved', () => {
  // role: 'admin' — management, so canWriteClassRemark's bypass applies
  // without needing to wire up streams/teachers mocks this file doesn't
  // otherwise use; these tests are about classId resolution, not about
  // who may write classTeacherName (covered in report-card-comment-
  // rights.test.js). Same convention the GET tests below already use.
  test('a client-supplied classId that disagrees with the student\'s real placement is ignored', async () => {
    const app = makeApp({ schoolId: 'sch_1', userId: 'u_1', role: 'admin' });
    const res = await request(app)
      .put('/report-cards/draft-comments/stu_1')
      .send({ classId: 'cls_STALE_WRONG', termNumber: 2, classTeacherName: 'Mrs. Otieno' });

    expect(res.status).toBe(200);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const setFields = mockFindOneAndUpdate.mock.calls[0][1].$set;
    expect(setFields.classId).toBe('cls_real'); // from studentPlacement, not the request body
    expect(setFields.classId).not.toBe('cls_STALE_WRONG');
  });

  test('omitting classId entirely still resolves and saves the real one', async () => {
    const app = makeApp({ schoolId: 'sch_1', userId: 'u_1', role: 'admin' });
    const res = await request(app)
      .put('/report-cards/draft-comments/stu_1')
      .send({ termNumber: 2 });

    expect(res.status).toBe(200);
    expect(mockFindOneAndUpdate.mock.calls[0][1].$set.classId).toBe('cls_real');
  });
});

describe('GET /draft-comments?classId= — matched by the current roster, not the draft\'s own classId field', () => {
  test('a draft doc with a stale classId still comes back, because it is matched by studentId membership in the roster', async () => {
    // This draft doc's own classId field is wrong/stale (as a doc saved
    // before the PUT fix above could be) — the fix must not depend on it.
    mockRosterIds = ['stu_1', 'stu_2'];
    mockDraftDocs = [
      { studentId: 'stu_1', classId: 'cls_STALE_WRONG', termNumber: 2, subjectComments: { math: 'Good progress.' } },
    ];
    const app = makeApp({ schoolId: 'sch_1', userId: 'u_1', role: 'admin' }); // management — scopeDraftCommentsForCaller returns everything
    const res = await request(app)
      .get('/report-cards/draft-comments')
      .query({ classId: 'cls_real', termNumber: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subjectComments.math).toBe('Good progress.');
  });

  test('a student no longer on the roster for this classId is excluded, even if their stale draft doc still says classId matches', async () => {
    mockRosterIds = ['stu_1']; // stu_2 has moved to a different class
    mockDraftDocs = [
      { studentId: 'stu_1', classId: 'cls_real', termNumber: 2, subjectComments: {} },
    ];
    const app = makeApp({ schoolId: 'sch_1', userId: 'u_1', role: 'admin' });
    const res = await request(app)
      .get('/report-cards/draft-comments')
      .query({ classId: 'cls_real', termNumber: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.map(d => d.studentId)).toEqual(['stu_1']);
  });
});
