/* ============================================================
   GET /api/parent-portal/transport/:childId

   The parent's read is a join the desk already owns: transport_assignments
   says where a child stands and which way they travel, transport_routes says
   what vehicle, what time and who drives. A parent needs both at once, which
   is why one endpoint returns them together instead of making the phone hold
   the staff routes' RBAC.

   What is pinned here, and why each would break quietly:
   - the route is resolved, not trusted: an assignment whose route has been
     deleted reports `route: null` while keeping its denormalised name. A
     client that read a missing route as "no times set" would tell a parent the
     office never set a departure time;
   - only this child's assignments. `studentId` comes from the URL and is
     checked against the link list first — the same guard as every other
     child-scoped read;
   - no assignments is an empty list, not a 404. A school that runs no buses
     must leave the parent's home screen without a dead tile, not with an error;
   - the fare type travels with the ride: the amount is on the route, and which
     of the route's two fares a family pays is on the assignment. Neither alone
     answers "what am I billed".

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { ...global.__PARENT_JWT };
    next();
  },
}));

jest.mock('../../utils/timetable-publish', () => ({
  isTimetablePublished: jest.fn().mockResolvedValue(false),
  publishedReader: jest.fn(),
}));

jest.mock('../../routes/weekly-snapshots', () => ({ _helpers: {} }));

const SCHOOL = 'sch_riverside';
const CHILD  = 'stu_brian';
const SIBLING = 'stu_joy';
const ROUTE = 'rt_karen';

function valueMatches(docVal, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$in' in cond) {
      return Array.isArray(docVal)
        ? docVal.some((v) => cond.$in.includes(v))
        : cond.$in.includes(docVal);
    }
    if ('$ne' in cond) return docVal !== cond.$ne;
    return false;
  }
  return docVal === cond;
}

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$and') return cond.every((sub) => matchesFilter(doc, sub));
    return valueMatches(doc[key], cond);
  });
}

function mockChain(rows) {
  let data = Array.isArray(rows) ? [...rows] : rows;
  const c = {
    select: () => c,
    sort: (spec) => {
      if (spec && Array.isArray(data)) {
        const [field, dir] = Object.entries(spec)[0] ?? [];
        if (field) {
          data = [...data].sort((a, b) => {
            if (a[field] === b[field]) return 0;
            return (a[field] > b[field] ? 1 : -1) * (dir < 0 ? -1 : 1);
          });
        }
      }
      return c;
    },
    lean: () => Promise.resolve(data),
  };
  return c;
}

const mockCollections = {};

function mockCollection(name, seed = []) {
  const col = {
    _seed: seed,
    find: jest.fn((filter) => mockChain(seed.filter((d) => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChain(seed.find((d) => matchesFilter(d, filter)) ?? null)),
  };
  mockCollections[name] = col;
  return col;
}

jest.mock('../../utils/model', () => ({ _model: jest.fn(() => mockChain(null)) }));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: jest.fn((name) => mockCollections[name] ?? mockCollection(name)),
}));

const express   = require('express');
const supertest = require('supertest');
const parentPortal = require('../../routes/parent-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortal);
  return app;
}

const BUS = {
  id: ROUTE,
  schoolId: SCHOOL,
  name: 'Karen Morning Run',
  origin: 'Karen',
  destination: 'Riverside Academy',
  stops: ['Karen Roundabout', 'Bogota', 'State Lodge'],
  departureTime: '06:40',
  arrivalTime: '07:25',
  vehicleType: 'bus',
  vehicleReg: 'KDG 123A',
  driverName: 'Peter Njoroge',
  driverPhone: '0700 111 222',
  capacity: 30,
  feePerTerm: 18000,
  fares: [{ fareType: 'one_way', amount: 11000 }, { fareType: 'two_way', amount: 18000 }],
  notes: 'Photos on the office wall.',
};

beforeEach(() => {
  jest.clearAllMocks();
  global.__PARENT_JWT = {
    userId: 'usr_kamau', schoolId: SCHOOL, role: 'parent',
    studentIds: [CHILD], guardianOf: [SIBLING],
  };

  mockCollection('students', [
    { id: CHILD,   schoolId: SCHOOL, firstName: 'Brian', lastName: 'Kamau', className: 'Grade 7A' },
    { id: SIBLING, schoolId: SCHOOL, firstName: 'Joy',   lastName: 'Kamau', className: 'Grade 4B' },
  ]);
  mockCollection('transport_routes', [BUS]);
  mockCollection('transport_assignments', []);
});

/* ── the join ───────────────────────────────────────────────────── */

