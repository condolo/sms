/* ============================================================
   server/routes/messages.js — rich message routes

     GET  /attachments/:attachmentId   the bytes behind a document card
     POST /:id/vote                    one choice per recipient

   Both are gated by the same inbox membership as the message itself:
   an attachment id or message id alone is not a key.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

const mockCollections = {};

function pathGet(doc, path) {
  return path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), doc);
}

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some(sub => mockMatches(doc, sub));
    const actual = pathGet(doc, key);
    if (Array.isArray(actual)) {
      if (cond && typeof cond === 'object' && '$in' in cond) return actual.some(x => cond.$in.includes(x));
      return actual.includes(cond);
    }
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond) return cond.$in.includes(actual);
      return true;
    }
    return actual === cond;
  });
}

function chain(rows) {
  let data = rows;
  const c = {
    select: () => c,
    lean: () => Promise.resolve(data),
  };
  return c;
}

function mockCollection(name) {
  if (!mockCollections[name]) {
    const seed = [];
    mockCollections[name] = {
      _seed: seed,
      findOne: jest.fn((filter) => chain(seed.find(d => mockMatches(d, filter)) ?? null)),
      updateOne: jest.fn(() => Promise.resolve({ modifiedCount: 1 })),
      /* Enough of a delete for the routes that sweep rows: remove what
         matches and report the count, like the driver does. */
      deleteOne: jest.fn((filter) => {
        const i = seed.findIndex(d => mockMatches(d, filter));
        if (i >= 0) seed.splice(i, 1);
        return Promise.resolve({ deletedCount: i >= 0 ? 1 : 0 });
      }),
      deleteMany: jest.fn((filter) => {
        let removed = 0;
        for (let i = seed.length - 1; i >= 0; i--) {
          if (mockMatches(seed[i], filter)) { seed.splice(i, 1); removed++; }
        }
        return Promise.resolve({ deletedCount: removed });
      }),
    };
  }
  return mockCollections[name];
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((name) => mockCollection(name)),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((name) => mockCollection(name)),
}));

const express   = require('express');
const supertest = require('supertest');
const messagesRouter = require('../../routes/messages');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messagesRouter);
  return app;
}

const SCHOOL = 'sch_demo';
const PARENT = 'u_parent';
const OTHER_PARENT = 'u_other';
const DOC_BYTES = Buffer.from('hello');

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of Object.keys(mockCollections)) delete mockCollections[name];
});

