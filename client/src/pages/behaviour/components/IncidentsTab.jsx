/* ============================================================
   IncidentsTab — paginated incident log with search + type filter
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Scale, Search } from 'lucide-react';
import { behaviour as behaviourApi } from '@/api/client.js';
import { LIMIT, TypeBadge, PaginationBar, EmptyMsg, ErrState } from './BehaviourPrimitives.jsx';

export default function IncidentsTab() {
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [typeFilter, setType] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'incidents', { page, search, typeFilter }],
    queryFn:  () => behaviourApi.incidents.list({
      page,
      limit: LIMIT,
      search: search || undefined,
      type:   typeFilter || undefined,
    }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search incidents…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => { setType(e.target.value); setPage(1); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none text-slate-700"
        >
          <option value="">All types</option>
          <option value="merit">Merit</option>
          <option value="demerit">Demerit</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Scale size={36} />} title="No incidents" subtitle="Use Award Points to log the first incident" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Behaviour</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Points</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.studentName ?? r.studentId}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[200px]">
                    <span className="block truncate">{r.description ?? r.category ?? '—'}</span>
                    {r.note && <span className="block text-xs text-slate-400 italic truncate">{r.note}</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell"><TypeBadge type={r.type} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">{r.category ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold ${(r.points ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(r.points ?? 0) > 0 ? '+' : ''}{r.points}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
        </div>
      )}
    </motion.div>
  );
}
