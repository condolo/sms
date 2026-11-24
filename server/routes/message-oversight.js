/* ============================================================
   Message oversight  (v5.281.0)  — /api/messages/oversight

   Asked for 2026-11-24: let a school assign someone (e.g. the admissions
   office) to check messages between families and staff and remind a
   teacher to respond.

   Permission: the "Read All Messages (Oversight)" row — messages__oversight,
   View. Strict: no general Messages right implies it, no role has it by
   default, and it is off for the whole school until at least one role or
   person is ticked. A super admin (who holds every row) also gets it only
   then. A tick on a parent or student role counts for nothing.

   What it can see: one-to-one conversations between a parent, guardian or
   student and a member of staff. What it can not see:
     - staff-to-staff messages, announcements, group sends, system notices;
     - replies on behaviour entries (they keep their own access rules);
     - conversations with a counsellor, nurse or similar (by role, or by a
       tag in Staff Roles & Responsibilities);
     - conversations with school leadership, unless the reader is an admin
       or the principal;
     - the reader's own conversations (they are in their inbox already).

   It only reads: nothing is marked as read, nothing can be changed or
   answered. Opening a conversation and sending a reminder are written to
   the audit log. Attachments show by name only.

   Mounted inside routes/messages.js (auth, tenant and module gate apply).
   ============================================================ */
'use strict';

const express = require('express');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { _loadPerms, _loadUserPerms } = require('../middleware/rbac');
const { AUDIENCE_KEYS } = require('../utils/message-audience');
const { createSystemMessage } = require('../utils/notify-dispatch');
const { schoolLoginUrl } = require('../utils/school-url');
const { _model } = require('../utils/model');
const AuditService = require('../services/audit');
const notif = require('../utils/notif-settings');
const push  = require('../utils/push');
const email = require('../utils/email');

const router = express.Router();

const KEY = 'messages__oversight';
const PORTAL_ROLES    = new Set(['parent', 'guardian', 'student']);
// The last two are responsibility tags (config/staffResponsibilities.js).
const LEADERSHIP      = new Set(['superadmin', 'admin', 'principal', 'deputy_principal', 'deputy', 'acting_deputy', 'head_of_school']);
const LEADERSHIP_READERS = new Set(['superadmin', 'admin', 'principal']);
/* Roles and responsibility tags are the school's own words, so matched by word. */
const CONFIDENTIAL    = /counsel|psycholog|safeguard|chaplain|clinic|medical|nurse(?!ry)/i;
const REMINDER_EVENT  = 'message_reply_reminder';
const REMIND_EVERY_MS = 12 * 3600_000;
const DAY_MS    = 86_400_000;
const MAX_DAYS  = 90;
const MAX_ROWS  = 5000;
const PAGE_SIZE = 30;

const rolesOf = (u) => [...new Set([u?.role, ...(Array.isArray(u?.roles) ? u.roles : [])].filter(r => typeof r === 'string' && r))];
const isFamilyRole = (role) => PORTAL_ROLES.has(role);
const fail = (res, status, error) => res.status(status).json({ error });

/* Has this school ticked the row for any staff role or person? */
async function _schoolUsesOversight(req) {
  const rows = await tenantModel('role_permissions', tenantContext(req))
    .find({ schoolId: req.jwtUser.schoolId, [`permissions.${KEY}`]: 'read' }).select('roleKey userId').lean();
  return (rows || []).some(r => r.userId || (r.roleKey && !isFamilyRole(r.roleKey)));
}

async function _mayOversee(req) {
  const { schoolId, userId } = req.jwtUser;
  const staffRoles = rolesOf(req.jwtUser).filter(r => !isFamilyRole(r));
  if (!schoolId || !userId || !staffRoles.length) return false;
  if (!(await _schoolUsesOversight(req))) return false;
  if (staffRoles.includes('superadmin')) return true;
  // A personal setting wins over the role, as everywhere else (rbac.js).
  const own = await _loadUserPerms(schoolId, userId);
  if (Array.isArray(own?.[KEY])) return own[KEY].includes('read');
  for (const role of staffRoles) {
    const perms = await _loadPerms(schoolId, role);
    if (Array.isArray(perms?.[KEY]) && perms[KEY].includes('read')) return true;
  }
  return false;
}

async function _guard(req, res, next) {
  try {
    if (await _mayOversee(req)) return next();
    return fail(res, 403, 'You have not been given "Read All Messages (Oversight)". Ask an administrator.');
  } catch (err) {
    console.error('[message-oversight guard]', err.message);
    return fail(res, 500, 'Could not check your permission.');
  }
}

/* Person-to-person messages only, newest first. */
function _eligible(schoolId, extra = {}) {
  return {
    schoolId,
    type: { $ne: 'announcement' },
    senderRole: { $ne: 'system' },
    kind: { $ne: 'system' },
    behaviourThread: null,
    groupId: null,
    ...extra,
  };
}
const FIELDS = 'id senderId senderName senderRole recipients childName createdAt';

