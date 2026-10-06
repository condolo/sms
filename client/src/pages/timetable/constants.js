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

// SECTIONS and BELL_SECTIONS used to live here as a hardcoded
// kg/primary/secondary/alevel list — removed. Real, per-school section
// data comes from useSections() (client/src/hooks/useSections.js),
// which reflects what each school actually configured under Classes →
// Sections, not a fixed generic set. inferSection() below is a
// different, narrower thing — a best-effort guess for a legacy class
// with no stored sectionKey at all, not a source of truth.

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

/* ── Time bands ──────────────────────────────────────────────────
   A teacher's or a room's grid is drawn from the clock times its own
   lessons run at, not from one bell schedule. Each lesson already
   carries its startTime/endTime (copied from its class's schedule when
   it was created, and re-synced when a schedule changes). Two lessons
   in the same band start and end together. Overlapping lessons fall in
   different bands, so the overlap is visible. */
export const UNTIMED_BAND = '__untimed';

export function bandKeyOf(slot) {
  return slot.startTime && slot.endTime ? `${slot.startTime}-${slot.endTime}` : UNTIMED_BAND;
}

/** The distinct time bands these slots use, in clock order. Untimed slots go last. */
export function timeBandsFromSlots(slots = []) {
  const seen = new Map();
  let untimed = false;
  for (const s of slots) {
    if (!s.startTime || !s.endTime) { untimed = true; continue; }
    const key = bandKeyOf(s);
    if (!seen.has(key)) seen.set(key, { key, start: s.startTime, end: s.endTime });
  }
  const bands = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  if (untimed) bands.push({ key: UNTIMED_BAND, start: null, end: null });
  return bands;
}

/** { [day]: { [bandKey]: slot[] } } */
export function buildBandMap(slots = []) {
  const m = {};
  for (const s of slots) {
    const day = (s.day || '').toLowerCase();
    const key = bandKeyOf(s);
    if (!m[day]) m[day] = {};
    if (!m[day][key]) m[day][key] = [];
    m[day][key].push(s);
  }
  return m;
}
