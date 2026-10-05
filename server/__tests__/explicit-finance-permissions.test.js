/* ============================================================
   Explicit finance sub-permissions (middleware/explicit-sub.js).

   - explicitSub refuses a caller without the explicit grant, and fails closed
   - withFinanceSubGrants derives the new keys only from actions a role holds
   - the one-time backfill gives existing roles the keys they had, runs once,
     and never overwrites a grant already set
   - extra-curricular writes are refused without the explicit grant
   ============================================================ */
'use strict';

function mockMakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const chain = (result) => ({ lean: () => Promise.resolve(result) });
  return {
    _docs: () => docs,
    find:    (filter) => chain(docs.filter(d => Object.entries(filter || {}).every(([k, v]) => {
      const val = k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), d);
      if (v && typeof v === 'object' && '$exists' in v) return (val !== undefined) === v.$exists;
      return val === v;
    }))),
    findOne: (filter) => chain(docs.find(d => Object.entries(filter || {}).every(([k, v]) => d[k] === v)) || null),
    updateOne: jest.fn(async (filter, update) => {
      const d = docs.find(x => x._id === filter._id || (x.key && x.key === filter.key));
      if (d && update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          if (k.includes('.')) {
            const [a, b] = k.split('.');
            d[a] = { ...(d[a] || {}), [b]: v };
          } else d[k] = v;
        }
      } else if (!d && filter.key && update.$set) {
        docs.push({ ...update.$set, key: filter.key });
      }
      return { modifiedCount: 1 };
    }),
  };
}

let mockStores;
let mockCurrentUser;
let mockExplicitGrant;

jest.mock('../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => mockExplicitGrant),
  hasPermission: () => true,
}));
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../config/db', () => ({ isConnected: () => true }));
jest.mock('../services/audit', () => ({ log: jest.fn() }));

const express = require('express');
const supertest = require('supertest');
const { explicitSub, withFinanceSubGrants, EXPLICIT_SUB_KEYS } = require('../middleware/explicit-sub');
const { backfillFinanceSubPermissions, MIGRATION_KEY } = require('../utils/finance-permission-backfill');

beforeEach(() => {
  jest.clearAllMocks();
  mockExplicitGrant = false;
  mockCurrentUser = { userId: 'usr_bursar', schoolId: 'sch_1', role: 'finance', roles: ['finance'] };
  mockStores = {
    role_permissions: mockMakeCollection(),
    app_migrations: mockMakeCollection(),
  };
});

describe('explicitSub', () => {
  function app(mod, sub, action) {
    const a = express();
    a.use(express.json());
    a.post('/x', (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); }, explicitSub(mod, sub, action), (_req, res) => res.json({ ok: true }));
    return a;
  }

  test('a caller with the explicit grant passes', async () => {
    mockExplicitGrant = true;
    const res = await supertest(app('finance', 'term_billing', 'create')).post('/x');
    expect(res.status).toBe(200);
  });

  test('a caller without the explicit grant is refused with a clear message', async () => {
    const res = await supertest(app('finance', 'term_billing', 'create')).post('/x');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/term_billing/);
  });

  test('the explicit keys are exactly the three finance sub-permissions', () => {
    expect([...EXPLICIT_SUB_KEYS].sort()).toEqual(['finance__activities', 'finance__early_payment', 'finance__term_billing']);
  });
});

describe('withFinanceSubGrants — derived from what a role already holds', () => {
  test('a role with create and update gets the matching explicit keys', () => {
    const out = withFinanceSubGrants({ finance: ['read', 'create', 'update'] });
    expect(out.finance__term_billing).toEqual(['read', 'create']);
    expect(out.finance__early_payment).toEqual(['update', 'create']);
    expect(out.finance__activities).toEqual(['create', 'update']);
  });

  test('a read-only role gets only the read they hold, and no early-payment or activity rights', () => {
    const out = withFinanceSubGrants({ finance: ['read'] });
    expect(out.finance__term_billing).toEqual(['read']);
    expect(out.finance__early_payment).toBeUndefined();
    expect(out.finance__activities).toBeUndefined();
  });

  test('a role with no finance rights is left unchanged', () => {
    const perms = { timetable: ['read'] };
    expect(withFinanceSubGrants(perms)).toEqual({ timetable: ['read'] });
  });

  test('a key already set is never overwritten', () => {
    const out = withFinanceSubGrants({ finance: ['read', 'create'], finance__term_billing: ['read'] });
    expect(out.finance__term_billing).toEqual(['read']);
  });
});

describe('backfillFinanceSubPermissions — one-time, never overwrites', () => {
  test('existing bursars keep their rights: keys are added to each role that holds the finance actions', async () => {
    mockStores.role_permissions = mockMakeCollection([
      { _id: 'rp_finance', schoolId: 'sch_1', roleKey: 'finance', permissions: { finance: ['read', 'create', 'update'] } },
      { _id: 'rp_teacher', schoolId: 'sch_1', roleKey: 'teacher', permissions: { timetable: ['read'] } },
    ]);
    const res = await backfillFinanceSubPermissions();
    expect(res.updated).toBe(1);
    const finance = mockStores.role_permissions._docs().find(d => d._id === 'rp_finance');
    expect(finance.permissions.finance__term_billing).toEqual(['read', 'create']);
    expect(finance.permissions.finance__early_payment).toEqual(['update', 'create']);
    expect(finance.permissions.finance__activities).toEqual(['create', 'update']);
    const teacher = mockStores.role_permissions._docs().find(d => d._id === 'rp_teacher');
    expect(teacher.permissions.finance__term_billing).toBeUndefined();
  });

  test('a grant already set by an administrator is left alone', async () => {
    mockStores.role_permissions = mockMakeCollection([
      { _id: 'rp_finance', schoolId: 'sch_1', roleKey: 'finance', permissions: { finance: ['read', 'create'], finance__term_billing: ['read'] } },
    ]);
    await backfillFinanceSubPermissions();
    const doc = mockStores.role_permissions._docs()[0];
    expect(doc.permissions.finance__term_billing).toEqual(['read']);
  });

  test('runs once: a second start does nothing', async () => {
    mockStores.role_permissions = mockMakeCollection([
      { _id: 'rp_finance', schoolId: 'sch_1', roleKey: 'finance', permissions: { finance: ['read', 'create'] } },
    ]);
    await backfillFinanceSubPermissions();
    expect(mockStores.app_migrations._docs().map(d => d.key)).toContain(MIGRATION_KEY);
    const second = await backfillFinanceSubPermissions();
    expect(second.skipped).toBe(true);
  });
});

describe('extra-curricular writes need the explicit activities grant', () => {
  test('creating an activity is refused without the explicit grant', async () => {
    const router = require('../routes/extracurricular');
    const a = express();
    a.use(express.json());
    a.use('/api/extracurricular', router);
    const res = await supertest(a).post('/api/extracurricular/activities').send({ name: 'Chess', amount: 5000 });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/activities/);
  });
});
