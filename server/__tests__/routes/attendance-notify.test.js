/* ============================================================
   server/routes/attendance.js — _notifyAbsences
   (notification-activation for absence_alert). Tested directly
   (exported as router._notifyAbsences).
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  return {
    find: (filter) => chain(seed.filter(d => (filter.id?.$in ? filter.id.$in.includes(d.id) : true))),
  };
}

let mockStores;
const mockNotify = jest.fn().mockResolvedValue(undefined);

jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockNotify(...args) }));
jest.mock('../../utils/email', () => ({ sendAbsenceAlert: jest.fn() }));

const router = require('../../routes/attendance');

const SCHOOL = 'school_test_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: { findOne: () => chain({ name: 'Test School', systemEmail: 'office@test.io' }) },
    students: makeStore([
      { id: 'stu_1', firstName: 'Jane', lastName: 'Doe' },
      { id: 'stu_2', firstName: 'John', lastName: 'Smith' },
    ]),
  };
});

test('notifies once per absent student in a batch', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  await router._notifyAbsences(req, [
    { studentId: 'stu_1', date: '2026-07-20' },
    { studentId: 'stu_2', date: '2026-07-20' },
  ]);

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('absence_alert');
  expect(call.items.map(i => i.studentId).sort()).toEqual(['stu_1', 'stu_2']);
  expect(call.items[0].inAppBody).toContain('2026-07-20');
});

test('an empty batch never calls the fan-out helper', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  await router._notifyAbsences(req, []);
  expect(mockNotify).not.toHaveBeenCalled();
});
