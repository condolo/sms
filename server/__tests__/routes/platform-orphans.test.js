/* ============================================================
   DELETE /api/platform/orphans — unit tests with mocked DB.

   Regression coverage for a real production incident: this route
   used to delete a superadmin if EITHER their schoolId had no
   matching school OR their personal email didn't equal the school's
   adminEmail contact field. The email check was wrong — a school's
   adminEmail is a single contact address, not a registry of valid
   superadmin logins, so any superadmin onboarded after initial
   registration (a real, common case) had an email that never matched
   it and got deleted even though their schoolId pointed at a real,
   active school. This deleted a live client's superadmin accounts
   across two active schools and broke impersonation + org-login for
   them. Fixed: only a schoolId with no matching school is evidence
   of orphaning; email is no longer consulted at all.

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
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ updateOne: jest.fn(), find: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));
jest.mock('../../routes/auth', () => ({ _buildTokenPayload: jest.fn(), _availableSchools: jest.fn() }));

let mockSchoolDocs = [];
let mockUserDocs   = [];
let deletedFilter   = null;

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return { find: () => ({ lean: () => Promise.resolve(mockSchoolDocs) }) };
      }
      if (col === 'users') {
        return {
          find: () => ({ lean: () => Promise.resolve(mockUserDocs) }),
          deleteMany: jest.fn((filter) => { deletedFilter = filter; return Promise.resolve({}); }),
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

describe('DELETE /api/platform/orphans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deletedFilter = null;
    mockSchoolDocs = [
      { id: 'sch_trinity',  adminEmail: 'registration@old-contact.example' },
      { id: 'sch_trinitas', adminEmail: 'registration@old-contact.example' },
    ];
  });

  test('a superadmin whose schoolId matches a real school is NEVER purged, even if their email differs from school.adminEmail', async () => {
    mockUserDocs = [
      { _id: 'oid_1', id: 'usr_collins_trinity',  email: 'c.ndolo@mla.ac.ke', role: 'superadmin', schoolId: 'sch_trinity' },
      { _id: 'oid_2', id: 'usr_collins_trinitas', email: 'c.ndolo@mla.ac.ke', role: 'superadmin', schoolId: 'sch_trinitas' },
    ];
    const res = await supertest(app()).delete('/api/platform/orphans');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(deletedFilter).toBeNull();
  });

  test('a superadmin whose schoolId matches no existing school IS purged', async () => {
    mockUserDocs = [
      { _id: 'oid_3', id: 'usr_stale', email: 'admin@deleted-school.example', role: 'superadmin', schoolId: 'sch_deleted_long_ago' },
    ];
    const res = await supertest(app()).delete('/api/platform/orphans');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(deletedFilter._id.$in).toEqual(['oid_3']);
  });

  test('a superadmin with no schoolId at all is left alone (ambiguous, not treated as orphaned)', async () => {
    mockUserDocs = [
      { _id: 'oid_4', id: 'usr_no_school', email: 'someone@nowhere.example', role: 'superadmin' },
    ];
    const res = await supertest(app()).delete('/api/platform/orphans');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('mixed batch: only the genuinely schoolId-orphaned user is purged, valid ones survive', async () => {
    mockUserDocs = [
      { _id: 'oid_5', id: 'usr_valid',   email: 'newer.admin@client.example', role: 'superadmin', schoolId: 'sch_trinity' },
      { _id: 'oid_6', id: 'usr_orphan',  email: 'x@y.example',               role: 'superadmin', schoolId: 'sch_gone' },
    ];
    const res = await supertest(app()).delete('/api/platform/orphans');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(deletedFilter._id.$in).toEqual(['oid_6']);
  });
});
