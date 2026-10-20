/* ============================================================
   User-facing support tickets — route-level behaviour.

   The security boundary is visibility: a user only ever sees their own
   tickets, and internal operator notes never reach the requester. These
   tests pin that, plus the status transitions (operator reply → waiting,
   requester reply → open, closed is read-only).
   ============================================================ */
'use strict';

let mockUser = { userId: 'u1', schoolId: 's1', role: 'parent', email: 'parent@example.com' };

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockUser; next(); },
}));
jest.mock('../services/audit', () => ({ log: jest.fn() }));

jest.mock('../utils/model', () => {
  const state = { tickets: [], users: { u1: { id: 'u1', name: 'Parent One' }, u2: { id: 'u2', name: 'Parent Two' } } };
  const match = (doc, filter) => Object.entries(filter).every(([k, v]) => doc[k] === v);
  const api = {
    __state: state,
    countDocuments: async () => state.tickets.length,
    create: async (doc) => { state.tickets.push({ ...doc }); return doc; },
    find: (filter) => ({
      sort: () => ({ limit: () => ({ lean: async () => state.tickets.filter(t => match(t, filter)) }) }),
    }),
    findOne: (filter) => ({ lean: async () => state.tickets.find(t => match(t, filter)) || null }),
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        const t = state.tickets.find(x => match(x, filter));
        if (!t) return null;
        if (update.$push?.messages) t.messages = [...(t.messages || []), update.$push.messages];
        if (update.$set) Object.assign(t, update.$set);
        return { ...t };
      },
    }),
  };
  return {
    _model: (name) => {
      if (name === 'tickets') return api;
      if (name === 'schools') return { findOne: () => ({ lean: async () => ({ id: 's1', name: 'Test School' }) }) };
      if (name === 'users') return { findOne: (f) => ({ lean: async () => state.users[f.id] || null }) };
      return {};
    },
    __state: state,
  };
});

const express = require('express');
const supertest = require('supertest');
const router = require('../routes/support');
const { __state } = require('../utils/model');

const app = express();
app.use(express.json());
app.use('/api/support', router);

const seed = (overrides = {}) => {
  const t = {
    id: `tck_${Math.random().toString(16).slice(2)}`,
    ref: 'TCK-TEST',
    subject: 'A ticket',
    description: '',
    category: 'support',
    priority: 'normal',
    status: 'open',
    source: 'user',
    requesterUserId: 'u1',
    schoolId: 's1',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  __state.tickets.push(t);
  return t;
};

beforeEach(() => {
  __state.tickets.length = 0;
  mockUser = { userId: 'u1', schoolId: 's1', role: 'parent', email: 'parent@example.com' };
});

describe('support tickets — creation', () => {
  test('any authenticated school user can open a ticket, scoped to their account', async () => {
    const res = await supertest(app)
      .post('/api/support/tickets')
      .send({ subject: 'Printer is offline', description: 'Front office printer' });

    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe('Printer is offline');
    expect(res.body.data.status).toBe('open');

    const stored = __state.tickets[0];
    expect(stored.requesterUserId).toBe('u1');
    expect(stored.schoolId).toBe('s1');
    expect(stored.source).toBe('user');
    expect(stored.requesterRole).toBe('parent');
  });

  test('short subjects are rejected', async () => {
    const res = await supertest(app).post('/api/support/tickets').send({ subject: 'x' });
    expect(res.status).toBe(422);
  });
});

describe('support tickets — visibility', () => {
  test('a user only lists their own tickets', async () => {
    seed({ requesterUserId: 'u1', subject: 'Mine' });
    seed({ requesterUserId: 'u2', subject: 'Not mine' });

    const res = await supertest(app).get('/api/support/tickets');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subject).toBe('Mine');
  });

  test("fetching another user's ticket is a 404, not a leak", async () => {
    const other = seed({ requesterUserId: 'u2' });
    const res = await supertest(app).get(`/api/support/tickets/${other.id}`);
    expect(res.status).toBe(404);
  });

  test('internal operator notes are never returned to the requester', async () => {
    const t = seed({
      messages: [
        { id: 'm1', author: 'Support', authorType: 'operator', internal: false, body: 'Public answer', createdAt: new Date().toISOString() },
        { id: 'm2', author: 'Support', authorType: 'operator', internal: true, body: 'INTERNAL ONLY', createdAt: new Date().toISOString() },
      ],
    });

    const res = await supertest(app).get(`/api/support/tickets/${t.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(1);
    expect(JSON.stringify(res.body.data)).not.toContain('INTERNAL ONLY');
  });
});

describe('support tickets — replies', () => {
  test('a requester reply reopens a waiting ticket', async () => {
    const t = seed({ status: 'waiting' });

    const res = await supertest(app)
      .post(`/api/support/tickets/${t.id}/messages`)
      .send({ body: 'Still broken today.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('open');
    expect(res.body.data.messages.at(-1).body).toBe('Still broken today.');
    expect(res.body.data.messages.at(-1).authorType).toBe('requester');
  });

  test('a closed ticket is read-only', async () => {
    const t = seed({ status: 'closed' });
    const res = await supertest(app)
      .post(`/api/support/tickets/${t.id}/messages`)
      .send({ body: 'One more thing' });
    expect(res.status).toBe(400);
  });
});
