/* ============================================================
   server/utils/attendance-summary-cron.js — daily end-of-day
   rollup to admin/principal staff for schools with attendance
   marked that day, via dispatchNotification.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  return {
    find: (filter) => chain(seed.filter(d => {
      return Object.entries(filter).every(([k, v]) => {
        if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
        if (v && typeof v === 'object' && '$ne' in v) return d[k] !== v.$ne;
        return d[k] === v;
      });
    })),
  };
}

let mockStores;
const mockDispatch = jest.fn().mockResolvedValue(undefined);

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/notify-dispatch', () => ({ dispatchNotification: (...args) => mockDispatch(...args) }));
jest.mock('../utils/email', () => ({ sendAttendanceSummaryAlert: jest.fn() }));

const { runAttendanceSummary } = require('../utils/attendance-summary-cron');

const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: makeStore([
      { id: SCHOOL_A, name: 'School A', systemEmail: 'a@x.io', isActive: true },
      { id: SCHOOL_B, name: 'School B', systemEmail: 'b@x.io', isActive: true },
    ]),
    attendance: makeStore([
      { schoolId: SCHOOL_A, date: today, status: 'present' },
      { schoolId: SCHOOL_A, date: today, status: 'present' },
      { schoolId: SCHOOL_A, date: today, status: 'absent' },
      { schoolId: SCHOOL_A, date: today, status: 'late' },
      // SCHOOL_B has no attendance marked today.
    ]),
    users: makeStore([
      { id: 'admin_1', schoolId: SCHOOL_A, name: 'Admin One', email: 'admin1@x.io', role: 'admin', isActive: true },
      { id: 'teacher_1', schoolId: SCHOOL_A, name: 'Teacher One', email: 't1@x.io', role: 'teacher', isActive: true },
    ]),
  };
});

test('dispatches one summary to admin/principal staff for a school with attendance marked today', async () => {
  await runAttendanceSummary();

  expect(mockDispatch).toHaveBeenCalledTimes(1);
  const call = mockDispatch.mock.calls[0][0];
  expect(call.schoolId).toBe(SCHOOL_A);
  expect(call.eventKey).toBe('attendance_summary');
  expect(call.recipients).toHaveLength(1);
  expect(call.recipients[0].userId).toBe('admin_1');
  expect(call.inAppBody).toContain('2 present');
  expect(call.inAppBody).toContain('1 absent');
  expect(call.inAppBody).toContain('1 late');
});

test('a school with no attendance marked today is skipped', async () => {
  mockStores.attendance = makeStore([]);
  await runAttendanceSummary();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('a school with attendance but no admin/principal staff is skipped', async () => {
  mockStores.users = makeStore([
    { id: 'teacher_1', schoolId: SCHOOL_A, name: 'Teacher One', email: 't1@x.io', role: 'teacher', isActive: true },
  ]);
  await runAttendanceSummary();
  expect(mockDispatch).not.toHaveBeenCalled();
});
