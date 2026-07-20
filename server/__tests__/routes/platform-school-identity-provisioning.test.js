/* ============================================================
   POST /api/platform/schools — identity-provisioning regression test.

   Real bug found via live-DB testing (mongodb-memory-server + a real
   spawned server process, no mocks): every OTHER user-creation call site
   in the codebase (users.js, settings.js, onboard.js, students.js,
   import-export.js, auth.js) calls provisionIdentityForUser() inline
   after creating a user — this one didn't. The school's own initial
   superadmin, created here via the raw Mongo driver (to bypass Mongoose's
   `id` virtual), never got an identityId.

   Concretely: with the admin's identityId unset, auth.js's
   _availableSchools() (which _buildTokenPayload's orgId/identityId feed
   into) can never resolve any schools for that admin — the C9 School
   Switcher can never appear for a platform-provisioned school's own
   admin, even after platform admin turns multiSchoolEnabled on for the
   org. This test asserts the hook is now called, with a real users doc
   shape (_id present) so provisionIdentityForUser's own sibling-exclusion
   query (`_id: {$ne: user._id}`) works correctly rather than silently
   matching every document.

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
  provisionOrganizationForSchool: jest.fn().mockResolvedValue({ id: 'org_new_1to1' }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed_pw') }));

const mockProvisionIdentityForUser = jest.fn().mockResolvedValue({ id: 'idt_1' });
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: (...args) => mockProvisionIdentityForUser(...args),
}));

const mockSchoolInsertOne = jest.fn().mockResolvedValue({ insertedId: 'mongo_school_oid' });
const mockUserInsertOne   = jest.fn().mockResolvedValue({ insertedId: 'mongo_user_oid' });

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    connection: {
      db: {
        collection: jest.fn((name) => {
          if (name === 'schools') return { insertOne: mockSchoolInsertOne };
          if (name === 'users')   return { insertOne: mockUserInsertOne };
          return { insertOne: jest.fn() };
        }),
      },
    },
    model: jest.fn((_name, _schema, col) => {
      // Slug-uniqueness lookups — no collisions for this test.
      return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
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

beforeEach(() => { jest.clearAllMocks(); mockSchoolInsertOne.mockResolvedValue({ insertedId: 'mongo_school_oid' }); mockUserInsertOne.mockResolvedValue({ insertedId: 'mongo_user_oid' }); });

describe('POST /api/platform/schools — identity provisioning', () => {
  test('calls provisionIdentityForUser for the new admin, with a real _id (not undefined)', async () => {
    const res = await supertest(app()).post('/api/platform/schools').send({
      name: 'Trinity International School', slug: 'trinity-tis',
      adminEmail: 'admin@trinity-tis.test', adminPassword: 'AdminPass123!', adminName: 'Trinity Admin',
    });

    expect(res.status).toBe(201);
    expect(mockProvisionIdentityForUser).toHaveBeenCalledTimes(1);
    const passedUser = mockProvisionIdentityForUser.mock.calls[0][0];
    expect(passedUser.email).toBe('admin@trinity-tis.test');
    expect(passedUser._id).toBe('mongo_user_oid'); // real insertedId, not undefined —
    // undefined would make provisionIdentityForUser's own sibling-exclusion
    // query ({_id: {$ne: user._id}}) match every document instead of
    // correctly excluding this one.
  });

  test('a failure in provisionIdentityForUser does not fail school creation (non-blocking, self-healing)', async () => {
    mockProvisionIdentityForUser.mockRejectedValueOnce(new Error('boom'));
    const res = await supertest(app()).post('/api/platform/schools').send({
      name: 'Resilient School', slug: 'resilient-school',
      adminEmail: 'admin@resilient.test', adminPassword: 'AdminPass123!', adminName: 'Admin',
    });
    expect(res.status).toBe(201);
  });
});
