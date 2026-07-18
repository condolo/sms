/* ============================================================
   Msingi — /api/qa/health
   Platform QA Health Dashboard API — superadmin only.

   Returns a single consolidated payload covering:
     • RBAC coverage (live scan)
     • DB collection counts for all critical collections
     • Data integrity (orphan detection, broken references)
     • Release certificate (latest from .release-certs/latest.json)
     • Test suite summary
     • Recent error log summary

   No school-scoped data is returned — this is operator-level info.
   ============================================================ */
'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const mongoose = require('mongoose');

const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');

const router = express.Router();

/* ── Superadmin guard ────────────────────────────────────────── */
function _superadmin(req, res, next) {
  if (req.jwtUser?.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Superadmin only' } });
  }
  next();
}

/* ── Helpers ─────────────────────────────────────────────────── */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

function _safeCount(col) {
  return _model(col).countDocuments({}).catch(() => -1);
}

/* ── Critical collections to count ──────────────────────────── */
const CRITICAL_COLLECTIONS = [
  { key: 'schools',              label: 'Schools' },
  { key: 'users',                label: 'Users' },
  { key: 'students',             label: 'Students' },
  { key: 'teachers',             label: 'Teachers' },
  { key: 'attendance_records',   label: 'Attendance Records' },
  { key: 'finance_invoices',     label: 'Finance Invoices' },
  { key: 'exam_results',         label: 'Exam Results' },
  { key: 'report_card_snapshots',label: 'Report Card Snapshots' },
  { key: 'grade_entries',        label: 'Grade Entries' },
  { key: 'classes',              label: 'Classes' },
  { key: 'announcements',        label: 'Announcements' },
  { key: 'audit_logs',           label: 'Audit Logs' },
];

/* ── Identity migration checks (C8/MR-001 Phase 2 · ADR-0003) ───
   Defined as standalone functions (not inline closures like the other
   7 checks below) so they're independently unit-testable without
   mocking this route's unrelated dependencies (RBAC scan, release-cert
   file reads, test-directory scan). Called from _integrityChecks() via
   the same check(label, fn) wrapper as everything else. */

/* users.identityId pointing at a nonexistent identities doc. */
async function _checkDanglingIdentityFK() {
  const linked = await _model('users')
    .find({ identityId: { $exists: true, $ne: null } })
    .select('id email identityId').limit(1000).lean();
  if (!linked.length) return { count: 0, samples: [] };

  const ids = [...new Set(linked.map(u => u.identityId))];
  const existing = await _model('identities').find({ id: { $in: ids } }).select('id').lean();
  const existingSet = new Set(existing.map(i => i.id));

  const dangling = linked.filter(u => !existingSet.has(u.identityId));
  return { count: dangling.length, samples: dangling.slice(0, 5).map(u => u.email || u.id) };
}

/* users.password vs the linked identity's passwordHash — should always
   match post-Phase-1 (dual-write hashes once, writes twice). Both sides
   null-normalized: OAuth users legitimately have neither set
   (passwordHash: user.password || null at provisioning time,
   provision-identities.js), which must never read as a false-positive
   mismatch. Dangling FKs (no matching identity) are skipped here —
   that's _checkDanglingIdentityFK's job, not this one's. */
async function _checkPasswordHashMismatch() {
  const linked = await _model('users')
    .find({ identityId: { $exists: true, $ne: null } })
    .select('id email password identityId').limit(1000).lean();
  if (!linked.length) return { count: 0, samples: [] };

  const ids = [...new Set(linked.map(u => u.identityId))];
  const identities = await _model('identities').find({ id: { $in: ids } }).select('id passwordHash').lean();
  const hashById = Object.fromEntries(identities.map(i => [i.id, i.passwordHash ?? null]));

  const mismatches = linked.filter(u => {
    if (!(u.identityId in hashById)) return false; // dangling FK — not this check's concern
    return hashById[u.identityId] !== (u.password ?? null);
  });
  return { count: mismatches.length, samples: mismatches.slice(0, 5).map(u => u.email || u.id) };
}

