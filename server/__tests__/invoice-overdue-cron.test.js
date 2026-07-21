/* ============================================================
   server/utils/invoice-overdue-cron.js — daily sweep across all
   schools for unpaid/partial invoices past dueDate, notifying each
   invoiced student's guardian(s) via notifyGuardiansForStudents.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  return {
    find: (filter) => chain(seed.filter(d => {
      return Object.entries(filter).every(([k, v]) => {
        if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
        if (v && typeof v === 'object' && ('$lt' in v || '$ne' in v)) {
          if ('$ne' in v && d[k] === v.$ne) return false;
          if ('$lt' in v && !(d[k] < v.$lt)) return false;
          return true;
        }
        return d[k] === v;
      });
    })),
  };
}

let mockStores;
const mockNotify = jest.fn().mockResolvedValue(undefined);

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockNotify(...args) }));
jest.mock('../utils/email', () => ({ sendInvoiceOverdueAlert: jest.fn() }));

const { runInvoiceOverdueCheck } = require('../utils/invoice-overdue-cron');

const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    schools: makeStore([
      { id: SCHOOL_A, name: 'School A', systemEmail: 'a@x.io', isActive: true },
      { id: SCHOOL_B, name: 'School B', systemEmail: 'b@x.io', isActive: true },
    ]),
    invoices: makeStore([
      { id: 'inv1', schoolId: SCHOOL_A, studentId: 'stu_1', status: 'unpaid',  invoiceNumber: 'INV-1', total: 500, balance: 500, currency: 'KES', dueDate: '2020-01-01' },
      { id: 'inv2', schoolId: SCHOOL_A, studentId: 'stu_2', status: 'partial', invoiceNumber: 'INV-2', total: 500, balance: 200, currency: 'KES', dueDate: '2020-01-01' },
      { id: 'inv3', schoolId: SCHOOL_A, studentId: 'stu_3', status: 'paid',    invoiceNumber: 'INV-3', total: 500, balance: 0,   currency: 'KES', dueDate: '2020-01-01' },
      { id: 'inv4', schoolId: SCHOOL_B, studentId: 'stu_4', status: 'unpaid',  invoiceNumber: 'INV-4', total: 300, balance: 300, currency: 'KES', dueDate: '2099-01-01' },
    ]),
    students: makeStore([
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Jane', lastName: 'Doe' },
      { id: 'stu_2', schoolId: SCHOOL_A, firstName: 'John', lastName: 'Smith' },
    ]),
  };
});

test('notifies once per school for its overdue invoices, excluding paid and not-yet-due', async () => {
  await runInvoiceOverdueCheck();

  // SCHOOL_A has 2 overdue (inv1, inv2); SCHOOL_B's invoice isn't due yet.
  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.schoolId).toBe(SCHOOL_A);
  expect(call.eventKey).toBe('invoice_overdue');
  expect(call.items.map(i => i.studentId).sort()).toEqual(['stu_1', 'stu_2']);
  expect(call.items[0].inAppBody).toContain('overdue');
});

test('a school with no overdue invoices never calls the fan-out helper', async () => {
  mockStores.invoices = makeStore([]);
  await runInvoiceOverdueCheck();
  expect(mockNotify).not.toHaveBeenCalled();
});
