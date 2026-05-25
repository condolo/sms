/* ============================================================
   PublishModal — confirm timetable publish with optional term label
   Props:
     publishing   bool
     onPublish    fn(termLabel)
     onClose      fn
   ============================================================ */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Zap } from 'lucide-react';

export default function PublishModal({ publishing, onPublish, onClose }) {
  const [termLabel, setTermLabel] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
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
          <label className="text-xs font-medium text-slate-600">
            Term label <span className="text-slate-400">(optional)</span>
          </label>
          <input
            value={termLabel}
            onChange={e => setTermLabel(e.target.value)}
            placeholder="e.g. Term 1, 2026"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800"
            autoFocus
          />
          <p className="text-[11px] text-slate-400">Shown on the portal header and print pages.</p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="text-sm font-medium text-slate-600 hover:text-slate-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onPublish(termLabel)}
            disabled={publishing}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {publishing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {publishing ? 'Publishing…' : 'Publish Now'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
