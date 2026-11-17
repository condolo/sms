/* ============================================================
   PUT /api/students/:id — changing a guardian's email moves that
   parent's LOGIN email too (v5.277.0).

   Reported 2026-11-16: a parent's email was changed on the student
   profile but school notifications kept arriving at the old address.
   Parent notifications go to the parent account (users.email); this
   route only changed the student record. Pins:
     - the linked parent account moves to the new email;
     - an account for a DIFFERENT student is never touched;
     - if another account already uses the new address, nothing moves
       and the response says so (guardianAccountSync 'skipped');
     - both addresses get a notice; an unchanged email does nothing.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: 'sch', role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: jest.fn(async (jobs) => { for (const j of jobs) await j(); }) }));
jest.mock('../../utils/email', () => ({ sendLoginEmailChanged: jest.fn(async () => true) }));
jest.mock('../../utils/model', () => ({
  _model: () => ({ findOne: () => ({ select: () => ({ lean: async () => ({ name: 'Trinitas Test', systemEmail: 'office@school.test' }) }) }) }),
}));

let mockStudent;
let mockUsers;
const mockSnap = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
const mockChain = (v) => ({ select: () => mockChain(v), lean: async () => mockSnap(v) });

jest.mock('../../utils/optimistic-lock', () => ({
  applyOptimisticLock: jest.fn(async (_M, _f, fields) => { Object.assign(mockStudent, fields); return { doc: { ...mockStudent }, conflict: false }; }),
}));

function mockMatches(u, f) {
  if (f.schoolId && u.schoolId !== f.schoolId) return false;
  if (f.role && u.role !== f.role) return false;
  if (f.email && u.email !== f.email) return false;
  if (f._id && f._id.$ne !== undefined && u._id === f._id.$ne) return false;
  if (f._id && typeof f._id === 'string' && u._id !== f._id) return false;
  if (f.$or && !f.$or.some(c => (c.guardianOf && (u.guardianOf || []).includes(c.guardianOf)) || (c.studentIds && (u.studentIds || []).includes(c.studentIds)))) return false;
  return true;
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: () => ({ schoolId: 'sch' }),
  tenantModel: (name) => {
    if (name === 'students') return { findOne: () => mockChain(mockStudent) };
    if (name === 'users') return {
      findOne: (f) => mockChain(mockUsers.find(u => mockMatches(u, f)) || null),
      updateOne: async (f, upd) => { const u = mockUsers.find(x => mockMatches(x, f)); if (u) Object.assign(u, upd.$set); return { matchedCount: u ? 1 : 0 }; },
    };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  },
}));

const express = require('express');
const supertest = require('supertest');
const emailUtil = require('../../utils/email');
const router = require('../../routes/students');
const app = () => { const a = express(); a.use(express.json()); a.use('/api/students', router); return a; };

beforeEach(() => {
  jest.clearAllMocks();
  mockStudent = { _id: 'oid_s1', id: 'stu_1', schoolId: 'sch', firstName: 'A', lastName: 'B', _v: 1,
    fatherName: 'Collins Parent', fatherEmail: 'old@mail.test', primaryContact: 'father' };
  mockUsers = [
    { _id: 'u1', id: 'u1', schoolId: 'sch', role: 'parent', name: 'Collins Parent', email: 'old@mail.test', studentIds: ['stu_1'] },
    { _id: 'u2', id: 'u2', schoolId: 'sch', role: 'parent', name: 'Other', email: 'old@mail.test', studentIds: ['stu_other'] },
  ];
});

test('changing the father email moves his parent login to the new address', async () => {
  const res = await supertest(app()).put('/api/students/stu_1').send({ fatherEmail: 'New@Mail.test', _v: 1 });
  expect(res.status).toBe(200);
  expect(mockUsers[0].email).toBe('new@mail.test');
  expect(res.body.data.guardianAccountSync).toEqual([{ field: 'fatherEmail', status: 'updated', from: 'old@mail.test', to: 'new@mail.test' }]);
  expect(emailUtil.sendLoginEmailChanged.mock.calls.map(c => c[0].email).sort()).toEqual(['new@mail.test', 'old@mail.test']);
});

test("another student's parent account is never touched", async () => {
  await supertest(app()).put('/api/students/stu_1').send({ fatherEmail: 'new@mail.test', _v: 1 });
  expect(mockUsers[1].email).toBe('old@mail.test');
});

test('new address already used by another account: nothing moves, and the response says why', async () => {
  mockUsers.push({ _id: 'u3', id: 'u3', schoolId: 'sch', role: 'teacher', email: 'new@mail.test' });
  const res = await supertest(app()).put('/api/students/stu_1').send({ fatherEmail: 'new@mail.test', _v: 1 });
  expect(res.status).toBe(200);
  expect(mockUsers[0].email).toBe('old@mail.test');
  expect(res.body.data.guardianAccountSync[0]).toMatchObject({ field: 'fatherEmail', status: 'skipped' });
  expect(emailUtil.sendLoginEmailChanged).not.toHaveBeenCalled();
});

test('an edit that does not change the email does nothing to the account', async () => {
  const res = await supertest(app()).put('/api/students/stu_1').send({ fatherEmail: 'OLD@mail.test', _v: 1 });
  expect(mockUsers[0].email).toBe('old@mail.test');
  expect(res.body.data.guardianAccountSync).toBeUndefined();
});
