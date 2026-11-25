/* ============================================================
   Subject teachers' names are saved when a report is published (v5.284.0)

   The name beside a subject comment was looked up each time the report
   was opened, so a report published under one teacher showed the next
   one's name beside the first one's comment. Pins, through the real
   router and resolver:
     - publish saves each student's names, by their stream and subjects;
     - a later change of teacher doesn't alter a published report;
     - a subject with no teacher at publishing, and every report published
       before this, still follow the assignments;
     - publishing again: today's names, or the published ones on request;
     - the saved names are outside the integrity hash;
     - GET /publish-names: what would be saved, what would change, who may ask,
       and no other school's data.
   ============================================================ */
'use strict';

let mockJwtUser;
let mockMayPublish = true;
let mockCa;
let mockScores;
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); } }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: jest.fn(async () => mockMayPublish), hasPermission: jest.fn(async () => mockMayPublish) }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), isClassInScope: jest.fn(() => true), resolveAttendanceScope: jest.fn(), resolveAssessmentScope: jest.fn(), resolveHomeroomStreamIds: jest.fn().mockResolvedValue([]) }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue() }));
jest.mock('../../utils/ranking', () => ({
  rankStudents: jest.fn(() => []), mergeRankings: jest.fn(() => ({})), bestPerSubject: jest.fn(() => ({})), computeRankingScore: jest.fn(() => ({ rankingScore: 0, subjectsUsed: [] })),
}));
jest.mock('../../utils/academic-calc', () => ({
  aggregateAssessmentMarks: jest.fn().mockResolvedValue({}), aggregateUnmoderatedMarks: jest.fn().mockResolvedValue([]),
  computeFinalScores: jest.fn(() => JSON.parse(JSON.stringify(mockScores))),
  attendanceSummary: jest.fn().mockResolvedValue(null), behaviourSummary: jest.fn().mockResolvedValue(null),
  attachDeviations: jest.fn(x => x), computeTermDeviation: jest.fn(),
}));
jest.mock('../../routes/academic-config', () => ({
  mergeConfig: jest.fn(c => c ?? {}),
  resolveCurrentPeriod: jest.fn(() => ({ year: { id: 'year1', terms: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] } })),
  resolveGrade: jest.fn(() => ({ grade: 'C', points: null, descriptor: null, remarks: null })),
  OBSERVATION_RATING_VALUES: [], DEFAULT_GRADING_SCHEMA: [{ min: 50, grade: 'C' }, { min: 0, grade: 'D' }],
}));
jest.mock('../../routes/assessment', () => ({ getConfig: jest.fn(async () => mockCa) }));
jest.mock('../../routes/report-card-templates', () => ({ resolveTemplate: jest.fn().mockResolvedValue({ templateId: null, templateVersion: null, layoutKey: 'subject_paired' }) }));
jest.mock('mongoose', () => ({ startSession: jest.fn().mockRejectedValue(Object.assign(new Error('no replica set'), { code: 20 })), Types: { ObjectId: { isValid: () => false } } }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
let mockSeq = 0;
function mockModel(name) {
  const m = mockDb.model(name);
  return {
    ...m,
    bulkWrite: async (ops) => {
      for (const op of ops) {
        if (op.insertOne) mockDb.data[name].push(JSON.parse(JSON.stringify(op.insertOne.document)));
        if (op.updateOne) await m.updateOne(op.updateOne.filter, op.updateOne.update);
      }
      return {};
    },
    findOneAndUpdate: (filter, update) => ({ lean: async () => ({ ...filter, ...(update.$set || {}), seq: ++mockSeq }) }),
  };
}
jest.mock('../../utils/tenant-model', () => ({ tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }), tenantModel: (name) => mockModel(name) }));
jest.mock('../../utils/model', () => ({ _model: (name) => mockModel(name) }));

const express = require('express');
const supertest = require('supertest');
const router = require('../../routes/report-cards');

const S = 'sch_1';
const ADMIN = { userId: 'u_admin', schoolId: S, role: 'admin', roles: ['admin'] };
const api = (who = ADMIN) => { mockJwtUser = who; const a = express(); a.use(express.json()); a.use('/api/report-cards', router); return supertest(a); };
const BODY = { classId: 'c1', termId: 't2', academicYearId: 'year1', termNumber: 2 };
const asg = (id, subjectId, teacherName, streamId = null) => ({ id, schoolId: S, classId: 'c1', subjectId, teacherId: 'u_' + teacherName, teacherName, streamId, createdAt: `2026-01-0${id.length}` });
const result = (studentId, ...subs) => ({ studentId, subjects: Object.fromEntries(subs.map(s => [s, { average: 70 }])), totalScore: 70, averageScore: 70, gpa: null });

