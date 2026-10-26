/* ============================================================
   server/routes/students.js — bulk-portal-accounts /
   bulk-reset-portal-passwords: welcome-credential email fix (2026-10-26)

   Reported directly: many real parents (393 at one live school, 85-94%
   of each bulk batch) never received their welcome-credentials email and
   could never log in, confirmed independently by several parents saying
   so directly to the school. Traced to two compounding bugs in this
   file's bulk routes, neither present in import-export.js's own bulk
   welcome-email path (the correct reference implementation):

   1. Every sendWelcomeCredentials() call here omitted `schoolId`, so
      utils/email.js's _resolveTransporter() always fell back to the
      single SHARED platform SMTP mailbox instead of the school's own
      configured custom SMTP — and that fallback path's Reply-To defaults
      to the platform owner's own email whenever the school's systemEmail
      is unset (true for every real school in production), explaining a
      second, related complaint: parent replies landing with the platform
      owner instead of the school.
   2. The bulk loops fired every guardian's email send concurrently
      inside one Promise.all with no throttling — hundreds of simultaneous
      sends against the one shared mailbox, which Gmail throttles/rejects
      under that kind of burst. import-export.js already uses
      utils/email-queue.js's enqueueBatch() for exactly this reason; these
      routes never adopted it.

   This file pins both fixes for both bulk routes. All DB calls are
   mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn().mockResolvedValue(false), // never reached — admin is floor — but must exist
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/counters', () => ({
  nextFreeAdmissionNumber:     jest.fn().mockResolvedValue('ADM-001'),
  reserveFreeAdmissionNumbers: jest.fn().mockResolvedValue(['ADM-001']),
}));
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens:     jest.fn(() => Promise.resolve()),
  revokeIdentityTokens: jest.fn(() => Promise.resolve()),
}));

const mockSendWelcomeCredentials = jest.fn(() => Promise.resolve(true));
jest.mock('../../utils/email', () => ({ sendWelcomeCredentials: (...args) => mockSendWelcomeCredentials(...args) }));

// enqueueBatch mocked to actually RUN the thunks (so downstream assertions
// on sendWelcomeCredentials still see the calls) while recording exactly
// what it was handed — the real fix is "did the route hand sends to this
// throttling utility instead of firing them all at once", not whether the
// mock itself throttles.
const mockEnqueueBatch = jest.fn(async (thunks) => {
  for (const fn of thunks) await fn();
});
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: (...args) => mockEnqueueBatch(...args) }));

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}

let mockStudentDocs;
let mockUsersDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return { findOne: () => mockChain({ id: SCHOOL, name: 'Test School', plan: 'enterprise', systemEmail: '', slug: 'test' }) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? SCHOOL }),
  tenantModel: jest.fn((collection) => {
    if (collection === 'students') {
      return {
        find: (filter) => mockChain(mockStudentDocs.filter((s) => {
          if (filter.id?.$in) return filter.id.$in.includes(s.id);
          return true;
        })),
        findOne: (filter) => mockChain(mockStudentDocs.find((s) => s.id === filter.id || s._id === filter._id) ?? null),
        updateOne: (filter, update) => {
          const s = mockStudentDocs.find((d) => d._id === filter._id);
          if (s && update.$set) Object.assign(s, update.$set);
          return Promise.resolve({ matchedCount: s ? 1 : 0 });
        },
      };
    }
    if (collection === 'users') {
      return {
        findOne: (filter) => mockChain(mockUsersDocs.find((u) => u.email === filter.email && u.schoolId === filter.schoolId && (!filter.role || u.role === filter.role)) ?? null),
        create: (doc) => { const d = { ...doc, _id: `uid_${mockUsersDocs.length + 1}` }; mockUsersDocs.push(d); return Promise.resolve(d); },
        updateOne: (filter, update) => {
          const d = mockUsersDocs.find((u) => u._id === filter._id);
          if (!d) return Promise.resolve({ matchedCount: 0 });
          if (update.$addToSet) {
            for (const [k, v] of Object.entries(update.$addToSet)) {
              d[k] = Array.isArray(d[k]) ? d[k] : [];
              const toAdd = v.$each ?? [v];
              for (const item of toAdd) if (!d[k].includes(item)) d[k].push(item);
            }
          }
          if (update.$set) Object.assign(d, update.$set);
          return Promise.resolve({ matchedCount: 1 });
        },
      };
    }
    return { find: () => mockChain([]), findOne: () => mockChain(null) };
  }),
}));

const express        = require('express');
const supertest      = require('supertest');
const studentsRouter = require('../../routes/students');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}

function makeStudents() {
  return [
    { id: 's1', _id: 'oid_s1', schoolId: SCHOOL, status: 'active', firstName: 'Amara', lastName: 'Osei',  admissionNumber: 'ADM-001', parentEmail: 'parent1@example.com', parentName: 'Mr Osei' },
    { id: 's2', _id: 'oid_s2', schoolId: SCHOOL, status: 'active', firstName: 'Kwame', lastName: 'Kamau', admissionNumber: 'ADM-002', parentEmail: 'parent2@example.com', parentName: 'Mrs Kamau' },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDocs = makeStudents();
  mockUsersDocs   = [];
});

describe('POST /api/students/bulk-portal-accounts — welcome-email fix', () => {
  test('queues parent welcome emails through enqueueBatch instead of firing them all at once', async () => {
    const res = await supertest(buildApp())
      .post('/api/students/bulk-portal-accounts')
      .send({ studentIds: ['s1', 's2'] });

    expect(res.status).toBe(200);
    expect(mockEnqueueBatch).toHaveBeenCalledTimes(1);
    const thunks = mockEnqueueBatch.mock.calls[0][0];
    expect(Array.isArray(thunks)).toBe(true);
    expect(thunks).toHaveLength(2); // one per distinct parent email
    expect(thunks.every((t) => typeof t === 'function')).toBe(true);
  });

  test('every queued welcome email carries schoolId, so it uses the school\'s own SMTP, not the shared platform mailbox', async () => {
    await supertest(buildApp())
      .post('/api/students/bulk-portal-accounts')
      .send({ studentIds: ['s1', 's2'] });

    expect(mockSendWelcomeCredentials).toHaveBeenCalledTimes(2);
    for (const call of mockSendWelcomeCredentials.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ schoolId: SCHOOL }));
    }
    const emails = mockSendWelcomeCredentials.mock.calls.map((c) => c[0].email).sort();
    expect(emails).toEqual(['parent1@example.com', 'parent2@example.com']);
  });
});

describe('POST /api/students/bulk-reset-portal-passwords — welcome-email fix', () => {
  function makeClassStudents() {
    return [
      { id: 's1', _id: 'oid_s1', schoolId: SCHOOL, classId: 'classA', status: 'active', firstName: 'Amara', lastName: 'Osei',  admissionNumber: 'ADM-001', parentEmail: 'parent1@example.com', parentName: 'Mr Osei', schoolEmail: 'amara@example.com' },
      { id: 's2', _id: 'oid_s2', schoolId: SCHOOL, classId: 'classA', status: 'active', firstName: 'Kwame', lastName: 'Kamau', admissionNumber: 'ADM-002', parentEmail: 'parent2@example.com', parentName: 'Mrs Kamau' },
    ];
  }

  beforeEach(() => {
    mockStudentDocs = makeClassStudents();
  });

  test('queues BOTH student and parent welcome emails through enqueueBatch, each call carrying schoolId', async () => {
    const res = await supertest(buildApp())
      .post('/api/students/bulk-reset-portal-passwords')
      .send({ classId: 'classA' });

    expect(res.status).toBe(200);
    // One enqueueBatch call for students (only s1 has schoolEmail), one for parents (s1+s2)
    expect(mockEnqueueBatch).toHaveBeenCalledTimes(2);

    expect(mockSendWelcomeCredentials).toHaveBeenCalled();
    for (const call of mockSendWelcomeCredentials.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ schoolId: SCHOOL }));
    }
    const recipients = mockSendWelcomeCredentials.mock.calls.map((c) => c[0].email).sort();
    expect(recipients).toEqual(['amara@example.com', 'parent1@example.com', 'parent2@example.com']);
  });
});
