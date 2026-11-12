/* ============================================================
   AvailabilityModal — when a teacher can't teach (v5.267.0)
   A grid of working days × the school's default bell periods. Tick a
   cell to mark the teacher unavailable then, or a whole day. Saved as
   clock-time blocks (PUT /api/timetable/availability/:teacherId), so
   the same entry holds for every section's bell schedule. Blocks saved
   for other times (e.g. from another schedule) are kept and listed.
   Props: teacher (staff record), teacherName, record ({blocks, note} or
          null), workingDays [], onClose fn, onSaved fn
   ============================================================ */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, UserX, Loader2 } from 'lucide-react';
import { timetable as ttApi, bellSchedule as bellApi } from '@/api/client.js';
import { DAY_FULL, DAY_SHORT, DEFAULT_BELL } from '../constants.js';

const WHOLE_DAY = { start: '00:00', end: '23:59' };
const key = (day, start, end) => `${day}|${start}|${end}`;

export default function AvailabilityModal({ teacher, teacherName, record, workingDays, onClose, onSaved }) {
  const { data: bellData } = useQuery({
    queryKey: ['bell-schedule', 'all', null],
    queryFn:  () => bellApi.get('all'),
    staleTime: 10 * 60_000,
  });
  const periods = (bellData?.data?.periods ?? DEFAULT_BELL).filter(p => !p.isBreak);

  // Split what's saved into: whole days, grid cells, and anything else (kept as-is).
  const initial = useMemo(() => {
    const blocks = record?.blocks ?? [];
    const whole = new Set(blocks.filter(b => b.start === WHOLE_DAY.start && b.end === WHOLE_DAY.end).map(b => b.day));
    const cellKeys = new Set(periods.map(p => p.start + '|' + p.end));
    const cells = new Set();
    const other = [];
    for (const b of blocks) {
      if (whole.has(b.day) && b.start === WHOLE_DAY.start) continue;
      if (cellKeys.has(b.start + '|' + b.end)) cells.add(key(b.day, b.start, b.end));
      else other.push(b);
    }
    return { whole, cells, other };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, bellData]);

  const [whole, setWhole] = useState(null);
  const [cells, setCells] = useState(null);
  const [other, setOther] = useState(null);
  const [note,  setNote]  = useState(record?.note ?? '');
  const [error, setError] = useState('');
  const W = whole ?? initial.whole, C = cells ?? initial.cells, O = other ?? initial.other;

  const toggleWhole = (day) => { const n = new Set(W); n.has(day) ? n.delete(day) : n.add(day); setWhole(n); };
  const toggleCell = (day, p) => { const n = new Set(C); const k = key(day, p.start, p.end); n.has(k) ? n.delete(k) : n.add(k); setCells(n); };

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const blocks = [
        ...[...W].map(day => ({ day, ...WHOLE_DAY })),
        ...[...C].map(k => { const [day, start, end] = k.split('|'); return { day, start, end }; }).filter(b => !W.has(b.day)),
        ...O.filter(b => !W.has(b.day)),
      ];
      return ttApi.saveAvailability(teacher.id ?? String(teacher._id), { blocks, note });
    },
    onSuccess: (res) => onSaved(res?.data ?? {}),
    onError:   (err) => setError(err?.message ?? 'Could not save.'),
  });

  const offCount = W.size + [...C].filter(k => !W.has(k.split('|')[0])).length + O.length;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          role="dialog" aria-label="Teacher availability"
          className="pointer-events-auto w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><UserX size={14} /> When {teacherName} can't teach</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Tick the periods (or whole days) this teacher is not available. The automatic timetable will keep them free.</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"><X size={16} /></button>
          </div>

          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-semibold text-slate-500 px-2 py-1.5 w-24">Period</th>
                    {workingDays.map(d => (
                      <th key={d} className="font-semibold text-slate-600 px-1 py-1.5 text-center">
                        <span className="hidden sm:inline">{DAY_FULL[d]}</span><span className="sm:hidden">{DAY_SHORT[d]}</span>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-2 py-1 text-[11px] text-slate-500">Whole day</td>
                    {workingDays.map(d => (
                      <td key={d} className="px-1 py-1 text-center">
                        <input type="checkbox" checked={W.has(d)} onChange={() => toggleWhole(d)} aria-label={`${DAY_FULL[d]} whole day`} className="rounded border-slate-300" />
                      </td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map(p => (
                    <tr key={p.p} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">P{p.p} <span className="text-slate-400">{p.start}–{p.end}</span></td>
                      {workingDays.map(d => {
                        const off = W.has(d) || C.has(key(d, p.start, p.end));
                        return (
                          <td key={d} className="px-1 py-1 text-center">
                            <button type="button" disabled={W.has(d)} onClick={() => toggleCell(d, p)}
                              aria-pressed={off} aria-label={`${DAY_FULL[d]} ${p.start}–${p.end} ${off ? 'unavailable' : 'available'}`}
                              className={`w-full h-7 rounded-md border text-[10px] font-semibold transition ${
                                off ? 'bg-rose-100 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-300 hover:border-slate-400'
                              } disabled:cursor-not-allowed`}>
                              {off ? 'Not free' : ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {O.length > 0 && (
              <div className="text-xs text-slate-600">
                <p className="font-medium mb-1">Other unavailable times (from another bell schedule)</p>
                <ul className="flex flex-wrap gap-1.5">
                  {O.map((b, i) => (
                    <li key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
                      {DAY_SHORT[b.day]} {b.start}–{b.end}
                      <button onClick={() => setOther(O.filter((_, j) => j !== i))} aria-label="Remove" className="hover:text-rose-900"><X size={10} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="block text-xs text-slate-600">
              Note (optional)
              <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. Part-time: Mon–Wed only"
                className="mt-1 w-full text-sm px-3 py-1.5 rounded-lg border border-slate-200" />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
            <span className="text-[11px] text-slate-500">{offCount ? `${offCount} unavailable time${offCount === 1 ? '' : 's'}` : 'Available at all times'}</span>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={() => mutate()} disabled={isPending}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
                {isPending && <Loader2 size={13} className="animate-spin" />} Save
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
