/* ============================================================
   Sync Route — returns ALL data for a school in one request.
   Used by the frontend on login to populate localStorage.
   Also accepts a full push (export from localStorage → MongoDB).
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All collections to include in a full sync
const SYNC_COLLECTIONS = [
  'schools','users','students','teachers','classes','subjects',
  'timetable','attendance','grades','exams','exam_results',
  'invoices','payments','fee_structures','messages','events',
  'behaviour_incidents','behaviour_appeals','behaviour_categories',
  'merit_milestones','demerit_stages','houses','key_stages',
  'detention_types','audit_log','academic_years','report_cards',
  'role_permissions','admissions','sections','notifications',
  'behaviour_matrix'
];

const GLOBAL = new Set(['behaviour_matrix']);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  schema.index({ schoolId: 1 });
  schema.index({ id: 1 });
  return mongoose.model(name, schema, col);
}

/* GET /api/sync  — download all school data */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schoolId = req.jwtUser.schoolId;
    const result   = {};

    await Promise.all(SYNC_COLLECTIONS.map(async col => {
      const Model  = _model(col);
      const filter = GLOBAL.has(col) ? {} : { schoolId };
      result[col]  = await Model.find(filter).lean();
    }));

    res.json(result);
  } catch (err) {
    console.error('[sync/GET]', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

/* POST /api/sync  — push all localStorage data to MongoDB (initial migration) */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schoolId = req.jwtUser.schoolId;
    const payload  = req.body;  // { students: [...], teachers: [...], ... }
    const summary  = {};

    await Promise.all(Object.entries(payload).map(async ([col, rows]) => {
      if (!SYNC_COLLECTIONS.includes(col)) return;
      if (!Array.isArray(rows) || !rows.length) return;
      const Model = _model(col);
      const ops   = rows.map(r => ({
        updateOne: {
          filter: { id: r.id, ...(GLOBAL.has(col) ? {} : { schoolId }) },
          update: { $set: { ...r, schoolId: GLOBAL.has(col) ? (r.schoolId || schoolId) : schoolId } },
          upsert: true
        }
      }));
      const result    = await Model.bulkWrite(ops);
      summary[col]    = { upserted: result.upsertedCount, modified: result.modifiedCount };
    }));

    res.json({ success: true, summary });
  } catch (err) {
    console.error('[sync/POST]', err.message);
    res.status(500).json({ error: 'Sync push failed' });
  }
});

module.exports = router;
