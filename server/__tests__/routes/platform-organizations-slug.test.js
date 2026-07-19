/* ============================================================
   Organization Shared URL Slug — Phase 0 + Phase 1 unit tests.

   Covers, all with a mocked DB (no MongoDB required):
     - the cross-collection slug-collision checks added to
       POST /api/platform/schools and POST /api/platform/organizations
       (closes the silent-orphan hazard described in indexes.js's
       schools_slug comment — see docs/adr/ADR-0007 context)
     - the two-flag activation toggles (multiSchoolEnabled,
       orgSlugLoginEnabled), including the enable-org-slug-login
       precondition and the disable-multi-school cascade

   ADR-0007's actual credential-check flow (org-login,
   complete-org-login) is NOT covered here — it doesn't exist yet;
   this file only covers Phase 0/Phase 1's additive, inert changes.
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
  tenantModel: jest.fn(() => ({
    updateOne: jest.fn().mockResolvedValue({}),
    find:      () => ({ lean: () => Promise.resolve([]) }),
  })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed_pw') }));
jest.mock('../../routes/qa-health', () => ({
  _identityMigrationStatus: jest.fn().mockResolvedValue({ status: 'complete', identityBackfillPending: 0, collisionPending: 0 }),
}));

let mockOrgDocs = [];
let mockSchoolDocs = [];
const mockOrgUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const mockInsertOne = jest.fn().mockResolvedValue({ insertedId: 'oid_new' });

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    connection: { db: { collection: jest.fn(() => ({ insertOne: mockInsertOne })) } },
    model: jest.fn((_name, _schema, col) => {
      if (col === 'organizations') {
        return {
          find:    () => ({ sort: () => ({ lean: () => Promise.resolve(mockOrgDocs) }) }),
          findOne: (filter) => ({
            lean: () => {
              let matches = mockOrgDocs;
              if (filter.slug !== undefined) matches = matches.filter(o => o.slug === filter.slug);
              if (filter.id !== undefined) {
                matches = (filter.id && filter.id.$ne !== undefined)
                  ? matches.filter(o => o.id !== filter.id.$ne)
                  : matches.filter(o => o.id === filter.id);
              }
              return Promise.resolve(matches[0] || null);
            },
          }),
          create:    jest.fn((doc) => { mockOrgDocs.push(doc); return Promise.resolve(doc); }),
          updateOne: mockOrgUpdateOne,
        };
      }
      if (col === 'schools') {
        return {
          findOne: (filter) => ({ lean: () => Promise.resolve(mockSchoolDocs.find(s => s.slug === filter.slug) || null) }),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockOrgDocs = [];
  mockSchoolDocs = [];
});

describe('POST /api/platform/organizations — cross-collection slug collision', () => {
  test('409s when the slug is already taken by a school', async () => {
    mockSchoolDocs = [{ id: 'sch_a', slug: 'green-valley' }];

    const res = await supertest(app())
      .post('/api/platform/organizations')
      .send({ name: 'Green Valley', slug: 'green-valley' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken by a school/i);
    expect(mockOrgDocs).toHaveLength(0);
  });

  test('succeeds when the slug is free in both collections', async () => {
    const res = await supertest(app())
      .post('/api/platform/organizations')
      .send({ name: 'Fresh Org', slug: 'fresh-org' });

    expect(res.status).toBe(201);
    expect(res.body.organization).toMatchObject({ slug: 'fresh-org', orgSlugLoginEnabled: false });
  });
});

describe('POST /api/platform/schools — cross-collection slug collision', () => {
  test('409s when the derived slug is already taken by an unrelated organization', async () => {
    mockOrgDocs = [{ id: 'org_existing', slug: 'eldoret' }];

    const res = await supertest(app())
      .post('/api/platform/schools')
      .send({ name: 'Eldoret Campus', slug: 'eldoret', adminEmail: 'a@b.com', adminPassword: 'secret123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken by an organization/i);
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  test('succeeds and provisions a 1:1 org when the slug is free in both collections', async () => {
    const res = await supertest(app())
      .post('/api/platform/schools')
      .send({ name: 'Fresh Campus', slug: 'fresh-campus', adminEmail: 'a@b.com', adminPassword: 'secret123' });

    expect(res.status).toBe(201);
    expect(mockInsertOne).toHaveBeenCalled();
  });
});

describe('POST /api/platform/organizations/:id/enable-multi-school', () => {
  beforeEach(() => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: false, orgSlugLoginEnabled: false }];
  });

  test('404s for an unknown organization', async () => {
    const res = await supertest(app()).post('/api/platform/organizations/org_ghost/enable-multi-school');
    expect(res.status).toBe(404);
  });

  test('sets multiSchoolEnabled true, audit-logs, and warns the note does not also open org-slug login', async () => {
    const AuditService = require('../../services/audit');
    const res = await supertest(app()).post('/api/platform/organizations/org_a/enable-multi-school');

    expect(res.status).toBe(200);
    expect(res.body.organization.multiSchoolEnabled).toBe(true);
    expect(res.body.note).toMatch(/orgSlugLoginEnabled/);
    expect(mockOrgUpdateOne).toHaveBeenCalledWith(
      { id: 'org_a' },
      expect.objectContaining({ $set: expect.objectContaining({ multiSchoolEnabled: true }) })
    );
    expect(AuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform.organization.multi_school_enabled', target: expect.objectContaining({ id: 'org_a' }) })
    );
  });
});

describe('POST /api/platform/organizations/:id/disable-multi-school', () => {
  test('cascades orgSlugLoginEnabled to false and records the cascade in the audit log', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: true, orgSlugLoginEnabled: true }];
    const AuditService = require('../../services/audit');

    const res = await supertest(app()).post('/api/platform/organizations/org_a/disable-multi-school');

    expect(res.status).toBe(200);
    expect(res.body.organization.multiSchoolEnabled).toBe(false);
    expect(res.body.organization.orgSlugLoginEnabled).toBe(false);
    expect(mockOrgUpdateOne).toHaveBeenCalledWith(
      { id: 'org_a' },
      expect.objectContaining({ $set: expect.objectContaining({ multiSchoolEnabled: false, orgSlugLoginEnabled: false }) })
    );
    expect(AuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ details: { cascadedOrgSlugLoginDisable: true } })
    );
  });

  test('does not falsely report a cascade when orgSlugLoginEnabled was already false', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: true, orgSlugLoginEnabled: false }];
    const AuditService = require('../../services/audit');

    await supertest(app()).post('/api/platform/organizations/org_a/disable-multi-school');

    expect(AuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ details: { cascadedOrgSlugLoginDisable: false } })
    );
  });
});

describe('POST /api/platform/organizations/:id/enable-org-slug-login', () => {
  test('409s when multiSchoolEnabled is not already true — the hard precondition', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: false, orgSlugLoginEnabled: false }];

    const res = await supertest(app()).post('/api/platform/organizations/org_a/enable-org-slug-login');

    expect(res.status).toBe(409);
    expect(mockOrgUpdateOne).not.toHaveBeenCalled();
  });

  test('succeeds when multiSchoolEnabled is true, and surfaces identity-migration readiness for visibility only', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: true, orgSlugLoginEnabled: false }];

    const res = await supertest(app()).post('/api/platform/organizations/org_a/enable-org-slug-login');

    expect(res.status).toBe(200);
    expect(res.body.organization.orgSlugLoginEnabled).toBe(true);
    expect(res.body.identityMigration).toEqual({ status: 'complete', identityBackfillPending: 0, collisionPending: 0 });
    expect(res.body.note).toMatch(/IDENTITY_CUTOVER_ENABLED/);
  });

  test('a failure reading identity-migration status does not block the toggle (informational only)', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: true, orgSlugLoginEnabled: false }];
    const qaHealth = require('../../routes/qa-health');
    qaHealth._identityMigrationStatus.mockRejectedValueOnce(new Error('boom'));

    const res = await supertest(app()).post('/api/platform/organizations/org_a/enable-org-slug-login');

    expect(res.status).toBe(200);
    expect(res.body.organization.orgSlugLoginEnabled).toBe(true);
    expect(res.body.identityMigration).toBeNull();
  });
});

describe('POST /api/platform/organizations/:id/disable-org-slug-login', () => {
  test('sets orgSlugLoginEnabled false regardless of multiSchoolEnabled state', async () => {
    mockOrgDocs = [{ id: 'org_a', name: 'Org A', slug: 'org-a', multiSchoolEnabled: true, orgSlugLoginEnabled: true }];

    const res = await supertest(app()).post('/api/platform/organizations/org_a/disable-org-slug-login');

    expect(res.status).toBe(200);
    expect(res.body.organization.orgSlugLoginEnabled).toBe(false);
    expect(res.body.organization.multiSchoolEnabled).toBe(true); // untouched
  });
});
