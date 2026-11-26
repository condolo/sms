/* ============================================================
   Removing staff ends their login and never strands their work (v5.289.0)

   Reported live: a staff record deleted in HR left its login active (the
   login was matched by exact email only, and its email differed) and its
   teaching assignments / timetable lessons pointing at the deleted record.

   DELETE /api/teachers/bulk (HR "Delete Selected") and DELETE /api/teachers/:id
   (Teachers page) now:
     - find the login by teacher.userId first, else email ignoring case;
     - deactivate it, or keep only parent/guardian access, and sign it out;
     - refuse a record that still teaches, the actor's own record, and an
       administrator's record for a non-admin;
     - write an audit entry.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasPermission: async () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

const mockRevoke = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/token-version', () => ({ revokeUserTokens: (...a) => mockRevoke(...a) }));
const mockInvalidateScope = jest.fn();
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: (...a) => mockInvalidateScope(...a) }));
const mockAudit = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...a) => mockAudit(...a) }));

let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));

const express   = require('express');
const supertest = require('supertest');
const { createFakeDb } = require('../fixtures/fake-tenant-db');
const teachersRouter = require('../../routes/teachers');

const SCHOOL = 'sch_a';
const OTHER  = 'sch_b';
let mockJwtUser;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/teachers', teachersRouter);
  return a;
}

const ADMIN = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
const HR    = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: ['hr'] };

function seed(extra = {}) {
  mockDb = createFakeDb({
    teachers: [
      // The live case: linked by userId, login's email differs from the HR record's.
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', id: 't_pen', schoolId: SCHOOL, title: 'Ms', firstName: 'Peninah', lastName: 'W', email: 'pen@old.ke', userId: 'u_pen', status: 'active' },
      // No userId: matched by email, ignoring case.
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa2', id: 't_jo', schoolId: SCHOOL, firstName: 'Jo', lastName: 'K', email: 'Jo.K@School.ke', status: 'active' },
      // Also a parent.
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa3', id: 't_par', schoolId: SCHOOL, firstName: 'Pat', lastName: 'P', email: 'pat@school.ke', userId: 'u_par', status: 'active' },
      // Still teaches.
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa4', id: 't_busy', schoolId: SCHOOL, firstName: 'Busy', lastName: 'B', email: 'busy@school.ke', userId: 'u_busy', status: 'active' },
      // The HR user's own record.
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa5', id: 't_hr', schoolId: SCHOOL, firstName: 'Hana', lastName: 'R', email: 'hr@school.ke', userId: 'u_hr', status: 'active' },
      // An administrator's staff record.
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaa6', id: 't_adm', schoolId: SCHOOL, firstName: 'Ada', lastName: 'M', email: 'ada@school.ke', userId: 'u_adm2', status: 'active' },
      // Another school's record with the same id shape.
      { _id: 'bbbbbbbbbbbbbbbbbbbbbbb1', id: 't_other', schoolId: OTHER, firstName: 'Other', lastName: 'O', email: 'jo.k@school.ke', status: 'active' },
      ...(extra.teachers || []),
    ],
    users: [
      { id: 'u_pen', schoolId: SCHOOL, email: 'pen@new.ke', role: 'teacher', roles: ['teacher'], isActive: true },
      { id: 'u_pen_dup', schoolId: SCHOOL, email: 'pen@old.ke', role: 'teacher', roles: ['teacher'], isActive: true },
      { id: 'u_jo', schoolId: SCHOOL, email: 'jo.k@school.ke', role: 'teacher', roles: ['teacher'], isActive: true },
      { id: 'u_par', schoolId: SCHOOL, email: 'pat@school.ke', role: 'teacher', roles: ['teacher', 'parent'], isActive: true },
      { id: 'u_busy', schoolId: SCHOOL, email: 'busy@school.ke', role: 'teacher', roles: ['teacher'], isActive: true },
      { id: 'u_hr', schoolId: SCHOOL, email: 'hr@school.ke', role: 'hr', roles: ['hr'], isActive: true },
      { id: 'u_adm2', schoolId: SCHOOL, email: 'ada@school.ke', role: 'admin', roles: ['admin'], isActive: true },
      { id: 'u_other', schoolId: OTHER, email: 'jo.k@school.ke', role: 'teacher', roles: ['teacher'], isActive: true },
      ...(extra.users || []),
    ],
    teaching_assignments: [
      { id: 'ta1', schoolId: SCHOOL, teacherId: 'u_busy', subjectId: 's1', classId: 'c1' },
      ...(extra.teaching_assignments || []),
    ],
    timetable: extra.timetable || [],
    streams: extra.streams || [],
  });
}

const user = id => mockDb.data.users.find(u => u.id === id);
const teacher = id => mockDb.data.teachers.find(t => t.id === id);

beforeEach(() => {
  mockRevoke.mockClear(); mockInvalidateScope.mockClear(); mockAudit.mockClear();
  mockJwtUser = ADMIN;
  seed();
});

describe('DELETE /api/teachers/bulk', () => {
  test('the login linked by userId is switched off even when its email differs (the live case)', async () => {
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_pen'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: 1, usersDeleted: 1, skipped: [] });
    expect(teacher('t_pen')).toBeUndefined();
    expect(user('u_pen').isActive).toBe(false);
    expect(mockRevoke).toHaveBeenCalledWith('u_pen');
    expect(mockInvalidateScope).toHaveBeenCalledWith('u_pen', SCHOOL);
    // A different login that only shares the HR record's old email is not touched.
    expect(user('u_pen_dup').isActive).toBe(true);
  });

  test('with no userId, the login is found by email ignoring case — in this school only', async () => {
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_jo'] });
    expect(res.body.data).toMatchObject({ deleted: 1, usersDeleted: 1 });
    expect(user('u_jo').isActive).toBe(false);
    expect(user('u_other').isActive).toBe(true);
    expect(teacher('t_other')).toBeDefined();
  });

  test('a staff member who is also a parent keeps parent access only', async () => {
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_par'] });
    expect(res.body.data.logins.parent_kept).toBe(1);
    expect(user('u_par')).toMatchObject({ isActive: true, role: 'parent', roles: ['parent'] });
    expect(mockRevoke).toHaveBeenCalledWith('u_par');
  });

  test('a record that still teaches is skipped with the reason; nothing about it changes', async () => {
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_busy', 't_jo'] });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(1);
    expect(res.body.data.skipped).toHaveLength(1);
    expect(res.body.data.skipped[0].reason).toMatch(/Busy B still has 1 subject\. Give these to another teacher first/);
    expect(teacher('t_busy')).toBeDefined();
    expect(user('u_busy').isActive).toBe(true);
    expect(mockRevoke).not.toHaveBeenCalledWith('u_busy');
  });

  test.each([
    ['an active timetable lesson', { timetable: [{ id: 'l1', schoolId: SCHOOL, teacherId: 't_jo', isActive: true }] }, /1 timetable lesson/],
    ['a co-taught lesson (by Mongo _id)', { timetable: [{ id: 'l2', schoolId: SCHOOL, teacherId: 'x', coTeacherIds: ['aaaaaaaaaaaaaaaaaaaaaaa2'], isActive: true }] }, /1 timetable lesson/],
    ['form teacher of an active stream', { streams: [{ id: 'st1', schoolId: SCHOOL, formTeacherId: 't_jo', status: 'active' }] }, /form teacher of 1 stream/],
    ['assistant form teacher', { streams: [{ id: 'st2', schoolId: SCHOOL, assistantFormTeacherId: 't_jo' }] }, /form teacher of 1 stream/],
  ])('blocked by %s', async (_label, extra, reason) => {
    seed(extra);
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_jo'] });
    expect(res.body.data.deleted).toBe(0);
    expect(res.body.data.skipped[0].reason).toMatch(reason);
    expect(user('u_jo').isActive).toBe(true);
  });

  test('inactive lessons, inactive streams and another school\'s assignments do not block', async () => {
    seed({
      timetable: [{ id: 'l3', schoolId: SCHOOL, teacherId: 't_jo', isActive: false }],
      streams: [{ id: 'st3', schoolId: SCHOOL, formTeacherId: 't_jo', status: 'inactive' }],
      teaching_assignments: [{ id: 'ta9', schoolId: OTHER, teacherId: 't_jo' }],
    });
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_jo'] });
    expect(res.body.data).toMatchObject({ deleted: 1, skipped: [] });
  });

  test('your own staff record is skipped', async () => {
    mockJwtUser = HR;
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_hr'] });
    expect(res.body.data.deleted).toBe(0);
    expect(res.body.data.skipped[0].reason).toMatch(/your own record/);
    expect(user('u_hr').isActive).toBe(true);
  });

  test('a non-admin cannot remove an administrator; an administrator can', async () => {
    mockJwtUser = HR;
    let res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_adm'] });
    expect(res.body.data.skipped[0].reason).toMatch(/administrator login/);
    expect(user('u_adm2').isActive).toBe(true);
    mockJwtUser = ADMIN;
    res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_adm'] });
    expect(res.body.data.deleted).toBe(1);
    expect(user('u_adm2').isActive).toBe(false);
  });

  test('two active logins sharing the email (different case) → skipped, neither touched', async () => {
    seed({ users: [{ id: 'u_jo2', schoolId: SCHOOL, email: 'JO.K@school.ke', role: 'teacher', roles: ['teacher'], isActive: true }] });
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_jo'] });
    expect(res.body.data.skipped[0].reason).toMatch(/more than one login/);
    expect(user('u_jo').isActive).toBe(true);
    expect(user('u_jo2').isActive).toBe(true);
  });

  test('a record with no login is still deleted', async () => {
    seed({ teachers: [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaa7', id: 't_nolog', schoolId: SCHOOL, firstName: 'No', lastName: 'Login', email: 'nobody@school.ke' }] });
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_nolog'] });
    expect(res.body.data).toMatchObject({ deleted: 1, usersDeleted: 0, logins: { none: 1 } });
  });

  test('writes an audit entry per deleted record', async () => {
    await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_pen', 't_busy'] });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      action: 'staff.deleted', schoolId: SCHOOL,
      target: { type: 'teacher', id: 't_pen', label: 'Ms Peninah W' },
      details: { email: 'pen@old.ke', loginId: 'u_pen', login: 'deactivated' },
    });
  });

  test('another school\'s record is never found', async () => {
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: ['t_other'] });
    expect(res.status).toBe(404);
    expect(teacher('t_other')).toBeDefined();
  });

  test('ids must be strings', async () => {
    const res = await supertest(app()).delete('/api/teachers/bulk').send({ ids: [{ $ne: null }] });
    expect(res.status).toBe(400);
    expect(mockDb.data.teachers).toHaveLength(7);
  });
});

describe('DELETE /api/teachers/:id (Teachers page)', () => {
  test('marks the record inactive and switches the login off', async () => {
    const res = await supertest(app()).delete('/api/teachers/t_pen');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: true, login: 'deactivated' });
    expect(teacher('t_pen')).toMatchObject({ status: 'inactive', deletedBy: 'u_admin' });
    expect(user('u_pen').isActive).toBe(false);
    expect(mockRevoke).toHaveBeenCalledWith('u_pen');
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: 'staff.deactivated' });
  });

  test('also a parent → keeps parent access', async () => {
    const res = await supertest(app()).delete('/api/teachers/t_par');
    expect(res.body.data.login).toBe('parent_kept');
    expect(user('u_par')).toMatchObject({ isActive: true, roles: ['parent'] });
  });

  test('still teaching → 409 with the reason, nothing changed', async () => {
    const res = await supertest(app()).delete('/api/teachers/t_busy');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'STAFF_IN_USE' });
    expect(res.body.error.message).toMatch(/still has 1 subject/);
    expect(teacher('t_busy').status).toBe('active');
    expect(user('u_busy').isActive).toBe(true);
  });

  test('works by Mongo _id; another school\'s record → 404', async () => {
    let res = await supertest(app()).delete('/api/teachers/aaaaaaaaaaaaaaaaaaaaaaa2');
    expect(res.status).toBe(200);
    expect(teacher('t_jo').status).toBe('inactive');
    res = await supertest(app()).delete('/api/teachers/t_other');
    expect(res.status).toBe(404);
  });
});
