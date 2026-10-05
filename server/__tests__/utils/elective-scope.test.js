/* ============================================================
   Elective groups — who can write marks for an elective, and which
   students may receive them.

   Fixture: French is an elective for class c9 (not compulsory). Students
   s1 (stream A) and s3 (stream B) take French; s2 (stream A) does not.
   t1 teaches French to c9 in stream A only. Maths is compulsory for c9.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';
let mockUser = null;
let mockDb = {};

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: (col) => {
    const rows = () => mockDb[col] || [];
    const chain = (result) => ({ select: () => chain(result), lean: () => Promise.resolve(result) });
    const matchFn = (f) => (d) => Object.entries(f || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
      return d[k] === v;
    });
    return {
      find: (f) => chain(rows().filter(matchFn(f))),
      findOne: (f) => chain(rows().find(matchFn(f)) ?? null),
    };
  },
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
}));

const { electiveMarkProblem, canTeachElective, isElective, enrolledStudentIds } = require('../../utils/elective-scope');

const req = () => ({ jwtUser: { ...mockUser, schoolId: SCHOOL } });
const TEACHER = { userId: 't1', role: 'teacher', roles: ['teacher'] };
const ADMIN = { userId: 'a1', role: 'admin', roles: ['admin'] };

beforeEach(() => {
  mockUser = { ...TEACHER };
  mockDb = {
    class_subjects: [
      { schoolId: SCHOOL, classId: 'c9', subjectId: 'french', isCompulsoryForClass: false },
      { schoolId: SCHOOL, classId: 'c9', subjectId: 'maths', isCompulsoryForClass: true },
    ],
    student_subjects: [
      { schoolId: SCHOOL, studentId: 's1', subjectId: 'french' },
      { schoolId: SCHOOL, studentId: 's3', subjectId: 'french' },
    ],
    teaching_assignments: [
      { schoolId: SCHOOL, teacherId: 't1', classId: 'c9', subjectId: 'french', streamId: 'stream_A' },
    ],
  };
});

describe('isElective', () => {
  test('a subject marked not compulsory for the class is an elective', async () => {
    expect(await isElective(req(), 'c9', 'french')).toBe(true);
  });
  test('a compulsory subject is not an elective', async () => {
    expect(await isElective(req(), 'c9', 'maths')).toBe(false);
  });
});

describe('enrolledStudentIds', () => {
  test('returns students across every stream, not just one', async () => {
    const ids = await enrolledStudentIds(req(), 'french');
    expect([...ids].sort()).toEqual(['s1', 's3']);
  });
});

describe('canTeachElective — the group spans streams, so any stream assignment counts', () => {
  test('a teacher assigned to the elective in one stream may teach the whole group', async () => {
    expect(await canTeachElective(req(), 'c9', 'french')).toBe(true);
  });
  test('a teacher with no assignment for the subject may not', async () => {
    mockDb.teaching_assignments = [];
    expect(await canTeachElective(req(), 'c9', 'french')).toBe(false);
  });
  test('management keeps its bypass', async () => {
    mockUser = { ...ADMIN };
    mockDb.teaching_assignments = [];
    expect(await canTeachElective(req(), 'c9', 'french')).toBe(true);
  });
});

describe('electiveMarkProblem', () => {
  test('marks for enrolled students in an elective the teacher teaches are allowed', async () => {
    const problem = await electiveMarkProblem(req(), [
      { classId: 'c9', subjectId: 'french', studentId: 's1' },
      { classId: 'c9', subjectId: 'french', studentId: 's3' },
    ]);
    expect(problem).toBeNull();
  });

  test('a mark for a student who does not take the elective is refused', async () => {
    const problem = await electiveMarkProblem(req(), [
      { classId: 'c9', subjectId: 'french', studentId: 's2' },
    ]);
    expect(problem).toMatch(/not enrolled/);
  });

  test('a teacher not assigned to the elective is refused', async () => {
    mockDb.teaching_assignments = [];
    const problem = await electiveMarkProblem(req(), [
      { classId: 'c9', subjectId: 'french', studentId: 's1' },
    ]);
    expect(problem).toMatch(/not assigned/);
  });

  test('compulsory marks are not judged by this rule (the stream rule applies to them)', async () => {
    mockDb.teaching_assignments = [];
    const problem = await electiveMarkProblem(req(), [
      { classId: 'c9', subjectId: 'maths', studentId: 's2' },
    ]);
    expect(problem).toBeNull();
  });
});
