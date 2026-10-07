/* ============================================================
   server/routes/messages.js — GET /unread-count (notification bell)

   Backs the bell badge: counts exactly the same "in my inbox" set
   GET / already uses (addressed to 'all', my role group, or directly
   to me) — now shared via _inboxQuery() so the two can never drift —
   narrowed to messages this user hasn't read yet (isRead.<userId> not
   true).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: { messages: ['read'] } }) }) };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

let mockMessageDocs;
function _pathGet(doc, path) {
  return path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), doc);
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    const actual = _pathGet(doc, k);
    // Mongo's own array-field semantics: {field: scalar} matches if scalar
    // is AN ELEMENT of the array; {field: {$in: [...]}} matches if any
    // element is in that list — not an array-vs-array equality check.
    if (Array.isArray(actual)) {
      if (v && typeof v === 'object' && '$in' in v) return actual.some(x => v.$in.includes(x));
      return actual.includes(v);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(actual);
      if ('$ne' in v) return actual !== v.$ne;
      return true;
    }
    return actual === v;
  });
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'messages') {
      return { countDocuments: (filter) => Promise.resolve(mockMessageDocs.filter(d => mockMatchesFilter(d, filter)).length) };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  },
}));

const express        = require('express');
const supertest      = require('supertest');
const messagesRouter = require('../../routes/messages');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messagesRouter);
  return app;
}

beforeEach(() => {
  invalidatePermCache(SCHOOL_A);
  mockMessageDocs = [];
});

describe('GET /api/messages/unread-count', () => {
  test('counts an unread direct message, a read one, and one addressed to "all" — not one for a different school or role group', async () => {
    const me = { userId: 'usr_me', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [
      { schoolId: SCHOOL_A, recipients: ['usr_me'], isRead: {} },                           // unread, direct — counts
      { schoolId: SCHOOL_A, recipients: ['usr_me'], isRead: { usr_me: true } },              // already read — doesn't count
      { schoolId: SCHOOL_A, recipients: ['all'], isRead: {} },                               // unread school-wide — counts
      { schoolId: SCHOOL_A, recipients: ['teachers'], isRead: {} },                          // unread, my role group — counts
      { schoolId: SCHOOL_A, recipients: ['parents'], isRead: {} },                           // not my role group — doesn't count
      { schoolId: 'school_B', recipients: ['all'], isRead: {} },                             // different school — doesn't count
      { schoolId: SCHOOL_A, recipients: ['usr_someone_else'], isRead: {} },                   // addressed to someone else — doesn't count
    ];
    const res = await supertest(buildApp(me)).get('/api/messages/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(3);
  });

  test('nothing unread — count is zero, not an error', async () => {
    const me = { userId: 'usr_me', schoolId: SCHOOL_A, role: 'teacher' };
    mockMessageDocs = [{ schoolId: SCHOOL_A, recipients: ['usr_me'], isRead: { usr_me: true } }];
    const res = await supertest(buildApp(me)).get('/api/messages/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
  });
});
