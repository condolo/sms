/* ============================================================
   The bus a student rides — GET /api/student-portal/transport and the parent
   portal's GET /api/parent-portal/transport/:childId.

   One shared read (utils/transport-ride.js) answers both, so this suite checks
   the two faces agree AND that each keeps its own guard: the student route
   only ever looks at the account's own record, the parent route only at a
   child that parent is linked to.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = global._jwt; next(); },
}));

const SCHOOL  = 'sch_1';
const OTHER_SCHOOL = 'sch_2';
const STUDENT = 'stu_1';

/* ── fixture store ─────────────────────────────────────────────── */
const transport_routes = [
  { schoolId: SCHOOL, id: 'rte_1', name: 'Westlands Express', origin: 'Westlands', destination: 'School',
    vehicleType: 'bus', vehicleReg: 'KDH 485Z', driverName: 'Mr. John Nderitu', driverPhone: '+254 712 345 678',
    stops: ['Sarit Centre', 'Village Market'], departureTime: '06:15', arrivalTime: '07:15',
    capacity: 40, fares: [{ fareType: 'one_way', amount: 7200 }, { fareType: 'two_way', amount: 12000 }],
    notes: 'Morning pickup.' },
  { schoolId: OTHER_SCHOOL, id: 'rte_other', name: 'Other School Run', departureTime: '07:00' },
];

const transport_assignments = [
  { schoolId: SCHOOL, id: 'asg_1', routeId: 'rte_1', routeName: 'Westlands Express', studentId: STUDENT,
    pickupStop: 'Village Market', direction: 'both', fareType: 'two_way',
    startDate: '2026-04-28', endDate: null, notes: 'Gate pickup.', status: 'active' },
  // a previous run on a route the office has since deleted
  { schoolId: SCHOOL, id: 'asg_old', routeId: 'rte_gone', routeName: 'Old Route',
    studentId: STUDENT, pickupStop: 'Old Stop', direction: 'to_school', fareType: 'one_way',
    startDate: '2026-01-06', endDate: '2026-04-01', notes: '', status: 'inactive' },
  // somebody else's ride — must never appear
  { schoolId: SCHOOL, id: 'asg_other', routeId: 'rte_1', routeName: 'Westlands Express', studentId: 'stu_2',
    pickupStop: 'Sarit Centre', direction: 'both', fareType: 'two_way', status: 'active' },
  // same student id, different school — tenancy must still isolate it
  { schoolId: OTHER_SCHOOL, id: 'asg_x', routeId: 'rte_other', routeName: 'Other School Run', studentId: STUDENT,
    pickupStop: 'Elsewhere', direction: 'both', fareType: 'two_way', status: 'active' },
];

const students = [
  { schoolId: SCHOOL, id: STUDENT, firstName: 'Amara', lastName: 'Osei', className: 'Form 1A', admissionNumber: 'ADM-1' },
];

const STORE = { transport_routes, transport_assignments, students };

/* mock-prefixed: jest.mock() factories may only reach out-of-scope names that
   start with "mock" (the same reason the sibling portal suites name theirs
   mockCollection / mockChain / mockMatchesFilter). */
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}
function mockChain(rows) {
  const c = { select: () => c, sort: () => c, limit: () => c, lean: () => Promise.resolve(rows) };
  return c;
}
function mockCollection(name) {
  const seed = STORE[name] ?? [];
  return {
    find:    (filter) => mockChain(seed.filter((d) => mockMatches(d, filter))),
    findOne: (filter) => mockChain(seed.find((d) => mockMatches(d, filter)) ?? null),
  };
}

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (name) => mockCollection(name),
}));
jest.mock('../../utils/model', () => ({ _model: () => ({ findOne: () => mockChain(null) }) }));

const express   = require('express');
const supertest = require('supertest');
const studentRouter = require('../../routes/student-portal');
const parentRouter  = require('../../routes/parent-portal');

function buildApp(router, mount) {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return app;
}
const studentApp = buildApp(studentRouter, '/api/student-portal');
const parentApp  = buildApp(parentRouter,  '/api/parent-portal');

const asStudent = () => { global._jwt = { userId: 'usr_stu', schoolId: SCHOOL, role: 'student', studentId: STUDENT }; };
const asParent  = (studentIds = [STUDENT]) => {
  global._jwt = { userId: 'usr_par', schoolId: SCHOOL, role: 'parent', studentIds, guardianOf: [] };
};

describe('GET /api/student-portal/transport', () => {
  test('returns the student\'s own ride, joined to its route', async () => {
    asStudent();
    const res = await supertest(studentApp).get('/api/student-portal/transport');

    expect(res.status).toBe(200);
    const active = res.body.data.assignments.find((a) => a.status === 'active');
    expect(active).toMatchObject({
      id: 'asg_1',
      routeName: 'Westlands Express',
      pickupStop: 'Village Market',
      direction: 'both',
      fareType: 'two_way',
    });
    // The route side of the join is what makes the screen usable.
    expect(active.route).toMatchObject({
      vehicleType: 'bus', vehicleReg: 'KDH 485Z',
      driverName: 'Mr. John Nderitu', driverPhone: '+254 712 345 678',
      departureTime: '06:15', arrivalTime: '07:15',
    });
    expect(active.route.fares).toEqual([{ fareType: 'one_way', amount: 7200 }, { fareType: 'two_way', amount: 12000 }]);
  });

  test('never returns another student\'s ride, or another school\'s rows', async () => {
    asStudent();
    const res = await supertest(studentApp).get('/api/student-portal/transport');
    const ids = res.body.data.assignments.map((a) => a.id);
    expect(ids).toContain('asg_1');
    expect(ids).not.toContain('asg_other');   // a different student
    expect(ids).not.toContain('asg_x');       // the same id, another tenant
  });

  test('an ended run and a deleted route are reported as such, not as empty times', async () => {
    asStudent();
    const res = await supertest(studentApp).get('/api/student-portal/transport');
    const old = res.body.data.assignments.find((a) => a.id === 'asg_old');
    expect(old.status).toBe('inactive');
    expect(old.routeName).toBe('Old Route');   // survives the route's deletion
    expect(old.route).toBeNull();              // the client hides the times rather than inventing them
    expect(old.endDate).toBe('2026-04-01');
  });

  test('a parent account cannot read a student\'s own transport route', async () => {
    asParent();
    const res = await supertest(studentApp).get('/api/student-portal/transport');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/parent-portal/transport/:childId', () => {
  test('answers the same join, under the child it was asked about', async () => {
    asParent();
    const res = await supertest(parentApp).get(`/api/parent-portal/transport/${STUDENT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.child).toMatchObject({ id: STUDENT, name: 'Amara Osei', className: 'Form 1A' });
    const active = res.body.data.assignments.find((a) => a.status === 'active');
    expect(active.route.driverName).toBe('Mr. John Nderitu');
    expect(active.routeName).toBe('Westlands Express');
  });

  test('refuses a child this parent is not linked to', async () => {
    asParent(['some_other_child']);
    const res = await supertest(parentApp).get(`/api/parent-portal/transport/${STUDENT}`);
    expect(res.status).toBe(403);
  });
});
