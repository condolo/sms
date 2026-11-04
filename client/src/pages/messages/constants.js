/* ============================================================
   Messages — shared display constants and helpers
   ============================================================ */
import { SYSTEM_ROLE_LABELS } from '@/utils/roleLabels.js';

export const PORTAL_ROLES = new Set(['parent', 'guardian', 'student']);

/* Mirrors server/routes/messages.js BROADCAST_ROLES. Kept in sync
   deliberately: the compose UI should never offer an audience the
   server will reject. */
export const BROADCAST_ROLES = new Set([
  'superadmin', 'admin', 'principal', 'deputy_principal', 'deputy',
  'section_head', 'teacher', 'hr',
]);

export const AUDIENCE_OPTIONS = [
  {
    value: 'all',
    label: 'Everyone',
    short: 'Whole school',
    desc: 'Every active account, including parents and students',
    tone: 'violet',
  },
  {
    value: 'teachers',
    label: 'Teachers',
    short: 'Teaching staff',
    desc: 'Teachers, section heads and deputies',
    tone: 'sky',
  },
  {
    value: 'parents',
    label: 'Parents',
    short: 'Guardians',
    desc: 'Parent and guardian portal accounts',
    tone: 'emerald',
  },
  {
    value: 'students',
    label: 'Students',
    short: 'Learners',
    desc: 'Student portal accounts',
    tone: 'amber',
  },
  {
    value: 'staff',
    label: 'Staff',
    short: 'Non-teaching & teaching',
    desc: 'All staff roles except parents and students',
    tone: 'rose',
  },
];

export const SCOPE_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'staff', label: 'Staff' },
  { value: 'parents', label: 'Parents' },
  { value: 'students', label: 'Students' },
];

export function isPortalRole(role) {
  return PORTAL_ROLES.has(role);
}

export function canBroadcast(role) {
  return BROADCAST_ROLES.has(role);
}

export function roleLabel(key) {
  if (!key) return '';
  return SYSTEM_ROLE_LABELS[key] || key.replace(/_/g, ' ');
}

