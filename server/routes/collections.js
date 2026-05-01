/* ============================================================
   Generic CRUD router — handles all collections
   Every operation is automatically scoped to req.school.id
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const { authMiddleware }   = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const email    = require('../utils/email');

const router = express.Router();

// Collections that are allowed through this router
const ALLOWED = new Set([
  'schools','users','students','teachers','classes','subjects',
  'timetable','attendance','grades','exams','exam_results',
  'invoices','payments','fee_structures','messages','events',
  'behaviour_incidents','behaviour_appeals','behaviour_categories',
  'behaviour_matrix','merit_milestones','demerit_stages','houses',
  'key_stages','detention_types','audit_log','academic_years',
  'report_cards','role_permissions','admissions','sections',
  'notifications'
]);

// Collections that should NOT be filtered by schoolId (global/platform data)
const GLOBAL = new Set(['behaviour_matrix']);

// Collections only admin/superadmin can write to
const ADMIN_WRITE = new Set(['users', 'role_permissions', 'schools', 'fee_structures']);

// Collections only superadmin can write to
const SUPERADMIN_WRITE = new Set(['schools']);

// Admin roles
const ADMIN_ROLES = new Set(['superadmin', 'admin']);

function _isAdmin(req) {
  const role = req.jwtUser?.role || '';
  const roles = req.jwtUser?.roles || [];
  return ADMIN_ROLES.has(role) || roles.some(r => ADMIN_ROLES.has(r));
}
function _isSuperAdmin(req) {
  const role = req.jwtUser?.role || '';
  const roles = req.jwtUser?.roles || [];
  return role === 'superadmin' || roles.includes('superadmin');
}

/* Strip sensitive fields from user docs */
function _sanitiseUser(doc) {
  if (!doc) return doc;
  const { password, mfaOtp, mfaExpiry, ...safe } = doc;
  return safe;
}

// Lazy-create a Mongoose model for any collection name
function _model(col) {
  const name = _modelName(col);
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  schema.index({ schoolId: 1 });
  schema.index({ id: 1 });
  return mongoose.model(name, schema, col); // use col as the actual MongoDB collection name
}

function _modelName(col) {
  return col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
            .replace(/^./, c => c.toUpperCase()) + 'Doc';
}

/* ── GET /api/collections/:col  — list all docs for this school ── */
router.get('/:col', authMiddleware, async (req, res) => {
  const { col } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  try {
    const Model  = _model(col);
    const filter = GLOBAL.has(col) ? {} : { schoolId: req.jwtUser.schoolId };
    let docs     = await Model.find(filter).lean();
    // ⚠️ Security: strip password hashes and OTP fields from user records
    if (col === 'users') docs = docs.map(_sanitiseUser);
    res.json(docs);
  } catch (err) {
    console.error(`[GET /${col}]`, err.message);
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

/* ── POST /api/collections/:col  — insert a document ── */
router.post('/:col', authMiddleware, async (req, res) => {
  const { col } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  // ⚠️ Security: only admins can create users/permissions/schools
  if (SUPERADMIN_WRITE.has(col) && !_isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin access required' });
  if (ADMIN_WRITE.has(col) && !_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    const Model = _model(col);
    const data  = { ...req.body };
    if (!GLOBAL.has(col)) data.schoolId = req.jwtUser.schoolId;
    if (!data.id) data.id = _uid();
    const doc = await Model.create(data);
    const out = doc.toObject();
    res.status(201).json(col === 'users' ? _sanitiseUser(out) : out);
  } catch (err) {
    console.error(`[POST /${col}]`, err.message);
    res.status(500).json({ error: 'Failed to insert document' });
  }
});

/* ── PUT /api/collections/:col/:id  — update a document ── */
router.put('/:col/:id', authMiddleware, async (req, res) => {
  const { col, id } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  // ⚠️ Security: only admins can modify users/permissions/schools
  if (SUPERADMIN_WRITE.has(col) && !_isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin access required' });
  if (ADMIN_WRITE.has(col) && !_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    const Model  = _model(col);
    const filter = GLOBAL.has(col) ? { id } : { id, schoolId: req.jwtUser.schoolId };

    // ── Role change detection (users collection) ──────────
    let oldDoc = null;
    if (col === 'users') {
      oldDoc = await Model.findOne(filter).lean();
      // Prevent non-superadmin from elevating roles to superadmin
      if (!_isSuperAdmin(req) && req.body.role === 'superadmin') {
        return res.status(403).json({ error: 'Cannot assign superadmin role' });
      }
      // Prevent modifying own role (except superadmin)
      if (!_isSuperAdmin(req) && id === req.jwtUser.userId) {
        return res.status(403).json({ error: 'Cannot modify your own role' });
      }
    }

    const update = { ...req.body, updatedAt: new Date().toISOString() };
    delete update._id;
    // ⚠️ Security: never allow overwriting password through this generic endpoint
    if (col === 'users') delete update.password;

    const doc = await Model.findOneAndUpdate(filter, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // ── Send role change notification email ───────────────
    if (col === 'users' && oldDoc && req.body.role && req.body.role !== oldDoc.role) {
      const School = require('../utils/model')._model('schools');
      const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();
      email.sendRoleChanged({
        name:       doc.name,
        email:      doc.email,
        schoolName: school?.name || '',
        oldRole:    oldDoc.role,
        newRole:    req.body.role,
        changedBy:  req.jwtUser.email
      }).catch(err => console.error('[role-change email]', err.message));
    }

    res.json(col === 'users' ? _sanitiseUser(doc) : doc);
  } catch (err) {
    console.error(`[PUT /${col}/${id}]`, err.message);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

/* ── DELETE /api/collections/:col/:id  — delete a document ── */
router.delete('/:col/:id', authMiddleware, async (req, res) => {
  const { col, id } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (SUPERADMIN_WRITE.has(col) && !_isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin access required' });
  if (ADMIN_WRITE.has(col) && !_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    const Model  = _model(col);
    const filter = GLOBAL.has(col) ? { id } : { id, schoolId: req.jwtUser.schoolId };
    const result = await Model.deleteOne(filter);
    if (!result.deletedCount) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /${col}/${id}]`, err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/* ── POST /api/collections/:col/bulk  — bulk upsert (used by sync) ── */
router.post('/:col/bulk', authMiddleware, async (req, res) => {
  const { col } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (SUPERADMIN_WRITE.has(col) && !_isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin access required' });
  if (ADMIN_WRITE.has(col) && !_isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
  const rows = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Body must be an array' });
  try {
    const Model  = _model(col);
    const ops    = rows.map(r => ({
      updateOne: {
        filter: { id: r.id, ...(GLOBAL.has(col) ? {} : { schoolId: req.jwtUser.schoolId }) },
        update: { $set: { ...r, schoolId: GLOBAL.has(col) ? r.schoolId : req.jwtUser.schoolId } },
        upsert: true
      }
    }));
    const result = await Model.bulkWrite(ops);
    res.json({ upserted: result.upsertedCount, modified: result.modifiedCount });
  } catch (err) {
    console.error(`[BULK /${col}]`, err.message);
    res.status(500).json({ error: 'Bulk write failed' });
  }
});

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

module.exports = router;
