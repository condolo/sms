/* ============================================================
   Msingi — Institutional Scheduling Engine
   v4.9.14: Multi-view timetable with global conflict detection,
   teacher workload engine, and true period-grid layout.

   Views: Class Grid | Teacher Schedule | Institution Overview
   ============================================================ */
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, X, Loader2, AlertTriangle, CheckCircle2,
  Trash2, User, LayoutGrid, Globe, BarChart3, ChevronRight,
  BookOpen, Clock, Home, Save, AlertCircle, Users, Zap,
} from 'lucide-react';
import {
  timetable    as ttApi,
  classes      as classesApi,
  teachers     as teachersApi,
  bellSchedule as bellApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import TimetablePortal from './TimetablePortal.jsx';

/* ── Days & Bell schedule ────────────────────────────────────── */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri' };
const DAY_FULL  = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };

const DEFAULT_BELL = [
  { p: '1', start: '07:30', end: '08:30', label: 'Period 1', isBreak: false },
  { p: '2', start: '08:30', end: '09:30', label: 'Period 2', isBreak: false },
  { p: '3', start: '09:30', end: '10:30', label: 'Period 3', isBreak: false },
  { p: 'B', start: '10:30', end: '11:00', label: 'Short Break', isBreak: true },
  { p: '4', start: '11:00', end: '12:00', label: 'Period 4', isBreak: false },
  { p: '5', start: '12:00', end: '13:00', label: 'Period 5', isBreak: false },
  { p: 'L', start: '13:00', end: '14:00', label: 'Lunch',    isBreak: true },
  { p: '6', start: '14:00', end: '15:00', label: 'Period 6', isBreak: false },
  { p: '7', start: '15:00', end: '16:00', label: 'Period 7', isBreak: false },
  { p: '8', start: '16:00', end: '17:00', label: 'Period 8', isBreak: false },
];

/* ── Slot colours (deterministic by subject) ─────────────────── */
const PALETTE = [
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', sub: 'text-violet-500' },
  { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   sub: 'text-blue-500'   },
  { bg: 'bg-emerald-50',border: 'border-emerald-200',text: 'text-emerald-700',sub: 'text-emerald-500' },
  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  sub: 'text-amber-500'  },
  { bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700',   sub: 'text-rose-500'   },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', sub: 'text-indigo-500' },
  { bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-700',   sub: 'text-teal-500'   },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', sub: 'text-orange-500' },
];
function slotColor(subject = '') {
  return PALETTE[(subject.charCodeAt(0) || 0) % PALETTE.length];
}

/* ── Section inference from class name ───────────────────────── */
function inferSection(name = '') {
  const n = name.toLowerCase();
  if (/kinder|^kg|^pp\s?[12]|nursery|playgroup/i.test(n)) return 'kg';
  if (/grade [1-6]|std [1-6]|class [1-6]|primary|year [1-6]/i.test(n)) return 'primary';
  if (/form [1-4]|grade [7-9]|year [7-9]|junior sec/i.test(n)) return 'secondary';
  if (/form [5-6]|year 1[0-3]|a.?level|sixth/i.test(n)) return 'alevel';
  return 'other';
}

const SECTIONS = [
  { id: 'all',       label: 'All Sections' },
  { id: 'kg',        label: 'Kindergarten' },
  { id: 'primary',   label: 'Primary'      },
  { id: 'secondary', label: 'Secondary'    },
  { id: 'alevel',    label: 'A-Level'      },
  { id: 'other',     label: 'Other'        },
];

/* ── Slot lookup map ─────────────────────────────────────────── */
function buildSlotMap(slots = []) {
  const m = {};
  slots.forEach(s => {
    const d = (s.day || '').toLowerCase();
    const p = String(s.period);
    if (!m[d]) m[d] = {};
    m[d][p] = s;
  });
  return m;
}

/* ── Shared input class ──────────────────────────────────────── */
const iCls = (err) =>
  `w-full text-sm px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition bg-white ${
    err ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'
  }`;

/* ══════════════════════════════════════════════════════════════
   SHARED PRIMITIVES
   ══════════════════════════════════════════════════════════════ */

function FField({ label, children, error }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

function Toast({ msg, type = 'success', onDismiss }) {
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border shadow-sm ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
      {msg}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={11} /></button>
    </motion.div>
  );
}

