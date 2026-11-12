/* ============================================================
   POST /api/auth/forgot-password on a group (organisation) portal
   (v5.265.1)

   Reported 2026-11-12: a parent on "TIS Group of Schools" (tis.msingi.io)
   asked for a reset link and got "School 'tis' not found" — the portal's
   slug belongs to the organisation, and the reset request only looked up
   schools. Now: a slug no school has, belonging to an organisation with
   multiSchoolEnabled, finds the parent's shared identity and sends the
   ordinary reset link for one of that identity's school accounts.
   Every outcome answers the same way (no enumeration).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../services/audit', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/email', () => ({
  sendPasswordReset: jest.fn().mockResolvedValue(true),
  sendPasswordChanged: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/school-url', () => ({
  schoolLoginUrl: jest.fn(async (sid) => `https://${sid}.msingi.test`),
}));

let mockOrgs = [];
let mockSchools = [];
let mockIdentities = [];
let mockUsers = [];
const mockUserUpdates = [];

function mockChain(fn) {
  const lean = () => Promise.resolve(fn());
  return { lean, select: () => ({ lean }) };
}
function mockMatch(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k]);
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    return doc[k] === v;
  });
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    const src = { organizations: () => mockOrgs, schools: () => mockSchools, identities: () => mockIdentities, users: () => mockUsers }[collection];
    if (!src) {
      return { findOne: jest.fn(() => mockChain(() => null)), find: jest.fn(() => mockChain(() => [])), updateOne: jest.fn().mockResolvedValue({}) };
    }
    return {
      findOne: jest.fn((f) => mockChain(() => src().find(d => mockMatch(d, f)) || null)),
      find:    jest.fn((f) => mockChain(() => src().filter(d => mockMatch(d, f)))),
      updateOne: jest.fn((f, u) => { mockUserUpdates.push({ collection, f, u }); return Promise.resolve({}); }),
    };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const emailUtil = require('../../utils/email');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', require('../../routes/auth'));
  return a;
}
const post = (slug, body) => supertest(app()).post('/api/auth/forgot-password').set('X-School-Slug', slug).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  mockUserUpdates.length = 0;
  mockOrgs = [{ id: 'org_tis', slug: 'tis', name: 'TIS Group of Schools', multiSchoolEnabled: true }];
  mockSchools = [
    { id: 'sch_tis_a', slug: 'tis-primary',   name: 'TIS Primary',   organizationId: 'org_tis', isActive: true },
    { id: 'sch_tis_b', slug: 'tis-secondary', name: 'TIS Secondary', organizationId: 'org_tis', isActive: true },
  ];
  mockIdentities = [{ id: 'idn_1', orgId: 'org_tis', email: 'parent@example.com', status: 'active' }];
  mockUsers = [
    { _id: 'oid_u1', id: 'u_parent_a', schoolId: 'sch_tis_a', identityId: 'idn_1', email: 'parent@example.com', name: 'Henry', isActive: true },
  ];
});

const GENERIC = /If that address is on this school.s records/;

test('group portal: a known parent gets the reset link for their school account', async () => {
  const res = await post('tis', { email: 'Parent@Example.com ' });
  expect(res.status).toBe(200);
  expect(res.body.data.message).toMatch(GENERIC);
  expect(emailUtil.sendPasswordReset).toHaveBeenCalledTimes(1);
  const arg = emailUtil.sendPasswordReset.mock.calls[0][0];
  expect(arg.email).toBe('parent@example.com');
  expect(arg.schoolName).toBe('TIS Primary');
  expect(arg.resetUrl).toMatch(/^https:\/\/sch_tis_a\.msingi\.test\/reset-password\?ticket=.+&school=tis-primary$/);
  // The ticket was written to that school account.
  expect(mockUserUpdates.some(x => x.collection === 'users' && x.f._id === 'oid_u1')).toBe(true);
});

test('group portal: an unknown address gets the same answer and no email', async () => {
  const res = await post('tis', { email: 'nobody@example.com' });
  expect(res.status).toBe(200);
  expect(res.body.data.message).toMatch(GENERIC);
  expect(emailUtil.sendPasswordReset).not.toHaveBeenCalled();
});

test('group portal: an inactive account gets the same answer and no email', async () => {
  mockUsers[0].isActive = false;
  const res = await post('tis', { email: 'parent@example.com' });
  expect(res.status).toBe(200);
  expect(emailUtil.sendPasswordReset).not.toHaveBeenCalled();
});

test('the group portal can also be named in the body (orgSlug)', async () => {
  const res = await supertest(app()).post('/api/auth/forgot-password').send({ email: 'parent@example.com', orgSlug: 'tis' });
  expect(res.status).toBe(200);
  expect(emailUtil.sendPasswordReset).toHaveBeenCalledTimes(1);
});

test('a school slug still uses the normal school path', async () => {
  mockUsers.push({ _id: 'oid_u2', id: 'u_b', schoolId: 'sch_tis_b', email: 'teacher@example.com', name: 'T', isActive: true });
  const res = await post('tis-secondary', { email: 'teacher@example.com' });
  expect(res.status).toBe(200);
  expect(emailUtil.sendPasswordReset.mock.calls[0][0].resetUrl).toMatch(/&school=tis-secondary$/);
});

test('a slug that is both a school and an organisation is treated as the school (same rule as the sign-in page)', async () => {
  mockSchools.push({ id: 'sch_tis', slug: 'tis', name: 'TIS', organizationId: 'org_tis', isActive: true });
  mockUsers.push({ _id: 'oid_u3', id: 'u_t', schoolId: 'sch_tis', email: 'parent@example.com', name: 'Henry', isActive: true });
  const res = await post('tis', { email: 'parent@example.com' });
  expect(res.status).toBe(200);
  expect(emailUtil.sendPasswordReset.mock.calls[0][0].resetUrl).toMatch(/&school=tis$/);
});

test('an organisation that is not a group portal is not used (unknown slug still 404s as before)', async () => {
  mockOrgs[0].multiSchoolEnabled = false;
  const res = await post('tis', { email: 'parent@example.com' });
  expect(res.status).toBe(404);
  expect(emailUtil.sendPasswordReset).not.toHaveBeenCalled();
});
