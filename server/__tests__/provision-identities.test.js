/* ============================================================
   Unit tests — server/utils/provision-identities.js  (C8/MR-001 Phase 0)

   Verifies the additive, idempotent, interruption-safe provisioning of a
   credential-owning Identity per User, and — the crux of ADR-0003 — the
   never-auto-merge collision policy: two users sharing an email within the
   same organization only merge into one Identity when an existing
   Membership grant already vouches they're the same person; otherwise they
   are flagged collision_pending and keep authenticating exactly as today.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

function makeCursor(docs) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const d of docs) yield d;
    },
  };
}

let schoolDocs = [];
let userDocs = [];
let identityDocs = [];
let membershipDocs = [];
let identityUpsertCalls = [];

const mockSchoolsFindOne = jest.fn((filter) => ({
  lean: () => Promise.resolve(schoolDocs.find(s => s.id === filter.id) || null),
}));
const mockSchoolsFind = jest.fn((filter) => ({
  select: () => ({
    lean: () => Promise.resolve(schoolDocs.filter(s => s.organizationId === filter.organizationId)),
  }),
}));
const mockSchoolsUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

const mockOrgsFindOneAndUpdate = jest.fn(() => ({
  lean: () => Promise.resolve({ id: 'org_generated', provisionedFromSchoolId: 'sch_x' }),
}));

const mockUsersFind = jest.fn((filter) => {
  if (filter.schoolId && filter.schoolId.$in) {
    // Sibling-collision query
    return {
      select: () => ({
        lean: () => Promise.resolve(userDocs.filter(u =>
          filter.schoolId.$in.includes(u.schoolId) &&
          u._id !== filter._id.$ne &&
          typeof u.email === 'string'
        )),
      }),
    };
  }
  // Batch backfill cursor query
  return {
    lean: () => ({
      cursor: () => makeCursor(userDocs.filter(u => typeof u.email === 'string' && !u.identityId)),
    }),
  };
});
const mockUsersUpdateOne = jest.fn((filter, update) => {
  const u = userDocs.find(x => x._id === filter._id);
  if (u) Object.assign(u, update.$set);
  return Promise.resolve({ modifiedCount: u ? 1 : 0 });
});
const mockUsersUpdateMany = jest.fn((filter, update) => {
  userDocs.filter(u => filter.id.$in.includes(u.id)).forEach(u => Object.assign(u, update.$set));
  return Promise.resolve({ modifiedCount: filter.id.$in.length });
});

function matchesIdentityFilter(doc, filter) {
  return Object.entries(filter).every(([k, v]) => doc[k] === v);
}
const mockIdentitiesFindOne = jest.fn((filter) => ({
  lean: () => Promise.resolve(identityDocs.find(i => i.id === filter.id) || null),
}));
const mockIdentitiesFindOneAndUpdate = jest.fn((filter, update) => ({
  lean: () => {
    identityUpsertCalls.push({ filter, update });
    let doc = identityDocs.find(i => matchesIdentityFilter(i, filter));
    if (!doc) {
      doc = { ...update.$setOnInsert };
      identityDocs.push(doc);
    }
    if (update.$set) Object.assign(doc, update.$set);
    if (update.$addToSet) {
      Object.entries(update.$addToSet).forEach(([k, v]) => {
        const arr = doc[k] || (doc[k] = []);
        const vals = v.$each || [v];
        vals.forEach(val => { if (!arr.includes(val)) arr.push(val); });
      });
    }
    return Promise.resolve({ ...doc });
  },
}));

const mockMembershipsFindOne = jest.fn((filter) => ({
  lean: () => {
    const clauses = filter.$or || [filter];
    const found = membershipDocs.find(m => clauses.some(c => Object.entries(c).every(([k, v]) => m[k] === v)));
    return Promise.resolve(found || null);
  },
}));

jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return { findOne: mockSchoolsFindOne, find: mockSchoolsFind, updateOne: mockSchoolsUpdateOne };
    if (collection === 'organizations') return { findOneAndUpdate: mockOrgsFindOneAndUpdate };
    if (collection === 'users') return { find: mockUsersFind, updateOne: mockUsersUpdateOne, updateMany: mockUsersUpdateMany };
    if (collection === 'identities') return { findOne: mockIdentitiesFindOne, findOneAndUpdate: mockIdentitiesFindOneAndUpdate };
    if (collection === 'memberships') return { findOne: mockMembershipsFindOne };
    return {};
  }),
}));

const { provisionIdentities, provisionIdentityForUser } = require('../utils/provision-identities');

beforeEach(() => {
  jest.clearAllMocks();
  schoolDocs = [{ id: 'sch_a', organizationId: 'org_x' }, { id: 'sch_b', organizationId: 'org_x' }, { id: 'sch_c', organizationId: 'org_y' }];
  userDocs = [];
  identityDocs = [];
  membershipDocs = [];
  identityUpsertCalls = [];
});

describe('provisionIdentityForUser', () => {
  test('creates a fresh Identity when there is no email collision', async () => {
    const user = { _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'Jane@Example.com', password: '$2hash' };
    const identity = await provisionIdentityForUser(user);

    expect(identity).toMatchObject({ orgId: 'org_x', email: 'jane@example.com', status: 'active', sourceUserIds: ['usr_1'] });
    expect(identity.id).toMatch(/^idt_/);
    const [, updateArg] = mockUsersUpdateOne.mock.calls[0];
    expect(updateArg).toEqual({ $set: { identityId: identity.id } });
  });

  test('mfaEnabled preserves tri-state — "never set" stays null, not coerced to false (MFA bypass regression)', async () => {
    // Found live (real-DB production validation, not a mock): every MFA
    // check in auth.js reads `mfaEnabled !== false` — "on unless explicitly
    // opted out." The old `!!user.mfaEnabled` coercion turned "never set"
    // into an explicit false, silently opting every identity-linked
    // MFA_ROLES user (superadmin/admin/deputy/principal/finance) OUT of MFA
    // the moment their identity resolves — which happens on every
    // org-login call, and on every /login call once cutover is live.
    const neverSet = await provisionIdentityForUser({ _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'a@x.com', password: '$2hash' });
    expect(neverSet.mfaEnabled).toBeNull();

    const explicitTrue = await provisionIdentityForUser({ _id: 'oid_2', id: 'usr_2', schoolId: 'sch_a', email: 'b@x.com', password: '$2hash', mfaEnabled: true });
    expect(explicitTrue.mfaEnabled).toBe(true);

    const explicitFalse = await provisionIdentityForUser({ _id: 'oid_3', id: 'usr_3', schoolId: 'sch_a', email: 'c@x.com', password: '$2hash', mfaEnabled: false });
    expect(explicitFalse.mfaEnabled).toBe(false);
  });

  test('returns null for a user with no email (student/username-only account)', async () => {
    const identity = await provisionIdentityForUser({ _id: 'oid_2', id: 'usr_2', schoolId: 'sch_a' });
    expect(identity).toBeNull();
    expect(mockSchoolsFindOne).not.toHaveBeenCalled();
  });

  test('returns null for a malformed doc with no id/schoolId', async () => {
    const identity = await provisionIdentityForUser({ email: 'x@x.com' });
    expect(identity).toBeNull();
  });

  test('returns null for a dangling schoolId with no matching school', async () => {
    const identity = await provisionIdentityForUser({ _id: 'oid_3', id: 'usr_3', schoolId: 'sch_missing', email: 'x@x.com' });
    expect(identity).toBeNull();
  });

  test('is idempotent — a user that already has identityId returns the existing identity, no new writes', async () => {
    identityDocs = [{ id: 'idt_existing', orgId: 'org_x', email: 'jane@example.com', status: 'active', sourceUserIds: ['usr_1'] }];
    const user = { _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'jane@example.com', identityId: 'idt_existing' };

    const identity = await provisionIdentityForUser(user);

    expect(identity.id).toBe('idt_existing');
    expect(mockIdentitiesFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('refreshes passwordHash on a stale ORPHANED identity — no live sibling means this user now owns it (regression: 2026-07-21 orphan-purge incident)', async () => {
    // The identity doc survives from a PREVIOUSLY DELETED user (e.g. purged
    // by DELETE /api/platform/orphans, which only ever touched `users`,
    // never `identities`) — it still holds that old, now-meaningless
    // password hash. A brand new user is created with the SAME email in the
    // SAME org (e.g. via "Add Superadmin") and has no live sibling sharing
    // that email, so they are the sole rightful owner of the identity going
    // forward. The stale hash must be replaced, not preserved — otherwise
    // org-login (which checks identities.passwordHash exclusively) rejects
    // the new user's correct, freshly-generated password.
    identityDocs = [{
      id: 'idt_stale', orgId: 'org_x', email: 'collins@example.com', status: 'active',
      passwordHash: '$2boldOLDhash', mfaEnabled: false, tokenVersion: 0,
      sourceUserIds: ['usr_deleted_long_ago'], createdAt: '2020-01-01',
    }];
    const newUser = { _id: 'oid_new', id: 'usr_recreated', schoolId: 'sch_a', email: 'collins@example.com', password: '$2newFRESHhash' };

    const identity = await provisionIdentityForUser(newUser);

    expect(identity.id).toBe('idt_stale'); // matched the existing doc, not a fresh insert
    expect(identity.passwordHash).toBe('$2newFRESHhash'); // refreshed, not left stale
    expect(identity.sourceUserIds).toEqual(expect.arrayContaining(['usr_deleted_long_ago', 'usr_recreated']));
  });

  test('self-heals a missing school.organizationId via provisionOrganizationForSchool', async () => {
    schoolDocs.push({ id: 'sch_noorg', _id: 'oid_school_noorg' });
    const user = { _id: 'oid_4', id: 'usr_4', schoolId: 'sch_noorg', email: 'noorg@example.com' };

    const identity = await provisionIdentityForUser(user);

    expect(mockOrgsFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(identity.orgId).toBe('org_generated');
  });

  test('merges into ONE Identity when a Membership grant already vouches the two users are the same person', async () => {
    userDocs = [
      { _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'jane@example.com' },
      { _id: 'oid_2', id: 'usr_2', schoolId: 'sch_b', email: 'jane@example.com' },
    ];
    // The shipped Link Identity flow already linked usr_1 to sch_b.
    membershipDocs = [{ userId: 'usr_1', schoolId: 'sch_b' }];

    const identity = await provisionIdentityForUser(userDocs[0]);

    expect(identity.status).toBe('active');
    expect(identity.sourceUserIds.sort()).toEqual(['usr_1', 'usr_2']);
    // Both accounts point at the same identity.
    const [, updateArg] = mockUsersUpdateMany.mock.calls[0];
    expect(updateArg).toEqual({ $set: { identityId: identity.id } });
  });

  test('flags collision_pending — never auto-merges — when no Membership grant vouches sameness', async () => {
    userDocs = [
      { _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'admin@gmail.com' },
      { _id: 'oid_2', id: 'usr_2', schoolId: 'sch_b', email: 'admin@gmail.com' },
    ];
    // No membership links these two — genuinely unrelated people who both used a generic email.

    const identity = await provisionIdentityForUser(userDocs[0]);

    expect(identity.status).toBe('collision_pending');
    expect(identity.email).toBeNull();
    expect(identity.collisionKey).toBe('org_x::admin@gmail.com');
    // Neither account's identityId gets set — both keep authenticating as today.
    expect(mockUsersUpdateOne).not.toHaveBeenCalled();
    expect(mockUsersUpdateMany).not.toHaveBeenCalled();
  });

  test('collision detection is scoped to the same organization — different orgs never collide', async () => {
    userDocs = [
      { _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'shared@example.com' },   // org_x
      { _id: 'oid_5', id: 'usr_5', schoolId: 'sch_c', email: 'shared@example.com' },   // org_y — different org
    ];

    const identity = await provisionIdentityForUser(userDocs[0]);

    expect(identity.status).toBe('active');   // no collision — sch_c is a different org, not a sibling
    expect(identity.sourceUserIds).toEqual(['usr_1']);
  });
});

describe('provisionIdentities (batch backfill)', () => {
  test('processes every email-bearing user missing an identityId', async () => {
    userDocs = [
      { _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'a@example.com' },
      { _id: 'oid_2', id: 'usr_2', schoolId: 'sch_a', email: 'b@example.com' },
      { _id: 'oid_3', id: 'usr_3', schoolId: 'sch_a' },   // no email — skipped
    ];

    const result = await provisionIdentities();

    expect(result).toEqual({ provisioned: 2 });
  });

  test('skips users that already have an identityId', async () => {
    userDocs = [{ _id: 'oid_1', id: 'usr_1', schoolId: 'sch_a', email: 'a@example.com', identityId: 'idt_x' }];
    // mockUsersFind's batch-cursor branch already filters on !u.identityId, mirroring the real
    // Mongo query's `identityId: { $exists: false }` filter.

    const result = await provisionIdentities();

    expect(result).toEqual({ provisioned: 0 });
  });

  test('never throws — a DB error resolves to a non-fatal result', async () => {
    mockUsersFind.mockImplementationOnce(() => { throw new Error('mongo down'); });

    const result = await provisionIdentities();

    expect(result).toMatchObject({ provisioned: 0, error: 'mongo down' });
  });
});
