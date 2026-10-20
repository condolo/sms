/* ============================================================
   Settings — shared primitives
   Extracted from SettingsPage.jsx (2026-10) so the tabs that
   were split out into ./components/ can share the exact same
   helpers instead of each keeping a private copy that drifts.

   Nothing in here is behaviour-bearing beyond presentation: form
   field wrapper, toast, role pill, and the canonical role lists.
   ============================================================ */
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { SYSTEM_ROLE_LABELS, roleLabel, STAFF_ROLE_KEYS } from '@/utils/roleLabels.js';

/* ── Form field wrapper ───────────────────────────────────────── */
export function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

/* ── Input class helper ───────────────────────────────────────── */
export function iCls(err = false) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${err ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/10'} bg-white focus:outline-none focus:ring-2 text-slate-800 placeholder-slate-400 transition`;
}

/* ── Toast ─────────────────────────────────────────────────────── */
export function Toast({ msg, type = 'success', onDismiss }) {
  const isErr  = type === 'error';
  const isWarn = type === 'warning';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border shadow-sm ${
        isErr  ? 'bg-red-50    text-red-700    border-red-200'    :
        isWarn ? 'bg-amber-50  text-amber-700  border-amber-200'  :
                 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr || isWarn ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
      {msg}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={11} /></button>
    </motion.div>
  );
}

/* ── Role display constants ──────────────────────────────────────
   SYSTEM_ROLE_LABELS/roleLabel live in utils/roleLabels.js (2026-09)
   so HR and a user's own Profile page read the exact same defaults and
   the exact same school-level rename override, instead of each keeping
   an independent copy. ── */
export const SYSTEM_ROLE_COLORS = {
  superadmin:           { sel:'bg-red-600 text-white ring-red-600',          idle:'ring-slate-200 bg-white text-red-700'        },
  admin:                { sel:'bg-violet-600 text-white ring-violet-600',     idle:'ring-slate-200 bg-white text-violet-700'     },
  principal:            { sel:'bg-indigo-700 text-white ring-indigo-700',     idle:'ring-slate-200 bg-white text-indigo-800'     },
  deputy_principal:     { sel:'bg-indigo-600 text-white ring-indigo-600',     idle:'ring-slate-200 bg-white text-indigo-700'     },
  section_head:         { sel:'bg-purple-600 text-white ring-purple-600',     idle:'ring-slate-200 bg-white text-purple-700'     },
  teacher:              { sel:'bg-blue-600 text-white ring-blue-600',         idle:'ring-slate-200 bg-white text-blue-700'       },
  exams_officer:        { sel:'bg-cyan-600 text-white ring-cyan-600',         idle:'ring-slate-200 bg-white text-cyan-700'       },
  timetabler:           { sel:'bg-teal-600 text-white ring-teal-600',         idle:'ring-slate-200 bg-white text-teal-700'       },
  admissions_officer:   { sel:'bg-sky-600 text-white ring-sky-600',           idle:'ring-slate-200 bg-white text-sky-700'        },
  finance:              { sel:'bg-green-600 text-white ring-green-600',       idle:'ring-slate-200 bg-white text-green-700'      },
  hr:                   { sel:'bg-lime-600 text-white ring-lime-600',         idle:'ring-slate-200 bg-white text-lime-700'       },
  discipline_committee: { sel:'bg-orange-600 text-white ring-orange-600',     idle:'ring-slate-200 bg-white text-orange-700'     },
  parent:               { sel:'bg-emerald-600 text-white ring-emerald-600',   idle:'ring-slate-200 bg-white text-emerald-700'    },
  student:              { sel:'bg-amber-500 text-white ring-amber-500',       idle:'ring-slate-200 bg-white text-amber-700'      },
};

/* ── Role pills ────────────────────────────────────────────────── */
export const ROLE_PILL = {
  superadmin:           'bg-red-50 text-red-700 border-red-200',
  admin:                'bg-violet-50 text-violet-700 border-violet-200',
  deputy_principal:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  deputy:               'bg-indigo-50 text-indigo-700 border-indigo-200',  // legacy alias
  section_head:         'bg-purple-50 text-purple-700 border-purple-200',
  teacher:              'bg-blue-50 text-blue-700 border-blue-200',
  exams_officer:        'bg-cyan-50 text-cyan-700 border-cyan-200',
  timetabler:           'bg-teal-50 text-teal-700 border-teal-200',
  admissions_officer:   'bg-sky-50 text-sky-700 border-sky-200',
  finance:              'bg-green-50 text-green-700 border-green-200',
  hr:                   'bg-lime-50 text-lime-700 border-lime-200',
  discipline_committee: 'bg-orange-50 text-orange-700 border-orange-200',
  parent:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  student:              'bg-amber-50 text-amber-700 border-amber-200',
};

export function RolePill({ role, customRoles = [], roleLabels = {} }) {
  // Check if this is a custom role first
  const cr = customRoles.find(r => r.key === role);
  if (cr) {
    return (
      <span
        className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded border"
        style={{ backgroundColor: cr.color + '18', color: cr.color, borderColor: cr.color + '55' }}
      >
        {cr.label}
      </span>
    );
  }
  const label = roleLabel(role, roleLabels);
  const cls   = ROLE_PILL[role] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded border capitalize ${cls}`}>
      {label}
    </span>
  );
}

/* ── Canonical system role list ─────────────────────────────────
   Single source of truth — filter, invite form, and R&P all derive
   from this. Built on roleLabels.js's STAFF_ROLE_KEYS (the same list
   HR and Payroll use) plus the account types that aren't staff but
   still need a row here: 'superadmin' (platform-granted, still shown
   so it can be filtered/invited... see exclusions below) and the
   portal-only 'parent'/'student' roles. `deputy` kept as a legacy
   alias (backward compat) but does NOT appear in the UI — it is
   merged with deputy_principal.
   ─────────────────────────────────────────────────────────────── */
export const SYSTEM_ROLES = ['superadmin', ...STAFF_ROLE_KEYS, 'parent', 'student'];

// Roles that can never be deleted from the school (safety guard)
export const PROTECTED_ROLES = new Set(['superadmin', 'admin']);

// User filter groups — derived so they always stay in sync with SYSTEM_ROLES
// 'All roles' sentinel first; the rest come from SYSTEM_ROLES
export const USER_ROLE_GROUPS = [
  { value: '', label: 'All roles' },
  ...SYSTEM_ROLES.map(r => ({ value: r, label: SYSTEM_ROLE_LABELS[r] })),
];

/* ── Initials for the avatar chip ─────────────────────────────── */
export function initialsOf(nameOrEmail = '') {
  const source = String(nameOrEmail).trim();
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
