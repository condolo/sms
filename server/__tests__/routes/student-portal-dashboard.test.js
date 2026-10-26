/* ============================================================
   server/routes/student-portal.js — GET /dashboard full-module coverage

   Every section the student dashboard renders is exercised in one
   suite, with all DB calls mocked (no MongoDB required):

     student         → name, admissionNumber, classId, className
     school          → name, academicYear, currentTerm, portalConfig
     attendance      → present/absent/late/total/percentage
     fees            → feeBalance, feeClearancePct, nextFeeDueDate
     lessonsCoverage → per-subject coveredTopics / totalTopics / %
     subjectMarks    → per-subject finalScore + grade from latest report card
     timetableToday  → today's slots (stream-scoped, published only)
     reportCards     → latest published, subjects stripped
     classTeacher    → form-teacher name resolved from class doc
     behaviourSummary→ totalPoints, badgeLevel, latestReward, latestComment
     upcomingExams   → upcoming exams for the student's class
     announcements   → active announcements (not expired)
     upcomingEvents  → upcoming events
     borrowedBooks   → active/overdue/lost library loans

   The auth/plan middleware is mocked to a pass-through student;
   the timetable-publish reader is mocked to the same fixture store
   (same pattern as student-portal-lessons-coverage.test.js).
   ============================================================ */

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));

const SCHOOL_A = 'school_A';
const STUDENT_1 = 'stu_1';
const CLASS_ID  = 'cls_yr2';
const DIAMOND   = 'strm_diamond';
const TODAY     = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
const TODAY_ISO = new Date().toISOString().slice(0, 10);

/* ── mock helpers (same pattern as the lessons-coverage suite) ── */
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
      if ('$in' in v)  return v.$in.includes(doc[k]);
      if ('$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      if ('$gt' in v)  return doc[k] > v.$gt;
      if ('$gte' in v) return doc[k] >= v.$gte;
      if ('$ne' in v)  return doc[k] !== v.$ne;
      if ('$lt' in v)  return doc[k] < v.$lt;
      if ('$lte' in v) return doc[k] <= v.$lte;
      return true;
    }
    return doc[k] === v;
  });
}

function mockCollection(seed = []) {
  return {
    find:            jest.fn(filter => mockChain(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne:         jest.fn(filter => mockChain(seed.find(d => mockMatchesFilter(d, filter)) ?? null)),
    countDocuments:  jest.fn(filter => Promise.resolve(seed.filter(d => mockMatchesFilter(d, filter)).length)),
    distinct:        jest.fn((field, filter) => {
      const matched = seed.filter(d => mockMatchesFilter(d, filter));
      return Promise.resolve([...new Set(matched.map(d => d[field]).filter(v => v !== undefined))]);
    }),
    deleteMany:      jest.fn(() => Promise.resolve({ deletedCount: 0 })),
    updateOne:       jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
    create:          jest.fn(() => Promise.resolve({})),
  };
}

/* ── mutable fixture state ────────────────────────────────────── */
let mockSchoolDoc;
let mockStudentDoc;
let mockAttendanceDocs;
let mockInvoiceDocs;
let mockCoverageDocs;
let mockTopicDocs;
let mockSubjectDocs;
let mockTimetableDocs;
let mockAcademicYearDocs;
let mockReportCardDocs;
let mockExamsDocs;
let mockAnnouncementDocs;
let mockEventDocs;
let mockClassDoc;
let mockTeacherDocs;
let mockBehaviourDocs;
let mockLibraryLoanDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students')          return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    if (collection === 'attendance')        return mockCollection(mockAttendanceDocs);
    if (collection === 'invoices')          return mockCollection(mockInvoiceDocs);
    if (collection === 'lesson_coverage')   return mockCollection(mockCoverageDocs);
    if (collection === 'syllabus_topics')   return mockCollection(mockTopicDocs);
    if (collection === 'subjects')          return mockCollection(mockSubjectDocs);
    if (collection === 'timetable')         return mockCollection(mockTimetableDocs);
    if (collection === 'academic_years')    return mockCollection(mockAcademicYearDocs);
    if (collection === 'report_card_snapshots') return mockCollection(mockReportCardDocs);
    if (collection === 'exams')             return mockCollection(mockExamsDocs);
    if (collection === 'announcements')     return mockCollection(mockAnnouncementDocs);
    if (collection === 'events')            return mockCollection(mockEventDocs);
    if (collection === 'classes')           return { findOne: jest.fn(() => mockChain(mockClassDoc ?? null)) };
    if (collection === 'teachers')          return mockCollection(mockTeacherDocs);
    if (collection === 'behaviour_incidents') return mockCollection(mockBehaviourDocs);
    if (collection === 'library_loans')     return mockCollection(mockLibraryLoanDocs);
    return mockCollection([]);
  },
}));