beforeEach(() => {
  mockMayPublish = true;
  mockCa = { customTypes: [{ key: 'ET', label: 'End of Term', weight: 100 }] };
  mockScores = { ann: result('ann', 'cre', 'art'), ben: result('ben', 'cre', 'fre') };
  const st = (id, streamId) => ({ id, schoolId: S, classId: 'c1', status: 'active', firstName: id, lastName: 'X', streamId });
  mockDb = createFakeDb({
    schools: [{ id: S, name: 'School', houses: [] }],
    sections: [{ id: 'sec', schoolId: S, key: 'primary' }],
    classes: [{ id: 'c1', schoolId: S, sectionKey: 'primary' }],
    grade_boundaries: [{ id: 'g', schoolId: S, sectionId: 'sec', isDefault: true, bands: [{ min: 50, grade: 'C' }, { min: 0, grade: 'D' }] }],
    students: [st('ann', 'ruby'), st('ben', 'pearl')],
    streams: [{ id: 'ruby', schoolId: S, classId: 'c1', name: 'Ruby' }, { id: 'pearl', schoolId: S, classId: 'c1', name: 'Pearl' }],
    subjects: [{ id: 'cre', schoolId: S, name: 'CRE' }, { id: 'art', schoolId: S, name: 'Art' }, { id: 'fre', schoolId: S, name: 'French' }],
    class_subjects: [
      { id: 'l1', schoolId: S, classId: 'c1', subjectId: 'cre', isCompulsoryForClass: true },
      { id: 'l2', schoolId: S, classId: 'c1', subjectId: 'art', isCompulsoryForClass: true },
      { id: 'l3', schoolId: S, classId: 'c1', subjectId: 'fre', isCompulsoryForClass: false },
    ],
    teaching_assignments: [asg('a', 'cre', 'Ms Kibi', 'ruby'), asg('ab', 'cre', 'Mr Pearl', 'pearl'), asg('abc', 'fre', 'Mme Faye')],
    report_card_snapshots: [],
    publish_batches: [],
    student_class_history: [],
  });
});

const snaps = () => mockDb.data.report_card_snapshots;
const current = (id) => snaps().find(s => s.studentId === id && !s.superseded);
const publish = async (extra = {}) => { const r = await api().post('/api/report-cards/publish').send({ ...BODY, ...extra }); expect(r.status).toBe(201); return r; };
const shown = async (id) => { mockJwtUser = ADMIN; return (await router._loadRenderExtras({ jwtUser: ADMIN }, S, current(id))).subjectTeacherNames; };
const setTeacher = (id, teacherName) => { const a = mockDb.data.teaching_assignments.find(x => x.id === id); a.teacherName = teacherName; a.teacherId = 'u_' + teacherName; };
const names = async (who) => api(who).get('/api/report-cards/publish-names').query({ classId: 'c1', termNumber: 2, academicYearId: 'year1' });

describe('publishing', () => {
  test('saves the names for each student: their stream, their subjects, no blanks', async () => {
    await publish();
    expect(current('ann').subjectTeacherNames).toEqual({ cre: 'Ms Kibi' });            // Art has no teacher
    expect(current('ben').subjectTeacherNames).toEqual({ cre: 'Mr Pearl', fre: 'Mme Faye' });
  });

  test('a later change of teacher, or removing them, leaves the published report as it was', async () => {
    await publish();
    setTeacher('a', 'Mr Otieno');
    expect((await shown('ann')).cre).toBe('Ms Kibi');
    mockDb.data.teaching_assignments = [];
    expect((await shown('ann')).cre).toBe('Ms Kibi');
    expect((await shown('ben')).fre).toBe('Mme Faye');
  });

  test('no teacher at publishing: the report shows one assigned later', async () => {
    await publish();
    mockDb.data.teaching_assignments.push(asg('abcd', 'art', 'Ms Art', 'ruby'));
    expect(await shown('ann')).toMatchObject({ cre: 'Ms Kibi', art: 'Ms Art' });
  });

  test('a report published before this follows the assignments, as it did', async () => {
    await publish();
    delete current('ann').subjectTeacherNames;
    setTeacher('a', 'Mr Otieno');
    expect((await shown('ann')).cre).toBe('Mr Otieno');
  });

  test('the names are not part of the integrity hash, and nothing published is edited', async () => {
    await publish();
    const first = JSON.stringify(current('ann'));
    setTeacher('a', 'Mr Otieno');
    await publish();
    const old = snaps().find(s => s.studentId === 'ann' && s.superseded);
    const { superseded, supersededAt, supersededBy, ...rest } = old;
    const { superseded: _s, ...was } = JSON.parse(first);
    expect(rest).toEqual(was);
    old.subjectTeacherNames = { cre: 'Someone Else' };
    const v = await api().get(`/api/report-cards/verify/${old.reportId}`);
    expect(v.status).toBe(200);
    expect(v.body.isAuthentic).toBe(true);
    old.totalScore = 99;   // proof the check itself works
    expect((await api().get(`/api/report-cards/verify/${old.reportId}`)).body.isAuthentic).toBe(false);
  });
});

