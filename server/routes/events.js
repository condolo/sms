/* ============================================================
   Msingi — Events & Calendar Route
   /api/events — School events, calendar entries
   ============================================================ */
const express        = require('express');
const mongoose       = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware }   = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { rbac }             = require('../middleware/rbac');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* GET /api/events — list events for this school */
router.get('/', rbac('events', 'read'), async (req, res) => {
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

/* GET /api/events/birthdays?month=5&year=2026 — list birthdays for given month */
router.get('/birthdays', rbac('events', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const month    = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const monthStr = String(month).padStart(2, '0');
    const pattern  = new RegExp(`^\\d{4}-${monthStr}-`);

    const Student = _model('students');
    const Teacher = _model('teachers');

    const [students, teachers] = await Promise.all([
      Student.find({ schoolId, dateOfBirth: { $regex: pattern } }).lean(),
      Teacher.find({ schoolId, dateOfBirth: { $regex: pattern } }).lean(),
    ]);

    const birthdays = [
      ...students.map(s => ({
        id:          s.id,
        name:        [s.firstName, s.lastName].filter(Boolean).join(' '),
        dateOfBirth: s.dateOfBirth,
        day:         parseInt(s.dateOfBirth?.split('-')[2] ?? 0, 10),
        type:        'student',
        meta:        s.className || s.class || s.stream || null,
        photoUrl:    s.photoUrl  || null,
      })),
      ...teachers.map(t => ({
        id:          t.id,
        name:        [t.title, t.firstName, t.lastName].filter(Boolean).join(' '),
        dateOfBirth: t.dateOfBirth,
        day:         parseInt(t.dateOfBirth?.split('-')[2] ?? 0, 10),
        type:        'staff',
        meta:        'Teacher',
        photoUrl:    null,
      })),
    ].filter(b => b.day > 0).sort((a, b) => a.day - b.day);

    res.json({ birthdays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/events/:id */
router.get('/:id', rbac('events', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const event = await _model('events').findOne({ id: req.params.id, schoolId }).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/events — create event */
router.post('/', rbac('events', 'create'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { title, description, startDate, endDate, allDay, type, category, location, color, audience,
            meetingLink, meetingPasscode, platform } = req.body;
    if (!title || !startDate) return res.status(400).json({ error: 'title and startDate are required' });

    const event = await _model('events').create({
      id: `evt_${uuidv4().slice(0, 8)}`,
      schoolId, title, description, location,
      startDate, endDate: endDate || startDate,
      allDay: allDay !== false,
      type: type || 'general',
      category: category || 'general',
      color: color || '#4f46e5',
      audience: audience || ['all'],
      // Online meeting fields (optional — only set for online_class events)
      ...(meetingLink     ? { meetingLink }     : {}),
      ...(meetingPasscode ? { meetingPasscode } : {}),
      ...(platform        ? { platform }        : {}),
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/events/:id — update event */
router.put('/:id', rbac('events', 'update'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
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
router.delete('/:id', rbac('events', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const result = await _model('events').deleteOne({ id: req.params.id, schoolId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