/* ── Slot card ───────────────────────────────────────────────── */
function SlotCard({ slot, onDelete, canEdit }) {
  const col = slotColor(slot.subject ?? '');
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      className={`h-full rounded-lg border px-2 py-1.5 group relative ${col.bg} ${col.border}`}
    >
      {canEdit && (
        <button
          onClick={() => onDelete(slot.id ?? slot._id)}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/80 text-slate-400 hover:text-red-500 transition"
        >
          <Trash2 size={10} />
        </button>
      )}
      <p className={`text-[11px] font-semibold leading-tight truncate pr-4 ${col.text}`}>
        {slot.subject || '—'}
      </p>
      {slot.teacherName && (
        <p className={`text-[10px] mt-0.5 truncate ${col.sub} opacity-80`}>{slot.teacherName}</p>
      )}
      {slot.room && (
        <p className={`text-[10px] truncate ${col.sub} opacity-60`}>{slot.room}</p>
      )}
    </motion.div>
  );
}

/* ── Empty cell (add trigger) ────────────────────────────────── */
function EmptyCell({ onAdd, canEdit }) {
  if (!canEdit) return <div className="h-full min-h-[64px]" />;
  return (
    <button
      onClick={onAdd}
      className="w-full h-full min-h-[64px] rounded-lg border border-dashed border-slate-150 flex items-center justify-center opacity-30 hover:opacity-80 hover:border-slate-300 hover:bg-slate-50 transition"
    >
      <Plus size={12} className="text-slate-400" />
    </button>
  );
}

/* ── Break row ───────────────────────────────────────────────── */
function BreakRow({ bell }) {
  return (
    <div className="flex border-b border-slate-100 bg-slate-50/40" style={{ minHeight: '28px' }}>
      <div className="flex items-center px-2 border-r border-slate-100" style={{ width: '88px', minWidth: '88px' }}>
        <span className="text-[9px] text-slate-400">{bell.start}</span>
      </div>
      <div className="flex-1 flex items-center px-3 gap-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">{bell.label}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
    </div>
  );
}

/* ── Period row ──────────────────────────────────────────────── */
function PeriodRow({ bell, slotMap, onDelete, onAdd, canEdit }) {
  return (
    <div className="flex border-b border-slate-100" style={{ minHeight: '72px' }}>
      {/* Time label */}
      <div
        className="flex flex-col justify-center px-2 border-r border-slate-100 shrink-0"
        style={{ width: '88px', minWidth: '88px' }}
      >
        <span className="text-[10px] font-bold text-slate-500">P{bell.p}</span>
        <span className="text-[9px] text-slate-400">{bell.start}</span>
        <span className="text-[9px] text-slate-400">–{bell.end}</span>
      </div>

      {/* Day cells */}
      {DAYS.map((day, i) => {
        const slot = slotMap[day]?.[bell.p];
        const isLast = i === DAYS.length - 1;
        return (
          <div
            key={day}
            className={`flex-1 p-1.5 ${isLast ? '' : 'border-r border-slate-100'}`}
            style={{ minWidth: 0 }}
          >
            {slot
              ? <SlotCard slot={slot} onDelete={onDelete} canEdit={canEdit} />
              : <EmptyCell onAdd={() => onAdd(day, bell.p)} canEdit={canEdit} />
            }
          </div>
        );
      })}
    </div>
  );
}

