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
const push  = require('../utils/push');
const { enqueueBatch } = require('../utils/email-queue');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { schoolLoginUrl } = require('../utils/school-url');
const { _model } = require('../utils/model');
const { ROLE_GROUPS, AUDIENCE_KEYS, namedRecipients, recipientSummary } = require('../utils/message-audience');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware, moduleGate('messages'));


/* Portal roles: they may only message staff directly (never another
   parent/student they were not explicitly linked to), and they cannot
   create saved groups or broadcast announcements. Staff roles are every
   role outside this set, including custom roles built on a staff base. */
const PORTAL_ROLES = new Set(['parent', 'guardian', 'student']);

const BROADCAST_ROLES = new Set([
  'superadmin', 'admin', 'principal', 'deputy_principal', 'deputy',
  'section_head', 'teacher', 'hr',
]);

/* Roles that may manage a saved group they did not create. */
const GROUP_MANAGER_ROLES = new Set([
  'superadmin', 'admin', 'principal', 'deputy_principal', 'deputy',
]);

function _cleanIdList(value) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(
    list
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => v.trim()),
  )];
}

function _roleLabel(role) {
  if (!role) return '';
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* Resolve a group's memberIds into display-ready members. Groups are
   intentionally small (a class, a department, a committee), so one
   lookup per listing is cheaper and clearer than a populate that would
   bypass tenantModel's scoping. */
async function _hydrateGroups(req, groups) {
  const ids = [...new Set(groups.flatMap(g => g.memberIds ?? []))];
  const User = tenantModel('users', tenantContext(req));
  const users = ids.length
    ? await User.find({ id: { $in: ids } }).select('id name role isActive').lean()
    : [];
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  return groups.map(g => ({
    ...g,
    members: (g.memberIds ?? []).map(id => ({
      id,
      name: byId[id]?.name ?? 'Removed user',
      role: byId[id]?.role ?? '',
      roleLabel: _roleLabel(byId[id]?.role),
      isActive: byId[id]?.isActive !== false,
    })),
    memberCount: (g.memberIds ?? []).length,
  }));
}

function _canManageGroup(group, { userId, role }) {
  return group.createdBy === userId || GROUP_MANAGER_ROLES.has(role);
}

/* Validate explicit direct recipients against the tenant's active users
   and the sender's role. Returns { users } on success or { status, error }
   so callers can return a precise 4xx instead of creating a message that
   is invisible to everyone (an arbitrary/stale user id). */
async function _resolveDirectRecipients(req, rawRecipients) {
  const { userId, role } = req.jwtUser;
  const ids = _cleanIdList(rawRecipients).filter(id => id !== userId);
  if (!ids.length) {
    return { status: 400, error: 'Choose at least one recipient other than yourself.' };
  }

  const User = tenantModel('users', tenantContext(req));
  const users = await User.find({
    id: { $in: ids },
    isActive: { $ne: false },
  }).select('id name role email').lean();

  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  const missing = ids.filter(id => !byId[id]);
  if (missing.length) {
    return { status: 400, error: 'One or more recipients are invalid or inactive.' };
  }

  if (PORTAL_ROLES.has(role)) {
    const disallowed = users.find(u => PORTAL_ROLES.has(u.role));
    if (disallowed) {
      return { status: 403, error: 'Parents and students can only message staff members.' };
    }
  }

  return { users: ids.map(id => byId[id]), ids };
}

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

/* ── GET /api/messages/recipients — compose-time people directory ──
   Deliberately separate from Settings → Users (which requires settings
   read): a teacher or parent composing a message needs name/role only,
   never emails, account flags or credentials. Portal roles are always
   restricted to staff, regardless of what scope they ask for. */
router.get('/recipients', rbac('messages', 'read'), async (req, res) => {
  try {
    const { userId, role } = req.jwtUser;
    const User = tenantModel('users', tenantContext(req));
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const scope = PORTAL_ROLES.has(role) ? 'staff' : (req.query.scope || 'all');
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));

    const filter = {
      isActive: { $ne: false },
      id: { $ne: userId },
    };

    if (scope === 'staff') {
      filter.role = { $nin: [...PORTAL_ROLES] };
    } else if (scope === 'parents') {
      filter.role = { $in: ['parent', 'guardian'] };
    } else if (scope === 'students') {
      filter.role = 'student';
    }

    if (q) {
      const { escapeRegex } = require('../utils/escape-regex');
      filter.name = new RegExp(escapeRegex(q), 'i');
    }

    const users = await User.find(filter)
      .select('id name role')
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    res.json({
      data: users.map(u => ({
        id: u.id,
        name: u.name || 'Unnamed user',
        role: u.role,
        roleLabel: _roleLabel(u.role),
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Saved groups ─────────────────────────────────────────────
   A group is a reusable recipient list, not a chat room: sending to it
   stamps each message with groupId/groupName so the inbox can show the
   group badge, while recipients still get an ordinary direct message
   addressed to their userId (which keeps email + unread semantics
   identical to every other direct message in the app). */

/* GET /api/messages/groups — groups I belong to or created */
router.get('/groups', rbac('messages', 'read'), async (req, res) => {
  try {
    const { userId } = req.jwtUser;
    const Groups = tenantModel('message_groups', tenantContext(req));
    const groups = await Groups.find({
      $or: [{ createdBy: userId }, { memberIds: userId }],
    }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    res.json({ data: await _hydrateGroups(req, groups) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/messages/groups — create a reusable group */
router.post('/groups', rbac('messages', 'create'), async (req, res) => {
  try {
    const { userId, role } = req.jwtUser;
    if (PORTAL_ROLES.has(role)) {
      return res.status(403).json({ error: 'Only staff can create saved groups. You can still message several people directly.' });
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Group name is required.' });
    if (name.length > 80) return res.status(400).json({ error: 'Group name must be 80 characters or fewer.' });

    const memberIds = _cleanIdList(req.body.memberIds).filter(id => id !== userId);
    if (!memberIds.length) {
      return res.status(400).json({ error: 'Add at least one member to the group.' });
    }

    const User = tenantModel('users', tenantContext(req));
    const members = await User.find({
      id: { $in: memberIds },
      isActive: { $ne: false },
    }).select('id').lean();
    if (members.length !== memberIds.length) {
      return res.status(400).json({ error: 'One or more group members are invalid or inactive.' });
    }

    const sender = await User.findOne({ id: userId }).select('name').lean();
    const Groups = tenantModel('message_groups', tenantContext(req));
    const now = new Date().toISOString();
    const group = await Groups.create({
      id: uuidv4(),
      createdBy: userId,
      createdByName: sender?.name ?? 'Staff member',
      name,
      memberIds,
      createdAt: now,
      updatedAt: now,
    });

    const [hydrated] = await _hydrateGroups(req, [group.toObject()]);
    res.status(201).json({ data: hydrated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PATCH /api/messages/groups/:id — rename or change membership */
router.patch('/groups/:id', rbac('messages', 'update'), async (req, res) => {
  try {
    const { userId, role } = req.jwtUser;
    const Groups = tenantModel('message_groups', tenantContext(req));
    const group = await Groups.findOne({ id: req.params.id }).lean();
    if (!group) return res.status(404).json({ error: 'Group not found.' });
    if (!_canManageGroup(group, { userId, role })) {
      return res.status(403).json({ error: 'Only the group creator or an administrator can edit this group.' });
    }

    const patch = { updatedAt: new Date().toISOString() };
    if (req.body.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Group name is required.' });
      if (name.length > 80) return res.status(400).json({ error: 'Group name must be 80 characters or fewer.' });
      patch.name = name;
    }

    if (req.body.memberIds !== undefined) {
      const memberIds = _cleanIdList(req.body.memberIds).filter(id => id !== userId);
      if (!memberIds.length) {
        return res.status(400).json({ error: 'A group needs at least one member.' });
      }
      const User = tenantModel('users', tenantContext(req));
      const members = await User.find({
        id: { $in: memberIds },
        isActive: { $ne: false },
      }).select('id').lean();
      if (members.length !== memberIds.length) {
        return res.status(400).json({ error: 'One or more group members are invalid or inactive.' });
      }
      patch.memberIds = memberIds;
    }

    const updated = await Groups.findOneAndUpdate(
      { id: req.params.id },
      { $set: patch },
      { new: true },
    ).lean();
    const [hydrated] = await _hydrateGroups(req, [updated]);
    res.json({ data: hydrated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/messages/groups/:id */
router.delete('/groups/:id', rbac('messages', 'delete'), async (req, res) => {
  try {
    const { userId, role } = req.jwtUser;
    const Groups = tenantModel('message_groups', tenantContext(req));
    const group = await Groups.findOne({ id: req.params.id }).lean();
    if (!group) return res.status(404).json({ error: 'Group not found.' });
    if (!_canManageGroup(group, { userId, role })) {
      return res.status(403).json({ error: 'Only the group creator or an administrator can delete this group.' });
    }
    await Groups.deleteOne({ id: req.params.id });
    res.json({ success: true });
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

    /* Direct and group messages store userIds in `recipients`; the old
       client could only render role labels ("Direct"), so a multi-person
       message looked identical to a one-person one. Resolve those ids to
       name/role once for the whole page, and expose a stable
       recipientUsers array the compose/detail UI can render as chips. */
    const directIds = [...new Set(msgs.flatMap(m => namedRecipients(m)))];
    const byId = directIds.length
      ? Object.fromEntries(
          (await tenantModel('users', tenantContext(req))
            .find({ id: { $in: directIds } }).select('id name role isActive').lean())
            .map(u => [u.id, u]),
        )
      : {};
    msgs.forEach(m => {
      Object.assign(m, recipientSummary(m), {
        recipientUsers: namedRecipients(m).map(id => ({
          id,
          name: byId[id]?.name ?? 'Removed user',
          role: byId[id]?.role ?? '',
          roleLabel: _roleLabel(byId[id]?.role),
          isActive: byId[id]?.isActive !== false,
        })),
        /* The web badge means "went out via a saved group" specifically, and
           a plain multi-person send is labelled there from recipientCount;
           `multiRecipient` is the wider question the portal/mobile rows ask —
           three people is multi-person even when no group exists. */
        isGroup: Boolean(m.groupId),
      });
    });

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
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const type = req.body.type === 'announcement' ? 'announcement' : 'direct';
    const groupId = typeof req.body.groupId === 'string' ? req.body.groupId.trim() : '';

    if (!subject || !body) {
      return res.status(400).json({ error: 'A subject and message body are required.' });
    }
    if (subject.length > 200) {
      return res.status(400).json({ error: 'Subject must be 200 characters or fewer.' });
    }
    if (body.length > 10_000) {
      return res.status(400).json({ error: 'Message must be 10,000 characters or fewer.' });
    }

    const Msg  = tenantModel('messages', tenantContext(req));
    const User = tenantModel('users', tenantContext(req));

    let recipientList = [];
    let group = null;
    let directRecipientUsers = [];

    if (groupId) {
      /* A group send is a direct message to each current member — never a
         broadcast. Membership is re-read at send time so a renamed or
         re-scoped group cannot keep sending to stale recipients. */
      const Groups = tenantModel('message_groups', tenantContext(req));
      group = await Groups.findOne({ id: groupId }).lean();
      if (!group) return res.status(404).json({ error: 'Group not found.' });
      if (!_canManageGroup(group, { userId, role: senderRole }) && !(group.memberIds ?? []).includes(userId)) {
        return res.status(403).json({ error: 'You are not a member of this group.' });
      }
      const resolved = await _resolveDirectRecipients(req, group.memberIds ?? []);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      directRecipientUsers = resolved.users;
      recipientList = resolved.ids;
    } else if (type === 'announcement') {
      if (!BROADCAST_ROLES.has(senderRole)) {
        return res.status(403).json({ error: 'Only staff members may send announcements.' });
      }
      recipientList = _cleanIdList(req.body.recipients);
      if (!recipientList.length) {
        return res.status(400).json({ error: 'Choose an audience for the announcement.' });
      }
      const invalid = recipientList.find(r => !AUDIENCE_KEYS.has(r));
      if (invalid) {
        return res.status(400).json({ error: `Unknown audience "${invalid}". Choose Everyone, Teachers, Parents, Students, or Staff.` });
      }
      if (recipientList.includes('all') && PORTAL_ROLES.has(senderRole)) {
        return res.status(403).json({ error: 'Only staff members may send school-wide announcements.' });
      }
    } else {
      const resolved = await _resolveDirectRecipients(req, req.body.recipients);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      directRecipientUsers = resolved.users;
      recipientList = resolved.ids;
    }

    if (!recipientList.length) {
      return res.status(400).json({ error: 'Choose at least one recipient.' });
    }

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
      ...(group ? { groupId: group.id, groupName: group.name } : {}),
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
    const pushEnabled  = await notif.isEnabled(schoolId, notifEventKey, 'push');
    /* Collected separately from notifyJobs: that list is gated on the
       recipient having an email address, and push must not inherit that. */
    const pushTargetIds = new Set();

    for (const recipient of recipientList) {
      if (recipient === 'all') {
        // Notify all active users in the school (except sender)
        const targets = await User.find({
          schoolId, isActive: true, id: { $ne: userId }
        }).lean();
        for (const u of targets) pushTargetIds.add(u.id);
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
        for (const u of targets) pushTargetIds.add(u.id);
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
        // Direct / group — already validated and loaded above
        const target = directRecipientUsers.find(u => u.id === recipient);
        if (target?.id && target.id !== userId) pushTargetIds.add(target.id);
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

    /* One push per recipient, not one per message: sendToUsers takes the whole
       list and does a single FCM multicast. A school-wide announcement to 600
       parents is one request to FCM, not 600. */
    if (pushEnabled && pushTargetIds.size) {
      push.sendToUsers({
        schoolId,
        userIds: [...pushTargetIds],
        title:   isDirect ? (subject || 'New message') : (subject || school?.name || 'Notice from school'),
        body:    preview,
        data:    { type: isDirect ? 'message' : 'notice', messageId: msg.id },
      }).catch(err => console.error('[messages] push error:', err.message));
    }

    res.status(201).json(msg.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Shared helper: create a message + notify a small, explicit list of
   direct recipients by email. Extracted for parent-portal.js's own
   send route (parent-message-recipients.js resolves a category to a
   short, real userId list — never 'all'/a role group, so only this
   "direct" notification shape ever applies there) rather than
   duplicating the create+notify logic a second time. */
async function createDirectMessage(req, { recipientUserIds, subject, body, senderName, senderRole, type = 'direct' }) {
  const { schoolId, userId } = req.jwtUser;
  const Msg  = tenantModel('messages', tenantContext(req));
  const User = tenantModel('users', tenantContext(req));

  const msg = await Msg.create({
    id: uuidv4(), schoolId, senderId: userId, senderName, senderRole,
    recipients: recipientUserIds, subject, body, type, isRead: {},
    createdAt: new Date().toISOString(),
  });

  const school = req.school ?? await _model('schools').findOne({ id: schoolId }).lean();
  const schoolEmail = school?.systemEmail || '';
  const preview = body.length > 160 ? body.substring(0, 157) + '…' : body;
  const loginUrl = await schoolLoginUrl(schoolId);
  const emailEnabled = await notif.isEnabled(schoolId, 'new_message', 'email');

  const targets = await User.find({ schoolId, id: { $in: recipientUserIds } }).select('id name email').lean();
  const notifyJobs = [];
  for (const u of targets) {
    if (u.id === userId || !u.email || !emailEnabled) continue;
    notifyJobs.push(() => email.sendMessageNotification({
      recipientName: u.name, recipientEmail: u.email, senderName, subject, preview,
      schoolName: school?.name, schoolEmail, schoolId, isDirect: true, appUrl: loginUrl,
    }));
  }
  enqueueBatch(notifyJobs).catch(err => console.error('[messages] email queue error:', err));

  /* Push for a direct message. Kept OUT of the email loop above on purpose:
     that loop skips anyone without an email address, and a parent with no
     inbox is exactly who a push serves. Non-blocking, like the email queue. */
  const pushOn = await notif.isEnabled(schoolId, 'new_message', 'push');
  if (pushOn) {
    push.sendToUsers({
      schoolId,
      userIds: recipientUserIds.filter(id => id !== userId),
      title:   subject || 'New message',
      body:    preview,
      data:    { type: 'message', senderId: userId, senderRole: senderRole || 'parent' },
    }).catch(err => console.error('[messages] push error:', err.message));
  }

  return msg.toObject();
}

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
// Reused by parent-portal.js's family-summary unread count — same
// inbox-membership definition, not a second one that can drift from
// this one (see that file's own fix note, 2026-10-13: it previously
// queried recipientId/readAt, fields this collection has never had —
// messages actually use `recipients` + `isRead.${userId}`).
module.exports._inboxQuery = _inboxQuery;
// Reused by parent-portal.js's parent-safe compose route — see
// createDirectMessage's own header comment for why this is shared
// rather than reimplemented.
module.exports.createDirectMessage = createDirectMessage;
