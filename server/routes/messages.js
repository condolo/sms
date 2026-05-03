/* ============================================================
   InnoLearn — Messages Route
   /api/messages — In-app messaging & announcements
   Stored in MongoDB so messages persist across devices/sessions.
   Notification emails sent to recipients on every new message.
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const email    = require('../utils/email');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

const APP_URL = process.env.APP_URL || 'https://school-management-ecosystem.onrender.com';

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* ── Role → recipient group mapping ─────────────────────── */
const ROLE_GROUPS = {
  teachers: ['teacher', 'section_head', 'deputy_principal'],
  parents:  ['parent'],
  students: ['student'],
  staff:    ['teacher', 'section_head', 'deputy_principal', 'hr',
             'admissions_officer', 'finance', 'exams_officer', 'timetabler',
             'discipline_committee'],
};

/* ── GET /api/messages — list messages visible to this user ─ */
router.get('/', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.user;
    const { tab = 'inbox', page = 1, limit = 50 } = req.query;
    const Msg = _model('messages');

    let query;
    if (tab === 'sent') {
      query = { schoolId, senderId: userId };
    } else {
      // Inbox: messages addressed to 'all', user's role group, or directly to this user
      const groups = Object.entries(ROLE_GROUPS)
        .filter(([, roles]) => roles.includes(role))
        .map(([group]) => group);

      query = {
        schoolId,
        $or: [
          { recipients: 'all' },
          { recipients: { $in: groups } },
          { recipients: userId },
        ]
      };
    }

    const skip  = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const total = await Msg.countDocuments(query);
    const msgs  = await Msg.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      data: msgs,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/messages — create message + send email notifications ─ */
router.post('/', async (req, res) => {
  try {
    const { schoolId, userId, name: senderName, role: senderRole } = req.user;
    const { subject, body, recipients, type = 'direct' } = req.body;

    if (!subject || !body || !recipients) {
      return res.status(400).json({ error: 'subject, body, and recipients are required' });
    }

    const Msg  = _model('messages');
    const User = _model('users');

    const recipientList = Array.isArray(recipients) ? recipients : [recipients];

    const msg = await Msg.create({
      schoolId,
      senderId:   userId,
      senderName,
      senderRole,
      recipients: recipientList,
      subject,
      body,
      type, // 'direct' | 'announcement'
      isRead: {},
      createdAt: new Date().toISOString(),
    });

    /* ── Send email notifications to recipients ──────────── */
    const school    = req.school;
    const preview   = body.length > 160 ? body.substring(0, 157) + '…' : body;
    const isDirect  = type === 'direct';
    const notifyJobs = [];

    for (const recipient of recipientList) {
      if (recipient === 'all') {
        // Notify all active users in the school (except sender)
        const targets = await User.find({
          schoolId, isActive: true, id: { $ne: userId }
        }).lean();
        for (const u of targets) {
          if (u.email) {
            notifyJobs.push(email.sendMessageNotification({
              recipientName:  u.name,
              recipientEmail: u.email,
              senderName,
              subject,
              preview,
              schoolName: school.name,
              isDirect: false,
              appUrl: APP_URL,
            }));
          }
        }
      } else if (ROLE_GROUPS[recipient]) {
        // Notify members of a role group
        const roles   = ROLE_GROUPS[recipient];
        const targets = await User.find({
          schoolId, isActive: true,
          role: { $in: roles },
          id:   { $ne: userId }
        }).lean();
        for (const u of targets) {
          if (u.email) {
            notifyJobs.push(email.sendMessageNotification({
              recipientName:  u.name,
              recipientEmail: u.email,
              senderName,
              subject,
              preview,
              schoolName: school.name,
              isDirect: false,
              appUrl: APP_URL,
            }));
          }
        }
      } else {
        // Direct — single user by ID
        const target = await User.findOne({ id: recipient, schoolId }).lean();
        if (target?.email) {
          notifyJobs.push(email.sendMessageNotification({
            recipientName:  target.name,
            recipientEmail: target.email,
            senderName,
            subject,
            preview,
            schoolName: school.name,
            isDirect: true,
            appUrl: APP_URL,
          }));
        }
      }
    }

    // Fire emails non-blocking — don't hold up the response
    Promise.allSettled(notifyJobs).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) console.warn(`[MESSAGES] ${failed}/${notifyJobs.length} notification emails failed`);
    });

    res.status(201).json(msg.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── PATCH /api/messages/:id/read — mark as read ─────────── */
router.patch('/:id/read', async (req, res) => {
  try {
    const { schoolId, userId } = req.user;
    const Msg = _model('messages');
    const msg = await Msg.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { [`isRead.${userId}`]: true } },
      { new: true }
    ).lean();
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── DELETE /api/messages/:id — delete (sender or admin only) ─ */
router.delete('/:id', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.user;
    const Msg = _model('messages');
    const msg = await Msg.findOne({ id: req.params.id, schoolId }).lean();
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const canDelete = msg.senderId === userId ||
                      ['superadmin', 'admin', 'deputy_principal'].includes(role);
    if (!canDelete) return res.status(403).json({ error: 'You cannot delete this message' });

    await Msg.deleteOne({ id: req.params.id, schoolId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
