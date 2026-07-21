/* ============================================================
   server/routes/exams.js — _notifyExamResultsPublished
   (notification-activation for exam_results). Tested directly
   (exported as router._notifyExamResultsPublished).
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed;
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
      return doc[k] === v;
    });
  }
  return { find: (filter) => chain(docs.filter(d => matches(d, filter))) };
}

let mockStores;
const mockNotify = jest.fn().mockResolvedValue(undefined);

jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockNotify(...args) }));
jest.mock('../../utils/email', () => ({ sendExamResultsAlert: jest.fn() }));

const router = require('../../routes/exams');

const SCHOOL = 'school_test_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: { findOne: () => chain({ name: 'Test School', systemEmail: 'office@test.io' }) },
    exam_results: makeStore([
      { schoolId: SCHOOL, examId: 'exam_1', studentId: 'stu_1' },
      { schoolId: SCHOOL, examId: 'exam_1', studentId: 'stu_2' },
      { schoolId: SCHOOL, examId: 'exam_other', studentId: 'stu_3' },
    ]),
    students: makeStore([
      { id: 'stu_1', firstName: 'Jane', lastName: 'Doe' },
      { id: 'stu_2', firstName: 'John', lastName: 'Smith' },
    ]),
  };
});

test('notifies once per student who sat the exam, not students from other exams', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  const exam = { id: 'exam_1', title: 'Midterm Test' };
  await router._notifyExamResultsPublished(req, exam);

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('exam_results');
  expect(call.items.map(i => i.studentId).sort()).toEqual(['stu_1', 'stu_2']);
  expect(call.items[0].inAppBody).toContain('Midterm Test');
});

test('an exam with no results recorded never calls the fan-out helper', async () => {
  const req = { jwtUser: { schoolId: SCHOOL } };
  const exam = { id: 'exam_no_results', title: 'Empty' };
  await router._notifyExamResultsPublished(req, exam);
  expect(mockNotify).not.toHaveBeenCalled();
});
