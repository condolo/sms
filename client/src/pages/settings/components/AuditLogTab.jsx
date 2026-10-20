/* ============================================================
   Settings → Audit Log tab

   Redesigned (2026-10):
     • a KPI row (total events, severity split, distinct actors,
       last-24h activity) that doubles as a severity filter
     • a filter bar with free-text search, a severity segmented
       control, date presets and a from/to range
     • a table that reads like a log, not a dump: icon + readable
       action label (the raw action name stays visible in mono for
       anyone grepping), severity dot, actor avatar, target type
     • real pagination with a page window and a per-page selector

   The stats come from GET /api/audit/stats (server-side aggregates
   over the same school scope and the same date window as the table),
   never from counting the rows currently on screen.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, Search, X, Loader2, Download, CalendarDays,
  Activity, ShieldAlert, TriangleAlert, Info, Users, Clock, ChevronDown,
} from 'lucide-react';
import { audit as auditApi } from '@/api/client.js';
import PaginationBar from './PaginationBar.jsx';
import { actionLabel, actionIcon, severityMeta, relativeTime, SEVERITY_META, SEVERITY_ORDER } from './auditActionMeta.js';

/* ── Debounce a fast-changing value (the search box) ──────────── */
function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ── Date presets ────────────────────────────────────────────── */
function _isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}
const DATE_PRESETS = [
  { id: 'today', label: 'Today', from: () => _isoDay(0), to: () => _isoDay(0) },
  { id: '7d',    label: '7 days', from: () => _isoDay(6),  to: () => _isoDay(0) },
  { id: '30d',   label: '30 days', from: () => _isoDay(29), to: () => _isoDay(0) },
  { id: 'all',   label: 'All time', from: () => '', to: () => '' },
];

