/* ============================================================
   Tests — child linking (board flow 03) and the plaintext-once rule

     POST /api/settings/link-codes     office issues a code
     GET  /api/settings/link-codes     office audits them (never the hash)
     POST /api/parent-portal/link/preview   parent sees the record
     POST /api/parent-portal/link/confirm   parent is granted access

   What is pinned, because each is a way this feature could quietly
   become an access-control hole:

   - the plaintext code is returned ONCE and never stored: the server
     keeps a SHA-256 hash, and the list endpoint cannot leak it even by
     accident (projection, not a filter);
   - issuing a new code supersedes the previous one, so a slip that goes
     missing stops working;
   - preview GRANTS NOTHING — a parent can look at the record and back out;
   - confirm is single-use: two taps of the same code add one guardian, not
     two, and the loser is told the code is used;
   - co-guardian codes land in guardianOf, primary ones in studentIds —
     the two fields every child-access check in the product reads;
   - confirming re-issues the session, because child lists are baked into
     the JWT: without that the parent would be linked and still refused.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

/* Portal access is tier-gated; these suites test behaviour, not billing. */
jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next(), invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (req, _res, next) => next(), invalidatePermCache: jest.fn() }));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { ...global.__JWT }; next(); },
}));

jest.mock('../../utils/timetable-publish', () => ({
  isTimetablePublished: jest.fn().mockResolvedValue(false),
  publishedReader: jest.fn().mockResolvedValue({ find: () => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) }) }),
}));

jest.mock('../../routes/messages', () => ({
  _inboxQuery: () => ({ schoolId: 'sch_1' }),
  createDirectMessage: jest.fn(),
}));

jest.mock('../../routes/weekly-snapshots', () => ({ _helpers: { findAuthorizedStudent: jest.fn() } }));

/* The shared permission-derivation helpers settings.js exports are used by
   other settings routes; stubbed so this file only exercises link codes. */
jest.mock('../../middleware/tenant', () => ({
  CURRENCY_SYMBOLS: { KES: 'KSh' },
  tenantMiddleware: (req, _res, next) => next(),
  _mapSchoolDoc: jest.fn(),
}));

const mockIssueMobileSession = jest.fn(async () => ({
  token: 'tok-fresh',
  user: { id: 'usr_parent', name: 'Mrs. Kamau', role: 'parent' },
  school: { id: 'sch_1', name: 'Riverside Academy' },
  absoluteExpiry: '2026-10-25T00:00:00.000Z',
}));

jest.mock('../../routes/auth', () => ({ _issueMobileSession: (...args) => mockIssueMobileSession(...args) }));

jest.mock('../../services/audit', () => ({ log: jest.fn() }));

const crypto = require('crypto');

const SCHOOL = 'sch_1';
const PARENT = 'usr_parent';
const CHILD  = 'stu_brian';

/* ── minimal in-memory collection ─────────────────────────────── */

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond) return Array.isArray(doc[key]) ? doc[key].some((v) => cond.$in.includes(v)) : cond.$in.includes(doc[key]);
      if ('$ne' in cond) return doc[key] !== cond.$ne;
      if ('$exists' in cond) return cond.$exists ? doc[key] !== undefined : doc[key] === undefined;
      return false;
    }
    if (Array.isArray(doc[key])) return doc[key].includes(cond);
    return doc[key] === cond;
  });
}

const mockCollections = {};

function mockCollection(name, seed = []) {
  /* Honours the projection the route asks for. Without this, a test can never
     prove that a field is NOT sent — and "the hash must never leave" is
     exactly the kind of claim that needs proving. */
  function applyProjection(rows, fields) {
    if (!fields || typeof fields !== 'string') return rows.map((r) => ({ ...r }));
    const parts = fields.split(/\s+/).filter(Boolean);
    const excludes = parts.filter((f) => f.startsWith('-')).map((f) => f.slice(1));
    const includes = parts.filter((f) => !f.startsWith('-'));
    return rows.map((r) => {
      const copy = { ...r };
      if (excludes.length) for (const f of excludes) delete copy[f];
      if (includes.length) for (const k of Object.keys(copy)) if (!includes.includes(k)) delete copy[k];
      return copy;
    });
  }

  const col = {
    _seed: seed,
    find: jest.fn((filter) => {
      const rows = seed.filter((d) => matches(d, filter));
      let fields = null;
      const chain = {
        sort: () => chain, limit: () => chain, catch: () => chain,
        select: (f) => { fields = f; return chain; },
        lean: () => Promise.resolve(applyProjection(rows, fields)),
      };
      return chain;
    }),
    findOne: jest.fn((filter) => {
      const row = seed.find((d) => matches(d, filter));
      const chain = { select: () => chain, lean: () => Promise.resolve(row ? { ...row } : null) };
      return chain;
    }),
    create: jest.fn(async (doc) => { seed.push({ ...doc }); return { toObject: () => ({ ...doc }) }; }),
    updateOne: jest.fn(async (filter, update) => {
      const row = seed.find((d) => matches(d, filter));
      if (!row) return { modifiedCount: 0 };
      if (update.$set) Object.assign(row, update.$set);
      if (update.$addToSet) {
        for (const [k, v] of Object.entries(update.$addToSet)) {
          row[k] = [...new Set([...(row[k] || []), v])];
        }
      }
      return { modifiedCount: 1 };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const rows = seed.filter((d) => matches(d, filter));
      for (const row of rows) if (update.$set) Object.assign(row, update.$set);
      return { modifiedCount: rows.length };
    }),
  };
  mockCollections[name] = col;
  return col;
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((name) => {
    if (name === 'schools') {
      const chain = { lean: () => Promise.resolve({ id: 'sch_1', name: 'Riverside Academy', systemEmail: 'office@riverside.school' }) };
      return { findOne: jest.fn(() => chain) };
    }
    return mockCollections[name] ?? mockCollection(name);
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: jest.fn((name) => mockCollections[name] ?? mockCollection(name)),
}));

