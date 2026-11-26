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
const mongoose = require('mongoose');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { backupCollections, schoolFilter, schoolRecords } = require('../utils/school-backup');

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

function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* The school's own record, whichever id form the session holds. */
async function _school(schoolId) {
  return _model('schools').findOne({ id: schoolId }).lean();
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
    const school   = await _school(schoolId);
    if (!school) return res.status(404).json({ error: 'School not found' });
    const db    = mongoose.connection.db;
    const stats = {};
    let   total = 0;
    for (const col of await backupCollections(db)) {
      const count = await db.collection(col).countDocuments(schoolFilter(col, school));
      if (!count) continue;
      stats[col] = count;
      total     += count;
    }

    res.json({ collections: stats, totalRecords: total, schoolId });
  } catch (err) {
    console.error('[backup/preview]', err.message);
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

    const school = await _school(schoolId);
    if (!school) return res.status(404).json({ error: 'School not found' });
    const dateStr  = now.slice(0, 10);
    const filename = `Msingi_Backup_${(school.name || schoolId).replace(/[^a-z0-9]/gi, '_')}_${dateStr}.json`;
    const meta     = { id: _uid(), version: '4.0.0', exportedAt: now, exportedBy: userId, schoolId, schoolName: school.name || schoolId, label: label || `Backup — ${dateStr}` };
    const stats    = {};
    let   total    = 0;

    /* Every record the school has (utils/school-backup.js), written as it is
       read: plain JSON for the school to keep. Nightly files are the ones a
       restore reads. */
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    async function* body() {
      let current = null;
      yield '{"data":{';
      for await (const { c, d } of schoolRecords(mongoose.connection.db, school, stats)) {
        yield c === current ? ',' : `${current === null ? '' : '],'}${JSON.stringify(c)}:[`;
        current = c;
        yield JSON.stringify(d);
      }
      total = Object.values(stats).reduce((a, b) => a + b, 0);
      yield `${current === null ? '' : ']'}},"_meta":${JSON.stringify({ ...meta, totalRecords: total, stats, warning: 'This file contains sensitive school data. Store securely and do not share.' })}}`;
    }
    await pipeline(Readable.from(body()), res);

    await tenantModel('backup_logs', tenantContext(req)).create({
      id: meta.id, schoolId, createdAt: now, createdBy: userId, label: meta.label, version: meta.version, totalRecords: total, stats, filename,
    });

    console.log(`[BACKUP] Exported ${total} records for school ${schoolId} by user ${userId}`);
  } catch (err) {
    console.error('[backup/export]', err);
    if (res.headersSent) return res.destroy(err);   // the browser shows a failed download, never a short file as complete
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