async function _users(req, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await tenantModel('users', tenantContext(req))
    .find({ schoolId: req.jwtUser.schoolId, id: { $in: list } }).select('id name role roles email isActive').lean();
  const out = Object.fromEntries(rows.map(u => [u.id, u]));
  const staff = await tenantModel('teachers', tenantContext(req))
    .find({ schoolId: req.jwtUser.schoolId, userId: { $in: list } }).select('userId extraRoles').lean();
  // A tag the school made itself is stored by value; its wording is the label.
  const school = await _model('schools').findOne({ id: req.jwtUser.schoolId }).select('staffResponsibilities').lean();
  const label = Object.fromEntries((school?.staffResponsibilities ?? []).map(r => [r.value, r.label]));
  for (const t of staff || []) {
    if (!out[t.userId]) continue;
    out[t.userId].tags = (Array.isArray(t.extraRoles) ? t.extraRoles : []).flatMap(x => [x, label[x]]).filter(x => typeof x === 'string');
  }
  return out;
}

function _staffVisibleTo(req, staffUser) {
  const roles = rolesOf(staffUser);
  const known = [...roles, ...(staffUser.tags || [])];
  if (known.some(r => CONFIDENTIAL.test(r))) return false;
  if (known.some(r => LEADERSHIP.has(r))) return rolesOf(req.jwtUser).some(r => LEADERSHIP_READERS.has(r));
  return true;
}

const _named = (m) => (Array.isArray(m.recipients) ? m.recipients : []).filter(r => typeof r === 'string' && r && !AUDIENCE_KEYS.has(r));
const _at = (m) => new Date(m.createdAt || 0).getTime();

/* Pairs (family person, staff person) from a list of messages, oldest first.
   A message to several staff belongs to each of those pairs, but any one of
   them answering settles it. */
function _pairs(messages, users) {
  const pairs = new Map();
  const add = (familyId, staffId, m, from) => {
    const k = `${staffId}|${familyId}`;
    if (!pairs.has(k)) pairs.set(k, { familyId, staffId, messages: [] });
    pairs.get(k).messages.push({ m, from });
  };
  const staffish = (id) => users[id] && rolesOf(users[id]).some(r => !isFamilyRole(r));

  // Written as family: the sender used a parent or student portal.
  for (const m of messages) {
    if (!isFamilyRole(m.senderRole)) continue;
    for (const id of _named(m)) if (id !== m.senderId && staffish(id)) add(m.senderId, id, m, 'family');
  }
  // Written by staff to one person, who is family — or who wrote as family.
  for (const m of messages) {
    if (!m.senderId || isFamilyRole(m.senderRole) || !staffish(m.senderId)) continue;
    const to = _named(m);
    if (to.length !== 1) continue;
    const known = pairs.has(`${m.senderId}|${to[0]}`);
    if (known || (users[to[0]] && !staffish(to[0]))) add(to[0], m.senderId, m, 'staff');
  }
  for (const p of pairs.values()) p.messages.sort((a, b) => _at(a.m) - _at(b.m));

  for (const p of pairs.values()) {
    const last = p.messages[p.messages.length - 1];
    p.waitingSince = null;
    if (last.from !== 'family') continue;
    const others = _named(last.m).filter(id => id !== p.staffId);
    const answered = others.some(id => (pairs.get(`${id}|${p.familyId}`)?.messages || [])
      .some(x => x.from === 'staff' && _at(x.m) > _at(last.m)));
    if (answered) continue;
    // Waiting since the first family message after the last staff reply.
    let i = p.messages.length - 1;
    while (i > 0 && p.messages[i - 1].from === 'family') i -= 1;
    p.waitingSince = p.messages[i].m.createdAt;
  }
  return pairs;
}

async function _load(req, extra, limit = MAX_ROWS) {
  return (await tenantModel('messages', tenantContext(req))
    .find(_eligible(req.jwtUser.schoolId, extra)).sort({ createdAt: -1 }).limit(limit).select(FIELDS).lean()) || [];
}

function _visible(req, p, users) {
  const me = req.jwtUser.userId;
  return p.staffId !== me && p.familyId !== me && users[p.staffId] && _staffVisibleTo(req, users[p.staffId]);
}

async function _lastReminders(req, staffIds) {
  if (!staffIds.length) return {};
  const rows = await tenantModel('messages', tenantContext(req)).find({
    schoolId: req.jwtUser.schoolId, systemEventKey: REMINDER_EVENT, recipients: { $in: staffIds },
  }).sort({ createdAt: -1 }).limit(500).select('recipients reminderFamilyId reminderByName createdAt').lean();
  const out = {};
  for (const r of rows || []) {
    const k = `${_named(r)[0]}|${r.reminderFamilyId}`;
    if (!out[k]) out[k] = { at: r.createdAt, by: r.reminderByName || null };
  }
  return out;
}