describe('publishing again', () => {
  test('by default today\'s names are saved (the published one was wrong)', async () => {
    await publish();
    setTeacher('a', 'Mr Otieno');
    await publish();
    expect(current('ann').version).toBe(2);
    expect(current('ann').subjectTeacherNames.cre).toBe('Mr Otieno');
  });

  test('keepTeacherNames keeps the published ones, and still fills a subject that had none', async () => {
    await publish();
    setTeacher('a', 'Mr Otieno');
    mockDb.data.teaching_assignments.push(asg('abcd', 'art', 'Ms Art', 'ruby'));
    await publish({ keepTeacherNames: true });
    expect(current('ann').subjectTeacherNames).toEqual({ cre: 'Ms Kibi', art: 'Ms Art' });
  });

  test('keepTeacherNames with nothing published, or on an older report, saves today\'s', async () => {
    await publish({ keepTeacherNames: true });
    expect(current('ann').subjectTeacherNames).toEqual({ cre: 'Ms Kibi' });
    delete current('ann').subjectTeacherNames;
    setTeacher('a', 'Mr Otieno');
    await publish({ keepTeacherNames: true });
    expect(current('ann').subjectTeacherNames).toEqual({ cre: 'Mr Otieno' });
  });
});

describe('GET /publish-names', () => {
  test('lists what a publish would save, per stream where they differ, and subjects with no teacher', async () => {
    const r = await names();
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      shown: true, changes: [],
      subjects: [
        { subjectId: 'art', subject: 'Art', teachers: [{ stream: '', teacher: null }] },
        { subjectId: 'cre', subject: 'CRE', teachers: [{ stream: 'Ruby', teacher: 'Ms Kibi' }, { stream: 'Pearl', teacher: 'Mr Pearl' }] },
        { subjectId: 'fre', subject: 'French', teachers: [{ stream: '', teacher: 'Mme Faye' }] },
      ],
    });
    expect(snaps()).toEqual([]);
  });

  test('after publishing: only names that differ, with how many reports; older reports never listed', async () => {
    await publish();
    expect((await names()).body.data.changes).toEqual([]);
    setTeacher('a', 'Mr Otieno');
    mockDb.data.teaching_assignments = mockDb.data.teaching_assignments.filter(x => x.subjectId !== 'fre');
    expect((await names()).body.data.changes).toEqual([
      { subject: 'CRE', stream: 'Ruby', from: 'Ms Kibi', to: 'Mr Otieno', reports: 1 },
      { subject: 'French', stream: 'Pearl', from: 'Mme Faye', to: null, reports: 1 },
    ]);
    snaps().forEach(s => { delete s.subjectTeacherNames; });
    expect((await names()).body.data.changes).toEqual([]);
  });

  test('a past year uses the stream the student was in then', async () => {
    mockDb.data.student_class_history.push({ id: 'h', schoolId: S, academicYearId: 'year1', studentId: 'ann', streamId: 'pearl' });
    await publish();
    expect(current('ann').subjectTeacherNames.cre).toBe('Mr Pearl');
    expect((await names()).body.data.changes).toEqual([]);
  });

  test('nothing when the school has subject comments off', async () => {
    mockCa.subjectTeacherCommentsEnabled = false;
    expect((await names()).body.data).toEqual({ shown: false, subjects: [], changes: [] });
  });

  test('only those who may publish, and only their own school', async () => {
    mockMayPublish = false;
    expect((await names({ userId: 'u_t', schoolId: S, role: 'teacher', roles: ['teacher'] })).status).toBe(403);
    mockMayPublish = true;
    const other = await names({ userId: 'u_x', schoolId: 'sch_2', role: 'admin', roles: ['admin'] });
    expect(JSON.stringify(other.body)).not.toMatch(/Kibi|CRE|Ruby/);
    expect((await api().get('/api/report-cards/publish-names').query({ 'classId[$ne]': 'x', termNumber: 2 })).status).toBe(422);
  });
});
