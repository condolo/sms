/* ============================================================
   Loan issuing FK validation + self-scoped loan visibility —
   server/routes/library.js

   Covers the reliability gap behind "staff should see their own
   borrowed books in the Library module": GET /loans already scoped
   non-manage-role viewers to `borrowerId === their own userId`, but
   nothing validated that a librarian's free-typed borrowerId actually
   matched a real person — so a typo silently made a loan invisible to
   the very person who borrowed it. _checkBorrowerFK closes that.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$gt' in v) return (doc[k] ?? 0) > v.$gt;
      if ('$in' in v) return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}
function makeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    updateOne:        jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return Promise.resolve({ modifiedCount: 0 });
      const inc = update.$inc || {};
      for (const [k, v] of Object.entries(inc)) docs[idx][k] = (docs[idx][k] || 0) + v;
      return Promise.resolve({ modifiedCount: 1 });
    }),
  };
}

let mockJwtUser = { userId: 'usr_librarian', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockBooks, mockLoans, mockStudents, mockTeachers;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'library_books')  return mockBooks;
    if (c === 'library_loans')  return mockLoans;
    if (c === 'students')       return mockStudents;
    if (c === 'teachers')       return mockTeachers;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
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
  mockJwtUser  = { userId: 'usr_librarian', schoolId: SCHOOL_A, role: 'librarian', roles: ['librarian'] };
  mockBooks    = makeFakeCollection([{ id: 'book_1', schoolId: SCHOOL_A, title: 'Physics', available: 2, copies: 2 }]);
  mockLoans    = makeFakeCollection([]);
  mockStudents = makeFakeCollection([{ id: 'stu_1', schoolId: SCHOOL_A, firstName: 'A', lastName: 'One' }]);
  mockTeachers = makeFakeCollection([{ id: 'tch_1', schoolId: SCHOOL_A, userId: 'usr_teacher_1', firstName: 'B', lastName: 'Two' }]);
});

const dueDate = '2099-01-01';

describe('POST /loans — borrower FK validation', () => {
  test('rejects a student borrowerId that does not exist', async () => {
    const res = await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'not_a_real_student', borrowerType: 'student', dueDate,
    });
    expect(res.status).toBe(400);
    expect(mockLoans.create).not.toHaveBeenCalled();
  });

  test('accepts a real student borrowerId', async () => {
    const res = await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'stu_1', borrowerType: 'student', dueDate,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.borrowerId).toBe('stu_1');
  });

  test('rejects a staff borrowerId that matches neither teachers.id nor teachers.userId', async () => {
    const res = await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'nobody', borrowerType: 'staff', dueDate,
    });
    expect(res.status).toBe(400);
    expect(mockLoans.create).not.toHaveBeenCalled();
  });

  test('accepts a staff borrowerId matched via teachers.userId (the client picker\'s preferred value)', async () => {
    const res = await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'usr_teacher_1', borrowerType: 'staff', dueDate,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.borrowerId).toBe('usr_teacher_1');
  });

  test('accepts a staff borrowerId matched via teachers.id (fallback for a teacher with no linked login)', async () => {
    const res = await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'tch_1', borrowerType: 'staff', dueDate,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.borrowerId).toBe('tch_1');
  });
});

describe('GET /loans — self-scoping for non-manage roles depends on a correct borrowerId', () => {
  test('a staff borrower issued via their real userId sees their own loan when they view Loans', async () => {
    await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'usr_teacher_1', borrowerType: 'staff', dueDate,
    });

    mockJwtUser = { userId: 'usr_teacher_1', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/library/loans');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].borrowerId).toBe('usr_teacher_1');
  });

  test('a different staff member never sees someone else\'s loan', async () => {
    await supertest(buildApp()).post('/api/library/loans').send({
      bookId: 'book_1', borrowerId: 'usr_teacher_1', borrowerType: 'staff', dueDate,
    });

    mockJwtUser = { userId: 'usr_other_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/library/loans');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});
