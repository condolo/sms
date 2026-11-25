/* ============================================================
   Records saved before a class had streams (v5.282.1)

   Found auditing v5.282.0: marks and registers carry the stream the
   student had when they were saved. Saved before the class had a stream,
   they carry none, and a teacher whose assignment is for one stream was
   shown only records stamped with it: the Markbook looked empty, inviting
   the marks to be typed again over the saved ones.

   Pins, with the real scope engine and the real access loader:
     - a stream teacher sees unstamped records of the students now in their
       stream, and of nobody else (another stream, no stream, another class,
       another school, another subject's marks);
     - a whole-class teacher and management are unchanged.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); } }));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => false), hasPermission: jest.fn(async () => false),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));
jest.mock('../../middleware/scopeMiddleware', () => {
  const actual = jest.requireActual('../../middleware/scopeMiddleware');
  return {
    ...actual,
    scopeMiddleware: async (req, _res, next) => {
      req.scope = req.jwtUser.role === 'teacher'
        ? { level: 'assigned', userId: req.jwtUser.userId, ...(await actual._loadAssigned(req.jwtUser.userId, req.jwtUser.schoolId)) } : null;
      next();
    },
  };
});

const express = require('express');
const supertest = require('supertest');
const assessment = require('../../routes/assessment');
const indicatorMarks = require('../../routes/indicator-marks');
const attendance = require('../../routes/attendance');

const S = 'school_A';
const teacher = (userId) => ({ userId, schoolId: S, role: 'teacher', roles: ['teacher'] });
const RUBY = teacher('u_ruby'); const WHOLE = teacher('u_whole');
const ADMIN = { userId: 'u_ad', schoolId: S, role: 'admin', roles: ['admin'] };
function app() {
  const a = express(); a.use(express.json());
  a.use('/api/assessment', assessment); a.use('/api/indicator-marks', indicatorMarks); a.use('/api/attendance', attendance);
  return a;
}
const get = async (user, url) => { mockJwtUser = user; const r = await supertest(app()).get(url); return r.status === 200 ? r.body.data.map(d => d.id).sort() : r.status; };

const rec = (id, studentId, streamId, extra = {}) => ({ id, schoolId: S, studentId, classId: 'kg1', streamId, subjectId: 'cre', termNumber: 3, cycle: null, date: '2026-11-02', ...extra });
const records = (p) => [
  rec(`${p}old`, 's1', null),                          // before the stream existed; now in Ruby
  rec(`${p}new`, 's1', 'ruby', { termNumber: 2 }),
  rec(`${p}other`, 's2', null),                        // now in Opal
  rec(`${p}opal`, 's2', 'opal', { termNumber: 2 }),
  rec(`${p}none`, 's3', null),                         // in no stream
  rec(`${p}lastyear`, 's1', null, { classId: 'kg0' }), // the same child's earlier class
  rec(`${p}art`, 's1', null, { subjectId: 'art' }),
  rec(`${p}b`, 's1', null, { schoolId: 'school_B' }),
];
beforeEach(() => {
  mockDb = createFakeDb({
    classes: [{ id: 'kg1', schoolId: S, name: 'KG1' }, { id: 'kg0', schoolId: S, name: 'KG0' }],
    streams: [{ id: 'ruby', schoolId: S, classId: 'kg1', status: 'active' }, { id: 'opal', schoolId: S, classId: 'kg1', status: 'active' }],
    students: [
      { id: 's1', schoolId: S, classId: 'kg1', streamId: 'ruby' }, { id: 's2', schoolId: S, classId: 'kg1', streamId: 'opal' },
      { id: 's3', schoolId: S, classId: 'kg1', streamId: null },
    ],
    class_subjects: [], teachers: [], users: [], timetable: [],
    teaching_assignments: [
      { id: 'a1', schoolId: S, classId: 'kg1', subjectId: 'cre', teacherId: 'u_ruby', streamId: 'ruby' },
      { id: 'a2', schoolId: S, classId: 'kg1', subjectId: 'cre', teacherId: 'u_whole', streamId: null },
    ],
    assessment_marks: records('m'), indicator_marks: records('i'),
    attendance: records('r').filter(r => r.subjectId === 'cre').map(r => ({ ...r, subjectId: null, status: 'present' })),
  });
});

describe.each([['marks', '/api/assessment/marks', 'm'], ['KG marks', '/api/indicator-marks', 'i']])('%s', (_n, url, p) => {
  test('a stream teacher sees their students\' earlier marks in the class, and nobody else\'s', async () => {
    expect(await get(RUBY, `${url}?classId=kg1&subjectId=cre`)).toEqual([`${p}new`, `${p}old`]);
  });
  test('the same without a class filter', async () => {
    expect(await get(RUBY, url)).toEqual([`${p}new`, `${p}old`]);
  });
  test('a whole-class teacher and management are unchanged', async () => {
    const all = ['new', 'none', 'old', 'opal', 'other'].map(x => p + x);
    expect(await get(WHOLE, `${url}?classId=kg1&subjectId=cre`)).toEqual(all);
    expect(await get(ADMIN, `${url}?classId=kg1&subjectId=cre`)).toEqual(all);
  });
  test('a teacher of nothing here sees nothing', async () => {
    expect(await get(teacher('u_none'), `${url}?classId=kg1&subjectId=cre`)).toEqual([]);
  });
});

describe('class register', () => {
  test.each([['/api/attendance?classId=kg1'], ['/api/attendance?classId=kg1&streamId=ruby'], ['/api/attendance']])('%s', async (url) => {
    expect(await get(RUBY, url)).toEqual(['rnew', 'rold']);
  });
  test('asking for another stream still shows nothing', async () => {
    expect(await get(RUBY, '/api/attendance?classId=kg1&streamId=opal')).toEqual([]);
  });
});