const _familyLabel = (u, fallback) => u?.name || fallback || 'Removed user';
const _roleLabel = (r) => (r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/* GET /status — does this school use oversight, and may I? Everyone may ask:
   it is what shows families and staff that their messages can be read. */
router.get('/status', async (req, res) => { // rbac: open to every signed-in user — tells people oversight is on; returns two booleans
  try {
    const enabled = await _schoolUsesOversight(req);
    res.json({ data: { enabled, canRead: enabled && await _mayOversee(req) } });
  } catch (err) {
    console.error('[message-oversight status]', err.message);
    fail(res, 500, 'Could not check message oversight.');
  }
});

/* GET /conversations?status=waiting|all&days=30&search=&page=1 */
router.get('/conversations', _guard, async (req, res) => { // rbac: _guard — explicit messages__oversight only
  try {
    const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || 30));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const waitingOnly = req.query.status !== 'all';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 80) : '';

    const messages = await _load(req, { createdAt: { $gte: new Date(Date.now() - days * DAY_MS).toISOString() } });
    const users = await _users(req, messages.flatMap(m => [m.senderId, ..._named(m)]));
    let list = [..._pairs(messages, users).values()].filter(p => _visible(req, p, users));
    const waiting = list.filter(p => p.waitingSince).length;

    let rows = list.filter(p => !waitingOnly || p.waitingSince).map(p => {
      const last = p.messages[p.messages.length - 1];
      const fromFamily = p.messages.filter(x => x.from === 'family');
      return {
        staffId: p.staffId,
        staffName: users[p.staffId].name || 'Staff',
        staffRole: _roleLabel(users[p.staffId].role),
        staffActive: users[p.staffId].isActive !== false,
        familyId: p.familyId,
        familyName: _familyLabel(users[p.familyId], fromFamily[0]?.m.senderName),
        familyRole: _roleLabel(isFamilyRole(users[p.familyId]?.role) ? users[p.familyId].role : 'parent'),
        childName: [...p.messages].reverse().map(x => x.m.childName).find(Boolean) || null,
        messages: p.messages.length,
        lastAt: last.m.createdAt,
        lastFrom: last.from,
        waitingSince: p.waitingSince,
        waitingHours: p.waitingSince ? Math.floor((Date.now() - new Date(p.waitingSince).getTime()) / 3600_000) : null,
      };
    });
    if (search) rows = rows.filter(r => [r.staffName, r.familyName, r.childName].some(v => (v || '').toLowerCase().includes(search)));
    rows.sort((a, b) => (waitingOnly ? new Date(a.waitingSince) - new Date(b.waitingSince) : new Date(b.lastAt) - new Date(a.lastAt)));

    const total = rows.length;
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const reminders = await _lastReminders(req, [...new Set(slice.map(r => r.staffId))]);
    for (const r of slice) r.lastReminder = reminders[`${r.staffId}|${r.familyId}`] || null;

    res.json({
      data: slice,
      summary: { waiting, conversations: list.length, days, truncated: messages.length >= MAX_ROWS },
      pagination: { total, page, limit: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
    });
  } catch (err) {
    console.error('[message-oversight conversations]', err.message);
    fail(res, 500, 'Could not load conversations.');
  }
});

/* One conversation the reader may see, or null. */
async function _conversation(req, staffId, familyId) {
  const messages = await _load(req, {
    createdAt: { $gte: new Date(Date.now() - 365 * DAY_MS).toISOString() },
    $or: [{ senderId: familyId }, { recipients: familyId }],
  }, 1000);
  const users = await _users(req, [staffId, familyId, ...messages.flatMap(m => [m.senderId, ..._named(m)])]);
  const pair = _pairs(messages, users).get(`${staffId}|${familyId}`);
  return pair && _visible(req, pair, users) ? { pair, users } : null;
}

