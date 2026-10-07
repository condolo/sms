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
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { moduleGate }       = require('../middleware/module-gate');
const email = require('../utils/email');
const notif = require('../utils/notif-settings');
const { enqueueBatch } = require('../utils/email-queue');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { schoolLoginUrl } = require('../utils/school-url');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware, moduleGate('messages'));


/* ── Role → recipient group mapping ─────────────────────── */
const ROLE_GROUPS = {
  teachers: ['teacher', 'section_head', 'deputy_principal'],
  parents:  ['parent'],
  students: ['student'],
  staff:    ['teacher', 'section_head', 'deputy_principal', 'hr',
             'admissions_officer', 'finance', 'exams_officer', 'timetabler',
             'discipline_committee'],
};

/* Inbox membership — a message addressed to 'all', this user's role
   group, or directly to them. Shared by GET / and GET /unread-count so
   the two can never drift on what "in my inbox" means. */
function _inboxQuery({ schoolId, userId, role }) {
  const groups = Object.entries(ROLE_GROUPS)
    .filter(([, roles]) => roles.includes(role))
    .map(([group]) => group);
  return {
    schoolId,
    $or: [
      { recipients: 'all' },
      { recipients: { $in: groups } },
      { recipients: userId },
    ],
  };
}

/* ── GET /api/messages/unread-count — bell badge count ───────
   Registered before GET /:id-shaped routes would matter — there are
   none in this file today (only PATCH /:id/read and DELETE /:id), so
   no path-shadowing risk, but kept right next to GET / since both
   share _inboxQuery(). */
router.get('/unread-count', rbac('messages', 'read'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const Msg = tenantModel('messages', tenantContext(req));
    const count = await Msg.countDocuments({
      ..._inboxQuery({ schoolId, userId, role }),
      [`isRead.${userId}`]: { $ne: true },
    });
    res.json({ data: { count } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── GET /api/messages — list messages visible to this user ─ */
router.get('/', rbac('messages', 'read'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { tab = 'inbox', page = 1, limit = 50 } = req.query;
    const Msg = tenantModel('messages', tenantContext(req));

    const query = tab === 'sent'
      ? { schoolId, senderId: userId }
      : _inboxQuery({ schoolId, userId, role });

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
    const { schoolId, userId, role: senderRole } = req.jwtUser;
    const senderUser = await tenantModel('users', tenantContext(req)).findOne({ id: userId, schoolId }).select('name email').lean();
    const senderName = req.jwtUser.name || senderUser?.name || senderUser?.email || 'School staff';
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
    // Links go to this school's own sign-in (or its organisation's), not the marketing site.
    const loginUrl    = await schoolLoginUrl(schoolId);

    // Check once whether email notifications are enabled for this school —
    // announcements and direct messages are separately configurable events
    // (each has its own toggle in Settings), so the check must key off the
    // actual event, not always 'new_message' regardless of type.
    const notifEventKey = isDirect ? 'new_message' : 'announcement';
    const emailEnabled = await notif.isEnabled(schoolId, notifEventKey, 'email');

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
              appUrl:      loginUrl,
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
              appUrl:      loginUrl,
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
            appUrl:      loginUrl,
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

/* ── DELETE /api/messages/:id — own message, or moderation grant ─ */
// MODERATE_FLOOR mirrors the exact set the old hardcoded check let through
// (['superadmin','admin','deputy_principal']) — zero regression for those
// three. Any OTHER role can now be granted the same moderation power
// explicitly via Settings → Roles & Permissions ("Delete Any Message"),
// enforced with hasExplicitSubGrant (no coarse-grant fallback) — holding
// 'Delete Own Messages' alone must not silently imply it.
const MODERATE_FLOOR = new Set(['superadmin', 'admin', 'deputy_principal']);
router.delete('/:id', rbac('messages', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const Msg = tenantModel('messages', tenantContext(req));
    const msg = await Msg.findOne({ id: req.params.id, schoolId }).lean();
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const canDelete = msg.senderId === userId ||
                      MODERATE_FLOOR.has(role) ||
                      await hasExplicitSubGrant(req, 'messages', 'moderate', 'delete');
    if (!canDelete) return res.status(403).json({ error: 'You cannot delete this message' });

    await Msg.deleteOne({ id: req.params.id, schoolId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
