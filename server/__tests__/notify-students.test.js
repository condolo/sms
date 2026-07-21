/* ============================================================
   server/utils/notify-students.js — shared guardian fan-out
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeUsersStore(seed) {
  const docs = seed;
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      if (Array.isArray(doc[k])) return doc[k].includes(v);
      return doc[k] === v;
    });
  }
  return { find: (filter) => chain(docs.filter(d => matches(d, filter))) };
}

let mockStores;
const mockDispatch = jest.fn().mockResolvedValue(undefined);

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/notify-dispatch', () => ({ dispatchNotification: (...args) => mockDispatch(...args) }));

const { notifyGuardiansForStudents } = require('../utils/notify-students');

const SCHOOL = 'school_test_001';
const ctx = { schoolId: SCHOOL };

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    users: makeUsersStore([
      { id: 'u_p1', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_1'], name: 'P1', email: 'p1@x.io', isActive: true },
      { id: 'u_p2', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_2'], name: 'P2', email: 'p2@x.io', isActive: true },
      { id: 'u_p3_inactive', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_3'], name: 'P3', email: 'p3@x.io', isActive: false },
    ]),
  };
});

test('resolves and dispatches per student independently', async () => {
  await notifyGuardiansForStudents({
    ctx, schoolId: SCHOOL, eventKey: 'report_published',
    items: [
      { studentId: 'stu_1', inAppSubject: 'S1', sendEmail: jest.fn() },
      { studentId: 'stu_2', inAppSubject: 'S2', sendEmail: jest.fn() },
    ],
  });
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(mockDispatch.mock.calls[0][0].recipients.map(r => r.userId)).toEqual(['u_p1']);
  expect(mockDispatch.mock.calls[1][0].recipients.map(r => r.userId)).toEqual(['u_p2']);
});

test('a student with no guardians on record is skipped, no dispatch call', async () => {
  await notifyGuardiansForStudents({
    ctx, schoolId: SCHOOL, eventKey: 'report_published',
    items: [{ studentId: 'stu_no_parent', inAppSubject: 'S' }],
  });
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('an inactive guardian is excluded', async () => {
  await notifyGuardiansForStudents({
    ctx, schoolId: SCHOOL, eventKey: 'report_published',
    items: [{ studentId: 'stu_3', inAppSubject: 'S' }],
  });
  expect(mockDispatch).not.toHaveBeenCalled(); // only guardian is inactive
});

test('one student failing does not block the next', async () => {
  mockDispatch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
  await notifyGuardiansForStudents({
    ctx, schoolId: SCHOOL, eventKey: 'report_published',
    items: [
      { studentId: 'stu_1', inAppSubject: 'S1' },
      { studentId: 'stu_2', inAppSubject: 'S2' },
    ],
  });
  expect(mockDispatch).toHaveBeenCalledTimes(2);
});

test('items with no studentId are skipped', async () => {
  await notifyGuardiansForStudents({ ctx, schoolId: SCHOOL, eventKey: 'report_published', items: [{ inAppSubject: 'S' }] });
  expect(mockDispatch).not.toHaveBeenCalled();
});
