/* ============================================================
   Msingi — Messages Route
   /api/messages — In-app messaging & announcements
   Stored in MongoDB so messages persist across devices/sessions.
   Notification emails sent to recipients on every new message.
   ============================================================ */
const express        = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware }   = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { rbac }             = require('../middleware/rbac');
const email = require('../utils/email');
const notif = require('../utils/notif-settings');
const { enqueueBatch } = require('../utils/email-queue');
const { tenantModel, tenantContext } = require('../utils/tenant-model');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

const APP_URL = process.env.APP_URL || 'https://msingi.io';

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
router.get('/', rbac('messages', 'read'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { tab = 'inbox', page = 1, limit = 50 } = req.query;
    const Msg = tenantModel('messages', tenantContext(req));

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

    // Enrich senderName for legacy messages that were stored without it
    const missingNameIds = [...new Set(msgs.filter(m => !m.senderName && m.senderId).map(m => m.senderId))];
    if (missingNameIds.length) {
      const User = tenantModel('users', tenantContext(req));
      const users = await User.find({ id: { $in: missingNameIds }, schoolId }).select('id name').lean();
      const nameMap = Object.fromEntries(users.map(u => [u.id, u.name]));
      msgs.forEach(m => { if (!m.senderName && m.senderId) m.senderName = nameMap[m.senderId] ?? null; });
    }

    res.json({
      data: msgs,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── POST /api/messages — create message + send email notifications ─ */
router.post('/', rbac('messages', 'create'), async (req, res) => {
  try {
    const { schoolId, userId, name: senderName, role: senderRole } = req.jwtUser;
    const { subject, body, recipients, type = 'direct' } = req.body;

    if (!subject || !body || !recipients) {
      return res.status(400).json({ error: 'subject, body, and recipients are required' });
    }

    const recipientList = Array.isArray(recipients) ? recipients : [recipients];

    // Only staff roles may broadcast to the entire school
    const BROADCAST_ROLES = new Set([
      'superadmin', 'admin', 'deputy_principal', 'deputy',
      'section_head', 'teacher', 'hr',
    ]);
    if (recipientList.includes('all') && !BROADCAST_ROLES.has(senderRole)) {
      return res.status(403).json({ error: 'Only staff members may send school-wide announcements.' });
    }

    const Msg  = tenantModel('messages', tenantContext(req));
    const User = tenantModel('users', tenantContext(req));

    const msg = await Msg.create({
      id:         uuidv4(),
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
    const school      = req.school;
    const schoolEmail = school.systemEmail || '';
    const preview     = body.length > 160 ? body.substring(0, 157) + '…' : body;
    const isDirect    = type === 'direct';
    const notifyJobs  = [];

    // Check once whether email notifications are enabled for this school
    const emailEnabled = await notif.isEnabled(schoolId, 'new_message', 'email');

    for (const recipient of recipientList) {
      if (recipient === 'all') {
        // Notify all active users in the school (except sender)
        const targets = await User.find({
          schoolId, isActive: true, id: { $ne: userId }
        }).lean();
        for (const u of targets) {
          if (u.email && emailEnabled) {
            // Push a thunk — function not yet called — so enqueueBatch
            // can control when each batch of SMTP calls fires.
            notifyJobs.push(() => email.sendMessageNotification({
              recipientName:  u.name,
              recipientEmail: u.email,
              senderName,
              subject,
              preview,
              schoolName:  school.name,
              schoolEmail,
              schoolId,
              isDirect:    false,
              appUrl:      APP_URL,
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
          if (u.email && emailEnabled) {
            notifyJobs.push(() => email.sendMessageNotification({
              recipientName:  u.name,
              recipientEmail: u.email,
              senderName,
              subject,
              preview,
              schoolName:  school.name,
              schoolEmail,
              schoolId,
              isDirect:    false,
              appUrl:      APP_URL,
            }));
          }
        }
      } else {
        // Direct — single user by ID
        const target = await User.findOne({ id: recipient, schoolId }).lean();
        if (target?.email && emailEnabled) {
          notifyJobs.push(() => email.sendMessageNotification({
            recipientName:  target.name,
            recipientEmail: target.email,
            senderName,
            subject,
            preview,
            schoolName:  school.name,
            schoolEmail,
            schoolId,
            isDirect:    true,
            appUrl:      APP_URL,
          }));
        }
      }
    }

    // Fire emails non-blocking in batches of EMAIL_BATCH_SIZE (default 20)
    // with EMAIL_BATCH_DELAY_MS (default 1500 ms) between batches.
    // Prevents bursting into Gmail's sending limits on school-wide announcements.
    enqueueBatch(notifyJobs).catch(err =>
      console.error('[messages] email queue error:', err)
    );

    res.status(201).json(msg.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── PATCH /api/messages/:id/read — mark as read ─────────── */
router.patch('/:id/read', rbac('messages', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Msg = tenantModel('messages', tenantContext(req));
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
router.delete('/:id', rbac('messages', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const Msg = tenantModel('messages', tenantContext(req));
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
