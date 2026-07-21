/* ============================================================
   POST /api/platform/organizations/:id/director — unit tests with mocked DB.

   Creates a read-only 'group_director' account, anchored at the org's
   oldest active school, seeded with a role_permissions doc granting
   ONLY group_analytics:['read'] — the mechanism that actually enforces
   "no settings access," not the role name alone.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
const mockInvalidatePermCache = jest.fn();
jest.mock('../../middleware/rbac', () => ({ invalidatePermCache: (...a) => mockInvalidatePermCache(...a) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async (pw) => `hashed:${pw}`) }));
jest.mock('../../routes/auth', () => ({ _buildTokenPayload: jest.fn(), _availableSchools: jest.fn() }));

const mockProvisionIdentity = jest.fn(async () => ({ id: 'idt_mock' }));
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: (...args) => mockProvisionIdentity(...args),
}));

let mockOrgDoc      = null;
let mockSchoolDocs  = [];   // active schools in the org, sorted oldest-first for the test's convenience
let mockUserDocs    = [];
let mockRolePerms   = [];
let insertedDoc     = null;
let mockCreatedRolePerm = null;

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection, ctx) => {
    if (collection === 'users') {
      const scoped = () => mockUserDocs.filter(u => u.schoolId === ctx.schoolId);
      return {
        findOne: (filter = {}) => ({
          lean: () => Promise.resolve(scoped().find(u => Object.entries(filter).every(([k, v]) => u[k] === v)) || null),
        }),
      };
    }
    if (collection === 'role_permissions') {
      return {
        findOne: (filter = {}) => ({
          lean: () => Promise.resolve(
            mockRolePerms.find(p => p.schoolId === ctx.schoolId && Object.entries(filter).every(([k, v]) => p[k] === v)) || null
          ),
        }),
        create: async (doc) => { mockCreatedRolePerm = { ...doc, schoolId: ctx.schoolId }; mockRolePerms.push(mockCreatedRolePerm); return mockCreatedRolePerm; },
      };
    }
    return { updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) };
  }),
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
      if (col === 'organizations') {
        return { findOne: () => ({ lean: () => Promise.resolve(mockOrgDoc) }) };
      }
      if (col === 'schools') {
        return {
          findOne: () => ({
            sort: () => ({
              lean: () => Promise.resolve(mockSchoolDocs[0] || null),
            }),
          }),
        };
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

describe('POST /api/platform/organizations/:id/director', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insertedDoc = null;
    mockCreatedRolePerm = null;
    mockOrgDoc = { id: 'org_1', name: 'Trinity Group' };
    mockSchoolDocs = [{ id: 'sch_trinity', name: 'Trinity International', organizationId: 'org_1', isActive: true, createdAt: '2020-01-01' }];
    mockUserDocs  = [];
    mockRolePerms = [];
  });

  test('404s for a nonexistent organization', async () => {
    mockOrgDoc = null;
    const res = await supertest(app())
      .post('/api/platform/organizations/org_missing/director')
      .send({ name: 'X', email: 'x@y.example' });
    expect(res.status).toBe(404);
  });

  test('400s when the org has no active school to anchor to', async () => {
    mockSchoolDocs = [];
    const res = await supertest(app())
      .post('/api/platform/organizations/org_1/director')
      .send({ name: 'X', email: 'x@y.example' });
    expect(res.status).toBe(400);
  });

  test('creates a group_director user at the anchor school with a generated temp password', async () => {
    const res = await supertest(app())
      .post('/api/platform/organizations/org_1/director')
      .send({ name: 'Jane CEO', email: 'jane@group.example' });

    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toBeDefined();
    expect(res.body.anchorSchool).toEqual({ id: 'sch_trinity', name: 'Trinity International' });
    expect(insertedDoc.role).toBe('group_director');
    expect(insertedDoc.schoolId).toBe('sch_trinity');
    expect(insertedDoc.mustChangePassword).toBe(true);
    expect(mockProvisionIdentity).toHaveBeenCalled();
  });

  test('seeds a role_permissions doc granting ONLY group_analytics:read', async () => {
    await supertest(app())
      .post('/api/platform/organizations/org_1/director')
      .send({ name: 'Jane CEO', email: 'jane@group.example' });

    expect(mockCreatedRolePerm).toBeTruthy();
    expect(mockCreatedRolePerm.roleKey).toBe('group_director');
    expect(mockCreatedRolePerm.permissions).toEqual({ group_analytics: ['read'] });
    expect(mockInvalidatePermCache).toHaveBeenCalledWith('sch_trinity');
  });

  test('does NOT overwrite an existing role_permissions doc for group_director on re-run', async () => {
    mockRolePerms = [{ roleKey: 'group_director', schoolId: 'sch_trinity', permissions: { group_analytics: ['read'], custom: ['read'] } }];
    await supertest(app())
      .post('/api/platform/organizations/org_1/director')
      .send({ name: 'Second Director', email: 'second@group.example' });

    expect(mockCreatedRolePerm).toBeNull(); // create() never called — already existed
    expect(mockRolePerms).toHaveLength(1);
    expect(mockRolePerms[0].permissions.custom).toEqual(['read']); // untouched
  });

  test('409s when the email already exists at the anchor school', async () => {
    mockUserDocs = [{ id: 'u1', schoolId: 'sch_trinity', email: 'taken@group.example', role: 'teacher' }];
    const res = await supertest(app())
      .post('/api/platform/organizations/org_1/director')
      .send({ name: 'X', email: 'taken@group.example' });
    expect(res.status).toBe(409);
  });

  test('400s on missing name/email or malformed email', async () => {
    const r1 = await supertest(app()).post('/api/platform/organizations/org_1/director').send({ email: 'x@y.example' });
    expect(r1.status).toBe(400);
    const r2 = await supertest(app()).post('/api/platform/organizations/org_1/director').send({ name: 'X', email: 'not-an-email' });
    expect(r2.status).toBe(400);
  });
});
