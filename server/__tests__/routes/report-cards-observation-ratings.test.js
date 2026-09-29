/* ============================================================
   server/routes/report-cards.js — class-teacher observation ratings
   (2026-09-29)

   Real gap found during an exam-to-report-card audit: a school's
   actual report card had a "Class Teacher Observations" section
   (Engaged/Teamwork/Confidence/Responsibility/Reflective/Innovative,
   each Excellent/Good/Improve) that nothing in the app backed at all —
   no collection, no input screen, always blank. This adds it as a new
   field on the existing PUT /draft-comments/:studentId (the same
   pre-publish draft record classTeacherRemark already lives on),
   validated against the school's own configured category list
   (Settings → Report Cards → General), not a hardcoded set.

   Same makeStore()/chain() in-memory mock pattern as
   report-cards-comment-workflow.test.js, since tenantModel(...)
   delegates to the same _model(...) mock underneath (unmocked here).
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      if (Array.isArray(doc[k])) return doc[k].includes(v);
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) { doc = { ...filter }; delete doc.$or; docs.push(doc); }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const express       = require('express');
const supertest     = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_class_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
  mockStores = {
    report_card_draft_comments: makeStore(),
    academic_config: makeStore([
      { schoolId: SCHOOL, showObservationRatings: true, observationCategories: ['Engaged', 'Teamwork', 'Confidence'] },
    ]),
  };
});

describe('PUT /api/report-cards/draft-comments/:studentId — observationRatings', () => {
  test('accepts ratings for the school\'s own configured categories', async () => {
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_1')
      .send({ termNumber: 1, classId: 'cls_1', observationRatings: { Engaged: 'excellent', Teamwork: 'good' } });
    expect(res.status).toBe(200);
    expect(res.body.data.observationRatings).toEqual({ Engaged: 'excellent', Teamwork: 'good' });
  });

  test('rejects a category the school never configured', async () => {
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_1')
      .send({ termNumber: 1, classId: 'cls_1', observationRatings: { NotARealCategory: 'excellent' } });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid rating value', async () => {
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_1')
      .send({ termNumber: 1, classId: 'cls_1', observationRatings: { Engaged: 'amazing' } });
    expect(res.status).toBe(400);
  });

  test('rejects a non-object observationRatings', async () => {
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_1')
      .send({ termNumber: 1, classId: 'cls_1', observationRatings: 'excellent' });
    expect(res.status).toBe(400);
  });

  test('omitting observationRatings entirely is fine — unaffected, matches every other optional field here', async () => {
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_1')
      .send({ termNumber: 1, classId: 'cls_1', classTeacherRemark: 'Good term.' });
    expect(res.status).toBe(200);
    expect(res.body.data.observationRatings).toBeUndefined();
  });

  test('a school that never turned the feature on rejects any category (empty configured list)', async () => {
    mockStores.academic_config = makeStore([{ schoolId: SCHOOL, showObservationRatings: false, observationCategories: [] }]);
    const res = await supertest(buildApp())
      .put('/api/report-cards/draft-comments/stu_1')
      .send({ termNumber: 1, classId: 'cls_1', observationRatings: { Engaged: 'excellent' } });
    expect(res.status).toBe(400);
  });
});
