/* ============================================================
   AppealsTab — pending + resolved appeals with resolve actions
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Send, Check, XCircle } from 'lucide-react';
import { behaviour as behaviourApi } from '@/api/client.js';
import { LIMIT, PaginationBar, EmptyMsg, ErrState } from './BehaviourPrimitives.jsx';

const STATUS_CLS = {
  pending:  'bg-amber-50  text-amber-700  border-amber-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50    text-red-700    border-red-200',
};

export default function AppealsTab() {
  const qc                = useQueryClient();
  const [page, setPage]   = useState(1);
  const [notes, setNotes] = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'appeals', { page }],
    queryFn:  () => behaviourApi.appeals.list({ page, limit: LIMIT }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  const pending  = rows.filter(a => a.status === 'pending');
  const resolved = rows.filter(a => a.status !== 'pending');

  const resolveMut = useMutation({
    mutationFn: ({ id, outcome }) => behaviourApi.appeals.resolve(id, { outcome, note: notes[id] ?? '' }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['behaviour', 'appeals'] }),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-28 animate-pulse" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Send size={36} />} title="No appeals" subtitle="Student appeals will appear here for review" />
      ) : (
        <>
          {/* Pending */}
          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Pending ({pending.length})</h3>
              <div className="space-y-3">
                {pending.map(a => (
                  <div key={a._id} className="bg-white rounded-xl border-2 border-amber-300 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{a.studentName ?? a.studentId}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {a.grade ?? '—'} · Submitted {a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '—'}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_CLS.pending}`}>Pending</span>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Student's reason:</p>
                      <p className="text-sm text-amber-900">{a.reason ?? '—'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Your decision note (optional)</label>
                      <input
                        value={notes[a._id] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [a._id]: e.target.value }))}
                        placeholder="Explain your decision…"
                        className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800 placeholder-slate-400"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => resolveMut.mutate({ id: a._id, outcome: 'resolved' })}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 transition"
                      >
                        <Check size={13} />Accept — Remove Points
                      </button>
                      <button
                        onClick={() => resolveMut.mutate({ id: a._id, outcome: 'rejected' })}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-300 rounded-lg hover:bg-red-100 transition"
                      >
                        <XCircle size={13} />Reject — Keep Points
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resolved */}
          {resolved.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 mb-3">Resolved</h3>
              <div className="space-y-2">
                {resolved.map(a => (
                  <div key={a._id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{a.studentName ?? a.studentId}</p>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{a.reason}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_CLS[a.status] ?? STATUS_CLS.resolved}`}>
                      {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
        </>
      )}
    </motion.div>
  );
}