/* ── Timetable grid ──────────────────────────────────────────── */
function TimetableGrid({ slots, onDelete, onAdd, canEdit, bell = DEFAULT_BELL }) {
  const slotMap = buildSlotMap(slots);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Day header row */}
      <div className="flex bg-slate-50 border-b border-slate-200">
        <div className="shrink-0 border-r border-slate-200" style={{ width: '88px', minWidth: '88px' }} />
        {DAYS.map((day, i) => (
          <div
            key={day}
            className={`flex-1 py-2.5 text-center text-xs font-semibold text-slate-700 ${
              i < DAYS.length - 1 ? 'border-r border-slate-200' : ''
            }`}
          >
            <span className="hidden sm:inline">{DAY_FULL[day]}</span>
            <span className="sm:hidden">{DAY_SHORT[day]}</span>
          </div>
        ))}
      </div>

      {/* Period rows */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: '600px' }}>
          {bell.map(b =>
            b.isBreak
              ? <BreakRow key={b.p} bell={b} />
              : (
                <PeriodRow
                  key={b.p}
                  bell={b}
                  slotMap={slotMap}
                  onDelete={onDelete}
                  onAdd={onAdd}
                  canEdit={canEdit}
                />
              )
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Workload panel (right sidebar) ──────────────────────────── */
function WorkloadPanel({ onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable', 'workload'],
    queryFn:  () => ttApi.workload(),
    staleTime: 60_000,
  });
  const teachers = data?.data ?? [];
  const maxLoad  = teachers[0]?.total ?? 1;

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className="fixed right-0 top-0 h-full w-72 bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">Teacher Workload</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-3 bg-slate-100 rounded w-32 mb-1.5" />
              <div className="h-2 bg-slate-100 rounded w-full" />
            </div>
          ))
        ) : teachers.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">No lesson assignments yet.</p>
        ) : (
          teachers.map(t => {
            const pct  = Math.round((t.total / maxLoad) * 100);
            const over = t.total >= 30;
            const low  = t.total <= 10;
            return (
              <div key={t.teacherId}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700 truncate mr-2">
                    {t.teacherName || t.teacherId}
                  </span>
                  <span className={`text-[11px] font-semibold shrink-0 ${
                    over ? 'text-red-600' : low ? 'text-amber-500' : 'text-emerald-600'
                  }`}>
                    {t.total} lessons
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      over ? 'bg-red-400' : low ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Normal (11–29)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Light (&le;10)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Heavy (&ge;30)</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Conflicts panel ─────────────────────────────────────────── */
function ConflictsPanel({ conflicts, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-start justify-center pt-20 px-4"
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, y: -8 }} animate={{ scale: 1, y: 0 }}
        className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md z-50"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="text-red-500" />
            <span className="text-sm font-semibold text-slate-900">
              {conflicts.length} Scheduling Conflict{conflicts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
          {conflicts.map((c, i) => (
            <div key={i} className="px-5 py-3">
              {c.type === 'teacher_double_booked' ? (
                <>
                  <p className="text-xs font-medium text-red-600">Teacher double-booked</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {c.teacherName} — {DAY_FULL[c.day] ?? c.day}, Period {c.period}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium text-amber-600">Room double-booked</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Room: {c.room} — {DAY_FULL[c.day] ?? c.day}, Period {c.period}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 rounded-b-xl">
          <p className="text-[11px] text-slate-500">
            Resolve conflicts by removing and reassigning the affected slots.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Institution overview table ──────────────────────────────── */
function OverviewView({ classList }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable', 'overview'],
    queryFn:  () => ttApi.overview(),
    staleTime: 60_000,
  });
  const overviewClasses = data?.data?.classes ?? [];
  const totalSlots      = data?.data?.totalSlots ?? 0;

  const classMap = {};
  classList.forEach(c => { classMap[c._id ?? c.id] = c.name; });

  const rows = overviewClasses.map(oc => ({
    classId: oc.classId,
    name:    classMap[oc.classId] ?? oc.classId,
    total:   oc.total,
    byDay:   oc.byDay,
  })).sort((a, b) => a.name.localeCompare(b.name));

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 animate-pulse space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded" />)}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">All Classes</span>
        <span className="text-xs text-slate-400">{totalSlots} total lesson slots</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Class</th>
              {DAYS.map(d => (
                <th key={d} className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">
                  {DAY_SHORT[d]}
                </th>
              ))}
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-sm text-slate-400">
                  No timetable data yet.
                </td>
              </tr>
            ) : rows.map(row => (
              <tr key={row.classId} className="hover:bg-slate-50/50 transition">
                <td className="px-4 py-2.5 text-xs font-medium text-slate-800">{row.name}</td>
                {DAYS.map(d => (
                  <td key={d} className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-medium ${
                      (row.byDay[d] ?? 0) === 0
                        ? 'text-slate-300'
                        : 'text-slate-700'
                    }`}>
                      {row.byDay[d] ?? 0}
                    </span>
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center">
                  <span className="text-xs font-semibold text-slate-900">{row.total}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ADD SLOT SLIDE-OVER
   ══════════════════════════════════════════════════════════════ */
const EMPTY_FORM = { day: 'monday', period: '1', subject: '', teacherId: '', teacherName: '', room: '', type: 'lesson' };

function AddSlotSlideOver({ classId, defaults, onClose, onCreated, lessonPeriods = DEFAULT_BELL.filter(b => !b.isBreak) }) {
  const [form, setForm]     = useState({ ...EMPTY_FORM, ...defaults });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setForm(f => ({ ...f, ...defaults }));
  }, [defaults]);

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => { const n = { ...e }; delete n[k]; delete n._server; return n; });
  }

  /* Teachers dropdown */
  const { data: teachersData } = useQuery({
    queryKey: ['teachers', 'picker'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teachers = teachersData?.data ?? [];

  const { mutate, isPending } = useMutation({
    mutationFn: () => ttApi.create({
      classId,
      day:         form.day,
      period:      form.period,
      subject:     form.subject.trim() || undefined,
      teacherId:   form.teacherId || undefined,
      teacherName: form.teacherName.trim() || undefined,
      room:        form.room.trim() || undefined,
      type:        form.type,
    }),
    onSuccess: onCreated,
    onError:   err => setErrors({ _server: err?.message ?? 'Failed to add slot.' }),
  });

  function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.subject.trim()) errs.subject = 'Subject is required.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    mutate();
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add Lesson Slot</h2>
            <p className="text-xs text-slate-400 mt-0.5">Assign a lesson to the schedule</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{errors._server}</span>
            </div>
          )}

          <FField label="Subject *" error={errors.subject}>
            <input
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              placeholder="e.g. Mathematics"
              className={iCls(errors.subject)}
              autoFocus
            />
          </FField>

          <div className="grid grid-cols-2 gap-3">
            <FField label="Day">
              <select value={form.day} onChange={e => set('day', e.target.value)} className={iCls()}>
                {DAYS.map(d => <option key={d} value={d}>{DAY_FULL[d]}</option>)}
              </select>
            </FField>
            <FField label="Period">
              <select value={form.period} onChange={e => set('period', e.target.value)} className={iCls()}>
                {lessonPeriods.map(b => (
                  <option key={b.p} value={b.p}>P{b.p} · {b.start}</option>
                ))}
              </select>
            </FField>
          </div>

          <FField label="Teacher">
            <select
              value={form.teacherId}
              onChange={e => {
                const t = teachers.find(t => (t._id ?? t.id) === e.target.value);
                set('teacherId', e.target.value);
                set('teacherName', t ? `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() : '');
              }}
              className={iCls()}
            >
              <option value="">No teacher assigned</option>
              {teachers.map(t => (
                <option key={t._id ?? t.id} value={t._id ?? t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </FField>

          <FField label="Room">
            <input
              value={form.room}
              onChange={e => set('room', e.target.value)}
              placeholder="e.g. Lab 2, Hall A"
              className={iCls()}
            />
          </FField>

          <FField label="Slot type">
            <select value={form.type} onChange={e => set('type', e.target.value)} className={iCls()}>
              <option value="lesson">Lesson</option>
              <option value="assembly">Assembly</option>
              <option value="registration">Registration</option>
              <option value="free">Free period</option>
            </select>
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isPending}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isPending ? 'Adding…' : 'Add slot'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   BELL SCHEDULE SLIDE-OVER (admin only)
   Per-section tabs: School Default | KG | Primary | Secondary | A-Level
   Each section can have its own start/end times and period count.
   A section without its own schedule inherits from the school default.
   Connected to the cross-section teacher conflict detection engine —
   a teacher assigned across sections is checked for actual time overlap.
   ══════════════════════════════════════════════════════════════ */
const BELL_SECTIONS = [
  { id: 'all',       label: 'School Default', desc: 'Used by all sections without a custom schedule' },
  { id: 'kg',        label: 'Kindergarten',   desc: 'Early years — typically shorter periods' },
  { id: 'primary',   label: 'Primary',        desc: 'Grades 1–6 or equivalent' },
  { id: 'secondary', label: 'Secondary',      desc: 'Form 1–4 or Grades 7–9' },
  { id: 'alevel',    label: 'A-Level',        desc: 'Form 5–6 / Year 10–13' },
];

function BellScheduleSlideOver({ onClose }) {
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState('all');
  const [rows,  setRows]  = useState(null);   // null until data loads
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);

  /* Overview of which sections have custom schedules */
  const { data: sectionsData } = useQuery({
    queryKey: ['bell-schedule', 'sections'],
    queryFn:  () => bellApi.sections(),
    staleTime: 60_000,
  });
  const configuredSet = new Set(
    (sectionsData?.data ?? []).filter(s => s.configured).map(s => s.section),
  );

  /* Fetch the active section's schedule */
  const { data: bellData, isLoading } = useQuery({
    queryKey: ['bell-schedule', activeSection],
    queryFn:  () => bellApi.get(activeSection),
    staleTime: 60_000,
  });
  const effectivePeriods = bellData?.data?.periods ?? DEFAULT_BELL;
  const isCustom = bellData?.data?.section === activeSection; // has own schedule (not inherited)

  /* Seed edit rows when data arrives */
  useEffect(() => {
    setRows(effectivePeriods.map(p => ({ ...p })));
    setDirty(false);
  }, [bellData, activeSection]);

  function setRow(idx, key, val) {
    setRows(r => r.map((p, i) => i === idx ? { ...p, [key]: val } : p));
    setDirty(true);
  }
  function removeRow(idx) {
    setRows(r => r.filter((_, i) => i !== idx));
    setDirty(true);
  }
  function addBreak() {
    setRows(r => [...r, { p: `B${r.filter(x => x.isBreak).length + 1}`, start: '10:30', end: '11:00', label: 'Break', isBreak: true }]);
    setDirty(true);
  }
  function addPeriod() {
    const lessons = rows.filter(r => !r.isBreak);
    const nextNum = lessons.length + 1;
    setRows(r => [...r, { p: String(nextNum), start: '14:00', end: '15:00', label: `Period ${nextNum}`, isBreak: false }]);
    setDirty(true);
  }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => bellApi.update({ section: activeSection, periods: rows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bell-schedule'] });
      setDirty(false);
      setToast({ msg: `${BELL_SECTIONS.find(s => s.id === activeSection)?.label} schedule saved.`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save.', type: 'error' }),
  });

  const { mutate: revert, isPending: reverting } = useMutation({
    mutationFn: () => bellApi.remove(activeSection),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bell-schedule'] });
      setDirty(false);
      setToast({ msg: 'Reverted to school default.', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to revert.', type: 'error' }),
  });

  const iCls2 = 'text-xs px-2 py-1.5 rounded border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 w-full';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bell Schedules</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Per-section times · teachers checked for real time-overlap across sections
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition"><X size={18} /></button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 px-4 py-2.5 border-b border-slate-100 overflow-x-auto">
          {BELL_SECTIONS.map(s => {
            const hasCustom = configuredSet.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeSection === s.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                {s.label}
                {s.id !== 'all' && hasCustom && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Custom schedule" />
                )}
              </button>
            );
          })}
        </div>

        {/* Inherited notice for non-'all' sections without a custom schedule */}
        {activeSection !== 'all' && !isCustom && !isLoading && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
            <AlertTriangle size={12} className="shrink-0" />
            <span>Using school default. Edit below and save to create a custom schedule for this section.</span>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`mx-4 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border ${
            toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {toast.type === 'error' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
            {toast.msg}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {isLoading || !rows ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(8)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-lg" />)}
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="grid grid-cols-[40px_80px_80px_1fr_28px] gap-2 pb-1 border-b border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">Key</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">Start</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">End</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">Label</span>
                <span />
              </div>

              {rows.map((row, idx) => (
                <div
                  key={idx}
                  className={`grid grid-cols-[40px_80px_80px_1fr_28px] gap-2 items-center rounded-lg px-2 py-1.5 ${
                    row.isBreak ? 'bg-slate-50 border border-dashed border-slate-200' : 'bg-white border border-slate-200'
                  }`}
                >
                  <input value={row.p} onChange={e => setRow(idx, 'p', e.target.value)}
                    className={iCls2 + ' font-mono'} maxLength={6} title="Period key" />
                  <input type="time" value={row.start} onChange={e => setRow(idx, 'start', e.target.value)}
                    className={iCls2} />
                  <input type="time" value={row.end} onChange={e => setRow(idx, 'end', e.target.value)}
                    className={iCls2} />
                  <input value={row.label} onChange={e => setRow(idx, 'label', e.target.value)}
                    className={iCls2} maxLength={40} />
                  <button onClick={() => removeRow(idx)}
                    className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition">
                    <X size={12} />
                  </button>
                </div>
              ))}

              <div className="flex gap-2 pt-2">
                <button onClick={addPeriod}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition">
                  <Plus size={12} /> Add Period
                </button>
                <button onClick={addBreak}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-500 transition">
                  <Plus size={12} /> Add Break
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {rows && (
                <span className="text-[11px] text-slate-400">
                  {rows.filter(r => !r.isBreak).length} periods · {rows.filter(r => r.isBreak).length} breaks
                </span>
              )}
              {activeSection !== 'all' && isCustom && (
                <button
                  onClick={() => { if (window.confirm('Revert this section to the school default schedule?')) revert(); }}
                  disabled={reverting}
                  className="text-[11px] text-slate-400 hover:text-red-500 underline underline-offset-2 transition ml-2"
                >
                  {reverting ? 'Reverting…' : 'Revert to default'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">
                Close
              </button>
              <button
                onClick={() => save()}
                disabled={saving || !dirty || !rows?.length}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
const VIEWS = [
  { id: 'class',    label: 'Class Grid',    Icon: LayoutGrid },
  { id: 'teacher',  label: 'Teacher View',  Icon: User       },
  { id: 'overview', label: 'Institution',   Icon: Globe      },
];

export default function TimetablePage() {
  const qc   = useQueryClient();
  const can  = useAuthStore(s => s.can.bind(s));
  const role  = useAuthStore(s => s.session?.user?.role ?? '');
  const roles = useAuthStore(s => s.session?.user?.roles ?? []);
  const canEdit = can('timetable') || ['admin', 'superadmin', 'deputy', 'timetabler'].includes(role);

  // Non-admin roles get the read-only portal view
  const ADMIN_ROLES = new Set(['admin', 'superadmin', 'deputy', 'timetabler']);
  const isAdminRole = ADMIN_ROLES.has(role) || roles.some(r => ADMIN_ROLES.has(r));
  if (!isAdminRole) return <TimetablePortal />;

  /* ── Publish state ── */
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [termLabelInput,   setTermLabelInput]   = useState('');

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['timetable', 'status'],
    queryFn:  () => ttApi.status(),
    staleTime: 30_000,
  });
  const publishStatus = statusData?.data ?? { published: false };

  const [activeView,   setActiveView]   = useState('class');
  const [classId,      setClassId]      = useState('');
  const [section,      setSection]      = useState('all');
  const [teacherId,    setTeacherId]    = useState('');
  const [showAdd,      setShowAdd]      = useState(false);
  const [addDefaults,  setAddDefaults]  = useState({ day: 'monday', period: '1' });
  const [showWorkload, setShowWorkload] = useState(false);
  const [showConflicts,setShowConflicts]= useState(false);
  const [showBell,     setShowBell]     = useState(false);
  const [toast,        setToast]        = useState(null);

  /* ── Classes (fetched early so classSection can be derived) ── */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const filteredClasses = section === 'all'
    ? classList
    : classList.filter(c => inferSection(c.name) === section);

  const selectedClass = classList.find(c => (c._id ?? c.id) === classId);

  /* ── Bell schedule — section-aware ──────────────────────────
     When a class is selected, fetch the schedule for that class's
     section (KG / Primary / Secondary / A-Level).
     Falls back to 'all' school default if no custom schedule set.
  ─────────────────────────────────────────────────────────────── */
  const classSection = selectedClass ? inferSection(selectedClass.name) : 'all';
  const { data: bellData } = useQuery({
    queryKey: ['bell-schedule', classSection],
    queryFn:  () => bellApi.get(classSection),
    staleTime: 10 * 60_000,
  });
  const bell          = bellData?.data?.periods ?? DEFAULT_BELL;
  const lessonPeriods = bell.filter(b => !b.isBreak);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  /* ── Publish / Unpublish mutations ── */
  const { mutate: doPublish, isPending: publishing } = useMutation({
    mutationFn: () => ttApi.publish({ termLabel: termLabelInput }),
    onSuccess:  () => { refetchStatus(); setShowPublishModal(false); showToast('Timetable published — now visible to staff and parents.'); },
    onError:    err => showToast(err?.message ?? 'Failed to publish.', 'error'),
  });
  const { mutate: doUnpublish, isPending: unpublishing } = useMutation({
    mutationFn: () => ttApi.unpublish(),
    onSuccess:  () => { refetchStatus(); showToast('Timetable unpublished — hidden from portal users.'); },
    onError:    err => showToast(err?.message ?? 'Failed to unpublish.', 'error'),
  });

  /* ── Teachers ── */
  const { data: teachersData } = useQuery({
    queryKey: ['teachers', 'picker'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teacherList = teachersData?.data ?? [];

  /* ── Class timetable ── */
  const { data: classData, isLoading: classLoading, isError: classError } = useQuery({
    queryKey: ['timetable', 'class', classId],
    queryFn:  () => ttApi.byClass(classId),
    enabled:  !!classId && activeView === 'class',
    staleTime: 30_000,
  });
  const classSlots = Array.isArray(classData?.data)
    ? classData.data
    : (classData?.data?.slots ?? []);

  /* ── Teacher timetable ── */
  const { data: teacherData, isLoading: teacherLoading } = useQuery({
    queryKey: ['timetable', 'teacher', teacherId],
    queryFn:  () => ttApi.byTeacher(teacherId),
    enabled:  !!teacherId && activeView === 'teacher',
    staleTime: 30_000,
  });
  const teacherSlots = Array.isArray(teacherData?.data)
    ? teacherData.data
    : (teacherData?.data?.slots ?? []);

  /* Teacher workload stats */
  const teacherLessonCount = teacherSlots.filter(s => !s.type || s.type === 'lesson').length;
  const teacherByDay = DAYS.map(d => ({
    day: d,
    count: teacherSlots.filter(s => (s.day || '').toLowerCase() === d).length,
  }));

  /* ── Conflicts ── */
  const { data: conflictData } = useQuery({
    queryKey: ['timetable', 'conflicts'],
    queryFn:  () => ttApi.conflicts(),
    staleTime: 60_000,
  });
  const conflicts     = conflictData?.data?.conflicts ?? [];
  const conflictCount = conflicts.length;

  /* ── Delete slot ── */
  const { mutate: removeSlot } = useMutation({
    mutationFn: id => ttApi.remove(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['timetable', 'class',   classId] });
      qc.invalidateQueries({ queryKey: ['timetable', 'teacher', teacherId] });
      qc.invalidateQueries({ queryKey: ['timetable', 'conflicts'] });
      qc.invalidateQueries({ queryKey: ['timetable', 'overview'] });
      qc.invalidateQueries({ queryKey: ['timetable', 'workload'] });
      showToast('Slot removed.');
    },
    onError: err => showToast(err?.message ?? 'Failed to remove slot.', 'error'),
  });

  /* ── Open add with pre-filled day+period ── */
  const openAdd = useCallback((day, period) => {
    setAddDefaults({ day, period });
    setShowAdd(true);
  }, []);

  function onSlotCreated() {
    setShowAdd(false);
    qc.invalidateQueries({ queryKey: ['timetable', 'class',   classId] });
    qc.invalidateQueries({ queryKey: ['timetable', 'teacher', teacherId] });
    qc.invalidateQueries({ queryKey: ['timetable', 'conflicts'] });
    qc.invalidateQueries({ queryKey: ['timetable', 'overview'] });
    qc.invalidateQueries({ queryKey: ['timetable', 'workload'] });
    showToast('Lesson slot added.');
  }

  /* ── Derived ── */
  const selectedTeacher = teacherList.find(t => (t._id ?? t.id) === teacherId);

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CalendarDays size={18} className="text-slate-400" />
              <div>
                <h1 className="text-base font-semibold text-slate-900 leading-tight">
                  Scheduling Engine
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Institutional timetable & coordination
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Conflict badge */}
              <button
                onClick={() => conflictCount > 0 && setShowConflicts(true)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                  conflictCount > 0
                    ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                    : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                }`}
              >
                {conflictCount > 0
                  ? <><AlertCircle size={12} /> {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}</>
                  : <><CheckCircle2 size={12} /> No conflicts</>
                }
              </button>

              {/* Workload toggle */}
              <button
                onClick={() => setShowWorkload(s => !s)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                  showWorkload
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <BarChart3 size={12} /> Workload
              </button>

              {/* Bell schedule config (admin only) */}
              {canEdit && (
                <button
                  onClick={() => setShowBell(true)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition"
                  title="Configure bell schedule"
                >
                  <Clock size={12} /> Bell
                </button>
              )}

              {/* Add slot (class view only) */}
              {canEdit && activeView === 'class' && classId && (
                <button
                  onClick={() => openAdd('monday', '1')}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition"
                >
                  <Plus size={13} /> Add slot
                </button>
              )}
            </div>
          </div>

          {/* View tabs */}
          <div className="flex gap-1 mt-4">
            {VIEWS.map(v => (
              <button
                key={v.id}
                onClick={() => setActiveView(v.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeView === v.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <v.Icon size={13} />{v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Publish banner ── */}
      {canEdit && (
        <div className={`px-6 py-2.5 border-b flex items-center justify-between gap-4 text-xs ${
          publishStatus.published
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            {publishStatus.published ? (
              <>
                <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                <span className="font-medium text-emerald-700">
                  Published
                  {publishStatus.termLabel ? ` · ${publishStatus.termLabel}` : ''}
                  {publishStatus.publishedAt ? ` · ${new Date(publishStatus.publishedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}` : ''}
                </span>
                <span className="text-emerald-600 hidden sm:inline">— visible to teachers, parents, and section heads</span>
              </>
            ) : (
              <>
                <AlertCircle size={13} className="text-amber-600 shrink-0" />
                <span className="font-medium text-amber-700">Draft — not visible to portal users</span>
                <span className="text-amber-600 hidden sm:inline">Publish when the timetable is ready</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {publishStatus.published ? (
              <button
                onClick={() => { if (window.confirm('Unpublish the timetable? Portal users will no longer see it.')) doUnpublish(); }}
                disabled={unpublishing}
                className="flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100 transition font-medium"
              >
                {unpublishing ? <Loader2 size={11} className="animate-spin" /> : null}
                {unpublishing ? 'Unpublishing…' : 'Unpublish'}
              </button>
            ) : (
              <button
                onClick={() => setShowPublishModal(true)}
                className="flex items-center gap-1 px-3 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition font-medium"
              >
                <Zap size={11} /> Publish Timetable
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Toolbar (context-sensitive) ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3 flex-wrap">

          {activeView === 'class' && (
            <>
              {/* Section filter */}
              <div className="flex items-center gap-1.5">
                {SECTIONS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSection(s.id); setClassId(''); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                      section === s.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="h-4 border-r border-slate-200" />
              {/* Class picker */}
              <select
                value={classId}
                onChange={e => setClassId(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700 max-w-xs"
              >
                <option value="">Select class…</option>
                {filteredClasses.map(c => (
                  <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>
                ))}
              </select>
              {selectedClass && (
                <span className="text-xs text-slate-400">{classSlots.length} lessons scheduled</span>
              )}
            </>
          )}

          {activeView === 'teacher' && (
            <>
              <select
                value={teacherId}
                onChange={e => setTeacherId(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700 max-w-xs"
              >
                <option value="">Select teacher…</option>
                {teacherList.map(t => (
                  <option key={t._id ?? t.id} value={t._id ?? t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </select>
              {selectedTeacher && (
                <span className="text-xs text-slate-400">
                  {teacherLessonCount} lesson{teacherLessonCount !== 1 ? 's' : ''} this week
                  {teacherByDay.some(d => d.count > 0) && (
                    <> · {teacherByDay.filter(d => d.count > 0).map(d => `${DAY_SHORT[d.day]}(${d.count})`).join(' ')}</>
                  )}
                </span>
              )}
            </>
          )}

          {activeView === 'overview' && (
            <span className="text-xs text-slate-500">
              Institution-wide scheduling overview · {classList.length} classes
            </span>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className={`max-w-screen-2xl mx-auto px-6 py-5 ${showWorkload ? 'pr-80' : ''} transition-all`}>

        {/* Toast */}
        <div className="h-9 mb-3 flex items-center">
          <AnimatePresence>
            {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
          </AnimatePresence>
        </div>

        {/* Class Grid View */}
        {activeView === 'class' && (
          !classId ? (
            <div className="bg-white border border-slate-200 rounded-xl p-14 flex flex-col items-center gap-3">
              <CalendarDays size={32} className="text-slate-200" />
              <p className="text-sm font-medium text-slate-400">Select a class above to view its timetable</p>
            </div>
          ) : classLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-2">
                  <div className="w-20 h-16 bg-slate-100 rounded" />
                  {DAYS.map(d => <div key={d} className="flex-1 h-16 bg-slate-100 rounded" />)}
                </div>
              ))}
            </div>
          ) : classError ? (
            <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
              <AlertTriangle size={20} className="text-red-400" />
              <p className="text-sm text-slate-600">Failed to load timetable.</p>
            </div>
          ) : (
            <TimetableGrid
              slots={classSlots}
              onDelete={removeSlot}
              onAdd={openAdd}
              canEdit={canEdit}
              bell={bell}
            />
          )
        )}

        {/* Teacher Schedule View */}
        {activeView === 'teacher' && (
          !teacherId ? (
            <div className="bg-white border border-slate-200 rounded-xl p-14 flex flex-col items-center gap-3">
              <User size={32} className="text-slate-200" />
              <p className="text-sm font-medium text-slate-400">Select a teacher above to view their schedule</p>
            </div>
          ) : teacherLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-2">
                  <div className="w-20 h-16 bg-slate-100 rounded" />
                  {DAYS.map(d => <div key={d} className="flex-1 h-16 bg-slate-100 rounded" />)}
                </div>
              ))}
            </div>
          ) : (
            <TimetableGrid
              slots={teacherSlots}
              onDelete={removeSlot}
              onAdd={() => {}}
              canEdit={false}
              bell={bell}
            />
          )
        )}

        {/* Institution Overview */}
        {activeView === 'overview' && (
          <OverviewView classList={classList} />
        )}
      </div>

      {/* ── Workload sidebar ── */}
      <AnimatePresence>
        {showWorkload && <WorkloadPanel onClose={() => setShowWorkload(false)} />}
      </AnimatePresence>

      {/* ── Conflicts panel ── */}
      <AnimatePresence>
        {showConflicts && (
          <ConflictsPanel
            conflicts={conflicts}
            onClose={() => setShowConflicts(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Add slot slide-over ── */}
      <AnimatePresence>
        {showAdd && classId && (
          <AddSlotSlideOver
            classId={classId}
            defaults={addDefaults}
            onClose={() => setShowAdd(false)}
            onCreated={onSlotCreated}
            lessonPeriods={lessonPeriods}
          />
        )}
      </AnimatePresence>

      {/* ── Bell schedule slide-over ── */}
      <AnimatePresence>
        {showBell && (
          <BellScheduleSlideOver
            onClose={() => setShowBell(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Publish modal ── */}
      <AnimatePresence>
        {showPublishModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowPublishModal(false)} />
            <motion.div
              initial={{ scale: 0.95, y: -8 }} animate={{ scale: 1, y: 0 }}
              className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm z-50 p-6 space-y-4"
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Publish Timetable</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Once published, teachers, parents, and section heads can view their timetable in the portal.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Term label <span className="text-slate-400">(optional)</span></label>
                <input
                  value={termLabelInput}
                  onChange={e => setTermLabelInput(e.target.value)}
                  placeholder="e.g. Term 1, 2026"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800"
                  autoFocus
                />
                <p className="text-[11px] text-slate-400">Shown on the portal header and print pages.</p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button onClick={() => setShowPublishModal(false)} className="text-sm font-medium text-slate-600 hover:text-slate-800 transition">
                  Cancel
                </button>
                <button
                  onClick={() => doPublish()}
                  disabled={publishing}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
                >
                  {publishing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  {publishing ? 'Publishing…' : 'Publish Now'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
