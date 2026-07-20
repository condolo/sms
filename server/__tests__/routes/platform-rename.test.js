/* ============================================================
   Rename school / organization — unit tests with mocked DB.

   Covers PATCH /api/platform/schools/:id (name field) and the new
   PATCH /api/platform/organizations/:id. Both accept `name` only —
   `slug` is deliberately never accepted by either route (fixed at
   provisioning time, used in URLs and tenant resolution).

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

let mockSchoolDoc = { id: 'sch_1', _id: 'sch_1', name: 'Old School Name', slug: 'old-school', plan: 'family' };
let mockOrgDoc    = { id: 'org_1', name: 'Old Org Name', slug: 'old-org' };

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    isValidObjectId: () => false,
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return {
          findOneAndUpdate: (filter, update) => ({
            lean: () => {
              if (filter.id !== 'sch_1' && !(filter.$or && filter.$or.some(f => f.id === 'sch_1'))) return Promise.resolve(null);
              Object.assign(mockSchoolDoc, update.$set);
              return Promise.resolve({ ...mockSchoolDoc });
            },
          }),
        };
      }
      if (col === 'organizations') {
        return {
          findOneAndUpdate: (filter, update) => ({
            lean: () => {
              if (filter.id !== mockOrgDoc.id) return Promise.resolve(null);
              Object.assign(mockOrgDoc, update.$set);
              return Promise.resolve({ ...mockOrgDoc });
            },
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

beforeEach(() => {
  mockSchoolDoc = { id: 'sch_1', _id: 'sch_1', name: 'Old School Name', slug: 'old-school', plan: 'family' };
  mockOrgDoc    = { id: 'org_1', name: 'Old Org Name', slug: 'old-org' };
});

describe('PATCH /api/platform/schools/:id — rename', () => {
  test('updates name, leaves slug untouched', async () => {
    const res = await supertest(app()).patch('/api/platform/schools/sch_1').send({ name: 'New School Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New School Name');
    expect(res.body.slug).toBe('old-school');
  });

  test('slug in the request body is silently ignored, never applied', async () => {
    const res = await supertest(app()).patch('/api/platform/schools/sch_1').send({ name: 'New Name', slug: 'attempted-new-slug' });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('old-school');
  });

  test('400s on empty name', async () => {
    const res = await supertest(app()).patch('/api/platform/schools/sch_1').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('404s for unknown school', async () => {
    const res = await supertest(app()).patch('/api/platform/schools/does-not-exist').send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/platform/organizations/:id — rename', () => {
  test('updates name, leaves slug untouched', async () => {
    const res = await supertest(app()).patch('/api/platform/organizations/org_1').send({ name: 'New Org Name' });
    expect(res.status).toBe(200);
    expect(res.body.organization.name).toBe('New Org Name');
    expect(res.body.organization.slug).toBe('old-org');
  });

  test('slug in the request body is silently ignored, never applied', async () => {
    const res = await supertest(app()).patch('/api/platform/organizations/org_1').send({ name: 'New Name', slug: 'attempted-new-slug' });
    expect(res.status).toBe(200);
    expect(res.body.organization.slug).toBe('old-org');
  });

  test('400s on missing name', async () => {
    const res = await supertest(app()).patch('/api/platform/organizations/org_1').send({});
    expect(res.status).toBe(400);
  });

  test('404s for unknown organization', async () => {
    const res = await supertest(app()).patch('/api/platform/organizations/does-not-exist').send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});
