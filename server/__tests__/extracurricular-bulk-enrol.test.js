/* ============================================================
   POST /api/extracurricular/enrolments/bulk

   One activity, the same dates, several students. Each gets their own
   enrolment. Everything is checked before anything is written; a student
   already enrolled in the activity is skipped and reported.
   ============================================================ */
'use strict';

function mockMakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  const matches = (doc, filter) => Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
  const chain = (result) => ({ select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) });
  return {
    _docs: () => docs,
    find:     (filter) => chain(docs.filter(d => matches(d, filter))),
    findOne:  (filter) => chain(docs.find(d => matches(d, filter)) || null),
    insertMany: jest.fn(async (list) => { docs.push(...list.map(d => ({ ...d }))); return list; }),
    create:   jest.fn(async (doc) => { docs.push({ ...doc }); return doc; }),
  };
}

let mockStores;
let mockCurrentUser;
let mockExplicitGrant;

jest.mock('../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => mockExplicitGrant),
  hasPermission: () => true,
}));
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));
jest.mock('../services/audit', () => ({ log: jest.fn() }));

const express = require('express');
const supertest = require('supertest');
const extracurricularRouter = require('../routes/extracurricular');

const SCHOOL = 'sch_1';
const KARATE = { id: 'act_k', schoolId: SCHOOL, name: 'Karate', amount: 6500, status: 'active' };
const STUDENTS = [
  { id: 'stu1', schoolId: SCHOOL, status: 'active', firstName: 'Ganat', lastName: 'Abdalrhman', admissionNumber: '17158' },
  { id: 'stu2', schoolId: SCHOOL, status: 'active', firstName: 'Ibrahim', lastName: 'Abdalrhman', admissionNumber: '17159' },
  { id: 'stu3', schoolId: SCHOOL, status: 'active', firstName: 'Zara', lastName: 'Adams', admissionNumber: '10192' },
];

function seed({ activities = [KARATE], enrolments = [] } = {}) {
  mockStores = {
    activities: mockMakeCollection(activities),
    students: mockMakeCollection(STUDENTS),
    activity_enrolments: mockMakeCollection(enrolments),
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/extracurricular', extracurricularRouter);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExplicitGrant = true;
  mockCurrentUser = { userId: 'usr_bursar', schoolId: SCHOOL, role: 'finance', roles: ['finance'] };
  seed();
});

describe('POST /enrolments/bulk', () => {
  test('each selected student gets their own enrolment with the same activity and dates', async () => {
    const res = await supertest(app()).post('/api/extracurricular/enrolments/bulk')
      .send({ activityId: 'act_k', startDate: '2026-10-05', students: [{ studentId: 'stu1' }, { studentId: 'stu3' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: 2, skipped: [] });
    const docs = mockStores.activity_enrolments._docs();
    expect(docs.map(d => d.studentId).sort()).toEqual(['stu1', 'stu3']);
    expect(docs.every(d => d.activityId === 'act_k' && d.activityName === 'Karate' && d.startDate === '2026-10-05' && d.status === 'active')).toBe(true);
    expect(docs.find(d => d.studentId === 'stu1').studentName).toBe('Ganat Abdalrhman');
    expect(new Set(docs.map(d => d.id)).size).toBe(2);
  });

  test('a student already enrolled in the activity is skipped and reported, not duplicated', async () => {
    seed({ enrolments: [{ id: 'e0', schoolId: SCHOOL, studentId: 'stu1', activityId: 'act_k', status: 'active' }] });
    const res = await supertest(app()).post('/api/extracurricular/enrolments/bulk')
      .send({ activityId: 'act_k', startDate: '2026-10-05', students: [{ studentId: 'stu1' }, { studentId: 'stu2' }] });
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.skipped).toEqual([{ studentId: 'stu1', reason: 'already enrolled in "Karate"' }]);
    expect(mockStores.activity_enrolments._docs().filter(d => d.studentId === 'stu1')).toHaveLength(1);
  });

  test('an inactive activity is refused and nothing is written', async () => {
    seed({ activities: [{ ...KARATE, status: 'inactive' }] });
    const res = await supertest(app()).post('/api/extracurricular/enrolments/bulk')
      .send({ activityId: 'act_k', startDate: '2026-10-05', students: [{ studentId: 'stu1' }] });
    expect(res.status).toBe(400);
    expect(mockStores.activity_enrolments.insertMany).not.toHaveBeenCalled();
  });

  test('a student who is not an active student of this school is refused and nothing is written', async () => {
    const res = await supertest(app()).post('/api/extracurricular/enrolments/bulk')
      .send({ activityId: 'act_k', startDate: '2026-10-05', students: [{ studentId: 'stu1' }, { studentId: 'ghost' }] });
    expect(res.status).toBe(422);
    expect(res.body.error.issues[0].message).toMatch(/ghost/);
    expect(mockStores.activity_enrolments.insertMany).not.toHaveBeenCalled();
  });

  test('an end date before the start date is refused', async () => {
    const res = await supertest(app()).post('/api/extracurricular/enrolments/bulk')
      .send({ activityId: 'act_k', startDate: '2026-10-05', endDate: '2026-09-01', students: [{ studentId: 'stu1' }] });
    expect(res.status).toBe(422);
  });

  test('without the explicit activities grant it is refused', async () => {
    mockExplicitGrant = false;
    const res = await supertest(app()).post('/api/extracurricular/enrolments/bulk')
      .send({ activityId: 'act_k', startDate: '2026-10-05', students: [{ studentId: 'stu1' }] });
    expect(res.status).toBe(403);
    expect(mockStores.activity_enrolments.insertMany).not.toHaveBeenCalled();
  });
});
