/* ============================================================
   WorkingDaysModal — which days lessons can go on (v5.265.0)
   Saved to schools.timetableSettings.workingDays via
   PUT /api/timetable/settings. Removing a day keeps its lessons
   (they still show, and can be moved or removed); it only stops
   new lessons being added on that day.
   Props: workingDays [], onClose fn, onSaved fn(result)
   ============================================================ */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { X, CalendarDays, Loader2 } from 'lucide-react';
import { timetable as ttApi } from '@/api/client.js';
import { ALL_DAYS, DAY_FULL } from '../constants.js';

export default function WorkingDaysModal({ workingDays, onClose, onSaved }) {
  const [days, setDays] = useState(workingDays);
  const [error, setError] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => ttApi.saveSettings({ workingDays: ALL_DAYS.filter(d => days.includes(d)) }),
    onSuccess: (res) => onSaved(res?.data ?? {}),
    onError:   (err) => setError(err?.message ?? 'Could not save the working days.'),
  });

  const toggle = (d) => setDays(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
        role="dialog" aria-label="Working days"
        className="pointer-events-auto w-full max-w-sm bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><CalendarDays size={14} /> Working days</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-500">The days lessons can be placed on. Add Saturday if the school teaches on Saturdays.</p>
          <div className="grid grid-cols-2 gap-2">
            {ALL_DAYS.map(d => (
              <label key={d} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition ${
                days.includes(d) ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                <input type="checkbox" checked={days.includes(d)} onChange={() => toggle(d)} className="rounded border-slate-300" />
                {DAY_FULL[d]}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">Removing a day keeps the lessons already on it. They stay visible so you can move or remove them.</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={() => mutate()} disabled={isPending || days.length === 0}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
            {isPending && <Loader2 size={13} className="animate-spin" />} Save
          </button>
        </div>
      </motion.div>
      </div>
    </>
  );
}
