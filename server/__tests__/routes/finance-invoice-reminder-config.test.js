/* ============================================================
   Invoice reminder config — server/routes/finance.js

   GET/PUT /api/finance/invoice-reminder-config: the per-school
   schedule invoice-overdue-cron.js reads (days before due, on-due-date
   toggle, post-due interval). Covers defaults-when-unset, partial
   updates merging over saved values, and validation bounds.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_A', schoolId: 'school_A', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/counters', () => ({
  nextInvoiceNumber: jest.fn().mockResolvedValue('INV-1'),
  nextReceiptNumber: jest.fn().mockResolvedValue('RCPT-1'),
}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}

let mockReminderConfig;
function makeConfigStore(seed = null) {
  let doc = seed;
  return {
    findOne: jest.fn(() => mockChainObj(doc)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const flat = update.$set ? { ...update.$set } : { ...update };
      doc = { ...(doc || {}), ...flat };
      return mockChainObj(doc);
    }),
    _get: () => doc,
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'invoice_reminder_config') return mockReminderConfig;
    if (c === 'audit_logs') return { create: jest.fn().mockResolvedValue({}) };
    return { find: jest.fn(() => mockChainObj([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const financeRouter = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReminderConfig = makeConfigStore(null);
});

test('GET with no saved config returns the documented defaults', async () => {
  const res = await supertest(buildApp()).get('/api/finance/invoice-reminder-config');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({
    enabled: true, beforeDueDays: 3, onDueDate: true, afterDueIntervalDays: 4,
  });
});

test('PUT persists a partial update and merges it over the defaults on the next GET', async () => {
  const putRes = await supertest(buildApp()).put('/api/finance/invoice-reminder-config').send({
    beforeDueDays: 7, afterDueIntervalDays: 10,
  });
  expect(putRes.status).toBe(200);
  expect(putRes.body.data).toEqual({
    enabled: true, beforeDueDays: 7, onDueDate: true, afterDueIntervalDays: 10,
  });

  const getRes = await supertest(buildApp()).get('/api/finance/invoice-reminder-config');
  expect(getRes.body.data.beforeDueDays).toBe(7);
  expect(getRes.body.data.afterDueIntervalDays).toBe(10);
});

test('PUT can disable the whole schedule via enabled:false', async () => {
  const res = await supertest(buildApp()).put('/api/finance/invoice-reminder-config').send({ enabled: false });
  expect(res.status).toBe(200);
  expect(res.body.data.enabled).toBe(false);
});

test('PUT rejects an out-of-range beforeDueDays', async () => {
  const res = await supertest(buildApp()).put('/api/finance/invoice-reminder-config').send({ beforeDueDays: 999 });
  expect(res.status).toBe(422);
  expect(mockReminderConfig.findOneAndUpdate).not.toHaveBeenCalled();
});

test('write is scoped to the caller\'s school', async () => {
  await supertest(buildApp()).put('/api/finance/invoice-reminder-config').send({ beforeDueDays: 5 });
  const [filter] = mockReminderConfig.findOneAndUpdate.mock.calls[0];
  expect(filter.schoolId).toBe(SCHOOL_A);
});
