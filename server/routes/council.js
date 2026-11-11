/* ============================================================
   Msingi — /api/council  (Student Council: grievances + suggestions)

   Three faces, one module:

   STUDENT (any student account)
     GET  /me                     my membership, open cases, open elections
     GET  /cases                  cases I filed
     POST /cases                  file a grievance or suggestion
     GET  /cases/:id              one of mine (with the council's replies)
     POST /cases/:id/replies      reply (reopens a closed case)
     POST /cases/:id/upvote       suggestions only, once per student
     POST /cases/:id/withdraw     take my own case back
     GET  /elections              open elections + published results
     POST /elections/:id/nominate stand for a seat
     POST /elections/:id/vote     secret ballot, once per seat

   COUNCIL MEMBER (active membership, not their own case)
     GET  /queue                  the triage queue
     POST /cases/:id/assign       claim a case
     POST /cases/:id/replies      reply (internal notes hidden from reporter)
     POST /cases/:id/status       under_review / resolved / rejected
     POST /cases/:id/escalate     hand it to the patron
     POST /cases/:id/merge        fold a duplicate into another case

   STAFF READ-ONLY FEED (council:read, non-patron — teachers etc.)
     GET  /staff-feed              the pulse: every non-sensitive case
                                  with identities masked (teachers never
                                  see who filed it), safeguarding and
                                  patron-held cases excluded, no write
                                  actions of any kind.

   STAFF PATRON (council:read / update / create)
     GET  /admin/overview
     GET  /admin/cases            every case, identities included —
                                  patron-console only (see _mayUsePatronConsole)
     GET  /admin/cases/:id
     PATCH /admin/cases/:id       status / assignee, with a note —
                                  patron-console only, like the reads above
     GET  /admin/memberships      POST appoint, DELETE remove
     GET  /admin/elections        POST create, PATCH advance
     GET  /admin/elections/:id/candidates
     POST /admin/elections/:id/candidates/:cid/vet
     POST /admin/elections/:id/close   tally → memberships

   Safeguarding is not negotiable: a safety category or a disclosure
   keyword escalates the case on creation, council members cannot close
   it, and the patron is notified immediately. Anonymous cases hide the
   reporter from students ONLY — staff always see who filed it.
   ============================================================ */
'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { moduleGate } = require('../middleware/module-gate');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { _model } = require('../utils/model');
const { ok, created, E } = require('../utils/response');
const AuditService = require('../services/audit');
const { dispatchNotification } = require('../utils/notify-dispatch');
const email = require('../utils/email');
const {
  KINDS, CATEGORIES, OPEN_STATUSES, isSafeguarding, canTransition,
  caseRef, effectiveElectionPhase, canNominate, canVote, tallySeats,
} = require('../utils/council');

const router = express.Router();

const MODGATE = moduleGate('council');

const PATRON_ROLES = ['admin', 'principal', 'deputy_principal', 'superadmin'];

/* Grievance filers are students with a lot of reasons to click twice. */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.jwtUser?.userId || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'You have filed several items this hour. Please wait before filing another.' } },
});

const replyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.jwtUser?.userId || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many replies — please wait a moment.' } },
});

const CreateCaseSchema = z.object({
  kind:     z.enum(KINDS),
  category: z.enum(CATEGORIES),
  title:    z.string().trim().min(3).max(160),
  body:     z.string().trim().min(5).max(6000),
  anonymous: z.boolean().optional().default(false),
  sensitive: z.boolean().optional().default(false),
});

const ReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  internal: z.boolean().optional().default(false),
});

const StatusSchema = z.object({
  status: z.enum(['under_review', 'resolved', 'rejected']),
  note:   z.string().trim().max(2000).optional().default(''),
});

const PositionSchema = z.object({
  title:             z.string().trim().min(2).max(80),
  seats:             z.number().int().min(1).max(20).default(1),
  eligibleClassIds:  z.array(z.string()).optional().default([]),
  minAttendancePct:  z.number().min(0).max(100).optional().default(0),
  description:       z.string().trim().max(500).optional().default(''),
});

const CreateElectionSchema = z.object({
  title:           z.string().trim().min(3).max(120),
  termLabel:       z.string().trim().max(60).optional().default(''),
  nominationStart: z.string().datetime(),
  nominationEnd:   z.string().datetime(),
  votingStart:     z.string().datetime(),
  votingEnd:       z.string().datetime(),
  allowSelfVote:   z.boolean().optional().default(false),
  positions:       z.array(PositionSchema).min(1).max(20),
});

const VetSchema = z.object({
  approve: z.boolean(),
  reason:  z.string().trim().max(500).optional().default(''),
});

const AppointSchema = z.object({
  studentId: z.string().min(1),
  positionTitle: z.string().trim().min(2).max(80),
  termLabel: z.string().trim().max(60).optional().default(''),
});

/* ── small helpers ─────────────────────────────────────────── */

const _uid = () => crypto.randomUUID();
const _now = () => new Date().toISOString();

function _isStudent(req) {
  return req.jwtUser?.role === 'student' && !!req.jwtUser?.studentId;
}

function _isPatronRole(req) {
  if (PATRON_ROLES.includes(req.jwtUser?.role)) return true;
  return Array.isArray(req.jwtUser?.roles) && req.jwtUser.roles.some(r => PATRON_ROLES.includes(r));
}

function _fullName(s) {
  return [s?.firstName, s?.lastName].filter(Boolean).join(' ') || s?.name || 'Student';
}

async function _school(schoolId) {
  return _model('schools').findOne({ id: schoolId }).select('name systemEmail currencySymbol').lean();
}

async function _student(ctx, studentId) {
  return tenantModel('students', ctx).findOne({ id: studentId })
    .select('id firstName lastName admissionNumber classId className streamId status photoUrl').lean();
}

async function _membership(ctx, studentId) {
  return tenantModel('council_memberships', ctx).findOne({ studentId, active: true }).lean();
}

async function _userForStudent(ctx, schoolId, studentId) {
  return tenantModel('users', ctx).findOne({ schoolId, studentId, isActive: { $ne: false } })
    .select('id name email').lean();
}

function _statusLabel(status) {
  return {
    open: 'Open', under_review: 'Under review', escalated: 'Escalated to staff',
    resolved: 'Resolved', rejected: 'Closed', merged: 'Merged into another case',
    withdrawn: 'Withdrawn',
  }[status] || status;
}

/* Reporter identity as a given viewer may see it. Anonymous hides the
   student from OTHER STUDENTS only — staff routes read the raw doc.
   The class goes with the name: "Anonymous · Form 2B" still narrows a
   reporter to one class, which defeats the point for other students and
   council members. Only staff (or the reporter themselves) see it. */
