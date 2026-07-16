/* ============================================================
   Unit tests — server/utils/provision-organizations.js  (Phase A · C1/C2)

   Verifies the additive, idempotent, interruption-safe provisioning of a
   1:1 Organization per School:
     - creates an org and sets school.organizationId for unprovisioned schools
     - keys the org upsert on provisionedFromSchoolId (crash-safe, no dupes)
     - writes the FK by _id (avoids custom-id vs _id ambiguity)
     - is a no-op when every school is already provisioned

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

let schoolDocs = [];
const mockSchoolsFind      = jest.fn(() => ({ lean: () => ({ cursor: () => makeCursor(schoolDocs) }) }));
const mockSchoolsUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const mockOrgsFindOneAndUpdate = jest.fn();

jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return { find: mockSchoolsFind, updateOne: mockSchoolsUpdateOne };
    }
    if (collection === 'organizations') {
      return { findOneAndUpdate: mockOrgsFindOneAndUpdate };
    }
    return {};
  }),
}));

const { provisionOrganizations } = require('../utils/provision-organizations');

beforeEach(() => {
  jest.clearAllMocks();
  schoolDocs = [];
  // Default: the org upsert echoes back a created org with a generated id.
  mockOrgsFindOneAndUpdate.mockImplementation((filter) => ({
    lean: jest.fn().mockResolvedValue({
      id: 'org_generated_for_' + filter.provisionedFromSchoolId,
      provisionedFromSchoolId: filter.provisionedFromSchoolId,
    }),
  }));
});

describe('provisionOrganizations', () => {
  test('creates a 1:1 org and sets organizationId for an unprovisioned school', async () => {
    schoolDocs = [
      { _id: 'oid_1', id: 'sch_demo_001', name: 'Demo School', slug: 'demo' },
    ];

    const result = await provisionOrganizations();

    expect(result).toEqual({ provisioned: 1 });

    // Org upsert keyed on provenance, with upsert:true
    expect(mockOrgsFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [orgFilter, orgUpdate, orgOpts] = mockOrgsFindOneAndUpdate.mock.calls[0];
    expect(orgFilter).toEqual({ provisionedFromSchoolId: 'sch_demo_001' });
    expect(orgOpts).toMatchObject({ upsert: true });
    expect(orgUpdate.$setOnInsert).toMatchObject({
      name: 'Demo School',
      slug: 'demo',
      status: 'active',
      multiSchoolEnabled: false,
      provisionedFromSchoolId: 'sch_demo_001',
      createdBy: 'system:provision',
    });
    expect(orgUpdate.$setOnInsert.id).toMatch(/^org_/);

    // FK written back on the school, filtered by _id
    expect(mockSchoolsUpdateOne).toHaveBeenCalledTimes(1);
    const [schoolFilter, schoolUpdate] = mockSchoolsUpdateOne.mock.calls[0];
    expect(schoolFilter).toEqual({ _id: 'oid_1' });
    expect(schoolUpdate).toEqual({ $set: { organizationId: 'org_generated_for_sch_demo_001' } });
  });

  test('only scans schools missing/null organizationId (idempotent filter)', async () => {
    schoolDocs = [];   // simulate: every school already provisioned
    const result = await provisionOrganizations();

    expect(result).toEqual({ provisioned: 0 });
    expect(mockOrgsFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockSchoolsUpdateOne).not.toHaveBeenCalled();

    // The scan filter must exclude already-provisioned schools
    const findFilter = mockSchoolsFind.mock.calls[0][0];
    expect(findFilter).toEqual({
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    });
  });

  test('falls back to _id string when a school has no custom id field', async () => {
    schoolDocs = [
      { _id: 'oid_legacy', name: 'Legacy School' },   // no `id`, no `slug`
    ];

    const result = await provisionOrganizations();

    expect(result).toEqual({ provisioned: 1 });
    const [orgFilter] = mockOrgsFindOneAndUpdate.mock.calls[0];
    expect(orgFilter).toEqual({ provisionedFromSchoolId: 'oid_legacy' });
    // name falls back gracefully; slug becomes null
    const orgUpdate = mockOrgsFindOneAndUpdate.mock.calls[0][1];
    expect(orgUpdate.$setOnInsert.name).toBe('Legacy School');
    expect(orgUpdate.$setOnInsert.slug).toBeNull();
  });

  test('processes multiple schools, one org each', async () => {
    schoolDocs = [
      { _id: 'oid_a', id: 'sch_a', name: 'A', slug: 'a' },
      { _id: 'oid_b', id: 'sch_b', name: 'B', slug: 'b' },
      { _id: 'oid_c', id: 'sch_c', name: 'C', slug: 'c' },
    ];

    const result = await provisionOrganizations();

    expect(result).toEqual({ provisioned: 3 });
    expect(mockOrgsFindOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(mockSchoolsUpdateOne).toHaveBeenCalledTimes(3);
  });

  test('never throws — a DB error resolves to a non-fatal result', async () => {
    schoolDocs = [{ _id: 'oid_1', id: 'sch_1', name: 'S', slug: 's' }];
    mockOrgsFindOneAndUpdate.mockImplementation(() => ({
      lean: jest.fn().mockRejectedValue(new Error('mongo down')),
    }));

    const result = await provisionOrganizations();

    expect(result).toMatchObject({ provisioned: 0, error: 'mongo down' });
  });
});
