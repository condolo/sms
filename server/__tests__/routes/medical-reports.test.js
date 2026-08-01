/* ============================================================
   Medical Centre milestone 5 — server/routes/medical.js GET /reports

   Covers: RBAC (reports uses the module-level 'medical' grant via the
   subKey fallback — admin/principal/deputy_principal get it for free,
   a teacher with only medical__alerts does NOT), Visits Today/This
   Month being real calendar counts independent of dateFrom/dateTo,
   and the two aggregations (Common Conditions grouped by complaint,
   Frequent Visitors grouped by student) sorted by count descending.

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants, same discipline as the other medical.js test files.

   All DB calls are mocked — no MongoDB required. A small custom
   aggregate() interpreter handles exactly the $match/$group/$sort/
   $limit/$project shapes this route actually emits — not a general
   MongoDB aggregation engine.
   ============================================================ */

const SCHOOL_A = 'school_A';
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
// The route's "this month" window is month-start THROUGH today (month-to-
// date), not the whole calendar month — a date later in the month than
// today wouldn't be a real visit yet. So "earlier this month, not today"
// only exists when today isn't the 1st; yesterday is always a safe choice
// then, since it can't have crossed into the previous month.
const DAY_OF_MONTH = NOW.getUTCDate();
const HAS_EARLIER_DAY_THIS_MONTH = DAY_OF_MONTH > 1;
const EARLIER_THIS_MONTH = HAS_EARLIER_DAY_THIS_MONTH
  ? new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), DAY_OF_MONTH - 1)).toISOString().slice(0, 10)
  : null;
// A date guaranteed outside the current month, for the "not counted" cases.
const LAST_MONTH = TODAY <= '2000-01-05' ? '2000-01-01' : '2000-01-05';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$exists' in v) return v.$exists ? (doc[k] !== undefined) : (doc[k] === undefined);
      if ('$gte' in v || '$lte' in v) {
        if (doc[k] === undefined) return false;
        if ('$gte' in v && !(doc[k] >= v.$gte)) return false;
        if ('$lte' in v && !(doc[k] <= v.$lte)) return false;
        return true;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockRunAggregate(docs, pipeline) {
  let rows = docs.map(d => ({ ...d }));
  for (const stage of pipeline) {
    if (stage.$match) {
      rows = rows.filter(d => mockMatchesFilter(d, stage.$match));
    } else if (stage.$group) {
      const idField = stage.$group._id.replace('$', '');
      const groups = new Map();
      for (const d of rows) {
        const key = d[idField];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
      }
      rows = [...groups.entries()].map(([key, groupDocs]) => {
        const out = { _id: key };
        for (const [field, spec] of Object.entries(stage.$group)) {
          if (field === '_id') continue;
          if (spec.$sum !== undefined) out[field] = groupDocs.length;
          if (spec.$first) out[field] = groupDocs[0][spec.$first.replace('$', '')];
        }
        return out;
      });
    } else if (stage.$sort) {
      const [[field, dir]] = Object.entries(stage.$sort);
      rows.sort((a, b) => (a[field] - b[field]) * dir);
    } else if (stage.$limit) {
      rows = rows.slice(0, stage.$limit);
    } else if (stage.$project) {
      rows = rows.map(d => {
        const out = {};
        for (const [field, spec] of Object.entries(stage.$project)) {
          if (spec === 1) out[field] = d[field];
          else if (typeof spec === 'string' && spec.startsWith('$')) out[field] = d[spec.slice(1)];
        }
        return out;
      });
    }
  }
  return rows;
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    aggregate:      jest.fn((pipeline) => Promise.resolve(mockRunAggregate(docs, pipeline))),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const mockRolePerms = {
  admin:   { medical: ['read', 'create', 'update', 'delete'] },
  teacher: { medical__alerts: ['read'] },
};
let mockVisits;
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      // rbac.js calls findOne({schoolId, roleKey}).lean() with no .select() —
      // mockChainObj supports both shapes so either call pattern works.
      return { findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)) };
    }
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => (collection === 'medical_visits' ? mockVisits : mockMakeFakeCollection([])),
}));

const express   = require('express');
const supertest = require('supertest');
const medicalRouter = require('../../routes/medical');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/medical', medicalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockVisits = mockMakeFakeCollection([]);
});