function _reporterView(doc, { reveal }) {
  if (reveal || !doc.anonymous) {
    return {
      studentId: doc.reporterStudentId,
      name:      doc.reporterName,
      className: doc.reporterClass || '',
      anonymous: false,
    };
  }
  return {
    studentId: null,
    name:      'Anonymous',
    className: '',
    anonymous: true,
  };
}

function _replyView(reply, { reveal }) {
  const anonymous = reply.authorType === 'student' && reply.anonymous && !reveal;
  return {
    id: reply.id,
    authorType: reply.authorType,
    authorName: anonymous ? 'Anonymous' : (reply.authorName || 'Student'),
    anonymous,
    body: reply.body,
    internal: false,
    createdAt: reply.createdAt,
  };
}

function _caseView(doc, viewer) {
  const reveal = viewer.staff || (viewer.studentId && viewer.studentId === doc.reporterStudentId) || viewer.isCouncil && !doc.anonymous;
  const replies = (doc.replies || [])
    .filter(r => !(r.internal && !viewer.staff && !viewer.isCouncil))
    .map(r => _replyView(r, { reveal }));
  return {
    id: doc.id,
    ref: doc.ref,
    kind: doc.kind,
    category: doc.category,
    title: doc.title,
    body: doc.body,
    status: doc.status,
    statusLabel: _statusLabel(doc.status),
    /** Exposed so the UI can flag the case and use the right copy. */
    safeguarding: !!doc.safeguarding,
    sensitive: !!doc.sensitive,
    reporter: _reporterView(doc, { reveal }),
    assignedTo: doc.assignedStudentId
      ? { studentId: doc.assignedStudentId, name: doc.assignedName || 'Council member' }
      : null,
    /** True when the viewer filed it — the UI hides "upvote your own". */
    isMine: Boolean(viewer.studentId && viewer.studentId === doc.reporterStudentId),
    upvoteCount: (doc.upvotes || []).length,
    upvotedByMe: viewer.studentId ? (doc.upvotes || []).includes(viewer.studentId) : false,
    replies,
    mergedInto: doc.mergedInto || null,
    escalatedAt: doc.escalatedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt || doc.lastActivityAt,
  };
}

async function _notifyStudent(ctx, schoolId, studentId, { subject, body, emailBody, ref, statusLabel }) {
  const user = await _userForStudent(ctx, schoolId, studentId);
  if (!user) return;
  const school = await _school(schoolId);
  await dispatchNotification({
    ctx, schoolId, eventKey: 'council_case_update', actorUserId: 'system',
    recipients: [{ userId: user.id, name: user.name, email: user.email }],
    inAppSubject: subject,
    inAppBody: body,
    emailDigestSubject: subject,
    emailDigestBody: body,
    sendEmail: (r) => email.sendCouncilUpdate({
      recipientName: r.name,
      recipientEmail: r.email,
      caseRef: ref || 'Council',
      caseTitle: subject,
      statusLabel: statusLabel || 'Update',
      note: emailBody || '',
      schoolName: school?.name || 'Your school',
      schoolEmail: school?.systemEmail || '',
      schoolId,
    }),
  }).catch(err => console.error('[council] notify student failed:', err.message));
}

async function _notifyMembers(ctx, schoolId, { subject, body, excludeStudentId }) {
  const members = await tenantModel('council_memberships', ctx).find({ active: true }).lean();
  const seen = new Set();
  for (const m of members) {
    if (m.studentId === excludeStudentId || seen.has(m.studentId)) continue;
    seen.add(m.studentId);
    await _notifyStudent(ctx, schoolId, m.studentId, { subject, body }).catch(() => {});
  }
}

async function _notifyPatrons(ctx, schoolId, { subject, body, ref = '' }) {
  const users = await tenantModel('users', ctx)
    .find({ schoolId, isActive: { $ne: false }, role: { $in: PATRON_ROLES } })
    .select('id name email role')
    .limit(20)
    .lean();
  const school = await _school(schoolId);
  for (const u of users) {
    await dispatchNotification({
      ctx, schoolId, eventKey: 'council_safety_alert', actorUserId: 'system',
      recipients: [{ userId: u.id, name: u.name, email: u.email }],
      inAppSubject: subject,
      inAppBody: body,
      emailDigestSubject: subject,
      emailDigestBody: body,
      sendEmail: (r) => email.sendCouncilUpdate({
        recipientName: r.name, recipientEmail: r.email,
        caseRef: ref || 'Council', caseTitle: subject, statusLabel: 'Needs your attention',
        note: body,
        schoolName: school?.name || 'Your school',
        schoolEmail: school?.systemEmail || '',
        schoolId,
      }),
    }).catch(() => {});
  }
}

/* ── primary school gate for every council route ───────────── */
router.use(authMiddleware, MODGATE);

/* ══════════════════════════════════════════════════════════════
   STUDENT + MEMBER — identity and cases
   ══════════════════════════════════════════════════════════════ */

router.get('/me', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    if (!_isStudent(req)) {
      return ok(res, {
        student: false,
        membership: null,
        staff: true,
        /* Same rule the identity-bearing /admin/cases routes enforce —
           keeps the web UI's console-vs-staff-feed branch in step. */
        canManage: await _mayUsePatronConsole(req),
      });
    }
    const { studentId } = req.jwtUser;
    const [student, membership, openCases, elections] = await Promise.all([
      _student(ctx, studentId),
      _membership(ctx, studentId),
      tenantModel('council_cases', ctx).countDocuments({ reporterStudentId: studentId, status: { $in: OPEN_STATUSES } }),
      tenantModel('council_elections', ctx).find({ schoolId }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    const now = new Date();
    const liveElections = (elections || [])
      .map(e => ({ id: e.id, title: e.title, phase: effectiveElectionPhase(e, now), votingEnd: e.votingEnd }))
      .filter(e => ['nominations', 'vetting', 'voting'].includes(e.phase));
    return ok(res, {
      student: student ? { name: _fullName(student), className: student.className || '' } : null,
      membership: membership
        ? { positionTitle: membership.positionTitle, source: membership.source, since: membership.createdAt }
        : null,
      openCases,
      elections: liveElections,
    });
  } catch (err) {
    console.error('[council GET /me]', err);
    return E.serverError(res);
  }
});

router.get('/cases', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const docs = await tenantModel('council_cases', ctx)
      .find({ reporterStudentId: studentId })
      .sort({ lastActivityAt: -1 })
      .limit(limit)
      .lean();
    return ok(res, docs.map(d => _caseView(d, { studentId, isCouncil: false })));
  } catch (err) {
    console.error('[council GET /cases]', err);
    return E.serverError(res);
  }
});

