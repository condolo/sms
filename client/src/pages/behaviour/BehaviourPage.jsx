import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { behaviour as behaviourApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';

const LIMIT = 20;

export default function BehaviourPage() {
  const [tab, setTab]   = useState('incidents');
  const [page, setPage] = useState(1);

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Behaviour</h2>

      <div className="flex gap-2 border-b border-surface-border">
        {['incidents', 'appeals'].map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition capitalize ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'incidents' && <IncidentsTab page={page} onPage={setPage} />}
      {tab === 'appeals'   && <AppealsTab  page={page} onPage={setPage} />}
    </div>
  );
}

function IncidentsTab({ page, onPage }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'incidents', { page }],
    queryFn:  () => behaviourApi.incidents.list({ page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? {};

  if (isLoading) return <PageSpinner message="Loading incidents…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;
  if (!rows.length) return <EmptyState icon="⚖️" title="No incidents recorded" />;

  return (
    <>
      <div className="card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Type</th>
              <th>Category</th>
              <th className="hidden sm:table-cell">Points</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td className="font-medium">{r.studentName ?? r.studentId}</td>
                <td><Badge variant={r.type === 'merit' ? 'success' : 'danger'}>{r.type}</Badge></td>
                <td className="text-slate-600">{r.category}</td>
                <td className="hidden sm:table-cell">
                  <span className={r.points > 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </span>
                </td>
                <td className="text-xs text-slate-400">
                  {r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={onPage} />
    </>
  );
}

function AppealsTab({ page, onPage }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'appeals', { page }],
    queryFn:  () => behaviourApi.appeals.list({ page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? {};

  if (isLoading) return <PageSpinner message="Loading appeals…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;
  if (!rows.length) return <EmptyState icon="📩" title="No appeals found" />;

  return (
    <>
      <div className="space-y-3">
        {rows.map((a) => (
          <div key={a._id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">{a.studentName ?? a.studentId}</p>
                <p className="text-sm text-slate-500 mt-1">{a.reason}</p>
              </div>
              <Badge variant={a.status === 'resolved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning'}>
                {a.status}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : ''}
            </p>
          </div>
        ))}
      </div>
      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={onPage} />
    </>
  );
}
