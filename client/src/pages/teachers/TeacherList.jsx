import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teachers as teachersApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;

export default function TeacherList() {
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [debounced, setDebounced] = useState('');
  const [timer, setTimer]     = useState(null);
  const can = useAuthStore((s) => s.can);
  const qc  = useQueryClient();

  function onSearch(v) {
    setSearch(v);
    clearTimeout(timer);
    setTimer(setTimeout(() => { setDebounced(v); setPage(1); }, 400));
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['teachers', { page, search: debounced }],
    queryFn:  () => teachersApi.list({ page, limit: LIMIT, ...(debounced && { search: debounced }) }),
    placeholderData: (prev) => prev,
  });

  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? {};

  const { mutate: remove, variables: removingId } = useMutation({
    mutationFn: (id) => teachersApi.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['teachers'] }),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Teachers</h2>
          {!isLoading && <p className="text-sm text-slate-500 mt-0.5">{(pagination.total ?? 0).toLocaleString()} teacher{pagination.total !== 1 ? 's' : ''}</p>}
        </div>
        {can('teachers') && (
          <button className="btn-primary">+ Add teacher</button>
        )}
      </div>

      <div className="card !py-3">
        <input
          type="search"
          placeholder="Search teachers…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="form-input max-w-sm"
        />
      </div>

      <div className="card !p-0 overflow-hidden">
        {isLoading ? <PageSpinner message="Loading teachers…" /> :
         isError   ? <ErrorState message={error?.message} onRetry={refetch} /> :
         rows.length === 0 ? <EmptyState icon="👩‍🏫" title="No teachers found" /> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th className="hidden sm:table-cell">Staff ID</th>
                <th className="hidden md:table-cell">Subjects</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t._id} style={{ opacity: removingId === t._id ? 0.5 : 1 }}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 text-xs font-semibold uppercase select-none">
                        {`${t.firstName?.charAt(0) ?? ''}${t.lastName?.charAt(0) ?? ''}`}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{t.firstName} {t.lastName}</p>
                        {t.email && <p className="text-xs text-slate-400">{t.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell font-mono text-xs text-slate-500">{t.staffId}</td>
                  <td className="hidden md:table-cell text-slate-600 text-sm">{(t.subjects ?? []).join(', ') || '—'}</td>
                  <td><Badge variant={t.status === 'active' ? 'success' : 'default'} dot>{t.status}</Badge></td>
                  <td className="text-right">
                    {can('teachers') && (
                      <button
                        onClick={() => window.confirm('Remove teacher?') && remove(t._id)}
                        className="btn-ghost btn-sm btn-icon text-slate-400 hover:text-red-500"
                      >🗑</button>
                    )}
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
