/* ============================================================
   Grades / Assessment — shared constants and pure helpers
   ============================================================ */

export const ASSESSMENT_TYPES = ['CA', 'HW', 'MT', 'ET'];  // kept for legacy fallback
export const TERM_NUMBERS     = [1, 2, 3];

export const TYPE_LABELS = {
  CA: 'Continuous Assessment',
  HW: 'Homework / Assignment',
  MT: 'Mid-Term Exam',
  ET: 'End-Term Exam',
};

export const DEFAULT_WEIGHTS = { CA: 20, HW: 10, MT: 30, ET: 40 };

export const TYPE_PILL = {
  CA: 'bg-violet-50 text-violet-700 border-violet-200',
  HW: 'bg-purple-50 text-purple-700 border-purple-200',
  MT: 'bg-amber-50 text-amber-700 border-amber-200',
  ET: 'bg-red-50 text-red-700 border-red-200',
};

/** Default assessment types — mirrors server DEFAULT_CUSTOM_TYPES */
export const DEFAULT_CUSTOM_TYPES = [
  { key: 'CA', label: 'Continuous Assessment', weight: 20, instances: 2, color: 'violet' },
  { key: 'HW', label: 'Homework / Assignment',  weight: 10, instances: 2, color: 'purple' },
  { key: 'MT', label: 'Mid-Term Exam',           weight: 30, instances: 1, color: 'amber'  },
  { key: 'ET', label: 'End-Term Exam',           weight: 40, instances: 1, color: 'red'    },
];

/** Valid color names for assessment type pills */
export const VALID_TYPE_COLORS = [
  'violet','purple','amber','red','blue','emerald','sky','orange','rose','teal','indigo','cyan',
];

/** Tailwind classes for each color name */
export const COLOR_PILL = {
  violet:  'bg-violet-50  text-violet-700  border-violet-200',
  purple:  'bg-purple-50  text-purple-700  border-purple-200',
  amber:   'bg-amber-50   text-amber-700   border-amber-200',
  red:     'bg-red-50     text-red-700     border-red-200',
  blue:    'bg-blue-50    text-blue-700    border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sky:     'bg-sky-50     text-sky-700     border-sky-200',
  orange:  'bg-orange-50  text-orange-700  border-orange-200',
  rose:    'bg-rose-50    text-rose-700    border-rose-200',
  teal:    'bg-teal-50    text-teal-700    border-teal-200',
  indigo:  'bg-indigo-50  text-indigo-700  border-indigo-200',
  cyan:    'bg-cyan-50    text-cyan-700    border-cyan-200',
};

export const EXAM_LIMIT = 20;

export const EXAM_STATUS_CFG = {
  draft:       { label: 'Draft',       cls: 'bg-slate-100 text-slate-600 border-slate-200'      },
  scheduled:   { label: 'Scheduled',   cls: 'bg-blue-50   text-blue-700  border-blue-200'       },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50  text-amber-700 border-amber-200'      },
  active:      { label: 'Active',      cls: 'bg-violet-50 text-violet-700 border-violet-200'    },
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  moderated:   { label: 'Moderated',   cls: 'bg-sky-50    text-sky-700   border-sky-200'        },
  approved:    { label: 'Approved',    cls: 'bg-green-50  text-green-700 border-green-200'      },
  locked:      { label: 'Locked',      cls: 'bg-slate-100 text-slate-700 border-slate-300'      },
  published:   { label: 'Published',   cls: 'bg-indigo-50 text-indigo-700 border-indigo-200'    },
  archived:    { label: 'Archived',    cls: 'bg-slate-50  text-slate-500 border-slate-200'      },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-50    text-red-700   border-red-200'        },
};

import { PenLine, FileText, Settings2, Bell } from 'lucide-react';

export const TABS = [
  { key: 'entry',   label: 'Mark Entry',     Icon: PenLine,       roles: ['admin','superadmin','teacher','deputy','deputy_principal'] },
  { key: 'report',  label: 'Report Cards',   Icon: FileText,      roles: ['admin','superadmin','teacher','deputy','deputy_principal','parent','student'] },
  { key: 'config',  label: 'Configuration',  Icon: Settings2,     roles: ['admin','superadmin'] },
  { key: 'remind',  label: 'Reminders',      Icon: Bell,          roles: ['admin','superadmin','teacher','deputy','deputy_principal'] },
];

/** Built-in fallback grade scale (Kenya 8-4-4 / CBC reference).
 *  Schools can replace this with their own via ConfigTab → Grade Scales. */
export const DEFAULT_GRADE_SCALE = [
  { min: 80, grade: 'A',  points: 12, label: 'Excellent'     },
  { min: 75, grade: 'A-', points: 11, label: 'Very Good'     },
  { min: 70, grade: 'B+', points: 10, label: 'Good'          },
  { min: 65, grade: 'B',  points:  9, label: 'Above Average' },
  { min: 60, grade: 'B-', points:  8, label: 'Average'       },
  { min: 55, grade: 'C+', points:  7, label: 'Below Average' },
  { min: 50, grade: 'C',  points:  6, label: 'Pass'          },
  { min: 45, grade: 'C-', points:  5, label: 'Weak Pass'     },
  { min: 40, grade: 'D+', points:  4, label: 'Poor'          },
  { min: 35, grade: 'D',  points:  3, label: 'Very Poor'     },
  { min: 30, grade: 'D-', points:  2, label: 'Fail'          },
  { min:  0, grade: 'E',  points:  1, label: 'Very Fail'     },
];

/* ── Pure helpers ────────────────────────────────────────────── */
export function _round(n)      { return n == null ? null : Math.round((n + 1e-10) * 10) / 10; }
export function _pct(n)        { return n == null ? '—' : `${_round(n)}%`; }
export function _scoreColor(s) {
  if (s == null) return 'text-slate-400';
  if (s >= 70)   return 'text-emerald-600 font-semibold';
  if (s >= 50)   return 'text-amber-600 font-semibold';
  return 'text-red-500 font-semibold';
}

/**
 * Resolve a percentage score to a grade letter using a bands array.
 * Returns { grade, points, label } or null if score is null or no band matches.
 * @param {number|null} score  — percentage 0–100
 * @param {Array}       bands  — [{ min, grade, points, label }]
 */
export function _gradeFromScale(score, bands) {
  if (score == null || !bands || !bands.length) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const band   = sorted.find(b => score >= b.min);
  return band ? { grade: band.grade, points: band.points ?? 0, label: band.label ?? '' } : null;
}
