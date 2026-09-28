/* ============================================================
   POST /api/platform/schools/:id/superadmins/promote

   Before this route existed, granting superadmin was ONLY possible by
   creating a brand-new account (POST /superadmins, name+email+fresh
   password) — there was no way to promote a user who ALREADY has a
   login at that school, keeping their existing password/history. This
   closes that gap: given just an email, it looks up the existing user,
   flips their role to superadmin, ends their current session (so the
   change takes effect immediately, same convention as settings.js's own
   role-change route), audits it, and emails them a notice.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => { req.platformOperatorTier = 'owner'; next(); },
  requireOwnerTier: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
const mockSendRoleChanged = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/email', () => ({ sendRoleChanged: (...args) => mockSendRoleChanged(...args) }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../routes/auth', () => ({ _buildTokenPayload: jest.fn(), _availableSchools: jest.fn() }));
const mockRevokeUserTokens = jest.fn().mockResolvedValue(undefined);
const mockRevokeIdentityTokens = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: (...args) => mockRevokeUserTokens(...args),
  revokeIdentityTokens: (...args) => mockRevokeIdentityTokens(...args),
}));

let mockSchoolDoc = null;
let mockUserDocs  = [];

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection, ctx) => {
    if (collection !== 'users') return { updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) };
    const scoped = () => mockUserDocs.filter(u => u.schoolId === ctx.schoolId);
    return {
      findOne: (filter = {}) => ({
        lean: () => Promise.resolve(scoped().find(u => mockMatches(u, filter)) || null),
      }),
      updateOne: jest.fn((filter, update) => {
        const doc = scoped().find(u => mockMatches(u, filter));
        if (doc && update.$set) Object.assign(doc, update.$set);
        return Promise.resolve({ matchedCount: doc ? 1 : 0 });
      }),
    };
  }),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connection: { db: { collection: () => ({ insertOne: jest.fn() }) } },
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') return { findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) };
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

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDoc = { id: 'sch_demo', slug: 'demo', name: 'Demo School', systemEmail: 'office@demo.example' };
  mockUserDocs = [
    { id: 'u_jane', schoolId: 'sch_demo', email: 'jane@demo.example', role: 'teacher', name: 'Jane Doe', isActive: true, tokenVersion: 2 },
  ];
});

describe('POST /api/platform/schools/:id/superadmins/promote', () => {
  test('promotes an existing active user to superadmin, revokes their session, audits, and emails them', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins/promote')
      .send({ email: 'jane@demo.example' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('superadmin');

    const doc = mockUserDocs.find(u => u.id === 'u_jane');
    expect(doc.role).toBe('superadmin');
    expect(doc.roles).toEqual(['superadmin']);

    expect(mockRevokeUserTokens).toHaveBeenCalledWith('u_jane');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.superadmin_promoted' }));
    expect(mockSendRoleChanged).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@demo.example', oldRole: 'teacher', newRole: 'superadmin' }));
  });

  test('email match is case-insensitive / trims whitespace', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins/promote')
      .send({ email: '  JANE@demo.example  ' });
    expect(res.status).toBe(200);
  });

  test('404s when no user with that email exists at this school', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins/promote')
      .send({ email: 'nobody@demo.example' });
    expect(res.status).toBe(404);
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });

  test('409s on an already-inactive/removed account — must be reactivated first', async () => {
    mockUserDocs.push({ id: 'u_gone', schoolId: 'sch_demo', email: 'gone@demo.example', role: 'teacher', isActive: false });
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins/promote')
      .send({ email: 'gone@demo.example' });
    expect(res.status).toBe(409);
    expect(mockUserDocs.find(u => u.id === 'u_gone').role).toBe('teacher');
  });

  test('409s when the user is already a superadmin', async () => {
    mockUserDocs.push({ id: 'u_already', schoolId: 'sch_demo', email: 'already@demo.example', role: 'superadmin', isActive: true });
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins/promote')
      .send({ email: 'already@demo.example' });
    expect(res.status).toBe(409);
  });

  test('400s on missing email', async () => {
    const res = await supertest(app()).post('/api/platform/schools/sch_demo/superadmins/promote').send({});
    expect(res.status).toBe(400);
  });

  test('404s for a nonexistent school', async () => {
    mockSchoolDoc = null;
    const res = await supertest(app())
      .post('/api/platform/schools/sch_missing/superadmins/promote')
      .send({ email: 'jane@demo.example' });
    expect(res.status).toBe(404);
  });

  test('a notification-email failure is non-fatal — promotion still succeeds', async () => {
    mockSendRoleChanged.mockRejectedValueOnce(new Error('smtp down'));
    const res = await supertest(app())
      .post('/api/platform/schools/sch_demo/superadmins/promote')
      .send({ email: 'jane@demo.example' });
    expect(res.status).toBe(200);
    expect(mockUserDocs.find(u => u.id === 'u_jane').role).toBe('superadmin');
  });
});
