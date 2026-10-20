/* ============================================================
   User-facing support tickets — /api/support

   Any authenticated school user can raise a ticket and follow their own
   thread: staff, parents and students. The platform console remains the
   agent side (it reads the same `tickets` collection).

   Visibility rules:
     • a user only ever sees tickets where requesterUserId === their own id
     • internal operator notes (message.internal === true) are never
       returned to the requester
     • a reply reopens a resolved ticket; a closed ticket is read-only
   ============================================================ */
'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { _model } = require('../utils/model');
const AuditService = require('../services/audit');
const { ok, E } = require('../utils/response');

const router = express.Router();

const CATEGORIES = ['support', 'bug', 'billing', 'feature'];
const PRIORITIES = ['low', 'normal', 'high'];

const CreateSchema = z.object({
  subject:     z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional().or(z.literal('')),
  category:    z.enum(CATEGORIES).optional(),
  priority:    z.enum(PRIORITIES).optional(),
});

const ReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

/* Per-user limits (not per IP): a shared school NAT must not lock out a
   whole staffroom because one person opened several tickets. */
const createLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.jwtUser?.userId || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'You have opened several tickets today. Please wait for a reply or contact your school administrator.' } },
});

const replyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.jwtUser?.userId || req.ip,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many replies — please wait a moment.' } },
});

router.use(authMiddleware);

function _requireSchoolUser(req, res) {
  if (!req.jwtUser?.schoolId) {
    E.forbidden(res, 'Support tickets are available to school accounts.');
    return false;
  }
  return true;
}

function _publicMessages(ticket) {
  return (ticket.messages || []).filter(m => !m.internal);
}

function _summary(ticket) {
  const msgs = _publicMessages(ticket);
  return {
    id:            ticket.id,
    ref:           ticket.ref,
    subject:       ticket.subject,
    description:   ticket.description,
    category:      ticket.category,
    priority:      ticket.priority,
    status:        ticket.status,
    createdAt:     ticket.createdAt,
    updatedAt:     ticket.updatedAt,
    resolvedAt:    ticket.resolvedAt || null,
    messageCount:  msgs.length,
    lastMessageAt: msgs.length ? msgs[msgs.length - 1].createdAt : null,
  };
}

async function _nextRef() {
  const seq = await _model('tickets').countDocuments({});
  return `TCK-${String(seq + 1).padStart(4, '0')}`;
}

/* POST /api/support/tickets — open a ticket */
router.post('/tickets', createLimiter, async (req, res) => {
  if (!_requireSchoolUser(req, res)) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return E.validation(res, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  }

  try {
    const { userId, schoolId, role, email } = req.jwtUser;
    const school = await _model('schools').findOne({ id: schoolId }, { name: 1, adminEmail: 1 }).lean().catch(() => null);
    const user = await _model('users').findOne({ id: userId, schoolId }, { name: 1, email: 1, username: 1 }).lean().catch(() => null);
    const requesterName = user?.name || req.jwtUser.name || user?.username || 'School user';
    const requesterEmail = user?.email || email || null;
    const now = new Date().toISOString();

    const ticket = {
      id: `tck_${crypto.randomUUID()}`,
      ref: await _nextRef(),
      subject: parsed.data.subject,
      description: parsed.data.description || '',
      category: parsed.data.category || 'support',
      priority: parsed.data.priority || 'normal',
      status: 'open',
      source: 'user',
      requesterUserId: userId,
      requesterName,
      requesterEmail,
      requesterRole: role,
      schoolId,
      schoolName: school?.name || null,
      tenantId: null,
      demoRequestId: null,
      assignee: null,
      tags: [],
      messages: [],
      slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    await _model('tickets').create(ticket);

    AuditService.log({
      action: 'support.ticket.created',
      actor: { userId, role, email: requesterEmail },
      schoolId,
      target: { type: 'ticket', id: ticket.id, label: ticket.ref },
      details: { category: ticket.category, priority: ticket.priority },
      req,
    });

    return res.status(201).json({ success: true, data: _summary(ticket) });
  } catch (err) {
    console.error('[support POST /tickets]', err);
    return E.serverError(res);
  }
});

/* GET /api/support/tickets — my tickets */
router.get('/tickets', async (req, res) => {
  if (!_requireSchoolUser(req, res)) return;
  try {
    const { userId, schoolId } = req.jwtUser;
    const tickets = await _model('tickets')
      .find({ schoolId, requesterUserId: userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return ok(res, tickets.map(_summary));
  } catch (err) {
    console.error('[support GET /tickets]', err);
    return E.serverError(res);
  }
});

/* GET /api/support/tickets/:id — my ticket + public thread */
router.get('/tickets/:id', async (req, res) => {
  if (!_requireSchoolUser(req, res)) return;
  try {
    const { userId, schoolId } = req.jwtUser;
    const ticket = await _model('tickets').findOne({ id: req.params.id, schoolId, requesterUserId: userId }).lean();
    if (!ticket) return E.notFound(res, 'Ticket not found');
    return ok(res, {
      ..._summary(ticket),
      messages: _publicMessages(ticket),
    });
  } catch (err) {
    console.error('[support GET /tickets/:id]', err);
    return E.serverError(res);
  }
});

/* POST /api/support/tickets/:id/messages — requester reply */
router.post('/tickets/:id/messages', replyLimiter, async (req, res) => {
  if (!_requireSchoolUser(req, res)) return;
  const parsed = ReplySchema.safeParse(req.body);
  if (!parsed.success) return E.validation(res, [{ field: 'body', message: 'Message is required.' }]);

  try {
    const { userId, schoolId, role, email } = req.jwtUser;
    const Tickets = _model('tickets');
    const ticket = await Tickets.findOne({ id: req.params.id, schoolId, requesterUserId: userId }).lean();
    if (!ticket) return E.notFound(res, 'Ticket not found');
    if (ticket.status === 'closed') {
      return E.badRequest(res, 'This ticket is closed. Raise a new ticket if you need more help.');
    }

    const user = await _model('users').findOne({ id: userId, schoolId }, { name: 1, email: 1, username: 1 }).lean().catch(() => null);
    const message = {
      id: `msg_${crypto.randomUUID()}`,
      author: user?.name || req.jwtUser.name || user?.username || 'Requester',
      authorEmail: user?.email || email || null,
      authorType: 'requester',
      internal: false,
      body: parsed.data.body,
      createdAt: new Date().toISOString(),
    };
    const updated = await Tickets.findOneAndUpdate(
      { id: ticket.id },
      { $push: { messages: message }, $set: { status: 'open', updatedAt: message.createdAt } },
      { new: true }
    ).lean();

    return ok(res, { ..._summary(updated), messages: _publicMessages(updated) });
  } catch (err) {
    console.error('[support POST /tickets/:id/messages]', err);
    return E.serverError(res);
  }
});

module.exports = router;
// Exposed for unit tests — the visibility rule is the security boundary here.
module.exports._publicMessages = _publicMessages;
