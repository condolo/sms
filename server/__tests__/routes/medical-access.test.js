/* ============================================================
   Who may see which medical record (v5.285.0)

   Through the real permission lookup and the real routers:
     - the combined "medical" grant Settings writes never opens visits,
       Weekly Snapshot medical or the profile when Alerts (or another
       narrow row) is all that is behind it;
     - visit details: everything logged, who and when, clinic-only notes
       only for those allowed, opening one is audited;
     - the student's medical profile, in the student list and record, the
       teacher portal text and a save by someone who can't see it;
     - a parent or student opens only their own record; a teacher only
       their own students' Weekly Snapshots;
     - the school's settings: the complaint in the parent's alert, notes
       in the parent portal; another school's data is never reached.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); } }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_q, _s, n) => n(), isModuleEnabled: async () => true }));
const mockAudit = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...a) => mockAudit(...a) }));
const mockNotify = jest.fn().mockResolvedValue();
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: (...a) => mockNotify(...a) }));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: async (id) => ({ u_nurse: { title: 'Nurse', firstName: 'Grace', lastName: 'M' }, u_t: { id: 'tch' } }[id] || null) }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
function mockModel(name) {
  const m = mockDb.model(name);
  return {
    ...m,
    findOneAndUpdate: (filter, update) => ({ lean: async () => {
      const hit = (await m.find(filter).lean())[0];
      if (!hit) return null;
      const row = mockDb.data[name].find(r => r.id === hit.id);
      Object.assign(row, update.$set || update);
      return { ...row };
    } }),
    exists: async (filter) => (await m.find(filter).lean())[0] || null,
  };
}
jest.mock('../../utils/tenant-model', () => ({ tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }), tenantModel: (n) => mockModel(n) }));
jest.mock('../../utils/model', () => ({ _model: (n) => mockModel(n) }));

const express = require('express');
const supertest = require('supertest');
const { allowedIn, studentFor, alertText } = require('../../utils/medical-access');
const { invalidatePermCache } = require('../../middleware/rbac');
const { invalidateScopeCache } = require('../../middleware/scopeMiddleware');

const S = 'sch_1';
const who = (userId, role, extra = {}) => ({ userId, schoolId: S, role, roles: [role], email: `${userId}@x`, ...extra });
const ADMIN = who('u_admin', 'admin');
const NURSE = who('u_nurse', 'nurse');
const TEACHER = who('u_t', 'teacher');
const app = (u) => {
  mockJwtUser = u;
  invalidatePermCache(S);
  invalidateScopeCache(u.userId, S);
  const a = express(); a.use(express.json());
  a.use('/api/medical', require('../../routes/medical'));
  a.use('/api/students', require('../../routes/students'));
  a.use('/api/weekly-snapshots', require('../../routes/weekly-snapshots'));
  return supertest(a);
};
const ALERTS_ONLY_SAVED = { students: ['read', 'update'], weekly_snapshot: ['read'], medical: ['read'], medical__alerts: ['read'], medical__view: [], medical__record: [], medical__delete: [], medical__reports: [] };
const VISIT = { id: 'v1', schoolId: S, studentId: 'ann', studentName: 'Ann X', date: '2026-11-24', complaint: 'Headache', observation: 'Pale', actionTaken: 'Rest', medicationGiven: 'Paracetamol', notes: 'Slept late', clinicNotes: 'Private', returnedToClass: true, recordedBy: 'u_nurse', createdAt: '2026-11-24T08:00:00Z' };
const PROFILE = { bloodGroup: 'A+', conditions: 'Confidential', emergencyPhone: '0700', severeAllergy: true, hasAsthma: false };

function seed(perms = {}) {
  mockAudit.mockClear(); mockNotify.mockClear();
  mockDb = createFakeDb({
    schools: [{ id: S, name: 'School' }, { id: 'sch_2', name: 'Other' }],
    users: [{ id: 'u_admin', schoolId: S, name: 'Admin' }, { id: 'u_old', schoolId: S, name: 'Old Nurse' }],
    role_permissions: [
      { schoolId: S, roleKey: 'admin', permissions: { students: ['read', 'create', 'update', 'delete'], medical: ['read', 'create', 'update', 'delete'] } },
      { schoolId: S, roleKey: 'nurse', permissions: perms.nurse || { students: ['read', 'update'], medical: ['read', 'create', 'update'], medical__view: ['read'], medical__record: ['create', 'update'] } },
      { schoolId: S, roleKey: 'teacher', permissions: perms.teacher || { students: ['read', 'update'], weekly_snapshot: ['read'], medical__alerts: ['read'] } },
      { schoolId: S, roleKey: 'parent', permissions: { students: ['read'] } },
      { schoolId: S, roleKey: 'student', permissions: { students: ['read'] } },
      { schoolId: S, roleKey: 'front_office', permissions: perms.front || {} },
      { schoolId: S, roleKey: 'admissions_officer', permissions: { students: ['read', 'create', 'update'] } },
    ],
    custom_roles: [{ schoolId: S, key: 'nurse', scopeLevel: 'school' }, { schoolId: S, key: 'front_office', scopeLevel: 'school' }],
    teachers: [], streams: [], classes: [], timetable: [], module_permissions: [], user_permissions: [],
    teaching_assignments: [{ id: 'a1', schoolId: S, teacherId: 'u_t', classId: 'c1', subjectId: 'm' }],
    students: [
      { _id: 'ann', id: 'ann', schoolId: S, classId: 'c1', status: 'active', firstName: 'Ann', lastName: 'X', medical: PROFILE, medicalNotes: 'Old note', parentEmail: 'p@x' },
      { _id: 'ben', id: 'ben', schoolId: S, classId: 'c2', status: 'active', firstName: 'Ben', lastName: 'Y', medical: PROFILE, medicalNotes: 'Old note' },
    ],
    medical_visits: [{ ...VISIT }, { ...VISIT, id: 'v2', date: '2026-11-20', complaint: 'Cold', recordedBy: 'u_old' }, { ...VISIT, id: 'v9', schoolId: 'sch_2' }],
    weekly_snapshots: ['ann', 'ben'].map(id => ({ id: 'w_' + id, schoolId: S, studentId: id, weekStart: '2026-11-16', sections: { medical: [{ complaint: 'Headache', notes: 'Slept late' }] } })),
  });
}
const status = async (u, path) => (await app(u).get(path)).status;

describe('the permission rule', () => {
  const alertsOnly = { medical: ['read'], medical__alerts: ['read'] };
  test.each([
    ['nothing', {}, 'view', 'read', false],
    ['bare module grant (principal, never saved)', { medical: ['read', 'create', 'update', 'delete'] }, 'view', 'read', true],
    ['bare module grant covers delete', { medical: ['read', 'create', 'update', 'delete'] }, 'delete', 'delete', true],
    ['alerts only: alerts', alertsOnly, 'alerts', 'read', true],
    ['alerts only: visits', alertsOnly, 'view', 'read', false],
    ['alerts only: reports', alertsOnly, 'reports', 'read', false],
    ['alerts only: profile', alertsOnly, 'profile', 'read', false],
    ['alerts only: clinic notes', alertsOnly, 'clinic_notes', 'read', false],
    ['profile ticked alone never opens visits', { medical: ['read', 'create', 'update'], medical__profile: ['read', 'create', 'update'] }, 'view', 'read', false],
    ['module grant plus a personal alerts tick still opens visits', { medical: ['read', 'create', 'update', 'delete'], medical__alerts: ['read'] }, 'view', 'read', true],
    ['an unticked row is refused', { medical: ['read'], medical__view: [] }, 'view', 'read', false],
    ['view ticked: reports as before', { medical: ['read'], medical__view: ['read'] }, 'reports', 'read', true],
    ['view ticked: profile follows', { medical: ['read'], medical__view: ['read'] }, 'profile', 'read', true],
    ['view ticked: profile edit does not', { medical: ['read'], medical__view: ['read'] }, 'profile', 'update', false],
    ['record ticked: profile edit follows', { medical: ['create'], medical__record: ['create', 'update'] }, 'profile', 'update', true],
    ['profile unticked wins over view', { medical: ['read'], medical__view: ['read'], medical__profile: [] }, 'profile', 'read', false],
    ['settings is strict, even for a full module grant', { medical: ['read', 'create', 'update', 'delete'] }, 'settings', 'update', false],
    ['settings ticked', { medical__settings: ['update'] }, 'settings', 'update', true],
  ])('%s', (_l, perms, sub, action, expected) => { expect(allowedIn(perms, sub, action)).toBe(expected); });

  test('the admissions officer keeps the profile until it is unticked', () => {
    expect(allowedIn({}, 'profile', 'update', ['admissions_officer'])).toBe(true);
    expect(allowedIn({ medical__profile: [] }, 'profile', 'read', ['admissions_officer'])).toBe(false);
    expect(allowedIn({}, 'view', 'read', ['admissions_officer'])).toBe(false);
  });

  test('what is left of a record without the profile', () => {
    const doc = { id: 'x', medical: PROFILE, medicalNotes: 'n', allergies: 'a' };
    expect(studentFor(doc, { profile: false, flags: false })).toEqual({ id: 'x', medical: { emergencyPhone: '0700' } });
    expect(studentFor(doc, { profile: false, flags: true }).medical).toEqual({ emergencyPhone: '0700', severeAllergy: true, hasAsthma: false });
    expect(studentFor(doc, { profile: true })).toBe(doc);
    expect(alertText({ severeAllergy: true, hasAsthma: true })).toBe('Severe allergy · Asthma');
    expect(alertText(null)).toBe(null);
  });
});

describe('visits', () => {
  beforeEach(() => seed());

  test('the nurse opens everything that was logged, with who and when; it is audited once', async () => {
    const r = await app(NURSE).get('/api/medical/visits/v1');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ complaint: 'Headache', observation: 'Pale', actionTaken: 'Rest', medicationGiven: 'Paracetamol', notes: 'Slept late', clinicNotes: 'Private', recordedByName: 'Nurse Grace M', createdAt: VISIT.createdAt });
    await app(NURSE).get('/api/medical/visits/v1');
    expect(mockAudit.mock.calls.filter(c => c[0].action === 'medical.visit_viewed')).toHaveLength(1);
    expect((await app(NURSE).get('/api/medical/visits/v2')).body.data.recordedByName).toBe('Old Nurse');
  });

  test('the list never carries clinic-only notes, and filters by student and date', async () => {
    const all = (await app(NURSE).get('/api/medical/visits')).body.data;
    expect(all.map(v => v.id).sort()).toEqual(['v1', 'v2']);
    expect(JSON.stringify(all)).not.toMatch(/Private/);
    const some = (await app(NURSE).get('/api/medical/visits').query({ studentId: 'ann', dateFrom: '2026-11-22' })).body.data;
    expect(some.map(v => v.id)).toEqual(['v1']);
    expect((await app(NURSE).get('/api/medical/visits').query('search[$ne]=x')).status).toBe(200);
  });

  test('clinic-only notes unticked: hidden, and refused on a new visit', async () => {
    seed({ nurse: { medical: ['read', 'create', 'update'], medical__view: ['read'], medical__record: ['create', 'update'], medical__clinic_notes: [] } });
    expect((await app(NURSE).get('/api/medical/visits/v1')).body.data.clinicNotes).toBeUndefined();
    const r = await app(NURSE).post('/api/medical/visits').send({ studentId: 'ann', complaint: 'x', clinicNotes: 'secret' });
    expect(r.status).toBe(403);
    expect(mockDb.data.medical_visits).toHaveLength(3);
  });

  test('a new visit keeps the recorder\'s name; the parent\'s alert has no complaint unless the school chose so', async () => {
    const send = () => app(NURSE).post('/api/medical/visits').send({ studentId: 'ann', complaint: 'Nosebleed', clinicNotes: 'secret' });
    const r = await send();
    expect(r.status).toBe(201);
    expect(mockDb.data.medical_visits.find(v => v.id === r.body.data.id)).toMatchObject({ recordedByName: 'Nurse Grace M', clinicNotes: 'secret' });
    expect(JSON.stringify(mockNotify.mock.calls)).not.toMatch(/Nosebleed|secret/);
    expect((await app(ADMIN).put('/api/medical/settings').send({ alertShowsComplaint: true })).status).toBe(200);
    mockNotify.mockClear();
    await send();
    expect(mockNotify.mock.calls[0][0].items[0].inAppBody).toBe('Nosebleed');
    expect(JSON.stringify(mockNotify.mock.calls)).not.toMatch(/secret/);
  });

  test.each([
    ['a teacher, as seeded', undefined],
    ['a teacher after Settings was saved with only Alerts ticked', { teacher: ALERTS_ONLY_SAVED }],
    ['a role whose other rows were never saved', { teacher: { medical: ['read'], medical__alerts: ['read'] } }],
  ])('%s is refused visits and reports, and still sees alerts', async (_l, perms) => {
    seed(perms);
    expect(await status(TEACHER, '/api/medical/visits')).toBe(403);
    expect(await status(TEACHER, '/api/medical/visits/v1')).toBe(403);
    expect(await status(TEACHER, '/api/medical/reports')).toBe(403);
    expect(await status(TEACHER, '/api/medical/students')).toBe(403);
    expect(await status(TEACHER, '/api/medical/alerts')).toBe(200);
    expect((await app(TEACHER).get('/api/medical/access')).body.data).toEqual({ visits: false, record: false, remove: false, alerts: true, reports: false, clinicNotes: { read: false, write: false }, settings: false });
  });

  test('another school\'s visit is never found', async () => {
    expect(await status(NURSE, '/api/medical/visits/v9')).toBe(404);
  });
});

describe('settings', () => {
  beforeEach(() => seed());
  test('defaults; only admin or an explicit tick may change them; audited', async () => {
    expect((await app(NURSE).get('/api/medical/settings')).body.data).toEqual({ alertShowsComplaint: false, parentsSeeNotes: true });
    expect((await app(NURSE).put('/api/medical/settings').send({ parentsSeeNotes: false })).status).toBe(403);
    expect(await status(TEACHER, '/api/medical/settings')).toBe(403);
    expect((await app(ADMIN).put('/api/medical/settings').send({ parentsSeeNotes: false })).body.data).toEqual({ alertShowsComplaint: false, parentsSeeNotes: false });
    expect(mockAudit.mock.calls.some(c => c[0].action === 'medical.settings_changed')).toBe(true);
    expect(mockDb.data.schools.find(s => s.id === 'sch_2').medicalSettings).toBeUndefined();
    expect((await app(ADMIN).put('/api/medical/settings').send({ somethingElse: true })).status).toBe(422);
  });
});

describe('the student record', () => {
  beforeEach(() => seed());
  const get = async (u, id) => app(u).get(`/api/students/${id}`);

  test('a teacher: own student gets the flags and emergency contact, another class only the contact; never the profile', async () => {
    const own = (await get(TEACHER, 'ann')).body.data;
    expect(own.medical).toEqual({ emergencyPhone: '0700', severeAllergy: true, hasAsthma: false });
    expect(own.medicalNotes).toBeUndefined();
    expect(own.medicalAccess).toEqual({ view: false, edit: false });
    expect((await get(TEACHER, 'ben')).body.data.medical).toEqual({ emergencyPhone: '0700' });
    seed({ teacher: ALERTS_ONLY_SAVED });
    expect((await get(TEACHER, 'ann')).body.data.medical.bloodGroup).toBeUndefined();
  });

  test('the list is stripped the same way', async () => {
    const rows = (await app(TEACHER).get('/api/students')).body.data;
    expect(rows.map(r => r.id)).toEqual(['ann']);
    expect(JSON.stringify(rows)).not.toMatch(/Confidential|Old note|A\+/);
  });

  test('nurse, admin and admissions officer see the profile', async () => {
    for (const u of [NURSE, ADMIN, who('u_ao', 'admissions_officer')]) {
      const d = (await get(u, 'ann')).body.data;
      expect(d.medical.bloodGroup).toBe('A+');
      expect(d.medicalAccess).toEqual({ view: true, edit: true });
    }
  });

  test('a role can be given the profile alone, by a tick', async () => {
    seed({ front: { students: ['read', 'update'], medical: ['read'], medical__profile: ['read'] } });
    const front = who('u_f', 'front_office');
    expect((await get(front, 'ann')).body.data).toMatchObject({ medical: { bloodGroup: 'A+' }, medicalAccess: { view: true, edit: false } });
    expect(await status(front, '/api/medical/visits')).toBe(403);
  });

  test('without it, a save never wipes or changes the profile', async () => {
    const put = (body) => app(TEACHER).put('/api/students/ann').send(body);
    const ok = await put({ firstName: 'Anne', medicalNotes: '' });
    expect(ok.status).toBe(200);
    const row = mockDb.data.students.find(s => s.id === 'ann');
    expect(row).toMatchObject({ firstName: 'Anne', medicalNotes: 'Old note', medical: PROFILE });
    expect(JSON.stringify(ok.body)).not.toMatch(/Confidential|Old note/);
    expect((await put({ medical: { bloodGroup: 'B+' } })).status).toBe(403);
    expect((await put({ medicalNotes: 'new' })).status).toBe(403);
    expect(mockDb.data.students.find(s => s.id === 'ann').medical).toEqual(PROFILE);
    expect((await app(NURSE).put('/api/students/ann').send({ medical: { bloodGroup: 'B+' } })).status).toBe(200);
    expect(mockDb.data.students.find(s => s.id === 'ann').medical.bloodGroup).toBe('B+');
  });

  test('a parent or student opens only their own record', async () => {
    const parent = who('u_p', 'parent', { studentIds: ['ann'] });
    expect((await get(parent, 'ann')).status).toBe(200);
    expect((await get(parent, 'ben')).status).toBe(403);
    expect((await get(who('u_s', 'student', { studentId: 'ben' }), 'ann')).status).toBe(403);
  });
});

describe('Weekly Snapshots', () => {
  beforeEach(() => seed());
  const snap = (u, id) => app(u).get(`/api/weekly-snapshots/${id}/2026-11-16`);
  test('a teacher opens only their own students', async () => {
    expect((await snap(TEACHER, 'ann')).status).toBe(200);
    expect((await snap(TEACHER, 'ben')).status).toBe(403);
    expect(await status(TEACHER, '/api/weekly-snapshots/ben/weeks')).toBe(403);
    expect(await status(TEACHER, '/api/weekly-snapshots/ben/2026-11-16/pdf')).toBe(403);
  });
  test('a form teacher opens their class', async () => {
    mockDb.data.streams.push({ id: 'c2a', schoolId: S, classId: 'c2', formTeacherId: 'tch' });
    mockDb.data.teachers.push({ id: 'tch', userId: 'u_t', schoolId: S, email: 'u_t@x' });
    mockDb.data.students.find(s => s.id === 'ben').streamId = 'c2a';
    expect((await snap(TEACHER, 'ben')).status).toBe(200);
  });
  test('Alerts alone never shows clinic visits; View Clinic Visits does', async () => {
    seed({ teacher: ALERTS_ONLY_SAVED });
    expect((await snap(TEACHER, 'ann')).body.data.snapshot.sections.medical).toEqual([]);
    seed({ teacher: { ...ALERTS_ONLY_SAVED, medical__view: ['read'] } });
    expect((await snap(TEACHER, 'ann')).body.data.snapshot.sections.medical).toHaveLength(1);
  });
});

describe('other readers', () => {
  beforeEach(() => seed());
  const mount = (u, path, file) => { const a = app(u); void a; const x = express(); x.use(express.json()); x.use(path, require(file)); return supertest(x); };

  test('the parent portal shows Notes only if the school allows it, and never clinic-only notes', async () => {
    const parent = who('u_p', 'parent', { studentIds: ['ann'] });
    const read = async () => (await mount(parent, '/pp', '../../routes/parent-portal').get('/pp/medical/ann')).body.data;
    let rows = await read();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ complaint: 'Headache', notes: 'Slept late' });
    expect(JSON.stringify(rows)).not.toMatch(/Private/);
    mockDb.data.schools[0].medicalSettings = { parentsSeeNotes: false };
    rows = await read();
    expect(rows[0]).toMatchObject({ complaint: 'Headache', medicationGiven: 'Paracetamol' });
    expect(JSON.stringify(rows)).not.toMatch(/Slept late|Private/);
  });

  test('the student export leaves the medical columns blank without the profile row', async () => {
    const exportCsv = async (u) => {
      const r = await mount(u, '/ie', '../../routes/import-export').get('/ie/export/students');
      expect(r.status).toBe(200);
      return r.text;
    };
    mockDb.data.students[0].medical.allergies = 'Nuts';
    expect(await exportCsv(ADMIN)).toMatch(/Nuts/);
    const csv = await exportCsv(TEACHER);
    expect(csv).toMatch(/Ann/);
    expect(csv).not.toMatch(/Nuts|Old note/);
  });

  test('clinic visits are in every backup list', () => {
    const fs = require('fs');
    for (const f of ['routes/backup.js', 'utils/backup-cron.js', 'routes/platform.js']) {
      expect(fs.readFileSync(require('path').join(__dirname, '../..', f), 'utf8')).toMatch(/'medical_visits'/);
    }
  });
});
