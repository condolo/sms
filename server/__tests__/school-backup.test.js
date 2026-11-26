/* ============================================================
   School backups (v5.286.0)

   The backup followed a hand-kept list, so about 60 kinds of record were
   never in it, and there was no way to put records back. Pins:
     - every collection with the school's records is in the file, also one
       nobody has heard of; only EXCLUDED is left out; no other school's;
     - no password, PIN or secret; ids, dates and files keep their type;
     - a file altered, cut short, or opened with another key is refused;
     - restore adds only what is missing, never changes or removes, checks
       every record's school before writing anything;
     - the nightly job: read back before it counts, stored, logged also when
       it fails, never prunes another school's files or after a collapse.
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
process.env.BACKUP_DIR = DIR;
process.env.BACKUP_KEEP_DAYS = '2';

const mockStorage = { ready: false, uploads: [], objects: [], deleted: [], fail: false };
jest.mock('../utils/backupStorage', () => ({
  storageReady: () => mockStorage.ready,
  uploadBackup: async (filename, body, dateStr, bytes) => {
    if (mockStorage.fail) throw new Error('storage down');
    mockStorage.uploads.push({ filename, body, dateStr, bytes });
    return `backups/${dateStr}/${filename}`;
  },
  listBackups: async (matches) => mockStorage.objects.filter(o => matches(o.key.split('/').pop())).sort((a, b) => b.lastModified - a.lastModified),
  deleteBackup: async (key) => { mockStorage.deleted.push(key); },
}));

const mongoose = require('mongoose');
const { ObjectId, Binary } = mongoose.mongo;
const { matches } = require('./fixtures/fake-tenant-db');
const B = require('../utils/school-backup');

let mockData;
// The little of the driver that backups use.
const rx = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v && v.$regex ? new RegExp(v.$regex) : v]));
const hit = (d, f) => Object.entries(rx(f)).every(([k, v]) => {
  if (v instanceof RegExp) return v.test(String(d[k]));
  if (v && v.$in) return v.$in.some(x => String(x) === String(d[k]));
  if (v instanceof ObjectId) return String(v) === String(d[k]);
  return matches(d, { [k]: v });
});
const mockDb = {
  listCollections: () => ({ toArray: async () => [...Object.keys(mockData), 'system.views'].map(name => ({ name, type: name === 'a_view' ? 'view' : 'collection' })) }),
  collection: (name) => ({
    find: (f) => {
      const rows = () => (mockData[name] || []).filter(d => hit(d, f));
      return { toArray: async () => rows(), close: async () => {}, async* [Symbol.asyncIterator]() { for (const d of rows()) yield d; } };
    },
    countDocuments: async (f) => (mockData[name] || []).filter(d => hit(d, f)).length,
    insertMany: async (docs) => {
      mockData[name] = mockData[name] || [];
      let n = 0; const errors = [];
      for (const d of docs) {
        if (name === 'users' && mockData.users.some(u => u.email === d.email)) { errors.push(d); continue; }
        mockData[name].push(d); n += 1;
      }
      if (errors.length) throw Object.assign(new Error('E11000'), { code: 11000, insertedCount: n, writeErrors: errors });
      return { insertedCount: n };
    },
  }),
};
jest.mock('../utils/model', () => ({
  _model: (name) => ({
    find: (f) => ({ lean: async () => mockDb.collection(name).find(f).toArray() }),
    findOne: (f) => {
      const q = { sort: () => q, lean: async () => (mockData[name] || []).filter(d => mockMatch(d, f)).slice(-1)[0] || null };
      return q;
    },
    create: async (d) => { (mockData[name] = mockData[name] || []).push(d); return d; },
  }),
}));
const mockMatch = (d, f) => matches(d, f);

const A = new ObjectId();
const BID = new ObjectId();
const school = (over = {}) => ({ _id: A, id: 'sch_a', name: 'Trinity', status: 'active', mpesa: { passkey: 'PK' }, smtpPassEnc: 'SMTP', ...over });
beforeEach(() => {
  Object.assign(mockStorage, { ready: false, uploads: [], objects: [], deleted: [], fail: false });
  for (const f of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, f));
  mockData = {
    schools: [school(), { _id: BID, id: 'sch_b', name: 'Trinity College', status: 'active' }],
    users: [{ _id: new ObjectId(), id: 'u1', schoolId: 'sch_a', email: 'a@x', name: 'Ann', password: 'P1', passwordHash: 'P2', pinHash: 'P3', tempPassword: 'P4', twoFactorSecret: 'P5', mfaOtp: 'P6', resetToken: 'P7', role: 'teacher' }],
    streams: [{ _id: new ObjectId(), id: 's1', schoolId: 'sch_a', createdAt: new Date('2026-01-02T03:04:05Z') }, { _id: new ObjectId(), id: 's2', schoolId: 'sch_b' }],
    lesson_plans: [{ _id: new ObjectId(), id: 'lp', schoolId: String(A) }],      // the older form of the school's id
    something_new: [{ _id: new ObjectId(), schoolId: 'sch_a', file: new Binary(Buffer.from('hello')) }],
    counters: [{ _id: 'admission_sch_a_2026', seq: 4 }, { _id: 'admission_sch_ab_2026', seq: 9 }, { _id: 'receipt_sch_b', seq: 2 }],
    sessions: [{ _id: new ObjectId(), schoolId: 'sch_a' }],
    elearning_tokens: [{ _id: new ObjectId(), schoolId: 'sch_a', googleRefreshToken: 'GT' }],
    identities: [{ _id: new ObjectId(), schoolId: 'sch_a', passwordHash: 'IH' }],
    a_view: [{ _id: new ObjectId(), schoolId: 'sch_a' }],
    backup_logs: [],
  };
});
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

const FILE = () => path.join(DIR, 'one.ndjson.gz.enc');
const write = async (file = FILE()) => B.writeBackupFile(mockDb, mockData.schools[0], file);
const read = async (file = FILE()) => { const out = []; for await (const r of B.readBackupFile(file)) if (r.c) out.push(r); return out; };

describe('what is in the file', () => {
  test('every collection with the school\'s records, also an unheard-of one; nothing excluded, no other school\'s', async () => {
    const w = await write();
    expect(w.stats).toEqual({ schools: 1, users: 1, streams: 1, lesson_plans: 1, something_new: 1, counters: 1 });
    expect(w).toMatchObject({ total: 6, encrypted: true });
    const rows = await read();
    expect(rows.map(r => r.d.id).filter(Boolean).sort()).toEqual(['lp', 's1', 'sch_a', 'u1']);
    expect(rows.find(r => r.c === 'counters').d._id).toBe('admission_sch_a_2026');
    expect(await B.verifyBackupFile(FILE())).toMatchObject({ meta: { schoolId: 'sch_a' }, total: 6 });
  });

  test('no password, PIN, token or payment secret', async () => {
    await write();
    const text = JSON.stringify(await read());
    expect(text).not.toMatch(/P[1-7]"|PK|SMTP|GT|IH/);
    expect(text).toMatch(/"name":"Ann"/);
  });

  test('ids, dates and files keep their type', async () => {
    await write();
    const rows = await read();
    const stream = rows.find(r => r.c === 'streams').d;
    expect(stream._id).toBeInstanceOf(ObjectId);
    expect(stream.createdAt).toEqual(new Date('2026-01-02T03:04:05Z'));
    expect(Buffer.from(rows.find(r => r.c === 'something_new').d.file.buffer).toString()).toBe('hello');
  });

  test('the file on disk is unreadable without the key', async () => {
    await write();
    expect(fs.readFileSync(FILE()).toString('latin1')).not.toMatch(/Trinity|sch_a/);
  });

  test('nothing excluded is a school\'s working record', () => {
    for (const c of ['streams', 'payroll', 'payroll_history', 'lesson_plans', 'indicator_marks', 'medical_visits', 'invoices', 'custom_roles', 'staff_documents', 'leave_requests', 'weekly_snapshots', 'council_votes', 'assignments', 'audit_logs', 'student_class_history', 'counters', 'report_card_counters', 'bell_schedules', 'memberships']) {
      expect(B.EXCLUDED[c]).toBeUndefined();
    }
  });
});

describe('a bad file is refused', () => {
  const flip = (at) => { const b = fs.readFileSync(FILE()); const i = at < 0 ? b.length + at : at; b[i] ^= 1; fs.writeFileSync(FILE(), b); };
  test.each([['its check tag', 20], ['its start', 40], ['its end', -3]])('altered in %s', async (_l, at) => {
    await write(); flip(at);
    await expect(B.verifyBackupFile(FILE())).rejects.toThrow();
  });
  test('cut short', async () => {
    await write();
    const b = fs.readFileSync(FILE()); fs.writeFileSync(FILE(), b.subarray(0, b.length - 40));
    await expect(B.verifyBackupFile(FILE())).rejects.toThrow();
  });
  test('cut short cleanly, or holding fewer records than it lists', async () => {
    const zlib = require('zlib');
    const f = path.join(DIR, 'x.ndjson.gz');
    const put = (lines) => fs.writeFileSync(f, zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n')));
    const meta = { _meta: { format: B.FORMAT, schoolId: 'sch_a' } };
    put([meta, { c: 'streams', d: { schoolId: 'sch_a' } }]);
    await expect(B.verifyBackupFile(f)).rejects.toThrow('cut short');
    put([meta, { c: 'streams', d: { schoolId: 'sch_a' } }, { _end: { total: 2, stats: { streams: 2 } } }]);
    await expect(B.verifyBackupFile(f)).rejects.toThrow('does not hold');
    put([{ _meta: { version: '3.5.0' } }]);
    await expect(B.verifyBackupFile(f)).rejects.toThrow('not a Msingi backup');
  });
});

describe('restore', () => {
  test('reports without writing; then adds exactly what is missing, with the same ids; a second run adds nothing', async () => {
    await write();
    const before = mockData.streams[0];
    mockData.streams = mockData.streams.filter(s => s.id !== 's1');
    mockData.lesson_plans = [];
    mockData.users[0].name = 'Changed since';
    const snapshot = JSON.stringify(mockData);

    const dry = await B.restoreMissing(mockDb, FILE(), mockData.schools[0]);
    expect(JSON.stringify(mockData)).toBe(snapshot);
    expect(dry.collections.streams).toMatchObject({ inBackup: 1, missing: 1, added: 0 });
    expect(dry.collections.users).toMatchObject({ inBackup: 1, missing: 0 });

    const run = await B.restoreMissing(mockDb, FILE(), mockData.schools[0], { apply: true });
    expect(run.collections.streams.added).toBe(1);
    expect(mockData.streams.find(s => s.id === 's1')).toEqual(before);
    expect(mockData.lesson_plans).toHaveLength(1);
    expect(mockData.users).toHaveLength(1);
    expect(mockData.users[0]).toMatchObject({ name: 'Changed since', password: 'P1' });   // never changed
    const again = await B.restoreMissing(mockDb, FILE(), mockData.schools[0], { apply: true });
    expect(Object.values(again.collections).every(c => c.missing === 0 && c.added === 0)).toBe(true);
  });

  test('--only limits it', async () => {
    await write();
    mockData.streams = []; mockData.lesson_plans = [];
    await B.restoreMissing(mockDb, FILE(), mockData.schools[0], { apply: true, only: ['streams'] });
    expect(mockData.streams).toHaveLength(1);
    expect(mockData.lesson_plans).toHaveLength(0);
  });

  test('a record a unique rule refuses is counted, the rest go in', async () => {
    await write();
    mockData.users = [{ _id: new ObjectId(), id: 'u_new', schoolId: 'sch_a', email: 'a@x' }];
    mockData.streams = [];
    const r = await B.restoreMissing(mockDb, FILE(), mockData.schools[0], { apply: true });
    expect(r.collections.users).toMatchObject({ missing: 1, added: 0, refused: 1 });
    expect(r.collections.streams.added).toBe(1);
  });

  test('another school\'s file writes nothing', async () => {
    await write();
    mockData.streams = [];
    await expect(B.restoreMissing(mockDb, FILE(), mockData.schools[1], { apply: true })).rejects.toThrow('another school');
    expect(mockData.streams).toEqual([]);
  });

  test('a damaged file writes nothing', async () => {
    await write();
    mockData.streams = [];
    const b = fs.readFileSync(FILE()); b[b.length - 3] ^= 1; fs.writeFileSync(FILE(), b);
    await expect(B.restoreMissing(mockDb, FILE(), mockData.schools[0], { apply: true })).rejects.toThrow();
    expect(mockData.streams).toEqual([]);
  });

  test('a school deleted since: its own record is in the file', async () => {
    await write();
    expect((await B.schoolInFile(FILE())).id).toBe('sch_a');
  });
});

describe('the nightly job', () => {
  let cron;
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(mongoose.connection, 'db', { value: mockDb, configurable: true, writable: true });
    cron = require('../utils/backup-cron');
  });
  afterEach(() => jest.restoreAllMocks());
  const logs = () => mockData.backup_logs;

  test('writes, reads back and logs each school with data; not sign-ups or demo copies', async () => {
    mockData.schools.push({ _id: new ObjectId(), id: 'sch_p', name: 'Waiting', status: 'pending' }, { _id: new ObjectId(), id: 'sch_d', name: 'Demo', status: 'active', isDemo: true }, { _id: new ObjectId(), id: 'sch_s', name: 'Suspended', status: 'suspended' });
    await cron.runNightlyBackup();
    expect(logs().map(l => l.schoolId)).toEqual(['sch_a', 'sch_b', 'sch_s']);
    expect(logs()[0]).toMatchObject({ source: 'cron', verified: true, encrypted: true, totalRecords: 6 });
    const files = fs.readdirSync(DIR);
    expect(files).toHaveLength(3);
    expect(await B.verifyBackupFile(path.join(DIR, files.find(f => f.includes('__sch_a_'))))).toMatchObject({ total: 6 });
    expect(fs.readdirSync(os.tmpdir()).filter(f => f.includes('Msingi_Backup_Trinity__sch_a'))).toEqual([]);   // nothing left behind
  });

  test('cloud: the checked file goes up; a failure is logged and the next school still runs', async () => {
    mockStorage.ready = true;
    await cron.runNightlyBackup();
    expect(mockStorage.uploads[0].filename).toMatch(/^Msingi_Backup_Trinity__sch_a_\d{4}-\d{2}-\d{2}\.ndjson\.gz\.enc$/);
    expect(mockStorage.uploads[0].bytes).toBe(mockStorage.uploads[0].body.length);
    mockStorage.fail = true;
    mockData.backup_logs = [];
    await cron.runNightlyBackup();
    expect(logs()).toEqual([expect.objectContaining({ schoolId: 'sch_a', failed: true, error: 'storage down' }), expect.objectContaining({ schoolId: 'sch_b', failed: true })]);
  });

  test('keeps the newest files of this school and never touches a school with a longer name', async () => {
    mockStorage.ready = true;
    const day = (n) => new Date(Date.UTC(2026, 0, n));
    mockStorage.objects = [
      ...[1, 2, 3].map(n => ({ key: `backups/x/Msingi_Backup_Trinity_2026-01-0${n}.json.enc`, lastModified: day(n) })),
      ...[1, 2, 3].map(n => ({ key: `backups/x/Msingi_Backup_Trinity_College_2026-01-0${n}.json.enc`, lastModified: day(n) })),
      { key: 'backups/x/Msingi_Backup_Trinity__sch_a_2026-01-04.ndjson.gz.enc', lastModified: day(4) },
    ];
    const forA = cron.isBackupOf(mockData.schools[0], mockData.schools);
    expect(mockStorage.objects.filter(o => forA(o.key.split('/').pop()))).toHaveLength(4);
    await cron.runNightlyBackup();
    expect(mockStorage.deleted.filter(k => /Trinity_2026/.test(k)).sort()).toEqual(['backups/x/Msingi_Backup_Trinity_2026-01-01.json.enc', 'backups/x/Msingi_Backup_Trinity_2026-01-02.json.enc']);
    expect(mockStorage.deleted.filter(k => /College/.test(k))).toEqual(['backups/x/Msingi_Backup_Trinity_College_2026-01-01.json.enc']);
  });

  test('two schools with the same name: files from before they carried an id are left alone', () => {
    const twins = [school(), school({ _id: BID, id: 'sch_c' })];
    const m = cron.isBackupOf(twins[0], twins);
    expect(m('Msingi_Backup_Trinity_2026-01-01.json.enc')).toBe(false);
    expect(m('Msingi_Backup_Trinity__sch_a_2026-01-01.ndjson.gz.enc')).toBe(true);
    expect(m('Msingi_Backup_Trinity__sch_c_2026-01-01.ndjson.gz.enc')).toBe(false);
  });

  test('a file that cannot be read back is never stored, and removes nothing', async () => {
    mockStorage.ready = true;
    mockStorage.objects = [1, 2, 3].map(n => ({ key: `backups/x/Msingi_Backup_Trinity_2026-01-0${n}.json.enc`, lastModified: new Date(Date.UTC(2026, 0, n)) }));
    let job;
    jest.isolateModules(() => {
      jest.doMock('../utils/school-backup', () => ({ ...B, verifyBackupFile: async () => { throw new Error('The backup file is cut short.'); } }));
      jest.doMock('mongoose', () => ({ connection: { db: mockDb } }));
      job = require('../utils/backup-cron');
    });
    jest.dontMock('../utils/school-backup'); jest.dontMock('mongoose');
    await job.runNightlyBackup();
    expect(mockStorage.uploads).toEqual([]);
    expect(mockStorage.deleted).toEqual([]);
    expect(logs().every(l => l.failed && /cut short/.test(l.error))).toBe(true);
  });

  test('a backup that suddenly holds far less removes nothing and is flagged', async () => {
    mockStorage.ready = true;
    mockData.backup_logs = [{ schoolId: 'sch_a', source: 'cron', totalRecords: 5000, createdAt: '2026-01-01' }];
    mockStorage.objects = [1, 2, 3, 4].map(n => ({ key: `backups/x/Msingi_Backup_Trinity_2026-01-0${n}.json.enc`, lastModified: new Date(Date.UTC(2026, 0, n)) }));
    await cron.runNightlyBackup();
    expect(mockStorage.deleted).toEqual([]);
    expect(logs().find(l => l.schoolId === 'sch_a' && l.verified)).toMatchObject({ shrunk: true });
  });
});

describe('the download for a school (super admin)', () => {
  test('plain JSON of everything, no secrets, and the counts match', async () => {
    jest.resetModules();
    jest.doMock('../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'u', schoolId: 'sch_a', role: req.headers['x-role'] || 'superadmin', roles: [] }; next(); } }));
    jest.doMock('../utils/tenant-model', () => ({ tenantContext: () => ({ schoolId: 'sch_a' }), tenantModel: () => ({ create: async (d) => { mockData.backup_logs.push(d); } }) }));
    jest.doMock('mongoose', () => ({ ...mongoose, mongo: mongoose.mongo, connection: { db: mockDb }, models: {} }));
    const express = require('express');
    const supertest = require('supertest');
    const a = express(); a.use(express.json()); a.use('/b', require('../routes/backup'));
    const r = await supertest(a).post('/b/export').send({});
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(Object.keys(body.data).sort()).toEqual(['counters', 'lesson_plans', 'schools', 'something_new', 'streams', 'users']);
    expect(body._meta).toMatchObject({ totalRecords: 6, schoolId: 'sch_a' });
    expect(r.text).not.toMatch(/P[1-7]"|PK|SMTP|GT/);
    expect((await supertest(a).get('/b/preview')).body).toMatchObject({ totalRecords: 6 });
    expect((await supertest(a).get('/b/preview').set('x-role', 'admin')).status).toBe(403);
  });
});
