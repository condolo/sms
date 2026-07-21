/* ============================================================
   GET /api/analytics/group + _combineSnapshots — unit tests.

   /group rolls up the existing per-school Leadership Analytics
   (GET /api/analytics/leadership) across every school in the caller's
   organization, for a read-only 'group_director' account. First-ever
   coverage for server/routes/analytics.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../../middleware/rbac',  () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../../middleware/plan',  () => ({ planGate: () => (_r, _s, n) => n() }));

let mockSchoolsById = {};   // id -> { id, name, organizationId, isActive }
let mockAggResults  = {};   // `${collection}::${schoolId}` -> array (aggregate result) or docs (find result)

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection, ctx) => ({
    aggregate: async () => mockAggResults[`${collection}::${ctx.schoolId}`] ?? [],
    find:      () => ({ lean: async () => mockAggResults[`${collection}::${ctx.schoolId}`] ?? [] }),
  })),
}));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection !== 'schools') return { find: () => ({ lean: async () => [] }) };
    return {
      findOne: (filter) => ({
        lean: async () => Object.values(mockSchoolsById).find(s => s.id === filter.id) || null,
      }),
      find: (filter) => ({
        select: () => ({
          lean: async () => Object.values(mockSchoolsById).filter(s =>
            s.organizationId === filter.organizationId && s.isActive !== false
          ),
        }),
      }),
    };
  }),
}));

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.jwtUser = { schoolId: req.headers['x-test-school'] }; next(); });
  a.use('/api/analytics', require('../../routes/analytics'));
  return a;
}

function makeSnapshot({ collectionRate = 90, atRiskCount = 0, incidents = 0 } = {}) {
  return {
    feeExposure: { totalOutstanding: 1000, totalInvoiced: 10000, totalPaid: 9000, studentsOwing: 5, overdueCount: 1, overdueAmount: 500, collectionRate },
    attendanceRisk: [{ classId: 'c1', className: 'Form 1', totalStudents: 30, atRiskCount, atRiskPct: 0, avgRate: 92 }],
    academicHealth: [{ classId: 'c1', className: 'Form 1', avgScore: 70, studentCount: 30 }],
    behaviourHeatmap: [{ classId: 'c1', className: 'Form 1', total: incidents, merits: 2, demerits: 1, high: 0, medium: 1, low: 0 }],
  };
}

describe('_combineSnapshots — pure rollup logic', () => {
  const { _combineSnapshots } = require('../../routes/analytics');

  test('sums fee/behaviour totals and weight-averages attendance/academic by student count', () => {
    const perSchool = [
      { schoolId: 'a', schoolName: 'A', snapshot: makeSnapshot({ atRiskCount: 3, incidents: 3 }) },
      { schoolId: 'b', schoolName: 'B', snapshot: makeSnapshot({ atRiskCount: 1, incidents: 2 }) },
    ];
    const combined = _combineSnapshots(perSchool);

    expect(combined.feeExposure.totalOutstanding).toBe(2000);
    expect(combined.feeExposure.totalInvoiced).toBe(20000);
    expect(combined.feeExposure.collectionRate).toBe(90); // 18000/20000

    expect(combined.attendance.totalStudents).toBe(60);
    expect(combined.attendance.atRiskCount).toBe(4);
    expect(combined.attendance.avgRate).toBe(92); // both schools report the same avgRate

    expect(combined.academic.studentCount).toBe(60);
    expect(combined.academic.avgScore).toBe(70);

    expect(combined.behaviour.total).toBe(5);
    expect(combined.behaviour.merits).toBe(4);
  });

  test('an empty school list produces zeroed, non-throwing totals', () => {
    const combined = _combineSnapshots([]);
    expect(combined.feeExposure.totalOutstanding).toBe(0);
    expect(combined.attendance.avgRate).toBeNull();
    expect(combined.academic.avgScore).toBeNull();
    expect(combined.behaviour.total).toBe(0);
  });
});

describe('GET /api/analytics/group', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchoolsById = {
      home: { id: 'home', name: 'Trinity', organizationId: 'org_1', isActive: true },
      sib:  { id: 'sib',  name: 'Trinitas', organizationId: 'org_1', isActive: true },
      other:{ id: 'other',name: 'Unrelated', organizationId: 'org_2', isActive: true },
    };
    mockAggResults = {}; // every aggregate/find defaults to []
  });

  test('400s when the caller\'s own school has no organization', async () => {
    mockSchoolsById.home.organizationId = null;
    const res = await supertest(app()).get('/api/analytics/group').set('x-test-school', 'home');
    expect(res.status).toBe(400);
  });

  test('rolls up every ACTIVE school in the org, excludes other orgs', async () => {
    const res = await supertest(app()).get('/api/analytics/group').set('x-test-school', 'home');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.schoolCount).toBe(2);
    const ids = res.body.data.schools.map(s => s.schoolId).sort();
    expect(ids).toEqual(['home', 'sib']);
    expect(res.body.data.combined).toBeDefined();
  });

  test('excludes an inactive school in the same org', async () => {
    mockSchoolsById.sib.isActive = false;
    const res = await supertest(app()).get('/api/analytics/group').set('x-test-school', 'home');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.schoolCount).toBe(1);
  });
});
