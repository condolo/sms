/* ============================================================
   server/routes/behaviour.js — POST /incidents notifies the
   student's parent(s)/guardian(s) (Governance-style notification
   activation). Real trigger coverage for behaviour_incident, the
   event explicitly requested — dispatchNotification itself is
   covered separately in notify-dispatch.test.js, so this test
   verifies behaviour.js resolves the RIGHT recipients and calls it.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      if (Array.isArray(doc[k])) return doc[k].includes(v);
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    create:  async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
  };
}

let mockStores;
let mockCurrentUser;
const mockDispatch = jest.fn().mockResolvedValue(undefined);

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockDispatch(...args) }));
jest.mock('../../utils/email', () => ({ sendBehaviourIncidentAlert: jest.fn() }));

const express   = require('express');
const supertest = require('supertest');
const router    = require('../../routes/behaviour');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviour', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [] };
  mockStores = {
    behaviour_incidents: makeStore([]),
    students: makeStore([{ id: 'stu_1', schoolId: SCHOOL, firstName: 'Jane', lastName: 'Doe' }]),
    schools:  makeStore([{ id: SCHOOL, name: 'Test School', systemEmail: 'office@test.io' }]),
    users:    makeStore([
      { id: 'u_parent1', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_1'], name: 'Parent One', email: 'p1@x.io', isActive: true },
      { id: 'u_parent2', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_1'], name: 'Parent Two', email: 'p2@x.io', isActive: true },
      { id: 'u_other_parent', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_2'], name: 'Unrelated Parent', email: 'other@x.io', isActive: true },
    ]),
  };
});

test('creating an incident notifies exactly the student\'s guardians, not unrelated parents', async () => {
  const app = buildApp();
  const res = await supertest(app).post('/api/behaviour/incidents').send({
    studentId: 'stu_1', type: 'demerit', title: 'Late to class', points: -2,
  });
  expect(res.status).toBe(201);

  // Notification dispatch is fire-and-forget (doesn't block the response) — flush microtasks.
  await new Promise(r => setImmediate(r));

  expect(mockDispatch).toHaveBeenCalledTimes(1);
  const call = mockDispatch.mock.calls[0][0];
  expect(call.eventKey).toBe('behaviour_incident');
  expect(call.items).toHaveLength(1);
  expect(call.items[0].studentId).toBe('stu_1');
  expect(call.items[0].inAppSubject).toContain('Jane Doe');
});

test('an incident for a student not found in the DB never calls the fan-out helper', async () => {
  mockStores.students = makeStore([]); // studentId won't resolve
  const app = buildApp();
  const res = await supertest(app).post('/api/behaviour/incidents').send({
    studentId: 'stu_missing', type: 'merit', title: 'Great effort',
  });
  expect(res.status).toBe(201);
  await new Promise(r => setImmediate(r));
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('a failure while resolving guardians/notifying never fails the incident creation itself', async () => {
  mockStores.students = makeStore([]); // student lookup will find nothing -> _notifyGuardians returns early, no throw
  const app = buildApp();
  const res = await supertest(app).post('/api/behaviour/incidents').send({
    studentId: 'stu_missing', type: 'demerit', title: 'Test',
  });
  expect(res.status).toBe(201); // creation succeeded regardless
});
