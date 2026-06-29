/* ============================================================
   StageModal — move applicant to a different pipeline stage
   ============================================================ */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { admissions as admissionsApi } from '@/api/client.js';
import { PIPELINE, TERMINAL } from '../constants.js';

export default function StageModal({ applicant, onClose, onChanged }) {
  const a = applicant;
  const [selectedStage, setSelectedStage] = useState(a.stage);
  const [notes, setNotes]                 = useState('');

  const mutation = useMutation({
    mutationFn: ({ id, stage, notes }) =>
      admissionsApi.changeStage(id, { stage, notes, date: new Date().toISOString().slice(0, 10) }),
    onSuccess: onChanged,
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0    }}
        exit={{   opacity: 0, scale: 0.96, y: 10  }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Move Applicant</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mt-1">{a.firstName} {a.lastName}</p>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Stage selector */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Select stage</p>
              <div className="grid grid-cols-2 gap-2">
                {[...PIPELINE, ...TERMINAL].map(s => {
                  const isCurrent  = s.id === a.stage;
                  const isSelected = s.id === selectedStage;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStage(s.id)}
                      disabled={isCurrent}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all text-left ${
                        isSelected && !isCurrent
                          ? 'border-slate-800 bg-slate-900 text-white shadow-sm'
                          : isCurrent
                            ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-default'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
                      <span>{s.label}</span>
                      {isCurrent && <span className="ml-auto text-[10px] text-slate-400">current</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Note (optional)</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Reason for stage change…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 resize-none placeholder-slate-400"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 pb-6">
            <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-4 py-2">
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate({ id: a.id ?? a._id, stage: selectedStage, notes })}
              disabled={mutation.isPending || selectedStage === a.stage}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Confirm Move
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
