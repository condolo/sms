/* ============================================================
   Msingi — Parent replies on behaviour entries

   Asked for by a parent (2026-11-12): "when we get an update on
   behaviour, I cannot see which teacher has updated. So I don't even
   know who to reply to … I can't tell which homework my son has not
   done." So every entry a parent sees now names the staff member who
   logged it (display name only) and where (subject, class), and the
   parent can reply on the entry itself.

   A reply is an ordinary `messages` document (createDirectMessage in
   routes/messages.js), not a parallel store: it lands in the
   recipients' Messages inbox and bell, sends the "New Message" email
   when the school's notification settings allow it, and pushes. Three
   extra fields tie it to the entry:

     behaviourIncidentId  the incident's id
     behaviourParentId    the parent who opened the conversation
     behaviourThread      `behaviour:<incidentId>:<parentUserId>`

   One conversation per (entry, parent): two guardians of the same
   child each get their own thread with the staff, so one never reads
   what the other wrote.

   Who receives a parent's reply: the staff member who logged the entry
   and the child's form teacher (plus assistant form teacher — the same
   pair the parent portal's "Class Teacher" message category uses),
   de-duplicated. Staff answers go to that parent and the other staff
   on the thread.
   ============================================================ */
'use strict';

const mongoose = require('mongoose');
const { tenantModel } = require('./tenant-model');

const PORTAL_ROLES = new Set(['parent', 'guardian', 'student']);
const BODY_MAX = 2000;

/** Staff name a parent may see: the display name, never an email or phone. */
function displayName(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return 'School staff';
  if (s.includes('@')) return 'School staff';
  if (/^\+?[\d\s()-]{6,}$/.test(s)) return 'School staff';
  return s;
}

/* A user's id as the JWT carries it: `id`, or String(_id) for an account
   saved without an `id` field (some schools' records — see
   scopeMiddleware._teacherIdForms). reportedBy, recipients and the parent's
   userId all use this form, so every lookup by user id must match both. */
function userKey(u) { return u.id || String(u._id); }
function byUserIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  const oids = list.filter(v => /^[a-fd]{24}$/i.test(v)).map(v => new mongoose.Types.ObjectId(v));
  return oids.length ? { $or: [{ id: { $in: list } }, { _id: { $in: oids } }] } : { id: { $in: list } };
}
async function findUser(ctx, schoolId, userId, fields) {
  if (!userId) return null;
  const [u] = await tenantModel('users', ctx).find({ schoolId, ...byUserIds([userId]) }).select(fields).limit(1).lean();
  return u || null;
}

function threadKey(incidentId, parentUserId) {
  return `behaviour:${incidentId}:${parentUserId}`;
}

function loggerOf(incident) {
  return incident?.reportedBy || incident?.createdBy || null;
}

function cleanBody(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return { error: 'Write a reply first.' };
  if (s.length > BODY_MAX) return { error: `Keep the reply under ${BODY_MAX} characters.` };
  return { body: s };
}

/** userId → display name, for whoever logged these incidents. */
async function recorderNames(ctx, schoolId, incidents) {
  const ids = [...new Set(incidents.map(loggerOf).filter(Boolean))];
  if (!ids.length) return {};
  const users = await tenantModel('users', ctx)
    .find({ schoolId, ...byUserIds(ids) }).select('id name').lean();
  return Object.fromEntries(users.map(u => [userKey(u), displayName(u.name)]));
}

/**
 * Where each incident was recorded: { [incidentId]: { subjectName, className, subjectInferred } }.
 * New entries carry subjectName (picked when logging). For older entries
 * with none, the subject is filled in only when the person who logged it
 * teaches exactly one subject in that class — never a guess between two.
 */
async function whereRecorded(ctx, schoolId, incidents) {
  const out = {};
  const classIds = [...new Set(incidents.map(i => i.classId).filter(Boolean))];
  const classDocs = classIds.length
    ? await tenantModel('classes', ctx).find({ schoolId, id: { $in: classIds } }).select('id name').lean()
    : [];
  const classNames = Object.fromEntries(classDocs.map(c => [c.id, c.name]));

  const needInference = incidents.filter(i => !i.subjectName && loggerOf(i) && i.classId);
  const onlySubject = {};
  if (needInference.length) {
    const rows = await tenantModel('teaching_assignments', ctx).find({
      schoolId,
      teacherId: { $in: [...new Set(needInference.map(loggerOf))] },
      classId: { $in: [...new Set(needInference.map(i => i.classId))] },
    }).select('teacherId classId subjectId subjectName').lean();
    const byPair = new Map();
    for (const r of rows) {
      if (!r.subjectId) continue;
      const key = `${r.teacherId}|${r.classId}`;
      if (!byPair.has(key)) byPair.set(key, new Map());
      byPair.get(key).set(r.subjectId, r.subjectName || null);
    }
    const missingNames = new Set();
    for (const [key, subjects] of byPair) {
      if (subjects.size !== 1) continue;
      const [[subjectId, subjectName]] = [...subjects];
      onlySubject[key] = { subjectId, subjectName };
      if (!subjectName) missingNames.add(subjectId);
    }
    if (missingNames.size) {
      const subs = await tenantModel('subjects', ctx)
        .find({ schoolId, id: { $in: [...missingNames] } }).select('id name').lean();
      const names = Object.fromEntries(subs.map(s => [s.id, s.name]));
      for (const v of Object.values(onlySubject)) if (!v.subjectName) v.subjectName = names[v.subjectId] || null;
    }
  }

  for (const i of incidents) {
    const inferred = !i.subjectName ? onlySubject[`${loggerOf(i)}|${i.classId}`] : null;
    out[i.id] = {
      subjectName: i.subjectName || inferred?.subjectName || null,
      subjectInferred: !i.subjectName && !!inferred?.subjectName,
      className: classNames[i.classId] || null,
    };
  }
  return out;
}

