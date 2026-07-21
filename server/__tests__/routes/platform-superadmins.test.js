/* ============================================================
   GET/POST /api/platform/schools/:id/superadmins — unit tests with mocked DB.

   Adds the missing capability the 2026-07-21 orphan-purge incident exposed:
   there was no platform-admin way to add a superadmin to an ALREADY-EXISTING
   school (only first-provisioning creates one, and the self-service invite
   flow requires an already-logged-in admin — useless once a school has zero
   working superadmins). A school may validly have 2+ superadmins.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({
  provisionOrganizationForSchool: jest.fn(),
}));
let mockSchoolDoc  = null;
let mockUserDocs   = [];
let insertedDoc    = null;

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection, ctx) => {
    if (collection !== 'users') return { updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) };
    const scoped = () => mockUserDocs.filter(u => u.schoolId === ctx.schoolId);
    return {
      findOne: (filter = {}) => ({
        lean: () => Promise.resolve(scoped().find(u => Object.entries(filter).every(([k, v]) => u[k] === v)) || null),
      }),
      find: (filter = {}) => ({
        select: () => ({
          lean: () => Promise.resolve(scoped().filter(u => Object.entries(filter).every(([k, v]) => u[k] === v))),
        }),
      }),
    };
  }),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async (pw) => `hashed:${pw}`) }));
jest.mock('../../routes/auth', () => ({ _buildTokenPayload: jest.fn(), _availableSchools: jest.fn() }));

const mockProvisionIdentity = jest.fn(async () => ({ id: 'idt_mock' }));
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: (...args) => mockProvisionIdentity(...args),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connection: { db: {
      collection: (name) => ({
        insertOne: jest.fn(async (doc) => {
          insertedDoc = doc;
          if (name === 'users') mockUserDocs.push(doc);
          return { insertedId: 'oid_new_' + Date.now() };
        }),
      }),
    } },
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return { findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) };
      }
      return { find: () => ({ lean: () => Promise.resolve([]) }) };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

describe('GET /api/platform/schools/:id/superadmins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insertedDoc = null;
    mockSchoolDoc = { id: 'sch_demo', slug: 'demo', name: 'Demo School' };
    mockUserDocs = [
      { id: 'u1', schoolId: 'sch_demo', email: 'a@demo.example', role: 'superadmin', name: 'Admin A', isActive: true },
      { id: 'u2', schoolId: 'sch_demo', email: 'b@demo.example', role: 'teacher',    name: 'Teacher B', isActive: true },
    ];
  });

  test('lists only superadmin accounts for the school', async () => {
    const res = await supertest(app()).get('/api/platform/schools/sch_demo/superadmins');
    expect(res.status).toBe(200);
    expect(res.body.superadmins).toHaveLength(1);
    expect(res.body.superadmins[0].email).toBe('a@demo.example');
  });

  test('404s for a nonexistent school', async () => {
    mockSchoolDoc = null;
    const res = await supertest(app()).get('/api/platform/schools/sch_missing/superadmins');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/platform/schools/:id/superadmins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insertedDoc = null;
    mockSchoolDoc = { id: 'sch_demo', slug: 'demo', name: 'Demo School' };
    mockUserDocs = [];
  });

  test('creates a superadmin with a generated temp password and mustChangePassword true', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins')
      .send({ name: 'Collins Ndolo', email: 'c.ndolo@mla.ac.ke' });

    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeDefined();
    expect(res.body.user.email).toBe('c.ndolo@mla.ac.ke');
    expect(insertedDoc.role).toBe('superadmin');
    expect(insertedDoc.mustChangePassword).toBe(true);
    expect(mockProvisionIdentity).toHaveBeenCalled();
  });

  test('a school can have a SECOND superadmin — not capped at one', async () => {
    mockUserDocs = [{ id: 'u1', schoolId: 'sch_demo', email: 'existing@demo.example', role: 'superadmin' }];
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins')
      .send({ name: 'Second Admin', email: 'second@demo.example' });
    expect(res.status).toBe(201);
  });

  test('409s when the email already exists at this school (any role)', async () => {
    mockUserDocs = [{ id: 'u1', schoolId: 'sch_demo', email: 'taken@demo.example', role: 'teacher' }];
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins')
      .send({ name: 'Collins', email: 'taken@demo.example' });
    expect(res.status).toBe(409);
  });

  test('400s on missing name/email', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_demo/superadmins').send({ email: 'x@y.example' });
    expect(res.status).toBe(400);
  });

  test('400s on malformed email', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins')
      .send({ name: 'X', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('404s for a nonexistent school', async () => {
    mockSchoolDoc = null;
    const res = await supertest(app())
      .post('/api/platform/schools/sch_missing/superadmins')
      .send({ name: 'X', email: 'x@y.example' });
    expect(res.status).toBe(404);
  });

  test('an explicit password >= 8 chars is used as-is and mustChangePassword is false', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins')
      .send({ name: 'X', email: 'x@y.example', password: 'a-real-password-123' });
    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeUndefined();
    expect(insertedDoc.mustChangePassword).toBe(false);
    expect(insertedDoc.password).toBe('hashed:a-real-password-123');
  });
});
