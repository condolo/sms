/* ============================================================
   POST /api/settings/users/invite (staffId — HR "Create Login
   Account") and POST /api/settings/users/bulk-invite — teacher.userId
   backlink

   Root cause: teachers.js's own POST /api/teachers comment says
   teacher.userId is "required for timetable slot resolution and
   meeting-link lookups", and it's only ever set there — by matching
   email against an EXISTING user AT TEACHER-CREATION TIME. The far
   more common real-world order (add the staff member in HR first,
   grant them a login later via "Create Login Account") never touched
   teacher.userId at all: /users/invite destructured `staffId` only to
   bypass the "email already belongs to a teacher" conflict check, and
   never wrote it back. A teacher who gets a login this way keeps
   userId: null forever, and GET /timetable/my's now-primary
   userId-based lookup (see its own fix and tests) falls through to a
   weaker fallback for them indefinitely instead of just working.

   These tests call the REAL authMiddleware with a REAL signed JWT and
   the real rbac()/role-validation stack, same as the sibling
   bulk-invite role-validation test file, per the audit's requirement
   to verify actual backend behaviour end to end.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/module-gate', () => ({
  invalidateModuleConfigCache: jest.fn(),
  moduleGate: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn().mockResolvedValue(undefined),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockUsers, mockSchools, mockCustomRoles, mockRolePerms, mockTeachers;

function mockMakeCollection(store) {
  return {
    findOne: jest.fn((filter) => ({
      lean: jest.fn().mockResolvedValue((() => { const d = store.find(filter); return d ? { ...d } : null; })()),
    })),
    updateOne: jest.fn((filter, update) => {
      const doc = store.find(filter);
      if (doc) store.apply(doc, update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    create: jest.fn((doc) => { store.docs.push(doc); return Promise.resolve(doc); }),
    find: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(store.docs) })),
  };
}
// teachers-collection filter matcher — generic enough to handle the
// route's actual filters, including bulk-invite's userId: {$in:[null,
// undefined]} unlinked-record guard.
function _teacherFilterMatch(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    return doc[k] === v;
  });
}

function mockMakeStore(initialDocs, matcher) {
  return {
    docs: [...initialDocs],
    find(filter) { return this.docs.find(d => matcher(d, filter)); },
    apply(doc, update) {
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    },
  };
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools')          return mockMakeCollection(mockSchools);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    return mockMakeCollection(mockMakeStore([], () => false));
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'users')            return mockMakeCollection(mockUsers);
    if (collection === 'custom_roles')     return mockMakeCollection(mockCustomRoles);
    if (collection === 'role_permissions') return mockMakeCollection(mockRolePerms);
    if (collection === 'teachers')         return mockMakeCollection(mockTeachers);
    return mockMakeCollection(mockMakeStore([], () => false));
  },
}));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}

function authCookie(payload) {
  return `token=${sign({ role: 'admin', ...payload })}`;
}

const SCHOOL_ID = 'sch_demo_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers = mockMakeStore(
    [{ id: 'usr_admin_001', email: 'admin@demo.school', role: 'admin', schoolId: SCHOOL_ID, isActive: true }],
    (d, f) => (f.id ? d.id === f.id : false) || (f.email ? d.email === f.email : false)
  );
  mockSchools = mockMakeStore([{ id: SCHOOL_ID, name: 'Demo School' }], (d, f) => d.id === f.id);
  mockCustomRoles = mockMakeStore([], () => false);
  mockRolePerms = mockMakeStore(
    [{ schoolId: SCHOOL_ID, roleKey: 'admin', permissions: { settings: ['read', 'create', 'update', 'delete'] } }],
    (d, f) => d.schoolId === f.schoolId && d.roleKey === f.roleKey
  );
  mockTeachers = mockMakeStore(
    [{ id: 'tch_robert', schoolId: SCHOOL_ID, userId: null, email: 'robert@demo.school', firstName: 'Robert', lastName: 'Kioko' }],
    _teacherFilterMatch
  );
});

describe('POST /api/settings/users/invite — Create Login Account backlink', () => {
  test('passing staffId links the new login back to that teacher record', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/users/invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ name: 'Robert Kioko', email: 'robert@demo.school', role: 'teacher', staffId: 'tch_robert' });

    expect(res.status).toBe(201);
    const newUserId = res.body.data.user.id;
    const teacher = mockTeachers.docs.find(t => t.id === 'tch_robert');
    expect(teacher.userId).toBe(newUserId);
  });

  test('no staffId (plain invite, not tied to an existing staff member) does not touch any teacher record', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/users/invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ name: 'Someone New', email: 'someone@demo.school', role: 'teacher' });

    expect(res.status).toBe(201);
    // The seeded teacher record is untouched — no staffId was sent.
    expect(mockTeachers.docs.find(t => t.id === 'tch_robert').userId).toBeNull();
  });

  test('a bad/unmatched staffId does not fail the invite — the backlink is best-effort', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/users/invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ name: 'X', email: 'x@demo.school', role: 'teacher', staffId: 'tch_does_not_exist' });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/settings/users/bulk-invite — teacher.userId backfill by email', () => {
  test('a bulk-invited login whose email matches an unlinked teacher record gets backfilled', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [{ name: 'Robert Kioko', email: 'robert@demo.school', role: 'teacher' }] });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    const newUser = mockUsers.docs.find(u => u.email === 'robert@demo.school');
    const teacher = mockTeachers.docs.find(t => t.id === 'tch_robert');
    expect(teacher.userId).toBe(newUser.id);
  });

  test('does not overwrite a teacher record that is already linked to someone else', async () => {
    // This teacher is the ONLY one with this email, and is already linked
    // — the userId: {$in:[null,undefined]} guard must exclude it, so a
    // second login sharing the email cannot steal the existing link.
    mockTeachers = mockMakeStore(
      [{ id: 'tch_other', schoolId: SCHOOL_ID, userId: 'usr_existing_link', email: 'robert@demo.school', firstName: 'Other', lastName: 'One' }],
      _teacherFilterMatch
    );

    const res = await supertest(buildApp())
      .post('/api/settings/users/bulk-invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ staff: [{ name: 'Robert Kioko', email: 'robert@demo.school', role: 'teacher' }] });

    expect(res.status).toBe(201);
    expect(mockTeachers.docs.find(t => t.id === 'tch_other').userId).toBe('usr_existing_link');
  });
});
