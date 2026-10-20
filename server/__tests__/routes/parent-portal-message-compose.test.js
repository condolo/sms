/* ============================================================
   server/routes/parent-portal.js — GET /message-recipients, POST /messages

   Reported directly: "the parent cannot message the school, in the
   message, I need the parent can select whom they want to message,
   nurse, discipline, subject teachers etc but not fellow parents."

   Covers the two safety properties that matter most: a parent can
   only act on a child actually linked to their own account, and a
   message can only ever be sent via a category the server itself
   re-resolves — never a raw recipient the client supplies.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

/* Portal access is now tier-gated (parent → family, student → student).
   These suites test route behaviour, not billing, so the gate is a pass-through. */
jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));


const SCHOOL = 'school_A';
const CHILD_1 = 'stu_1';
const OTHER_CHILD = 'stu_999'; // not linked to this parent
const PARENT_USER = 'usr_parent';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn(), getSnapshotDetail: jest.fn(), streamSnapshotPdf: jest.fn() },
}));

const mockCreateDirectMessage = jest.fn(async () => ({ id: 'msg_1' }));
jest.mock('../../routes/messages', () => ({
  _inboxQuery: jest.fn(),
  createDirectMessage: (...args) => mockCreateDirectMessage(...args),
}));

let mockResolveMessageCategories;
let mockResolveOneCategory;
jest.mock('../../utils/parent-message-recipients', () => ({
  resolveMessageCategories: (...args) => mockResolveMessageCategories(...args),
  resolveOneCategory: (...args) => mockResolveOneCategory(...args),
}));

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({ findOne: () => mockChain({ name: 'Jane Parent', email: 'jane@example.com' }) }),
}));
jest.mock('../../utils/model', () => ({ _model: () => ({ findOne: () => mockChain(null) }) }));

const express        = require('express');
const supertest       = require('supertest');
const parentPortalRouter = require('../../routes/parent-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: PARENT_USER, schoolId: SCHOOL, role: 'parent', studentIds: [CHILD_1], guardianOf: [] };
  mockResolveMessageCategories = jest.fn(async () => ([
    { key: 'class_teacher', label: 'Class Teacher (Diamond)', recipientUserIds: ['usr_t1'] },
  ]));
  mockResolveOneCategory = jest.fn(async (_req, _childId, key) => (key === 'class_teacher' ? ['usr_t1'] : null));
  mockCreateDirectMessage.mockResolvedValue({ id: 'msg_1' });
});

describe('GET /api/parent-portal/message-recipients', () => {
  test('returns categories for a linked child, without ever leaking recipientUserIds', async () => {
    const res = await supertest(buildApp()).get(`/api/parent-portal/message-recipients?childId=${CHILD_1}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ key: 'class_teacher', label: 'Class Teacher (Diamond)' }]);
    expect(JSON.stringify(res.body)).not.toMatch(/usr_t1/);
  });

  test('refuses a child not linked to this parent', async () => {
    const res = await supertest(buildApp()).get(`/api/parent-portal/message-recipients?childId=${OTHER_CHILD}`);
    expect(res.status).toBe(403);
    expect(mockResolveMessageCategories).not.toHaveBeenCalled();
  });

  test('refuses a non-parent role', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher' };
    const res = await supertest(buildApp()).get(`/api/parent-portal/message-recipients?childId=${CHILD_1}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/parent-portal/messages', () => {
  const VALID = { childId: CHILD_1, category: 'class_teacher', subject: 'Question about homework', body: 'Hello, I had a question.' };

  test('sends to the server-resolved recipient for a valid category', async () => {
    const res = await supertest(buildApp()).post('/api/parent-portal/messages').send(VALID);
    expect(res.status).toBe(201);
    expect(mockCreateDirectMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipientUserIds: ['usr_t1'], subject: VALID.subject, body: VALID.body, senderRole: 'parent' }),
    );
  });

  test('refuses a child not linked to this parent — never reaches category resolution', async () => {
    const res = await supertest(buildApp()).post('/api/parent-portal/messages').send({ ...VALID, childId: OTHER_CHILD });
    expect(res.status).toBe(403);
    expect(mockResolveOneCategory).not.toHaveBeenCalled();
    expect(mockCreateDirectMessage).not.toHaveBeenCalled();
  });

  test('a category that cannot be resolved is refused, not silently sent anywhere', async () => {
    const res = await supertest(buildApp()).post('/api/parent-portal/messages').send({ ...VALID, category: 'made_up_category' });
    expect(res.status).toBe(400);
    expect(mockCreateDirectMessage).not.toHaveBeenCalled();
  });

  test('missing subject/body is refused before touching recipient resolution', async () => {
    const res = await supertest(buildApp()).post('/api/parent-portal/messages').send({ childId: CHILD_1, category: 'class_teacher', subject: '', body: '' });
    expect(res.status).toBe(400);
    expect(mockResolveOneCategory).not.toHaveBeenCalled();
  });

  test('the client cannot supply its own recipient list — only `category` is ever read', async () => {
    const res = await supertest(buildApp()).post('/api/parent-portal/messages')
      .send({ ...VALID, recipients: ['usr_other_parent'], recipientUserIds: ['usr_other_parent'] });
    expect(res.status).toBe(201);
    // Whatever the client sent under those keys, only the server-resolved list was ever used.
    expect(mockCreateDirectMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserIds: ['usr_t1'] }));
  });
});
