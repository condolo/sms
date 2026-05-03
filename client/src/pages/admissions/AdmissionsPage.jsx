import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { admissions as admissionsApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { admissionStageBadge } from '@/components/ui/Badge.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';

const LIMIT  = 20;
const STAGES = ['', 'enquiry', 'applied', 'shortlisted', 'assessed', 'offered', 'enrolled', 'rejected', 'withdrawn'];

export default function AdmissionsPage() {
  const [page, setPage]   = useState(1);
  const [stage, setStage] = useState('');

  // Stats funnel
  const { data: statsData } = useQuery({
    queryKey: ['admissions', 'stats'],
    queryFn:  () => admissionsApi.stats(),
    staleTime: 2 * 60 * 1000,
  });
  const stats = statsData?.data ?? [];

  // Applications list
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admissions', 'list', { page, stage }],
    queryFn:  () => admissionsApi.list({ page, limit: LIMIT, ...(stage && { stage }) }),
    placeholderData: (prev) => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Admissions</h2>

      {/* Funnel stats */}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {stats.map((s) => (
            <button
              key={s._id}
              onClick={() => { setStage(stage === s._id ? '' : s._id); setPage(1); }}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition ${stage === s._id ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-surface-border text-slate-600 hover:border-slate-400'}`}
            >
              <span className="capitalize">{s._id}</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{s.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Stage filter */}
      <div className="card !py-3 flex gap-3 items-center">
        <select value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }} className="form-select max-w-xs">
          {STAGES.map((s) => <option key={s} value={s}>{s || 'All stages'}</option>)}
        </select>
        <button className="btn-primary">+ New application</button>
      </div>

      {/* Table */}
      <div className="card !p-0 overflow-hidden">
        {isLoading ? <PageSpinner message="Loading applications…" /> :
         isError   ? <ErrorState message={error?.message} onRetry={refetch} /> :
         rows.length === 0 ? <EmptyState icon="📋" title="No applications found" /> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th className="hidden sm:table-cell">Ref</th>
                <th>Stage</th>
                <th className="hidden md:table-cell">Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a._id}>
                  <td>
                    <p className="font-medium text-slate-800">{a.firstName} {a.lastName}</p>
                    {a.email && <p className="text-xs text-slate-400">{a.email}</p>}
                  </td>
                  <td className="hidden sm:table-cell font-mono text-xs text-slate-500">{a.applicationRef}</td>
                  <td>{admissionStageBadge(a.stage)}</td>
                  <td className="hidden md:table-cell text-xs text-slate-400">
                    {a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
