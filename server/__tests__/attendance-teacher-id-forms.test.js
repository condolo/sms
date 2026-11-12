/* ============================================================
   Teaching assignments keyed by a different ID form of the same teacher,
   and the explicit Attendance "All Classes (not just assigned)" grant.

   Reported directly (2026-11-12, Mascit Lab Academy): "teachers assigned
   classes cannot mark attendance … if a user is assigned full access of
   attendance … how can they still not take attendance?"

   1. scopeMiddleware._loadAssigned matched teaching_assignments.teacherId
      against the JWT userId only. Rows keyed by teachers.id, or by the
      other form of the login's id (`id` vs String(_id)), were invisible —
      no error, just "not in your assigned scope". _teacherIdForms now
      resolves every form that provably belongs to this login.
   2. Nothing in Settings could widen Attendance's class scope.
      resolveAttendanceScope now honours attendance__all_classes.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_mascit';
const OID_HEX = '64b7f0c2a1b2c3d4e5f60718'; // a user doc with NO `id` field

function mockSame(a, b) {
  if (a == null || b == null) return a === b;
  return String(a) === String(b);
}
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.some(x => mockSame(doc[k], x));
    return mockSame(doc[k], v);
  });
}
function mockChain(val) {
  const c = { select: () => c, sort: () => c, limit: () => c, lean: () => Promise.resolve(val) };
  return c;
}
function mockCollection(name) {
  return {
    find: jest.fn((f) => mockChain((mockDb[name] || []).filter(d => mockMatches(d, f)))),
    findOne: jest.fn((f) => {
      if (mockFailOn === name) throw new Error('db down');
      return mockChain((mockDb[name] || []).find(d => mockMatches(d, f)) || null);
    }),
  };
}

let mockDb;
let mockFailOn;
jest.mock('../utils/model', () => ({ _model: jest.fn((name) => mockCollection(name)) }));

let mockAllClassesGrant;
jest.mock('../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn((_req, mod, sub, action) =>
    Promise.resolve(mod === 'attendance' && sub === 'all_classes' && mockAllClassesGrant.includes(action))),
}));
jest.mock('../utils/resolveTeacher', () => ({ resolveTeacher: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({ find: () => mockChain([]), findOne: () => mockChain(null) }),
}));

const { _teacherIdForms, _loadAssigned } = require('../middleware/scopeMiddleware');
const ScopeEngine = require('../utils/scopeEngine');

beforeEach(() => {
  jest.clearAllMocks();
  mockFailOn = null;
  mockAllClassesGrant = [];
  mockDb = {
    users: [
      { id: 'usr_ann', _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', schoolId: SCHOOL, email: 'ann@mascit.test' },
      // Mascit's shape: no `id` field, so the JWT userId is String(_id)
      { _id: OID_HEX, schoolId: SCHOOL, email: 'ben@mascit.test' },
    ],
    teachers: [
      { id: 'tch_ann', userId: 'usr_ann', schoolId: SCHOOL, email: 'ann@mascit.test' },
      { id: 'tch_ben', schoolId: SCHOOL, email: 'BEN@mascit.test'.toLowerCase() }, // never linked
      // Same email as Ann but linked to a different login — must never be merged in
      { id: 'tch_imposter', userId: 'usr_someone_else', schoolId: SCHOOL, email: 'ann@mascit.test' },
    ],
    teaching_assignments: [
      { schoolId: SCHOOL, teacherId: 'usr_ann',      classId: 'cls_math' },                 // canonical
      { schoolId: SCHOOL, teacherId: 'tch_ann',      classId: 'cls_sci' },                  // keyed by staff record
      { schoolId: SCHOOL, teacherId: 'tch_ben',      classId: 'cls_eng', streamId: 'strm_1' }, // Mascit case
      { schoolId: SCHOOL, teacherId: 'tch_imposter', classId: 'cls_secret' },
    ],
  };
});

describe('_teacherIdForms', () => {
  test('includes the login id, its _id string, and the linked staff record id', async () => {
    const forms = await _teacherIdForms('usr_ann', SCHOOL);
    expect(forms).toEqual(expect.arrayContaining(['usr_ann', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'tch_ann']));
  });

  test('never merges a staff record linked to a DIFFERENT login, even with the same email', async () => {
    const forms = await _teacherIdForms('usr_ann', SCHOOL);
    expect(forms).not.toContain('tch_imposter');
  });

  test('Mascit shape: login with no `id` field finds its unlinked staff record by email', async () => {
    const forms = await _teacherIdForms(OID_HEX, SCHOOL);
    expect(forms).toEqual(expect.arrayContaining([OID_HEX, 'tch_ben']));
  });

  test('a lookup failure falls back to the exact userId only — never wider', async () => {
    mockFailOn = 'users';
    expect(await _teacherIdForms('usr_ann', SCHOOL)).toEqual(['usr_ann']);
  });

  test('unknown login → just the userId', async () => {
    expect(await _teacherIdForms('usr_nobody', SCHOOL)).toEqual(['usr_nobody']);
  });
});

describe('_loadAssigned', () => {
  test('sees assignments keyed by the staff record id as well as the login id', async () => {
    const a = await _loadAssigned('usr_ann', SCHOOL);
    expect(a.classIds.sort()).toEqual(['cls_math', 'cls_sci']);
    expect(a.classIds).not.toContain('cls_secret');
  });

  test('Mascit shape: a stream assignment saved under the staff record id is now visible', async () => {
    const a = await _loadAssigned(OID_HEX, SCHOOL);
    expect(a.streamIds).toEqual(['strm_1']);
  });
});

describe('resolveAttendanceScope — "All Classes (not just assigned)"', () => {
  const req = (role = 'teacher', userId = 'usr_ann') => ({ jwtUser: { userId, schoolId: SCHOOL, role, email: 'x@y' } });

  test('without the grant, a teacher is limited to their own (now correctly resolved) classes', async () => {
    const scope = await ScopeEngine.resolveAttendanceScope(req());
    expect(scope).not.toBeNull();
    expect(scope.classIds.sort()).toEqual(['cls_math', 'cls_sci']);
  });

  test('View on All Classes makes the scope unrestricted', async () => {
    mockAllClassesGrant = ['read'];
    expect(await ScopeEngine.resolveAttendanceScope(req())).toBeNull();
  });

  test('Edit on All Classes makes the scope unrestricted, for any role', async () => {
    mockAllClassesGrant = ['create', 'update'];
    expect(await ScopeEngine.resolveAttendanceScope(req('exams_officer'))).toBeNull();
  });

  test('floor roles stay unrestricted without the grant', async () => {
    expect(await ScopeEngine.resolveAttendanceScope(req('principal'))).toBeNull();
  });
});
