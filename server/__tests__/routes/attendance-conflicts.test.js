/* ============================================================
   server/routes/attendance.js — same-day present/absent conflict
   detection, flagging, and resolution (2026-09)

   Raised directly: "I need the system to alert them if one student
   has been marked absent in one class, and present in one class, it
   has to flag the admission officer who will resolve by giving a
   reason for records."

   Also proves the fix this same work found: the single-record POST's
   upsert filter used to omit classId (present in the bulk route's own
   filter), so marking a student absent for one class then present for
   a DIFFERENT class the same day (both omitting period, the common
   case) silently overwrote the SAME document instead of creating a
   second one — which would have made the very conflict this file
   tests for undetectable in the first place.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      return true;
    }
    return doc[k] === v;
  });
}
// A STATEFUL fake collection — findOneAndUpdate actually persists into
// `docs`, unlike the throwaway mocks elsewhere, because this file's whole
// point is proving that a write is genuinely visible to the NEXT write's
// conflict check (and to the classId-fix test above).
function makeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:  jest.fn((doc) => { docs.push({ ...doc }); return Promise.resolve({ ...doc, toObject: () => doc }); }),
    findOneAndUpdate: jest.fn((filter, update, opts) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      const patch = update.$set ? update.$set : update;
      if (idx === -1) {
        if (!opts?.upsert) return mockChainObj(null);
        const created = { ...filter, ...patch };
        delete created.$setOnInsert;
        if (update.$setOnInsert) Object.assign(created, update.$setOnInsert);
        docs.push(created);
        return mockChainObj(created);
      }
      docs[idx] = { ...docs[idx], ...patch };
      return mockChainObj(docs[idx]);
    }),
    updateOne: jest.fn((filter, update) => {
      const idx = docs.findIndex(d => matchesFilter(d, filter));
      if (idx !== -1) docs[idx] = { ...docs[idx], ...(update.$set || update) };
      return Promise.resolve({ matchedCount: idx === -1 ? 0 : 1 });
    }),
    bulkWrite: jest.fn(async (ops) => {
      let upsertedCount = 0, modifiedCount = 0;
      for (const op of ops) {
        const { filter, update } = op.updateOne;
        const idx = docs.findIndex(d => matchesFilter(d, filter));
        const patch = { ...(update.$set || {}) };
        if (idx === -1) {
          docs.push({ ...filter, ...patch, ...(update.$setOnInsert || {}) });
          upsertedCount++;
        } else {
          docs[idx] = { ...docs[idx], ...patch };
          modifiedCount++;
        }
      }
      return { upsertedCount, modifiedCount };
    }),
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/email', () => ({}));

const mockDispatchNotification = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: (...args) => mockDispatchNotification(...args) }));

let mockAttendance, mockConflicts, mockStudents, mockClasses, mockWorkflowConfigs, mockUsers;
jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({ find: () => mockChainArr([]), findOne: () => mockChainObj(null) })),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'attendance')           return mockAttendance;
    if (collection === 'attendance_conflicts') return mockConflicts;
    if (collection === 'students')             return mockStudents;
    if (collection === 'classes')              return mockClasses;
    if (collection === 'workflow_configs')     return mockWorkflowConfigs;
    if (collection === 'users')                return mockUsers;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  },
}));
jest.mock('../../utils/scopeEngine', () => {
  const actual = jest.requireActual('../../utils/scopeEngine');
  return { ...actual, resolveAttendanceScope: jest.fn().mockResolvedValue({ level: 'school' }), isClassInScope: jest.fn().mockReturnValue(true) };
});

const express   = require('express');
const supertest = require('supertest');
const attendanceRouter = require('../../routes/attendance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDispatchNotification.mockClear();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  mockAttendance = makeFakeCollection([]);
  mockConflicts  = makeFakeCollection([]);
  mockStudents   = makeFakeCollection([
    { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno', admissionNumber: 'A100' },
  ]);
  mockClasses    = makeFakeCollection([
    { id: 'cls_math', schoolId: SCHOOL_A, name: 'Mathematics 4A' },
    { id: 'cls_eng',  schoolId: SCHOOL_A, name: 'English 4A' },
  ]);
  mockWorkflowConfigs = makeFakeCollection([]);
  mockUsers = makeFakeCollection([]);
});

describe('the classId upsert-filter fix', () => {
  test('marking absent in one class then present in another (same day, no period) creates TWO records, not one overwritten', async () => {
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_eng',  date: '2026-09-21', status: 'present' });
    const docs = mockAttendance._docs().filter(d => d.studentId === 'stu_1' && d.date === '2026-09-21');
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.classId).sort()).toEqual(['cls_eng', 'cls_math']);
  });
});

describe('conflict detection — created after the write that completes it', () => {
  test('absent in one class + present in another, same day, creates ONE open conflict with both entries', async () => {
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    const res = await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_eng', date: '2026-09-21', status: 'present' });
    expect(res.status).toBe(201);

    const open = mockConflicts._docs().filter(c => c.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].studentId).toBe('stu_1');
    expect(open[0].entries.map(e => e.status).sort()).toEqual(['absent', 'present']);
    expect(open[0].entries.map(e => e.className).sort()).toEqual(['English 4A', 'Mathematics 4A']);
  });

  test('absent only (no present anywhere that day) does NOT create a conflict', async () => {
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    expect(mockConflicts._docs()).toHaveLength(0);
  });

  test('absent and present for DIFFERENT students on the same day does not conflate them', async () => {
    mockStudents = makeFakeCollection([
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno' },
      { id: 'stu_2', schoolId: SCHOOL_A, firstName: 'Brian', lastName: 'Kiptoo' },
    ]);
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_2', classId: 'cls_eng',  date: '2026-09-21', status: 'present' });
    expect(mockConflicts._docs()).toHaveLength(0);
  });

  test('a second conflicting write the same day refreshes the existing open conflict instead of creating a duplicate', async () => {
    mockClasses = makeFakeCollection([
      { id: 'cls_math', schoolId: SCHOOL_A, name: 'Mathematics 4A' },
      { id: 'cls_eng',  schoolId: SCHOOL_A, name: 'English 4A' },
      { id: 'cls_sci',  schoolId: SCHOOL_A, name: 'Science 4A' },
    ]);
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_eng',  date: '2026-09-21', status: 'present' });
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_sci',  date: '2026-09-21', status: 'present' });

    const openDocs = mockConflicts._docs().filter(c => c.status === 'open');
    expect(openDocs).toHaveLength(1);
    expect(openDocs[0].entries).toHaveLength(3);
  });

  test('bulk marking triggers the same detection for every affected student', async () => {
    mockStudents = makeFakeCollection([
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno' },
    ]);
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_eng', date: '2026-09-21',
      records: [{ studentId: 'stu_1', status: 'present' }],
    });
    expect(res.status).toBe(201);
    expect(mockConflicts._docs().filter(c => c.status === 'open')).toHaveLength(1);
  });
});

describe('notification on a newly-created conflict', () => {
  test('dispatches to the configured Attendance Conflict Resolver', async () => {
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_conflict_officer',
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    mockUsers = makeFakeCollection([
      { id: 'usr_admissions', schoolId: SCHOOL_A, name: 'Grace Admissions', email: 'grace@school.test', isActive: true },
    ]);

    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_eng', date: '2026-09-21', status: 'present' });

    expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    const call = mockDispatchNotification.mock.calls[0][0];
    expect(call.eventKey).toBe('attendance_conflict');
    expect(call.recipients).toEqual([{ userId: 'usr_admissions', name: 'Grace Admissions', email: 'grace@school.test' }]);
  });

  test('no resolver configured — conflict is still flagged (queryable), just no notification sent', async () => {
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_eng', date: '2026-09-21', status: 'present' });

    expect(mockDispatchNotification).not.toHaveBeenCalled();
    expect(mockConflicts._docs().filter(c => c.status === 'open')).toHaveLength(1);
  });
});

describe('GET /api/attendance/conflicts and PUT .../resolve', () => {
  beforeEach(() => {
    mockConflicts = makeFakeCollection([{
      id: 'conf_1', schoolId: SCHOOL_A, studentId: 'stu_1', studentName: 'Amina Otieno', date: '2026-09-21',
      entries: [{ classId: 'cls_math', className: 'Mathematics 4A', status: 'absent' }, { classId: 'cls_eng', className: 'English 4A', status: 'present' }],
      status: 'open', createdAt: '2026-09-21T08:00:00.000Z',
    }]);
  });

  test('GET /conflicts defaults to open', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/conflicts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('conf_1');
  });

  test('PUT .../resolve without a reason is rejected', async () => {
    const res = await supertest(buildApp()).put('/api/attendance/conflicts/conf_1/resolve').send({});
    expect(res.status).toBe(400);
  });

  test('PUT .../resolve with a reason resolves it, and it drops out of the open queue', async () => {
    const res = await supertest(buildApp()).put('/api/attendance/conflicts/conf_1/resolve').send({ reason: 'Spoke to parent — student left early with permission, teacher marked absent in error.' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
    expect(res.body.data.resolvedBy).toBe('usr_admin');
    expect(res.body.data.reason).toMatch(/left early/);

    const openRes = await supertest(buildApp()).get('/api/attendance/conflicts');
    expect(openRes.body.data).toHaveLength(0);
    const resolvedRes = await supertest(buildApp()).get('/api/attendance/conflicts').query({ status: 'resolved' });
    expect(resolvedRes.body.data).toHaveLength(1);
  });

  test('an already-resolved conflict cannot be resolved again', async () => {
    mockConflicts = makeFakeCollection([{
      id: 'conf_1', schoolId: SCHOOL_A, studentId: 'stu_1', date: '2026-09-21',
      entries: [], status: 'resolved', reason: 'already handled', resolvedBy: 'usr_admin', resolvedAt: '2026-09-21T09:00:00.000Z',
    }]);
    const res = await supertest(buildApp()).put('/api/attendance/conflicts/conf_1/resolve').send({ reason: 'trying again' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/attendance/absentees — real identities + guardian contact', () => {
  beforeEach(() => {
    mockAttendance = makeFakeCollection([
      { id: 'att_1', schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' },
      { id: 'att_2', schoolId: SCHOOL_A, studentId: 'stu_2', classId: 'cls_eng',  date: '2026-09-21', status: 'present' }, // not absent — must be excluded
    ]);
    mockStudents = makeFakeCollection([
      {
        id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno', admissionNumber: 'A100',
        primaryContact: 'mother', motherName: 'Jane Otieno', motherEmail: 'jane@example.com', motherPhone: '0700000001',
      },
      { id: 'stu_2', schoolId: SCHOOL_A, firstName: 'Brian', lastName: 'Kiptoo' },
    ]);
  });

  test('a floor role sees the real absent student and their guardian contact', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/absentees').query({ date: '2026-09-21' });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.absentees[0].studentName).toBe('Amina Otieno');
    expect(res.body.data.absentees[0].guardian).toEqual({
      parentName: 'Jane Otieno', parentEmail: 'jane@example.com', parentPhone: '0700000001', parentRelationship: 'Mother',
    });
  });

  test('a present record never appears in the absentee list', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/absentees').query({ date: '2026-09-21' });
    expect(res.body.data.absentees.some(a => a.studentId === 'stu_2')).toBe(false);
  });

  test('a non-floor role with no explicit grant is forbidden', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/attendance/absentees').query({ date: '2026-09-21' });
    expect(res.status).toBe(403);
  });

  test('an explicit hasExplicitSubGrant pass lets a non-floor role through', async () => {
    mockJwtUser = { userId: 'usr_admissions', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
    const rbacMock = require('../../middleware/rbac');
    rbacMock.hasExplicitSubGrant.mockResolvedValueOnce(true);
    const res = await supertest(buildApp()).get('/api/attendance/absentees').query({ date: '2026-09-21' });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });
});

describe('access control — attendanceConflictAccess', () => {
  test('a non-floor role with no grant and no officer assignment is forbidden', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/attendance/conflicts');
    expect(res.status).toBe(403);
  });

  test('the configured Conflict Resolver passes even without the floor role or an explicit grant', async () => {
    mockJwtUser = { userId: 'usr_admissions', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
    mockConflicts = makeFakeCollection([]);
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_conflict_officer',
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    mockUsers = makeFakeCollection([
      { id: 'usr_admissions', schoolId: SCHOOL_A, name: 'Grace Admissions', email: 'grace@school.test', isActive: true },
    ]);
    const res = await supertest(buildApp()).get('/api/attendance/conflicts');
    expect(res.status).toBe(200);
  });

  test('an explicit hasExplicitSubGrant pass lets a non-floor role through', async () => {
    mockJwtUser = { userId: 'usr_frontoffice', schoolId: SCHOOL_A, role: 'front_office', roles: ['front_office'] };
    const rbacMock = require('../../middleware/rbac');
    rbacMock.hasExplicitSubGrant.mockResolvedValueOnce(true);
    const res = await supertest(buildApp()).get('/api/attendance/conflicts');
    expect(res.status).toBe(200);
  });

  test('PUT /conflict-officer-config is admin/superadmin only', async () => {
    mockJwtUser = { userId: 'usr_admissions', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_conflict_officer',
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    const res = await supertest(buildApp()).put('/api/attendance/conflict-officer-config').send({ steps: [] });
    expect(res.status).toBe(403);
  });

  test('admin can assign the resolver via PUT /conflict-officer-config and GET reflects it', async () => {
    const app = buildApp();
    const putRes = await supertest(app).put('/api/attendance/conflict-officer-config').send({
      steps: [{ assigneeType: 'role', assigneeValue: 'admissions_officer' }],
    });
    expect(putRes.status).toBe(200);
    const getRes = await supertest(app).get('/api/attendance/conflict-officer-config');
    expect(getRes.body.data.steps).toEqual([{ assigneeType: 'role', assigneeValue: 'admissions_officer' }]);
  });
});

describe('the Absentee Alert Recipient — real-time notification on a new absence', () => {
  test('marking a student absent dispatches ONE notification to the configured recipient', async () => {
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_absentee_officer',
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    mockUsers = makeFakeCollection([
      { id: 'usr_admissions', schoolId: SCHOOL_A, name: 'Grace Admissions', email: 'grace@school.test', isActive: true },
    ]);

    const res = await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    expect(res.status).toBe(201);

    expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    const call = mockDispatchNotification.mock.calls[0][0];
    expect(call.eventKey).toBe('attendance_absentee_alert');
    expect(call.recipients).toEqual([{ userId: 'usr_admissions', name: 'Grace Admissions', email: 'grace@school.test' }]);
    expect(call.inAppBody).toMatch(/Amina Otieno/);
  });

  test('marking present never triggers the absentee alert', async () => {
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_absentee_officer',
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    mockUsers = makeFakeCollection([{ id: 'usr_admissions', schoolId: SCHOOL_A, name: 'Grace Admissions', email: 'grace@school.test', isActive: true }]);

    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'present' });
    expect(mockDispatchNotification).not.toHaveBeenCalled();
  });

  test('no recipient configured — marking absent succeeds, no notification attempted', async () => {
    const res = await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    expect(res.status).toBe(201);
    expect(mockDispatchNotification).not.toHaveBeenCalled();
  });

  test('a bulk mark of several absentees dispatches ONE notification listing all of them, not one per student', async () => {
    mockStudents = makeFakeCollection([
      { id: 'stu_1', schoolId: SCHOOL_A, firstName: 'Amina', lastName: 'Otieno' },
      { id: 'stu_2', schoolId: SCHOOL_A, firstName: 'Brian', lastName: 'Kiptoo' },
    ]);
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_absentee_officer',
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    mockUsers = makeFakeCollection([{ id: 'usr_admissions', schoolId: SCHOOL_A, name: 'Grace Admissions', email: 'grace@school.test', isActive: true }]);

    const res = await supertest(buildApp()).post('/api/attendance/bulk').send({
      classId: 'cls_math', date: '2026-09-21',
      records: [{ studentId: 'stu_1', status: 'absent' }, { studentId: 'stu_2', status: 'absent' }],
    });
    expect(res.status).toBe(201);
    expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    expect(mockDispatchNotification.mock.calls[0][0].inAppBody).toMatch(/Amina Otieno.*Brian Kiptoo|Brian Kiptoo.*Amina Otieno/);
  });

  test('this uses a SEPARATE assignment from the Conflict Resolver — configuring one does not notify via the other', async () => {
    mockWorkflowConfigs = makeFakeCollection([{
      schoolId: SCHOOL_A, workflowKey: 'attendance_conflict_officer', // only the CONFLICT key configured
      steps: [{ assigneeType: 'user', assigneeValue: 'usr_admissions' }],
    }]);
    mockUsers = makeFakeCollection([{ id: 'usr_admissions', schoolId: SCHOOL_A, name: 'Grace Admissions', email: 'grace@school.test', isActive: true }]);

    await supertest(buildApp()).post('/api/attendance').send({ studentId: 'stu_1', classId: 'cls_math', date: '2026-09-21', status: 'absent' });
    expect(mockDispatchNotification).not.toHaveBeenCalled(); // no attendance_absentee_officer config exists
  });
});

describe('GET/PUT /api/attendance/absentee-officer-config', () => {
  test('a non-floor role with no explicit grant is forbidden to read it', async () => {
    mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/attendance/absentee-officer-config');
    expect(res.status).toBe(403);
  });

  test('a floor role can read it', async () => {
    const res = await supertest(buildApp()).get('/api/attendance/absentee-officer-config');
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toEqual([]);
  });

  test('PUT is admin/superadmin only', async () => {
    mockJwtUser = { userId: 'usr_admissions', schoolId: SCHOOL_A, role: 'admissions_officer', roles: ['admissions_officer'] };
    const res = await supertest(buildApp()).put('/api/attendance/absentee-officer-config').send({ steps: [] });
    expect(res.status).toBe(403);
  });

  test('admin can assign the recipient via PUT and GET reflects it', async () => {
    const app = buildApp();
    const putRes = await supertest(app).put('/api/attendance/absentee-officer-config').send({
      steps: [{ assigneeType: 'role', assigneeValue: 'admissions_officer' }],
    });
    expect(putRes.status).toBe(200);
    const getRes = await supertest(app).get('/api/attendance/absentee-officer-config');
    expect(getRes.body.data.steps).toEqual([{ assigneeType: 'role', assigneeValue: 'admissions_officer' }]);
  });
});
