/* ============================================================
   server/routes/messages.js — announcements now check their own
   'announcement' notif event, not always 'new_message' (both are
   independently configurable in Settings, but the code previously
   ignored that for the email-enabled check).
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    find:   () => chain(docs),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
  };
}

let mockStores;
let mockCurrentUser;
const mockIsEnabled = jest.fn().mockResolvedValue(true);

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; req.school = { systemEmail: 'x@x.io', name: 'Test' }; next(); },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/notif-settings', () => ({ isEnabled: (...args) => mockIsEnabled(...args) }));
jest.mock('../../utils/email', () => ({ sendMessageNotification: jest.fn() }));
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: jest.fn() }));

const express   = require('express');
const supertest = require('supertest');
const router    = require('../../routes/messages');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/messages', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsEnabled.mockResolvedValue(true);
  mockCurrentUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: [], name: 'Admin' };
  mockStores = { messages: makeStore([]), users: makeStore([]) };
});

test('a direct message checks the new_message event', async () => {
  const app = buildApp();
  await supertest(app).post('/api/messages').send({ subject: 'Hi', body: 'Hello', recipients: 'u_someone', type: 'direct' });
  expect(mockIsEnabled).toHaveBeenCalledWith(SCHOOL, 'new_message', 'email');
});

test('an announcement checks the announcement event, not new_message', async () => {
  const app = buildApp();
  await supertest(app).post('/api/messages').send({ subject: 'Notice', body: 'Everyone read this', recipients: 'all', type: 'announcement' });
  expect(mockIsEnabled).toHaveBeenCalledWith(SCHOOL, 'announcement', 'email');
});
