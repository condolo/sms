/* ============================================================
   Msingi — Nightly Backup Cron

   Runs once per day for every active school.
   Writes every record the school has (utils/school-backup.js), reads the
   file back to check it, stores it, and writes a row to backup_logs with
   source:'cron' — also when it failed.

   Config (env vars):
     BACKUP_CRON_EXPR       — cron expression (Africa/Nairobi timezone)
                              default: "0 23 * * *"  (23:00 Kenya)
     BACKUP_KEEP_DAYS       — number of daily files to retain per school
                              default: 7
     BACKUP_ENCRYPTION_KEY  — 32-byte AES-256-GCM key, base64-encoded (REQUIRED for KDPA compliance)
                              Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
                              When set:  files are AES-256-GCM encrypted (.ndjson.gz.enc)
                              When unset: plaintext .ndjson.gz written (not compliant — warns on startup)

   Storage mode (checked in order):
     Cloud (preferred): set BACKUP_S3_BUCKET + BACKUP_S3_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
       Optional: BACKUP_S3_ENDPOINT (Cloudflare R2, Backblaze B2, DO Spaces)
                 BACKUP_S3_FORCE_PATH=true (required for R2 and MinIO)
     Local fallback: BACKUP_DIR (default: <project_root>/backups)
                     WARNING: ephemeral on Render — use cloud storage in production.

   The cron is registered at startup by server/index.js:
     const { startBackupCron } = require('./utils/backup-cron');
     startBackupCron();
   ============================================================ */
'use strict';

const cron   = require('node-cron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { _model }                                              = require('./model');
const { encryptReady }                                        = require('./backupEncrypt');
const { FORMAT, writeBackupFile, verifyBackupFile }           = require('./school-backup');
const { storageReady, uploadBackup, listBackups, deleteBackup } = require('./backupStorage');

/* ── Configuration ─────────────────────────────────────────── */
const BACKUP_DIR  = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '../../backups');

const KEEP_DAYS   = Math.max(1, parseInt(process.env.BACKUP_KEEP_DAYS  || '7',        10));
const BACKUP_CRON = process.env.BACKUP_CRON_EXPR || '0 23 * * *'; // 23:00 Kenya: the schedule runs in Africa/Nairobi time

const _slug = (school) => (school.name || school.id).replace(/[^a-z0-9]/gi, '_');
const _idPart = (school) => String(school.id ?? school._id).replace(/[^a-z0-9]/gi, '_');

/* Which stored files are this school's. New files carry the school's id.
   Files from before v5.286.0 carry only its name, matched exactly and only
   when no other school has that name: a "Trinity" used to match, and prune,
   "Trinity College". */
function isBackupOf(school, schools) {
  const own = new RegExp(`^Msingi_Backup_.*__${_idPart(school)}_\\d{4}-\\d{2}-\\d{2}\\.ndjson\\.gz(\\.enc)?$`);
  const shared = schools.filter(s => _slug(s) === _slug(school)).length > 1;
  const older = new RegExp(`^Msingi_Backup_${_slug(school)}_\\d{4}-\\d{2}-\\d{2}\\.json(\\.enc)?$`);
  return (filename) => own.test(filename) || (!shared && older.test(filename));
}

/* ── Keep the newest KEEP_DAYS files of one school ──────────── */
function _pruneLocalBackups(matches) {
  try {
    const day = (f) => (f.match(/\d{4}-\d{2}-\d{2}(?=\.)/) || [''])[0];
    const all = fs.readdirSync(BACKUP_DIR).filter(matches).sort((a, b) => day(b).localeCompare(day(a)));
    for (const f of all.slice(KEEP_DAYS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) { /* best effort */ }
    }
  } catch (_) { /* non-fatal */ }
}

async function _pruneCloudBackups(matches) {
  try {
    const objects = await listBackups(matches);  // newest first
    await Promise.all(objects.slice(KEEP_DAYS).map(o => deleteBackup(o.key).catch(() => {})));
  } catch (_) { /* non-fatal */ }
}

/* Small files go up as they always did; a large one as a stream. */
const STREAM_UPLOAD_BYTES = 64 * 1024 * 1024;

function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ── Main nightly job ──────────────────────────────────────── */
let _running = false;
async function runNightlyBackup() {
  if (_running) { console.warn('[backup-cron] Already running — skipped'); return; }
  _running = true;
  try { await _runNightlyBackup(); } finally { _running = false; }
}

