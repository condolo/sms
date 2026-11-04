/* ============================================================
   Msingi — Rich message extras

   A message is still ONE document addressed to its recipients; these
   fields only change what that document carries and how it renders:

     kind        text | reminder | homework | results | poll
     dueAt       reminder/homework deadline (ISO)
     context     where a starter came from (attendance, results…)
     attachment  { id, name, mimeType, size } — bytes live in
                 message_attachments, never in the thread read
     poll        { question, options[{id,text}], votes{userId:optionId} }

   Everything is optional, so a plain sentence stays the default and
   older rows read exactly as they did. Validation lives here so the
   teacher send route and any future compose route cannot drift.
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');

const KINDS = new Set(['text', 'reminder', 'homework', 'results', 'poll']);
const CONTEXT_TYPES = new Set(['attendance', 'homework', 'results', 'general']);

const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024; // base64 travels in a 10MB JSON body
const POLL_MIN_OPTIONS = 2;
const POLL_MAX_OPTIONS = 6;

function _text(value, max) {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > max ? null : s;
}

/* Only the shape we can actually serve back: data:<type>;base64,<bytes>. */
function _parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) return null;
  const base64 = match[2].replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > ATTACHMENT_MAX_BYTES) return null;
  return { mimeType: match[1], base64, size: bytes.length };
}

/**
 * Read the optional rich fields off a request body.
 * Returns { extras, attachmentBlob } or { error } — the route decides the HTTP.
 * `attachmentBlob` is null unless a document was attached.
 */
function readExtras(input = {}) {
  const kind = input.kind == null || input.kind === '' ? 'text' : String(input.kind);
  if (!KINDS.has(kind)) return { error: 'Unknown message kind.' };

  let dueAt = null;
  if (input.dueAt != null && input.dueAt !== '') {
    const at = Date.parse(String(input.dueAt));
    if (Number.isNaN(at)) return { error: 'That due date is not a real date.' };
    dueAt = new Date(at).toISOString();
  }

  let context = null;
  if (input.context && typeof input.context === 'object') {
    const type = CONTEXT_TYPES.has(String(input.context.type)) ? String(input.context.type) : 'general';
    const title = _text(input.context.title, 120);
    const detail = input.context.detail == null ? '' : _text(input.context.detail, 300);
    if (title === null || detail === null) return { error: 'That message context is too long.' };
    if (title) context = { type, title, detail: detail || '' };
  }

  let poll = null;
  if (kind === 'poll') {
    const question = _text(input.poll && input.poll.question, 140);
    if (!question) return { error: 'Write the poll question.' };
    const raw = Array.isArray(input.poll && input.poll.options) ? input.poll.options : [];
    const seen = new Set();
    const options = [];
    for (const option of raw) {
      const text = _text(option, 80);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ id: uuidv4(), text });
    }
    if (options.length < POLL_MIN_OPTIONS) return { error: 'A poll needs at least two different options.' };
    if (options.length > POLL_MAX_OPTIONS) return { error: `A poll can have at most ${POLL_MAX_OPTIONS} options.` };
    let closesAt = null;
    if (input.poll.closesAt != null && input.poll.closesAt !== '') {
      const at = Date.parse(String(input.poll.closesAt));
      if (Number.isNaN(at)) return { error: 'That poll closing date is not a real date.' };
      closesAt = new Date(at).toISOString();
    }
    poll = { question, options, votes: {}, closesAt };
  } else if (input.poll != null) {
    return { error: 'Only a poll message can carry poll options.' };
  }

  let attachment = null;
  let attachmentBlob = null;
  if (input.attachment && typeof input.attachment === 'object') {
    if (kind === 'poll') return { error: 'A poll cannot carry a document.' };
    const name = _text(input.attachment.name, 120);
    if (!name) return { error: 'Give the document a name.' };
    const parsed = _parseDataUrl(input.attachment.dataUrl);
    if (!parsed) return { error: 'That document could not be read (it must be 4 MB or smaller).' };
    attachment = { id: uuidv4(), name, mimeType: parsed.mimeType, size: parsed.size };
    attachmentBlob = { name, mimeType: parsed.mimeType, size: parsed.size, data: parsed.base64 };
  }

  return {
    extras: { kind, dueAt, context, attachment, poll },
    attachmentBlob,
  };
}

/** The poll as THIS reader sees it: their own choice plus honest counts. */
function pollView(poll, userId) {
  if (!poll || !Array.isArray(poll.options)) return null;
  const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  const counts = {};
  for (const optionId of Object.values(votes)) {
    counts[optionId] = (counts[optionId] || 0) + 1;
  }
  return {
    question: poll.question || '',
    options: poll.options.map((o) => ({ id: o.id, text: o.text, votes: counts[o.id] || 0 })),
    totalVotes: Object.keys(votes).length,
    myVote: votes[userId] || null,
    closed: Boolean(poll.closesAt && Date.parse(poll.closesAt) < Date.now()),
  };
}

/** The extras as a thread read should return them (poll is per reader). */
function messageExtras(message, userId) {
  return {
    kind: message.kind || 'text',
    dueAt: message.dueAt || null,
    context: message.context || null,
    attachment: message.attachment
      ? {
          id: message.attachment.id,
          name: message.attachment.name,
          mimeType: message.attachment.mimeType,
          size: message.attachment.size,
        }
      : null,
    poll: message.kind === 'poll' ? pollView(message.poll, userId) : null,
  };
}

module.exports = {
  KINDS,
  ATTACHMENT_MAX_BYTES,
  readExtras,
  pollView,
  messageExtras,
};
