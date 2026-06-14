/* ============================================================
   Integration tests — server/routes/students.js

   Focuses on the id vs _id regression:
     Bug: StudentList used s._id ?? s.id, which always resolved
     to the MongoDB ObjectId, so server queries by custom `id`
     field returned 404.
     Fix: reversed to s.id ?? s._id in the client.
     This test: verifies the SERVER queries by `id` field.

   All DB calls are mocked — no MongoDB required.

   Run: npm test
   ============================================================ */

/* ── Mock shared middleware so routes load without real DB ──── */
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    // Inject a fake JWT user — all tests share schoolId 'school_test_001'
    req.jwtUser = { userId: 'usr_test_001', schoolId: 'school_test_001', role: 'admin', roles: ['admin'] };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/plan', () => ({
  planGate: () => (_req, _res, next) => next(),
}));

jest.mock('../../utils/counters', () => ({
  nextAdmissionNumber:     jest.fn().mockResolvedValue('ADM-001'),
  reserveAdmissionNumbers: jest.fn().mockResolvedValue(['ADM-001', 'ADM-002', 'ADM-003']),
}));

/* ── Mock _model — returns per-collection mock objects ─────── */
const mockStudentsFind = jest.fn();
const mockStudentsFindOne = jest.fn();
const mockStudentsCreate = jest.fn();
const mockStudentsUpdateOne = jest.fn();
const mockStudentsFindOneAndUpdate = jest.fn();
const mockStudentsCountDocuments = jest.fn();
const mockStudentsAggregate = jest.fn();

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'students') {
      return {
        find:              mockStudentsFind,
        findOne:           mockStudentsFindOne,
        create:            mockStudentsCreate,
        updateOne:         mockStudentsUpdateOne,
        findOneAndUpdate:  mockStudentsFindOneAndUpdate,
        countDocuments:    mockStudentsCountDocuments,
        aggregate:         mockStudentsAggregate,
      };
    }
    // Default empty mock for any other collection
    return {
      find:           jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      findOne:        jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate:      jest.fn().mockResolvedValue([]),
    };
  }),
}));

const express    = require('express');
const supertest  = require('supertest');
const studentsRouter = require('../../routes/students');

/* ── Build minimal Express app around the router ────────────── */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}

/* ── Fake student document matching server schema ───────────── */
function makeStudent(overrides = {}) {
  return {
    _id:             '507f1f77bcf86cd799439011',  // MongoDB ObjectId (always present)
    id:              'stu_demo_001',              // Custom platform id (used for all queries)
    schoolId:        'school_test_001',
    firstName:       'Jane',
    lastName:        'Doe',
    admissionNumber: 'ADM-001',
    status:          'active',
    gender:          'female',
    classId:         'cls_001',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

/* ══════════════════════════════════════════════════════════════
   GET /api/students/:id — id-field regression
══════════════════════════════════════════════════════════════ */
describe('GET /api/students/:id', () => {
  test('queries by custom id field (not _id) — core regression', async () => {
    const student = makeStudent();

    // Mock: findOne returns the student when queried by id field
    mockStudentsFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(student),
      }),
    });

    const app = buildApp();
    const res = await supertest(app)
      .get('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(200);

    // The critical assertion: findOne must have been called with
    // { id: 'stu_demo_001', ... } — NOT { _id: 'stu_demo_001', ... }
    expect(mockStudentsFindOne).toHaveBeenCalledTimes(1);
    const queryArg = mockStudentsFindOne.mock.calls[0][0];
    expect(queryArg).toHaveProperty('id', 'stu_demo_001');
    expect(queryArg).not.toHaveProperty('_id');
  });

  test('returns 404 when student not found (id field query yields null)', async () => {
    mockStudentsFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const app = buildApp();
    const res = await supertest(app)
      .get('/api/students/nonexistent_id')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('scopes query to schoolId from JWT — no cross-tenant leakage', async () => {
    const student = makeStudent();
    mockStudentsFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(student),
      }),
    });

    const app = buildApp();
    await supertest(app)
      .get('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token');

    const queryArg = mockStudentsFindOne.mock.calls[0][0];
    // Must include schoolId so a student from another school can't be fetched
    expect(queryArg).toHaveProperty('schoolId', 'school_test_001');
  });

  test('returns student data in response body', async () => {
    const student = makeStudent();
    mockStudentsFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(student),
      }),
    });

    const app = buildApp();
    const res = await supertest(app)
      .get('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id:        'stu_demo_001',
      firstName: 'Jane',
      lastName:  'Doe',
    });
  });
});

/* ══════════════════════════════════════════════════════════════
   GET /api/students — list endpoint
══════════════════════════════════════════════════════════════ */
describe('GET /api/students', () => {
  test('returns paginated student list', async () => {
    const students = [makeStudent(), makeStudent({ id: 'stu_demo_002', firstName: 'John' })];

    mockStudentsFind.mockReturnValue({
      sort:   jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue(students),
    });
    mockStudentsCountDocuments.mockResolvedValue(2);

    const app = buildApp();
    const res = await supertest(app)
      .get('/api/students')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  test('scopes list query to schoolId from JWT', async () => {
    mockStudentsFind.mockReturnValue({
      sort:   jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue([]),
    });
    mockStudentsCountDocuments.mockResolvedValue(0);

    const app = buildApp();
    await supertest(app)
      .get('/api/students')
      .set('Authorization', 'Bearer fake-token');

    const filterArg = mockStudentsFind.mock.calls[0][0];
    expect(filterArg).toHaveProperty('schoolId', 'school_test_001');
  });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/students — create student
══════════════════════════════════════════════════════════════ */
describe('POST /api/students', () => {
  const validPayload = {
    firstName: 'Alice',
    lastName:  'Wanjiku',
    gender:    'female',
    status:    'active',
  };

  test('creates student and returns 201', async () => {
    const createdDoc = makeStudent({ firstName: 'Alice', lastName: 'Wanjiku' });
    mockStudentsCreate.mockResolvedValue({
      toObject: () => createdDoc,
    });

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/students')
      .set('Authorization', 'Bearer fake-token')
      .send(validPayload);

    expect(res.status).toBe(201);
  });

  test('new student record includes a uuid id field (not relying on _id)', async () => {
    const createdDoc = makeStudent({ firstName: 'Alice', lastName: 'Wanjiku' });
    mockStudentsCreate.mockResolvedValue({
      toObject: () => createdDoc,
    });

    const app = buildApp();
    await supertest(app)
      .post('/api/students')
      .set('Authorization', 'Bearer fake-token')
      .send(validPayload);

    // Create was called with an id field (uuid) — not relying on _id for future queries
    const createArg = mockStudentsCreate.mock.calls[0][0];
    expect(createArg).toHaveProperty('id');
    expect(typeof createArg.id).toBe('string');
    expect(createArg.id.length).toBeGreaterThan(0);
  });

  test('returns 422 for missing required firstName (Zod validation)', async () => {
    // The platform uses E.validation() which returns HTTP 422 Unprocessable Entity
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/students')
      .set('Authorization', 'Bearer fake-token')
      .send({ lastName: 'Wanjiku' });   // no firstName

    expect(res.status).toBe(422);
  });
});
