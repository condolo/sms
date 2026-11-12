/* ============================================================
   v5.269.1 — option blocks in the shared clash checks
   (utils/timetable-conflicts.js + utils/elective-groups.js)

   Two lessons of one class in the same period used to always clash
   unless they were in different streams, so an option block (Physics |
   History at the same time, students choosing one) could not be entered
   at all. Now they may share the period only when both subjects are
   electives of the class and no student takes both. Anything unknown
   still clashes.
   ============================================================ */
'use strict';

const { createFakeDb } = require('./fixtures/fake-tenant-db');
let mockDb;
jest.mock('../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));

const { checkConflicts, batchConflicts } = require('../utils/timetable-conflicts');
const { loadElectiveInfo, canShareSlot } = require('../utils/elective-groups');

const S = 'school_A';
const lesson = (o) => ({ schoolId: S, academicYearId: 'ay1', isActive: true, classId: 'c3', day: 'monday', period: '1', startTime: '08:00', endTime: '08:40', type: 'lesson', ...o });

beforeEach(() => {
  mockDb = createFakeDb({
    class_subjects: [
      { schoolId: S, classId: 'c3', subjectId: 'phy', isCompulsoryForClass: false },
      { schoolId: S, classId: 'c3', subjectId: 'his', isCompulsoryForClass: false },
      { schoolId: S, classId: 'c3', subjectId: 'art', isCompulsoryForClass: false },
      { schoolId: S, classId: 'c3', subjectId: 'geo', isCompulsoryForClass: false },   // nobody enrolled
      { schoolId: S, classId: 'c3', subjectId: 'math', isCompulsoryForClass: true },
    ],
    students: [
      { id: 's1', schoolId: S, classId: 'c3', streamId: 'A', status: 'active' },
      { id: 's2', schoolId: S, classId: 'c3', streamId: 'B', status: 'active' },
      { id: 's3', schoolId: S, classId: 'c3', streamId: 'A', status: 'active' },
    ],
    student_subjects: [
      { schoolId: S, studentId: 's1', subjectId: 'phy' },
      { schoolId: S, studentId: 's2', subjectId: 'his' },
      { schoolId: S, studentId: 's1', subjectId: 'art' },   // s1 takes Physics AND Art
      { schoolId: S, studentId: 's3', subjectId: 'art' },
    ],
    timetable: [lesson({ id: 'L_phy', subjectId: 'phy', subject: 'Physics', teacherId: 't_phy' })],
  });
});

test('History may sit beside Physics: both options, no shared student', async () => {
  expect(await checkConflicts(S, lesson({ subjectId: 'his', teacherId: 't_his' }))).toBeNull();
});

test('Art may not: a student takes both', async () => {
  expect(await checkConflicts(S, lesson({ subjectId: 'art', teacherId: 't_art' }))).toMatch(/Slot already exists/);
});

test('a compulsory subject, an option nobody is enrolled in, the same subject, or no subjectId all still clash', async () => {
  expect(await checkConflicts(S, lesson({ subjectId: 'math', teacherId: 't_m' }))).toMatch(/Slot already exists/);
  expect(await checkConflicts(S, lesson({ subjectId: 'geo', teacherId: 't_g' }))).toMatch(/Slot already exists/);
  expect(await checkConflicts(S, lesson({ subjectId: 'phy', teacherId: 't_other' }))).toMatch(/Slot already exists/);
  expect(await checkConflicts(S, lesson({ subject: 'History', teacherId: 't_his' }))).toMatch(/Slot already exists/);
});

test('the teacher and room rules are unchanged for options', async () => {
  expect(await checkConflicts(S, lesson({ subjectId: 'his', teacherId: 't_phy' }))).toMatch(/Teacher is already scheduled/);
});

test('another school\'s enrolment never makes two lessons shareable', async () => {
  mockDb.data.student_subjects = mockDb.data.student_subjects.map(r => ({ ...r, schoolId: 'school_B' }));
  expect(await checkConflicts(S, lesson({ subjectId: 'his', teacherId: 't_his' }))).toMatch(/Slot already exists/);
});

test('bulk save (batchConflicts) follows the same rule when given the enrolment', async () => {
  const info = await loadElectiveInfo({ schoolId: S }, S, ['c3']);
  const batch = [lesson({ subjectId: 'phy', teacherId: 'a' }), lesson({ subjectId: 'his', teacherId: 'b' }), lesson({ subjectId: 'art', teacherId: 'c' })];
  const clashes = batchConflicts(batch, info);
  expect(clashes).toHaveLength(1);              // Art vs Physics only
  expect(clashes[0]).toMatchObject({ index: 2, otherIndex: 0 });
  expect(batchConflicts(batch)).toHaveLength(3); // without enrolment: the old rule
  expect(canShareSlot(info, 'c3', 'his', 'art')).toBe(true);
});
