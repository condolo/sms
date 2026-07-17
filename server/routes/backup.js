/* ============================================================
   Msingi — Data Backup & Export Route
   Superadmin-only. Exports full school data as a JSON snapshot.
   Logs backup metadata to backup_logs collection.
   ============================================================ */
const express  = require('express');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');

const router = express.Router();

/* All backup routes require authentication */
router.use(authMiddleware);

/* Only superadmin can backup */
function _requireSuperAdmin(req, res, next) {
  const role  = req.jwtUser?.role || '';
  const roles = req.jwtUser?.roles || [];
  if (role !== 'superadmin' && !roles.includes('superadmin')) {
    return res.status(403).json({ error: 'Super admin access required for backup operations' });
  }
  next();
}

const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: { error: 'Too many backup requests. Maximum 10 backups per hour.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/* All collections to include in a full school backup.
   Keep in sync with TENANT_COLS in platform.js and ALLOWED in collections.js. */
const BACKUP_COLLECTIONS = [
  // Core
  'schools','users','students','teachers','classes','subjects',
  'academic_years','sections','role_permissions','admissions',
  'events','messages','notifications','announcements',

  // Timetable & structure
  'timetable','bell_schedule','rooms','departments',
  'class_subjects','student_subjects','subject_rules','teaching_assignments',

  // Attendance & behaviour
  'attendance',
  'behaviour_incidents','behaviour_appeals','behaviour_categories',
  'merit_milestones','demerit_stages','detention_types','houses','key_stages',

  // Finance
  'invoices','payments','fee_structures',

  // Grades, exams & report cards
  'grades','exams','exam_results',
  'assessment_marks','assessment_config','grade_boundaries',
  'report_card_snapshots','publish_batches',
  'mark_audit_log','mark_submissions','exam_series',

  // Curriculum / lessons
  'lesson_coverage','syllabus_topics',

  // Growth / co-curricular portfolio
  'growth_projects','growth_leadership','growth_activities',
  'growth_service','growth_awards','growth_recommendations','growth_aspirations',

  // Library, hostel, transport
  'library_books','library_loans',
  'hostels','hostel_rooms','hostel_assignments',
  'transport_routes','transport_assignments',

  // E-learning
  'elearning_tokens','elearning_course_links',
  'elearning_coursework_links','elearning_sessions',

  // Billing & audit
  'billing_snapshots','comment_banks',
  'user_photos',
];

function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ── GET /api/backup/history — list this school's backup logs ── */
router.get('/history', _requireSuperAdmin, async (req, res) => {
  try {
    const Logs = tenantModel('backup_logs', tenantContext(req));
    const logs = await Logs.find({ schoolId: req.jwtUser.schoolId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(logs);
  } catch (err) {
    console.error('[backup/history]', err.message);
    res.status(500).json({ error: 'Failed to fetch backup history' });
  }
});

/* ── GET /api/backup/preview — count records per collection ── */
router.get('/preview', _requireSuperAdmin, async (req, res) => {
  try {
    const schoolId = req.jwtUser.schoolId;
    const stats    = {};
    let   total    = 0;

    await Promise.all(BACKUP_COLLECTIONS.map(async col => {
      const Model = _model(col);
      const count = await Model.countDocuments({ schoolId });
      stats[col]  = count;
      total      += count;
    }));

    res.json({ collections: stats, totalRecords: total, schoolId });
  } catch (err) {
    res.status(500).json({ error: 'Preview failed' });
  }
});

/* ── POST /api/backup/export — create full backup, return as JSON file ──
   Also logs metadata to backup_logs.
   Response: JSON file download  */
router.post('/export', _requireSuperAdmin, backupLimiter, async (req, res) => {
  try {
    const schoolId  = req.jwtUser.schoolId;
    const userId    = req.jwtUser.userId;
    const { label } = req.body;
    const now       = new Date().toISOString();

    /* Pull all data for this school */
    const data   = {};
    const stats  = {};
    let   total  = 0;

    await Promise.all(BACKUP_COLLECTIONS.map(async col => {
      const Model  = _model(col);
      const filter = col === 'schools' ? { id: schoolId } : { schoolId };
      let   docs   = await Model.find(filter).lean();

      // Strip credentials before export — bcrypt hashes must never leave the server
      if (col === 'users') {
        docs = docs.map(({ password, passwordHash, twoFactorSecret, mfaOtp, mfaExpiry, ...rest }) => rest);
      }
      // Strip school M-Pesa keys and encrypted SMTP password
      if (col === 'schools') {
        docs = docs.map(({ smtpPassEnc, mpesa, ...rest }) => rest);
      }

      data[col]   = docs;
      stats[col]  = docs.length;
      total      += docs.length;
    }));

    /* Get school name for the filename */
    const schoolDoc = (data['schools'] || [])[0];
    const schoolName = (schoolDoc?.name || schoolId).replace(/[^a-z0-9]/gi, '_');
    const dateStr    = now.slice(0, 10);
    const filename   = `Msingi_Backup_${schoolName}_${dateStr}.json`;

    /* Compile the backup manifest */
    const backup = {
      _meta: {
        id:          _uid(),
        version:     '3.5.0',
        exportedAt:  now,
        exportedBy:  userId,
        schoolId,
        schoolName:  schoolDoc?.name || schoolId,
        label:       label || `Backup — ${dateStr}`,
        totalRecords: total,
        stats,
        warning:     'This file contains sensitive school data. Store securely and do not share.'
      },
      data
    };

    /* Log metadata (without the data blob) */
    const Logs = tenantModel('backup_logs', tenantContext(req));
    await Logs.create({
      id:          backup._meta.id,
      schoolId,
      createdAt:   now,
      createdBy:   userId,
      label:       backup._meta.label,
      version:     backup._meta.version,
      totalRecords: total,
      stats,
      filename
    });

    /* Serve as downloadable JSON file */
    const json = JSON.stringify(backup, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(json, 'utf8'));
    res.send(json);

    console.log(`[BACKUP] Exported ${total} records for school ${schoolId} by user ${userId}`);
  } catch (err) {
    console.error('[backup/export]', err);
    res.status(500).json({ error: 'Backup failed. Please try again.' });
  }
});

/* ── DELETE /api/backup/logs/:id — delete a backup log entry ── */
router.delete('/logs/:id', _requireSuperAdmin, async (req, res) => {
  try {
    const Logs = tenantModel('backup_logs', tenantContext(req));
    await Logs.deleteOne({ id: req.params.id, schoolId: req.jwtUser.schoolId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete backup log' });
  }
});

module.exports = router;