/* GET /conversations/:staffId/:familyId — read it. Logged; marks nothing read. */
router.get('/conversations/:staffId/:familyId', _guard, async (req, res) => { // rbac: _guard — explicit messages__oversight only
  try {
    const { staffId, familyId } = req.params;
    const found = await _conversation(req, staffId, familyId);
    if (!found) return fail(res, 404, 'Conversation not found');
    const { pair, users } = found;
    await AuditService.log({
      action: 'messages.oversight_read', actor: req.jwtUser, schoolId: req.jwtUser.schoolId,
      target: { type: 'conversation', id: `${staffId}:${familyId}`, label: `${users[staffId]?.name || staffId} / ${users[familyId]?.name || familyId}` },
      details: { staffId, familyId, messages: pair.messages.length }, req,
    });
    const ids = pair.messages.map(x => x.m.id);
    const bodies = await tenantModel('messages', tenantContext(req))
      .find({ schoolId: req.jwtUser.schoolId, id: { $in: ids } }).select('id subject body attachment').lean();
    const byId = Object.fromEntries(bodies.map(b => [b.id, b]));
    const reminders = await _lastReminders(req, [staffId]);
    res.json({ data: {
      staffId, familyId,
      staffName: users[staffId]?.name || 'Staff', staffRole: _roleLabel(users[staffId]?.role), staffActive: users[staffId]?.isActive !== false,
      familyName: _familyLabel(users[familyId], pair.messages.find(x => x.from === 'family')?.m.senderName),
      waitingSince: pair.waitingSince,
      lastReminder: reminders[`${staffId}|${familyId}`] || null,
      messages: pair.messages.map(({ m, from }) => ({
        id: m.id, from, at: m.createdAt, childName: m.childName || null,
        subject: byId[m.id]?.subject || '', body: byId[m.id]?.body || '',
        attachmentName: byId[m.id]?.attachment?.name || null,
      })),
    } });
  } catch (err) {
    console.error('[message-oversight conversation]', err.message);
    fail(res, 500, 'Could not load this conversation.');
  }
});

/* POST /conversations/:staffId/:familyId/remind — ask the staff member to
   reply. Fixed wording, no message text. At most one per conversation per
   12 hours, and only while the family is waiting. */
router.post('/conversations/:staffId/:familyId/remind', _guard, async (req, res) => { // rbac: _guard — explicit messages__oversight only
  try {
    const { staffId, familyId } = req.params;
    const { schoolId, userId, role } = req.jwtUser;
    const ctx = tenantContext(req);
    const found = await _conversation(req, staffId, familyId);
    if (!found) return fail(res, 404, 'Conversation not found');
    const { pair, users } = found;
    if (!pair.waitingSince) return fail(res, 409, 'This message has already been answered.');
    const staff = users[staffId];
    if (staff.isActive === false) return fail(res, 409, 'This staff account is no longer active.');
    const last = (await _lastReminders(req, [staffId]))[`${staffId}|${familyId}`];
    if (last && Date.now() - new Date(last.at).getTime() < REMIND_EVERY_MS) {
      return fail(res, 429, 'A reminder was already sent in the last 12 hours.');
    }

    const me = (await _users(req, [userId]))[userId];
    const byName = me?.name || req.jwtUser.name || _roleLabel(role);
    const familyName = _familyLabel(users[familyId], pair.messages.find(x => x.from === 'family')?.m.senderName);
    const child = [...pair.messages].reverse().map(x => x.m.childName).find(Boolean);
    const since = new Date(pair.waitingSince).toISOString().slice(0, 10);
    const subject = `Reminder: ${familyName} is waiting for your reply`;
    const body = `${familyName}${child ? ` (about ${child})` : ''} wrote to you on ${since} and is waiting for a reply. Please open your messages and answer. Reminder sent by ${byName}.`;

    const doc = await createSystemMessage({
      ctx, schoolId, eventKey: REMINDER_EVENT, recipientUserId: staffId, subject, body,
      meta: { reminderFamilyId: familyId, reminderBy: userId, reminderByName: byName },
    });
    await AuditService.log({
      action: 'messages.oversight_reminder', actor: req.jwtUser, schoolId,
      target: { type: 'conversation', id: `${staffId}:${familyId}`, label: `${staff.name || staffId} / ${familyName}` },
      details: { staffId, familyId, waitingSince: pair.waitingSince }, req,
    });

    // Same switches as an ordinary new message; never holds up the answer.
    (async () => {
      if (await notif.isEnabled(schoolId, 'new_message', 'push')) {
        await push.sendToUsers({ schoolId, userIds: [staffId], title: subject, body, data: { type: 'message' } });
      }
      if (staff.email && await notif.isEnabled(schoolId, 'new_message', 'email')) {
        const school = req.school ?? await _model('schools').findOne({ id: schoolId }).lean();
        await email.sendMessageNotification({
          recipientName: staff.name || '', recipientEmail: staff.email, senderName: byName, subject, preview: body,
          schoolName: school?.name, schoolEmail: school?.systemEmail || '', schoolId, isDirect: true,
          appUrl: await schoolLoginUrl(schoolId),
        });
      }
    })().catch(err => console.error('[message-oversight remind notify]', err.message));

    res.status(201).json({ data: { sentAt: doc.createdAt, to: staff.name || 'Staff' } });
  } catch (err) {
    console.error('[message-oversight remind]', err.message);
    fail(res, 500, 'Could not send the reminder.');
  }
});

router._pairs = _pairs;
router.KEY = KEY;
module.exports = router;
