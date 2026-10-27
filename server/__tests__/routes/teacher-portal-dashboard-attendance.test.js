/* ============================================================
   server/routes/teacher-portal.js — GET /dashboard attendance%
   + at-risk-students widgets (reported directly 2026-10-27)

   "is the parents portal live really, pulling data as required... not
   just attendance" — the same investigation into the parent dashboard's
   attendance-always-zero bug found the identical root cause here: the
   per-class attendance % (myClasses[].attendancePct) and the "at-risk
   students" (3+ absences) aggregate both filtered the `attendance`
   collection by an `academicYear` field that does not exist on real
   attendance documents (confirmed directly against live production
   data — see parent-portal.js's own comment for the full reasoning).
   Both widgets therefore always came back empty/zero for every teacher,
   at every school. Fixed by scoping to the resolved current term's own
   date range instead, mirroring parent-portal.js/student-portal.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const TEACHER_USER = 'usr_teacher';
const TEACHER_ID = 'tch_1';
const CLASS_ID = 'cls_4a';

jest.mock('../../utils/timetable-publish', () => {
  const actual = jest.requireActual('../../utils/timetable-publish');
  const { tenantModel } = require('../../utils/tenant-model');
  return {
    ...actual,
    publishedReader: async (schoolId, ctx) => tenantModel('timetable', ctx),
    timetableReaderFor: async (req) => tenantModel('timetable', { schoolId: req.jwtUser.schoolId }),
  };
});
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: TEACHER_USER, schoolId: SCHOOL_A, role: 'teacher', email: 't@x.com' };
    next();
  },
}));
jest.mock('../../utils/resolveTeacher', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve({ id: TEACHER_ID, userId: TEACHER_USER, firstName: 'Jane', lastName: 'Doe' })),
}));

function mockChain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c,
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
  };
  return c;
}

// Combines every operator on a key (a single early-return-per-operator, as
// an earlier version of this exact helper did elsewhere in this test suite,
// silently drops a $lte check that follows a $gte on the same key).
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v).every(([op, opVal]) => {
        switch (op) {
          case '$in':  return opVal.includes(doc[k]);
          case '$nin': return !opVal.includes(doc[k]);
          case '$exists': {
            const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
            return opVal ? has : !has;
          }
          case '$gt':  return doc[k] > opVal;
          case '$gte': return doc[k] >= opVal;
          case '$ne':  return doc[k] !== opVal;
          case '$lt':  return doc[k] < opVal;
          case '$lte': return doc[k] <= opVal;
          default: return true;
        }
      });
    }
    return doc[k] === v;
  });
}

// Minimal pipeline executor — just enough for teacher-portal.js's
// absence-count / negative-behaviour aggregates ($match → $group($sum) →
// $match → $sort → $limit).
function mockAggregate(seed, pipeline) {
  let docs = seed.slice();
  for (const stage of pipeline) {
    if (stage.$match) {
      docs = docs.filter(d => mockMatchesFilter(d, stage.$match));
    } else if (stage.$group) {
      const idSpec = stage.$group._id;
      const groups = new Map();
      for (const d of docs) {
        const key = typeof idSpec === 'string' && idSpec.startsWith('$') ? d[idSpec.slice(1)] : idSpec;
        if (!groups.has(key)) groups.set(key, { _id: key });
        const g = groups.get(key);
        for (const [field, spec] of Object.entries(stage.$group)) {
          if (field === '_id') continue;
          if (spec && spec.$sum !== undefined) g[field] = (g[field] || 0) + (spec.$sum === 1 ? 1 : d[String(spec.$sum).replace('$', '')] || 0);
        }
      }
      docs = [...groups.values()];
    } else if (stage.$sort) {
      const [[field, dir]] = Object.entries(stage.$sort);
      docs = docs.slice().sort((a, b) => (a[field] - b[field]) * dir);
    } else if (stage.$limit) {
      docs = docs.slice(0, stage.$limit);
    }
  }
  return docs;
}

function mockCollection(seed = []) {
  return {
    find:           jest.fn((filter) => mockChain(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne:        jest.fn((filter) => mockChain(filter ? (seed.find(d => mockMatchesFilter(d, filter)) ?? null) : (seed[0] ?? null))),
    countDocuments: jest.fn((filter) => Promise.resolve(seed.filter(d => mockMatchesFilter(d, filter)).length)),
    distinct:       jest.fn((field, filter) => Promise.resolve([...new Set(seed.filter(d => mockMatchesFilter(d, filter)).map(d => d[field]))])),
    aggregate:      jest.fn((pipeline) => Promise.resolve(mockAggregate(seed, pipeline))),
  };
}

let mockSchoolDoc, mockAssignments, mockTimetableDocs, mockAttendanceDocs, mockClassDocs,
    mockStreamDocs, mockAcademicYearDocs, mockStudentDocs, mockBehaviourDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments') return mockCollection(mockAssignments);
    if (collection === 'timetable')            return mockCollection(mockTimetableDocs);
    if (collection === 'attendance')           return mockCollection(mockAttendanceDocs);
    if (collection === 'classes')              return mockCollection(mockClassDocs);
    if (collection === 'streams')              return mockCollection(mockStreamDocs);
    if (collection === 'students')             return mockCollection(mockStudentDocs);
    if (collection === 'behaviour_incidents')  return mockCollection(mockBehaviourDocs);
    if (collection === 'academic_years')       return mockCollection(mockAcademicYearDocs);
    return mockCollection([]);
  },
}));

// Mirrors academic-config.js's real `_resolveCurrentPeriod` — term is
// always resolved live by date range, never stubbed to null (a stub here
// would make every date-scoped query's filter a silent no-op and hide
// exactly the bug this file is testing for).
jest.mock('../../routes/academic-config', () => ({
  resolveCurrentPeriod: (years, todayStr) => {
    todayStr = todayStr || new Date().toISOString().slice(0, 10);
    let year = (years || []).find(y => y.isCurrent);
    if (!year) {
      year = (years || []).find(y => y.startDate <= todayStr && y.endDate >= todayStr)
          ?? [...(years || [])].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0]
          ?? null;
    }
    if (!year) return { year: null, term: null, termNumber: null };
    const terms = Array.isArray(year.terms) ? year.terms : [];
    let termIdx = terms.findIndex(t => t.startDate <= todayStr && t.endDate >= todayStr);
    if (termIdx === -1) {
      const upcoming = terms
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.startDate > todayStr)
        .sort((a, b) => a.t.startDate.localeCompare(b.t.startDate))[0];
      termIdx = upcoming ? upcoming.i : (terms.length ? terms.length - 1 : -1);
    }
    return {
      year,
      term:       termIdx >= 0 ? terms[termIdx] : null,
      termNumber: termIdx >= 0 ? termIdx + 1 : null,
    };
  },
}));

const express   = require('express');
const supertest = require('supertest');
const teacherPortalRouter = require('../../routes/teacher-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teacher-portal', teacherPortalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDoc = { name: 'Test School', academicYear: '2026', timetableStatus: { published: true } };
  mockClassDocs = [{ id: CLASS_ID, schoolId: SCHOOL_A, name: 'Standard 4A', formTeacherId: null, studentCount: 0 }];
  mockStreamDocs = [];
  mockAssignments = [
    { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_math' },
  ];
  mockTimetableDocs = [];
  mockStudentDocs = [];
  mockBehaviourDocs = [];
  mockAcademicYearDocs = [{
    id: 'ay_2026', schoolId: SCHOOL_A, name: '2026', isCurrent: true,
    terms: [{ startDate: '2026-09-02', endDate: '2026-12-11' }],
  }];
  // Real attendance documents carry `date`, never `academicYear`.
  mockAttendanceDocs = [];
});

describe('GET /dashboard — myClasses[].attendancePct', () => {
  test('is computed from attendance within the current term, not by a nonexistent academicYear field', async () => {
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, date: '2026-10-20', status: 'present' },
      { schoolId: SCHOOL_A, classId: CLASS_ID, date: '2026-10-21', status: 'absent' },
      // Before the current term — must be excluded from the % calc.
      { schoolId: SCHOOL_A, classId: CLASS_ID, date: '2026-01-05', status: 'present' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.status).toBe(200);
    const cls = res.body.data.myClasses.find(c => c.id === CLASS_ID);
    expect(cls).toBeTruthy();
    expect(cls.attendancePct).toBe(50); // 1 present / 2 in-term records
  });

  test('zero in-term attendance records gives 0%, not a crash', async () => {
    mockAttendanceDocs = [];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    const cls = res.body.data.myClasses.find(c => c.id === CLASS_ID);
    expect(cls.attendancePct).toBe(0);
  });
});

describe('GET /dashboard — atRiskStudents (3+ absences)', () => {
  test('a student with 3 in-term absences is flagged; an out-of-term absence does not count toward the threshold', async () => {
    mockStudentDocs = [
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei', classId: CLASS_ID, className: 'Standard 4A' },
    ];
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, studentId: 'stu_1', date: '2026-10-01', status: 'absent' },
      { schoolId: SCHOOL_A, classId: CLASS_ID, studentId: 'stu_1', date: '2026-10-05', status: 'absent' },
      { schoolId: SCHOOL_A, classId: CLASS_ID, studentId: 'stu_1', date: '2026-10-10', status: 'absent' },
      // Outside the current term — must not count toward the 3+ threshold.
      { schoolId: SCHOOL_A, classId: CLASS_ID, studentId: 'stu_1', date: '2026-01-02', status: 'absent' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    const risk = res.body.data.atRiskStudents.find(s => s.id === 'stu_1');
    expect(risk).toBeTruthy();
    expect(risk.absences).toBe(3);
  });

  test('2 in-term absences (below the 3+ threshold) is not flagged', async () => {
    mockStudentDocs = [
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei', classId: CLASS_ID, className: 'Standard 4A' },
    ];
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, studentId: 'stu_1', date: '2026-10-01', status: 'absent' },
      { schoolId: SCHOOL_A, classId: CLASS_ID, studentId: 'stu_1', date: '2026-10-05', status: 'absent' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.atRiskStudents.find(s => s.id === 'stu_1')).toBeUndefined();
  });
});
