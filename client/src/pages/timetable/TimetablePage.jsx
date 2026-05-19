/* ============================================================
   Timetable — Premium Enterprise Rebuild
   /platform-audit: lucide icons, add/remove slots, no old
   components, RBAC-gated, correct API shapes
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, X, Loader2, AlertTriangle,
  CheckCircle2, Trash2, BookOpen, Clock, User, Home,
  Save,
} from 'lucide-react';
import { timetable as timetableApi, classes as classesApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const DAYS    = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/* ── Slot colour by subject (deterministic) ─────────────────── */
const SLOT_COLORS = [
  { bg: 'bg-violet-50',  border: 'border-violet-200', text: 'text-violet-700',  sub: 'text-violet-500'  },
  { bg: 'bg-blue-50',    border: 'border-blue-200',   text: 'text-blue-700',    sub: 'text-blue-500'    },
  { bg: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-700', sub: 'text-emerald-500' },
  { bg: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700',   sub: 'text-amber-500'   },
  { bg: 'bg-rose-50',    border: 'border-rose-200',   text: 'text-rose-700',    sub: 'text-rose-500'    },
  { bg: 'bg-indigo-50',  border: 'border-indigo-200', text: 'text-indigo-700',  sub: 'text-indigo-500'  },
  { bg: 'bg-teal-50',    border: 'border-teal-200',   text: 'text-teal-700',    sub: 'text-teal-500'    },
  { bg: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-700',  sub: 'text-orange-500'  },
];
function slotColor(subject = '') {
  return SLOT_COLORS[(subject.charCodeAt(0) || 0) % SLOT_COLORS.length];
}

/* ── Shared primitives ───────────────────────────────────────── */
function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

function FField({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
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

/* ── Add Slot slide-over ─────────────────────────────────────── */
const EMPTY_SLOT = { day: 'Monday', period: 1, subject: '', teacherName: '', room: '' };

function AddSlotSlideOver({ classId, onClose, onCreated }) {
  const [form, setForm]     = useState({ ...EMPTY_SLOT });
  const [errors, setErrors] = useState({});
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErrors(e => { const n={...e}; delete n[k]; return n; }); }

  const { mutate, isPending } = useMutation({
    mutationFn: () => timetableApi.create({
      classId,
      day:         form.day,
      period:      Number(form.period),
      subject:     form.subject.trim(),
      teacherName: form.teacherName.trim() || undefined,
      room:        form.room.trim() || undefined,
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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add Timetable Slot</h2>
            <p className="text-xs text-slate-400 mt-0.5">Add a lesson to the timetable</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={14} />{errors._server}
            </div>
          )}

          <FField label="Subject *">
            <input
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              placeholder="e.g. Mathematics"
              className={`${iCls()}${errors.subject ? ' border-red-300' : ''}`}
              autoFocus
            />
            {errors.subject && <p className="text-[11px] text-red-500 mt-1">{errors.subject}</p>}
          </FField>

          <div className="grid grid-cols-2 gap-3">
            <FField label="Day">
              <select value={form.day} onChange={e => set('day', e.target.value)} className={iCls()}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </FField>
            <FField label="Period">
              <select value={form.period} onChange={e => set('period', e.target.value)} className={iCls()}>
                {PERIODS.map(p => <option key={p} value={p}>Period {p}</option>)}
              </select>
            </FField>
          </div>

          <FField label="Teacher">
            <input
              value={form.teacherName}
              onChange={e => set('teacherName', e.target.value)}
              placeholder="Teacher name (optional)"
              className={iCls()}
            />
          </FField>

          <FField label="Room">
            <input
              value={form.room}
              onChange={e => set('room', e.target.value)}
              placeholder="e.g. Room 12 (optional)"
              className={iCls()}
            />
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Cancel</button>
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
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function TimetablePage() {
  const qc     = useQueryClient();
  const can    = useAuthStore(s => s.can.bind(s));
  const role   = useAuthStore(s => s.session?.user?.role ?? '');
  const canEdit = can('timetable') || role === 'admin' || role === 'superadmin' || role === 'deputy';

  const [classId,   setClassId]   = useState('');
  const [showAdd,   setShowAdd]   = useState(false);
  const [toast,     setToast]     = useState(null);

  /* Classes */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  /* Timetable for selected class */
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['timetable', 'class', classId],
    queryFn:  () => timetableApi.byClass(classId),
    enabled:  !!classId,
    staleTime: 60_000,
  });
  const slots = data?.data ?? [];

  /* Group by day */
  const byDay = {};
  DAYS.forEach(d => { byDay[d] = []; });
  slots.forEach(slot => {
    if (byDay[slot.day]) byDay[slot.day].push(slot);
  });

  /* Delete slot */
  const { mutate: removeSlot } = useMutation({
    mutationFn: id => timetableApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timetable', 'class', classId] });
      setToast({ msg: 'Slot removed.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to remove slot.', type: 'error' }),
  });

  const totalSlots = slots.length;
  const days       = Object.values(byDay).filter(d => d.length > 0).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Timetable</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {classId && !isLoading
                  ? `${totalSlots} lesson${totalSlots !== 1 ? 's' : ''} across ${days} day${days !== 1 ? 's' : ''}`
                  : 'Select a class to view its timetable'}
              </p>
            </div>
            {canEdit && classId && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                <Plus size={15} /> Add slot
              </button>
            )}
          </div>

          {/* Class picker */}
          <div className="flex items-center gap-3">
            <CalendarDays size={15} className="text-slate-400 shrink-0" />
            <select
              value={classId}
              onChange={e => setClassId(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 max-w-xs transition"
            >
              <option value="">Select class…</option>
              {classList.map(c => (
                <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5">
        {/* Toast */}
        <div className="h-8 mb-2 flex items-center">
          <AnimatePresence>
            {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
          </AnimatePresence>
        </div>

        {!classId ? (
          <div className="bg-white border border-slate-200 rounded-xl p-14 flex flex-col items-center gap-3">
            <CalendarDays size={32} className="text-slate-300" />
            <p className="text-sm font-medium text-slate-500">Select a class above to view its timetable</p>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {DAYS.map(d => (
              <div key={d} className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-slate-100 rounded w-20 mb-3" />
                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-lg mb-2" />)}
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load timetable.'}</p>
            <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {DAYS.map(day => {
              const daySlots = [...byDay[day]].sort((a, b) => (a.period ?? 0) - (b.period ?? 0));
              return (
                <div key={day} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Day header */}
                  <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/50">
                    <p className="text-xs font-semibold text-slate-700">{day}</p>
                    <p className="text-[10px] text-slate-400">{daySlots.length} lesson{daySlots.length !== 1 ? 's' : ''}</p>
                  </div>

                  {/* Slots */}
                  <div className="p-2 space-y-1.5 min-h-[120px]">
                    {daySlots.length === 0 ? (
                      <div className="flex items-center justify-center py-6">
                        <p className="text-[11px] text-slate-300">No lessons</p>
                      </div>
                    ) : (
                      daySlots.map(slot => {
                        const col = slotColor(slot.subject ?? '');
                        return (
                          <motion.div
                            key={slot._id ?? slot.id}
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className={`rounded-lg border px-2.5 py-2 group relative ${col.bg} ${col.border}`}
                          >
                            {/* Remove button */}
                            {canEdit && (
                              <button
                                onClick={() => removeSlot(slot._id ?? slot.id)}
                                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 hover:bg-white/80 rounded transition"
                              >
                                <Trash2 size={10} />
                              </button>
                            )}

                            <div className="flex items-center gap-1 mb-0.5">
                              <span className={`text-[10px] font-bold ${col.sub}`}>P{slot.period}</span>
                              {slot.room && (
                                <span className={`text-[10px] ${col.sub} opacity-70`}>· {slot.room}</span>
                              )}
                            </div>
                            <p className={`text-xs font-semibold leading-tight ${col.text}`}>{slot.subject}</p>
                            {slot.teacherName && (
                              <p className={`text-[10px] mt-0.5 ${col.sub} opacity-80 truncate`}>{slot.teacherName}</p>
                            )}
                          </motion.div>
                        );
                      })
                    )}

                    {/* Quick-add button */}
                    {canEdit && (
                      <button
                        onClick={() => setShowAdd(true)}
                        className="w-full rounded-lg border border-dashed border-slate-200 py-2 text-[11px] text-slate-300 hover:text-slate-500 hover:border-slate-300 transition flex items-center justify-center gap-1"
                      >
                        <Plus size={10} /> Add
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add slot slide-over */}
      <AnimatePresence>
        {showAdd && classId && (
          <AddSlotSlideOver
            classId={classId}
            onClose={() => setShowAdd(false)}
            onCreated={() => {
              setShowAdd(false);
              qc.invalidateQueries({ queryKey: ['timetable', 'class', classId] });
              setToast({ msg: 'Slot added to timetable.', type: 'success' });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
