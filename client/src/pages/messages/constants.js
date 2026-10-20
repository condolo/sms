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
