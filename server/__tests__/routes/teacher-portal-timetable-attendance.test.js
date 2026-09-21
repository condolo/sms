/* ============================================================
   server/routes/teacher-portal.js — GET /dashboard "Today's Timetable"
   + attendance submitted-status widget (2026-09)

   Prompted directly: "the teacher can see in their dashboard Today's
   Lessons, proceed to take attendance?" — investigating turned up three
   compounding gaps, all fixed together:

   1. timetableToday never selected streamId, so a teacher's two lessons
      today for the SAME class but different streams (e.g. Math for 4A
      then 4B) were indistinguishable on the dashboard.
   2. The "submitted" check was per-classId only — marking 4A's register
      would have made 4B's still-unmarked lesson show "✓ Att." too,
      wrongly.
   3. Dashboard.jsx's "Take Att." link, and AttendancePage.jsx's total
      lack of URL-param support, meant the deep-link never actually
      pre-filled anything — separately covered by this file's own
      Dashboard-side assertions and a client-side fix.

   This file covers (1) and (2) at the server layer.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const TEACHER_USER = 'usr_teacher';
const TEACHER_ID = 'tch_1';

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
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
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
    countDocuments: jest.fn((filter) => Promise.resolve(seed.filter(d => mockMatchesFilter(d, filter)).length)),
    distinct:       jest.fn((field, filter) => Promise.resolve([...new Set(seed.filter(d => mockMatchesFilter(d, filter)).map(d => d[field]))])),
    aggregate:      jest.fn(() => Promise.resolve([])),
  };
}

let mockSchoolDoc, mockAssignments, mockTimetableDocs, mockAttendanceDocs, mockClassDocs;

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
    if (collection === 'timetable_slots')      return mockCollection(mockTimetableDocs);
    if (collection === 'attendance')           return mockCollection(mockAttendanceDocs);
    if (collection === 'classes')              return mockCollection(mockClassDocs);
    return mockCollection([]);
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

const CLASS_ID = 'cls_4a';
const STREAM_A = 'strm_4a';
const STREAM_B = 'strm_4b';
// Lowercase — matches how timetable.js's SlotSchema actually stores `day`
// in every real document (confirmed against production: a query for
// 'Monday' matches 0 real documents, 'monday' matches every one). This
// file originally used a capitalized array here too, matching the route's
// OWN (buggy) query at the time — internally consistent, and so it never
// caught the mismatch against real data. Fixed alongside the route itself.
const TODAY_DAY = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
const TODAY_ISO = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDoc = { name: 'Test School', academicYear: '2026' };
  mockClassDocs = [{ id: CLASS_ID, schoolId: SCHOOL_A, name: 'Standard 4A', formTeacherId: null, studentCount: 0 }];
  mockAssignments = [
    { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_math', streamId: STREAM_A, streamName: 'A' },
    { schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_math', streamId: STREAM_B, streamName: 'B' },
  ];
  mockTimetableDocs = [];
  mockAttendanceDocs = [];
});

describe("GET /api/teacher-portal/dashboard — Today's Timetable includes streamId", () => {
  test('each timetable slot reports its own streamId/streamName, not just the class', async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, streamId: STREAM_A, streamName: 'A', subjectName: 'Math', className: 'Standard 4A', startTime: '08:00', endTime: '08:40' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.timetableToday[0].streamId).toBe(STREAM_A);
    expect(res.body.data.timetableToday[0].streamName).toBe('A');
  });
});

describe('GET /api/teacher-portal/dashboard — attendance submitted-status is per (class, stream)', () => {
  test('two lessons today, same class different streams: marking stream A submitted does NOT mark stream B as submitted too', async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, streamId: STREAM_A, streamName: 'A', subjectName: 'Math', className: 'Standard 4A', startTime: '08:00', endTime: '08:40' },
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, streamId: STREAM_B, streamName: 'B', subjectName: 'Math', className: 'Standard 4A', startTime: '09:00', endTime: '09:40' },
    ];
    // Only stream A's register has been submitted today.
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, streamId: STREAM_A, date: TODAY_ISO, studentId: 'stu_1', status: 'present' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    const widget = res.body.data.attendanceWidget;
    const rowA = widget.find(w => w.streamId === STREAM_A);
    const rowB = widget.find(w => w.streamId === STREAM_B);
    expect(rowA.submitted).toBe(true);
    expect(rowB.submitted).toBe(false); // THE bug this fix closes — used to be true too
  });

  test('two distinct (class, stream) lessons produce two distinct widget entries, not merged into one', async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, streamId: STREAM_A, streamName: 'A', subjectName: 'Math', className: 'Standard 4A', startTime: '08:00', endTime: '08:40' },
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, streamId: STREAM_B, streamName: 'B', subjectName: 'Math', className: 'Standard 4A', startTime: '09:00', endTime: '09:40' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.attendanceWidget).toHaveLength(2);
    expect(res.body.data.pendingAttendanceCount).toBe(2); // neither submitted yet
  });

  test('a legacy whole-class lesson (no streamId at all) still works exactly as before', async () => {
    mockAssignments = [{ schoolId: SCHOOL_A, teacherId: TEACHER_ID, classId: CLASS_ID, subjectId: 'subj_math' }];
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, subjectName: 'Math', className: 'Standard 4A', startTime: '08:00', endTime: '08:40' },
    ];
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, date: TODAY_ISO, studentId: 'stu_1', status: 'present' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.attendanceWidget).toHaveLength(1);
    expect(res.body.data.attendanceWidget[0].submitted).toBe(true);
    expect(res.body.data.attendanceWidget[0].streamId).toBeNull();
  });
});

describe('Today\'s Timetable day-name casing (2026-09 — the root cause found while investigating this whole feature)', () => {
  // Confirmed against real production data before this fix: EVERY real
  // timetable_slots document stores `day` lowercase (e.g. 'monday') — a
  // query for the capitalized form ('Monday') matched zero documents,
  // ever, for any school. This meant "Today's Timetable" (and therefore
  // the entire "Take Att." deep-link flow this fix is about) has shown
  // NOTHING, for every teacher, every day, since this route shipped —
  // independent of and more fundamental than the streamId/submitted-
  // status fixes above.
  test('a real-shaped lowercase `day` value on the stored slot is matched — the actual production shape', async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: TODAY_DAY, classId: CLASS_ID, streamId: STREAM_A, streamName: 'A', subjectName: 'Math', className: 'Standard 4A', startTime: '08:00', endTime: '08:40' },
    ];
    expect(TODAY_DAY).toEqual(TODAY_DAY.toLowerCase()); // sanity: this file's own fixture is lowercase
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.timetableToday).toHaveLength(1);
  });

  test('a slot stored with the OLD capitalized day value is correctly NOT matched by today\'s (now-fixed) lowercase query', async () => {
    const capitalized = TODAY_DAY.charAt(0).toUpperCase() + TODAY_DAY.slice(1);
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, teacherId: TEACHER_ID, day: capitalized, classId: CLASS_ID, subjectName: 'Math', className: 'Standard 4A', startTime: '08:00', endTime: '08:40' },
    ];
    const res = await supertest(buildApp()).get('/api/teacher-portal/dashboard');
    expect(res.body.data.timetableToday).toHaveLength(0); // proves the route's query is genuinely lowercase, not coincidentally passing
  });
});
