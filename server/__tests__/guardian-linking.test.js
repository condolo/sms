/* ============================================================
   utils/guardian-linking.js — linkExistingGuardians()

   Billing-sequence fix (2026-09): sibling-discount eligibility depends
   on a guardian's studentIds array already listing the new student.
   Nothing established that link before the admission invoice was
   generated in the same request — this is the fix. Covers:

     1. Links via siblingStudentId (find that student's guardians,
        $addToSet the new student onto them).
     2. Links via email match (mother/father/parent) against an
        existing 'parent'-role user — no siblingStudentId needed.
     3. Both signals combine and dedupe — never a double $addToSet.
     4. Never creates a NEW guardian account — a family with no
        existing guardian is left alone (that's a separate, explicit
        step: students.js's POST /:id/parent-account).
     5. Never touches password/isActive/mustChangePassword — this is
        a data-completeness step, not a credential/portal action.
     6. Idempotent — calling twice for the same student never
        duplicates studentIds/guardianOf entries.
     7. No email and no siblingStudentId -> no-op, no crash.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$in' in v) return Array.isArray(doc[k]) ? v.$in.some(x => doc[k].includes(x)) : v.$in.includes(doc[k]);
    }
    // Plain equality against an array field means "array contains value"
    // (real Mongo semantics) — matters for studentIds: someId.
    if (Array.isArray(doc[k])) return doc[k].includes(v);
    return doc[k] === v;
  });
}
function mockChainArr(arr) { return { select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function makeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOneAndUpdate: jest.fn((filter, update) => {
      const doc = docs.find(d => matchesFilter(d, filter));
      if (!doc) return mockChainObj(null);
      const set = update.$set ?? {};
      Object.assign(doc, set);
      if (update.$addToSet) {
        for (const [field, val] of Object.entries(update.$addToSet)) {
          doc[field] = Array.isArray(doc[field]) ? doc[field] : [];
          if (!doc[field].includes(val)) doc[field].push(val);
        }
      }
      return mockChainObj(doc);
    }),
  };
}

let mockUsers;
jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((c) => (c === 'users' ? mockUsers : { find: jest.fn(() => mockChainArr([])) })),
}));

const { linkExistingGuardians } = require('../utils/guardian-linking');

beforeEach(() => {
  jest.clearAllMocks();
});

test('links via siblingStudentId — finds that student\'s guardian and adds the new student', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'], guardianOf: ['stu_elder'] },
  ]);
  const newStudent = { id: 'stu_new', siblingStudentId: 'stu_elder' };
  const linked = await linkExistingGuardians(SCHOOL, {}, newStudent);
  expect(linked).toEqual(['guardian_1']);
  expect(mockUsers._docs()[0].studentIds).toEqual(['stu_elder', 'stu_new']);
  expect(mockUsers._docs()[0].guardianOf).toEqual(['stu_elder', 'stu_new']);
});

test('links via email match — no siblingStudentId needed', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'] },
  ]);
  const newStudent = { id: 'stu_new', motherEmail: 'Mum@Example.com' }; // case/whitespace shouldn't matter
  const linked = await linkExistingGuardians(SCHOOL, {}, newStudent);
  expect(linked).toEqual(['guardian_1']);
  expect(mockUsers._docs()[0].studentIds).toContain('stu_new');
});

test('email match checks mother, father, AND legacy parentEmail', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_dad', schoolId: SCHOOL, role: 'parent', email: 'dad@example.com', studentIds: ['stu_elder'] },
  ]);
  const newStudent = { id: 'stu_new', motherEmail: '', fatherEmail: 'dad@example.com', parentEmail: '' };
  const linked = await linkExistingGuardians(SCHOOL, {}, newStudent);
  expect(linked).toEqual(['guardian_dad']);
});

test('siblingStudentId and email both resolving to the SAME guardian only links once (deduped)', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'] },
  ]);
  const newStudent = { id: 'stu_new', siblingStudentId: 'stu_elder', motherEmail: 'mum@example.com' };
  const linked = await linkExistingGuardians(SCHOOL, {}, newStudent);
  expect(linked).toEqual(['guardian_1']);
  expect(mockUsers._docs()[0].studentIds.filter(id => id === 'stu_new')).toHaveLength(1);
});

test('two DIFFERENT guardians (mother and father each have their own account) both get linked', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_mum', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'] },
    { id: 'guardian_dad', schoolId: SCHOOL, role: 'parent', email: 'dad@example.com', studentIds: ['stu_elder'] },
  ]);
  const newStudent = { id: 'stu_new', motherEmail: 'mum@example.com', fatherEmail: 'dad@example.com' };
  const linked = await linkExistingGuardians(SCHOOL, {}, newStudent);
  expect(linked.sort()).toEqual(['guardian_dad', 'guardian_mum']);
});

test('no existing guardian matches -> no-op, never creates a new account', async () => {
  mockUsers = makeFakeCollection([]);
  const newStudent = { id: 'stu_first', motherEmail: 'brandnew@example.com' };
  const linked = await linkExistingGuardians(SCHOOL, {}, newStudent);
  expect(linked).toEqual([]);
  expect(mockUsers._docs()).toHaveLength(0); // still empty — no account created
});

test('no email and no siblingStudentId -> no-op, no crash', async () => {
  mockUsers = makeFakeCollection([{ id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'someone@example.com', studentIds: [] }]);
  const linked = await linkExistingGuardians(SCHOOL, {}, { id: 'stu_new' });
  expect(linked).toEqual([]);
});

test('never touches password/isActive/mustChangePassword — data-completeness only, not a credential action', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'], password: 'hash_unchanged', isActive: true, mustChangePassword: false },
  ]);
  await linkExistingGuardians(SCHOOL, {}, { id: 'stu_new', motherEmail: 'mum@example.com' });
  const doc = mockUsers._docs()[0];
  expect(doc.password).toBe('hash_unchanged');
  expect(doc.isActive).toBe(true);
  expect(doc.mustChangePassword).toBe(false);
});

test('idempotent — calling twice for the same student never duplicates studentIds/guardianOf', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_1', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'], guardianOf: ['stu_elder'] },
  ]);
  const newStudent = { id: 'stu_new', motherEmail: 'mum@example.com' };
  await linkExistingGuardians(SCHOOL, {}, newStudent);
  await linkExistingGuardians(SCHOOL, {}, newStudent);
  const doc = mockUsers._docs()[0];
  expect(doc.studentIds).toEqual(['stu_elder', 'stu_new']);
  expect(doc.guardianOf).toEqual(['stu_elder', 'stu_new']);
});

test('an email matching TWO different guardian accounts is not auto-linked — ambiguous, logged, never guessed', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_real',    schoolId: SCHOOL, role: 'parent', email: 'shared@example.com', studentIds: ['stu_elder'] },
    { id: 'guardian_unrelated', schoolId: SCHOOL, role: 'parent', email: 'shared@example.com', studentIds: ['stu_other_family'] },
  ]);
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const linked = await linkExistingGuardians(SCHOOL, {}, { id: 'stu_new', motherEmail: 'shared@example.com' });
  expect(linked).toEqual([]);
  expect(mockUsers._docs()[0].studentIds).toEqual(['stu_elder']);   // unchanged
  expect(mockUsers._docs()[1].studentIds).toEqual(['stu_other_family']); // unchanged
  expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('ambiguous'));
  errSpy.mockRestore();
});

test('an ambiguous email does not block linking via a DIFFERENT, unambiguous email on the same application', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_dup_a', schoolId: SCHOOL, role: 'parent', email: 'shared@example.com', studentIds: ['stu_x'] },
    { id: 'guardian_dup_b', schoolId: SCHOOL, role: 'parent', email: 'shared@example.com', studentIds: ['stu_y'] },
    { id: 'guardian_dad',   schoolId: SCHOOL, role: 'parent', email: 'dad@example.com',    studentIds: ['stu_elder'] },
  ]);
  const linked = await linkExistingGuardians(SCHOOL, {}, { id: 'stu_new', motherEmail: 'shared@example.com', fatherEmail: 'dad@example.com' });
  expect(linked).toEqual(['guardian_dad']); // the unambiguous match still links normally
});

test('siblingStudentId legitimately resolving to TWO guardians (mother + father, each with their own account) links both — not ambiguity', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_mum', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'] },
    { id: 'guardian_dad', schoolId: SCHOOL, role: 'parent', email: 'dad@example.com', studentIds: ['stu_elder'] },
  ]);
  const linked = await linkExistingGuardians(SCHOOL, {}, { id: 'stu_new', siblingStudentId: 'stu_elder' });
  expect(linked.sort()).toEqual(['guardian_dad', 'guardian_mum']);
});

test('an inactive guardian account is not linked', async () => {
  mockUsers = makeFakeCollection([
    { id: 'guardian_gone', schoolId: SCHOOL, role: 'parent', email: 'mum@example.com', studentIds: ['stu_elder'], isActive: false },
  ]);
  const linked = await linkExistingGuardians(SCHOOL, {}, { id: 'stu_new', motherEmail: 'mum@example.com' });
  expect(linked).toEqual([]);
});
