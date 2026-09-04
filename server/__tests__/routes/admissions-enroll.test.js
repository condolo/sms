/* ============================================================
   POST /api/admissions/:id/enroll — application-to-enrollment flow
   (2026-09 field update, Phase 3)

   Before this route, there was NO conversion mechanism at all —
   confirmed by investigation before this phase was built. Staff
   manually retyped every field into a fresh Student record; nothing
   connected the two. Covers:
     1. Only enrollable from 'acceptance' or already-'enrolled' stage —
        every earlier stage (offer not yet accepted) and both terminal
        stages (withdrawn/rejected) are rejected.
     2. A real Student document is created, with a permanent admission
        number assigned AT THIS MOMENT (never on the application
        itself, never earlier) — matching the explicit rule that
        admission numbers are assigned only at enrollment.
     3. Mother/Father, derived parentName/Email/Phone, Allergies (under
        medical.*), Emergency Contact (under medical.*), and House all
        carry across from the application to the new student record
        verbatim — the "clean flow, application to enrollment" the
        field update was explicitly asked to deliver.
     4. The application itself is updated: stage -> 'enrolled',
        studentId set, a stageHistory entry appended — but NOT when the
        application was already 'enrolled' (no duplicate history entry
        on a second call).
     5. Idempotent: enrolling an already-enrolled application (one with
        studentId already set, and that student still exists) returns
        the SAME student — never creates a second one.
     6. Gated on BOTH admissions:update AND students:create — an actor
        with only one of the two is rejected.
     7. admissions.enrolled is audit-logged, correlated to the
        application via applicationId/applicationRef.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const SCHOOL = 'sch_test';

let mockRolePermsDocs;
function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockChain(result) { return { select: () => mockChain(result), lean: () => Promise.resolve(result) }; }

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'role_permissions') return { findOne: (filter) => mockChain(mockRolePermsDocs.find((d) => mockMatchFilter(d, filter)) ?? null) };
    if (collection === 'schools') return { findOne: () => mockChain({ admissionConfig: {} }) };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

let mockAppDocs;
let mockStudentDocs;
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'admissions') {
      return {
        findOne: (filter) => mockChain(mockAppDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
        findOneAndUpdate: (filter, update) => {
          const d = mockAppDocs.find((x) => mockMatchFilter(x, filter));
          if (!d) return mockChain(null);
          const { $push, ...rest } = update;
          Object.assign(d, rest);
          if ($push?.stageHistory) d.stageHistory = [...(d.stageHistory || []), $push.stageHistory];
          return mockChain({ ...d });
        },
      };
    }
    if (collection === 'students') {
      return {
        findOne: (filter) => mockChain(mockStudentDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
        create:  (doc) => { const d = { ...doc }; mockStudentDocs.push(d); return Promise.resolve(d); },
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

let mockNextAdmNo;
jest.mock('../../utils/counters', () => ({
  reserveAdmissionNumbers: jest.fn(() => Promise.resolve([mockNextAdmNo])),
}));
jest.mock('../../utils/academic-period', () => ({
  resolveAcademicPeriod: jest.fn(() => Promise.resolve({ academicYearId: 'ay_2026', termId: 'term_1' })),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const express   = require('express');
const supertest = require('supertest');
const admissionsRouter = require('../../routes/admissions');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admissions', admissionsRouter);
  return app;
}

const ADMIN_ROLE_DOC = { schoolId: SCHOOL, roleKey: 'admin', permissions: { admissions: ['read', 'create', 'update', 'delete'], students: ['read', 'create', 'update', 'delete'] } };

beforeEach(() => {
  jest.clearAllMocks();
  invalidatePermCache(SCHOOL);
  mockJwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockRolePermsDocs = [ADMIN_ROLE_DOC];
  mockAppDocs = [];
  mockStudentDocs = [];
  mockNextAdmNo = 'ADM-2026-0001';
});

function app(overrides = {}) {
  return {
    id: 'app_1', schoolId: SCHOOL, applicationRef: 'APP-2026-ABC123',
    firstName: 'Amara', lastName: 'Osei', dateOfBirth: '2015-03-14', gender: 'female',
    stage: 'acceptance', stageHistory: [],
    applyingForClass: 'cls_1', applyingForClassName: 'Grade 3',
    houseId: 'house_baobab',
    motherName: 'Adjoa Osei', motherPhone: '+254700000001', motherEmail: 'adjoa@example.com',
    parentName: 'Adjoa Osei', parentEmail: 'adjoa@example.com', parentPhone: '+254700000001', parentRelationship: 'Mother',
    allergies: 'Peanuts',
    emergencyContactName: 'Aunt Abena', emergencyContactPhone: '0722000000', emergencyContactRelation: 'Aunt',
    ...overrides,
  };
}

describe('POST /api/admissions/:id/enroll — stage guard', () => {
  test.each(['enquiry', 'application', 'assessment', 'interview', 'offer'])('rejects enrollment from stage "%s" — offer not yet accepted', async (stage) => {
    mockAppDocs = [app({ stage })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(400);
    expect(mockStudentDocs).toHaveLength(0);
  });

  test.each(['withdrawn', 'rejected'])('rejects enrollment from terminal stage "%s"', async (stage) => {
    mockAppDocs = [app({ stage })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(400);
    expect(mockStudentDocs).toHaveLength(0);
  });

  test('allows enrollment from "acceptance"', async () => {
    mockAppDocs = [app({ stage: 'acceptance' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
  });
});

describe('POST /api/admissions/:id/enroll — permission gate', () => {
  test('rejected with admissions:update only, no students:create', async () => {
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'admin', permissions: { admissions: ['read', 'update'], students: ['read'] } }];
    mockAppDocs = [app()];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(403);
    expect(mockStudentDocs).toHaveLength(0);
  });

  test('rejected with students:create only, no admissions:update', async () => {
    mockRolePermsDocs = [{ schoolId: SCHOOL, roleKey: 'admin', permissions: { admissions: ['read'], students: ['read', 'create'] } }];
    mockAppDocs = [app()];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(403);
    expect(mockStudentDocs).toHaveLength(0);
  });
});

describe('POST /api/admissions/:id/enroll — field carry-through', () => {
  test('Mother/Father, derived parentName, House, Allergies, and Emergency Contact all carry across verbatim', async () => {
    mockAppDocs = [app()];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    const student = res.body.data.student;
    expect(student.admissionNumber).toBe('ADM-2026-0001');
    expect(student.firstName).toBe('Amara');
    expect(student.houseId).toBe('house_baobab');
    expect(student.classId).toBe('cls_1');
    expect(student.motherName).toBe('Adjoa Osei');
    expect(student.parentName).toBe('Adjoa Osei');
    expect(student.parentRelationship).toBe('Mother');
    expect(student.medical).toEqual({
      allergies: 'Peanuts',
      emergencyName: 'Aunt Abena', emergencyPhone: '0722000000', emergencyRelation: 'Aunt',
    });
    expect(student.status).toBe('active');
  });

  test('the application is updated: stage -> enrolled, studentId set, one stageHistory entry appended', async () => {
    mockAppDocs = [app({ stage: 'acceptance' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    const updatedApp = res.body.data.application;
    expect(updatedApp.stage).toBe('enrolled');
    expect(updatedApp.studentId).toBe(mockStudentDocs[0].id);
    expect(updatedApp.stageHistory).toHaveLength(1);
  });

  test('admissions.enrolled is audit-logged, correlated by applicationId/applicationRef', async () => {
    mockAppDocs = [app()];
    await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admissions.enrolled', schoolId: SCHOOL,
      details: expect.objectContaining({ applicationId: 'app_1', applicationRef: 'APP-2026-ABC123', admissionNumber: 'ADM-2026-0001' }),
    }));
  });
});

describe('POST /api/admissions/:id/enroll — idempotency', () => {
  test('an application already enrolled (studentId set, student still exists) returns the SAME student, creates no duplicate', async () => {
    mockStudentDocs = [{ id: 'stu_existing', schoolId: SCHOOL, firstName: 'Amara', admissionNumber: 'ADM-2026-0000' }];
    mockAppDocs = [app({ stage: 'enrolled', studentId: 'stu_existing' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.student.id).toBe('stu_existing');
    expect(res.body.data.alreadyEnrolled).toBe(true);
    expect(mockStudentDocs).toHaveLength(1); // no second student created
  });

  test('re-enrolling when already at stage "enrolled" (fresh enroll, no prior studentId) does not append a second stageHistory entry beyond the one this call adds', async () => {
    mockAppDocs = [app({ stage: 'enrolled', stageHistory: [{ stage: 'enrolled', date: '2026-01-01', changedBy: 'u_other' }] })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    // stage was already 'enrolled' -> no new stageHistory push, count unchanged
    expect(res.body.data.application.stageHistory).toHaveLength(1);
  });
});
