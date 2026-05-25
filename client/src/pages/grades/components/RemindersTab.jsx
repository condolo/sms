/* ============================================================
   RemindersTab — assessment deadline tracker with notify action
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Loader2, Send, Calendar } from 'lucide-react';
import { assessment as api } from '@/api/client.js';
import { Skeleton, Toast, TypePill } from './GradesPrimitives.jsx';

const REMINDER_CONFIG = {
  overdue:  { label: 'Overdue',  bg: 'bg-red-50 border-red-200',         text: 'text-red-700',     Icon: AlertTriangle },
  open:     { label: 'Open',     bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', Icon: CheckCircle2  },
  upcoming: { label: 'Upcoming', bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    Icon: Calendar      },
};

export default function RemindersTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'reminders'],
    queryFn:  () => api.reminders({ days: 14 }),
    staleTime: 60_000,
  });
  const reminders = data?.data ?? [];

  const { mutate: notify, isPending: notifying } = useMutation({
    mutationFn: () => api.notify({}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'reminders'] });
      setToast({ msg: 'Notification sent to teachers.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Notification failed.', type: 'error' }),
  });

  const overdue  = reminders.filter(r => r.status === 'overdue').length;
  const open     = reminders.filter(r => r.status === 'open').length;
  const upcoming = reminders.filter(r => r.status === 'upcoming').length;

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="text-red-600 font-medium">{overdue} overdue</span>
          <span>·</span>
          <span className="text-emerald-600 font-medium">{open} open</span>
          <span>·</span>
          <span className="text-blue-600 font-medium">{upcoming} upcoming</span>
          <span className="text-slate-400">— next 14 days</span>
        </div>
        <button onClick={() => notify()} disabled={notifying || reminders.length === 0}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {notifying ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {notifying ? 'Sending…' : 'Notify teachers'}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : reminders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <CheckCircle2 size={24} className="text-emerald-400" />
          <p className="text-sm font-medium text-slate-600">All clear</p>
          <p className="text-xs text-slate-400">No overdue or upcoming assessments in the next 14 days.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map(r => {
            const cfg = REMINDER_CONFIG[r.status] ?? REMINDER_CONFIG.upcoming;
            const { Icon } = cfg;
            return (
              <div key={r.scheduleId} className={`rounded-xl border p-4 ${cfg.bg}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon size={16} className={`mt-0.5 shrink-0 ${cfg.text}`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                        <TypePill type={r.assessmentType ?? r.label?.split(' ')[0]} />
                        <span className="text-sm font-semibold text-slate-800">
                          {r.label ?? `${r.assessmentType} ${r.instance}`} — Term {r.termNumber}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono">{r.dateFrom} → {r.dateTo}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-700 tabular-nums">{r.marksEntered ?? 0}</p>
                    <p className="text-xs text-slate-400">marks entered</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
