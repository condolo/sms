/* ============================================================
   server/routes/parent-portal.js — GET /dashboard/:childId real
   per-subject marks

   Identical fix to student-portal-subject-marks.test.js — see that
   file's header for the full explanation. subjectMarks is sourced only
   from the most recently published report card's own `subjects`
   snapshot (never the live Markbook, which parent/student roles have
   no permission to read at all), and the raw per-type breakdown is
   stripped back out of the `reportCards` list sent to the client.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A    = 'school_A';
const CHILD_1     = 'stu_1';
const PARENT_USER = 'usr_parent';

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
    req.jwtUser = { userId: PARENT_USER, schoolId: SCHOOL_A, role: 'parent', studentIds: [CHILD_1], guardianOf: [] };
    next();
  },
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn() },
}));

function mockChain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c,
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
  };
  return c;
}
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockCollection(seed = []) {
  return {
    find:           jest.fn((filter) => mockChain(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne:        jest.fn(() => mockChain(seed[0] ?? null)),
    countDocuments: jest.fn(() => Promise.resolve(0)),
    distinct:       jest.fn(() => Promise.resolve([])),
  };
}

let mockSchoolDoc, mockStudentDoc, mockSubjectDocs, mockReportDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students')              return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    if (collection === 'subjects')               return mockCollection(mockSubjectDocs);
    if (collection === 'report_card_snapshots')  return mockCollection(mockReportDocs);
    return mockCollection([]);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const parentPortalRouter = require('../../routes/parent-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = {
    id: CHILD_1, schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei',
    admissionNumber: 'ADM001', classId: 'cls_yr2', className: 'Year 2', streamId: null, status: 'active',
  };
  mockSchoolDoc = { name: 'Test School', academicYear: '2026', portalConfig: {}, timetableStatus: { published: true } };
  mockSubjectDocs = [
    { id: 'subj_eng', schoolId: SCHOOL_A, name: 'English Language' },
    { id: 'subj_math', schoolId: SCHOOL_A, name: 'Mathematics' },
  ];
  mockReportDocs = [];
});

describe('GET /api/parent-portal/dashboard/:childId — subjectMarks (real marks, not coverage)', () => {
  test('resolves per-subject marks from the most recently published report card, with real subject names', async () => {
    mockReportDocs = [
      {
        id: 'rc_2', schoolId: SCHOOL_A, studentId: CHILD_1, status: 'published', superseded: false,
        academicYear: '2026', termNumber: 2, publishedAt: '2026-06-01', averageScore: 71,
        subjects: {
          subj_eng:  { finalScore: 68, grade: 'B' },
          subj_math: { finalScore: 74, grade: 'B+' },
        },
      },
      {
        id: 'rc_1', schoolId: SCHOOL_A, studentId: CHILD_1, status: 'published', superseded: false,
        academicYear: '2026', termNumber: 1, publishedAt: '2026-01-01', averageScore: 60,
        subjects: { subj_eng: { finalScore: 55, grade: 'C+' } },
      },
    ];
    const res = await supertest(buildApp()).get(`/api/parent-portal/dashboard/${CHILD_1}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subjectMarks).toEqual([
      { subjectId: 'subj_eng',  subjectName: 'English Language', finalScore: 68, grade: 'B' },
      { subjectId: 'subj_math', subjectName: 'Mathematics',      finalScore: 74, grade: 'B+' },
    ]);
  });

  test('the raw per-type `subjects` breakdown never reaches the client inside the reportCards list', async () => {
    mockReportDocs = [{
      id: 'rc_1', schoolId: SCHOOL_A, studentId: CHILD_1, status: 'published', superseded: false,
      academicYear: '2026', termNumber: 1, publishedAt: '2026-01-01', averageScore: 60,
      subjects: { subj_eng: { finalScore: 55, grade: 'C+' } },
    }];
    const res = await supertest(buildApp()).get(`/api/parent-portal/dashboard/${CHILD_1}`);
    expect(res.body.data.reportCards[0].id).toBe('rc_1');
    expect(res.body.data.reportCards[0].subjects).toBeUndefined();
  });

  test('no published report card yet — subjectMarks is empty, not an error', async () => {
    mockReportDocs = [];
    const res = await supertest(buildApp()).get(`/api/parent-portal/dashboard/${CHILD_1}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subjectMarks).toEqual([]);
  });
});
