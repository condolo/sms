/**
 * verify-tenant-isolation-live.js — REAL-database validation (not mocked)
 *
 * Boots an ephemeral real mongod (mongodb-memory-server), seeds two
 * schools' data, and proves — against the actual MongoDB query engine,
 * not jest mocks — that:
 *   1. tenantModel() scopes reads to the active school (no B data leaks to A)
 *   2. tenantModel() aggregate isolation holds
 *   3. a conflicting-schoolId filter is rejected
 *   4. a tenant-hop update is blocked
 *   5. writes land under the active school only
 *   6. provisionOrganizations() (C2) creates a 1:1 org per school, sets the
 *      FK, and is idempotent on a second run
 *
 * This complements the mocked jest suite (Engineering Standards §6.3 keeps
 * unit/route tests DB-free); this is the on-demand real-DB smoke.
 *
 * Run:  node scripts/verify-tenant-isolation-live.js
 */
'use strict';

const assert   = require('assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0, failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch(e => { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); });
}

(async () => {
  console.log('\nReal-DB tenant isolation + provisioning validation');
  console.log('━'.repeat(56));

  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'msingi_live_test' });
  console.log('  (real mongod up, mongoose connected)\n');

  // Require AFTER connect so the shared default connection is live.
  const { _model } = require('../server/utils/model');
  const { tenantModel } = require('../server/utils/tenant-model');
  const { provisionOrganizations } = require('../server/utils/provision-organizations');

  const A = 'school_A', B = 'school_B';
  const ctxA = { schoolId: A };

  // ── Seed two schools' student + attendance data directly ──────────
  const Students   = _model('students');
  const Attendance = _model('attendance');
  await Students.insertMany([
    { id: 'a1', schoolId: A, firstName: 'Ada',  status: 'active' },
    { id: 'a2', schoolId: A, firstName: 'Ben',  status: 'active' },
    { id: 'b1', schoolId: B, firstName: 'Cara', status: 'active' },
  ]);
  await Attendance.insertMany([
    { id: 'at_a', schoolId: A, studentId: 'a1', status: 'present' },
    { id: 'at_b', schoolId: B, studentId: 'b1', status: 'present' },
  ]);

  console.log('C4 — tenantModel isolation (real queries):');

  await check('find() as School A returns only A\'s students, never B\'s', async () => {
    const rows = await tenantModel('students', ctxA).find({}).lean();
    assert.strictEqual(rows.length, 2, `expected 2, got ${rows.length}`);
    assert.ok(rows.every(r => r.schoolId === A), 'a non-A row leaked');
    assert.ok(!rows.some(r => r.id === 'b1'), 'School B student b1 leaked to A');
  });

  await check('find() with a client filter stays within the tenant', async () => {
    const rows = await tenantModel('students', ctxA).find({ firstName: 'Cara' }).lean();
    assert.strictEqual(rows.length, 0, 'matched a B student by name across tenant boundary');
  });

  await check('countDocuments() is tenant-scoped', async () => {
    const n = await tenantModel('students', ctxA).countDocuments({});
    assert.strictEqual(n, 2, `expected 2, got ${n}`);
  });

  await check('aggregate() injects a tenant $match — only A is grouped', async () => {
    const agg = await tenantModel('attendance', ctxA).aggregate([
      { $group: { _id: '$schoolId', c: { $sum: 1 } } },
    ]);
    assert.strictEqual(agg.length, 1, `expected 1 group, got ${agg.length}`);
    assert.strictEqual(agg[0]._id, A, 'aggregate saw a foreign school');
  });

  await check('a filter carrying a different schoolId is rejected (throws)', async () => {
    let threw = false;
    try { await tenantModel('students', ctxA).find({ schoolId: B }).lean(); }
    catch { threw = true; }
    assert.ok(threw, 'cross-tenant filter was NOT rejected');
  });

  await check('a tenant-hop update ($set schoolId:B) is blocked (throws)', async () => {
    let threw = false;
    try { await tenantModel('students', ctxA).updateOne({ id: 'a1' }, { $set: { schoolId: B } }); }
    catch { threw = true; }
    assert.ok(threw, 'tenant-hop update was NOT blocked');
    const still = await _model('students').findOne({ id: 'a1' }).lean();
    assert.strictEqual(still.schoolId, A, 'a1 was moved to another school!');
  });

  await check('create() persists under the active school only', async () => {
    await tenantModel('students', ctxA).create({ id: 'a3', firstName: 'Dee', status: 'active' });
    const doc = await _model('students').findOne({ id: 'a3' }).lean();
    assert.strictEqual(doc.schoolId, A, 'created doc not scoped to A');
  });

  await check('a School B read cannot see A\'s newly created student', async () => {
    const rows = await tenantModel('students', { schoolId: B }).find({}).lean();
    assert.ok(!rows.some(r => r.id === 'a3'), 'A\'s student a3 leaked to B');
    assert.strictEqual(rows.length, 1, `B should see only its 1 student, saw ${rows.length}`);
  });

  console.log('\nC2 — organization provisioning (real migration):');

  const Schools = _model('schools');
  await Schools.insertMany([
    { id: A, name: 'Alpha Academy', slug: 'alpha' },
    { id: B, name: 'Beta School',   slug: 'beta'  },
  ]);

  await check('provisionOrganizations() creates a 1:1 org per school + sets FK', async () => {
    const r = await provisionOrganizations();
    assert.strictEqual(r.provisioned, 2, `expected 2 provisioned, got ${r.provisioned}`);
    const orgs = await _model('organizations').find({}).lean();
    assert.strictEqual(orgs.length, 2, `expected 2 orgs, got ${orgs.length}`);
    const sA = await Schools.findOne({ id: A }).lean();
    const sB = await Schools.findOne({ id: B }).lean();
    assert.ok(sA.organizationId && sB.organizationId, 'organizationId not set');
    assert.notStrictEqual(sA.organizationId, sB.organizationId, 'two schools share one org');
  });

  await check('provisionOrganizations() is idempotent (2nd run creates nothing)', async () => {
    const r = await provisionOrganizations();
    assert.strictEqual(r.provisioned, 0, `2nd run provisioned ${r.provisioned}, expected 0`);
    const orgs = await _model('organizations').find({}).lean();
    assert.strictEqual(orgs.length, 2, `org count changed to ${orgs.length} on rerun`);
  });

  // ── Teardown ──────────────────────────────────────────────────────
  await mongoose.disconnect();
  await mem.stop();

  console.log('\n' + '━'.repeat(56));
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
