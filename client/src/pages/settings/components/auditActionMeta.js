/* ============================================================
   Audit log — action presentation metadata

   The audit log stores machine action names ("report_card.publish").
   Those are great for grepping the server logs and terrible for a
   human scanning a table, so this module turns one into:

     • a readable label      — "Report Card · Publish"
     • a category            — "report_card"
     • an icon               — picked from the category

   New action types are added server-side all the time (see
   server/services/audit.js ACTIONS). Nothing here needs updating
   when one appears: unknown categories fall back to a generic icon
   and the label is derived from the name itself.
   ============================================================ */
import {
  KeyRound, Users, SlidersHorizontal, GraduationCap, UserPlus,
  Stethoscope, Package, FileText, Receipt, CalendarDays, Banknote,
  Award, UsersRound, ShieldAlert, Activity, LifeBuoy, Sparkles,
} from 'lucide-react';

/* ── Severity presentation ────────────────────────────────────── */
export const SEVERITY_META = {
  info: {
    label: 'Info',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    dot:   'bg-sky-500',
    bar:   'bg-sky-400',
  },
  warn: {
    label: 'Warning',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot:   'bg-amber-500',
    bar:   'bg-amber-400',
  },
  critical: {
    label: 'Critical',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot:   'bg-red-500',
    bar:   'bg-red-400',
  },
};

export const SEVERITY_ORDER = ['critical', 'warn', 'info'];

export function severityMeta(sev) {
  return SEVERITY_META[sev] ?? SEVERITY_META.info;
}

/* ── Category icons ───────────────────────────────────────────── */
const CATEGORY_ICONS = {
  auth:          KeyRound,
  user:          Users,
  settings:      SlidersHorizontal,
  student:       GraduationCap,
  admissions:    UserPlus,
  medical:       Stethoscope,
  inventory:     Package,
  report_card:   FileText,
  finance:       Receipt,
  leave:         CalendarDays,
  payroll:       Banknote,
  marks:         Award,
  behaviour:     UsersRound,
  platform:      ShieldAlert,
  support:       LifeBuoy,
  demo:          Sparkles,
};

export function actionCategory(action = '') {
  return String(action).split('.')[0] || 'event';
}

export function actionIcon(action = '') {
  return CATEGORY_ICONS[actionCategory(action)] ?? Activity;
}

/* ── Human label ──────────────────────────────────────────────── */
function _titleCase(word = '') {
  return word
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function actionLabel(action = '') {
  const parts = String(action).split('.').filter(Boolean);
  if (!parts.length) return 'Unknown action';
  if (parts.length === 1) return _titleCase(parts[0]);
  return `${_titleCase(parts[0])} · ${_titleCase(parts.slice(1).join('.'))}`;
}

/* ── Relative time ────────────────────────────────────────────── */
export function relativeTime(value) {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const diff = Date.now() - then.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1)     return 'just now';
  if (mins < 60)    return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)   return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7)     return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5)    return `${weeks}w ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
