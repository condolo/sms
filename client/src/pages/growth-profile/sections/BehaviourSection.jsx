/* ============================================================
   BehaviourSection — permanent, year-by-year behaviour record.
   Read-only aggregation of behaviour_incidents, grouped by academic
   year. Unlike the Behaviour module's own running total (which
   floors at the most recent points-reset), this shows every year's
   totals forever — a reset only changes what Behaviour itself
   currently displays, never this history.
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { Scale, TrendingUp, TrendingDown } from 'lucide-react';
import { growthProfile as gpApi } from '@/api/client.js';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

function fmtRange(from, to) {
  const f = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  if (!from && !to) return '';
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
}

export default function BehaviourSection({ studentId }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['growth-behaviour', studentId],
    queryFn:  () => gpApi.behaviour(studentId),
    enabled:  !!studentId,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );

  if (isError || !data?.data) return (
    <div className="py-10 text-center">
      <Scale size={24} className="mx-auto text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">Behaviour history unavailable.</p>
    </div>
  );

  const { history, allTime } = data.data;

  return (
    <div className="space-y-5">
      {/* ── All-time summary ──────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Scale size={15} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700">All-Time Behaviour Record</h3>
        </div>
        {allTime.total === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No behaviour incidents recorded.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-200">
              <p className="text-lg font-bold text-emerald-600 flex items-center justify-center gap-1"><TrendingUp size={14} />{allTime.merits}</p>
              <p className="text-[10px] text-emerald-700 mt-0.5">Merits</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200">
              <p className="text-lg font-bold text-red-600 flex items-center justify-center gap-1"><TrendingDown size={14} />{allTime.demerits}</p>
              <p className="text-[10px] text-red-700 mt-0.5">Demerits</p>
            </div>
            <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className={`text-lg font-bold ${allTime.points >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{allTime.points > 0 ? '+' : ''}{allTime.points}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Net points</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Year-by-year breakdown ────────────────────────────── */}
      {history.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Scale size={15} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-700">By Academic Year</h3>
          </div>
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.academicYearId ?? 'unassigned'} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-sm font-medium text-slate-700">{h.academicYearName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmtRange(h.firstDate, h.lastDate)} · {h.total} incident{h.total !== 1 ? 's' : ''}</p>
                </div>
                <div className="text-right flex items-center gap-3">
                  <span className="text-xs text-emerald-600 font-medium">+{h.merits}M</span>
                  <span className="text-xs text-red-600 font-medium">-{h.demerits}D</span>
                  <span className={`text-sm font-bold ${h.points >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{h.points > 0 ? '+' : ''}{h.points}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 text-center">
            This history is permanent — it is never cleared when Behaviour's own running total resets for a new academic year.
          </p>
        </div>
      )}
    </div>
  );
}
