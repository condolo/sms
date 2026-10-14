/* ============================================================
   server/utils/parent-message-recipients.js

   Reported directly: "the parent cannot message the school, in the
   message, I need the parent can select whom they want to message,
   nurse, discipline, subject teachers etc but not fellow parents."

   The hard requirement under test: every resolved category must come
   from real assignment/role data, and the resolver must NEVER be able
   to produce another parent/guardian/student as a recipient — there
   is no code path here that reads the parents/guardians/students
   collections for recipient ids at all.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

function mockChain(result) {
  const snapshot = Array.isArray(result) ? [...result] : result;
  return { select: () => mockChain(snapshot), lean: () => Promise.resolve(snapshot) };
}

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return val !== v.$ne;
      if ('$in' in v) return v.$in.includes(val);
      if ('$exists' in v) return (val !== undefined) === v.$exists;
    }
    if (Array.isArray(val)) return val.includes(v); // array-contains-scalar
    return val === v;
  });
}

let mockStores;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (col) => ({
    find:    (filter) => mockChain((mockStores[col] || []).filter(d => mockMatches(d, filter))),
    findOne: (filter) => mockChain((mockStores[col] || []).find(d => mockMatches(d, filter)) ?? null),
  }),
}));
jest.mock('../../utils/model', () => ({
  _model: (col) => ({
    findOne: (filter) => mockChain((mockStores[col] || []).find(d => mockMatches(d, filter)) ?? null),
  }),
}));

const { resolveMessageCategories, resolveOneCategory } = require('../../utils/parent-message-recipients');

function req() {
  return { jwtUser: { schoolId: SCHOOL, userId: 'usr_parent' } };
}

beforeEach(() => {
  mockStores = {
    students: [{ id: 'stu_1', schoolId: SCHOOL, classId: 'cls_1', streamId: 'strm_a' }],
    streams:  [{ id: 'strm_a', schoolId: SCHOOL, classId: 'cls_1', name: 'Diamond', formTeacherId: 'tch_1' }],
    teachers: [
      { id: 'tch_1', schoolId: SCHOOL, userId: 'usr_t1', firstName: 'Alice', lastName: 'Makori', status: 'active', extraRoles: [] },
      { id: 'tch_2', schoolId: SCHOOL, userId: 'usr_t2', firstName: 'Brian', lastName: 'Otieno', status: 'active', extraRoles: [] },
    ],
    class_subjects: [
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_math', isCompulsoryForClass: true },
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_art',  isCompulsoryForClass: false },
    ],
    subjects: [
      { id: 'sub_math', schoolId: SCHOOL, name: 'Mathematics' },
      { id: 'sub_art',  schoolId: SCHOOL, name: 'Art' },
    ],
    teaching_assignments: [
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_math', teacherId: 'usr_t2', teacherName: 'Brian Otieno', streamId: 'strm_a' },
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_art',  teacherId: 'usr_t1', teacherName: 'Alice Makori', streamId: null },
    ],
    student_subjects: [], // stu_1 NOT enrolled in the elective (Art) yet
    users: [],
    schools: [{ id: SCHOOL, staffResponsibilities: [] }],
  };
});

describe('resolveMessageCategories — per-child categories', () => {
  test('offers the class teacher resolved from the child\'s own stream', async () => {
    const cats = await resolveMessageCategories(req(), 'stu_1');
    const classTeacher = cats.find(c => c.key === 'class_teacher');
    expect(classTeacher).toBeDefined();
    expect(classTeacher.recipientUserIds).toEqual(['usr_t1']);
  });

  test('offers a compulsory subject\'s real assigned teacher', async () => {
    const cats = await resolveMessageCategories(req(), 'stu_1');
    const math = cats.find(c => c.key === 'subject:sub_math');
    expect(math).toBeDefined();
    expect(math.recipientUserIds).toEqual(['usr_t2']);
  });

  test('an elective the child is NOT enrolled in is never offered', async () => {
    const cats = await resolveMessageCategories(req(), 'stu_1');
    expect(cats.find(c => c.key === 'subject:sub_art')).toBeUndefined();
  });

  test('once enrolled, the elective\'s real teacher IS offered', async () => {
    mockStores.student_subjects = [{ schoolId: SCHOOL, studentId: 'stu_1', subjectId: 'sub_art' }];
    const cats = await resolveMessageCategories(req(), 'stu_1');
    const art = cats.find(c => c.key === 'subject:sub_art');
    expect(art).toBeDefined();
    expect(art.recipientUserIds).toEqual(['usr_t1']);
  });

  test('a compulsory subject with no real teaching_assignments row is never offered', async () => {
    mockStores.class_subjects.push({ schoolId: SCHOOL, classId: 'cls_1', subjectId: 'sub_unassigned', isCompulsoryForClass: true });
    mockStores.subjects.push({ id: 'sub_unassigned', schoolId: SCHOOL, name: 'Unassigned Subject' });
    const cats = await resolveMessageCategories(req(), 'stu_1');
    expect(cats.find(c => c.key === 'subject:sub_unassigned')).toBeUndefined();
  });
});

describe('resolveMessageCategories — school-wide categories', () => {
  test('discipline committee offered only when a real account holds that role', async () => {
    let cats = await resolveMessageCategories(req(), 'stu_1');
    expect(cats.find(c => c.key === 'discipline')).toBeUndefined();

    mockStores.users.push({ id: 'usr_disc', schoolId: SCHOOL, role: 'discipline_committee', isActive: true });
    cats = await resolveMessageCategories(req(), 'stu_1');
    const disc = cats.find(c => c.key === 'discipline');
    expect(disc.recipientUserIds).toEqual(['usr_disc']);
  });

  test('administration resolves every real admin-tier account', async () => {
    mockStores.users.push(
      { id: 'usr_admin', schoolId: SCHOOL, role: 'admin', isActive: true },
      { id: 'usr_dep', schoolId: SCHOOL, role: 'deputy_principal', isActive: true },
    );
    const cats = await resolveMessageCategories(req(), 'stu_1');
    const admin = cats.find(c => c.key === 'administration');
    expect(admin.recipientUserIds.sort()).toEqual(['usr_admin', 'usr_dep']);
  });

  test('a custom staff-responsibility tag (e.g. "Nurse") is surfaced automatically once a real teacher holds it', async () => {
    mockStores.teachers.push({ id: 'tch_3', schoolId: SCHOOL, userId: 'usr_t3', firstName: 'Carol', lastName: 'Njeri', status: 'active', extraRoles: ['nurse'] });
    mockStores.schools = [{ id: SCHOOL, staffResponsibilities: [{ value: 'nurse', label: 'Nurse' }] }];
    const cats = await resolveMessageCategories(req(), 'stu_1');
    const nurse = cats.find(c => c.key === 'custom:nurse');
    expect(nurse).toBeDefined();
    expect(nurse.label).toBe('Nurse');
    expect(nurse.recipientUserIds).toEqual(['usr_t3']);
  });

  test('a BUILT-IN extraRoles tag (e.g. hod) is never surfaced as a messaging category', async () => {
    mockStores.teachers.push({ id: 'tch_4', schoolId: SCHOOL, userId: 'usr_t4', firstName: 'Dan', lastName: 'Kiptoo', status: 'active', extraRoles: ['hod'] });
    const cats = await resolveMessageCategories(req(), 'stu_1');
    expect(cats.find(c => c.key === 'custom:hod')).toBeUndefined();
  });

  test('never resolves to a parent, guardian, or student — no such collection is ever queried', async () => {
    const spy = jest.spyOn(require('../../utils/tenant-model'), 'tenantModel');
    await resolveMessageCategories(req(), 'stu_1');
    const queriedCollections = spy.mock.calls.map(c => c[0]);
    expect(queriedCollections).not.toEqual(expect.arrayContaining(['parents', 'guardians']));
    spy.mockRestore();
  });
});

describe('resolveOneCategory — the send-time re-resolution', () => {
  test('returns the current recipient list for a valid category', async () => {
    const ids = await resolveOneCategory(req(), 'stu_1', 'class_teacher');
    expect(ids).toEqual(['usr_t1']);
  });

  test('returns null for a category that does not (or no longer) resolve', async () => {
    const ids = await resolveOneCategory(req(), 'stu_1', 'subject:sub_art'); // not enrolled
    expect(ids).toBeNull();
  });

  test('returns null for a completely made-up category key — never falls back to anything', async () => {
    const ids = await resolveOneCategory(req(), 'stu_1', 'subject:fellow_parent_hack');
    expect(ids).toBeNull();
  });
});
