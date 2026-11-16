/* ============================================================
   Settings split into sections (v5.275.0)

   Asked for directly (2026-11-16): "have the setting module into sub
   modules so that I can assign some sections so that a user can take
   some roles". Each Settings tab now has its own Roles & Permissions row,
   checked by its own routes. Uses the REAL rbac middleware against saved
   role_permissions docs (shaped exactly as settings.js _deriveApiPerms
   writes them: every sub-row explicit, the coarse key the union).

   Pins:
     - a role granted one section can use that section and not the others,
       even though its coarse 'settings' grant is the union;
     - PUT /settings/school checks each section the request touches
       (school fields / moduleConfig / role labels);
     - Roles & Permissions and the Audit Log are strict (explicit grant);
     - a role never re-saved since the rows existed keeps its old access
       (coarse fallback) — nothing changes until an admin edits the role;
     - the user list and custom-role list stay readable on the coarse grant
       (HR, Inventory, Attendance… read them).
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn(), query: jest.fn(async () => ({ items: [], total: 0 })), listActions: jest.fn(() => []), stats: jest.fn(async () => ({})) }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));

const express = require('express');
const supertest = require('supertest');
const { invalidatePermCache } = require('../../middleware/rbac');

const RW = ['read', 'create', 'update'];
const SUBS = ['school', 'academics', 'users', 'permissions', 'modules', 'notifications', 'reminders', 'message_templates', 'system', 'audit_log'];

/* A role saved through Roles & Permissions: every settings row explicit, coarse = union. */
function saved(granted) {
  const p = {};
  for (const s of SUBS) p[`settings__${s}`] = granted[s] || [];
  p.settings = [...new Set(Object.values(granted).flat())];
  return p;
}

let n = 0;
function setup(permissions) {
  const schoolId = `sch_${++n}`;
  invalidatePermCache(schoolId);
  mockDb = createFakeDb({
    schools: [{ id: schoolId, name: 'Old Name', modulePermissions: { byRole: {}, byUser: {} } }],
    role_permissions: [{ schoolId, roleKey: 'secretary', permissions }],
    users: [{ id: 'u_sec', schoolId, role: 'secretary', name: 'Sec' }],
    custom_roles: [{ schoolId, key: 'custom_x', label: 'X' }],
    notification_settings: [],
  });
  mockJwtUser = { userId: 'u_sec', schoolId, role: 'secretary', roles: ['secretary'] };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/settings', require('../../routes/settings'));
  a.use('/api/smart-reminders', require('../../routes/smart-reminders'));
  a.use('/api/audit', require('../../routes/audit'));
  a.use('/api/academic-config', require('../../routes/academic-config'));
  return a;
}
const api = () => supertest(app());

describe('a role given only some Settings sections', () => {
  test('Users only: can invite-check users but not change the school, modules, notifications, reminders or grading', async () => {
    setup(saved({ users: RW }));
    expect((await api().put('/api/settings/school').send({ name: 'New' })).status).toBe(403);
    expect((await api().put('/api/settings/school').send({ moduleConfig: {} })).status).toBe(403);
    expect((await api().get('/api/settings/notifications')).status).toBe(403);
    expect((await api().get('/api/smart-reminders')).status).toBe(403);
    expect((await api().put('/api/academic-config').send({ passMark: 50 })).status).toBe(403);
    expect((await api().put('/api/settings/notification-templates/welcome').send({ body: 'x' })).status).toBe(403);
    expect(mockDb.data.schools[0].name).toBe('Old Name');
    // Its own section passes the permission check (the handler may then validate input).
    expect((await api().post('/api/settings/users/invite').send({})).status).not.toBe(403);
  });

  test('School only: can save school fields but not module switches or role labels in the same route', async () => {
    setup(saved({ school: RW }));
    const ok = await api().put('/api/settings/school').send({ name: 'New Name' });
    expect(ok.status).not.toBe(403);
    expect(mockDb.data.schools[0].name).toBe('New Name');
    const mod = await api().put('/api/settings/school').send({ moduleConfig: { library: false } });
    expect(mod.status).toBe(403);
    expect(mod.body.error.message).toMatch(/Modules/);
    const mixed = await api().put('/api/settings/school').send({ name: 'Again', roleLabels: { teacher: 'Educator' } });
    expect(mixed.status).toBe(403);
    expect(mockDb.data.schools[0].name).toBe('New Name');      // nothing from the refused request saved
  });

  test('Modules only: can switch modules but not edit the school profile', async () => {
    setup(saved({ modules: RW }));
    expect((await api().put('/api/settings/school').send({ moduleConfig: { library: false } })).status).not.toBe(403);
    expect((await api().put('/api/settings/school').send({ name: 'Nope' })).status).toBe(403);
  });

  test('Smart reminders and Notifications open only their own routes', async () => {
    setup(saved({ reminders: ['read', 'update'], notifications: ['read'] }));
    expect((await api().get('/api/smart-reminders')).status).not.toBe(403);
    expect((await api().get('/api/settings/notifications')).status).not.toBe(403);
    expect((await api().put('/api/settings/notifications').send({})).status).toBe(403);   // view only
    expect((await api().get('/api/settings/notification-templates')).status).toBe(403);
  });

  test('Academic setup opens grading changes; reading the config stays open to Settings readers', async () => {
    setup(saved({ academics: RW }));
    expect((await api().put('/api/academic-config').send({ passMark: 50 })).status).not.toBe(403);
    setup(saved({ users: RW }));
    expect((await api().get('/api/academic-config')).status).not.toBe(403);
  });
});

describe('strict sections', () => {
  test('Roles & Permissions: editing or deleting a custom role needs the explicit grant', async () => {
    setup(saved({ school: RW, users: RW }));
    expect((await api().put('/api/settings/custom-roles/custom_x').send({ label: 'Y' })).status).toBe(403);
    expect((await api().delete('/api/settings/custom-roles/custom_x')).status).toBe(403);
    expect(mockDb.data.custom_roles).toHaveLength(1);
    // The list itself stays readable (reference data for other modules).
    expect((await api().get('/api/settings/custom-roles')).status).not.toBe(403);
    setup(saved({ permissions: RW }));
    expect((await api().put('/api/settings/custom-roles/custom_x').send({ label: 'Y' })).status).not.toBe(403);
  });

  test('Audit Log: admin, or the explicit View Audit Log grant — never the coarse grant', async () => {
    setup({ settings: ['read', 'update'] });                    // coarse only
    expect((await api().get('/api/audit')).status).toBe(403);
    setup(saved({ audit_log: ['read'] }));
    expect((await api().get('/api/audit')).status).not.toBe(403);
    setup({});
    mockJwtUser.role = 'admin';
    expect((await api().get('/api/audit')).status).not.toBe(403);
  });
});

describe('roles not re-saved since the sections existed keep their access', () => {
  test('a coarse-only settings grant still opens every non-strict section, as before', async () => {
    setup({ settings: ['read', 'create', 'update'] });
    expect((await api().put('/api/settings/school').send({ name: 'Kept' })).status).not.toBe(403);
    expect((await api().get('/api/settings/notifications')).status).not.toBe(403);
    expect((await api().get('/api/smart-reminders')).status).not.toBe(403);
    expect((await api().put('/api/settings/school').send({ moduleConfig: {} })).status).not.toBe(403);
  });
});
