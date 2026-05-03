import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { classes as classesApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import useAuthStore from '@/store/auth.js';

export default function ClassList() {
  const can = useAuthStore((s) => s.can);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 100 }),
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Classes</h2>
          {!isLoading && <p className="text-sm text-slate-500 mt-0.5">{rows.length} class{rows.length !== 1 ? 'es' : ''}</p>}
        </div>
        {can('classes') && <button className="btn-primary">+ Add class</button>}
      </div>

      {isLoading ? <PageSpinner message="Loading classes…" /> :
       isError   ? <ErrorState message={error?.message} onRetry={refetch} /> :
       rows.length === 0 ? <EmptyState icon="📚" title="No classes yet" /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c) => (
            <div key={c._id} className="card hover:shadow-card-hover transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  {c.year && <p className="text-xs text-slate-400 mt-0.5">Year {c.year}</p>}
                </div>
                <span className="text-2xl select-none">📚</span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm text-slate-500">
                <span>👥 {c.studentCount ?? 0} students</span>
                {c.teacherName && <span>👩‍🏫 {c.teacherName}</span>}
              </div>
              <Link
                to={`/students?classId=${c._id}`}
                className="mt-3 text-xs text-brand-600 hover:underline font-medium"
              >
                View students →
              </Link>
            </div>
          ))}
        </div>
       )
      }
    </div>
  );
}
