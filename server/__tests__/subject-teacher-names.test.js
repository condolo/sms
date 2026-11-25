/* utils/subject-teacher-names.js (v5.282.1): report cards name the teacher of
   the student's own stream. They took the first assignment in the class. */
'use strict';
const { createFakeDb } = require('./fixtures/fake-tenant-db');
let mockDb;
jest.mock('../utils/tenant-model', () => ({ tenantModel: (name) => mockDb.model(name) }));
const { subjectTeacherResolver } = require('../utils/subject-teacher-names');

const S = 'school_A';
const row = (id, streamId, teacherId, teacherName, extra = {}) => ({ id, schoolId: S, classId: 'y7', subjectId: 'mat', streamId, teacherId, teacherName, ...extra });
const names = async (rows, streamId, { elective = false, classId = 'y7', more = {} } = {}) => {
  mockDb = createFakeDb({
    classes: [{ id: 'y7', schoolId: S, _id: '64b000000000000000000007' }],
    class_subjects: [{ schoolId: S, classId: 'y7', subjectId: 'mat', isCompulsoryForClass: !elective }],
    teachers: [{ id: 't1', userId: 'u1', schoolId: S, title: 'Ms', firstName: 'Agnes', lastName: 'K' }],
    teaching_assignments: rows, ...more,
  });
  return (await subjectTeacherResolver({ schoolId: S }, S, classId))(streamId).mat;
};
const A = row('a', '7a', 'u1', 'Agnes'); const B = row('b', '7b', 'u2', 'Ben'); const W = row('w', null, 'u3', 'Whole');

test.each([
  ['each stream gets its own teacher (7A)', [A, B], '7a', 'Agnes'],
  ['each stream gets its own teacher (7B)', [A, B], '7b', 'Ben'],
  ['whichever was entered first', [B, A], '7a', 'Agnes'],
  ['a leftover whole-class row never wins over the stream\'s own', [W, A, B], '7b', 'Ben'],
  ['a whole-class teacher is named when the stream has none', [W, A], '7b', 'Whole'],
  ['another stream\'s teacher is never named', [A], '7b', undefined],
  ['not even when they are the only teacher', [A, row('a2', '7c', 'u1', 'Agnes')], '7b', undefined],
  ['no stream on the report: two streams, two teachers, no guess', [A, B], null, undefined],
  ['no stream on the report: one stream in the class', [A], null, 'Agnes'],
  ['no stream on the report: one stream, co-teachers, the first', [A, row('a2', '7a', 'u2', 'Ben')], null, 'Agnes'],
  ['no stream on the report: the same teacher in every stream', [A, row('a2', '7b', 'u1', 'Agnes')], undefined, 'Agnes'],
  ['co-teachers of one stream: the first entered', [A, row('a2', '7a', 'u2', 'Ben')], '7a', 'Agnes'],
  ['a class with no streams', [W], null, 'Whole'],
  ['nobody assigned', [], '7a', undefined],
])('%s', async (_n, rows, streamId, want) => { expect(await names(rows, streamId)).toBe(want); });

test('an elective is one group: its teacher is named for every stream, the stream\'s own first', async () => {
  expect(await names([A], '7b', { elective: true })).toBe('Agnes');
  expect(await names([A, B], '7b', { elective: true })).toBe('Ben');
});
test('first entered means createdAt, not storage order', async () => {
  const late = row('l', '7a', 'u2', 'Ben', { createdAt: '2026-05-01' });
  expect(await names([late, { ...A, createdAt: '2026-01-01' }], '7a')).toBe('Agnes');
});
test('a row with no stored name takes it from the staff record; one with no record is skipped', async () => {
  expect(await names([row('x', '7a', 'ghost', ''), row('a', '7a', 'u1', '')], '7a')).toBe('Ms Agnes K');
});
test('either form of the class id is matched', async () => {
  expect(await names([{ ...A, classId: '64b000000000000000000007' }], '7a')).toBe('Agnes');
  expect(await names([A], '7a', { classId: '64b000000000000000000007' })).toBe('Agnes');
});
test('another school is never read', async () => {
  expect(await names([{ ...A, schoolId: 'school_B' }], '7a')).toBeUndefined();
});
test('a failed lookup gives no names, never a failed report card', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockDb = { model: () => { throw new Error('down'); } };
  expect((await subjectTeacherResolver({}, S, 'y7'))('7a')).toEqual({});
  expect((await subjectTeacherResolver({}, S, null))('7a')).toEqual({});
  console.error.mockRestore();
});
