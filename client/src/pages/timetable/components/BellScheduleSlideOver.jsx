/* ============================================================
   BellScheduleSlideOver — per-section bell schedule editor
   Admin only.  One tab per section; sections without a custom
   schedule inherit from the school default.
   Props: onClose fn
   ============================================================ */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, Plus, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bellSchedule as bellApi } from '@/api/client.js';
import { DEFAULT_BELL, BELL_SECTIONS } from '../constants.js';

export default function BellScheduleSlideOver({ onClose }) {
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState('all');
  const [rows,  setRows]  = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);

  /* Which sections have custom schedules */
  const { data: sectionsData } = useQuery({
    queryKey: ['bell-schedule', 'sections'],
    queryFn:  () => bellApi.sections(),
    staleTime: 60_000,
  });
  const configuredSet = new Set(
    (sectionsData?.data ?? []).filter(s => s.configured).map(s => s.section),
  );

  /* Fetch active section's schedule */
  const { data: bellData, isLoading } = useQuery({
    queryKey: ['bell-schedule', activeSection],
    queryFn:  () => bellApi.get(activeSection),
    staleTime: 60_000,
  });
  const effectivePeriods = bellData?.data?.periods ?? DEFAULT_BELL;
  const isCustom = bellData?.data?.section === activeSection;

  useEffect(() => {
    setRows(effectivePeriods.map(p => ({ ...p })));
    setDirty(false);
  }, [bellData, activeSection]);

  function setRow(idx, key, val) {
    setRows(r => r.map((p, i) => i === idx ? { ...p, [key]: val } : p));
    setDirty(true);
  }
  function removeRow(idx) { setRows(r => r.filter((_, i) => i !== idx)); setDirty(true); }
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

  const showT = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => bellApi.update({ section: activeSection, periods: rows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bell-schedule'] });
      setDirty(false);
      showT(`${BELL_SECTIONS.find(s => s.id === activeSection)?.label} schedule saved.`);
    },
    onError: err => showT(err?.message ?? 'Failed to save.', 'error'),
  });

  const { mutate: revert, isPending: reverting } = useMutation({
    mutationFn: () => bellApi.remove(activeSection),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bell-schedule'] });
      setDirty(false);
      showT('Reverted to school default.');
    },
    onError: err => showT(err?.message ?? 'Failed to revert.', 'error'),
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

        {/* Inherited notice */}
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
                  <input value={row.p}     onChange={e => setRow(idx, 'p',     e.target.value)} className={iCls2 + ' font-mono'} maxLength={6} />
                  <input type="time" value={row.start} onChange={e => setRow(idx, 'start', e.target.value)} className={iCls2} />
                  <input type="time" value={row.end}   onChange={e => setRow(idx, 'end',   e.target.value)} className={iCls2} />
                  <input value={row.label} onChange={e => setRow(idx, 'label', e.target.value)} className={iCls2} maxLength={40} />
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
