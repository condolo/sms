/* ============================================================
   server/utils/billing-cron.js — for each school whose term starts
   today, creates a billing snapshot and emails the school's admins.

   Regression coverage: _sendInvoiceEmail() must call a function that
   actually exists on utils/email.js. A prior version called
   emailUtil.sendEmail(), which was never exported — that only surfaces
   at runtime (TypeError, swallowed by the outer try/catch) and is
   invisible to any check that merely requires the module.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    const test = (val) => (v && typeof v === 'object' && '$in' in v) ? v.$in.includes(val) : val === v;
    if (!k.includes('.')) return test(doc[k]);
    // Dotted path into an array field (e.g. 'termDates.startDate') — Mongo
    // matches if ANY array element's sub-field equals the value.
    const [arrKey, subKey] = k.split('.');
    return Array.isArray(doc[arrKey]) && doc[arrKey].some(item => test(item[subKey]));
  });
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    find: (filter) => chain(docs.filter(d => matches(d, filter))),
    _docs: () => docs,
  };
}

let mockStores;
const mockSendInvoiceEmail = jest.fn().mockResolvedValue(true);
const mockCreateBillingSnapshot = jest.fn();

jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../utils/email', () => ({ sendInvoiceEmail: (...args) => mockSendInvoiceEmail(...args) }));
jest.mock('../routes/billing', () => ({ createBillingSnapshot: (...args) => mockCreateBillingSnapshot(...args) }));

const { runBillingCheck } = require('../utils/billing-cron');

const SCHOOL_ID = 'school_1';
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

const SNAPSHOT = {
  invoiceRef: 'INV-2026-1-T1-ABC123',
  academicYear: '2026/1',
  term: 1,
  activeCount: 42,
  ratePerStudent: 300,
  totalAmount: 12600,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateBillingSnapshot.mockResolvedValue({ existing: false, snapshot: SNAPSHOT });
  mockStores = {
    schools: makeStore([
      { id: SCHOOL_ID, name: 'Test School', plan: 'standard', academicYear: '2026/1', systemEmail: 'office@test.io',
        termDates: [{ term: 1, startDate: TODAY }] },
    ]),
    users: makeStore([
      { id: 'u1', schoolId: SCHOOL_ID, role: 'admin', name: 'Ada Admin', email: 'ada@test.io' },
      { id: 'u2', schoolId: SCHOOL_ID, role: 'principal', name: 'Pat Principal', email: 'pat@test.io' },
      { id: 'u3', schoolId: SCHOOL_ID, role: 'teacher', name: 'Terry Teacher', email: 'terry@test.io' },
    ]),
  };
});

test('does nothing when no school has a term starting today', async () => {
  mockStores.schools = makeStore([]);
  await runBillingCheck();
  expect(mockCreateBillingSnapshot).not.toHaveBeenCalled();
  expect(mockSendInvoiceEmail).not.toHaveBeenCalled();
});

test('creates a snapshot and emails every admin/principal, skipping other roles', async () => {
  await runBillingCheck();

  expect(mockCreateBillingSnapshot).toHaveBeenCalledWith(SCHOOL_ID, expect.objectContaining({
    academicYear: '2026/1', term: 1, tier: 'student', triggerType: 'auto',
  }));

  expect(mockSendInvoiceEmail).toHaveBeenCalledTimes(2); // admin + principal, not the teacher
  const recipients = mockSendInvoiceEmail.mock.calls.map(c => c[0].email);
  expect(recipients).toEqual(expect.arrayContaining(['ada@test.io', 'pat@test.io']));
  expect(recipients).not.toContain('terry@test.io');
});

test('calls sendInvoiceEmail with the snapshot and school fields mapped correctly', async () => {
  await runBillingCheck();

  const call = mockSendInvoiceEmail.mock.calls.find(c => c[0].email === 'ada@test.io')[0];
  expect(call).toEqual({
    name: 'Ada Admin',
    email: 'ada@test.io',
    schoolName: 'Test School',
    schoolEmail: 'office@test.io',
    schoolId: SCHOOL_ID,
    invoiceRef: SNAPSHOT.invoiceRef,
    academicYear: SNAPSHOT.academicYear,
    term: SNAPSHOT.term,
    activeCount: SNAPSHOT.activeCount,
    ratePerStudent: SNAPSHOT.ratePerStudent,
    totalAmount: SNAPSHOT.totalAmount,
  });
});

test('does not send email or throw when a snapshot already exists', async () => {
  mockCreateBillingSnapshot.mockResolvedValue({ existing: true, snapshot: SNAPSHOT });
  await expect(runBillingCheck()).resolves.toBeUndefined();
  expect(mockSendInvoiceEmail).not.toHaveBeenCalled();
});

test('a failed email send for one school does not throw or block others', async () => {
  mockStores.schools = makeStore([
    { id: SCHOOL_ID, name: 'Test School', plan: 'standard', academicYear: '2026/1', systemEmail: 'office@test.io',
      termDates: [{ term: 1, startDate: TODAY }] },
    { id: 'school_2', name: 'Second School', plan: 'core', academicYear: '2026/1', systemEmail: 'office2@test.io',
      termDates: [{ term: 1, startDate: TODAY }] },
  ]);
  mockStores.users = makeStore([
    { id: 'u1', schoolId: SCHOOL_ID, role: 'admin', name: 'Ada Admin', email: 'ada@test.io' },
    { id: 'u4', schoolId: 'school_2', role: 'admin', name: 'Sam Second', email: 'sam@test.io' },
  ]);
  mockSendInvoiceEmail.mockRejectedValueOnce(new Error('smtp down'));

  await expect(runBillingCheck()).resolves.toBeUndefined();
  expect(mockSendInvoiceEmail).toHaveBeenCalledTimes(2);
});
