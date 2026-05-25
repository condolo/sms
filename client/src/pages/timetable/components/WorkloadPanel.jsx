/* ============================================================
   WorkloadPanel — right-side slide-over showing teacher workload
   Props: onClose fn
   ============================================================ */
import { motion } from 'framer-motion';
import { BarChart3, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { timetable as ttApi } from '@/api/client.js';

export default function WorkloadPanel({ onClose }) {
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
