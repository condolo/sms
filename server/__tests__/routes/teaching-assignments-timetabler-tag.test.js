/* ============================================================
   server/routes/teaching-assignments.js — GET / read-scoping for
   the 'timetabler' responsibility-tag rename (2026-10-14)

   Root cause: 'timetabler' was a built-in teacher.extraRoles
   responsibility value (Settings → Staff Roles & Responsibilities)
   that collided with the real 'timetabler' SYSTEM_ROLES key — the
   exact same collision class the 'deputy'/'principal' rename already
   fixed, just never closed for this one. isTeacherOnly's broad-read
   list merges role+roles+extraRoles with no distinction, so a teacher
   merely TAGGED "Timetabler" was silently granted the same read
   access to every teacher's assignments as an account actually
   holding the real timetabler role, without ever going through Roles
   & Permissions.

   Renamed the tag to 'timetable_coordinator', added explicitly
   alongside the real role key (same precedent as FULL_MANAGE's
   acting_deputy/head_of_school) — this pins that both the real role
   and the renamed tag still grant broad read access, that a plain
   teacher with neither does not, and that the OLD tag value is left
   in the list too (so an as-yet-unmigrated teacher's access doesn't
   silently change before the migration script runs against real data).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL = 'school_tt_tag';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ hasPermission: jest.fn().mockResolvedValue(false) }));
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: jest.fn() }));

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
const mockRows = [
  { id: 'ta_self',  schoolId: SCHOOL, teacherId: 'usr_self',  subjectId: 'subj_1', classId: 'cls_1' },
  { id: 'ta_other', schoolId: SCHOOL, teacherId: 'usr_other', subjectId: 'subj_2', classId: 'cls_2' },
];
function mockChain(result) {
  return { sort: () => mockChain(result), select: () => mockChain(result), lean: () => Promise.resolve(result) };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'teaching_assignments') {
      return { find: (filter) => mockChain(mockRows.filter(d => mockMatches(d, filter))) };
    }
    throw new Error(`unexpected collection: ${collection}`);
  },
}));

const express   = require('express');
const supertest = require('supertest');
const taRouter  = require('../../routes/teaching-assignments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teaching-assignments', taRouter);
  return app;
}

describe('GET /api/teaching-assignments — "timetabler" tag collision (2026-10-14)', () => {
  test('a plain teacher with no broad-read tag sees only their own assignments', async () => {
    mockJwtUser = { userId: 'usr_self', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: [] };
    const res = await supertest(buildApp()).get('/api/teaching-assignments');
    expect(res.body.data.map(a => a.id)).toEqual(['ta_self']);
  });

  test('a real account holding the actual "timetabler" RBAC role sees every assignment (unaffected by the rename)', async () => {
    mockJwtUser = { userId: 'usr_tt', schoolId: SCHOOL, role: 'timetabler', roles: [], extraRoles: [] };
    const res = await supertest(buildApp()).get('/api/teaching-assignments');
    expect(res.body.data.map(a => a.id).sort()).toEqual(['ta_other', 'ta_self']);
  });

  test('a teacher tagged with the NEW renamed "timetable_coordinator" responsibility sees every assignment (explicit grant, not an accident)', async () => {
    mockJwtUser = { userId: 'usr_self', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['timetable_coordinator'] };
    const res = await supertest(buildApp()).get('/api/teaching-assignments');
    expect(res.body.data.map(a => a.id).sort()).toEqual(['ta_other', 'ta_self']);
  });

  test('a teacher still tagged with the OLD un-migrated "timetabler" value keeps the same access until the migration script runs', async () => {
    mockJwtUser = { userId: 'usr_self', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['timetabler'] };
    const res = await supertest(buildApp()).get('/api/teaching-assignments');
    expect(res.body.data.map(a => a.id).sort()).toEqual(['ta_other', 'ta_self']);
  });

  test('a teacher tagged with an unrelated responsibility (e.g. "class_teacher") is still teacher-only scoped', async () => {
    mockJwtUser = { userId: 'usr_self', schoolId: SCHOOL, role: 'teacher', roles: [], extraRoles: ['class_teacher'] };
    const res = await supertest(buildApp()).get('/api/teaching-assignments');
    expect(res.body.data.map(a => a.id)).toEqual(['ta_self']);
  });
});
