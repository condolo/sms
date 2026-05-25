/* ============================================================
   ConflictsPanel — modal listing scheduling conflicts
   Props:
     conflicts  []   — conflict objects from /api/timetable/conflicts
     onClose    fn
   ============================================================ */
import { motion } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';
import { DAY_FULL } from '../constants.js';

export default function ConflictsPanel({ conflicts, onClose }) {
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