router.get('/suggestions', async (req, res) => {
  // rbac: student session; suggestions are school-visible by design, anonymous ones stay masked
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const docs = await tenantModel('council_cases', ctx)
      .find({
        kind: 'suggestion',
        status: { $nin: ['merged', 'withdrawn'] },
        sensitive: { $ne: true },
      })
      .sort({ lastActivityAt: -1 })
      .limit(limit)
      .lean();
    const rows = docs
      .map(d => _caseView(d, { studentId, isCouncil: false, staff: false }))
      .sort((a, b) => b.upvoteCount - a.upvoteCount || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return ok(res, rows);
  } catch (err) {
    console.error('[council GET /suggestions]', err);
    return E.serverError(res);
  }
});

router.post('/cases', submitLimiter, async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  const parsed = CreateCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid case.' } });
  }
  try {
    const ctx = tenantContext(req);
    const { schoolId, studentId } = req.jwtUser;
    const data = parsed.data;
    const student = await _student(ctx, studentId);
    if (!student) return E.notFound(res, 'Student record not found.');

    const year = new Date().getFullYear();
    const counter = await tenantModel('council_counters', ctx)
      .findOneAndUpdate({ key: `case_${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true })
      .lean();

    const safeguarding = isSafeguarding(data);
    const now = _now();
    const doc = {
      id: _uid(),
      schoolId,
      ref: caseRef(counter?.seq || 1, year),
      kind: data.kind,
      category: data.category,
      title: data.title,
      body: data.body,
      anonymous: !!data.anonymous,
      sensitive: !!data.sensitive,
      safeguarding,
      reporterStudentId: studentId,
      reporterUserId: req.jwtUser.userId || null,
      reporterName: _fullName(student),
      reporterClass: student.className || '',
      status: safeguarding ? 'escalated' : 'open',
      assignedStudentId: null,
      assignedName: null,
      upvotes: [],
      replies: [],
      events: [{
        id: _uid(), at: now, action: 'created',
        byUserId: req.jwtUser.userId || null, byName: _fullName(student),
      }],
      escalatedAt: safeguarding ? now : null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await tenantModel('council_cases', ctx).create(doc);

    AuditService.log({
      action: safeguarding ? 'council.case.safeguarding' : `council.case.${data.kind}`,
      actor: req.jwtUser, schoolId,
      target: { type: 'council_case', id: doc.id },
      details: { ref: doc.ref, category: doc.category, anonymous: doc.anonymous },
      req,
    });

    const memberSubject = safeguarding
      ? `Safeguarding case ${doc.ref} needs the patron`
      : `New ${data.kind} ${doc.ref}`;
    if (safeguarding) {
      await _notifyPatrons(ctx, schoolId, {
        subject: memberSubject,
        body: `A safety-related ${data.kind} was filed (${doc.ref}). It is escalated and cannot be closed by students. Open the Council admin page.`,
        ref: doc.ref,
      });
    } else {
      await _notifyMembers(ctx, schoolId, {
        subject: memberSubject,
        body: `A new ${data.kind} is waiting in the council queue (${doc.ref}).`,
        excludeStudentId: studentId,
      });
    }

    return created(res, _caseView(doc, { studentId, isCouncil: false }));
  } catch (err) {
    console.error('[council POST /cases]', err);
    return E.serverError(res);
  }
});

router.get('/cases/:id', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    const membership = await _membership(ctx, studentId);
    const isMine = doc.reporterStudentId === studentId;
    const mayViewAsMember = membership && !isMine
      && !doc.sensitive
      && (!doc.safeguarding || doc.assignedStudentId === studentId)
      && !(doc.reporterStudentId && doc.reporterStudentId === studentId);
    if (!isMine && !mayViewAsMember) return E.forbidden(res, 'You do not have access to this case.');
    return ok(res, _caseView(doc, { studentId, isCouncil: !!membership, staff: false }));
  } catch (err) {
    console.error('[council GET /cases/:id]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/replies', replyLimiter, async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  const parsed = ReplySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid reply.' } });
  }
  try {
    const ctx = tenantContext(req);
    const { schoolId, studentId } = req.jwtUser;
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    const membership = await _membership(ctx, studentId);
    const isReporter = doc.reporterStudentId === studentId;
    if (!isReporter && !membership) return E.forbidden(res, 'Only the reporter or a council member can reply.');
    if (doc.status === 'merged' || doc.status === 'withdrawn') {
      return E.badRequest(res, 'This case is closed to replies.');
    }

    const student = await _student(ctx, studentId);
    const now = _now();
    const reply = {
      id: _uid(),
      authorType: isReporter ? 'student' : 'council',
      authorStudentId: studentId,
      authorUserId: req.jwtUser.userId || null,
      authorName: _fullName(student),
      anonymous: isReporter ? !!doc.anonymous : false,
      body: parsed.data.body,
      internal: !isReporter && !!parsed.data.internal,
      createdAt: now,
    };
    const nextStatus = isReporter && ['resolved', 'rejected'].includes(doc.status) ? 'under_review' : doc.status;
    await tenantModel('council_cases', ctx).updateOne(
      { id: doc.id },
      {
        $push: {
          replies: reply,
          events: { id: _uid(), at: now, action: 'reply', byUserId: req.jwtUser.userId || null, byName: reply.authorName, note: '' },
        },
        $set: { status: nextStatus, lastActivityAt: now, updatedAt: now },
      },
    );

    if (isReporter) {
      await _notifyMembers(ctx, schoolId, {
        subject: `New reply on ${doc.ref}`,
        body: `The reporter added a reply. Open the council queue.`,
        excludeStudentId: studentId,
      });
    } else if (!reply.internal) {
      await _notifyStudent(ctx, schoolId, doc.reporterStudentId, {
        subject: `The council replied on ${doc.ref}`,
        body: `Open the Council to read the reply.`,
        emailBody: '',
        ref: doc.ref,
        statusLabel: _statusLabel(nextStatus),
      });
    }

    const fresh = await tenantModel('council_cases', ctx).findOne({ id: doc.id }).lean();
    return ok(res, _caseView(fresh, { studentId, isCouncil: !!membership, staff: false }));
  } catch (err) {
    console.error('[council POST /cases/:id/replies]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/upvote', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    if (doc.kind !== 'suggestion') return E.badRequest(res, 'Only suggestions can be upvoted.');
    if (doc.reporterStudentId === studentId) return E.badRequest(res, 'You cannot upvote your own suggestion.');
    if (['merged', 'withdrawn'].includes(doc.status)) return E.badRequest(res, 'This suggestion is closed.');
    const upvotes = new Set(doc.upvotes || []);
    if (upvotes.has(studentId)) upvotes.delete(studentId); else upvotes.add(studentId);
    await tenantModel('council_cases', ctx).updateOne(
      { id: doc.id },
      { $set: { upvotes: [...upvotes], updatedAt: _now() } },
    );
    return ok(res, { upvoteCount: upvotes.size, upvotedByMe: upvotes.has(studentId) });
  } catch (err) {
    console.error('[council POST /cases/:id/upvote]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/withdraw', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id, reporterStudentId: studentId }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    if (!canTransition(doc.status, 'withdrawn')) return E.badRequest(res, 'This case can no longer be withdrawn.');
    const now = _now();
    await tenantModel('council_cases', ctx).updateOne(
      { id: doc.id },
      { $set: { status: 'withdrawn', lastActivityAt: now, updatedAt: now } },
    );
    return ok(res, { withdrawn: true });
  } catch (err) {
    console.error('[council POST /cases/:id/withdraw]', err);
    return E.serverError(res);
  }
});

/* ── council queue ─────────────────────────────────────────── */

router.get('/queue', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const membership = await _membership(ctx, studentId);
    if (!membership) return E.forbidden(res, 'Only council members can open the queue.');
    const docs = await tenantModel('council_cases', ctx)
      .find({
        status: { $in: OPEN_STATUSES },
        reporterStudentId: { $ne: studentId },
        $and: [
          { $or: [{ sensitive: { $ne: true } }, { assignedStudentId: studentId }] },
          { $or: [{ safeguarding: { $ne: true } }, { assignedStudentId: studentId }] },
        ],
      })
      .sort({ lastActivityAt: -1 })
      .limit(100)
      .lean();
    const now = new Date();
    const elections = await tenantModel('council_elections', ctx)
      .find({ phase: { $ne: 'closed' } })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    return ok(res, {
      membership: { positionTitle: membership.positionTitle, source: membership.source },
      cases: docs.map(d => _caseView(d, { studentId, isCouncil: true, staff: false })),
      elections: elections.map(e => ({
        id: e.id, title: e.title, phase: effectiveElectionPhase(e, now),
        votingEnd: e.votingEnd, nominationEnd: e.nominationEnd,
      })),
    });
  } catch (err) {
    console.error('[council GET /queue]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/assign', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const membership = await _membership(ctx, studentId);
    if (!membership) return E.forbidden(res, 'Only council members can claim cases.');
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    if (doc.reporterStudentId === studentId) return E.badRequest(res, 'You cannot take your own case.');
    if (doc.safeguarding && doc.assignedStudentId !== studentId) {
      return E.forbidden(res, 'Safeguarding cases are assigned by the patron, not claimed.');
    }
    if (doc.sensitive && doc.assignedStudentId !== studentId) {
      return E.forbidden(res, 'This case is with the patron.');
    }
    if (doc.assignedStudentId && doc.assignedStudentId !== studentId) {
      return E.badRequest(res, 'This case is already assigned.');
    }
    const student = await _student(ctx, studentId);
    const now = _now();
    await tenantModel('council_cases', ctx).updateOne(
      { id: doc.id },
      {
        $set: { assignedStudentId: studentId, assignedName: _fullName(student), status: 'under_review', lastActivityAt: now, updatedAt: now },
        $push: { events: { id: _uid(), at: now, action: 'assigned', byUserId: req.jwtUser.userId || null, byName: _fullName(student), note: '' } },
      },
    );
    return ok(res, { assigned: true });
  } catch (err) {
    console.error('[council POST /cases/:id/assign]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/status', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid status.' } });
  }
  try {
    const ctx = tenantContext(req);
    const { schoolId, studentId } = req.jwtUser;
    const membership = await _membership(ctx, studentId);
    if (!membership) return E.forbidden(res, 'Only council members can change a case status.');
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    if (doc.reporterStudentId === studentId) return E.forbidden(res, 'You cannot decide your own case.');
    if (doc.safeguarding && ['resolved', 'rejected'].includes(parsed.data.status)) {
      return E.forbidden(res, 'Safeguarding cases are closed by school staff only.');
    }
    if (!canTransition(doc.status, parsed.data.status)) {
      return E.badRequest(res, `A ${doc.status} case cannot move to ${parsed.data.status}.`);
    }
    const now = _now();
    const note = parsed.data.note;
    const student = await _student(ctx, studentId);
    const authorName = _fullName(student);
    const reply = note ? {
      id: _uid(), authorType: 'council', authorStudentId: studentId,
      authorUserId: req.jwtUser.userId || null, authorName,
      anonymous: false, body: note, internal: false, createdAt: now,
    } : null;
    const update = {
      $set: { status: parsed.data.status, lastActivityAt: now, updatedAt: now },
      $push: {
        events: { id: _uid(), at: now, action: `status:${parsed.data.status}`, byUserId: req.jwtUser.userId || null, byName: membership.positionTitle || 'Council', note },
        ...(reply ? { replies: reply } : {}),
      },
    };
    if (parsed.data.status === 'resolved') update.$set.resolvedAt = now;
    await tenantModel('council_cases', ctx).updateOne({ id: doc.id }, update);

    if (note) {
      await _notifyStudent(ctx, schoolId, doc.reporterStudentId, {
        subject: `${doc.ref} is now ${_statusLabel(parsed.data.status).toLowerCase()}`,
        body: note,
        ref: doc.ref,
        statusLabel: _statusLabel(parsed.data.status),
        emailBody: note,
      });
    }
    return ok(res, { status: parsed.data.status });
  } catch (err) {
    console.error('[council POST /cases/:id/status]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/escalate', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { schoolId, studentId } = req.jwtUser;
    const membership = await _membership(ctx, studentId);
    if (!membership) return E.forbidden(res, 'Only council members can escalate a case.');
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    if (doc.reporterStudentId === studentId) return E.forbidden(res, 'You cannot escalate your own case.');
    if (!canTransition(doc.status, 'escalated')) return E.badRequest(res, 'This case cannot be escalated.');
    const note = String(req.body?.note || '').slice(0, 2000);
    const now = _now();
    await tenantModel('council_cases', ctx).updateOne(
      { id: doc.id },
      {
        $set: { status: 'escalated', escalatedAt: now, lastActivityAt: now, updatedAt: now },
        $push: { events: { id: _uid(), at: now, action: 'escalated', byUserId: req.jwtUser.userId || null, byName: membership.positionTitle || 'Council', note } },
      },
    );
    await _notifyPatrons(ctx, schoolId, {
      subject: `Council escalated ${doc.ref}`,
      body: note || 'A case needs a staff decision. Open the Council admin page.',
      ref: doc.ref,
    });
    return ok(res, { escalated: true });
  } catch (err) {
    console.error('[council POST /cases/:id/escalate]', err);
    return E.serverError(res);
  }
});

router.post('/cases/:id/merge', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId, schoolId } = req.jwtUser;
    const membership = await _membership(ctx, studentId);
    if (!membership) return E.forbidden(res, 'Only council members can merge cases.');
    const targetId = String(req.body?.intoCaseId || '');
    if (!targetId || targetId === req.params.id) return E.badRequest(res, 'Pick a different case to merge into.');
    const [source, target] = await Promise.all([
      tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean(),
      tenantModel('council_cases', ctx).findOne({ id: targetId }).lean(),
    ]);
    if (!source || !target) return E.notFound(res, 'Case not found.');
    if (source.safeguarding) return E.forbidden(res, 'Safeguarding cases cannot be merged by students.');
    const now = _now();
    await tenantModel('council_cases', ctx).updateOne(
      { id: source.id },
      {
        $set: { status: 'merged', mergedInto: target.id, lastActivityAt: now, updatedAt: now },
        $push: { events: { id: _uid(), at: now, action: 'merged', byUserId: req.jwtUser.userId || null, byName: membership.positionTitle || 'Council', note: target.ref } },
      },
    );
    await _notifyStudent(ctx, schoolId, source.reporterStudentId, {
      subject: `${source.ref} was merged into ${target.ref}`,
      body: 'Your case was combined with a similar one so the council answers it once, with you copied on every update.',
    }).catch(() => {});
    return ok(res, { mergedInto: target.id, ref: target.ref });
  } catch (err) {
    console.error('[council POST /cases/:id/merge]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   ELECTIONS — student face
   ══════════════════════════════════════════════════════════════ */

router.get('/elections', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId, schoolId } = req.jwtUser;
    const now = new Date();
    const docs = await tenantModel('council_elections', ctx).find({ schoolId }).sort({ createdAt: -1 }).limit(10).lean();
    const out = [];
    for (const e of docs) {
      const phase = effectiveElectionPhase(e, now);
      if (!['nominations', 'voting', 'closed'].includes(phase)) continue;
      const [candidates, votes, myCandidacy] = await Promise.all([
        tenantModel('council_candidates', ctx).find({ electionId: e.id, status: 'approved' }).lean(),
        tenantModel('council_votes', ctx).find({ electionId: e.id, voterStudentId: studentId }).lean(),
        tenantModel('council_candidates', ctx).findOne({ electionId: e.id, studentId }).lean(),
      ]);
      const votedPositions = new Set((votes || []).map(v => v.positionId));
      const results = phase === 'closed' && e.resultsPublished ? e.results : undefined;
      out.push({
        id: e.id,
        title: e.title,
        termLabel: e.termLabel || '',
        phase,
        allowSelfVote: !!e.allowSelfVote,
        nominationEnd: e.nominationEnd,
        votingEnd: e.votingEnd,
        myCandidacy: myCandidacy ? { positionId: myCandidacy.positionId, status: myCandidacy.status } : null,
        positions: (e.positions || []).map(p => ({
          id: p.id,
          title: p.title,
          seats: p.seats,
          description: p.description || '',
          candidates: phase === 'voting' || phase === 'closed'
            ? (candidates || []).filter(c => c.positionId === p.id).map(c => ({
                id: c.id, name: c.studentName, className: c.className || '',
              }))
            : [],
          voted: votedPositions.has(p.id),
        })),
        results,
      });
    }
    return ok(res, out);
  } catch (err) {
    console.error('[council GET /elections]', err);
    return E.serverError(res);
  }
});

router.post('/elections/:id/nominate', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const election = await tenantModel('council_elections', ctx).findOne({ id: req.params.id }).lean();
    if (!election) return E.notFound(res, 'Election not found.');
    const now = new Date();
    const phase = effectiveElectionPhase(election, now);
    const positionId = String(req.body?.positionId || '');
    const position = (election.positions || []).find(p => p.id === positionId);
    const [student, existing] = await Promise.all([
      _student(ctx, studentId),
      tenantModel('council_candidates', ctx).findOne({ electionId: election.id, studentId }).lean(),
    ]);
    const check = canNominate({ phase, position, student, alreadyCandidate: !!existing });
    if (!check.ok) return E.badRequest(res, check.reason);

    const doc = {
      id: _uid(),
      schoolId: req.jwtUser.schoolId,
      electionId: election.id,
      positionId,
      positionTitle: position.title,
      studentId,
      studentName: _fullName(student),
      className: student.className || '',
      statement: String(req.body?.statement || '').slice(0, 2000),
      status: 'pending',
      reason: '',
      createdAt: _now(),
    };
    await tenantModel('council_candidates', ctx).create(doc);
    await _notifyPatrons(ctx, req.jwtUser.schoolId, {
      subject: `Nomination needs vetting: ${doc.studentName}`,
      body: `${doc.studentName} is standing for ${position.title} in "${election.title}". Approve or reject the candidacy in Council admin.`,
    });
    return created(res, { id: doc.id, status: doc.status });
  } catch (err) {
    console.error('[council POST /elections/:id/nominate]', err);
    return E.serverError(res);
  }
});

router.post('/elections/:id/vote', async (req, res) => {
  // rbac: student session; self-scope + active council membership enforced in handler
  if (!_isStudent(req)) return E.forbidden(res, 'Student accounts only.');
  try {
    const ctx = tenantContext(req);
    const { studentId } = req.jwtUser;
    const election = await tenantModel('council_elections', ctx).findOne({ id: req.params.id }).lean();
    if (!election) return E.notFound(res, 'Election not found.');
    const phase = effectiveElectionPhase(election, new Date());
    const positionId = String(req.body?.positionId || '');
    const candidateId = String(req.body?.candidateId || '');
    const position = (election.positions || []).find(p => p.id === positionId);
    if (!position) return E.badRequest(res, 'Unknown position.');
    const candidate = await tenantModel('council_candidates', ctx)
      .findOne({ id: candidateId, electionId: election.id, positionId, status: 'approved' })
      .lean();
    if (!candidate) return E.badRequest(res, 'That candidate is not on the ballot.');
    const already = await tenantModel('council_votes', ctx)
      .findOne({ electionId: election.id, positionId, voterStudentId: studentId })
      .lean();
    const check = canVote({
      phase, position, voterStudentId: studentId,
      candidateStudentId: candidate.studentId,
      alreadyVoted: !!already,
      allowSelfVote: !!election.allowSelfVote,
    });
    if (!check.ok) return E.badRequest(res, check.reason);
    try {
      await tenantModel('council_votes', ctx).create({
        id: _uid(),
        schoolId: req.jwtUser.schoolId,
        electionId: election.id,
        positionId,
        voterStudentId: studentId,
        candidateId,
        candidateStudentId: candidate.studentId,
        createdAt: _now(),
      });
    } catch (err) {
      if (err && err.code === 11000) return E.badRequest(res, 'You have already voted for this seat.');
      throw err;
    }
    return ok(res, { voted: true, positionId });
  } catch (err) {
    console.error('[council POST /elections/:id/vote]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   STAFF READ-ONLY FEED — the pulse, not the people

   Teachers (and any non-patron staff with council:read) see what
   students are saying and where each case stands. Three hard rules:
     1. Identities stay masked — anonymous cases don't even reveal
        the reporter's class; named ones keep the class for context
        but never the name. Students' replies are masked the same way.
     2. Safeguarding and patron-held (sensitive) cases never appear
        here at all — those belong to the patron alone.
     3. No actions. The patron console (identities, triage, closes)
        is behind _mayUsePatronConsole, not the coarse council:read
        this feed rides on.
   ══════════════════════════════════════════════════════════════ */

function _feedReply(reply) {
  const isStudent = reply.authorType === 'student';
  return {
    id: reply.id,
    authorType: reply.authorType,
    /* Student authors are masked for teachers; council/staff names are
       already public to students in-app, so they stay. */
    authorName: isStudent
      ? (reply.anonymous ? 'Anonymous' : 'Student')
      : (reply.authorName || 'Council'),
    anonymous: isStudent && !!reply.anonymous,
    body: reply.body,
    createdAt: reply.createdAt,
  };
}

function _feedCase(doc) {
  const replies = (doc.replies || []).filter(r => !r.internal).map(_feedReply);
  return {
    id: doc.id,
    ref: doc.ref,
    kind: doc.kind,
    category: doc.category,
    title: doc.title,
    body: doc.body,
    status: doc.status,
    statusLabel: _statusLabel(doc.status),
    reporter: doc.anonymous
      ? { name: 'Anonymous', className: '', anonymous: true, masked: true }
      : { name: 'Student', className: doc.reporterClass || '', anonymous: false, masked: true },
    assigned: !!doc.assignedStudentId,
    upvoteCount: (doc.upvotes || []).length,
    replyCount: replies.length,
    replies,
    createdAt: doc.createdAt,
    lastActivityAt: doc.lastActivityAt,
  };
}

router.get('/staff-feed', rbac('council', 'read'), async (req, res) => {
  if (_isStudent(req)) return E.forbidden(res, 'Staff accounts only.');
  try {
    const ctx = tenantContext(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    const docs = await tenantModel('council_cases', ctx)
      .find({
        safeguarding: { $ne: true },
        sensitive: { $ne: true },
        status: { $nin: ['merged', 'withdrawn'] },
      })
      .sort({ lastActivityAt: -1 })
      .limit(limit)
      .lean();
    return ok(res, {
      counts: {
        total: docs.length,
        open: docs.filter(d => OPEN_STATUSES.includes(d.status)).length,
        grievances: docs.filter(d => d.kind === 'grievance').length,
        suggestions: docs.filter(d => d.kind === 'suggestion').length,
      },
      cases: docs.map(_feedCase),
    });
  } catch (err) {
    console.error('[council GET /staff-feed]', err);
    return E.serverError(res);
  }
});

/* Patron-console guard for the routes that show WHO filed a case.
   The coarse council:read grant (which the settings UI unions into
   perms['council'] whenever any sub is ticked) is no longer enough —
   that same grant is exactly what teachers hold for the read-only
   feed above. The patron console needs a patron role, or a deliberate
   council__manage sub grant for a custom staff role (counselor etc.).
   /admin/overview, memberships and elections stay on plain rbac(): they
   carry no reporter identities, only public figures (members, candidates). */
async function _mayUsePatronConsole(req) {
  if (_isPatronRole(req)) return true;
  return (await hasExplicitSubGrant(req, 'council', 'manage', 'read'))
      || (await hasExplicitSubGrant(req, 'council', 'manage', 'update'));
}

/* ══════════════════════════════════════════════════════════════
   PATRON / STAFF — oversight, elections, memberships
   ══════════════════════════════════════════════════════════════ */

router.get('/admin/overview', rbac('council', 'read'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const [cases, members, elections] = await Promise.all([
      tenantModel('council_cases', ctx).find({}).select('status kind safeguarding').lean(),
      tenantModel('council_memberships', ctx).find({ active: true }).lean(),
      tenantModel('council_elections', ctx).find({ schoolId }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    const counts = cases.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});
    return ok(res, {
      counts,
      open: cases.filter(c => OPEN_STATUSES.includes(c.status)).length,
      safeguarding: cases.filter(c => c.safeguarding && OPEN_STATUSES.includes(c.status)).length,
      members: members.map(m => ({
        id: m.id, studentId: m.studentId, name: m.studentName,
        positionTitle: m.positionTitle, source: m.source, termLabel: m.termLabel || '',
      })),
      elections: elections.map(e => ({
        id: e.id, title: e.title, phase: effectiveElectionPhase(e, new Date()),
        votingEnd: e.votingEnd, resultsPublished: !!e.resultsPublished,
      })),
    });
  } catch (err) {
    console.error('[council GET /admin/overview]', err);
    return E.serverError(res);
  }
});

router.get('/admin/cases', rbac('council', 'read'), async (req, res) => {
  if (!(await _mayUsePatronConsole(req))) {
    return E.forbidden(res, 'Case identities are visible to the council patron only — staff have the read-only feed at /council/staff-feed.');
  }
  try {
    const ctx = tenantContext(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.kind) filter.kind = String(req.query.kind);
    if (req.query.safeguarding === '1') filter.safeguarding = true;
    const docs = await tenantModel('council_cases', ctx)
      .find(filter).sort({ lastActivityAt: -1 }).limit(limit).lean();
    return ok(res, docs.map(d => _caseView(d, { staff: true })));
  } catch (err) {
    console.error('[council GET /admin/cases]', err);
    return E.serverError(res);
  }
});

router.get('/admin/cases/:id', rbac('council', 'read'), async (req, res) => {
  if (!(await _mayUsePatronConsole(req))) {
    return E.forbidden(res, 'Case identities are visible to the council patron only — staff have the read-only feed at /council/staff-feed.');
  }
  try {
    const ctx = tenantContext(req);
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    return ok(res, { ..._caseView(doc, { staff: true }), events: doc.events || [] });
  } catch (err) {
    console.error('[council GET /admin/cases/:id]', err);
    return E.serverError(res);
  }
});

router.patch('/admin/cases/:id', rbac('council', 'update'), async (req, res) => {
  /* Same patron-console boundary as the identity reads above: a role that
     was only meant to VIEW cases must not decide or reassign them, even if
     an Edit box was mistakenly ticked on a "View" row (the coarse grant is
     a union of every sub row — see settings.js _deriveApiPerms). */
  if (!(await _mayUsePatronConsole(req))) {
    return E.forbidden(res, 'Case decisions belong to the council patron — staff have the read-only feed at /council/staff-feed.');
  }
  const body = req.body || {};
  const status = body.status ? String(body.status) : null;
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('council_cases', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Case not found.');
    if (status && !canTransition(doc.status, status)) {
      return E.badRequest(res, `A ${doc.status} case cannot move to ${status}.`);
    }
    const now = _now();
    const note = String(body.note || '').slice(0, 2000);
    const assignedStudentId = body.assignedStudentId === null ? null : (body.assignedStudentId || undefined);
    const update = {
      $set: { lastActivityAt: now, updatedAt: now, ...(status ? { status } : {}) },
      $push: { events: { id: _uid(), at: now, action: status ? `staff:${status}` : 'staff:update', byUserId: req.jwtUser.userId || null, byName: req.jwtUser.name || 'Staff', note } },
    };
    if (status === 'resolved') update.$set.resolvedAt = now;
    if (assignedStudentId !== undefined) {
      update.$set.assignedStudentId = assignedStudentId;
      if (assignedStudentId) {
        const s = await _student(ctx, assignedStudentId);
        update.$set.assignedName = _fullName(s);
      } else {
        update.$set.assignedName = null;
      }
    }
    if (note) {
      update.$push.replies = {
        id: _uid(), authorType: 'staff', authorStudentId: null,
        authorUserId: req.jwtUser.userId || null, authorName: req.jwtUser.name || 'School staff',
        anonymous: false, body: note, internal: !!body.internal, createdAt: now,
      };
    }
    await tenantModel('council_cases', ctx).updateOne({ id: doc.id }, update);
    if (note && !body.internal) {
      await _notifyStudent(ctx, schoolId, doc.reporterStudentId, {
        subject: `${doc.ref}: ${status ? _statusLabel(status) : 'update from the school'}`,
        body: note,
        ref: doc.ref,
        statusLabel: status ? _statusLabel(status) : 'Staff update',
        emailBody: note,
      });
    }
    return ok(res, { updated: true });
  } catch (err) {
    console.error('[council PATCH /admin/cases/:id]', err);
    return E.serverError(res);
  }
});

router.get('/admin/memberships', rbac('council', 'read'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const rows = await tenantModel('council_memberships', ctx).find({}).sort({ createdAt: -1 }).limit(200).lean();
    return ok(res, rows.map(m => ({
      id: m.id, studentId: m.studentId, name: m.studentName, className: m.className || '',
      positionTitle: m.positionTitle, source: m.source, termLabel: m.termLabel || '',
      active: !!m.active, createdAt: m.createdAt, endedAt: m.endedAt || null,
    })));
  } catch (err) {
    console.error('[council GET /admin/memberships]', err);
    return E.serverError(res);
  }
});

router.post('/admin/memberships', rbac('council', 'create'), async (req, res) => {
  const parsed = AppointSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid appointment.' } });
  }
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const student = await _student(ctx, parsed.data.studentId);
    if (!student) return E.notFound(res, 'Student not found.');
    const now = _now();
    await tenantModel('council_memberships', ctx).updateMany(
      { studentId: parsed.data.studentId, active: true },
      { $set: { active: false, endedAt: now } },
    );
    const doc = {
      id: _uid(),
      schoolId,
      studentId: parsed.data.studentId,
      studentName: _fullName(student),
      className: student.className || '',
      positionTitle: parsed.data.positionTitle,
      source: 'appointed',
      termLabel: parsed.data.termLabel || '',
      active: true,
      appointedBy: req.jwtUser.userId || null,
      createdAt: now,
    };
    await tenantModel('council_memberships', ctx).create(doc);
    await _notifyStudent(ctx, schoolId, parsed.data.studentId, {
      subject: `You are on the Student Council`,
      body: `You were appointed ${parsed.data.positionTitle}. Open the Council to see the queue.`,
    }).catch(() => {});
    return created(res, { ...doc, active: true });
  } catch (err) {
    console.error('[council POST /admin/memberships]', err);
    return E.serverError(res);
  }
});

router.delete('/admin/memberships/:id', rbac('council', 'update'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const now = _now();
    const result = await tenantModel('council_memberships', ctx).updateOne(
      { id: req.params.id },
      { $set: { active: false, endedAt: now } },
    );
    if (!result.matchedCount) return E.notFound(res, 'Membership not found.');
    return ok(res, { removed: true });
  } catch (err) {
    console.error('[council DELETE /admin/memberships/:id]', err);
    return E.serverError(res);
  }
});

router.get('/admin/elections', rbac('council', 'read'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const rows = await tenantModel('council_elections', ctx).find({ schoolId }).sort({ createdAt: -1 }).limit(50).lean();
    return ok(res, rows.map(e => ({
      ...e,
      phase: effectiveElectionPhase(e, new Date()),
    })));
  } catch (err) {
    console.error('[council GET /admin/elections]', err);
    return E.serverError(res);
  }
});

router.post('/admin/elections', rbac('council', 'create'), async (req, res) => {
  const parsed = CreateElectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid election.' } });
  }
  const d = parsed.data;
  if (!(new Date(d.nominationStart) < new Date(d.nominationEnd)
      && new Date(d.nominationEnd) <= new Date(d.votingStart)
      && new Date(d.votingStart) < new Date(d.votingEnd))) {
    return E.badRequest(res, 'Dates must run: nominations → vetting → voting, in order.');
  }
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const doc = {
      id: _uid(),
      schoolId,
      title: d.title,
      termLabel: d.termLabel,
      phase: 'upcoming', // dates decide when it opens; no manual publish step
      nominationStart: new Date(d.nominationStart).toISOString(),
      nominationEnd:   new Date(d.nominationEnd).toISOString(),
      votingStart:     new Date(d.votingStart).toISOString(),
      votingEnd:       new Date(d.votingEnd).toISOString(),
      allowSelfVote: d.allowSelfVote,
      positions: d.positions.map(p => ({
        id: _uid(), title: p.title, seats: p.seats,
        eligibleClassIds: p.eligibleClassIds,
        minAttendancePct: p.minAttendancePct,
        description: p.description,
      })),
      resultsPublished: false,
      createdBy: req.jwtUser.userId || null,
      createdAt: _now(),
    };
    await tenantModel('council_elections', ctx).create(doc);
    AuditService.log({
      action: 'council.election.created', actor: req.jwtUser, schoolId,
      target: { type: 'council_election', id: doc.id }, details: { title: doc.title }, req,
    });
    return created(res, doc);
  } catch (err) {
    console.error('[council POST /admin/elections]', err);
    return E.serverError(res);
  }
});

router.patch('/admin/elections/:id', rbac('council', 'update'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const doc = await tenantModel('council_elections', ctx).findOne({ id: req.params.id }).lean();
    if (!doc) return E.notFound(res, 'Election not found.');
    const update = {};
    for (const field of ['nominationStart', 'nominationEnd', 'votingStart', 'votingEnd']) {
      if (req.body?.[field]) update[field] = new Date(req.body[field]).toISOString();
    }
    if (typeof req.body?.allowSelfVote === 'boolean') update.allowSelfVote = req.body.allowSelfVote;
    if (typeof req.body?.resultsPublished === 'boolean') update.resultsPublished = req.body.resultsPublished;
    if (req.body?.phase === 'closed') update.phase = 'closed';
    if (!Object.keys(update).length) return E.badRequest(res, 'Nothing to update.');
    await tenantModel('council_elections', ctx).updateOne({ id: doc.id }, { $set: update });
    const fresh = await tenantModel('council_elections', ctx).findOne({ id: doc.id }).lean();
    return ok(res, { ...fresh, phase: effectiveElectionPhase(fresh, new Date()) });
  } catch (err) {
    console.error('[council PATCH /admin/elections/:id]', err);
    return E.serverError(res);
  }
});

router.get('/admin/elections/:id/candidates', rbac('council', 'read'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const rows = await tenantModel('council_candidates', ctx).find({ electionId: req.params.id }).sort({ createdAt: -1 }).lean();
    return ok(res, rows);
  } catch (err) {
    console.error('[council GET candidates]', err);
    return E.serverError(res);
  }
});

router.post('/admin/elections/:id/candidates/:cid/vet', rbac('council', 'update'), async (req, res) => {
  const parsed = VetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid vetting decision.' } });
  }
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const candidate = await tenantModel('council_candidates', ctx)
      .findOne({ id: req.params.cid, electionId: req.params.id })
      .lean();
    if (!candidate) return E.notFound(res, 'Candidate not found.');
    if (!parsed.data.approve && !parsed.data.reason.trim()) {
      return E.badRequest(res, 'A rejection needs a reason — the candidate sees it.');
    }
    await tenantModel('council_candidates', ctx).updateOne(
      { id: candidate.id },
      { $set: { status: parsed.data.approve ? 'approved' : 'rejected', reason: parsed.data.reason, vettedBy: req.jwtUser.userId || null, vettedAt: _now() } },
    );
    AuditService.log({
      action: 'council.election.vetted', actor: req.jwtUser, schoolId,
      target: { type: 'council_candidate', id: candidate.id },
      details: { electionId: candidate.electionId, approve: parsed.data.approve }, req,
    });
    await _notifyStudent(ctx, schoolId, candidate.studentId, {
      subject: parsed.data.approve
        ? `Your nomination was approved — ${candidate.positionTitle}`
        : `Your nomination was not approved — ${candidate.positionTitle}`,
      body: parsed.data.approve
        ? 'You are on the ballot. Good luck.'
        : (parsed.data.reason || 'Speak to the council patron for the reason.'),
    }).catch(() => {});
    return ok(res, { status: parsed.data.approve ? 'approved' : 'rejected' });
  } catch (err) {
    console.error('[council POST vet]', err);
    return E.serverError(res);
  }
});

router.post('/admin/elections/:id/close', rbac('council', 'update'), async (req, res) => {
  try {
    const ctx = tenantContext(req);
    const { schoolId } = req.jwtUser;
    const election = await tenantModel('council_elections', ctx).findOne({ id: req.params.id }).lean();
    if (!election) return E.notFound(res, 'Election not found.');
    if (election.phase === 'closed') return E.badRequest(res, 'This election is already closed.');

    const [candidates, votes] = await Promise.all([
      tenantModel('council_candidates', ctx).find({ electionId: election.id, status: 'approved' }).lean(),
      tenantModel('council_votes', ctx).find({ electionId: election.id }).lean(),
    ]);

    const now = _now();
    const results = [];
    const winners = [];
    for (const position of election.positions || []) {
      const posCandidates = candidates.filter(c => c.positionId === position.id);
      const posVotes = votes.filter(v => v.positionId === position.id);
      const tally = tallySeats({ candidates: posCandidates, seats: position.seats, votes: posVotes });
      const byId = new Map(posCandidates.map(c => [c.id, c]));
      results.push({
        positionId: position.id,
        title: position.title,
        seats: position.seats,
        runoffRequired: tally.runoffRequired,
        candidates: tally.ranked.map(r => ({
          id: r.candidateId,
          name: byId.get(r.candidateId)?.studentName || 'Candidate',
          className: byId.get(r.candidateId)?.className || '',
          votes: r.votes,
        })),
        winners: tally.winnerIds.map(id => {
          const c = byId.get(id);
          return { id, studentId: c?.studentId, name: c?.studentName || 'Candidate' };
        }),
      });
      for (const id of tally.winnerIds) {
        const c = byId.get(id);
        if (c) winners.push({ student: c, position });
      }
    }

    await tenantModel('council_elections', ctx).updateOne(
      { id: election.id },
      { $set: { phase: 'closed', closedAt: now, results, resultsPublished: true } },
    );

    /* Elected seats replace any active seat the same student already held;
       previous elected memberships stay in the record as ended. */
    for (const { student, position } of winners) {
      await tenantModel('council_memberships', ctx).updateMany(
        { studentId: student.studentId, active: true },
        { $set: { active: false, endedAt: now } },
      );
      await tenantModel('council_memberships', ctx).create({
        id: _uid(),
        schoolId,
        studentId: student.studentId,
        studentName: student.studentName,
        className: student.className || '',
        positionTitle: position.title,
        source: 'elected',
        electionId: election.id,
        termLabel: election.termLabel || '',
        active: true,
        appointedBy: null,
        createdAt: now,
      });
      await _notifyStudent(ctx, schoolId, student.studentId, {
        subject: `You were elected ${position.title}`,
        body: `Results for "${election.title}" are published. Welcome to the Student Council.`,
      }).catch(() => {});
    }

    AuditService.log({
      action: 'council.election.closed', actor: req.jwtUser, schoolId,
      target: { type: 'council_election', id: election.id },
      details: { winners: winners.length, results }, req,
    });
    return ok(res, { closed: true, results });
  } catch (err) {
    console.error('[council POST /admin/elections/:id/close]', err);
    return E.serverError(res);
  }
});

/* Local helpers kept at the bottom so the routes above read as policy. */

module.exports = router;


