/* ============================================================
   utils/mark-students.js — a mark must belong to a student of this
   school who is, or was, in the mark's class (v5.291.0).

   Found while testing v5.290.0: POST /assessment/marks saved a mark for
   studentId "NOPE" (no such student) without complaint.
   ============================================================ */
'use strict';

let mockDb;
jest.mock('../../utils/tenant-model', () => ({ tenantModel: (name) => mockDb.model(name) }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
const { studentClassProblems } = require('../../utils/mark-students');

const S = 'sch_a';
const CTX = { schoolId: S };

beforeEach(() => {
  mockDb = createFakeDb({
    students: [
      { id: 'stu_now', schoolId: S, classId: 'cls_g6' },
      { id: 'stu_moved', schoolId: S, classId: 'cls_g6' },            // was in G5 last year (history)
      { id: 'stu_marked', schoolId: S, classId: 'cls_g6' },           // moved, no history, has G5 marks
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', schoolId: S, classId: 'cls_g6' }, // legacy: no `id`
      { id: 'stu_oidclass', schoolId: S, classId: 'bbbbbbbbbbbbbbbbbbbbbbb1' }, // class stored by _id
      { id: 'stu_withdrawn', schoolId: S, classId: 'cls_g6', status: 'withdrawn' },
      { id: 'stu_other_school', schoolId: 'sch_b', classId: 'cls_g6' },
    ],
    classes: [
      { id: 'cls_g6', schoolId: S },
      { id: 'cls_g5', schoolId: S },
      { _id: 'bbbbbbbbbbbbbbbbbbbbbbb1', id: 'cls_legacy', schoolId: S },
    ],
    student_class_history: [
      { schoolId: S, studentId: 'stu_moved', classId: 'cls_g5', academicYearId: 'y2025' },
      { schoolId: 'sch_b', studentId: 'stu_now', classId: 'cls_g5', academicYearId: 'y2025' },
    ],
    assessment_marks: [
      { schoolId: S, studentId: 'stu_marked', classId: 'cls_g5' },
      { schoolId: 'sch_b', studentId: 'stu_now', classId: 'cls_g4' },
    ],
  });
});

const check = pairs => studentClassProblems(CTX, S, pairs);

test('a student in the class now is accepted', async () => {
  expect(await check([{ studentId: 'stu_now', classId: 'cls_g6' }])).toEqual([]);
});

test('a student id that does not exist is refused (the "NOPE" case)', async () => {
  expect(await check([{ studentId: 'NOPE', classId: 'cls_g6' }])).toEqual([{ studentId: 'NOPE', classId: 'cls_g6', problem: 'not_found' }]);
});

test("another school's student is not found", async () => {
  const [p] = await check([{ studentId: 'stu_other_school', classId: 'cls_g6' }]);
  expect(p.problem).toBe('not_found');
});

test('a student of another class is refused', async () => {
  expect(await check([{ studentId: 'stu_now', classId: 'cls_g5' }])).toEqual([{ studentId: 'stu_now', classId: 'cls_g5', problem: 'other_class' }]);
});

test('a student who was in the class in an earlier year (class history) is accepted', async () => {
  expect(await check([{ studentId: 'stu_moved', classId: 'cls_g5' }])).toEqual([]);
});

test('a moved student with no history but existing marks in that class is accepted (corrections)', async () => {
  expect(await check([{ studentId: 'stu_marked', classId: 'cls_g5' }])).toEqual([]);
});

test("another school's history or marks never count", async () => {
  const out = await check([{ studentId: 'stu_now', classId: 'cls_g5' }, { studentId: 'stu_now', classId: 'cls_g4' }]);
  expect(out.map(p => p.problem)).toEqual(['other_class', 'other_class']);
});

test('a legacy student with only a Mongo _id is found', async () => {
  expect(await check([{ studentId: 'aaaaaaaaaaaaaaaaaaaaaaa1', classId: 'cls_g6' }])).toEqual([]);
});

test("a student whose classId is the class's _id matches the class's id, and the reverse", async () => {
  expect(await check([{ studentId: 'stu_oidclass', classId: 'cls_legacy' }])).toEqual([]);
  expect(await check([{ studentId: 'stu_oidclass', classId: 'bbbbbbbbbbbbbbbbbbbbbbb1' }])).toEqual([]);
});

test('status is not checked: a withdrawn student can still have marks corrected', async () => {
  expect(await check([{ studentId: 'stu_withdrawn', classId: 'cls_g6' }])).toEqual([]);
});

test('a batch reports every problem and only those', async () => {
  const out = await check([
    { studentId: 'stu_now', classId: 'cls_g6' },
    { studentId: 'NOPE', classId: 'cls_g6' },
    { studentId: 'stu_now', classId: 'cls_g5' },
    { studentId: 'stu_moved', classId: 'cls_g5' },
  ]);
  expect(out).toEqual([
    { studentId: 'NOPE', classId: 'cls_g6', problem: 'not_found' },
    { studentId: 'stu_now', classId: 'cls_g5', problem: 'other_class' },
  ]);
});
