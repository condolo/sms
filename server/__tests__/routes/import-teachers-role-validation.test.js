/* ============================================================
   POST /api/import-export/teachers — staffType/role validation
   (onboarding import templates update, 2026-08)

   Root cause fixed: this handler hardcoded `role: 'teacher'` on every
   auto-created login account regardless of what the imported staff
   member actually does — the same "assumed all staff are teachers"
   mistake fixed everywhere else in the app this session (see
   utils/role-validation.js), still alive here as a fourth, previously-
   missed write path. The Teachers import template had no staffType
   column at all. Now it does, validated against the same SYSTEM_ROLES/
   custom_roles allowlist and superadmin-only admin-role gate every other
   role-assigning route uses.

   Real authMiddleware-shaped req.jwtUser injection (mocked, not signed —
   matches this file family's existing import-export-payroll.test.js
   convention) + the actual handler logic, not reimplemented.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}
function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.includes(doc[k]);
      return doc[k] === v;
    });
  }
  return {
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) ?? null),
    insertMany: async (newDocs) => { docs.push(...newDocs); return newDocs; },
    _docs: () => docs,
  };
}

const SCHOOL = 'school_test_001';

let mockCurrentUser;
let mockStores;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((col) => mockStores[col]),
}));
jest.mock('../../utils/counters', () => ({
  reserveAdmissionNumbers: jest.fn(),
  reserveStaffIds: jest.fn((schoolId, n) => Promise.resolve(Array.from({ length: n }, (_, i) => `STF-${i + 1}`))),
  reserveInvoiceNumbers: jest.fn(),
}));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: jest.fn((fns) => Promise.all(fns.map(f => f()))) }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hashed') }));

const express   = require('express');
const supertest = require('supertest');
const importExportRouter = require('../../routes/import-export');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));
  app.use('/api/import-export', importExportRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
  mockStores = {
    teachers:      makeStore([]),
    users:         makeStore([]),
    custom_roles:  makeStore([{ schoolId: SCHOOL, key: 'front_office', label: 'Front Office' }]),
    departments:   makeStore([{ id: 'dept_math', schoolId: SCHOOL, name: 'Mathematics' }]),
    schools:       makeStore([{ id: SCHOOL, name: 'Demo School' }]),
  };
});

function row(overrides = {}) {
  return {
    firstName: 'Amina', lastName: 'Otieno', email: 'amina@demo.school',
    ...overrides,
  };
}

describe('POST /api/import-export/teachers — staffType drives the created login role', () => {
  test('staffType is stored on the teacher record and used as the login account role — not hardcoded "teacher"', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ staffType: 'finance' })] });

    expect(res.status).toBe(201);
    expect(mockStores.teachers._docs()[0].staffType).toBe('finance');
    expect(mockStores.users._docs()[0].role).toBe('finance');
    expect(mockStores.users._docs()[0].roles).toEqual(['finance']);
  });

  test('blank staffType defaults to "teacher" (backward compatible with the old template)', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row()] });

    expect(res.status).toBe(201);
    expect(mockStores.users._docs()[0].role).toBe('teacher');
  });

  test('a custom role key works as staffType', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ staffType: 'front_office' })] });

    expect(res.status).toBe(201);
    expect(mockStores.users._docs()[0].role).toBe('front_office');
  });

  test('an invalid staffType is rejected — no teacher record and no login account are created for that row', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ staffType: 'Marketing Coordinator' })] });

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors.length).toBeGreaterThan(0);
    expect(mockStores.teachers._docs()).toHaveLength(0);
    expect(mockStores.users._docs()).toHaveLength(0);
  });

  test('a plain admin cannot bulk-import a row that grants "admin" (matches every other role-assigning route)', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ staffType: 'admin' })] });

    expect(res.body.data.created).toBe(0);
    expect(mockStores.users._docs()).toHaveLength(0);
  });

  test('superadmin CAN bulk-import a row that grants "admin"', async () => {
    mockCurrentUser = { userId: 'usr_super', schoolId: SCHOOL, role: 'superadmin', roles: ['superadmin'] };
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ staffType: 'admin' })] });

    expect(res.status).toBe(201);
    expect(mockStores.users._docs()[0].role).toBe('admin');
  });
});

describe('POST /api/import-export/teachers — extraRoles', () => {
  test('comma-separated extraRoles are parsed, deduped, and stored', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ extraRoles: 'hod, hod, timetabler' })] });

    expect(res.status).toBe(201);
    expect(mockStores.teachers._docs()[0].extraRoles.sort()).toEqual(['hod', 'timetabler']);
  });

  test('an invalid extraRole is rejected with a clear per-row error', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ extraRoles: 'hod, principal_of_everything' })] });

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors[0].field).toBe('extraRoles');
  });

  test('a custom responsibility the school has defined (Settings -> Staff Roles & Responsibilities) is accepted, not just the 6 built-ins', async () => {
    mockStores.schools = makeStore([{
      id: SCHOOL, name: 'Demo School',
      staffResponsibilities: [{ value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' }],
    }]);
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ extraRoles: 'hod, ks3_academic_coordinator' })] });

    expect(res.status).toBe(201);
    expect(mockStores.teachers._docs()[0].extraRoles.sort()).toEqual(['hod', 'ks3_academic_coordinator']);
  });

  test('a value that is neither built-in nor defined by this school is still rejected, even with staffResponsibilities present', async () => {
    mockStores.schools = makeStore([{
      id: SCHOOL, name: 'Demo School',
      staffResponsibilities: [{ value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' }],
    }]);
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ extraRoles: 'ks3_academic_coordinator, still_not_real' })] });

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors[0].field).toBe('extraRoles');
    expect(res.body.data.errors[0].message).toMatch(/still_not_real/);
  });
});

describe('POST /api/import-export/teachers — departmentName resolution', () => {
  test('a real department name resolves to departmentId', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ extraRoles: 'hod', departmentName: 'Mathematics' })] });

    expect(res.status).toBe(201);
    expect(mockStores.teachers._docs()[0].departmentId).toBe('dept_math');
  });

  test('an unmatched department name is rejected with a clear, actionable error', async () => {
    const res = await supertest(buildApp())
      .post('/api/import-export/teachers')
      .set('Content-Type', 'application/json')
      .send({ rows: [row({ departmentName: 'Nonexistent Department' })] });

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors[0].field).toBe('departmentName');
  });
});
