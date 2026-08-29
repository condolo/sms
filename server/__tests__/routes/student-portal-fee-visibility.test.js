/* ============================================================
   server/routes/student-portal.js — GET /dashboard fee visibility
   Security Baseline Register, CFG-09 (Critical).

   school.portalConfig.studentCanSeeFees is a real Settings toggle
   ("When off, students cannot see their fee balance") that was
   previously read by nothing at all — this route always returned
   feeBalance/feeClearancePct/nextFeeDueDate regardless of the
   setting. Fixed: those three fields are now null when the toggle
   is explicitly off, and unaffected (still real values) when it's
   on or unset (matching the toggle's own stated default).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const STUDENT_1 = 'stu_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: STUDENT_1 };
    next();
  },
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn() },
}));

function mockChain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c,
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
  };
  return c;
}
function mockCollection(seed = []) {
  return {
    find:           jest.fn(() => mockChain(seed)),
    findOne:        jest.fn(() => mockChain(seed[0] ?? null)),
    countDocuments: jest.fn(() => Promise.resolve(0)),
    distinct:       jest.fn(() => Promise.resolve([])),
  };
}

let mockSchoolDoc;
let mockStudentDoc;
let mockInvoices;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students') return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    if (collection === 'invoices') return mockCollection(mockInvoices);
    return mockCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const studentPortalRouter = require('../../routes/student-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/student-portal', studentPortalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = {
    id: STUDENT_1, schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei',
    admissionNumber: 'ADM001', classId: null, className: 'Grade 7', status: 'active',
  };
  mockInvoices = [{ total: 1000, balance: 400, status: 'unpaid' }];
  mockSchoolDoc = { name: 'Test School', academicYear: '2026', portalConfig: {} };
});

describe('GET /api/student-portal/dashboard — fee visibility (CFG-09)', () => {
  test('studentCanSeeFees explicitly false → all three fee fields are null', async () => {
    mockSchoolDoc.portalConfig = { studentCanSeeFees: false };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.feeBalance).toBeNull();
    expect(res.body.data.feeClearancePct).toBeNull();
    expect(res.body.data.nextFeeDueDate).toBeNull();
  });

  test('studentCanSeeFees true → real fee data is returned', async () => {
    mockSchoolDoc.portalConfig = { studentCanSeeFees: true };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.feeBalance).toBe(400);
    expect(res.body.data.feeClearancePct).toBe(60);
  });

  test('studentCanSeeFees unset (no portalConfig at all) defaults to visible', async () => {
    mockSchoolDoc.portalConfig = {};
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.feeBalance).toBe(400);
    expect(res.body.data.feeClearancePct).toBe(60);
  });

  test('the school.portalConfig object itself is still returned to the client either way (only the fee VALUES are gated)', async () => {
    mockSchoolDoc.portalConfig = { studentCanSeeFees: false };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.school.portalConfig).toEqual({ studentCanSeeFees: false });
  });
});