export function initials(name = '?') {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

const AVATAR_TONES = [
  'from-violet-500 to-indigo-600',
  'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-fuchsia-500 to-purple-600',
  'from-cyan-500 to-sky-600',
];

export function avatarTone(name = '?') {
  return AVATAR_TONES[(name.charCodeAt(0) || 0) % AVATAR_TONES.length];
}

export function audienceLabel(value) {
  return AUDIENCE_OPTIONS.find(o => o.value === value)?.label
    ?? value?.replace(/_/g, ' ')
    ?? 'Direct';
}

/** Human-readable "to" line for a message, without exposing email addresses. */
export function recipientSummary(msg) {
  if (msg?.groupName) return msg.groupName;
  const recipients = msg?.recipients ?? [];
  const audiences = recipients.filter(r => r === 'all' || AUDIENCE_OPTIONS.some(o => o.value === r));
  if (audiences.length) {
    if (audiences.includes('all')) return 'Everyone';
    return audiences.map(audienceLabel).join(' + ');
  }
  const people = msg?.recipientUsers ?? [];
  if (people.length === 0) return 'Direct';
  if (people.length === 1) return people[0].name;
  return `${people[0].name} + ${people.length - 1} ${people.length === 2 ? 'other' : 'others'}`;
}

export function recipientNames(msg) {
  return (msg?.recipientUsers ?? []).map(u => u.name);
}

export function participantsForReply(msg, { includeAll = false } = {}) {
  if (msg?.groupId) return { groupId: msg.groupId };
  const ids = new Set();
  if (msg?.senderId) ids.add(msg.senderId);
  if (includeAll) {
    for (const u of msg?.recipientUsers ?? []) ids.add(u.id);
  }
  return { ids: [...ids].filter(Boolean) };
}

export function reSubject(subject) {
  if (!subject) return 'Re:';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function fmtListDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtFullDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function matchesSearch(msg, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const haystack = [
    msg.subject,
    msg.body,
    msg.senderName,
    msg.groupName,
    ...(msg.recipientUsers ?? []).map(u => u.name),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

/* ══════════════════════════════════════════════════════════════
   Rich message extras — mirrors server/utils/message-extras.js
   kind | dueAt | context | attachment | poll. Everything here is
   optional: an old plain message reads exactly as it did before.
   ══════════════════════════════════════════════════════════════ */

/** The kinds a compose can send, in the order the UI offers them. */
export const MESSAGE_KINDS = [
  { value: 'text',     label: 'Message',  desc: 'A plain note',              tone: 'slate' },
  { value: 'reminder', label: 'Reminder', desc: 'A nudge, with a due date',   tone: 'amber' },
  { value: 'homework', label: 'Homework', desc: 'An assignment and deadline', tone: 'sky' },
  { value: 'results',  label: 'Results',  desc: 'Marks or a report card',     tone: 'emerald' },
  { value: 'poll',     label: 'Poll',     desc: 'A question with options',    tone: 'violet' },
];

export const CONTEXT_TYPES = [
  { value: 'general',    label: 'Note' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'homework',   label: 'Homework' },
  { value: 'results',    label: 'Results' },
];

export function kindMeta(kind) {
  return MESSAGE_KINDS.find(k => k.value === kind) ?? MESSAGE_KINDS[0];
}

export function isRichKind(kind) {
  return Boolean(kind) && kind !== 'text';
}

/** Poll rules, shared with the server so the UI can't build a rejected poll. */
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;

/** Attachment cap — server/utils/message-extras.js ATTACHMENT_MAX_BYTES. */
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The poll as THIS reader sees it.
 *
 * Two server shapes reach the client and both are handled here rather than
 * at each call site:
 *   • thread reads  — already projected (myVote/totalVotes/closed)
 *   • inbox lists   — raw `poll.votes` (every voter's choice), because the
 *                     list route returns whole documents
 * Returns null when there is no poll to show.
 */
export function pollForReader(msg, userId) {
  const poll = msg?.poll;
  if (!poll || !Array.isArray(poll.options)) return null;

  const projected = typeof poll.totalVotes === 'number'
    && poll.options.every(o => typeof o.votes === 'number');
  const closed = typeof poll.closed === 'boolean'
    ? poll.closed
    : Boolean(poll.closesAt && Date.parse(poll.closesAt) < Date.now());

  if (projected) {
    return {
      question: poll.question ?? '',
      options: poll.options,
      totalVotes: poll.totalVotes,
      myVote: poll.myVote ?? null,
      closed,
      closesAt: poll.closesAt ?? null,
    };
  }

  const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  const counts = {};
  for (const optionId of Object.values(votes)) {
    counts[optionId] = (counts[optionId] || 0) + 1;
  }
  return {
    question: poll.question ?? '',
    options: poll.options.map(o => ({ id: o.id, text: o.text, votes: counts[o.id] || 0 })),
    totalVotes: Object.keys(votes).length,
    myVote: votes[userId] ?? null,
    closed,
    closesAt: poll.closesAt ?? null,
  };
}

/** The extras a card should render, with the poll already per-reader. */
export function extrasFor(msg, userId) {
  return {
    kind: msg?.kind ?? 'text',
    dueAt: msg?.dueAt ?? null,
    context: msg?.context ?? null,
    attachment: msg?.attachment ?? null,
    poll: pollForReader(msg, userId),
  };
}

/** Yes/no: does this message carry anything beyond its text? */
export function hasExtras(msg, userId) {
  const { kind, dueAt, context, attachment, poll } = extrasFor(msg, userId);
  return isRichKind(kind) || Boolean(dueAt) || Boolean(context) || Boolean(attachment) || Boolean(poll);
}

export function fmtFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "due Fri, Mar 6, 4:00 PM" plus a lead that says whether it has passed. */
export function fmtDue(iso) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const label = at.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const diffMs = at.getTime() - Date.now();
  const dayMs = 86_400_000;
  let lead = null;
  if (diffMs < 0) lead = 'overdue';
  else if (diffMs < dayMs) lead = 'today';
  else if (diffMs < 2 * dayMs) lead = 'tomorrow';
  else lead = `in ${Math.round(diffMs / dayMs)} days`;
  return { label, lead, past: diffMs < 0 };
}

export function contextTypeLabel(type) {
  return CONTEXT_TYPES.find(c => c.value === type)?.label ?? 'Note';
}

