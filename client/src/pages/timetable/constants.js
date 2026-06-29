/* ============================================================
   Timetable — shared constants, pure helpers, and lookup maps
   Imported by TimetablePage and all sub-components.
   ============================================================ */

/* ── Days ──────────────────────────────────────────────────── */
export const DAYS      = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri' };
export const DAY_FULL  = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };

/* ── Default bell schedule (fallback when no custom schedule) ── */
export const DEFAULT_BELL = [
  { p: '1', start: '07:30', end: '08:30', label: 'Period 1',    isBreak: false },
  { p: '2', start: '08:30', end: '09:30', label: 'Period 2',    isBreak: false },
  { p: '3', start: '09:30', end: '10:30', label: 'Period 3',    isBreak: false },
  { p: 'B', start: '10:30', end: '11:00', label: 'Short Break', isBreak: true  },
  { p: '4', start: '11:00', end: '12:00', label: 'Period 4',    isBreak: false },
  { p: '5', start: '12:00', end: '13:00', label: 'Period 5',    isBreak: false },
  { p: 'L', start: '13:00', end: '14:00', label: 'Lunch',       isBreak: true  },
  { p: '6', start: '14:00', end: '15:00', label: 'Period 6',    isBreak: false },
  { p: '7', start: '15:00', end: '16:00', label: 'Period 7',    isBreak: false },
  { p: '8', start: '16:00', end: '17:00', label: 'Period 8',    isBreak: false },
];

/* ── Slot colour palette (deterministic by subject name) ─────── */
export const PALETTE = [
  { bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-700',  sub: 'text-violet-500'  },
  { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    sub: 'text-blue-500'    },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', sub: 'text-emerald-500' },
  { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   sub: 'text-amber-500'   },
  { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    sub: 'text-rose-500'    },
  { bg: 'bg-indigo-50',  border: 'border-indigo-200',  text: 'text-indigo-700',  sub: 'text-indigo-500'  },
  { bg: 'bg-teal-50',    border: 'border-teal-200',    text: 'text-teal-700',    sub: 'text-teal-500'    },
  { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-700',  sub: 'text-orange-500'  },
];
export function slotColor(subject = '') {
  return PALETTE[(subject.charCodeAt(0) || 0) % PALETTE.length];
}

/* ── Section inference from class name ────────────────────────── */
export function inferSection(name = '') {
  const n = name.toLowerCase();
  if (/kinder|^kg|^pp\s?[12]|nursery|playgroup/i.test(n)) return 'kg';
  if (/grade [1-6]|std [1-6]|class [1-6]|primary|year [1-6]/i.test(n)) return 'primary';
  if (/form [1-4]|grade [7-9]|year [7-9]|junior sec/i.test(n)) return 'secondary';
  if (/form [5-6]|year 1[0-3]|a.?level|sixth/i.test(n)) return 'alevel';
  return 'other';
}

export const SECTIONS = [
  { id: 'all',       label: 'All Sections' },
  { id: 'kg',        label: 'Kindergarten' },
  { id: 'primary',   label: 'Primary'      },
  { id: 'secondary', label: 'Secondary'    },
  { id: 'alevel',    label: 'A-Level'      },
  { id: 'other',     label: 'Other'        },
];

export const BELL_SECTIONS = [
  { id: 'all',       label: 'School Default', desc: 'Used by all sections without a custom schedule' },
  { id: 'kg',        label: 'Kindergarten',   desc: 'Early years — typically shorter periods'        },
  { id: 'primary',   label: 'Primary',        desc: 'Grades 1–6 or equivalent'                       },
  { id: 'secondary', label: 'Secondary',      desc: 'Form 1–4 or Grades 7–9'                        },
  { id: 'alevel',    label: 'A-Level',        desc: 'Form 5–6 / Year 10–13'                         },
];

export const ABSENCE_REASONS = [
  { v: 'sick',      l: 'Sick Leave'    },
  { v: 'personal',  l: 'Personal'      },
  { v: 'training',  l: 'Training'      },
  { v: 'emergency', l: 'Emergency'     },
  { v: 'official',  l: 'Official Duty' },
  { v: 'other',     l: 'Other'         },
];

/* ── Slot lookup map: { [day]: { [period]: slot } } ─────────── */
export function buildSlotMap(slots = []) {
  const m = {};
  slots.forEach(s => {
    const d = (s.day || '').toLowerCase();
    const p = String(s.period);
    if (!m[d]) m[d] = {};
    m[d][p] = s;
  });
  return m;
}
