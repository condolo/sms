/* ============================================================
   GET/POST/DELETE /api/platform/schools/:id/entitlements
   — unit tests with mocked DB.

   Verifies the platform-admin Capability/Entitlement registry (C3):
   listing, granting (including re-activating a revoked key instead of
   duplicating it), soft-revoking, and — critically — that none of this
   touches server/middleware/plan.js's FEATURE_PLAN/planGate or the
   school's own `plan` field. This registry is additive and not yet
   consulted by any feature gate (that wiring is a separate future
   phase, C10).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

let mockSchoolDocs = [];
let mockEntitlementDocs = [];
let mockEntitlementUpsertCalls = [];
const mockSchoolsUpdateOne = jest.fn();

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return {
          findOne: (filter) => ({
            lean: () => Promise.resolve(
              mockSchoolDocs.find(s => s.id === filter.id || (filter.$or && filter.$or.some(c => c.id === s.id || c._id === s._id))) || null
            ),
          }),
          updateOne: mockSchoolsUpdateOne,
        };
      }
      if (col === 'entitlements') {
        return {
          find: (filter) => ({
            sort: () => ({
              lean: () => Promise.resolve(mockEntitlementDocs.filter(e => e.schoolId === filter.schoolId)),
            }),
          }),
          findOne: (filter) => ({
            lean: () => Promise.resolve(mockEntitlementDocs.find(e => e.schoolId === filter.schoolId && e.key === filter.key) || null),
          }),
          findOneAndUpdate: jest.fn((filter, update) => ({
            lean: () => {
              mockEntitlementUpsertCalls.push({ filter, update });
              let doc = mockEntitlementDocs.find(e => e.schoolId === filter.schoolId && e.key === filter.key);
              if (!doc) {
                doc = { ...update.$setOnInsert };
                mockEntitlementDocs.push(doc);
              }
              Object.assign(doc, update.$set);
              return Promise.resolve({ ...doc });
            },
          })),
          updateOne: jest.fn((filter, update) => {
            const doc = mockEntitlementDocs.find(e => e.schoolId === filter.schoolId && e.key === filter.key);
            if (doc) Object.assign(doc, update.$set);
            return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
          }),
        };
      }
      return { find: () => ({ lean: () => Promise.resolve([]) }) };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDocs = [{ id: 'sch_a', _id: 'oid_a', name: 'Campus A' }];
  mockEntitlementDocs = [];
  mockEntitlementUpsertCalls = [];
});

describe('GET /api/platform/schools/:id/entitlements', () => {
  test('lists entitlements for a school, newest first per the query', async () => {
    mockEntitlementDocs = [
      { id: 'ent_1', schoolId: 'sch_a', key: 'ai_reports', status: 'active' },
    ];
    const res = await supertest(app()).get('/api/platform/schools/sch_a/entitlements');
    expect(res.status).toBe(200);
    expect(res.body.entitlements).toHaveLength(1);
    expect(res.body.entitlements[0].key).toBe('ai_reports');
  });

  test('returns an empty list, not an error, for a school with none', async () => {
    const res = await supertest(app()).get('/api/platform/schools/sch_a/entitlements');
    expect(res.status).toBe(200);
    expect(res.body.entitlements).toEqual([]);
  });

  test('404s for an unknown school', async () => {
    const res = await supertest(app()).get('/api/platform/schools/sch_ghost/entitlements');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/platform/schools/:id/entitlements', () => {
  test('grants a new entitlement and returns the record-only note', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_a/entitlements')
      .send({ key: 'ai_reports' });

    expect(res.status).toBe(201);
    expect(res.body.entitlement).toMatchObject({ schoolId: 'sch_a', key: 'ai_reports', status: 'active', source: 'platform_grant' });
    expect(res.body.note).toMatch(/not yet consulted/i);
  });

  test('rejects a missing or invalid key', async () => {
    const missing = await supertest(app()).post('/api/platform/schools/sch_a/entitlements').send({});
    expect(missing.status).toBe(400);

    const invalid = await supertest(app()).post('/api/platform/schools/sch_a/entitlements').send({ key: 'Not A Valid Key!' });
    expect(invalid.status).toBe(400);
  });

  test('404s when the school does not exist', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_ghost/entitlements')
      .send({ key: 'ai_reports' });
    expect(res.status).toBe(404);
  });

  test('re-activates an already-revoked key instead of duplicating it', async () => {
    mockEntitlementDocs = [{ id: 'ent_1', schoolId: 'sch_a', key: 'ai_reports', status: 'revoked' }];

    const res = await supertest(app())
      .post('/api/platform/schools/sch_a/entitlements')
      .send({ key: 'ai_reports' });

    expect(res.status).toBe(201);
    expect(res.body.entitlement.id).toBe('ent_1');
    expect(res.body.entitlement.status).toBe('active');
    expect(mockEntitlementDocs).toHaveLength(1);
  });

  test('accepts optional notes and expiresAt', async () => {
    const expiresAt = '2027-01-01T00:00:00.000Z';
    const res = await supertest(app())
      .post('/api/platform/schools/sch_a/entitlements')
      .send({ key: 'payroll', notes: 'Enterprise pilot', expiresAt });

    expect(res.status).toBe(201);
    expect(res.body.entitlement).toMatchObject({ notes: 'Enterprise pilot', expiresAt });
  });

  test('never writes to the schools collection or invalidates the plan cache — independent of plan tier', async () => {
    const { invalidatePlanCache } = require('../../middleware/plan');
    await supertest(app()).post('/api/platform/schools/sch_a/entitlements').send({ key: 'ai_reports' });
    expect(mockSchoolsUpdateOne).not.toHaveBeenCalled();
    expect(invalidatePlanCache).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/platform/schools/:id/entitlements/:key', () => {
  test('soft-revokes an existing entitlement (status flips, doc is not deleted)', async () => {
    mockEntitlementDocs = [{ id: 'ent_1', schoolId: 'sch_a', key: 'ai_reports', status: 'active' }];

    const res = await supertest(app()).delete('/api/platform/schools/sch_a/entitlements/ai_reports');

    expect(res.status).toBe(200);
    expect(mockEntitlementDocs).toHaveLength(1);
    expect(mockEntitlementDocs[0].status).toBe('revoked');
  });

  test('404s when no entitlement exists for that key', async () => {
    const res = await supertest(app()).delete('/api/platform/schools/sch_a/entitlements/ai_reports');
    expect(res.status).toBe(404);
  });

  test('404s when the school does not exist', async () => {
    const res = await supertest(app()).delete('/api/platform/schools/sch_ghost/entitlements/ai_reports');
    expect(res.status).toBe(404);
  });
});
