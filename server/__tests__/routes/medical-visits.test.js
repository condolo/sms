/* ============================================================
   Medical Centre milestone 3 — server/routes/medical.js (Clinic Visits)

   Covers: RBAC gating (nobody gets 'medical' by default except
   admin/principal/deputy_principal — see repairPermissions.js/
   onboard.js), server-side studentName resolution (same fix class as
   the behaviour_incidents studentName bug from last session), the
   referred/referredTo validation pairing, and soft-delete (never a
   hard delete — the record is retained, just excluded from reads).

   rbac is NOT mocked — role_permissions is seeded with realistic
   grants, same discipline as hostel-rbac.test.js.

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
      if ('$exists' in v) return v.$exists ? (doc[k] !== undefined) : (doc[k] === undefined);
      return true; // don't over-constrain on operators this suite doesn't need (date ranges, regex)
    }
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  let docs = [...seed];
  return {
    _docs: () => docs,
    find:             jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:          jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    countDocuments:   jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
    create:           jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx === -1) return mockChainObj(null);
      const flat = update.$set ? { ...update.$set } : { ...update };
      docs[idx] = { ...docs[idx], ...flat };
      return mockChainObj(docs[idx]);
    }),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const mockDispatch = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...args) => mockDispatch(...args) }));

/* Matches repairPermissions.js's real defaults: admin gets full RCUD on
   'medical'; teacher gets ONLY the medical__alerts sub-grant (no
   top-level 'medical' key at all) — no top-level 'medical' key means
   rbac('medical','create','record') has nothing to fall back to. */
const mockRolePerms = {
  admin:   { medical: ['read', 'create', 'update', 'delete'] },
  teacher: { medical__alerts: ['read'] },
};
function mockMakeRolePermsStore() {
  return {
    findOne: jest.fn(({ roleKey }) => mockChainObj(mockRolePerms[roleKey] ? { permissions: mockRolePerms[roleKey] } : null)),
  };
}

let mockVisits, mockStudents;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') return mockMakeRolePermsStore();
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'medical_visits') return mockVisits;
    if (collection === 'students')       return mockStudents;
    return mockMakeFakeCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const medicalRouter = require('../../routes/medical');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/medical', medicalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockVisits   = mockMakeFakeCollection([]);
  mockStudents = mockMakeFakeCollection([{ id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno' }]);
});

describe('POST /api/medical/visits — RBAC', () => {
  test('admin (full grant) can log a visit', async () => {
    const res = await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', complaint: 'Headache' });
    expect(res.status).toBe(201);
  });

  test('a teacher with only medical__alerts is forbidden from recording a visit', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', complaint: 'Headache' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/medical/visits — studentName resolution', () => {
  test('studentName is resolved server-side when the caller omits it', async () => {
    const res = await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', complaint: 'Stomach ache' });

    expect(res.status).toBe(201);
    expect(res.body.data.studentName).toBe('Amina Otieno');
  });

  test('an explicitly supplied studentName is kept as-is, not overridden', async () => {
    const res = await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', studentName: 'A. Otieno (preferred name)', complaint: 'Stomach ache' });

    expect(res.status).toBe(201);
    expect(res.body.data.studentName).toBe('A. Otieno (preferred name)');
  });
});

describe('POST /api/medical/visits — referred/referredTo pairing', () => {
  test('referred=true without referredTo is rejected', async () => {
    const res = await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', complaint: 'Fracture suspected', referred: true });
    expect(res.status).toBe(400);
  });

  test('referred=true with referredTo succeeds', async () => {
    const res = await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', complaint: 'Fracture suspected', referred: true, referredTo: 'City Hospital' });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/medical/visits — audit + notification side effects', () => {
  test('logs medical.visit_logged and notifies guardians', async () => {
    await supertest(buildApp())
      .post('/api/medical/visits')
      .send({ studentId: 'stu_1', complaint: 'Headache' });

    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'medical.visit_logged' }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'medical_visit_logged' }));
  });
});

describe('DELETE /api/medical/visits/:id — soft-delete only', () => {
  test('marks deletedAt/deletedBy, does not remove the record, and excludes it from the default list', async () => {
    mockVisits = mockMakeFakeCollection([
      { id: 'v1', schoolId: SCHOOL_A, studentId: 'stu_1', studentName: 'Amina Otieno', complaint: 'Headache', date: '2026-08-01' },
    ]);

    const delRes = await supertest(buildApp()).delete('/api/medical/visits/v1');
    expect(delRes.status).toBe(200);

    // Still physically present in the store — a soft-delete, not a hard one.
    const stillThere = mockVisits._docs().find(d => d.id === 'v1');
    expect(stillThere).toBeDefined();
    expect(stillThere.deletedAt).toEqual(expect.any(String));
    expect(stillThere.deletedBy).toBe('usr_admin');

    const listRes = await supertest(buildApp()).get('/api/medical/visits');
    expect(listRes.body.data.find(v => v.id === 'v1')).toBeUndefined();

    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'medical.visit_deleted' }));
  });

  test('a teacher with only medical__alerts is forbidden from deleting a visit', async () => {
    mockVisits = mockMakeFakeCollection([{ id: 'v1', schoolId: SCHOOL_A, studentId: 'stu_1', complaint: 'Headache' }]);
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };

    const res = await supertest(buildApp()).delete('/api/medical/visits/v1');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/medical/visits — filtering', () => {
  test('filters to a single student when studentId is passed', async () => {
    mockVisits = mockMakeFakeCollection([
      { id: 'v1', schoolId: SCHOOL_A, studentId: 'stu_1', complaint: 'Headache' },
      { id: 'v2', schoolId: SCHOOL_A, studentId: 'stu_2', complaint: 'Cough' },
    ]);

    const res = await supertest(buildApp()).get('/api/medical/visits').query({ studentId: 'stu_1' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].studentId).toBe('stu_1');
  });
});