/* ── Data integrity checks ───────────────────────────────────── */
async function _integrityChecks() {
  const checks = [];

  async function check(label, fn) {
    try {
      const { count, samples } = await fn();
      checks.push({ label, count, samples: samples ?? [], status: count === 0 ? 'ok' : 'warn' });
    } catch (err) {
      checks.push({ label, count: -1, samples: [], status: 'error', error: err.message });
    }
  }

  // 1. Students without a schoolId
  await check('Students missing schoolId', async () => {
    const docs = await _model('students')
      .find({ $or: [{ schoolId: { $exists: false } }, { schoolId: null }, { schoolId: '' }] })
      .select('id admissionNumber name').limit(5).lean();
    return { count: docs.length, samples: docs.map(d => d.id || String(d._id)) };
  });

  // 2. Users without a schoolId (excluding platform admins)
  await check('Users missing schoolId (non-platform)', async () => {
    const docs = await _model('users')
      .find({
        role: { $nin: ['platform_admin', 'superadmin'] },
        $or: [{ schoolId: { $exists: false } }, { schoolId: null }, { schoolId: '' }],
      })
      .select('id email role').limit(5).lean();
    return { count: docs.length, samples: docs.map(d => d.email || String(d._id)) };
  });

  // 3. Attendance records referencing non-existent students
  await check('Orphaned attendance records', async () => {
    const studentIds = (await _model('students').distinct('id').catch(() => []));
    const studentOids = (await _model('students').distinct('_id').catch(() => [])).map(String);
    const orphans = await _model('attendance_records')
      .find({
        $and: [
          { studentId: { $nin: [...studentIds] } },
          { studentId: { $nin: studentOids } },
          { studentId: { $exists: true } },
        ],
      })
      .select('studentId classId date').limit(5).lean();
    return { count: orphans.length, samples: orphans.map(d => d.studentId) };
  });

  // 4. Report card snapshots with no reportId (unpublished is fine, but track count)
  await check('Published snapshots missing reportId', async () => {
    const docs = await _model('report_card_snapshots')
      .find({ status: 'published', reportId: { $exists: false } })
      .select('studentId academicYear termNumber').limit(5).lean();
    return { count: docs.length, samples: docs.map(d => `${d.studentId}/${d.academicYear}/T${d.termNumber}`) };
  });

  // 5. Finance invoices with no schoolId
  await check('Finance invoices missing schoolId', async () => {
    const docs = await _model('finance_invoices')
      .find({ $or: [{ schoolId: { $exists: false } }, { schoolId: null }] })
      .select('id studentId amount').limit(5).lean();
    return { count: docs.length, samples: docs.map(d => d.id || String(d._id)) };
  });

  // 6. Duplicate student admission numbers within same school
  await check('Duplicate admission numbers', async () => {
    const dupes = await _model('students').aggregate([
      { $match: { admissionNumber: { $exists: true, $ne: null } } },
      { $group: { _id: { schoolId: '$schoolId', admNo: '$admissionNumber' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 },
    ]).catch(() => []);
    return {
      count: dupes.length,
      samples: dupes.map(d => `${d._id.schoolId}:${d._id.admNo}(×${d.count})`),
    };
  });

  // 7. Grade entries referencing non-existent classes
  await check('Grade entries with invalid classId', async () => {
    const classIds = (await _model('classes').distinct('id').catch(() => []));
    const orphans  = await _model('grade_entries')
      .find({ classId: { $nin: classIds, $exists: true } })
      .select('classId studentId subject').limit(5).lean();
    return { count: orphans.length, samples: orphans.map(d => d.classId) };
  });

  // 8. Dangling identityId FKs (C8/MR-001 Phase 2)
  await check('users.identityId pointing to a nonexistent identity', _checkDanglingIdentityFK);

  // 9. Dual-write divergence between users.password and identities.passwordHash (C8/MR-001 Phase 2)
  await check('users.password / identities.passwordHash mismatch (dual-write divergence)', _checkPasswordHashMismatch);

  return checks;
}

/* ── RBAC live scan ──────────────────────────────────────────── */
function _rbacScan() {
  try {
    const scan     = require('../../scripts/_rbac-scan')();
    const baseline = parseFloat(readText(path.join(__dirname, '../../scripts/.rbac-baseline')) || '0');
    return { coverage: scan.coverage, baseline, passed: scan.coverage >= baseline, protected: scan.protected, total: scan.total, gaps: scan.issues.length };
  } catch {
    return { coverage: 0, baseline: 0, passed: false, protected: 0, total: 0, gaps: -1, error: 'scan failed' };
  }
}

/* ── Latest release certificate ──────────────────────────────── */
function _latestCert() {
  const p = path.join(__dirname, '../../.release-certs/latest.json');
  return readJson(p);
}

/* ── Error log summary ───────────────────────────────────────── */
function _errorSummary() {
  try {
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) return { available: false };
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `errors-${today}.log`);
    if (!fs.existsSync(logFile)) return { available: true, todayErrors: 0 };
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    return { available: true, todayErrors: lines.length, recentErrors: lines.slice(-5) };
  } catch {
    return { available: false };
  }
}

/* ── Test suite summary (static) ─────────────────────────────── */
function _testSummary() {
  const testDir = path.join(__dirname, '../../server/__tests__');
  if (!fs.existsSync(testDir)) return { fileCount: 0 };
  const files = fs.readdirSync(testDir, { recursive: true })
    .map(String).filter(f => f.endsWith('.test.js'));
  return { fileCount: files.length, files: files.map(f => path.basename(f)) };
}

