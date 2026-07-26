/* ============================================================
   server/routes/report-cards.js — GET/PATCH /publication-policy (RC9)

   A school that never touches this endpoint gets exactly the
   PUBLICATION_POLICY_DEFAULTS shape (require_moderation_complete:
   true — today's hardcoded behavior; the two completeness rules
   default off, since no school has ever had them).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) { doc = { ...filter }; docs.push(doc); }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
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
  mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
  mockStores = { academic_config: makeStore() };
});

describe('GET /publication-policy', () => {
  test('a school with no saved config gets the exact defaults', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/publication-policy');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      require_moderation_complete: true,
      require_subject_comments_complete: false,
      require_report_remarks_complete: false,
    });
  });

  test('a school with a partial saved override merges over the defaults', async () => {
    mockStores.academic_config = makeStore([{ schoolId: SCHOOL, publicationPolicy: { require_subject_comments_complete: true } }]);
    const res = await supertest(buildApp()).get('/api/report-cards/publication-policy');
    expect(res.body.data).toEqual({
      require_moderation_complete: true,       // still the default
      require_subject_comments_complete: true, // overridden
      require_report_remarks_complete: false,
    });
  });
});

describe('PATCH /publication-policy', () => {
  test('rejects an unknown key', async () => {
    const res = await supertest(buildApp()).patch('/api/report-cards/publication-policy').send({ made_up_rule: true });
    expect(res.status).toBe(400);
  });

  test('rejects a non-boolean value', async () => {
    const res = await supertest(buildApp()).patch('/api/report-cards/publication-policy').send({ require_moderation_complete: 'yes' });
    expect(res.status).toBe(400);
  });

  test('a valid partial update persists and merges with defaults for the rest', async () => {
    const res = await supertest(buildApp()).patch('/api/report-cards/publication-policy').send({ require_report_remarks_complete: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      require_moderation_complete: true,
      require_subject_comments_complete: false,
      require_report_remarks_complete: true,
    });

    // A follow-up GET reads back the persisted value, not just the response
    const getRes = await supertest(buildApp()).get('/api/report-cards/publication-policy');
    expect(getRes.body.data.require_report_remarks_complete).toBe(true);
  });

  test('turning moderation off does not silently reset an already-saved unrelated rule', async () => {
    mockStores.academic_config = makeStore([{ schoolId: SCHOOL, publicationPolicy: { require_subject_comments_complete: true } }]);
    const res = await supertest(buildApp()).patch('/api/report-cards/publication-policy').send({ require_moderation_complete: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      require_moderation_complete: false,
      require_subject_comments_complete: true, // preserved from the earlier save
      require_report_remarks_complete: false,
    });
  });
});
