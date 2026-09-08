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

let mockSchoolDoc; // mutable per-test — lets tests set admissionConfig.requiredFields
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'role_permissions') return { findOne: (filter) => mockChain(mockRolePermsDocs.find((d) => mockMatchFilter(d, filter)) ?? null) };
    if (collection === 'schools') return { findOne: () => mockChain(mockSchoolDoc) };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

let mockAppDocs;
let mockStudentDocs;
// Admission-triggered billing (2026-09) — fee_structures/invoices/
// discount_policies support generateEnrollmentInvoices() end-to-end
// through the real HTTP route. Empty by default (no auto-billing
// structure configured), matching every pre-existing test in this file
// that never touches billing at all.
let mockFeeStructureDocs;
let mockInvoiceDocs;
// Billing-sequence fix (2026-09) — 'users' (guardian accounts) and a
// seedable 'discount_policies' support full business-flow scenarios
// (first/second/third child, director/referral, competing discounts)
// through the real HTTP route. Empty/no-policy by default, matching
// every pre-existing test in this file that never touches this at all.
let mockUserDocs;
let mockDiscountPolicyDocs;
function mockChainArr(arr) { return { select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockMatchArrayAware(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$in' in v) return Array.isArray(doc[k]) ? v.$in.some(x => doc[k].includes(x)) : v.$in.includes(doc[k]);
    }
    if (Array.isArray(doc[k])) return doc[k].includes(v); // real Mongo semantics: array field == value means "contains"
    return doc[k] === v;
  });
}
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
        find:    (filter) => mockChainArr(mockStudentDocs.filter((d) => mockMatchArrayAware(d, filter))),
        create:  (doc) => { const d = { ...doc }; mockStudentDocs.push(d); return Promise.resolve(d); },
      };
    }
    if (collection === 'fee_structures') {
      return { find: (filter) => mockChainArr(mockFeeStructureDocs.filter((d) => mockMatchFilter(d, filter))) };
    }
    if (collection === 'invoices') {
      return {
        findOne: (filter) => mockChain(mockInvoiceDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
        create:  (doc) => { const d = { ...doc }; mockInvoiceDocs.push(d); return Promise.resolve(d); },
      };
    }
    if (collection === 'users') {
      return {
        find: (filter) => mockChainArr(mockUserDocs.filter((d) => mockMatchArrayAware(d, filter))),
        findOneAndUpdate: (filter, update) => {
          const d = mockUserDocs.find((x) => mockMatchArrayAware(x, filter));
          if (!d) return mockChain(null);
          if (update.$addToSet) {
            for (const [field, val] of Object.entries(update.$addToSet)) {
              d[field] = Array.isArray(d[field]) ? d[field] : [];
              if (!d[field].includes(val)) d[field].push(val);
            }
          }
          if (update.$set) Object.assign(d, update.$set);
          return mockChain({ ...d });
        },
      };
    }
    if (collection === 'discount_policies') {
      return { findOne: (filter) => mockChain(mockDiscountPolicyDocs.find((d) => mockMatchFilter(d, filter)) ?? null) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

let mockNextAdmNo;
jest.mock('../../utils/counters', () => ({
  reserveAdmissionNumbers: jest.fn(() => Promise.resolve([mockNextAdmNo])),
  nextInvoiceNumber: jest.fn(() => Promise.resolve('INV-1')),
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
  mockFeeStructureDocs = [];
  mockInvoiceDocs = [];
  mockUserDocs = [];
  mockDiscountPolicyDocs = [];
  mockNextAdmNo = 'ADM-2026-0001';
  mockSchoolDoc = { admissionConfig: {} };
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

describe('POST /api/admissions/:id/enroll — legacy-data guard (missing required fields)', () => {
  /* Gender/DOB became required on NEW applications in the 2026-09 field
     update, but this platform's collections are schema-less — an
     application created before that change can still be sitting at
     'acceptance' with either field missing. Enrolling it must not
     silently create an incomplete Student record. */
  test('rejects enrolling an application with no dateOfBirth on file', async () => {
    mockAppDocs = [app({ dateOfBirth: '' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/dateOfBirth/);
    expect(mockStudentDocs).toHaveLength(0);
  });

  test('rejects enrolling an application with no gender on file', async () => {
    mockAppDocs = [app({ gender: '' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/gender/);
    expect(mockStudentDocs).toHaveLength(0);
  });

  test('does not burn an admission number on a rejected legacy-data enroll attempt', async () => {
    const { reserveAdmissionNumbers } = require('../../utils/counters');
    mockAppDocs = [app({ dateOfBirth: '', gender: '' })];
    await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(reserveAdmissionNumbers).not.toHaveBeenCalled();
  });

  test('the application itself is left untouched (no stage/studentId change) when enroll is rejected', async () => {
    mockAppDocs = [app({ dateOfBirth: '' })];
    await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(mockAppDocs[0].stage).toBe('acceptance');
    expect(mockAppDocs[0].studentId).toBeUndefined();
  });
});

describe('POST /api/admissions/:id/enroll — respects a school that has turned a required field OFF (2026-09)', () => {
  test('a school with dateOfBirth turned off can enroll an application missing it', async () => {
    mockSchoolDoc = { admissionConfig: { requiredFields: { dateOfBirth: false } } };
    mockAppDocs = [app({ dateOfBirth: '' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockStudentDocs).toHaveLength(1);
  });

  test('turning off dateOfBirth does not also relax gender for that same school', async () => {
    mockSchoolDoc = { admissionConfig: { requiredFields: { dateOfBirth: false } } };
    mockAppDocs = [app({ dateOfBirth: '', gender: '' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/gender/);
    expect(res.body.error.message).not.toMatch(/dateOfBirth/);
  });

  test('a school that has NOT touched this setting still gets the strict, pre-existing behaviour', async () => {
    mockSchoolDoc = { admissionConfig: {} }; // unchanged from beforeEach — no requiredFields key
    mockAppDocs = [app({ dateOfBirth: '' })];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(400);
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

describe('POST /api/admissions/:id/enroll — admission-triggered billing (2026-09)', () => {
  test('a fee structure marked autoGenerateOnEnroll creates a draft invoice for the newly enrolled student', async () => {
    mockFeeStructureDocs = [{
      id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
      lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }],
    }];
    mockAppDocs = [app()];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockInvoiceDocs).toHaveLength(1);
    expect(mockInvoiceDocs[0].studentId).toBe(res.body.data.student.id);
    expect(mockInvoiceDocs[0].status).toBe('draft');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.enrollment_invoice_drafted' }));
    // Surfaced in the response — not left for the caller to discover only
    // by separately checking Finance.
    expect(res.body.data.invoicesDrafted).toHaveLength(1);
    expect(res.body.data.invoicesDrafted[0].total).toBe(15000);
  });

  test('no matching fee structure -> enrollment still succeeds, no invoice created (default behaviour, unaffected)', async () => {
    mockAppDocs = [app()];
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockInvoiceDocs).toHaveLength(0);
    expect(res.body.data.invoicesDrafted).toEqual([]);
  });

  test('re-enrolling an already-enrolled application retries billing but never duplicates the invoice', async () => {
    mockFeeStructureDocs = [{
      id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
      lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }],
    }];
    mockStudentDocs = [{ id: 'stu_existing', schoolId: SCHOOL, firstName: 'Amara', lastName: 'Osei', admissionNumber: 'ADM-2026-0000' }];
    mockAppDocs = [app({ stage: 'enrolled', studentId: 'stu_existing' })];

    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.alreadyEnrolled).toBe(true);
    expect(mockInvoiceDocs).toHaveLength(1); // billing retried and succeeded this time

    // Enroll again — must not create a second invoice for the same student+structure
    await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(mockInvoiceDocs).toHaveLength(1);
  });
});

describe('POST /api/admissions/:id/enroll — business-flow: discount is correct on the FIRST-ever draft invoice (2026-09 billing-sequence fix)', () => {
  const ADMISSION_STRUCTURE = () => ({
    id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 1000 }],
  });
  const SIBLING_POLICY = () => ({
    id: 'dp_sib', schoolId: SCHOOL, type: 'sibling', active: true,
    tiers: [{ nthChild: 2, discountPct: 10 }, { nthChild: 3, discountPct: 15 }],
  });

  test('first child in the family — no existing guardian, no siblings — invoiced at 0% (nothing to discount, no account created)', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [SIBLING_POLICY()];
    mockAppDocs = [app()]; // default motherEmail matches nobody yet
    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockInvoiceDocs[0].discountPct).toBe(0);
    expect(mockUserDocs).toHaveLength(0); // no guardian account auto-created
  });

  test('second child — an existing guardian (from an already-enrolled elder sibling) is linked BEFORE the invoice is calculated, so it shows 10% on the very first invoice', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [SIBLING_POLICY()];
    mockStudentDocs = [{ id: 'stu_elder', schoolId: SCHOOL, firstName: 'Kofi', lastName: 'Osei', enrollmentDate: '2020-01-01', status: 'active' }];
    mockUserDocs = [{ id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', studentIds: ['stu_elder'], guardianOf: ['stu_elder'] }];
    mockAppDocs = [app({ motherEmail: 'adjoa@example.com' })]; // matches the existing guardian's email

    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});

    expect(res.status).toBe(201);
    const newStudentId = res.body.data.student.id;
    // Guardian relationship established BEFORE billing ran, in the same request:
    expect(mockUserDocs[0].studentIds).toEqual(['stu_elder', newStudentId]);
    // ...so the FIRST draft invoice already reflects it — no manual correction needed:
    expect(mockInvoiceDocs[0].discountPct).toBe(10);
    expect(mockInvoiceDocs[0].total).toBe(900);
  });

  test('third child — ranks correctly against BOTH existing siblings, gets the 3rd-child tier', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [SIBLING_POLICY()];
    mockStudentDocs = [
      { id: 'stu_a', schoolId: SCHOOL, firstName: 'A', lastName: 'Osei', enrollmentDate: '2019-01-01', status: 'active' },
      { id: 'stu_b', schoolId: SCHOOL, firstName: 'B', lastName: 'Osei', enrollmentDate: '2021-01-01', status: 'active' },
    ];
    mockUserDocs = [{ id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', studentIds: ['stu_a', 'stu_b'], guardianOf: ['stu_a', 'stu_b'] }];
    mockAppDocs = [app({ motherEmail: 'adjoa@example.com' })];

    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockInvoiceDocs[0].discountPct).toBe(15);
  });

  test('director-family flag on the APPLICATION establishes eligibility before enrollment even happens', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [{ id: 'dp_dir', schoolId: SCHOOL, type: 'director', active: true, flatPct: 20 }];
    mockAppDocs = [app({ isDirectorFamily: true })];

    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockStudentDocs[0].isDirectorFamily).toBe(true);
    expect(mockInvoiceDocs[0].discountPct).toBe(20);
  });

  test('referral-family flag on the APPLICATION establishes eligibility before enrollment even happens', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [{ id: 'dp_ref', schoolId: SCHOOL, type: 'referral', active: true, flatPct: 5 }];
    mockAppDocs = [app({ isReferralFamily: true })];

    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockInvoiceDocs[0].discountPct).toBe(5);
  });

  test('competing discounts — sibling (10%) vs director (25%) — only the highest applies, never stacked', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [SIBLING_POLICY(), { id: 'dp_dir', schoolId: SCHOOL, type: 'director', active: true, flatPct: 25 }];
    mockStudentDocs = [{ id: 'stu_elder', schoolId: SCHOOL, firstName: 'Kofi', lastName: 'Osei', enrollmentDate: '2020-01-01', status: 'active' }];
    mockUserDocs = [{ id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', studentIds: ['stu_elder'] }];
    mockAppDocs = [app({ motherEmail: 'adjoa@example.com', isDirectorFamily: true })];

    const res = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(res.status).toBe(201);
    expect(mockInvoiceDocs[0].discountPct).toBe(25); // director's 25% beats sibling's 10%
    expect(mockInvoiceDocs).toHaveLength(1); // one invoice, one discount — never two line items or a stacked total
  });

  test('enrollment retry — re-enrolling never double-links the guardian and never creates a second invoice', async () => {
    mockFeeStructureDocs = [ADMISSION_STRUCTURE()];
    mockDiscountPolicyDocs = [SIBLING_POLICY()];
    mockStudentDocs = [{ id: 'stu_elder', schoolId: SCHOOL, firstName: 'Kofi', lastName: 'Osei', enrollmentDate: '2020-01-01', status: 'active' }];
    mockUserDocs = [{ id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'adjoa@example.com', studentIds: ['stu_elder'], guardianOf: ['stu_elder'] }];
    mockAppDocs = [app({ motherEmail: 'adjoa@example.com' })];

    const first = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(first.status).toBe(201);
    const newStudentId = first.body.data.student.id;

    const second = await supertest(buildApp()).post('/api/admissions/app_1/enroll').send({});
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyEnrolled).toBe(true);

    expect(mockInvoiceDocs).toHaveLength(1); // never duplicated
    expect(mockUserDocs[0].studentIds.filter(id => id === newStudentId)).toHaveLength(1); // never double-linked
  });
});
