/* ============================================================
   GET /api/assessment/mark-list — "MarkList" (2026-10-18)

   Raised directly: an exam officer had to open the Markbook one subject
   at a time to find whose marks were missing for a sitting. This shows
   every subject for a class as columns in one table: blank when a
   student isn't enrolled in an elective, MISSING when they are enrolled
   but no mark exists yet.

   Fixture: class cls_1 has students stu_A (stream strm_X) and stu_B
   (stream strm_Y). Subjects: 'math' (compulsory), 'art' (elective,
   stu_A enrolled, stu_B not). Teacher t1 teaches math in strm_X only.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';
let mockUser = null;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { ...mockUser }; next(); },
}));
const mockHasExplicitSubGrant = jest.fn(async () => false);
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: (...args) => mockHasExplicitSubGrant(...args),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));

let mockDb = {};
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(val);
      if ('$nin' in v) return !v.$nin.includes(val);
    }
    return val === v;
  });
}
function mockMakeStore(col) {
  const rows = () => mockDb[col] || [];
  const chain = (result) => ({ select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) });
  return {
    find:    (f) => chain(rows().filter(d => mockMatches(d, f))),
    findOne: (f) => chain(rows().find(d => mockMatches(d, f)) ?? null),
  };
}
jest.mock('../../utils/tenant-model', () => {
  const actual = jest.requireActual('../../utils/tenant-model');
  return { ...actual, tenantModel: (col) => mockMakeStore(col) };
});

const express = require('express');
const supertest = require('supertest');
const assessmentRouter = require('../../routes/assessment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assessment', assessmentRouter);
  return app;
}

beforeEach(() => {
  mockHasExplicitSubGrant.mockResolvedValue(false);
  mockDb = {
    students: [
      { id: 'stu_A', schoolId: SCHOOL, classId: 'cls_1', streamId: 'strm_X', status: 'active', firstName: 'Amy', lastName: 'A', admissionNumber: 'A1' },
      { id: 'stu_B', schoolId: SCHOOL, classId: 'cls_1', streamId: 'strm_Y', status: 'active', firstName: 'Bob', lastName: 'B', admissionNumber: 'B1' },
    ],
    class_subjects: [
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'math', isCompulsoryForClass: true },
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'art',  isCompulsoryForClass: false },
    ],
    subjects: [
      { id: 'math', schoolId: SCHOOL, code: 'MAT', name: 'Mathematics' },
      { id: 'art',  schoolId: SCHOOL, code: 'ART', name: 'Art' },
    ],
    student_subjects: [
      { schoolId: SCHOOL, studentId: 'stu_A', subjectId: 'art' }, // only stu_A takes Art
    ],
    teaching_assignments: [
      { schoolId: SCHOOL, teacherId: 'usr_t1', classId: 'cls_1', subjectId: 'math', streamId: 'strm_X' },
    ],
    assessment_marks: [
      { schoolId: SCHOOL, classId: 'cls_1', subjectId: 'math', studentId: 'stu_A', termNumber: 1, assessmentType: 'MT', instance: 1, rawScore: 80, markState: 'present', isPublished: true },
      // stu_B has NO math mark — should show MISSING.
      // stu_A has NO art mark — should show MISSING (enrolled, no score).
      // stu_B is not enrolled in art at all — should show null (blank).
    ],
  };
});

const url = (q) => `/api/assessment/mark-list?${new URLSearchParams(q).toString()}`;

describe('GET /api/assessment/mark-list — floor role (admin) sees every subject', () => {
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_admin', role: 'admin' }; });

  test('returns both subjects, correct missing/blank/present cells', async () => {
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    expect(res.status).toBe(200);
    const { subjects, cells } = res.body.data;
    expect(subjects.map(s => s.code).sort()).toEqual(['ART', 'MAT']);

    expect(cells.stu_A.math).toEqual({ rawScore: 80, markState: 'present' });
    expect(cells.stu_B.math).toEqual({ rawScore: null, markState: 'MISSING' }); // enrolled (compulsory), no mark
    expect(cells.stu_A.art).toEqual({ rawScore: null, markState: 'MISSING' });  // enrolled elective, no mark
    expect(cells.stu_B.art).toBeNull(); // not enrolled in the elective — blank, not flagged
  });
});

describe('GET /api/assessment/mark-list — stays in sync with Report Cards (2026-10-18)', () => {
  // Raised directly: "I don't want to see marks in report or markbook
  // yet it's missing in MarkList." academic-calc.js's aggregateAssessmentMarks
  // (what Report Cards actually reads) filters isPublished:true — a mark
  // that fails that filter is invisible to the report card's own grade
  // calculation. This proves MarkList uses the identical filter, so it
  // can never claim "present" for something the report card silently
  // excludes.
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_admin', role: 'admin' }; });

  test('an unpublished mark (isPublished:false) shows MISSING, not present — matching what the report card would compute', async () => {
    mockDb.assessment_marks.push({
      schoolId: SCHOOL, classId: 'cls_1', subjectId: 'art', studentId: 'stu_A',
      termNumber: 1, assessmentType: 'MT', instance: 1, rawScore: 90, markState: 'present', isPublished: false,
    });
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    expect(res.body.data.cells.stu_A.art).toEqual({ rawScore: null, markState: 'MISSING' });
  });
});

describe('GET /api/assessment/mark-list — excludes a deactivated student, same default as every other roster', () => {
  // Raised directly: this route only ever excluded withdrawn/graduated, so
  // a suspended, inactive, or transferred student still showed up here
  // even though they're correctly hidden from Attendance, the Markbook's
  // own roster, and the Report Cards picker (classes.js/streams.js GET
  // /:id/students, both fixed to default to status:'active' — see their
  // own comments). Covers every non-active status, not just the two this
  // used to check.
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_admin', role: 'admin' }; });

  test.each(['inactive', 'suspended', 'transferred', 'withdrawn', 'graduated'])(
    'a %s student is excluded entirely, not just absent from a cell',
    async (status) => {
      mockDb.students.push({
        id: 'stu_C', schoolId: SCHOOL, classId: 'cls_1', streamId: 'strm_X', status,
        firstName: 'Cam', lastName: 'C', admissionNumber: 'C1',
      });
      const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
      expect(res.status).toBe(200);
      expect(res.body.data.cells.stu_C).toBeUndefined();
    }
  );

  test('an active student is unaffected', async () => {
    mockDb.students.push({
      id: 'stu_C', schoolId: SCHOOL, classId: 'cls_1', streamId: 'strm_X', status: 'active',
      firstName: 'Cam', lastName: 'C', admissionNumber: 'C1',
    });
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    expect(res.body.data.cells.stu_C).toBeDefined();
  });
});

describe('GET /api/assessment/mark-list/export — CSV matches the on-screen view exactly', () => {
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_admin', role: 'admin' }; });

  test('downloads a CSV with the same present/MISSING/blank cells as the JSON view', async () => {
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }).replace('/mark-list?', '/mark-list/export?'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="msingi_mark_list_/);
    const body = res.text.replace(/^﻿/, '');
    const lines = body.split('\r\n');
    expect(lines[0]).toBe('Student,Admission No,ART,MAT');
    const stuARow = lines.find(l => l.startsWith('Amy A,'));
    expect(stuARow).toBe('Amy A,A1,MISSING,80');
    const stuBRow = lines.find(l => l.startsWith('Bob B,'));
    expect(stuBRow).toBe('Bob B,B1,,MISSING'); // blank for not-enrolled art, MISSING for compulsory math
  });
});

describe('GET /api/assessment/mark-list — plain teacher sees only subjects they teach', () => {
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_t1', role: 'teacher' }; });

  test('only math appears (their own assignment) — art is someone else\'s subject, not shown', async () => {
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    expect(res.status).toBe(200);
    const { subjects } = res.body.data;
    expect(subjects.map(s => s.code)).toEqual(['MAT']);
  });

  test('their math assignment is stream-scoped to strm_X — stu_B (strm_Y) does not appear as missing for it', async () => {
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    const { cells } = res.body.data;
    expect(cells.stu_A.math).toEqual({ rawScore: 80, markState: 'present' });
    expect(cells.stu_B.math).toBeNull(); // outside this teacher's own stream assignment for math
  });

  test('the explicit reports__mark_list_school_wide grant widens them to everything', async () => {
    mockHasExplicitSubGrant.mockResolvedValue(true);
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    const { subjects, cells } = res.body.data;
    expect(subjects.map(s => s.code).sort()).toEqual(['ART', 'MAT']);
    expect(cells.stu_B.math).toEqual({ rawScore: null, markState: 'MISSING' }); // now visible, outside their stream
  });
});

describe('GET /api/assessment/mark-list — hod (management, but not in ASSESSMENT_FLOOR_ROLES) still sees everything', () => {
  // Regression test for a bug caught during review: taughtPairs() returns
  // null for any isManagement role (hod included) to mean "sees
  // everything" — naively treating that null as an empty pairs list would
  // have filtered every subject out instead, showing hod a blank table.
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_hod', role: 'hod' }; });

  test('hod sees both subjects, not zero', async () => {
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1', termNumber: 1, assessmentType: 'MT' }));
    expect(res.status).toBe(200);
    const { subjects } = res.body.data;
    expect(subjects.map(s => s.code).sort()).toEqual(['ART', 'MAT']);
  });
});

describe('GET /api/assessment/mark-list — validation', () => {
  beforeEach(() => { mockUser = { schoolId: SCHOOL, userId: 'usr_admin', role: 'admin' }; });

  test('missing required params is a 400', async () => {
    const res = await supertest(buildApp()).get(url({ classId: 'cls_1' }));
    expect(res.status).toBe(400);
  });
});
