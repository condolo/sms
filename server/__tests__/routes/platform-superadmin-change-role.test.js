/* ============================================================
   GET /api/platform/schools/:id/roles
   POST /api/platform/schools/:id/superadmins/:userId/change-role

   Real customer follow-up: after promoting a replacement superadmin
   (POST .../superadmins/promote), the OUTGOING superadmin had nowhere
   to go — Settings -> Users' own role dropdown refuses to touch a
   superadmin/admin account (SettingsPage.jsx's PROTECTED_ROLES), and
   nothing existed on the platform side either. Requested directly:
   "there is no where to reassign the existing superadmin their new
   roles... dont hardcode, I want to configure myself." This closes
   that gap with a real role picker sourced from the shared SYSTEM_ROLES
   constant plus the school's own custom roles — never a hardcoded
   option list — and a route that applies it.

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
let mockCustomRoleDocs = [];

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection, ctx) => {
    if (collection === 'users') {
      const scoped = () => mockUserDocs.filter(u => u.schoolId === ctx.schoolId);
      return {
        findOne: (filter = {}) => ({ lean: () => Promise.resolve(scoped().find(u => mockMatches(u, filter)) || null) }),
        updateOne: jest.fn((filter, update) => {
          const doc = scoped().find(u => mockMatches(u, filter));
          if (doc && update.$set) Object.assign(doc, update.$set);
          return Promise.resolve({ matchedCount: doc ? 1 : 0 });
        }),
      };
    }
    if (collection === 'custom_roles') {
      const scoped = () => mockCustomRoleDocs.filter(r => r.schoolId === ctx.schoolId);
      return {
        find: (filter = {}) => ({ select: () => ({ lean: () => Promise.resolve(scoped().filter(r => mockMatches(r, filter))) }) }),
        findOne: (filter = {}) => ({ lean: () => Promise.resolve(scoped().find(r => mockMatches(r, filter)) || null) }),
      };
    }
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
  mockSchoolDoc = { id: 'sch_tis1', slug: 'trinitas', name: 'Trinitas International School', systemEmail: 'office@trinitas.example' };
  mockUserDocs = [
    { id: 'u_collins', schoolId: 'sch_tis1', email: 'collins@trinitas.example', role: 'superadmin', name: 'Mr. Collins Ochoo', isActive: true, identityId: 'idt_collins' },
  ];
  mockCustomRoleDocs = [
    { schoolId: 'sch_tis1', key: 'ks3_coordinator', label: 'KS3 Academic Coordinator' },
  ];
});

describe('GET /api/platform/schools/:id/roles', () => {
  test('returns SYSTEM_ROLES (minus superadmin) plus this school\'s own custom roles', async () => {
    const res = await supertest(app()).get('/api/platform/schools/sch_tis1/roles');
    expect(res.status).toBe(200);
    expect(res.body.systemRoles).toContain('principal');
    expect(res.body.systemRoles).toContain('teacher');
    expect(res.body.systemRoles).not.toContain('superadmin');
    expect(res.body.customRoles).toEqual([{ key: 'ks3_coordinator', label: 'KS3 Academic Coordinator' }]);
  });

  test('404s for a nonexistent school', async () => {
    mockSchoolDoc = null;
    const res = await supertest(app()).get('/api/platform/schools/sch_missing/roles');
    expect(res.status).toBe(404);
  });

  test('a different school never sees another school\'s custom roles', async () => {
    mockSchoolDoc = { id: 'sch_other', slug: 'other', name: 'Other School' };
    const res = await supertest(app()).get('/api/platform/schools/sch_other/roles');
    expect(res.status).toBe(200);
    expect(res.body.customRoles).toEqual([]);
  });
});

describe('POST /api/platform/schools/:id/superadmins/:userId/change-role', () => {
  test('moves an existing superadmin to a real system role, revokes their session, audits, and emails them', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({ role: 'principal' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('principal');

    const doc = mockUserDocs.find(u => u.id === 'u_collins');
    expect(doc.role).toBe('principal');
    expect(doc.roles).toEqual(['principal']);

    expect(mockRevokeUserTokens).toHaveBeenCalledWith('u_collins');
    expect(mockRevokeIdentityTokens).toHaveBeenCalledWith('idt_collins');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.user_role_changed' }));
    expect(mockSendRoleChanged).toHaveBeenCalledWith(expect.objectContaining({ oldRole: 'superadmin', newRole: 'principal' }));
  });

  test('accepts a real custom role belonging to this school', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({ role: 'ks3_coordinator' });
    expect(res.status).toBe(200);
    expect(mockUserDocs.find(u => u.id === 'u_collins').role).toBe('ks3_coordinator');
  });

  test('rejects a role that is neither a system role nor a custom role at this school', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({ role: 'made_up_role' });
    expect(res.status).toBe(400);
    expect(mockUserDocs.find(u => u.id === 'u_collins').role).toBe('superadmin');
  });

  test('refuses to set superadmin through this route — points at Promote instead', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({ role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Promote/);
  });

  test('409s when the target already has that exact role', async () => {
    mockUserDocs[0].role = 'teacher';
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({ role: 'teacher' });
    expect(res.status).toBe(409);
  });

  test('400s on missing role', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({});
    expect(res.status).toBe(400);
  });

  test('404s for a nonexistent school', async () => {
    mockSchoolDoc = null;
    const res = await supertest(app())
      .post('/api/platform/schools/sch_missing/superadmins/u_collins/change-role')
      .send({ role: 'principal' });
    expect(res.status).toBe(404);
  });

  test('404s for a user that does not exist at this school', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_ghost/change-role')
      .send({ role: 'principal' });
    expect(res.status).toBe(404);
  });

  test('a notification-email failure is non-fatal — the role change still applies', async () => {
    mockSendRoleChanged.mockRejectedValueOnce(new Error('smtp down'));
    const res = await supertest(app())
      .post('/api/platform/schools/sch_tis1/superadmins/u_collins/change-role')
      .send({ role: 'principal' });
    expect(res.status).toBe(200);
    expect(mockUserDocs.find(u => u.id === 'u_collins').role).toBe('principal');
  });
});