async function _runNightlyBackup() {
  const encrypted = encryptReady();
  const cloud     = storageReady();

  if (!encrypted) {
    console.warn('[backup-cron] WARNING: BACKUP_ENCRYPTION_KEY is not set — backups will be plaintext. Set for KDPA Section 41 compliance.');
  }
  if (!cloud) {
    console.warn('[backup-cron] WARNING: Cloud storage env vars not set — falling back to local disk. Ephemeral on Render!');
  }

  console.log(`[backup-cron] Starting nightly backup… (encryption: ${encrypted ? 'ON' : 'OFF'}, storage: ${cloud ? 'cloud' : 'local'})`);

  // Ensure local fallback directory exists (no-op when cloud is active)
  if (!cloud) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    } catch (err) {
      console.error('[backup-cron] Cannot create BACKUP_DIR:', BACKUP_DIR, err.message);
      return;
    }
  }

  const Schools = _model('schools');
  const Logs    = _model('backup_logs');
  const db      = mongoose.connection.db;

  let schools;
  try {
    // Every school that has data: active or suspended. Not sign-ups still
    // waiting, nor demo copies (they expire and are rebuilt).
    schools = await Schools.find({ status: { $nin: ['pending', 'rejected'] }, isDemo: { $ne: true }, demoRequestId: { $exists: false } }).lean();
  } catch (err) {
    console.error('[backup-cron] Failed to list schools:', err.message);
    return;
  }

  if (!schools.length) {
    console.log('[backup-cron] No schools found — skipping');
    return;
  }

  let succeeded = 0;
  const failed  = [];

  for (const school of schools) {
    const schoolId = school.id ?? String(school._id);
    const now      = new Date().toISOString();
    const dateStr  = now.slice(0, 10);
    const label    = `Nightly auto-backup — ${dateStr}`;
    const id       = _uid();
    const filename = `Msingi_Backup_${_slug(school)}__${_idPart(school)}_${dateStr}.ndjson.gz${encrypted ? '.enc' : ''}`;
    const tmp      = path.join(os.tmpdir(), `${id}_${filename}`);
    try {
      const { total, stats, bytes } = await writeBackupFile(db, school, tmp, { id, label, exportedBy: 'system', source: 'cron' });
      await verifyBackupFile(tmp);   // throws: a file that can't be read back is not a backup

      let storageRef;
      if (cloud) {
        storageRef = await uploadBackup(filename, bytes > STREAM_UPLOAD_BYTES ? fs.createReadStream(tmp) : fs.readFileSync(tmp), dateStr, bytes);
      } else {
        storageRef = path.join(BACKUP_DIR, filename);
        fs.copyFileSync(tmp, storageRef);
      }

      // Never let a suddenly near-empty backup push out the good ones.
      const last = await Logs.findOne({ schoolId, source: 'cron', failed: { $ne: true } }).sort({ createdAt: -1 }).lean();
      const shrunk = last?.totalRecords > 50 && total < last.totalRecords / 2;
      if (shrunk) console.error(`[backup-cron] ⚠ ${school.name || schoolId}: ${total} records, was ${last.totalRecords}. Older backups kept — check this school.`);
      else if (cloud) await _pruneCloudBackups(isBackupOf(school, schools));
      else _pruneLocalBackups(isBackupOf(school, schools));

      await Logs.create({
        id, schoolId, createdAt: now, createdBy: 'system', label, version: FORMAT,
        totalRecords: total, stats, bytes, filename,
        storageRef,          // S3 object key (cloud) or absolute path (local)
        source: 'cron', encrypted, cloudStorage: cloud, verified: true, ...(shrunk ? { shrunk: true } : {}),
      });

      succeeded++;
      console.log(`[backup-cron] ✅ ${school.name || schoolId} — ${total} records, ${Math.round(bytes / 1024)} KB → ${storageRef}`);
    } catch (err) {
      failed.push(schoolId);
      console.error(`[backup-cron] ❌ ${schoolId}: ${err.message}`);
      await Logs.create({ id, schoolId, createdAt: now, createdBy: 'system', label, source: 'cron', failed: true, error: String(err.message).slice(0, 300) }).catch(() => {});
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* never written */ }
    }
  }

  const summary = `${succeeded}/${schools.length} succeeded` +
    (failed.length ? `; failed: ${failed.join(', ')}` : '');
  console.log(`[backup-cron] Done — ${summary}.`);
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

  const storageDesc = storageReady()
    ? `s3://${process.env.BACKUP_S3_BUCKET || '?'}/backups/`
    : `local: ${BACKUP_DIR} (ephemeral on Render — set BACKUP_S3_* for production)`;
  console.log(`[backup-cron] Scheduled — "${BACKUP_CRON}" (Africa/Nairobi). Storage: ${storageDesc}`);
}

module.exports = { startBackupCron, runNightlyBackup, isBackupOf };
