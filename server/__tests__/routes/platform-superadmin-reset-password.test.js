/* ============================================================
   POST /api/platform/schools/:id/superadmins/:userId/reset-password

   The recovery path for the exact scenario that motivated this route:
   the one-time temp password shown by POST .../superadmins is lost
   before it's copied — it's never stored in plaintext anywhere — and
   Impersonate is disabled by default in production. This sets a new
   password directly, no login/impersonation required.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => { req.platformOperatorTier = 'owner'; next(); },
  requireOwnerTier: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn(), ACTIONS: {} }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships', () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));

const mockSendWelcomeCredentials = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: (...args) => mockSendWelcomeCredentials(...args) }));

const mockRevokeUserTokens     = jest.fn().mockResolvedValue(undefined);
const mockRevokeIdentityTokens = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens:     (...args) => mockRevokeUserTokens(...args),
  revokeIdentityTokens: (...args) => mockRevokeIdentityTokens(...args),
}));

let mockSchoolDoc;
let mockUserDoc;      // the target superadmin
let mockUpdateOneCalls;
let mockIdentitiesUpdateOneCalls;

const mockUsersCollection = {
  findOne: jest.fn((filter) => ({
    lean: () => Promise.resolve(
      mockUserDoc && mockUserDoc.role === 'superadmin' &&
      (filter.id === mockUserDoc.id || filter.$or?.some(c => c.id === mockUserDoc.id || c._id === mockUserDoc.id))
        ? mockUserDoc
        : null
    ),
  })),
  updateOne: jest.fn((filter, update) => { mockUpdateOneCalls.push({ filter, update }); return Promise.resolve(); }),
};

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'users') return mockUsersCollection;
    return { updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) };
  }),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return { findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) };
      }
      if (col === 'identities') {
        return { updateOne: jest.fn((filter, update) => { mockIdentitiesUpdateOneCalls.push({ filter, update }); return Promise.resolve(); }) };
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

const AuditService = require('../../services/audit');

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateOneCalls = [];
  mockIdentitiesUpdateOneCalls = [];
  mockSchoolDoc = { id: 'sch_trinitas', name: 'Trinitas International School', slug: 'trinitas-tis', systemEmail: 'ops@trinitas.example' };
  mockUserDoc = { id: 'usr_sa1', role: 'superadmin', email: 'newadmin@trinitas.example', name: 'New Admin', schoolId: 'sch_trinitas' };
});

const ENDPOINT = () => '/api/platform/schools/sch_trinitas/superadmins/usr_sa1/reset-password';

describe('POST /api/platform/schools/:id/superadmins/:userId/reset-password', () => {
  test('happy path: generates a new temp password, returns it once', async () => {
    const res = await supertest(app()).post(ENDPOINT()).send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.tempPassword).toBe('string');
    expect(res.body.tempPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.user).toMatchObject({ id: 'usr_sa1', email: 'newadmin@trinitas.example' });
  });

  test('writes mustChangePassword:true and a bcrypt hash when auto-generated', async () => {
    await supertest(app()).post(ENDPOINT()).send({});
    expect(mockUpdateOneCalls).toHaveLength(1);
    const { update } = mockUpdateOneCalls[0];
    expect(update.$set.mustChangePassword).toBe(true);
    expect(typeof update.$set.password).toBe('string');
    expect(update.$set.password).not.toBe(''); // bcrypt hash, never the plaintext
  });

  test('a caller-supplied password is honored and NOT echoed back in the response', async () => {
    const res = await supertest(app()).post(ENDPOINT()).send({ password: 'MyOwnStrongPassword1' });
    expect(res.status).toBe(200);
    expect(res.body.tempPassword).toBeUndefined();
    expect(mockUpdateOneCalls[0].update.$set.mustChangePassword).toBe(false);
  });

  test('rejects a caller-supplied password under 8 characters', async () => {
    const res = await supertest(app()).post(ENDPOINT()).send({ password: 'short' });
    expect(res.status).toBe(400);
    expect(mockUpdateOneCalls).toHaveLength(0);
  });

  test('404s when the school does not exist', async () => {
    mockSchoolDoc = null;
    const res = await supertest(app()).post(ENDPOINT()).send({});
    expect(res.status).toBe(404);
  });

  test('404s when the target user is not a superadmin (or does not exist) at this school', async () => {
    mockUserDoc = { id: 'usr_teacher1', role: 'teacher', email: 'teacher@trinitas.example', schoolId: 'sch_trinitas' };
    const res = await supertest(app()).post(ENDPOINT()).send({});
    expect(res.status).toBe(404);
    expect(mockUpdateOneCalls).toHaveLength(0);
  });

  test('revokes the target\'s existing sessions', async () => {
    await supertest(app()).post(ENDPOINT()).send({});
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_sa1');
  });

  test('dual-writes to the shared identity credential when identityId is set', async () => {
    mockUserDoc = { ...mockUserDoc, identityId: 'idn_42' };
    await supertest(app()).post(ENDPOINT()).send({});
    expect(mockIdentitiesUpdateOneCalls).toHaveLength(1);
    expect(mockIdentitiesUpdateOneCalls[0].filter).toEqual({ id: 'idn_42' });
    expect(mockRevokeIdentityTokens).toHaveBeenCalledWith('idn_42');
  });

  test('no identities dual-write or identity revocation when identityId is absent', async () => {
    await supertest(app()).post(ENDPOINT()).send({});
    expect(mockIdentitiesUpdateOneCalls).toHaveLength(0);
    expect(mockRevokeIdentityTokens).not.toHaveBeenCalled();
  });

  test('logs a platform.superadmin_password_reset audit event', async () => {
    await supertest(app()).post(ENDPOINT()).send({});
    expect(AuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.superadmin_password_reset',
        schoolId: 'sch_trinitas',
        target: expect.objectContaining({ id: 'usr_sa1' }),
      }),
    );
  });

  test('sends a best-effort welcome-credentials email with the new password', async () => {
    await supertest(app()).post(ENDPOINT()).send({});
    expect(mockSendWelcomeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'newadmin@trinitas.example', schoolId: 'sch_trinitas' }),
    );
  });

  test('a failed email send does not fail the whole request', async () => {
    mockSendWelcomeCredentials.mockRejectedValueOnce(new Error('smtp down'));
    const res = await supertest(app()).post(ENDPOINT()).send({});
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(false);
  });
});