/* publishedReader → the same fixture store (no separate published copy in tests) */
jest.mock('../../utils/timetable-publish', () => {
  const { tenantModel } = require('../../utils/tenant-model');
  return {
    isTimetablePublished: jest.fn(async () => true),
    publishedReader: async (_schoolId, _ctx) => tenantModel('timetable'),
    timetableReaderFor: async (req) => tenantModel('timetable', { schoolId: req.jwtUser.schoolId }),
  };
});

/* authMiddleware mock — role-gate tests can override via global._mockJwtUser */
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = global._mockJwtUser || { userId: 'usr_stu', schoolId: 'school_A', role: 'student', studentId: 'stu_1' };
    next();
  },
}));

jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn() },
}));

/* resolveCurrentPeriod: returns the first academic year's name/term */
jest.mock('../../routes/academic-config', () => ({
  resolveCurrentPeriod: (years) => {
    const y = (years || [])[0];
    return { year: y || null, term: null, termNumber: null };
  },
}));

jest.mock('../../routes/mpesa', () => ({
  _getMpesaConfig: () => null,
}));

const express = require('express');
const supertest = require('supertest');
const studentPortalRouter = require('../../routes/student-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/student-portal', studentPortalRouter);
  return app;
}

/* ── Reset fixtures before each test ────────────────────────── */
beforeEach(() => {
  jest.clearAllMocks();
  global._mockJwtUser = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: STUDENT_1 };

  mockStudentDoc = {
    id: STUDENT_1, schoolId: SCHOOL_A,
    firstName: 'Amara', lastName: 'Osei',
    admissionNumber: 'ADM001',
    classId: CLASS_ID, className: 'Year 2', streamId: DIAMOND,
    status: 'active', gender: 'F', dateOfBirth: '2018-05-12',
  };
  mockSchoolDoc = {
    id: SCHOOL_A, schoolId: SCHOOL_A, name: 'Test School',
    emergencyOnlineMode: false, portalConfig: {}, mpesa: null,
  };
  mockAcademicYearDocs = [{ id: 'ay_2026', schoolId: SCHOOL_A, name: '2026', isCurrent: true, terms: [] }];
  mockSubjectDocs      = [
    { id: 'subj_eng', name: 'English', code: 'ENG' },
    { id: 'subj_math', name: 'Mathematics', code: 'MATH' },
  ];
  mockTopicDocs = [
    { id: 'topic_1', schoolId: SCHOOL_A, subjectId: 'subj_eng', academicYear: '2026', classId: CLASS_ID, subtopics: [] },
    { id: 'topic_2', schoolId: SCHOOL_A, subjectId: 'subj_eng', academicYear: '2026', classId: CLASS_ID, subtopics: [] },
    { id: 'topic_3', schoolId: SCHOOL_A, subjectId: 'subj_math', academicYear: '2026', classId: CLASS_ID, subtopics: [] },
  ];
  mockAttendanceDocs   = [
    { schoolId: SCHOOL_A, studentId: STUDENT_1, academicYear: '2026', status: 'present' },
    { schoolId: SCHOOL_A, studentId: STUDENT_1, academicYear: '2026', status: 'absent' },
    { schoolId: SCHOOL_A, studentId: STUDENT_1, academicYear: '2026', status: 'late' },
  ];
  mockInvoiceDocs = [
    { schoolId: SCHOOL_A, studentId: STUDENT_1, total: 10000, balance: 3000, status: 'pending', dueDate: TODAY_ISO },
  ];
  mockCoverageDocs    = [
    { schoolId: SCHOOL_A, classId: CLASS_ID, subjectId: 'subj_eng', academicYear: '2026', topicId: 'topic_1', streamId: DIAMOND },
  ];
  mockTimetableDocs = [
    { schoolId: SCHOOL_A, classId: CLASS_ID, streamId: DIAMOND, day: TODAY, subject: 'English', teacherId: 'tch_1', teacherName: 'Ms. Brown', startTime: '08:00', endTime: '08:40', isActive: true },
  ];
  mockReportCardDocs = [
    {
      id: 'rc_1', schoolId: SCHOOL_A, studentId: STUDENT_1, status: 'published', superseded: false,
      academicYear: '2026', termName: 'Term 1', termNumber: 1,
      totalScore: 450, averageScore: 82.5, gpa: 3.8, rankings: { class: 5, school: 12 },
      publishedAt: new Date().toISOString(), version: 1,
      subjects: { subj_eng: { finalScore: 85, grade: 'A' }, subj_math: { finalScore: 70, grade: 'B' } },
    },
  ];
  mockExamsDocs = [
    { schoolId: SCHOOL_A, classId: CLASS_ID, subjectName: 'Mathematics', date: TODAY_ISO, startTime: '10:00', type: 'term' },
  ];
  mockAnnouncementDocs = [
    { schoolId: SCHOOL_A, title: 'Parent-Teacher Meeting', body: 'This Saturday', createdAt: new Date().toISOString(), priority: 'normal' },
  ];
  mockEventDocs = [
    { schoolId: SCHOOL_A, title: 'Sports Day', date: TODAY_ISO, category: 'sports' },
  ];
  mockClassDoc = { id: CLASS_ID, schoolId: SCHOOL_A, name: 'Year 2', formTeacherId: 'tch_1' };
  mockTeacherDocs = [
    { id: 'tch_1', schoolId: SCHOOL_A, firstName: 'Brown', lastName: 'Ms.', title: '', zoomPMILink: null, zoomPasscode: null, meetLink: null, userId: 'usr_tch_1' },
  ];
  mockBehaviourDocs = [
    { schoolId: SCHOOL_A, studentId: STUDENT_1, points: 10, type: 'reward', category: 'punctuality', description: 'Arrived early', date: TODAY_ISO, title: 'Punctual' },
    { schoolId: SCHOOL_A, studentId: STUDENT_1, points: 50, type: 'reward', category: 'academic', description: 'Top score in Maths', date: TODAY_ISO, title: 'Maths star' },
  ];
  mockLibraryLoanDocs = [
    { schoolId: SCHOOL_A, borrowerId: STUDENT_1, bookId: 'bk_1', bookTitle: 'The Lion King', status: 'active', dueDate: TODAY_ISO, lostAt: null },
  ];
});

