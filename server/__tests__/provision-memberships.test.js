/* ============================================================
   Unit tests — server/utils/provision-memberships.js  (Phase 1 · C7)

   Verifies the additive, idempotent, interruption-safe provisioning of a
   Membership per User:
     - creates a membership for a user missing one
     - keys the membership upsert on {userId, schoolId} (crash-safe, no dupes)
     - self-heals a missing school.organizationId via provisionOrganizationForSchool
     - skips users who already have a membership for that school
     - never throws on a malformed doc or DB error

   All DB calls are mocked — no MongoDB required.
   Run: npm test
   ============================================================ */

/* ── Mock cursor: an async-iterable over the given docs ─────── */
function makeCursor(docs) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const d of docs) yield d;
    },
  };
}

let userDocs = [];
let existingMemberships = [];
let schoolDocsById = {};

const mockUsersFind = jest.fn(() => ({ lean: () => ({ cursor: () => makeCursor(userDocs) }) }));
const mockMembershipsFind = jest.fn(() => ({
  select: () => ({ lean: () => Promise.resolve(existingMemberships) }),
}));
const mockMembershipsFindOneAndUpdate = jest.fn();
const mockSchoolsFindOne = jest.fn((filter) => ({
  lean: () => Promise.resolve(schoolDocsById[filter.id] || null),
}));
const mockOrgsFindOneAndUpdate = jest.fn();
const mockSchoolsUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') return { find: mockUsersFind };
    if (collection === 'schools') return { findOne: mockSchoolsFindOne, updateOne: mockSchoolsUpdateOne };
    if (collection === 'organizations') return { findOneAndUpdate: mockOrgsFindOneAndUpdate };
    if (collection === 'memberships') {
      return { find: mockMembershipsFind, findOneAndUpdate: mockMembershipsFindOneAndUpdate };
    }
    return {};
  }),
}));

const { provisionMemberships, provisionMembershipForUser } = require('../utils/provision-memberships');

beforeEach(() => {
  jest.clearAllMocks();
  userDocs = [];
  existingMemberships = [];
  schoolDocsById = {};

  mockMembershipsFindOneAndUpdate.mockImplementation((filter) => ({
    lean: jest.fn().mockResolvedValue({
      id: 'mem_generated_for_' + filter.userId,
      userId: filter.userId,
      schoolId: filter.schoolId,
    }),
  }));
  mockOrgsFindOneAndUpdate.mockImplementation((filter) => ({
    lean: jest.fn().mockResolvedValue({
      id: 'org_generated_for_' + filter.provisionedFromSchoolId,
      provisionedFromSchoolId: filter.provisionedFromSchoolId,
    }),
  }));
});