/* ── KPI card ────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, sub, tone = 'slate', onClick, active }) {
  const tones = {
    slate:   'bg-slate-100   text-slate-600',
    violet:  'bg-violet-100  text-violet-600',
    sky:     'bg-sky-100     text-sky-600',
    amber:   'bg-amber-100   text-amber-600',
    red:     'bg-red-100     text-red-500',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={`text-left bg-white border rounded-xl px-4 py-3 flex items-center gap-3 transition ${
        active ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200'
      } ${onClick ? 'hover:border-slate-300 hover:shadow-sm cursor-pointer' : ''}`}
    >
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold text-slate-800 leading-tight tabular-nums">{value ?? '—'}</span>
        <span className="block text-[11px] text-slate-500 truncate">{label}</span>
        {sub && <span className="block text-[10px] text-slate-400 truncate">{sub}</span>}
      </span>
    </Tag>
  );
}

/* ── Actor avatar ────────────────────────────────────────────── */
const AVATAR_TINTS = [
  'bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
  'bg-indigo-100 text-indigo-700',
];
function tintFor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
function initialsOf(value = '') {
  const source = String(value).trim();
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── CSV export ──────────────────────────────────────────────── */
function _csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AuditLogTab() {
  const [page, setPage]         = useState(1);
  const [limit, setLimit]       = useState(50);
  const [action, setAction]     = useState('');
  const [severity, setSeverity] = useState('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [search, setSearch]     = useState('');
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounced(search, 300);

  useEffect(() => { setPage(1); }, [debouncedSearch, action, severity, from, to, limit]);

  const filterParams = useMemo(() => ({
    page, limit,
    ...(action && { action }),
    ...(severity && { severity }),
    ...(from && { from }),
    ...(to && { to }),
    ...(debouncedSearch && { q: debouncedSearch }),
  }), [page, limit, action, severity, from, to, debouncedSearch]);

  const { data: actionsData } = useQuery({
    queryKey: ['audit-actions'],
    queryFn:  () => auditApi.actions(),
    staleTime: Infinity,
  });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['audit-logs', filterParams],
    queryFn:  () => auditApi.list(filterParams),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  /* Stats follow the DATE window only — a severity filter shouldn't
     change "total events", but a date range should. */
  const { data: statsData, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['audit-stats', from, to],
    queryFn:  () => auditApi.stats({ ...(from && { from }), ...(to && { to }) }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const logs       = data?.data ?? [];
  const pagination = data?.pagination;
  const stats      = statsData?.data;

  const actionOptions = useMemo(() => {
    const list = actionsData?.data ?? [];
    return [...list].sort((a, b) => a.action.localeCompare(b.action));
  }, [actionsData]);

  const hasFilter = !!(action || severity || from || to || debouncedSearch);

  function clearFilters() {
    setAction(''); setSeverity(''); setFrom(''); setTo(''); setSearch('');
  }

  function applyPreset(preset) {
    setFrom(preset.from());
    setTo(preset.to());
  }

  function activePreset() {
    const hit = DATE_PRESETS.find(p => p.from() === from && p.to() === to);
    return hit?.id ?? null;
  }

  async function exportCsv() {
    setExporting(true);
    try {
      // Pull every page of the CURRENT filter (capped) so the export is
      // the whole filtered log, not just the page on screen.
      const rows = [];
      const perPage = 200;
      let p = 1;
      while (rows.length < 2000) {
        const res = await auditApi.list({ ...filterParams, page: p, limit: perPage });
        const batch = res?.data ?? [];
        rows.push(...batch);
        const pages = res?.pagination?.pages ?? 1;
        if (p >= pages || batch.length === 0) break;
        p += 1;
      }

      const header = ['Time', 'Action', 'Severity', 'Actor', 'Actor role', 'Target', 'Target type', 'IP'];
      const lines = [header.join(',')];
      for (const log of rows) {
        lines.push([
          log.createdAt,
          log.action,
          log.severity,
          log.actor?.email ?? log.actor?.userId ?? '',
          log.actor?.role ?? '',
          log.target?.label ?? log.target?.id ?? '',
          log.target?.type ?? '',
          log.ip ?? '',
        ].map(_csvCell).join(','));
      }

      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${_isoDay(0)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      /* silent — the browser shows the download or the error surfaces in console */
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ClipboardList size={17} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Audit Log</h2>
            <p className="text-sm text-slate-500">
              High-impact actions performed by users in your school, in reverse chronological order.
            </p>
          </div>
        </div>

        <button
          onClick={exportCsv}
          disabled={exporting || !logs.length}
          className="flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-sm font-medium px-3 py-2 rounded-lg transition"
        >
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* ── KPI row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          icon={Activity}
          label="Total events"
          value={stats?.total ?? '—'}
          tone="violet"
          sub={stats?.last24h != null ? `${stats.last24h} in last 24h` : undefined}
        />
        <StatCard
          icon={ShieldAlert}
          label="Critical"
          value={stats?.bySeverity?.critical ?? '—'}
          tone="red"
          active={severity === 'critical'}
          onClick={() => { setSeverity(s => (s === 'critical' ? '' : 'critical')); setPage(1); }}
        />
        <StatCard
          icon={TriangleAlert}
          label="Warnings"
          value={stats?.bySeverity?.warn ?? '—'}
          tone="amber"
          active={severity === 'warn'}
          onClick={() => { setSeverity(s => (s === 'warn' ? '' : 'warn')); setPage(1); }}
        />
        <StatCard
          icon={Info}
          label="Informational"
          value={stats?.bySeverity?.info ?? '—'}
          tone="sky"
          active={severity === 'info'}
          onClick={() => { setSeverity(s => (s === 'info' ? '' : 'info')); setPage(1); }}
        />
        <StatCard
          icon={Users}
          label="People involved"
          value={stats?.uniqueActors ?? '—'}
          tone="slate"
          sub={stats?.topAction ? `Top: ${actionLabel(stats.topAction.action)}` : undefined}
        />
      </div>

      {/* The counters are a separate query from the table, so they can fail
          on their own (a hiccup, a restart). Say so and offer a retry rather
          than leaving five silent dashes above a perfectly good table. */}
      {statsError && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <TriangleAlert size={13} className="shrink-0" />
          Couldn't load the audit summary.
          <button onClick={() => refetchStats()} className="font-semibold underline">Retry</button>
        </div>
      )}

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search action, actor or target…"
              aria-label="Search the audit log"
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Action */}
          <div className="relative">
            <select
              value={action}
              onChange={e => { setAction(e.target.value); setPage(1); }}
              aria-label="Filter by action"
              className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition max-w-[220px]"
            >
              <option value="">All actions</option>
              {actionOptions.map(a => (
                <option key={a.action} value={a.action}>{actionLabel(a.action)}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          {/* Severity segmented control */}
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {[
              { id: '',        label: 'All' },
              { id: 'info',    label: 'Info' },
              { id: 'warn',    label: 'Warn' },
              { id: 'critical', label: 'Critical' },
            ].map(s => (
              <button
                key={s.id || 'all'}
                onClick={() => { setSeverity(s.id); setPage(1); }}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
                  severity === s.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {hasFilter && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <CalendarDays size={13} className="text-slate-400" />
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {DATE_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition ${
                  activePreset() === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={e => { setFrom(e.target.value); setPage(1); }}
              aria-label="From date"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400/40"
            />
            <span className="text-slate-300">–</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={e => { setTo(e.target.value); setPage(1); }}
              aria-label="To date"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400/40"
            />
          </div>

          {isFetching && !isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" /> Updating…
            </span>
          )}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
              <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
              <div className="h-3 w-48 bg-slate-100 rounded animate-pulse" />
              <div className="h-5 w-16 bg-slate-100 rounded-full animate-pulse ml-auto" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <TriangleAlert size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load audit logs.'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-14 flex flex-col items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center">
            <ClipboardList size={20} className="text-slate-300" />
          </span>
          <p className="text-sm font-medium text-slate-700">
            {hasFilter ? 'No events match these filters' : 'No audit events yet'}
          </p>
          <p className="text-xs text-slate-400 max-w-xs text-center">
            {hasFilter
              ? 'Try a wider date range or clear the filters.'
              : 'High-impact actions taken in your school will appear here.'}
          </p>
          {hasFilter && (
            <button onClick={clearFilters} className="mt-1 text-xs font-medium text-violet-600 hover:text-violet-700 underline">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 w-[130px]">Time</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">Action</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 w-[110px]">Severity</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">Actor</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {logs.map((log, i) => {
                  const sev    = severityMeta(log.severity);
                  const Icon   = actionIcon(log.action);
                  const actor  = log.actor?.email ?? log.actor?.userId ?? null;
                  const target = log.target?.label ?? log.target?.id ?? null;
                  return (
                    <tr key={log._id ?? i} className="hover:bg-slate-50/70 transition-colors align-top">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Clock size={11} className="text-slate-300 shrink-0" />
                          <span className="text-xs font-medium text-slate-600">{relativeTime(log.createdAt)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 pl-5">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          }) : '—'}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            log.severity === 'critical' ? 'bg-red-50 text-red-500'
                            : log.severity === 'warn' ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                          }`}>
                            <Icon size={13} />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 leading-snug">{actionLabel(log.action)}</p>
                            <code className="text-[11px] font-mono text-slate-400">{log.action}</code>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${sev.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                          {sev.label}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {actor ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${tintFor(actor)}`}>
                              {initialsOf(actor)}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs text-slate-700 truncate max-w-[190px]">{actor}</p>
                              {log.actor?.role && (
                                <p className="text-[10px] text-slate-400 capitalize">{String(log.actor.role).replace(/_/g, ' ')}</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 hidden lg:table-cell">
                        {target ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            {log.target?.type && (
                              <span className="text-[10px] uppercase tracking-wide text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">
                                {log.target.type}
                              </span>
                            )}
                            <span className="text-xs text-slate-600 truncate max-w-[220px]">{target}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={page}
            totalPages={pagination?.pages ?? 1}
            total={pagination?.total ?? 0}
            limit={limit}
            onPage={setPage}
            onLimit={(n) => setLimit(n)}
            itemLabel="events"
            limitOptions={[25, 50, 100, 200]}
          />
        </div>
      )}
    </div>
  );
}
