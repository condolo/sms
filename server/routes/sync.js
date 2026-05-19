/* ============================================================
   Msingi — Sync Route
   Provides a full school data export for backup/migration.

   Security hardening (v4.9.0):
   - GET  /api/sync — restricted to superadmin/admin roles only
     (previously open to any authenticated user)
   - POST /api/sync — write path DISABLED; use /api/import-export
     for structured bulk data import with validation.

   The GET endpoint strips sensitive fields (password, mfaOtp,
   mfaExpiry) from the users collection before returning.
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');

const router = express.Router();

/* Collections included in a full sync export */
const SYNC_COLLECTIONS = [
  'schools', 'students', 'teachers', 'classes', 'subjects',
  'timetable', 'attendance', 'grades', 'exams', 'exam_results',
  'invoices', 'payments', 'fee_structures', 'events',
  'behaviour_incidents', 'behaviour_appeals', 'behaviour_categories',
  'merit_milestones', 'demerit_stages', 'houses', 'key_stages',
  'detention_types', 'academic_years', 'role_permissions',
  'admissions', 'sections', 'notifications', 'assessment_marks',
  'assessment_config', 'report_card_snapshots'
  // 'users'   — excluded; use /api/users for user management
  // 'audit_log' — excluded; sensitive internal audit data
];

/* SENSITIVE_STRIP — fields never returned in any sync payload */
const SENSITIVE_FIELDS = new Set(['password', 'mfaOtp', 'mfaExpiry', 'tempPassword']);

function _stripSensitive(doc) {
  if (!doc) return doc;
  for (const f of SENSITIVE_FIELDS) delete doc[f];
  return doc;
}

/* Role guard — sync is restricted to admin/superadmin */
function _requireAdmin(req, res, next) {
  const role = req.jwtUser?.role;
  const roles = req.jwtUser?.roles || [];
  if (role === 'superadmin' || role === 'admin' || roles.includes('superadmin') || roles.includes('admin')) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Full data export is restricted to admin and superadmin roles.' }
  });
}

/* ── GET /api/sync ──────────────────────────────────────────── */
router.get('/', authMiddleware, _requireAdmin, async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const result = {};

    await Promise.all(SYNC_COLLECTIONS.map(async col => {
      const Model = _model(col);
      const docs  = await Model.find({ schoolId }).lean();
      result[col] = docs.map(_stripSensitive);
    }));

    console.log(`[sync/GET] Full export by ${req.jwtUser.userId} for school ${schoolId} — ${Object.values(result).reduce((s, a) => s + a.length, 0)} total records`);
    res.json({ success: true, schoolId, exportedAt: new Date().toISOString(), data: result });
  } catch (err) {
    console.error('[sync/GET]', err.message);
    res.status(500).json({ error: 'Sync export failed' });
  }
});

/* ── POST /api/sync — DISABLED ──────────────────────────────── */
/*
 * The write path has been disabled. It accepted arbitrary unvalidated
 * data and could be used to overwrite any collection including 'users',
 * enabling role escalation attacks.
 *
 * Use /api/import-export for structured bulk import with Zod validation.
 */
router.post('/', authMiddleware, (req, res) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'DEPRECATED',
      message: 'The sync write path has been removed. Use POST /api/import-export/students or /api/import-export/teachers for bulk data import with validation.',
      alternatives: {
        importStudents: 'POST /api/import-export/students',
        importTeachers: 'POST /api/import-export/teachers',
        downloadTemplate: 'GET /api/import-export/template/students',
      }
    }
  });
});

module.exports = router;
