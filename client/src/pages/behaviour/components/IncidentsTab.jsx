/* ============================================================
   IncidentsTab — paginated incident log with search + type filter,
   plus (2026-10-29) class/stream/date filters, a "Recorded By" column,
   and a management-only "Export PDF" button — requested directly: a
   filterable PDF of the incident log, so leadership can see how each
   staff member is actually using the module, not just browse one
   incident at a time.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Scale, Search, Download } from 'lucide-react';
import { behaviour as behaviourApi, classes as classesApi, streams as streamsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { LIMIT, TypeBadge, PaginationBar, EmptyMsg, ErrState } from './BehaviourPrimitives.jsx';

// Same management set server-side isManagement() treats as school
// leadership (server/utils/subject-scope.js), plus discipline_committee
// (the school's designated behaviour-oversight role — full behaviour:RCUD
// by default) — mirrored here only to decide whether to SHOW the Export
// button; the server enforces this gate independently regardless of what
// the client renders.
const MANAGEMENT_ROLES = ['admin', 'superadmin', 'deputy_principal', 'deputy', 'principal', 'hod', 'discipline_committee'];

export default function IncidentsTab() {
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [typeFilter, setType] = useState('');
  const [classId, setClassId]   = useState('');
  const [streamId, setStreamId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const canExport = MANAGEMENT_ROLES.includes(role);

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list', 'active'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classesList = classesData?.data ?? [];

  const { data: streamsData } = useQuery({
    queryKey: ['streams', 'list', { classId }],
    queryFn:  () => streamsApi.list({ classId, status: 'active', limit: 50 }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const streamsList = streamsData?.data ?? [];

  const activeFilters = {
    search: search || undefined,
    type:   typeFilter || undefined,
    classId: classId || undefined,
    streamId: streamId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo:   dateTo || undefined,
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'incidents', { page, ...activeFilters }],
    queryFn:  () => behaviourApi.incidents.list({ page, limit: LIMIT, ...activeFilters }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await behaviourApi.incidents.exportPdf(activeFilters);
    } catch (err) {
      setExportError(err?.message || 'Failed to export PDF.');
    } finally {
      setExporting(false);
    }
  }

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
        <select
          value={classId}
          onChange={e => { setClassId(e.target.value); setStreamId(''); setPage(1); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none text-slate-700"
        >
          <option value="">All classes</option>
          {classesList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
        </select>
        <select
          value={streamId}
          onChange={e => { setStreamId(e.target.value); setPage(1); }}
          disabled={!classId || streamsList.length === 0}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">All streams</option>
          {streamsList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.name}</option>)}
        </select>
        <input
          type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none text-slate-700"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none text-slate-700"
        />
        {canExport && (
          <button
            onClick={handleExport}
            disabled={exporting}
            title="Export the filtered incident log as a PDF, including a per-staff activity tally"
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
            Export PDF
          </button>
        )}
      </div>
      {exportError && <p className="text-xs text-red-600">{exportError}</p>}

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
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Recorded By</th>
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
                  <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">{r.reportedByName ?? '—'}</td>
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
