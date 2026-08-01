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

/* ══════════════════════════════════════════════════════════════
   PUT /api/students/:id — medical field persistence
   (Medical Centre milestone 1: StudentUpdateSchema never declared
   `medical`, so Zod silently stripped it and the Student Profile's
   Medical tab saved nothing. This is the regression test for that fix.)
══════════════════════════════════════════════════════════════ */
describe('PUT /api/students/:id — medical field', () => {
  function mockExistingStudent(student) {
    // Route does: findOne({id,schoolId}).lean() (no .select() on this call)
    mockStudentsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });
  }

  test('a medical payload reaches the $set update — was previously stripped by Zod', async () => {
    const student = makeStudent();
    mockExistingStudent(student);
    mockStudentsFindOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...student, medical: 'placeholder' }),
    });

    const medical = {
      bloodGroup: 'O+', allergies: 'Peanuts', conditions: 'Asthma',
      emergencyName: 'Jane Doe', emergencyPhone: '0712345678', emergencyRelation: 'Mother',
      doctorName: 'Dr. Kamau', doctorPhone: '0722000000', vaccinations: 'Up to date',
    };

    const app = buildApp();
    const res = await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      .send({ medical });

    expect(res.status).toBe(200);
    expect(mockStudentsFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, updateOp] = mockStudentsFindOneAndUpdate.mock.calls[0];
    expect(updateOp.$set.medical).toEqual(medical);
  });

  test('rejects an invalid bloodGroup value', async () => {
    mockExistingStudent(makeStudent());

    const app = buildApp();
    const res = await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      .send({ medical: { bloodGroup: 'not-a-blood-group' } });

    expect(res.status).toBe(422);
    expect(mockStudentsFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('a field not declared on MedicalInfoSchema is stripped, not passed through', async () => {
    const student = makeStudent();
    mockExistingStudent(student);
    mockStudentsFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });

    const app = buildApp();
    await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      .send({ medical: { bloodGroup: 'A+', notARealField: 'should be dropped' } });

    const [, updateOp] = mockStudentsFindOneAndUpdate.mock.calls[0];
    expect(updateOp.$set.medical).toEqual({ bloodGroup: 'A+' });
  });
});

/* ══════════════════════════════════════════════════════════════
   Medical Centre milestone 2 — disabilities/notes fields,
   Parent Medical Consent stamping, legacy medicalNotes mirroring
══════════════════════════════════════════════════════════════ */
describe('PUT /api/students/:id — disabilities and notes', () => {
  test('both persist through to the update', async () => {
    const student = makeStudent();
    mockStudentsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });
    mockStudentsFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });

    const app = buildApp();
    await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      .send({ medical: { disabilities: 'Wheelchair access needed', notes: 'Prefers ground-floor classrooms' } });

    const [, updateOp] = mockStudentsFindOneAndUpdate.mock.calls[0];
    expect(updateOp.$set.medical.disabilities).toBe('Wheelchair access needed');
    expect(updateOp.$set.medical.notes).toBe('Prefers ground-floor classrooms');
  });
});

describe('PUT /api/students/:id — Parent Medical Consent stamping', () => {
  test('recording consent for the first time stamps recordedAt/recordedBy from the server, not the client', async () => {
    const student = makeStudent({ medical: {} }); // no prior consent
    mockStudentsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });
    mockStudentsFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });

    const app = buildApp();
    await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      // client sends a spoofed recordedBy — must be ignored, MedicalInfoSchema doesn't declare it
      .send({ medical: { parentConsentGiven: true, parentConsentRecordedBy: 'usr_attacker' } });

    const [, updateOp] = mockStudentsFindOneAndUpdate.mock.calls[0];
    expect(updateOp.$set.medical.parentConsentGiven).toBe(true);
    expect(updateOp.$set.medical.parentConsentRecordedBy).toBe('usr_test_001'); // the authenticated actor, not the spoofed value
    expect(updateOp.$set.medical.parentConsentRecordedAt).toEqual(expect.any(String));
  });

  test('an unrelated edit (e.g. allergies) does not touch an already-recorded consent timestamp', async () => {
    const student = makeStudent({
      medical: { parentConsentGiven: true, parentConsentRecordedAt: '2026-01-01T00:00:00.000Z', parentConsentRecordedBy: 'usr_nurse_001' },
    });
    mockStudentsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });
    mockStudentsFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });

    const app = buildApp();
    await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      .send({ medical: { allergies: 'Updated allergy note' } }); // parentConsentGiven not sent at all

    const [, updateOp] = mockStudentsFindOneAndUpdate.mock.calls[0];
    expect(updateOp.$set.medical.allergies).toBe('Updated allergy note');
    // parentConsentGiven wasn't part of this edit's payload, so the stamping
    // branch never runs — the previously-recorded metadata is simply absent
    // from this $set, leaving whatever's already in the DB untouched.
    expect(updateOp.$set.medical.parentConsentRecordedAt).toBeUndefined();
  });

  test('re-sending the SAME consent value does not re-stamp recordedAt', async () => {
    const student = makeStudent({
      medical: { parentConsentGiven: true, parentConsentRecordedAt: '2026-01-01T00:00:00.000Z', parentConsentRecordedBy: 'usr_nurse_001' },
    });
    mockStudentsFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });
    mockStudentsFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(student) });

    const app = buildApp();
    await supertest(app)
      .put('/api/students/stu_demo_001')
      .set('Authorization', 'Bearer fake-token')
      .send({ medical: { parentConsentGiven: true } }); // same value as already on file

    const [, updateOp] = mockStudentsFindOneAndUpdate.mock.calls[0];
    expect(updateOp.$set.medical.parentConsentRecordedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updateOp.$set.medical.parentConsentRecordedBy).toBe('usr_nurse_001');
  });
});

describe('POST /api/students — legacy medicalNotes mirrors into medical.notes', () => {
  test('a new student with medicalNotes but no medical.notes gets it mirrored', async () => {
    mockStudentsCreate.mockResolvedValue({ toObject: () => makeStudent() });

    const app = buildApp();
    await supertest(app)
      .post('/api/students')
      .set('Authorization', 'Bearer fake-token')
      .send({ firstName: 'Alice', lastName: 'Wanjiku', gender: 'female', status: 'active', medicalNotes: 'Allergic to peanuts' });

    const createArg = mockStudentsCreate.mock.calls[0][0];
    expect(createArg.medical.notes).toBe('Allergic to peanuts');
    expect(createArg.medicalNotes).toBe('Allergic to peanuts'); // legacy field itself is untouched
  });

  test('an explicit medical.notes wins over medicalNotes — no silent overwrite', async () => {
    mockStudentsCreate.mockResolvedValue({ toObject: () => makeStudent() });

    const app = buildApp();
    await supertest(app)
      .post('/api/students')
      .set('Authorization', 'Bearer fake-token')
      .send({
        firstName: 'Alice', lastName: 'Wanjiku', gender: 'female', status: 'active',
        medicalNotes: 'Legacy note', medical: { notes: 'Deliberately different note' },
      });

    const createArg = mockStudentsCreate.mock.calls[0][0];
    expect(createArg.medical.notes).toBe('Deliberately different note');
  });
});