describe('GET /api/medical/reports — RBAC', () => {
  test('admin (module-level medical grant) can reach the route', async () => {
    const res = await supertest(buildApp()).get('/api/medical/reports');
    expect(res.status).toBe(200);
  });

  test('a teacher with only medical__alerts is forbidden — reports needs the full module grant', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/medical/reports');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/medical/reports — Visits Today / This Month', () => {
  test('counts today and this-month correctly, excluding visits from other months', async () => {
    const fixtures = [
      { id: 'v1', schoolId: SCHOOL_A, date: TODAY, complaint: 'Headache', studentId: 'stu_1', studentName: 'A' },
      { id: 'v3', schoolId: SCHOOL_A, date: LAST_MONTH, complaint: 'Stomach ache', studentId: 'stu_3', studentName: 'C' },
    ];
    if (HAS_EARLIER_DAY_THIS_MONTH) {
      fixtures.push({ id: 'v2', schoolId: SCHOOL_A, date: EARLIER_THIS_MONTH, complaint: 'Cough', studentId: 'stu_2', studentName: 'B' });
    }
    mockVisits = mockMakeFakeCollection(fixtures);

    const res = await supertest(buildApp()).get('/api/medical/reports');
    expect(res.status).toBe(200);
    expect(res.body.data.visitsToday).toBe(1);
    // TODAY, plus EARLIER_THIS_MONTH when today isn't the 1st — never LAST_MONTH.
    expect(res.body.data.visitsThisMonth).toBe(HAS_EARLIER_DAY_THIS_MONTH ? 2 : 1);
  });

  test('a custom dateFrom/dateTo does NOT change visitsToday/visitsThisMonth', async () => {
    mockVisits = mockMakeFakeCollection([
      { id: 'v1', schoolId: SCHOOL_A, date: TODAY, complaint: 'Headache', studentId: 'stu_1', studentName: 'A' },
    ]);
    const res = await supertest(buildApp()).get('/api/medical/reports').query({ dateFrom: LAST_MONTH, dateTo: LAST_MONTH });
    expect(res.body.data.visitsToday).toBe(1);
    expect(res.body.data.visitsThisMonth).toBe(1);
  });
});

describe('GET /api/medical/reports — Common Conditions', () => {
  test('groups by complaint and sorts descending by count', async () => {
    mockVisits = mockMakeFakeCollection([
      { id: 'v1', schoolId: SCHOOL_A, date: TODAY, complaint: 'Headache', studentId: 'stu_1', studentName: 'A' },
      { id: 'v2', schoolId: SCHOOL_A, date: TODAY, complaint: 'Headache', studentId: 'stu_2', studentName: 'B' },
      { id: 'v3', schoolId: SCHOOL_A, date: TODAY, complaint: 'Cough', studentId: 'stu_3', studentName: 'C' },
    ]);
    const res = await supertest(buildApp()).get('/api/medical/reports');
    expect(res.body.data.commonConditions).toEqual([
      { complaint: 'Headache', count: 2 },
      { complaint: 'Cough', count: 1 },
    ]);
  });
});

describe('GET /api/medical/reports — Frequent Visitors', () => {
  test('groups by studentId, carries studentName, sorted descending by visit count', async () => {
    mockVisits = mockMakeFakeCollection([
      { id: 'v1', schoolId: SCHOOL_A, date: TODAY, complaint: 'Headache', studentId: 'stu_1', studentName: 'Amina Otieno' },
      { id: 'v2', schoolId: SCHOOL_A, date: TODAY, complaint: 'Cough', studentId: 'stu_1', studentName: 'Amina Otieno' },
      { id: 'v3', schoolId: SCHOOL_A, date: TODAY, complaint: 'Fever', studentId: 'stu_2', studentName: 'John Kamau' },
    ]);
    const res = await supertest(buildApp()).get('/api/medical/reports');
    expect(res.body.data.frequentVisitors).toEqual([
      { studentId: 'stu_1', studentName: 'Amina Otieno', visitCount: 2 },
      { studentId: 'stu_2', studentName: 'John Kamau', visitCount: 1 },
    ]);
  });
});
