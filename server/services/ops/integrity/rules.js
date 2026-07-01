/**
 * Integrity Rules Registry
 *
 * Each rule is an object:
 *   { id, module, label, severity, minVersion, run() → { count, samples } }
 *
 * severity: 'critical' | 'warn' | 'info'
 * minVersion: semver string — rule is skipped on older deployments
 *             (prevents old snapshots from failing checks added in newer versions)
 *
 * Adding a new module's rules:
 *   Push a new rule object here. The integrity engine picks it up automatically.
 */
'use strict';

const { _model } = require('../../../utils/model');

const RULES = [

  /* ── Core: Users & Tenancy ─────────────────────────────────── */
  {
    id:       'users.missing_school_id',
    module:   'core',
    label:    'Users missing schoolId (non-platform)',
    severity: 'critical',
    async run() {
      const docs = await _model('users')
        .find({
          role: { $nin: ['platform_admin', 'superadmin'] },
          $or: [{ schoolId: { $exists: false } }, { schoolId: null }, { schoolId: '' }],
        })
        .select('id email role').limit(10).lean();
      return { count: docs.length, samples: docs.map(d => d.email || String(d._id)) };
    },
  },

  /* ── Students ───────────────────────────────────────────────── */
  {
    id:       'students.missing_school_id',
    module:   'students',
    label:    'Students missing schoolId',
    severity: 'critical',
    async run() {
      const docs = await _model('students')
        .find({ $or: [{ schoolId: { $exists: false } }, { schoolId: null }, { schoolId: '' }] })
        .select('id admissionNumber').limit(10).lean();
      return { count: docs.length, samples: docs.map(d => d.id || String(d._id)) };
    },
  },
  {
    id:       'students.duplicate_admission_numbers',
    module:   'students',
    label:    'Duplicate admission numbers (same school)',
    severity: 'critical',
    async run() {
      const dupes = await _model('students').aggregate([
        { $match: { admissionNumber: { $exists: true, $ne: null } } },
        { $group: { _id: { schoolId: '$schoolId', admNo: '$admissionNumber' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 10 },
      ]).catch(() => []);
      return {
        count: dupes.length,
        samples: dupes.map(d => `${d._id.schoolId}:${d._id.admNo} (×${d.count})`),
      };
    },
  },

  /* ── Attendance ─────────────────────────────────────────────── */
  {
    id:       'attendance.orphaned_records',
    module:   'attendance',
    label:    'Attendance records referencing non-existent students',
    severity: 'warn',
    async run() {
      const studentIds = await _model('students').distinct('id').catch(() => []);
      const orphans = await _model('attendance_records')
        .find({ studentId: { $nin: studentIds, $exists: true } })
        .select('studentId classId date').limit(10).lean();
      return { count: orphans.length, samples: orphans.map(d => d.studentId) };
    },
  },

  /* ── Finance ────────────────────────────────────────────────── */
  {
    id:       'finance.invoices_missing_school_id',
    module:   'finance',
    label:    'Finance invoices missing schoolId',
    severity: 'critical',
    async run() {
      const docs = await _model('finance_invoices')
        .find({ $or: [{ schoolId: { $exists: false } }, { schoolId: null }] })
        .select('id studentId amount').limit(10).lean();
      return { count: docs.length, samples: docs.map(d => d.id || String(d._id)) };
    },
  },
  {
    id:       'finance.receipts_missing_invoice',
    module:   'finance',
    label:    'Payment receipts referencing non-existent invoices',
    severity: 'warn',
    async run() {
      const invoiceIds = await _model('finance_invoices').distinct('id').catch(() => []);
      const orphans = await _model('finance_payments')
        .find({ invoiceId: { $nin: invoiceIds, $exists: true } })
        .select('invoiceId amount').limit(10).lean();
      return { count: orphans.length, samples: orphans.map(d => d.invoiceId) };
    },
  },

  /* ── Exams / Grades ─────────────────────────────────────────── */
  {
    id:       'grades.entries_missing_class',
    module:   'exams',
    label:    'Grade entries referencing non-existent classes',
    severity: 'warn',
    async run() {
      const classIds = await _model('classes').distinct('id').catch(() => []);
      const orphans = await _model('grade_entries')
        .find({ classId: { $nin: classIds, $exists: true } })
        .select('classId studentId subject').limit(10).lean();
      return { count: orphans.length, samples: orphans.map(d => d.classId) };
    },
  },

  /* ── Report Cards (added in v4.28.0) ───────────────────────── */
  {
    id:         'report_cards.published_missing_report_id',
    module:     'report_cards',
    label:      'Published snapshots missing reportId (pre-RC-3 migration)',
    severity:   'warn',
    minVersion: '4.28.0',
    async run() {
      const docs = await _model('report_card_snapshots')
        .find({ status: 'published', reportId: { $exists: false } })
        .select('studentId academicYear termNumber').limit(10).lean();
      return {
        count: docs.length,
        samples: docs.map(d => `${d.studentId}/${d.academicYear}/T${d.termNumber}`),
      };
    },
  },
  {
    id:         'report_cards.published_missing_hash',
    module:     'report_cards',
    label:      'Published snapshots missing sha256Hash',
    severity:   'warn',
    minVersion: '4.28.0',
    async run() {
      const docs = await _model('report_card_snapshots')
        .find({ status: 'published', sha256Hash: { $exists: false } })
        .select('studentId reportId').limit(10).lean();
      return { count: docs.length, samples: docs.map(d => d.reportId || String(d._id)) };
    },
  },

  /* ── Behaviour ──────────────────────────────────────────────── */
  {
    id:       'behaviour.records_missing_student',
    module:   'behaviour',
    label:    'Behaviour records referencing non-existent students',
    severity: 'warn',
    async run() {
      const studentIds = await _model('students').distinct('id').catch(() => []);
      const orphans = await _model('behaviour_records')
        .find({ studentId: { $nin: studentIds, $exists: true } })
        .select('studentId type date').limit(10).lean();
      return { count: orphans.length, samples: orphans.map(d => d.studentId) };
    },
  },

];

module.exports = RULES;
