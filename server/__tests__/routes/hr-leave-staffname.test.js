/* ============================================================
   server/routes/hr.js — leave request staffName resolution

   Root cause: POST /leave wrote `staffName: req.jwtUser.name ?? ''`, but
   auth.js's _buildTokenPayload (the function that builds EVERY JWT this
   app issues) never includes a `name` field at all — only userId,
   schoolId, email, role, roles, tv (plus a few role-conditional fields).
   So req.jwtUser.name is undefined for every real user, every time, and
   every leave request ever submitted got a permanently blank staffName.
   This is why hr-leave-workflow.test.js's existing suite never caught it:
   its mock jwtUser unrealistically includes a `name` field production
   tokens never carry.

   These tests deliberately use a jwtUser shaped like a REAL token (no
   `name` field) to prove the fix resolves the name from the users
   collection instead, and that GET /leave self-heals pre-existing
   records that already have a blank staffName baked in.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

// Full chainable — hr.js's GET /leave runs .find(filter).sort().skip().
// limit().select().lean(), and the users lookup runs .find().select().lean();
// support the whole surface so either call site works against this mock.
function chain(result) {
  const c = {
    sort:   () => c,
    skip:   () => c,
    limit:  () => c,
    select: () => c,
    lean:   () => Promise.resolve(result),
  };
  return c;
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
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const express   = require('express');
const supertest = require('supertest');
const hrRouter  = require('../../routes/hr');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr', hrRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Shaped like a REAL token from auth.js's _buildTokenPayload — no
  // `name` field. This is the shape every actual request carries.
  mockCurrentUser = { userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher', roles: [], email: 't@x.io' };
  mockStores = {
    leave_requests:   makeStore(),
    workflow_configs: makeStore(),
    custom_roles:     makeStore(),
    messages:         makeStore(),
    users: makeStore([
      { id: 'u_teacher', schoolId: SCHOOL, name: 'Nat Otieno', role: 'teacher', isActive: true },
      { id: 'u_hr',      schoolId: SCHOOL, name: 'HR Person',  role: 'hr',      isActive: true },
    ]),
  };
});

describe('POST /api/hr/leave — staffName resolution', () => {
  test('resolves staffName from the users collection, not from the (nonexistent) jwtUser.name', async () => {
    const res = await supertest(buildApp()).post('/api/hr/leave').send({
      type: 'annual', startDate: '2026-08-01', endDate: '2026-08-03', reason: 'trip',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.staffName).toBe('Nat Otieno');
  });

  test('falls back to empty string (not a crash) if the submitting user record is somehow missing', async () => {
    mockCurrentUser = { userId: 'u_ghost', schoolId: SCHOOL, role: 'teacher', roles: [] };
    const res = await supertest(buildApp()).post('/api/hr/leave').send({
      type: 'sick', startDate: '2026-08-01', endDate: '2026-08-01', reason: 'unwell',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.staffName).toBe('');
  });
});

describe('GET /api/hr/leave — self-heals pre-existing blank staffName records', () => {
  test('a record written before the fix (blank staffName) is resolved from users at read time', async () => {
    mockStores.leave_requests = makeStore([
      { id: 'lr_1', schoolId: SCHOOL, staffId: 'u_teacher', staffName: '', type: 'annual', startDate: '2026-07-09', endDate: '2026-07-10', days: 2, status: 'approved', createdAt: '2026-07-01' },
    ]);
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };

    const res = await supertest(buildApp()).get('/api/hr/leave');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].staffName).toBe('Nat Otieno');
  });

  test('a record with an already-populated staffName is left untouched (no unnecessary lookup/overwrite)', async () => {
    mockStores.leave_requests = makeStore([
      { id: 'lr_1', schoolId: SCHOOL, staffId: 'u_teacher', staffName: 'Some Other Name On File', type: 'annual', startDate: '2026-07-09', endDate: '2026-07-10', days: 2, status: 'approved', createdAt: '2026-07-01' },
    ]);
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };

    const res = await supertest(buildApp()).get('/api/hr/leave');
    expect(res.body.data[0].staffName).toBe('Some Other Name On File');
  });

  test('a blank record whose staffId no longer resolves to any user stays blank, not crash', async () => {
    mockStores.leave_requests = makeStore([
      { id: 'lr_1', schoolId: SCHOOL, staffId: 'u_deleted', staffName: '', type: 'annual', startDate: '2026-07-09', endDate: '2026-07-10', days: 2, status: 'approved', createdAt: '2026-07-01' },
    ]);
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [] };

    const res = await supertest(buildApp()).get('/api/hr/leave');
    expect(res.status).toBe(200);
    expect(res.body.data[0].staffName).toBe('');
  });
});
