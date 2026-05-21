/* ============================================================
   Msingi — Events & Calendar Route
   /api/events — School events, calendar entries
   ============================================================ */
const express        = require('express');
const mongoose       = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware }   = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

const ADMIN_ROLES = ['superadmin', 'admin', 'deputy_principal', 'timetabler'];

/* GET /api/events — list events for this school */
router.get('/', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { from, to, type, category } = req.query;
    const Event = _model('events');

    const filter = { schoolId };
    if (type)     filter.type = type;
    if (category) filter.category = category;
    if (from || to) {
      filter.startDate = {};
      if (from) filter.startDate.$gte = from;
      if (to)   filter.startDate.$lte = to;
    }

    const events = await Event.find(filter).sort({ startDate: 1 }).lean();
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/events/:id */
router.get('/:id', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const event = await _model('events').findOne({ id: req.params.id, schoolId }).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/events — create event (admin/deputy only) */
router.post('/', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Not authorised to create events' });
    }
    const { title, description, startDate, endDate, allDay, type, category, location, color, audience } = req.body;
    if (!title || !startDate) return res.status(400).json({ error: 'title and startDate are required' });

    const event = await _model('events').create({
      id: `evt_${uuidv4().slice(0, 8)}`,
      schoolId, title, description, location,
      startDate, endDate: endDate || startDate,
      allDay: allDay !== false,
      type: type || 'general',
      category: category || 'school',
      color: color || '#4f46e5',
      audience: audience || ['all'],
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/events/:id — update event */
router.put('/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Not authorised to update events' });
    }
    const event = await _model('events').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...req.body, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/events/:id */
router.delete('/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Not authorised to delete events' });
    }
    const result = await _model('events').deleteOne({ id: req.params.id, schoolId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