/* ── DB migration status ─────────────────────────────────────── */
async function _migrationStatus() {
  try {
    const snapsWithNoId = await _model('report_card_snapshots')
      .countDocuments({ reportId: { $exists: false } });
    return {
      reportCardBackfillPending: snapsWithNoId,
      status: snapsWithNoId === 0 ? 'complete' : 'pending',
    };
  } catch {
    return { status: 'unknown' };
  }
}

/* ── Identity migration status (C8/MR-001 Phase 2 · ADR-0003) ───
   Separate gate from _migrationStatus() above — a different migration
   (the report-card-snapshot backfill), unrelated to identities.

   A user counts as backfilled once their id appears in ANY identities
   doc's sourceUserIds array — active OR collision_pending. This is
   deliberate: collision_pending is a PERMANENT, safe fallback per the
   ADR ("not a temporary blocking state"), not an unfinished migration
   step. Counting those users as still-pending would mean this gate
   could never reach 'complete' in any organization with an unresolved
   collision, contradicting the ADR's own framing. collisionPending is
   reported separately, purely informational — a nonzero count here is
   expected and does not fail the gate. */
async function _identityMigrationStatus() {
  try {
    const emailUsers = await _model('users')
      .find({ email: { $exists: true, $type: 'string' } })
      .select('id').lean();

    const allIdentities = await _model('identities').find({}).select('sourceUserIds').lean();
    const processedUserIds = new Set(allIdentities.flatMap(i => i.sourceUserIds || []));

    const pending = emailUsers.filter(u => !processedUserIds.has(u.id)).length;
    const collisionPending = await _model('identities').countDocuments({ status: 'collision_pending' });

    return {
      identityBackfillPending: pending,
      collisionPending,
      status: pending === 0 ? 'complete' : 'pending',
    };
  } catch {
    return { status: 'unknown' };
  }
}

/* ════════════════════════════════════════════════════════════════ */
/*  GET /api/qa/health                                             */
/* ════════════════════════════════════════════════════════════════ */
router.get('/health', authMiddleware, _superadmin, async (req, res) => {
  const startedAt = Date.now();

  try {
    /* Parallel: all non-interdependent checks */
    const [
      collectionCounts,
      integrityResults,
      migrationStatus,
      identityStatus,
    ] = await Promise.all([
      Promise.all(CRITICAL_COLLECTIONS.map(async ({ key, label }) => ({
        key, label, count: await _safeCount(key),
      }))),
      _integrityChecks(),
      _migrationStatus(),
      _identityMigrationStatus(),
    ]);

    const rbac    = _rbacScan();
    const cert    = _latestCert();
    const tests   = _testSummary();
    const errors  = _errorSummary();
    const pkg     = require('../../package.json');

    /* Derive overall gate verdicts */
    const integrityClean   = integrityResults.every(c => c.status === 'ok');
    const integrityWarning = integrityResults.some(c => c.status === 'warn');
    const integrityError   = integrityResults.some(c => c.status === 'error');

    const gates = {
      rbac:      { passed: rbac.passed,       label: 'RBAC Coverage',         value: `${rbac.coverage.toFixed(2)}%` },
      integrity: { passed: integrityClean,     label: 'Data Integrity',        value: integrityWarning ? 'WARN' : integrityError ? 'ERROR' : 'PASS' },
      migration: { passed: migrationStatus.status === 'complete', label: 'Migrations', value: migrationStatus.status },
      identity:  { passed: identityStatus.status === 'complete', label: 'Identity Migration (C8)', value: identityStatus.status },
      tests:     { passed: tests.fileCount > 0, label: 'Test Suite',           value: `${tests.fileCount} file(s)` },
    };

    const allGatesPassed = Object.values(gates).every(g => g.passed);

    return res.json({
      success:    true,
      data: {
        generatedAt: new Date().toISOString(),
        durationMs:  Date.now() - startedAt,
        platform: {
          version:    pkg.version,
          nodeVersion: process.version,
          dbConnected: mongoose.connection.readyState === 1,
          uptime:      Math.floor(process.uptime()),
        },
        verdict:    allGatesPassed ? 'CERTIFIED' : 'ATTENTION_REQUIRED',
        gates,
        rbac,
        collections:  collectionCounts,
        integrity:    integrityResults,
        migration:    migrationStatus,
        identityMigration: identityStatus,
        tests,
        errors,
        latestCert:   cert,
      },
    });
  } catch (err) {
    console.error('[qa-health]', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
// Attached for direct unit testing (C8/MR-001 Phase 2) — avoids mocking
// this route's unrelated dependencies (RBAC scan, release-cert file
// reads, test-directory scan) just to test these 3 functions.
// `module.exports = router` above is unchanged — `require()`ing this
// file still returns the router directly, same as every other route.
router._checkDanglingIdentityFK  = _checkDanglingIdentityFK;
router._checkPasswordHashMismatch = _checkPasswordHashMismatch;
router._identityMigrationStatus  = _identityMigrationStatus;