describe('GET /api/messages/attachments/:attachmentId', () => {
  function seed() {
    mockCollection('message_attachments')._seed.push({
      schoolId: SCHOOL, id: 'att_1', messageId: 'm_1', name: 'worksheet.pdf',
      mimeType: 'application/pdf', size: DOC_BYTES.length, data: DOC_BYTES.toString('base64'),
    });
    mockCollection('messages')._seed.push({
      schoolId: SCHOOL, id: 'm_1', senderId: 'u_teacher', recipients: [PARENT], subject: 'Homework',
    });
  }

  test('a recipient downloads the real bytes with a safe filename', async () => {
    seed();
    const res = await supertest(buildApp({ userId: PARENT, schoolId: SCHOOL, role: 'parent' }))
      .get('/api/messages/attachments/att_1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('worksheet.pdf');
    expect(res.body).toEqual(DOC_BYTES);
  });

  test('holding the id is not enough — a non-recipient gets 404', async () => {
    seed();
    const res = await supertest(buildApp({ userId: OTHER_PARENT, schoolId: SCHOOL, role: 'parent' }))
      .get('/api/messages/attachments/att_1');
    expect(res.status).toBe(404);
  });

  test('the sender can re-open their own document from the Sent bubble', async () => {
    seed();
    const res = await supertest(buildApp({ userId: 'u_teacher', schoolId: SCHOOL, role: 'teacher' }))
      .get('/api/messages/attachments/att_1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DOC_BYTES);
  });

  test('an unknown attachment is a 404', async () => {
    const res = await supertest(buildApp({ userId: PARENT, schoolId: SCHOOL, role: 'parent' }))
      .get('/api/messages/attachments/att_nope');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/messages/:id — the document goes with the message', () => {
  test('deleting a message takes its own attachment blobs and nobody else\'s', async () => {
    mockCollection('messages')._seed.push(
      { schoolId: SCHOOL, id: 'm_doc', senderId: 'u_super', recipients: [PARENT], subject: 'Homework', body: 'See the sheet' },
      { schoolId: SCHOOL, id: 'm_keep', senderId: 'u_super', recipients: [PARENT], subject: 'Other', body: 'Keep me' },
    );
    mockCollection('message_attachments')._seed.push(
      { schoolId: SCHOOL, id: 'att_a', messageId: 'm_doc',  name: 'sheet.pdf',  mimeType: 'application/pdf', size: 10, data: 'AAAA' },
      { schoolId: SCHOOL, id: 'att_b', messageId: 'm_doc',  name: 'notes.txt',  mimeType: 'text/plain',      size: 10, data: 'BBBB' },
      { schoolId: SCHOOL, id: 'att_c', messageId: 'm_keep', name: 'kept.txt',   mimeType: 'text/plain',      size: 10, data: 'CCCC' },
    );

    const res = await supertest(buildApp({ userId: 'u_admin', schoolId: SCHOOL, role: 'superadmin' }))
      .delete('/api/messages/m_doc');

    expect(res.status).toBe(200);
    expect(mockCollections.messages._seed.map(m => m.id)).toEqual(['m_keep']);
    // The bytes are the school's storage bill — they must not outlive the message.
    expect(mockCollections.message_attachments._seed.map(a => a.id)).toEqual(['att_c']);
  });
});

describe('POST /api/messages/:id/vote', () => {  const poll = () => ({
    question: 'Meeting at 4?',
    options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }],
    votes: { u_other: 'o1' },
    closesAt: null,
  });

  test('saves this reader\'s choice and returns fresh counts', async () => {
    mockCollection('messages')._seed.push({
      schoolId: SCHOOL, id: 'm_1', senderId: 'u_teacher', recipients: [PARENT], subject: 'Meeting',
      kind: 'poll', poll: poll(),
    });

    const res = await supertest(buildApp({ userId: PARENT, schoolId: SCHOOL, role: 'parent' }))
      .post('/api/messages/m_1/vote')
      .send({ optionId: 'o2' });

    expect(res.status).toBe(200);
    expect(res.body.data.totalVotes).toBe(2);
    expect(res.body.data.myVote).toBe('o2');
    expect(res.body.data.options.find(o => o.id === 'o2').votes).toBe(1);

    const Msg = mockCollection('messages');
    expect(Msg.updateOne).toHaveBeenCalledWith(
      { id: 'm_1', schoolId: SCHOOL },
      { $set: { [`poll.votes.${PARENT}`]: 'o2' } },
    );
  });

  test('an option that is not on the poll is refused', async () => {
    mockCollection('messages')._seed.push({
      schoolId: SCHOOL, id: 'm_1', senderId: 'u_teacher', recipients: [PARENT], kind: 'poll', poll: poll(),
    });
    const res = await supertest(buildApp({ userId: PARENT, schoolId: SCHOOL, role: 'parent' }))
      .post('/api/messages/m_1/vote')
      .send({ optionId: 'o9' });
    expect(res.status).toBe(400);
  });

  test('a closed poll refuses new votes', async () => {
    mockCollection('messages')._seed.push({
      schoolId: SCHOOL, id: 'm_1', senderId: 'u_teacher', recipients: [PARENT], kind: 'poll',
      poll: { ...poll(), closesAt: '2020-01-01T00:00:00.000Z' },
    });
    const res = await supertest(buildApp({ userId: PARENT, schoolId: SCHOOL, role: 'parent' }))
      .post('/api/messages/m_1/vote')
      .send({ optionId: 'o1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
  });

  test('a non-recipient cannot vote', async () => {
    mockCollection('messages')._seed.push({
      schoolId: SCHOOL, id: 'm_1', senderId: 'u_teacher', recipients: [PARENT], kind: 'poll', poll: poll(),
    });
    const res = await supertest(buildApp({ userId: OTHER_PARENT, schoolId: SCHOOL, role: 'parent' }))
      .post('/api/messages/m_1/vote')
      .send({ optionId: 'o1' });
    expect(res.status).toBe(404);
  });
});
