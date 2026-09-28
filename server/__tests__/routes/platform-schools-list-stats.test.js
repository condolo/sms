/* ============================================================
   GET /api/platform/schools — the "staff" stat

   Real customer report: Trinitas showed "372 staff" on this dashboard.
   Confirmed live against production data: `staff` was counting EVERY
   active `users` login account regardless of role — 313 of the 372
   were students' own logins, plus a handful of parents, plus the
   actual 58-ish staff. The real staff headcount is the HR staff
   directory (`teachers` collection), not the login-account table real
   staff (and students, and parents) happen to also have accounts in.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => { req.platformOperatorTier = 'owner'; next(); },
  requireOwnerTier: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));

let mockSchoolDocs = [];
let mockCollections = {}; // { [`${collection}:${schoolId}`]: [...docs] }

function mockDocsFor(collection, schoolId) {
  return mockCollections[`${collection}:${schoolId}`] || [];
}

jest.mock('../../utils/tenant-model', () => ({
  // Docs are already partitioned by collection+schoolId via the mock's own
  // key scheme (see mockDocsFor) — schoolId in the filter is redundant
  // with that partitioning (real docs would carry it, these fixtures
  // don't bother), so it's skipped here rather than requiring every
  // fixture doc to redundantly repeat the schoolId key too.
  tenantModel: jest.fn((collection, ctx) => ({
    countDocuments: (filter) => {
      const docs = mockDocsFor(collection, ctx.schoolId);
      const count = docs.filter(d => Object.entries(filter).every(([k, v]) => {
        if (k === 'schoolId') return true;
        if (v && typeof v === 'object' && '$ne' in v) return d[k] !== v.$ne;
        return d[k] === v;
      })).length;
      return Promise.resolve(count);
    },
  })),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return { find: () => ({ select: () => ({ lean: () => Promise.resolve(mockSchoolDocs) }) }) };
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
  mockSchoolDocs = [{ id: 'sch_trinitas', name: 'Trinitas International School', slug: 'trinitas-tis' }];
  mockCollections = {};
});

describe('GET /api/platform/schools — staff stat', () => {
  test('counts real staff from the teachers directory, NOT every active login account', async () => {
    // Mirrors the real incident's shape: hundreds of student/parent LOGIN
    // accounts vastly outnumber the handful of real staff.
    mockCollections['users:sch_trinitas'] = [
      ...Array.from({ length: 313 }, (_, i) => ({ role: 'student', isActive: true, id: `stu_${i}` })),
      ...Array.from({ length: 5 },   (_, i) => ({ role: 'parent',  isActive: true, id: `par_${i}` })),
      ...Array.from({ length: 54 },  (_, i) => ({ role: 'teacher', isActive: true, id: `tch_login_${i}` })),
    ];
    mockCollections['teachers:sch_trinitas'] = Array.from({ length: 54 }, (_, i) => ({ id: `tch_${i}`, status: 'active' }));
    mockCollections['students:sch_trinitas'] = Array.from({ length: 311 }, (_, i) => ({ id: `stu_${i}`, status: 'active' }));

    const res = await supertest(app()).get('/api/platform/schools');
    expect(res.status).toBe(200);
    expect(res.body[0]._stats.staff).toBe(54);
    expect(res.body[0]._stats.students).toBe(311);
  });

  test('a terminated staff member is not counted', async () => {
    mockCollections['teachers:sch_trinitas'] = [
      { id: 'tch_1', status: 'active' },
      { id: 'tch_2', status: 'on_leave' },
      { id: 'tch_3', status: 'terminated' },
    ];
    mockCollections['students:sch_trinitas'] = [];

    const res = await supertest(app()).get('/api/platform/schools');
    expect(res.status).toBe(200);
    expect(res.body[0]._stats.staff).toBe(2); // active + on_leave, not the terminated one
  });

  test('a school with zero staff records shows 0, not an inflated login-account count', async () => {
    mockCollections['users:sch_trinitas'] = [{ role: 'superadmin', isActive: true, id: 'u1' }];
    mockCollections['teachers:sch_trinitas'] = [];
    mockCollections['students:sch_trinitas'] = [];

    const res = await supertest(app()).get('/api/platform/schools');
    expect(res.status).toBe(200);
    expect(res.body[0]._stats.staff).toBe(0);
  });
});
