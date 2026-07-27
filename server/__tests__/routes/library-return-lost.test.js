/* ============================================================
   Return + Lost loan flows — server/routes/library.js

   Covers a bug found while building the lost-book flow: PATCH
   /loans/:id/return required status === 'active' exactly, so a loan
   flipped to 'overdue' by /sync-overdue could never be returned again
   (rejected with a wrong "already returned" message). Also covers the
   new PATCH /loans/:id/lost — permanent, unlike return: `available`
   is never restored and `copies` is decremented too.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && '$gt' in v) return (doc[k] ?? 0) > v.$gt;
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs:   () => docs,
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve({ modifiedCount: 0 });
      const inc = update.$inc || {};
      for (const [k, v] of Object.entries(inc)) docs[idx][k] = (docs[idx][k] || 0) + v;
      return Promise.resolve({ modifiedCount: 1 });
    }),
  };
}

const mockJwtUser = { userId: 'usr_librarian', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockBooks, mockLoans;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'library_books') return mockBooks;
    if (c === 'library_loans') return mockLoans;
    return { findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const libraryRouter = require('../../routes/library');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/library', libraryRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBooks = makeFakeCollection([{ id: 'book_1', schoolId: SCHOOL_A, title: 'Physics', available: 0, copies: 2 }]);
  mockLoans = makeFakeCollection([]);
});

describe('PATCH /loans/:id/return', () => {
  test('an overdue loan can still be returned (regression — previously rejected)', async () => {
    mockLoans = makeFakeCollection([{ id: 'loan_1', schoolId: SCHOOL_A, bookId: 'book_1', status: 'overdue', dueDate: '2020-01-01' }]);
    const res = await supertest(buildApp()).patch('/api/library/loans/loan_1/return').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('returned');
    expect(mockBooks._docs()[0].available).toBe(1);
  });

  test('a lost loan cannot be "returned" — distinct, accurate error', async () => {
    mockLoans = makeFakeCollection([{ id: 'loan_1', schoolId: SCHOOL_A, bookId: 'book_1', status: 'lost', dueDate: '2020-01-01' }]);
    const res = await supertest(buildApp()).patch('/api/library/loans/loan_1/return').send({});
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? res.body.message).toMatch(/lost/i);
  });
});

describe('PATCH /loans/:id/lost', () => {
  test('marks an active loan lost, does not restore available, decrements copies', async () => {
    mockLoans = makeFakeCollection([{ id: 'loan_1', schoolId: SCHOOL_A, bookId: 'book_1', status: 'active', dueDate: '2099-01-01' }]);
    const res = await supertest(buildApp()).patch('/api/library/loans/loan_1/lost');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('lost');
    expect(res.body.data.lostAt).toBeDefined();

    const book = mockBooks._docs()[0];
    expect(book.available).toBe(0);  // unchanged — never restored
    expect(book.copies).toBe(1);     // decremented from 2
  });

  test('works from overdue too', async () => {
    mockLoans = makeFakeCollection([{ id: 'loan_1', schoolId: SCHOOL_A, bookId: 'book_1', status: 'overdue', dueDate: '2020-01-01' }]);
    const res = await supertest(buildApp()).patch('/api/library/loans/loan_1/lost');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('lost');
  });

  test('a loan already returned cannot be marked lost', async () => {
    mockLoans = makeFakeCollection([{ id: 'loan_1', schoolId: SCHOOL_A, bookId: 'book_1', status: 'returned', dueDate: '2020-01-01' }]);
    const res = await supertest(buildApp()).patch('/api/library/loans/loan_1/lost');
    expect(res.status).toBe(400);
  });
});
