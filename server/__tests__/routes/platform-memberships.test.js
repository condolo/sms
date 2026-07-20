/* ============================================================
   GET /api/platform/users/search + POST /api/platform/memberships
   — unit tests with mocked DB.

   Verifies the platform-admin "Link Identity" API: cross-school email
   search (credentials/MFA stripped), and granting an existing user
   access to a second school — restricted to the SAME organization
   (Constitution §6), and never touches auth.js/JWT/rbac directly.

   Also covers a real gap found via a direct report: C8/MR-001's
   collision-to-merge check (provisionIdentityForUser) only re-scanned on
   the next server boot, so a fresh Link Identity grant sat unvouched
   until the next restart — the C9 School Switcher would silently show
   nothing even though the admin had just vouched two accounts were the
   same person. POST /memberships now re-runs that same idempotent check
   inline, so an already-eligible merge (a sibling account, same email,
   in the same org) happens immediately instead of waiting for a restart.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn() }));
jest.mock('../../utils/email', () => ({}));

let mockUserDocs = [];
let mockSchoolDocs = [];
let mockMembershipDocs = [];
let mockMembershipCreateCalls = [];
let mockIdentityDocs = [];
const mockUsersUpdateOne  = jest.fn(() => Promise.resolve({}));
const mockUsersUpdateMany = jest.fn((filter, update) => {
  const ids = filter.id?.$in || [];
  mockUserDocs.forEach(u => { if (ids.includes(u.id)) Object.assign(u, update.$set); });
  return Promise.resolve({});
});

// platform.js defines its OWN local _model(col) — a lazy schema-less
// mongoose.model() factory, not the shared utils/model._model — so the
// mock has to intercept mongoose.model() itself, keyed on the collection
// name (3rd arg), same pattern as platform-organizations.test.js.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    model: jest.fn((_name, _schema, col) => {
      if (col === 'users') {
        return {
          find: (filter) => ({
            limit: () => ({
              lean: () => Promise.resolve(mockUserDocs.filter(u => !filter.email || filter.email.test(u.email))),
            }),
            // provisionIdentityForUser's sibling-lookup: same org's schools, excluding self
            select: () => ({
              lean: () => Promise.resolve(
                mockUserDocs.filter(u => (filter.schoolId?.$in || []).includes(u.schoolId) && u._id !== filter._id?.$ne)
              ),
            }),
          }),
          findOne: (filter) => ({ lean: () => Promise.resolve(mockUserDocs.find(u => u.id === filter.id) || null) }),
          updateOne:  mockUsersUpdateOne,
          updateMany: mockUsersUpdateMany,
        };
      }
      if (col === 'schools') {
        return {
          find: (filter) => ({
            select: () => ({
              lean: () => Promise.resolve(
                filter.organizationId
                  ? mockSchoolDocs.filter(s => s.organizationId === filter.organizationId)
                  : mockSchoolDocs.filter(s => (filter.id?.$in || []).includes(s.id))
              ),
            }),
          }),
          findOne: (filter) => ({ lean: () => Promise.resolve(mockSchoolDocs.find(s => s.id === filter.id) || null) }),
        };
      }
      if (col === 'organizations') {
        return { findOneAndUpdate: jest.fn() };
      }
      if (col === 'identities') {
        return {
          findOneAndUpdate: jest.fn((filter, update) => ({
            lean: () => {
              let doc = mockIdentityDocs.find(d =>
                (filter.id && d.id === filter.id) ||
                (filter.orgId && filter.email && d.orgId === filter.orgId && d.email === filter.email) ||
                (filter.collisionKey && d.collisionKey === filter.collisionKey)
              );
              if (!doc) {
                doc = { ...update.$setOnInsert };
                mockIdentityDocs.push(doc);
              }
              Object.assign(doc, update.$set);
              if (update.$addToSet?.sourceUserIds) {
                const toAdd = update.$addToSet.sourceUserIds.$each || [update.$addToSet.sourceUserIds];
                doc.sourceUserIds = [...new Set([...(doc.sourceUserIds || []), ...toAdd])];
              }
              return Promise.resolve(doc);
            },
          })),
        };
      }
      if (col === 'memberships') {
        return {
          find: (filter) => ({
            lean: () => Promise.resolve(mockMembershipDocs.filter(m =>
              (filter.$or || []).some(c => m.userId === c.userId && m.schoolId === c.schoolId)
            )),
          }),
          findOne: (filter) => ({
            lean: () => {
              const clauses = filter.$or || [filter];
              const doc = mockMembershipDocs.find(m =>
                clauses.some(c => m.userId === c.userId && m.schoolId === c.schoolId)
              );
              return Promise.resolve(doc || null);
            },
          }),
          findOneAndUpdate: jest.fn((filter, update) => ({
            lean: () => {
              mockMembershipCreateCalls.push({ filter, update });
              const doc = { id: `mem_${filter.userId}_${filter.schoolId}`, ...update.$setOnInsert, ...update.$set };
              mockMembershipDocs.push({ userId: filter.userId, schoolId: filter.schoolId });
              return Promise.resolve(doc);
            },
          })),
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
  mockUserDocs = [];
  mockSchoolDocs = [];
  mockMembershipDocs = [];
  mockMembershipCreateCalls = [];
  mockIdentityDocs = [];
});

describe('GET /api/platform/users/search', () => {
  test('finds a user by partial email and strips credentials/MFA fields', async () => {
    mockSchoolDocs = [{ id: 'sch_a', name: 'Campus A', organizationId: 'org_x' }];
    mockUserDocs = [
      {
        _id: 'oid_1', id: 'usr_1', email: 'jane@greenvalley.ac.ke', role: 'teacher', schoolId: 'sch_a',
        password: 'HASH', mfaOtp: '123456', mfaExpiry: '2026-01-01', tokenVersion: 3,
      },
    ];

    const res = await supertest(app()).get('/api/platform/users/search?email=jane');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    const u = res.body.users[0];
    expect(u).toMatchObject({ id: 'usr_1', email: 'jane@greenvalley.ac.ke', schoolName: 'Campus A', organizationId: 'org_x' });
    expect(u.password).toBeUndefined();
    expect(u.mfaOtp).toBeUndefined();
    expect(u.mfaExpiry).toBeUndefined();
    expect(u.tokenVersion).toBeUndefined();
  });

  test('rejects a query shorter than 3 characters', async () => {
    const res = await supertest(app()).get('/api/platform/users/search?email=ja');
    expect(res.status).toBe(400);
  });

  test('rejects a missing email query', async () => {
    const res = await supertest(app()).get('/api/platform/users/search');
    expect(res.status).toBe(400);
  });

  test('returns an empty list, not an error, when nothing matches', async () => {
    mockUserDocs = [];
    const res = await supertest(app()).get('/api/platform/users/search?email=nobody');
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  test('a user with no schoolId returns null school context, not a crash', async () => {
    mockUserDocs = [{ _id: 'oid_2', id: 'usr_2', email: 'orphan@x.com', role: 'platform' }];
    const res = await supertest(app()).get('/api/platform/users/search?email=orphan');
    expect(res.status).toBe(200);
    expect(res.body.users[0].schoolName).toBeNull();
    expect(res.body.users[0].organizationId).toBeNull();
  });
});

describe('POST /api/platform/memberships', () => {
  beforeEach(() => {
    mockSchoolDocs = [
      { id: 'sch_a', name: 'Campus A', organizationId: 'org_x' },
      { id: 'sch_b', name: 'Campus B', organizationId: 'org_x' },
      { id: 'sch_c', name: 'Campus C (other org)', organizationId: 'org_y' },
    ];
    mockUserDocs = [
      { _id: 'oid_1', id: 'usr_1', email: 'jane@greenvalley.ac.ke', role: 'teacher', schoolId: 'sch_a' },
    ];
  });

  test('grants a membership for a second school in the SAME organization', async () => {
    const res = await supertest(app())
      .post('/api/platform/memberships')
      .send({ userId: 'usr_1', schoolId: 'sch_b' });

    expect(res.status).toBe(201);
    expect(res.body.membership).toMatchObject({ userId: 'usr_1', schoolId: 'sch_b', orgId: 'org_x' });
    expect(res.body.note).toMatch(/does not yet enable/i);
    expect(mockMembershipCreateCalls).toHaveLength(1);
    expect(mockMembershipCreateCalls[0].update.$setOnInsert).toMatchObject({
      isPrimary: false,
      source: 'platform_admin_grant',
    });
  });

  test('rejects missing userId or schoolId', async () => {
    const res = await supertest(app()).post('/api/platform/memberships').send({ userId: 'usr_1' });
    expect(res.status).toBe(400);
  });

  test('404s when the user does not exist', async () => {
    const res = await supertest(app())
      .post('/api/platform/memberships')
      .send({ userId: 'usr_ghost', schoolId: 'sch_b' });
    expect(res.status).toBe(404);
  });

  test('404s when the target school does not exist', async () => {
    const res = await supertest(app())
      .post('/api/platform/memberships')
      .send({ userId: 'usr_1', schoolId: 'sch_ghost' });
    expect(res.status).toBe(404);
  });

  test('409s on cross-organization linking rather than allowing it', async () => {
    const res = await supertest(app())
      .post('/api/platform/memberships')
      .send({ userId: 'usr_1', schoolId: 'sch_c' });

    expect(res.status).toBe(409);
    expect(mockMembershipCreateCalls).toHaveLength(0);
  });

  test('409s on a duplicate membership rather than creating a second one', async () => {
    mockMembershipDocs = [{ userId: 'usr_1', schoolId: 'sch_b' }];

    const res = await supertest(app())
      .post('/api/platform/memberships')
      .send({ userId: 'usr_1', schoolId: 'sch_b' });

    expect(res.status).toBe(409);
    expect(mockMembershipCreateCalls).toHaveLength(0);
  });

  test('with no sibling account at the target school, no identity is merged (nothing to merge with)', async () => {
    await supertest(app()).post('/api/platform/memberships').send({ userId: 'usr_1', schoolId: 'sch_b' });
    expect(mockUsersUpdateMany).not.toHaveBeenCalled();
  });

  test('regression: an already-eligible sibling account is merged immediately, not deferred to next server boot', async () => {
    // usr_2 already exists at sch_b, same email as usr_1 — the exact
    // "same person, two independently-created accounts" scenario Link
    // Identity exists for. Before this fix, granting the membership alone
    // did nothing to users.identityId until the next server restart's
    // provisionIdentities() backfill re-scanned and found the new
    // membership link — the School Switcher would show nothing until then.
    mockUserDocs.push({ _id: 'oid_2', id: 'usr_2', email: 'jane@greenvalley.ac.ke', role: 'teacher', schoolId: 'sch_b' });

    const res = await supertest(app()).post('/api/platform/memberships').send({ userId: 'usr_1', schoolId: 'sch_b' });

    expect(res.status).toBe(201);
    expect(mockUsersUpdateMany).toHaveBeenCalledWith(
      { id: { $in: expect.arrayContaining(['usr_1', 'usr_2']) } },
      { $set: { identityId: expect.stringMatching(/^idt_/) } },
    );
    const usr1 = mockUserDocs.find(u => u.id === 'usr_1');
    const usr2 = mockUserDocs.find(u => u.id === 'usr_2');
    expect(usr1.identityId).toBeDefined();
    expect(usr1.identityId).toBe(usr2.identityId); // same shared identity — this is what makes the switcher work
  });

  test('a failure in the identity-merge step does not fail the membership grant itself', async () => {
    // Simulate the merge step throwing (e.g. a transient DB error) —
    // the membership grant, which already succeeded, must still return
    // 201; the merge just self-heals at the next server restart instead.
    mockUserDocs.push({ _id: 'oid_2', id: 'usr_2', email: 'jane@greenvalley.ac.ke', role: 'teacher', schoolId: 'sch_b' });
    mockUsersUpdateMany.mockImplementationOnce(() => Promise.reject(new Error('boom')));

    const res = await supertest(app()).post('/api/platform/memberships').send({ userId: 'usr_1', schoolId: 'sch_b' });
    expect(res.status).toBe(201);
  });
});
