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
    ] = await Promise.all([
      Promise.all(CRITICAL_COLLECTIONS.map(async ({ key, label }) => ({
        key, label, count: await _safeCount(key),
      }))),
      _integrityChecks(),
      _migrationStatus(),
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