describe('provisionMemberships', () => {
  test('creates a membership for a user missing one', async () => {
    schoolDocsById['sch_demo'] = { _id: 'oid_1', id: 'sch_demo', name: 'Demo School', organizationId: 'org_demo' };
    userDocs = [
      { _id: 'uid_1', id: 'usr_1', schoolId: 'sch_demo', role: 'teacher' },
    ];

    const result = await provisionMemberships();

    expect(result).toEqual({ provisioned: 1 });
    expect(mockMembershipsFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = mockMembershipsFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: 'usr_1', schoolId: 'sch_demo' });
    expect(opts).toMatchObject({ upsert: true });
    expect(update.$setOnInsert).toMatchObject({
      orgId: 'org_demo',
      userId: 'usr_1',
      schoolId: 'sch_demo',
      role: 'teacher',
      isActive: true,
      status: 'active',
      isPrimary: true,
      source: 'user_backfill',
      createdBy: 'system:provision',
    });
    expect(update.$setOnInsert.id).toMatch(/^mem_/);
  });

  test('self-heals a missing school.organizationId via provisionOrganizationForSchool', async () => {
    schoolDocsById['sch_noorg'] = { _id: 'oid_2', id: 'sch_noorg', name: 'No Org School' };
    userDocs = [{ _id: 'uid_2', id: 'usr_2', schoolId: 'sch_noorg', role: 'admin' }];

    await provisionMemberships();

    expect(mockOrgsFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [orgFilter] = mockOrgsFindOneAndUpdate.mock.calls[0];
    expect(orgFilter).toEqual({ provisionedFromSchoolId: 'sch_noorg' });

    const [, update] = mockMembershipsFindOneAndUpdate.mock.calls[0];
    expect(update.$setOnInsert.orgId).toBe('org_generated_for_sch_noorg');
  });

  test('skips users who already have a membership for that school (idempotent)', async () => {
    existingMemberships = [{ userId: 'usr_1', schoolId: 'sch_demo' }];
    schoolDocsById['sch_demo'] = { _id: 'oid_1', id: 'sch_demo', name: 'Demo School', organizationId: 'org_demo' };
    userDocs = [{ _id: 'uid_1', id: 'usr_1', schoolId: 'sch_demo', role: 'teacher' }];

    const result = await provisionMemberships();

    expect(result).toEqual({ provisioned: 0 });
    expect(mockMembershipsFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('skips a user with no schoolId rather than crashing', async () => {
    userDocs = [{ _id: 'uid_orphan', id: 'usr_orphan' }];

    const result = await provisionMemberships();

    expect(result).toEqual({ provisioned: 0 });
    expect(mockMembershipsFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('processes multiple users, one membership each', async () => {
    schoolDocsById['sch_demo'] = { _id: 'oid_1', id: 'sch_demo', name: 'Demo School', organizationId: 'org_demo' };
    userDocs = [
      { _id: 'uid_a', id: 'usr_a', schoolId: 'sch_demo', role: 'teacher' },
      { _id: 'uid_b', id: 'usr_b', schoolId: 'sch_demo', role: 'admin' },
      { _id: 'uid_c', id: 'usr_c', schoolId: 'sch_demo', role: 'parent' },
    ];

    const result = await provisionMemberships();

    expect(result).toEqual({ provisioned: 3 });
    expect(mockMembershipsFindOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  test('never throws — a DB error resolves to a non-fatal result', async () => {
    mockUsersFind.mockImplementationOnce(() => { throw new Error('mongo down'); });

    const result = await provisionMemberships();

    expect(result).toMatchObject({ provisioned: 0, error: 'mongo down' });
  });
});

/* ── provisionMembershipForUser — the extracted single-user path, called
   immediately at grant time (platform.js's POST /memberships), not just at
   the next server restart. Uses dependency injection so these tests don't
   need the module-level _model mock above. */
describe('provisionMembershipForUser (immediate, single-user path)', () => {
  test('creates the membership, same shape as the batch path', async () => {
    const mockMemFindOneAndUpdate = jest.fn(() => ({
      lean: () => Promise.resolve({ id: 'mem_new', userId: 'usr_x', schoolId: 'sch_x' }),
    }));
    const Schools = { findOne: jest.fn(() => ({ lean: () => Promise.resolve({ _id: 'oid_x', id: 'sch_x', organizationId: 'org_x' }) })) };
    const Orgs = { findOneAndUpdate: jest.fn() };
    const Memberships = { findOneAndUpdate: mockMemFindOneAndUpdate };

    const user = { _id: 'uid_x', id: 'usr_x', schoolId: 'sch_x', role: 'teacher' };
    const membership = await provisionMembershipForUser(user, { Schools, Orgs, Memberships });

    expect(membership).toEqual({ id: 'mem_new', userId: 'usr_x', schoolId: 'sch_x' });
    const [filter, update, opts] = mockMemFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: 'usr_x', schoolId: 'sch_x' });
    expect(opts).toMatchObject({ upsert: true });
    expect(update.$setOnInsert).toMatchObject({ orgId: 'org_x', role: 'teacher' });
  });

  test('returns null for a malformed user with no id', async () => {
    const Schools = { findOne: jest.fn() };
    const Orgs = { findOneAndUpdate: jest.fn() };
    const Memberships = { findOneAndUpdate: jest.fn() };

    const membership = await provisionMembershipForUser({ schoolId: 'sch_x' }, { Schools, Orgs, Memberships });

    expect(membership).toBeNull();
    expect(Schools.findOne).not.toHaveBeenCalled();
  });

  test('returns null for a user with no schoolId', async () => {
    const Schools = { findOne: jest.fn() };
    const Orgs = { findOneAndUpdate: jest.fn() };
    const Memberships = { findOneAndUpdate: jest.fn() };

    const membership = await provisionMembershipForUser({ id: 'usr_y' }, { Schools, Orgs, Memberships });

    expect(membership).toBeNull();
    expect(Schools.findOne).not.toHaveBeenCalled();
  });

  test('returns null for a dangling schoolId with no matching school', async () => {
    const Schools = { findOne: jest.fn(() => ({ lean: () => Promise.resolve(null) })) };
    const Orgs = { findOneAndUpdate: jest.fn() };
    const Memberships = { findOneAndUpdate: jest.fn() };

    const membership = await provisionMembershipForUser({ id: 'usr_z', schoolId: 'sch_missing' }, { Schools, Orgs, Memberships });

    expect(membership).toBeNull();
    expect(Memberships.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('accepts opts to mark a platform-admin grant as non-primary', async () => {
    const mockMemFindOneAndUpdate = jest.fn(() => ({ lean: () => Promise.resolve({ id: 'mem_grant' }) }));
    const Schools = { findOne: jest.fn(() => ({ lean: () => Promise.resolve({ _id: 'oid_x', id: 'sch_x', organizationId: 'org_x' }) })) };
    const Orgs = { findOneAndUpdate: jest.fn() };
    const Memberships = { findOneAndUpdate: mockMemFindOneAndUpdate };

    await provisionMembershipForUser(
      { id: 'usr_x', schoolId: 'sch_x', role: 'teacher' },
      { Schools, Orgs, Memberships, opts: { isPrimary: false, source: 'platform_admin_grant', createdBy: 'platform:admin1' } }
    );

    const [, update] = mockMemFindOneAndUpdate.mock.calls[0];
    expect(update.$setOnInsert).toMatchObject({
      isPrimary: false,
      source: 'platform_admin_grant',
      createdBy: 'platform:admin1',
    });
  });
});
