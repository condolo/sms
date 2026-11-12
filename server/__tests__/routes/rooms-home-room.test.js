/* ============================================================
   v5.269.2 — rooms.homeFor ("Home room for")
   A room can be the home room of classes or streams of this school; one
   home room per class/stream; validated on create and update.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (req, _res, next) => next() }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));

const express = require('express');
const supertest = require('supertest');
const router = require('../../routes/rooms');

const S = 'school_A';
const app = () => { const a = express(); a.use(express.json()); a.use('/api/rooms', router); return a; };
const api = () => supertest(app());

beforeEach(() => {
  mockJwtUser = { userId: 'u_admin', schoolId: S, role: 'admin' };
  mockDb = createFakeDb({
    classes: [
      { id: 'c1', schoolId: S, name: 'Form 1A' },
      { _id: '64b7f0c2e4a1d93f5c8b2a17', schoolId: S, name: 'Form 1B' },   // no `id` field
      { id: 'cX', schoolId: 'school_B', name: 'Other school class' },
    ],
    streams: [
      { id: 'st1', schoolId: S, classId: 'c1', name: 'East' },
      { id: 'st2', schoolId: S, classId: 'c1', name: 'West' },
    ],
    rooms: [{ id: 'r_existing', schoolId: S, name: 'Room 9', type: 'classroom', homeFor: [{ classId: 'c1', streamId: 'st1' }] }],
  });
});

test('a room can be the home room of a class, a stream, or an id-less class', async () => {
  const res = await api().post('/api/rooms').send({
    name: 'Room 1', type: 'classroom',
    homeFor: [{ classId: 'c1' }, { classId: 'c1', streamId: 'st2' }, { classId: '64b7f0c2e4a1d93f5c8b2a17' }],
  });
  expect(res.status).toBe(201);
  expect(res.body.data.homeFor).toEqual([
    { classId: 'c1', streamId: null }, { classId: 'c1', streamId: 'st2' }, { classId: '64b7f0c2e4a1d93f5c8b2a17', streamId: null },
  ]);
});

test('refused: another school\'s class, a stream of a different class, or a class/stream that already has a home room', async () => {
  expect((await api().post('/api/rooms').send({ name: 'A', homeFor: [{ classId: 'cX' }] })).status).toBe(409);
  mockDb.data.streams.push({ id: 'stZ', schoolId: S, classId: 'other', name: 'Z' });
  expect((await api().post('/api/rooms').send({ name: 'B', homeFor: [{ classId: 'c1', streamId: 'stZ' }] })).status).toBe(409);
  const dup = await api().post('/api/rooms').send({ name: 'C', homeFor: [{ classId: 'c1', streamId: 'st1' }] });
  expect(dup.status).toBe(409);
  expect(dup.body.error.message).toMatch(/already has a home room: Room 9/);
  expect((await api().post('/api/rooms').send({ name: 'D', homeFor: [{ classId: 'c1' }, { classId: 'c1' }] })).status).toBe(409);
});

test('editing a room keeps its own home classes (not a clash with itself)', async () => {
  const res = await api().put('/api/rooms/r_existing').send({ homeFor: [{ classId: 'c1', streamId: 'st1' }, { classId: 'c1' }] });
  expect(res.status).toBe(200);
});

test('extra fields in a home entry are refused', async () => {
  expect((await api().post('/api/rooms').send({ name: 'E', homeFor: [{ classId: 'c1', hack: 1 }] })).status).toBe(422);
});