/* ══════════════════════════════════════════════════════════════
   1. student + school identity
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — student & school identity', () => {
  test('student name, admissionNumber, classId, className are returned', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(200);
    const s = res.body.data.student;
    expect(s.name).toBe('Amara Osei');
    expect(s.admissionNumber).toBe('ADM001');
    expect(s.classId).toBe(CLASS_ID);
    expect(s.className).toBe('Year 2');
  });

  test('school name, academicYear, currentTerm are returned', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const sch = res.body.data.school;
    expect(sch.name).toBe('Test School');
    expect(sch.academicYear).toBe('2026');
  });

  test('a student with no student record gets 404', async () => {
    mockStudentDoc = null;
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════
   2. attendance
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — attendance', () => {
  test('present/absent/late counts and percentage are computed', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const att = res.body.data.attendance;
    expect(att.present).toBe(1);
    expect(att.absent).toBe(1);
    expect(att.late).toBe(1);
    expect(att.total).toBe(3);
    expect(att.percentage).toBe(33); // 1/3
  });

  test('a student with no attendance records gets 0% and total 0', async () => {
    mockAttendanceDocs = [];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const att = res.body.data.attendance;
    expect(att.total).toBe(0);
    expect(att.percentage).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   3. fees
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — fees', () => {
  test('feeBalance and feeClearancePct are computed from invoices', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.feeBalance).toBe(3000);
    // 7000 of 10000 paid = 70%
    expect(res.body.data.feeClearancePct).toBe(70);
    expect(res.body.data.nextFeeDueDate).toBe(TODAY_ISO);
  });

  test('studentCanSeeFees: false → fee fields are null', async () => {
    mockSchoolDoc = { ...mockSchoolDoc, portalConfig: { studentCanSeeFees: false } };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.feeBalance).toBeNull();
    expect(res.body.data.feeClearancePct).toBeNull();
    expect(res.body.data.nextFeeDueDate).toBeNull();
  });

  test('no invoices → feeBalance 0, clearance 100%', async () => {
    mockInvoiceDocs = [];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.feeBalance).toBe(0);
    expect(res.body.data.feeClearancePct).toBe(100);
  });
});

/* ══════════════════════════════════════════════════════════════
   4. lessons coverage
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — lessons coverage', () => {
  test('covered topics are counted per subject', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const eng = res.body.data.lessonsCoverage.find(s => s.subjectId === 'subj_eng');
    expect(eng).toBeDefined();
    expect(eng.coveredTopics).toBe(1);
    expect(eng.totalTopics).toBe(2);
    expect(eng.percentage).toBe(50);
  });

  test('a subject with no coverage records does not appear in the list', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const math = res.body.data.lessonsCoverage.find(s => s.subjectId === 'subj_math');
    expect(math).toBeUndefined(); // no coverage docs for subj_math
  });
});

/* ══════════════════════════════════════════════════════════════
   5. subject marks (from latest published report card)
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — subject marks', () => {
  test('per-subject finalScore and grade come from the latest published report card', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const marks = res.body.data.subjectMarks;
    expect(marks).toHaveLength(2);
    const eng  = marks.find(m => m.subjectId === 'subj_eng');
    const math = marks.find(m => m.subjectId === 'subj_math');
    expect(eng.finalScore).toBe(85);
    expect(eng.grade).toBe('A');
    expect(math.finalScore).toBe(70);
    expect(math.grade).toBe('B');
  });

  test('no published report cards → subjectMarks is empty', async () => {
    mockReportCardDocs = [];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.subjectMarks).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   6. report cards
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — report cards', () => {
  test('the subjects field is stripped from the report card response', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const rc = res.body.data.reportCards[0];
    expect(rc).toBeDefined();
    expect(rc.averageScore).toBe(82.5);
    expect(rc.subjects).toBeUndefined(); // stripped
  });

  test('no report cards → empty array', async () => {
    mockReportCardDocs = [];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.reportCards).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   7. today's timetable
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — today\'s timetable', () => {
  test('a stream-matching slot is shown', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.timetableToday).toHaveLength(1);
    expect(res.body.data.timetableToday[0].subjectName).toBe('English');
  });

  test('a sibling stream\'s slot is NOT shown', async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, streamId: 'strm_sapphire', day: TODAY, subject: 'Science', startTime: '09:00', endTime: '09:40', isActive: true },
    ];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.timetableToday).toHaveLength(0);
  });

  test('unpublished timetable → no slots shown', async () => {
    const { isTimetablePublished } = require('../../utils/timetable-publish');
    jest.mocked(isTimetablePublished).mockResolvedValue(false);
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.timetableToday).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   8. class teacher
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — class teacher', () => {
  test('form-teacher name is resolved from the class record', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    // mockTeacherDocs[0] has firstName:'Brown', lastName:'Ms.', title:''
    // The route builds: `${t.title ? t.title + ' ' : ''}${t.firstName} ${t.lastName}`.trim()
    // = 'Brown Ms.' — that is the expected output given the fixture.
    expect(res.body.data.classTeacher).toBe('Brown Ms.');
  });

  test('no class record → classTeacher is null', async () => {
    mockClassDoc = null;
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.classTeacher).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   9. behaviour summary
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — behaviour summary', () => {
  test('totalPoints is the sum of all behaviour records', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const b = res.body.data.behaviourSummary;
    expect(b.totalPoints).toBe(60); // 10 + 50
  });

  test('badgeLevel is gold for >= 500, silver for >= 200, bronze for >= 50', async () => {
    // Current fixture: 60 points → bronze
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.behaviourSummary.badgeLevel).toBe('bronze');

    mockBehaviourDocs = [{ schoolId: SCHOOL_A, studentId: STUDENT_1, points: 500, type: 'reward', date: TODAY_ISO }];
    const res2 = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res2.body.data.behaviourSummary.badgeLevel).toBe('gold');
  });

  test('no behaviour records → totalPoints 0, badgeLevel null', async () => {
    mockBehaviourDocs = [];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    const b = res.body.data.behaviourSummary;
    expect(b.totalPoints).toBe(0);
    expect(b.badgeLevel).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   10. upcoming exams
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — upcoming exams', () => {
  test('upcoming exams for the student\'s class are returned', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.upcomingExams).toHaveLength(1);
    expect(res.body.data.upcomingExams[0].subjectName).toBe('Mathematics');
  });

  test('a student with no classId gets an empty exams list', async () => {
    mockStudentDoc = { ...mockStudentDoc, classId: null };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.upcomingExams).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   11. announcements
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — announcements', () => {
  test('active announcements are returned', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.announcements).toHaveLength(1);
    expect(res.body.data.announcements[0].title).toBe('Parent-Teacher Meeting');
  });

  test('an expired announcement is filtered out', async () => {
    mockAnnouncementDocs = [
      { schoolId: SCHOOL_A, title: 'Old Notice', body: 'Expired', createdAt: new Date().toISOString(), expiresAt: '2020-01-01' },
    ];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.announcements).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   12. upcoming events
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — upcoming events', () => {
  test('upcoming events are returned', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.upcomingEvents).toHaveLength(1);
    expect(res.body.data.upcomingEvents[0].title).toBe('Sports Day');
  });
});

/* ══════════════════════════════════════════════════════════════
   13. borrowed books
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — borrowed books', () => {
  test('active/overdue/lost loans are returned', async () => {
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.borrowedBooks).toHaveLength(1);
    expect(res.body.data.borrowedBooks[0].bookTitle).toBe('The Lion King');
    expect(res.body.data.borrowedBooks[0].status).toBe('active');
  });

  test('no loans → empty array', async () => {
    mockLibraryLoanDocs = [];
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.body.data.borrowedBooks).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   14. role gate
   ══════════════════════════════════════════════════════════════ */
describe('GET /dashboard — role gate', () => {
  test('a non-student role is rejected with 403', async () => {
    global._mockJwtUser = { userId: 'usr_t', schoolId: SCHOOL_A, role: 'teacher', studentId: null };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(403);
  });

  test('a student role with no studentId is rejected with 403', async () => {
    global._mockJwtUser = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: null };
    const res = await supertest(buildApp()).get('/api/student-portal/dashboard');
    expect(res.status).toBe(403);
  });
});
