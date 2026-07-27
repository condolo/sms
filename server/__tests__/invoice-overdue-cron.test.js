/* ============================================================
   server/utils/invoice-overdue-cron.js — daily sweep across all
   schools for unpaid/partial invoices, reminding guardians on a
   per-school configurable schedule: N days before due, on the due
   date, then every N days after (not every single overdue day).
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
    findOne: (filter) => chain(seed.find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) || null),
  };
}

/** YYYY-MM-DD string `n` days offset from today (Africa/Nairobi, matching the cron's own date basis). */
function dateOffset(n) {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T00:00:00Z');
  today.setUTCDate(today.getUTCDate() + n);
  return today.toISOString().slice(0, 10);
}

let mockStores;
const mockNotify = jest.fn().mockResolvedValue(undefined);

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockNotify(...args) }));
jest.mock('../utils/email', () => ({ sendInvoiceOverdueAlert: jest.fn(), sendInvoiceDueSoonAlert: jest.fn() }));

const { runInvoiceOverdueCheck } = require('../utils/invoice-overdue-cron');

const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';

function baseStores(invoices) {
  return {
    schools: makeStore([
      { id: SCHOOL_A, name: 'School A', systemEmail: 'a@x.io', isActive: true },
      { id: SCHOOL_B, name: 'School B', systemEmail: 'b@x.io', isActive: true },
    ]),
    invoices: makeStore(invoices),
    students: makeStore([
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Jane', lastName: 'Doe' },
      { id: 'stu_2', schoolId: SCHOOL_A, firstName: 'John', lastName: 'Smith' },
      { id: 'stu_3', schoolId: SCHOOL_A, firstName: 'Amy', lastName: 'Lee' },
    ]),
    invoice_reminder_config: makeStore([]), // no saved config → defaults (enabled, before=3, onDue=true, after=4)
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = baseStores([]);
});

test('3 days before due (default schedule) fires invoice_due_soon, not invoice_overdue', async () => {
  mockStores.invoices = makeStore([
    { id: 'inv1', schoolId: SCHOOL_A, studentId: 'stu_1', status: 'unpaid', invoiceNumber: 'INV-1', total: 500, balance: 500, currency: 'KES', dueDate: dateOffset(3) },
  ]);
  await runInvoiceOverdueCheck();

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('invoice_due_soon');
  expect(call.items[0].studentId).toBe('stu_1');
});

test('on the due date fires invoice_overdue with "due today" wording', async () => {
  mockStores.invoices = makeStore([
    { id: 'inv1', schoolId: SCHOOL_A, studentId: 'stu_1', status: 'unpaid', invoiceNumber: 'INV-1', total: 500, balance: 500, currency: 'KES', dueDate: dateOffset(0) },
  ]);
  await runInvoiceOverdueCheck();

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('invoice_overdue');
  expect(call.items[0].inAppBody).toContain('due today');
});

test('at the 4-day post-due interval fires invoice_overdue; off-cadence days fire nothing', async () => {
  mockStores.invoices = makeStore([
    { id: 'inv_oncadence',  schoolId: SCHOOL_A, studentId: 'stu_1', status: 'unpaid',  invoiceNumber: 'INV-1', total: 500, balance: 500, currency: 'KES', dueDate: dateOffset(-4) },
    { id: 'inv_offcadence', schoolId: SCHOOL_A, studentId: 'stu_2', status: 'partial', invoiceNumber: 'INV-2', total: 500, balance: 200, currency: 'KES', dueDate: dateOffset(-5) },
  ]);
  await runInvoiceOverdueCheck();

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('invoice_overdue');
  expect(call.items.map(i => i.studentId)).toEqual(['stu_1']);
  expect(call.items[0].inAppBody).toContain('overdue');
});

test('excludes paid invoices and invoices with no dueDate', async () => {
  mockStores.invoices = makeStore([
    { id: 'inv_paid', schoolId: SCHOOL_A, studentId: 'stu_1', status: 'paid', invoiceNumber: 'INV-1', total: 500, balance: 0, currency: 'KES', dueDate: dateOffset(0) },
    { id: 'inv_nodue', schoolId: SCHOOL_A, studentId: 'stu_2', status: 'unpaid', invoiceNumber: 'INV-2', total: 500, balance: 500, currency: 'KES', dueDate: null },
  ]);
  await runInvoiceOverdueCheck();
  expect(mockNotify).not.toHaveBeenCalled();
});

test('a school with reminders disabled is skipped entirely', async () => {
  mockStores.invoices = makeStore([
    { id: 'inv1', schoolId: SCHOOL_A, studentId: 'stu_1', status: 'unpaid', invoiceNumber: 'INV-1', total: 500, balance: 500, currency: 'KES', dueDate: dateOffset(0) },
  ]);
  mockStores.invoice_reminder_config = makeStore([
    { schoolId: SCHOOL_A, enabled: false },
  ]);
  await runInvoiceOverdueCheck();
  expect(mockNotify).not.toHaveBeenCalled();
});

test('a school with a custom schedule (before=7, interval=10) honours its own config, not the defaults', async () => {
  mockStores.invoices = makeStore([
    { id: 'inv_default_cadence', schoolId: SCHOOL_A, studentId: 'stu_1', status: 'unpaid', invoiceNumber: 'INV-1', total: 500, balance: 500, currency: 'KES', dueDate: dateOffset(3) },  // matches default before=3, not custom before=7
    { id: 'inv_custom_before',   schoolId: SCHOOL_A, studentId: 'stu_2', status: 'unpaid', invoiceNumber: 'INV-2', total: 500, balance: 500, currency: 'KES', dueDate: dateOffset(7) },  // matches custom before=7
  ]);
  mockStores.invoice_reminder_config = makeStore([
    { schoolId: SCHOOL_A, enabled: true, beforeDueDays: 7, onDueDate: true, afterDueIntervalDays: 10 },
  ]);
  await runInvoiceOverdueCheck();

  expect(mockNotify).toHaveBeenCalledTimes(1);
  const call = mockNotify.mock.calls[0][0];
  expect(call.eventKey).toBe('invoice_due_soon');
  expect(call.items.map(i => i.studentId)).toEqual(['stu_2']);
});

test('a school with no overdue/due/due-soon invoices never calls the fan-out helper', async () => {
  mockStores.invoices = makeStore([]);
  await runInvoiceOverdueCheck();
  expect(mockNotify).not.toHaveBeenCalled();
});