describe('GET /api/parent-portal/transport/:childId', () => {
  test('the ride and its route come back as one read, with the times the parent stands up for', async () => {
    mockCollections.transport_assignments._seed.push({
      id: 'as_1', schoolId: SCHOOL, routeId: ROUTE, routeName: 'Karen Morning Run',
      studentId: CHILD, studentName: 'Brian Kamau', studentClass: 'Grade 7A',
      pickupStop: 'Bogota', direction: 'both', fareType: 'two_way',
      startDate: '2026-01-08', endDate: null, notes: '', status: 'active',
    });

    const res = await supertest(buildApp()).get(`/api/parent-portal/transport/${CHILD}`);

    expect(res.status).toBe(200);
    expect(res.body.data.child).toEqual({ id: CHILD, name: 'Brian Kamau', className: 'Grade 7A' });

    const ride = res.body.data.assignments[0];
    expect(ride).toMatchObject({
      id: 'as_1', pickupStop: 'Bogota', direction: 'both', fareType: 'two_way', status: 'active',
    });
    expect(ride.route).toMatchObject({
      id: ROUTE, name: 'Karen Morning Run', departureTime: '06:40', arrivalTime: '07:25',
      vehicleReg: 'KDG 123A', driverName: 'Peter Njoroge', driverPhone: '0700 111 222',
    });
    // The stop the parent is told about must be one the bus actually makes.
    expect(ride.route.stops).toContain('Bogota');
    // Both prices travel with the route; the assignment's fareType picks which.
    expect(ride.route.fares).toEqual([
      { fareType: 'one_way', amount: 11000 },
      { fareType: 'two_way', amount: 18000 },
    ]);
  });

  test('a route the office deleted is a null route with a name, never a run with no times', async () => {
    mockCollections.transport_assignments._seed.push({
      id: 'as_2', schoolId: SCHOOL, routeId: 'rt_gone', routeName: 'Westlands Run',
      studentId: CHILD, pickupStop: 'Westlands', direction: 'to_school',
      fareType: 'one_way', startDate: '2025-09-01', endDate: '2025-12-12',
      status: 'inactive',
    });

    const res = await supertest(buildApp()).get(`/api/parent-portal/transport/${CHILD}`);

    expect(res.status).toBe(200);
    const ride = res.body.data.assignments[0];
    expect(ride.route).toBeNull();
    expect(ride.routeName).toBe('Westlands Run');
    expect(ride.status).toBe('inactive');
  });

  test('a current and a past ride are one read, newest first', async () => {
    mockCollections.transport_assignments._seed.push(
      { id: 'as_old', schoolId: SCHOOL, routeId: ROUTE, routeName: BUS.name, studentId: CHILD,
        pickupStop: 'Bogota', direction: 'both', fareType: 'one_way', startDate: '2025-09-01', endDate: '2025-12-12', status: 'inactive' },
      { id: 'as_new', schoolId: SCHOOL, routeId: ROUTE, routeName: BUS.name, studentId: CHILD,
        pickupStop: 'Karen Roundabout', direction: 'both', fareType: 'two_way', startDate: '2026-01-08', endDate: null, status: 'active' },
    );

    const res = await supertest(buildApp()).get(`/api/parent-portal/transport/${CHILD}`);
    expect(res.body.data.assignments.map((a) => a.id)).toEqual(['as_new', 'as_old']);
  });

  test('a sibling on a different route never appears on this child', async () => {
    mockCollections.transport_assignments._seed.push(
      { id: 'as_joy', schoolId: SCHOOL, routeId: ROUTE, routeName: BUS.name, studentId: SIBLING, status: 'active' },
      { id: 'as_brian', schoolId: SCHOOL, routeId: ROUTE, routeName: BUS.name, studentId: CHILD, status: 'active' },
    );

    const res = await supertest(buildApp()).get(`/api/parent-portal/transport/${CHILD}`);
    expect(res.body.data.assignments.map((a) => a.id)).toEqual(['as_brian']);
  });

  test('a child with no ride is an empty list, so the home screen hides the tile', async () => {
    const res = await supertest(buildApp()).get(`/api/parent-portal/transport/${SIBLING}`);
    expect(res.status).toBe(200);
    expect(res.body.data.assignments).toEqual([]);
  });

  test('another family’s child is refused before a single transport document is read', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/transport/stu_someone_else');
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
    expect(mockCollections.transport_assignments.find).not.toHaveBeenCalled();
  });

  test('a non-parent token is refused even for a child id it can guess', async () => {
    global.__PARENT_JWT = { userId: 'usr_head', schoolId: SCHOOL, role: 'teacher', studentIds: [CHILD] };
    const res = await supertest(buildApp()).get(`/api/parent-portal/transport/${CHILD}`);
    expect(res.status).toBe(403);
  });
});