/**
 * Staff a parent's reply goes to: the logger, then the child's form
 * teacher and assistant form teacher. Active, non-portal accounts only.
 * Returns [{ userId, name, reason }].
 */
async function incidentStaff(ctx, schoolId, incident) {
  const wanted = [];
  const logger = loggerOf(incident);
  if (logger) wanted.push({ userId: logger, reason: 'logged' });

  const student = await tenantModel('students', ctx)
    .findOne({ schoolId, id: incident.studentId }).select('streamId').lean();
  if (student?.streamId) {
    const stream = await tenantModel('streams', ctx)
      .findOne({ schoolId, id: student.streamId }).select('formTeacherId assistantFormTeacherId').lean();
    const teacherIds = [stream?.formTeacherId, stream?.assistantFormTeacherId].filter(Boolean);
    if (teacherIds.length) {
      const teachers = await tenantModel('teachers', ctx)
        .find({ schoolId, ...byUserIds(teacherIds) }).select('id userId').lean();
      for (const tid of teacherIds) {
        const t = teachers.find(x => x.id === tid || String(x._id) === tid);
        if (t?.userId) wanted.push({ userId: t.userId, reason: 'form_teacher' });
      }
    }
  }

  const ids = [...new Set(wanted.map(w => w.userId))];
  if (!ids.length) return [];
  const users = await tenantModel('users', ctx)
    .find({ schoolId, ...byUserIds(ids), isActive: { $ne: false } }).select('id name role').lean();
  const byId = Object.fromEntries(users.filter(u => !PORTAL_ROLES.has(u.role)).map(u => [userKey(u), u]));
  const seen = new Set();
  const out = [];
  for (const w of wanted) {
    if (!byId[w.userId] || seen.has(w.userId)) continue;
    seen.add(w.userId);
    out.push({ userId: w.userId, name: displayName(byId[w.userId].name), reason: w.reason });
  }
  return out;
}

/** Messages on one thread, oldest first. */
async function threadMessages(ctx, schoolId, key) {
  return tenantModel('messages', ctx)
    .find({ schoolId, behaviourThread: key })
    .sort({ createdAt: 1 })
    .select('id senderId senderName senderRole recipients body createdAt isRead behaviourParentId behaviourIncidentId')
    .lean();
}

/** The shape either side is shown — no ids of other people, no emails. */
function publicMessage(msg, viewerId) {
  const fromParent = PORTAL_ROLES.has(msg.senderRole);
  return {
    id: msg.id,
    body: msg.body,
    createdAt: msg.createdAt,
    fromParent,
    senderName: fromParent ? (msg.senderName || 'Parent') : displayName(msg.senderName),
    mine: msg.senderId === viewerId,
  };
}

async function markThreadRead(ctx, schoolId, key, userId) {
  await tenantModel('messages', ctx).updateMany(
    { schoolId, behaviourThread: key, recipients: userId },
    { $set: { [`isRead.${userId}`]: true } },
  );
}

/**
 * Reply counts per incident: { [incidentId]: { count, unread } }.
 * `parentUserId` limits to that parent's own thread; `participantId`
 * limits to threads that user sent to or received.
 */
async function replyCounts(ctx, schoolId, incidentIds, { viewerId, parentUserId = null, participantId = null } = {}) {
  if (!incidentIds.length) return {};
  const filter = { schoolId, behaviourIncidentId: { $in: incidentIds } };
  if (parentUserId) filter.behaviourParentId = parentUserId;
  if (participantId) filter.$or = [{ senderId: participantId }, { recipients: participantId }];
  const rows = await tenantModel('messages', ctx).find(filter)
    .select('behaviourIncidentId recipients isRead').lean();
  const out = {};
  for (const r of rows) {
    const c = out[r.behaviourIncidentId] || (out[r.behaviourIncidentId] = { count: 0, unread: 0 });
    c.count += 1;
    if (viewerId && (r.recipients || []).includes(viewerId) && !(r.isRead && r.isRead[viewerId])) c.unread += 1;
  }
  return out;
}

function contextFor(incident) {
  const pts = Number(incident.points) || 0;
  return {
    type: 'behaviour',
    title: String(incident.title || 'Behaviour entry').slice(0, 120),
    detail: [incident.studentName, incident.date, `${pts > 0 ? '+' : ''}${pts} pts`].filter(Boolean).join(' · ').slice(0, 300),
  };
}

module.exports = {
  PORTAL_ROLES,
  BODY_MAX,
  displayName,
  userKey,
  byUserIds,
  findUser,
  threadKey,
  loggerOf,
  cleanBody,
  recorderNames,
  whereRecorded,
  incidentStaff,
  threadMessages,
  publicMessage,
  markThreadRead,
  replyCounts,
  contextFor,
};
