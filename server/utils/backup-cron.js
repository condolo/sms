/* ============================================================
   Msingi — Nightly Backup Cron

   Runs once per day for every active school.
   Generates a full JSON snapshot (same content as the manual
   "Export Backup" button), saves it to BACKUP_DIR on disk,
   and writes a metadata row to backup_logs with source:'cron'.

   Config (env vars):
     BACKUP_DIR        — directory to store JSON files
                         default: <project_root>/backups
     BACKUP_CRON_EXPR  — cron expression (Africa/Nairobi timezone)
                         default: "0 23 * * *"  (02:00 Kenya = 23:00 UTC)
     BACKUP_KEEP_DAYS  — number of daily files to retain per school
                         default: 7

   The cron is registered at startup by server/index.js:
     const { startBackupCron } = require('./utils/backup-cron');
     startBackupCron();
   ============================================================ */
'use strict';

const cron   = require('node-cron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { _model } = require('./model');

/* ── Configuration ─────────────────────────────────────────── */
const BACKUP_DIR  = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '../../backups');

const KEEP_DAYS   = Math.max(1, parseInt(process.env.BACKUP_KEEP_DAYS  || '7',        10));
const BACKUP_CRON = process.env.BACKUP_CRON_EXPR || '0 23 * * *'; // 02:00 Kenya (UTC+3)

/* ── Identical collection list to routes/backup.js ─────────── */
const BACKUP_COLLECTIONS = [
  'schools','users','students','teachers','classes','subjects',
  'timetable','attendance','grades','exams','exam_results',
  'invoices','payments','fee_structures','messages','events',
  'behaviour_incidents','behaviour_appeals','behaviour_categories',
  'merit_milestones','demerit_stages','houses','key_stages',
  'detention_types','audit_log','academic_years','report_cards',
  'role_permissions','admissions','sections','notifications',
];

function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ── Core backup logic ─────────────────────────────────────── */
async function _buildBackupForSchool(schoolId) {
  const data  = {};
  const stats = {};
  let   total = 0;
  const now   = new Date().toISOString();

  await Promise.all(BACKUP_COLLECTIONS.map(async col => {
    const Model  = _model(col);
    const filter = col === 'schools' ? { id: schoolId } : { schoolId };
    let   docs   = await Model.find(filter).lean();

    // Strip credentials — same rules as the manual export endpoint
    if (col === 'users') {
      docs = docs.map(({ password, passwordHash, twoFactorSecret, mfaOtp, mfaExpiry, ...rest }) => rest);
    }
    if (col === 'schools') {
      docs = docs.map(({ smtpPassEnc, mpesa, ...rest }) => rest);
    }

    data[col]  = docs;
    stats[col] = docs.length;
    total     += docs.length;
  }));

  const schoolDoc  = (data['schools'] || [])[0];
  const schoolName = (schoolDoc?.name || schoolId).replace(/[^a-z0-9]/gi, '_');
  const dateStr    = now.slice(0, 10);
  const filename   = `Msingi_Backup_${schoolName}_${dateStr}.json`;
  const label      = `Nightly auto-backup — ${dateStr}`;
  const id         = _uid();

  const manifest = {
    _meta: {
      id,
      version:      '3.5.0',
      exportedAt:   now,
      exportedBy:   'system',
      source:       'cron',
      schoolId,
      schoolName:   schoolDoc?.name || schoolId,
      label,
      totalRecords: total,
      stats,
      warning:      'This file contains sensitive school data. Store securely and do not share.',
    },
    data,
  };

  return { manifest, filename, schoolName, label, id, total, stats, now };
}

/* ── Prune old backup files for one school ─────────────────── */
function _pruneOldBackups(schoolNameSlug) {
  try {
    const prefix = `Msingi_Backup_${schoolNameSlug}_`;
    const all    = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .sort()       // ISO date strings are lexicographically ordered → chronological
      .reverse();   // newest first

    for (const f of all.slice(KEEP_DAYS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) { /* best effort */ }
    }
  } catch (_) { /* non-fatal — BACKUP_DIR may not exist yet on first run */ }
}

/* ── Main nightly job ──────────────────────────────────────── */
async function runNightlyBackup() {
  console.log('[backup-cron] Starting nightly backup run…');

  // Ensure storage directory exists
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    console.error('[backup-cron] Cannot create BACKUP_DIR:', BACKUP_DIR, err.message);
    return;
  }

  const Schools = _model('schools');
  const Logs    = _model('backup_logs');

  let schools;
  try {
    schools = await Schools.find({ status: 'active' }).lean();
  } catch (err) {
    console.error('[backup-cron] Failed to list active schools:', err.message);
    return;
  }

  if (!schools.length) {
    console.log('[backup-cron] No active schools found — skipping');
    return;
  }

  let succeeded = 0;
  const failed  = [];

  for (const school of schools) {
    try {
      const { manifest, filename, schoolName, label, id, total, stats, now } =
        await _buildBackupForSchool(school.id);

      // Write JSON file to disk
      const filePath = path.join(BACKUP_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf8');

      // Write metadata to backup_logs (same collection as manual exports)
      await Logs.create({
        id,
        schoolId:     school.id,
        createdAt:    now,
        createdBy:    'system',
        label,
        version:      manifest._meta.version,
        totalRecords: total,
        stats,
        filename,
        source:       'cron',
      });

      // Remove old files beyond the retention window
      _pruneOldBackups(schoolName);

      succeeded++;
      console.log(`[backup-cron] ✅ ${school.name || school.id} — ${total} records → ${filename}`);
    } catch (err) {
      failed.push(school.id);
      console.error(`[backup-cron] ❌ ${school.id}: ${err.message}`);
    }
  }

  const summary = `${succeeded}/${schools.length} succeeded` +
    (failed.length ? `; failed: ${failed.join(', ')}` : '');
  console.log(`[backup-cron] Done — ${summary}. Storage: ${BACKUP_DIR}`);
}

/* ── Cron registration ─────────────────────────────────────── */
function startBackupCron() {
  if (!cron.validate(BACKUP_CRON)) {
    console.error(`[backup-cron] Invalid cron expression "${BACKUP_CRON}" — cron not started`);
    return;
  }

  cron.schedule(BACKUP_CRON, () => {
    runNightlyBackup().catch(err =>
      console.error('[backup-cron] Unhandled error:', err)
    );
  }, { timezone: 'Africa/Nairobi' });

  console.log(`[backup-cron] Scheduled — "${BACKUP_CRON}" (Africa/Nairobi). Storage: ${BACKUP_DIR}`);
}

module.exports = { startBackupCron, runNightlyBackup };
