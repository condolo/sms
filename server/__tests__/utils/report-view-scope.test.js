/* ============================================================
   What a teacher may see of a report card (report-view-scope.js).

   Fixture: class c9. Maths (compulsory) and French (elective) are on the
   report. Teacher t1 teaches Maths in stream A. Teacher t2 teaches nothing
   in c9. t1 is form tutor of stream B only.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';
let mockUser = null;
let mockFormStreams = [];
let mockAssignments = [];
let mockClassSubjects = [];

jest.mock('../../utils/scopeEngine', () => ({
  resolveHomeroomStreamIds: async () => mockFormStreams,
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (col) => {
    const rows = () => (col === 'teaching_assignments' ? mockAssignments : col === 'class_subjects' ? mockClassSubjects : []);
    const chain = (r) => ({ select: () => chain(r), lean: () => Promise.resolve(r) });
    return {
      find: (f) => chain(rows().filter(d => Object.entries(f || {}).every(([k, v]) => {
        if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
        return d[k] === v;
      }))),
    };
  },
}));

const { viewReportFor, canViewFullReport } = require('../../utils/report-view-scope');

const REPORT = {
  id: 'rc_1', schoolId: SCHOOL, studentId: 'stu_1', classId: 'c9', streamId: 'stream_A',
  subjects: { maths: { finalScore: 70 }, french: { finalScore: 60 } },
  totalScore: 130, averageScore: 65, gpa: 2.5, subjectCount: 2,
  rankings: { class: { rank: 1 } }, subjectBest: { maths: true },
  comments: { subjectComments: { maths: 'Good', french: 'Fair' }, classTeacherRemark: 'Form remark', principalRemark: 'Well done' },
};

beforeEach(() => {
  mockUser = { userId: 't1', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
  mockFormStreams = [];
  mockAssignments = [{ schoolId: SCHOOL, teacherId: 't1', classId: 'c9', subjectId: 'maths', streamId: 'stream_A' }];
  mockClassSubjects = [
    { schoolId: SCHOOL, classId: 'c9', subjectId: 'maths', isCompulsoryForClass: true },
    { schoolId: SCHOOL, classId: 'c9', subjectId: 'french', isCompulsoryForClass: false },
  ];
});

const req = () => ({ jwtUser: { ...mockUser } });

describe('a subject teacher sees only their own subject on the report', () => {
  test('subjects, subject comments and totals are trimmed; remarks and totals are withheld', async () => {
    const view = await viewReportFor(req(), REPORT);
    expect(Object.keys(view.subjects)).toEqual(['maths']);
    expect(view.comments.subjectComments).toEqual({ maths: 'Good' });
    expect(view.comments.classTeacherRemark).toBeUndefined();
    expect(view.comments.principalRemark).toBeUndefined();
    expect(view.totalScore).toBeUndefined();
    expect(view.gpa).toBeUndefined();
    expect(view.rankings).toEqual({});
  });

  test('a teacher who teaches none of the report\'s subjects gets nothing', async () => {
    mockUser = { userId: 't2', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    expect(await viewReportFor(req(), REPORT)).toBeNull();
  });

  test('a teacher does not see the elective of another stream\'s group unless they teach it', async () => {
    mockAssignments = [{ schoolId: SCHOOL, teacherId: 't1', classId: 'c9', subjectId: 'french', streamId: 'stream_B' }];
    const view = await viewReportFor(req(), REPORT);
    // French is an elective: the stream_B assignment covers the whole group, so it is visible.
    expect(Object.keys(view.subjects)).toEqual(['french']);
  });
});

describe('the form tutor of a stream sees that stream in full', () => {
  test('the form tutor of stream_A sees every subject and remark of a stream_A report', async () => {
    mockFormStreams = ['stream_A'];
    const view = await viewReportFor(req(), REPORT);
    expect(view).toBe(REPORT);
    expect(view.comments.classTeacherRemark).toBe('Form remark');
  });

  test('a form tutor of another stream does not get the full report', async () => {
    mockFormStreams = ['stream_B'];
    expect(await canViewFullReport(req(), 'stream_A')).toBe(false);
  });
});

describe('management and family see the report in full', () => {
  test('an administrator sees the full report', async () => {
    mockUser = { userId: 'a1', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    expect(await viewReportFor(req(), REPORT)).toBe(REPORT);
  });

  test('a parent sees their child\'s full report (ownership is checked by the route)', async () => {
    mockUser = { userId: 'p1', schoolId: SCHOOL, role: 'parent', roles: ['parent'] };
    expect(await viewReportFor(req(), REPORT)).toBe(REPORT);
  });
});
