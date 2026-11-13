/* ============================================================
   server/routes/timetable.js — GET /student/:studentId (2026-11)

   New route behind the Student Profile's Timetable tab. Deliberately
   gated by rbac('students','read') — the SAME floor that gates viewing
   the profile itself — NOT timetableManageAccess('read'), which this
   caller (any staffer who can open a profile) would usually fail. This
   pins that choice: the route must ask for exactly ('students','read'),
   and must union this student's own stream's slots with any genuine
   whole-class slot, excluding both a different stream of the same class
   and a different class entirely — the same rule every other student-
   facing timetable read in this codebase already applies.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_demo';

function matchesFilter(doc, filter) {
  // Shared MongoDB-like matcher (v5.270.0): lesson filters now use $and,
  // null-matches-missing and array fields, which this file's own matcher didn't model.
  return require('../fixtures/fake-tenant-db').matches(doc, filter);
}
function mockChain(rows) {
  let data = Array.isArray(rows) ? [...rows] : rows;
  const c = {
    select: () => c,
    sort: () => c,
    limit: () => c,
    lean: () => Promise.resolve(data),
  };
  return c;
}
const collections = {};
function mockCollection(name, seed = []) {
  collections[name] = {
    _seed: seed,
    find: jest.fn((filter) => mockChain(seed.filter((d) => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChain(seed.find((d) => matchesFilter(d, filter)) ?? null)),
  };
  return collections[name];
}

let rbacCall = null;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_staff', schoolId: SCHOOL, role: 'teacher' }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  // Pins exactly which (resource, action) this route asks for, rather
  // than exercising the real RBAC engine (covered elsewhere) — a caller
  // who holds the profile-viewing floor passes; anything else is refused.
  rbac: (resource, action) => {
    rbacCall = { resource, action };
    return (req, res, next) => {
      if (resource === 'students' && action === 'read') return next();
      return res.status(403).json({ success: false, error: { message: 'forbidden' } });
    };
  },
  hasExplicitSubGrant: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../routes/bell-schedule', () => ({ resolveBellSchedule: jest.fn().mockResolvedValue({ periods: [] }) }));
jest.mock('../../utils/model', () => ({ _model: jest.fn(() => ({ find: () => mockChain([]), findOne: () => mockChain(null) })) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => collections[name] ?? mockCollection(name),
}));

const express   = require('express');
const supertest = require('supertest');
const timetable = require('../../routes/timetable');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetable);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCollection('students', [
    { id: 'stu_brian', schoolId: SCHOOL, classId: 'cls_7a', className: 'Grade 7A', streamId: 'strm_7a', streamName: 'Blue' },
    { id: 'stu_no_class', schoolId: SCHOOL, classId: null },
  ]);
  mockCollection('timetable', [
    { id: 'slot_1', schoolId: SCHOOL, classId: 'cls_7a', streamId: 'strm_7a', day: 'monday', startTime: '08:00', subject: 'Mathematics', isActive: true },
    { id: 'slot_2', schoolId: SCHOOL, classId: 'cls_7a', day: 'monday', startTime: '09:00', subject: 'Assembly', isActive: true }, // whole-class
    { id: 'slot_3', schoolId: SCHOOL, classId: 'cls_7a', streamId: 'strm_other', day: 'monday', startTime: '10:00', subject: 'French', isActive: true }, // a different stream
    { id: 'slot_4', schoolId: SCHOOL, classId: 'cls_4b', streamId: 'strm_4b', day: 'monday', startTime: '08:00', subject: 'English', isActive: true }, // a different class
  ]);
});

describe('GET /api/timetable/student/:studentId', () => {
  // The mocked rbac helper is invoked once, when the router is built at
  // require() time — not per-request — so this is checked directly
  // rather than per-test: it pins which floor the route was wired to.
  test('is gated by the same floor as viewing the profile, not scheduling-admin', () => {
    expect(rbacCall).toEqual({ resource: 'students', action: 'read' });
  });

  test('returns this student\'s own stream slots unioned with whole-class slots, excluding other streams/classes', async () => {
    const res = await supertest(buildApp()).get('/api/timetable/student/stu_brian');

    expect(res.status).toBe(200);
    expect(res.body.data.classId).toBe('cls_7a');
    expect(res.body.data.className).toBe('Grade 7A');
    const subjects = res.body.data.slots.map((s) => s.subject);
    expect(subjects).toEqual(expect.arrayContaining(['Mathematics', 'Assembly']));
    expect(subjects).not.toContain('French');   // a different stream of the same class
    expect(subjects).not.toContain('English');  // a different class entirely
  });

  test('a student with no class assigned yet returns an empty schedule, not an error', async () => {
    const res = await supertest(buildApp()).get('/api/timetable/student/stu_no_class');
    expect(res.status).toBe(200);
    expect(res.body.data.slots).toEqual([]);
  });

  test('an unknown student id 404s', async () => {
    const res = await supertest(buildApp()).get('/api/timetable/student/stu_ghost');
    expect(res.status).toBe(404);
  });
});
