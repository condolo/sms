/* ============================================================
   Unit tests — server/utils/tenant-model.js  (C4 · ADR-0001)

   Verifies the structural tenant-enforcement wrapper:
     - force-injects schoolId into filters / docs / pipelines / bulk ops
     - rejects conflicting schoolId (filter, doc, update tenant-hop, aggregate)
     - fails CLOSED when no tenant context
     - refuses platform-level collections
     - preserves query chaining by delegating to the real model
     - tenantContext() derives {schoolId} or null from the JWT

   All DB calls are mocked — no MongoDB required.
   Run: npm test
   ============================================================ */

/* Capture the last filter/doc/pipeline each model method received. */
const calls = {};
function recorder(name) {
  return jest.fn((...args) => { calls[name] = args; return `${name}:result`; });
}

const mockModel = {
  find:             recorder('find'),
  findOne:          recorder('findOne'),
  countDocuments:   recorder('countDocuments'),
  exists:           recorder('exists'),
  distinct:         recorder('distinct'),
  deleteOne:        recorder('deleteOne'),
  deleteMany:       recorder('deleteMany'),
  updateOne:        recorder('updateOne'),
  updateMany:       recorder('updateMany'),
  findOneAndUpdate: recorder('findOneAndUpdate'),
  findOneAndDelete: recorder('findOneAndDelete'),
  create:           recorder('create'),
  aggregate:        recorder('aggregate'),
  bulkWrite:        recorder('bulkWrite'),
};

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => mockModel),
}));

const { tenantModel, tenantContext, PLATFORM_COLLECTIONS } = require('../utils/tenant-model');

const CTX = { schoolId: 'school_A' };

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(calls)) delete calls[k];
});

describe('tenantModel — filter scoping', () => {
  test('injects schoolId into a find filter', () => {
    tenantModel('students', CTX).find({ status: 'active' });
    expect(calls.find[0]).toEqual({ status: 'active', schoolId: 'school_A' });
  });

  test('injects schoolId into an empty/absent filter', () => {
    tenantModel('students', CTX).find();
    expect(calls.find[0]).toEqual({ schoolId: 'school_A' });
  });

  test('preserves extra args (chaining) by delegating to the real model', () => {
    const out = tenantModel('students', CTX).findOne({ id: 'x' }, { name: 1 });
    expect(calls.findOne[0]).toEqual({ id: 'x', schoolId: 'school_A' });
    expect(calls.findOne[1]).toEqual({ name: 1 });
    expect(out).toBe('findOne:result');   // returns exactly what the model returns
  });

  test('rejects a filter carrying a different schoolId (cross-tenant read attempt)', () => {
    expect(() => tenantModel('students', CTX).find({ schoolId: 'school_B' }))
      .toThrow(/conflicts with tenant context 'school_A'/);
  });

  test('allows a filter that repeats the SAME schoolId', () => {
    expect(() => tenantModel('students', CTX).find({ schoolId: 'school_A' })).not.toThrow();
    expect(calls.find[0]).toEqual({ schoolId: 'school_A' });
  });
});

describe('tenantModel — writes', () => {
  test('injects schoolId into a created document', () => {
    tenantModel('students', CTX).create({ firstName: 'Ada' });
    expect(calls.create[0]).toEqual({ firstName: 'Ada', schoolId: 'school_A' });
  });

  test('scopes each doc when creating an array', () => {
    tenantModel('students', CTX).create([{ a: 1 }, { b: 2 }]);
    expect(calls.create[0]).toEqual([{ a: 1, schoolId: 'school_A' }, { b: 2, schoolId: 'school_A' }]);
  });

  test('blocks a tenant-hop via update $set schoolId', () => {
    expect(() => tenantModel('students', CTX).updateOne({ id: 'x' }, { $set: { schoolId: 'school_B' } }))
      .toThrow(/tenant-hop blocked/);
  });

  test('allows $setOnInsert schoolId equal to the context (upsert)', () => {
    expect(() => tenantModel('students', CTX).updateOne({ id: 'x' }, { $setOnInsert: { schoolId: 'school_A' } })).not.toThrow();
  });

  test('scopes filter and guards update together on updateOne', () => {
    tenantModel('students', CTX).updateOne({ id: 'x' }, { $set: { name: 'B' } });
    expect(calls.updateOne[0]).toEqual({ id: 'x', schoolId: 'school_A' });
    expect(calls.updateOne[1]).toEqual({ $set: { name: 'B' } });
  });
});

describe('tenantModel — aggregate', () => {
  test('prepends a $match on schoolId as the first stage', () => {
    tenantModel('exam_results', CTX).aggregate([{ $group: { _id: '$classId' } }]);
    expect(calls.aggregate[0]).toEqual([
      { $match: { schoolId: 'school_A' } },
      { $group: { _id: '$classId' } },
    ]);
  });

  test('rejects a leading $match targeting a different school', () => {
    expect(() => tenantModel('exam_results', CTX).aggregate([{ $match: { schoolId: 'school_B' } }]))
      .toThrow(/aggregate \$match schoolId 'school_B' conflicts/);
  });
});

describe('tenantModel — bulkWrite', () => {
  test('scopes op filters and documents', () => {
    tenantModel('exam_results', CTX).bulkWrite([
      { updateOne: { filter: { studentId: 's1' }, update: { $set: { score: 80 } }, upsert: true } },
      { insertOne: { document: { studentId: 's2' } } },
    ]);
    const ops = calls.bulkWrite[0];
    expect(ops[0].updateOne.filter).toEqual({ studentId: 's1', schoolId: 'school_A' });
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(ops[1].insertOne.document).toEqual({ studentId: 's2', schoolId: 'school_A' });
  });

  test('blocks a bulk update tenant-hop', () => {
    expect(() => tenantModel('exam_results', CTX).bulkWrite([
      { updateOne: { filter: { id: 'x' }, update: { $set: { schoolId: 'school_B' } } } },
    ])).toThrow(/tenant-hop blocked/);
  });
});

describe('tenantModel — fail closed & platform exemption', () => {
  test('throws when no tenant context (fail closed)', () => {
    expect(() => tenantModel('students', null)).toThrow(/without a validated tenant context/);
    expect(() => tenantModel('students', {})).toThrow(/without a validated tenant context/);
  });

  test('refuses platform-level collections', () => {
    for (const c of ['schools', 'organizations', 'release_certificates', 'audit_logs']) {
      expect(() => tenantModel(c, CTX)).toThrow(/platform-level/);
    }
  });

  test('users is NOT platform-level (stays tenant-scoped pending D-001)', () => {
    expect(PLATFORM_COLLECTIONS.has('users')).toBe(false);
    expect(() => tenantModel('users', CTX)).not.toThrow();
  });

  test('exposes an audited raw escape hatch', () => {
    expect(tenantModel('students', CTX)._raw).toBe(mockModel);
  });
});

describe('tenantContext', () => {
  test('derives {schoolId} from the JWT', () => {
    expect(tenantContext({ jwtUser: { schoolId: 'school_A' } })).toEqual({ schoolId: 'school_A' });
  });

  test('returns null when there is no school on the request', () => {
    expect(tenantContext({ jwtUser: {} })).toBeNull();
    expect(tenantContext({})).toBeNull();
    expect(tenantContext(null)).toBeNull();
  });
});
