/* ============================================================
   server/routes/report-cards.js — _notifyReportCardsPublished
   (notification-activation for report_published). Tested directly
   (exported as router._notifyReportCardsPublished) rather than
   through the full /publish route, which is transaction-wrapped and
   loads academic config — orthogonal to what this verifies: the
   right per-student fan-out call with the right content.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

let mockStores;
const mockNotify = jest.fn().mockResolvedValue(undefined);

jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockNotify(...args) }));
jest.mock('../../utils/email', () => ({ sendReportCardPublishedAlert: jest.fn() }));

const router = require('../../routes/report-cards');

const SCHOOL = 'school_test_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: { findOne: () => chain({ name: 'Test School', systemEmail: 'office@test.io' }) },
  };
});

test('notifies once per published student with the right content', async () => {
  const req = { jwtUser: { schoolId: SCHOOL }, tenantContext: {} };
  const snaps = [
    { studentId: 'stu_1', studentName: 'Jane Doe', termName: 'Term 2', academicYear: '2026' },
    { studentId: 'stu_2', studentName: 'John Smith', termName: 'Term 2', academicYear: '2026' },
  ];
  await router._notifyReportCardsPublished(req, snaps);

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('report_published');
  expect(call.items).toHaveLength(2);
  expect(call.items[0].studentId).toBe('stu_1');
  expect(call.items[0].inAppSubject).toContain('Jane Doe');
  expect(call.items[1].studentId).toBe('stu_2');
});

test('an empty batch never calls the fan-out helper', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  await router._notifyReportCardsPublished(req, []);
  expect(mockNotify).not.toHaveBeenCalled();
});