const express   = require('express');
const supertest = require('supertest');
const settingsRouter = require('../../routes/settings');
const parentPortal   = require('../../routes/parent-portal');
const { hashLinkCode, normaliseLinkCode } = require('../../utils/link-codes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use('/api/parent-portal', parentPortal);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.__JWT = { userId: PARENT, schoolId: SCHOOL, role: 'parent', studentIds: [], guardianOf: [] };
  mockCollection('students', [
    { id: CHILD, schoolId: SCHOOL, firstName: 'Brian', lastName: 'Kamau', className: 'Grade 7A', admissionNumber: 'ADM-120', photo: 'brian.jpg' },
  ]);
  mockCollection('users', [
    { _id: 'oid_1', id: PARENT, schoolId: SCHOOL, name: 'Mrs. Kamau', email: 'kamau@example.com', role: 'parent', studentIds: [], guardianOf: [] },
  ]);
  mockCollection('child_link_codes', []);
  mockCollection('invoices', []);
  mockCollection('payments', []);
});

/* ── The office issues ─────────────────────────────────────────── */

describe('POST /api/settings/link-codes', () => {
  test('issues a 6-character code, returns it once, and stores only its hash', async () => {
    global.__JWT = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin' };

    const res = await supertest(buildApp()).post('/api/settings/link-codes').send({ studentId: CHILD });

    expect(res.status).toBe(201);
    const { code, plaintextShownOnce, expiresAt, student } = res.body.data;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);   // no I, O, 0 or 1 — it is read aloud
    expect(plaintextShownOnce).toBe(true);
    expect(student.name).toBe('Brian Kamau');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = mockCollections.child_link_codes._seed[0];
    expect(stored.codeHash).toBe(hashLinkCode(code));
    expect(stored.codeHash).not.toBe(code);
    // The plaintext must not be anywhere on the document.
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  test('a new code supersedes the previous one, so a lost slip stops working', async () => {
    global.__JWT = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin' };
    const app = buildApp();

    const first = await supertest(app).post('/api/settings/link-codes').send({ studentId: CHILD });
    const second = await supertest(app).post('/api/settings/link-codes').send({ studentId: CHILD });

    const codes = mockCollections.child_link_codes._seed;
    expect(codes).toHaveLength(2);
    expect(codes.find((c) => c.codeHash === hashLinkCode(first.body.data.code)).status).toBe('superseded');
    expect(codes.find((c) => c.codeHash === hashLinkCode(second.body.data.code)).status).toBe('issued');
  });

  test('a code for a student in another school is refused', async () => {
    global.__JWT = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin' };
    const res = await supertest(buildApp()).post('/api/settings/link-codes').send({ studentId: 'stu_elsewhere' });
    expect(res.status).toBe(404);
  });

  test('the list endpoint never returns the hash, and derives expiry on read', async () => {
    global.__JWT = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin' };
    const app = buildApp();
    await supertest(app).post('/api/settings/link-codes').send({ studentId: CHILD });

    // Age it past its window without touching its status — the list must still
    // report it as expired rather than "live because nothing swept it".
    mockCollections.child_link_codes._seed[0].expiresAt = new Date(Date.now() - 1000).toISOString();

    const res = await supertest(app).get('/api/settings/link-codes');
    expect(res.status).toBe(200);
    expect(res.body.data[0].expired).toBe(true);
    expect(res.body.data[0].live).toBe(false);
    expect(res.body.data[0].codeHash).toBeUndefined();
  });
});

/* ── The parent redeems ────────────────────────────────────────── */

describe('POST /api/parent-portal/link/preview', () => {
  function seedCode({ status = 'issued', relationship = 'primary', expiresAt } = {}) {
    mockCollections.child_link_codes._seed.push({
      id: 'lnk_1', schoolId: SCHOOL, studentId: CHILD, studentName: 'Brian Kamau',
      codeHash: hashLinkCode('4K7P2M'), relationship, status,
      expiresAt: expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
    });
  }

  test('shows the found record and grants nothing', async () => {
    seedCode();
    const res = await supertest(buildApp()).post('/api/parent-portal/link/preview').send({ code: '4K7P2M' });

    expect(res.status).toBe(200);
    expect(res.body.data.child).toEqual({
      id: CHILD, name: 'Brian Kamau', className: 'Grade 7A', admissionNumber: 'ADM-120', photoUrl: 'brian.jpg',
    });
    expect(res.body.data.alreadyLinked).toBe(false);
    // Nothing was consumed and no access was granted.
    expect(mockCollections.child_link_codes._seed[0].status).toBe('issued');
    expect(mockCollections.users._seed[0].studentIds).toEqual([]);
  });

  test('a code typed with spaces or lowercase still matches', async () => {
    seedCode();
    const res = await supertest(buildApp()).post('/api/parent-portal/link/preview').send({ code: ' 4k7-p2m ' });
    expect(res.status).toBe(200);
    expect(res.body.data.child.id).toBe(CHILD);
  });

  test('an expired code is retired and reported as such, not silently accepted', async () => {
    seedCode({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = await supertest(buildApp()).post('/api/parent-portal/link/preview').send({ code: '4K7P2M' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVALID_CODE');
    expect(mockCollections.child_link_codes._seed[0].status).toBe('expired');
  });

  test('a wrong code and a used code give the SAME answer — neither hints which', async () => {
    const app = buildApp();
    const wrong = await supertest(app).post('/api/parent-portal/link/preview').send({ code: 'ZZZZZZ' });

    seedCode({ status: 'used' });
    const used = await supertest(app).post('/api/parent-portal/link/preview').send({ code: '4K7P2M' });

    expect(wrong.status).toBe(used.status);
    expect(wrong.body).toEqual(used.body);
  });

  test('an already-used code cannot be previewed again', async () => {
    seedCode({ status: 'used' });
    const res = await supertest(buildApp()).post('/api/parent-portal/link/preview').send({ code: '4K7P2M' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/parent-portal/link/confirm', () => {
  function seedCode(relationship = 'primary') {
    mockCollections.child_link_codes._seed.push({
      id: 'lnk_1', schoolId: SCHOOL, studentId: CHILD, studentName: 'Brian Kamau',
      codeHash: hashLinkCode('4K7P2M'), relationship, status: 'issued',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  }

  test('grants access, consumes the code, and returns a FRESH session', async () => {
    seedCode('primary');
    const res = await supertest(buildApp()).post('/api/parent-portal/link/confirm').send({ code: '4K7P2M' });

    expect(res.status).toBe(200);
    expect(res.body.data.childId).toBe(CHILD);
    // The token swap is what makes the newly linked child usable immediately:
    // child lists are baked into the JWT at sign-in.
    expect(res.body.data.token).toBe('tok-fresh');
    expect(mockIssueMobileSession).toHaveBeenCalledTimes(1);
    const passedUser = mockIssueMobileSession.mock.calls[0][1];
    expect(passedUser.studentIds).toContain(CHILD);

    expect(mockCollections.users._seed[0].studentIds).toContain(CHILD);
    expect(mockCollections.child_link_codes._seed[0].status).toBe('used');
    expect(mockCollections.child_link_codes._seed[0].usedByUserId).toBe(PARENT);
  });

  test('a co-guardian code lands in guardianOf, not studentIds', async () => {
    seedCode('co-guardian');
    await supertest(buildApp()).post('/api/parent-portal/link/confirm').send({ code: '4K7P2M' });

    expect(mockCollections.users._seed[0].guardianOf).toContain(CHILD);
    expect(mockCollections.users._seed[0].studentIds).toEqual([]);
  });

  test('two taps of the same code add exactly one guardian; the loser is refused', async () => {
    seedCode('primary');
    const app = buildApp();

    const first  = await supertest(app).post('/api/parent-portal/link/confirm').send({ code: '4K7P2M' });
    const second = await supertest(app).post('/api/parent-portal/link/confirm').send({ code: '4K7P2M' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);            // the code is no longer 'issued'
    expect(mockCollections.users._seed[0].studentIds).toEqual([CHILD]);   // added once, not twice
    expect(mockIssueMobileSession).toHaveBeenCalledTimes(1);              // and one grant, not two
  });
});

/* ── The format itself ─────────────────────────────────────────── */

describe('link code format', () => {
  test('normalisation makes "4k7-p2m" and "4K7P2M" the same code', () => {
    expect(normaliseLinkCode(' 4k7-p2m ')).toBe('4K7P2M');
    expect(hashLinkCode(' 4k7-p2m ')).toBe(hashLinkCode('4K7P2M'));
  });

  test('the alphabet cannot produce a code a parent would misread', () => {
    const { generateLinkCode, LINK_CODE_ALPHABET } = require('../../utils/link-codes');
    expect(LINK_CODE_ALPHABET).not.toMatch(/[IO01]/);
    const codes = Array.from({ length: 200 }, () => generateLinkCode());
    expect(codes.every((c) => /^[A-HJ-NP-Z2-9]{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(190);   // not a broken RNG
  });
});
