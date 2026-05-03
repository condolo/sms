import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { exams as examsApi, grades as gradesApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';

const LIMIT = 20;

export default function ExamsPage() {
  const [tab, setTab]   = useState('exams');
  const [page, setPage] = useState(1);

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Exams & Grades</h2>

      <div className="flex gap-2 border-b border-surface-border">
        {['exams', 'grade report'].map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition capitalize ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'exams'        && <ExamsTab  page={page} onPage={setPage} />}
      {tab === 'grade report' && <GradeReportTab />}
    </div>
  );
}

function ExamsTab({ page, onPage }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exams', 'list', { page }],
    queryFn:  () => examsApi.list({ page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? {};

  if (isLoading) return <PageSpinner message="Loading exams…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;
  if (!rows.length) return <EmptyState icon="📝" title="No exams found" />;

  return (
    <>
      <div className="card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Exam</th>
              <th className="hidden sm:table-cell">Subject</th>
              <th className="hidden md:table-cell">Class</th>
              <th>Status</th>
              <th className="hidden lg:table-cell text-right">Max score</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e._id}>
                <td className="font-medium text-slate-800">{e.title}</td>
                <td className="hidden sm:table-cell text-slate-600">{e.subject}</td>
                <td className="hidden md:table-cell text-slate-600">{e.className ?? '—'}</td>
                <td><Badge variant={e.status === 'completed' ? 'success' : e.status === 'active' ? 'primary' : 'default'}>{e.status}</Badge></td>
                <td className="hidden lg:table-cell text-right text-slate-500">{e.maxScore}</td>
                <td className="text-xs text-slate-400">
                  {e.date ? new Date(e.date).toLocaleDateString('en-GB') : '—'}
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

function GradeReportTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['grades', 'report', 'all'],
    queryFn:  () => gradesApi.report({ limit: 50 }),
  });
  const rows = data?.data ?? [];

  if (isLoading) return <PageSpinner message="Loading report…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;
  if (!rows.length) return <EmptyState icon="📊" title="No grade data yet" />;

  return (
    <div className="card !p-0 overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Subject</th>
            <th className="text-right">Avg %</th>
            <th className="text-right">Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.studentId}-${r.subject}-${i}`}>
              <td className="font-medium">{r.studentName ?? r.studentId}</td>
              <td className="text-slate-600">{r.subject}</td>
              <td className="text-right">
                <span className={Number(r.avgPct) >= 70 ? 'text-green-600 font-semibold' : Number(r.avgPct) >= 50 ? 'text-amber-600 font-semibold' : 'text-red-600 font-semibold'}>
                  {r.avgPct != null ? `${Math.round(r.avgPct)}%` : '—'}
                </span>
              </td>
              <td className="text-right font-medium text-slate-700">{r.grade ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
