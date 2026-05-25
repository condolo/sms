/* ============================================================
   BehaviourPrimitives — shared UI atoms for Behaviour tabs
   Exports: MS_ICONS, LIMIT, StageBadge, MilestoneBadge,
            TypeBadge, StatCard, PaginationBar, EmptyMsg,
            ErrState, FField, iCls
   ============================================================ */
import { TrendingUp, TrendingDown, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

export const LIMIT = 20;

export const MS_ICONS = {
  Bronze: '🥉',
  Silver: '🥈',
  Gold:   '🥇',
  "Principal's Award": '🏅',
  Platinum: '🏆',
};

/* ── Stage badge ─────────────────────────────────────────────── */
export function StageBadge({ stage, compact = false }) {
  if (!stage) return null;
  return (
    <span
      style={{ background: stage.color }}
      className={`inline-flex items-center text-white font-bold ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'} rounded-full`}
    >
      S{stage.stage}{!compact && ` — ${stage.label.split('—')[1]?.trim()}`}
    </span>
  );
}

/* ── Milestone badge ─────────────────────────────────────────── */
export function MilestoneBadge({ milestone, compact = false }) {
  if (!milestone) return null;
  const icon = MS_ICONS[milestone.badge] ?? '⭐';
  return (
    <span
      style={{ color: milestone.color, borderColor: milestone.ring }}
      className={`inline-flex items-center gap-1 border font-semibold ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'} rounded-full bg-white`}
    >
      {icon}{!compact && ` ${milestone.badge}`}
    </span>
  );
}

/* ── Type badge ──────────────────────────────────────────────── */
export function TypeBadge({ type }) {
  if (type === 'merit') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <TrendingUp size={10} />Merit
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
      <TrendingDown size={10} />Demerit
    </span>
  );
}

/* ── Stat card ───────────────────────────────────────────────── */
export function StatCard({ icon, label, value, valueColor, bg }) {
  return (
    <div className={`${bg} rounded-xl border border-slate-200 p-4 flex items-center gap-3`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

/* ── Pagination bar ──────────────────────────────────────────── */
export function PaginationBar({ page, totalPages, total, limit, onPage }) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <p className="text-xs text-slate-500">{total > 0 ? `${start}–${end} of ${total}` : '0 results'}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
        <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ── Empty message ───────────────────────────────────────────── */
export function EmptyMsg({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
      <div className="mb-3 opacity-40">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs mt-1 text-center max-w-xs">{subtitle}</p>}
    </div>
  );
}

/* ── Error state ─────────────────────────────────────────────── */
export function ErrState({ msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertTriangle size={24} className="text-red-400" />
      <p className="text-sm text-slate-500">{msg ?? 'Failed to load'}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>}
    </div>
  );
}

/* ── Form field wrapper ──────────────────────────────────────── */
export function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

/* ── Input class helper ──────────────────────────────────────── */
export function iCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${
    error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'
  } bg-white focus:outline-none focus:ring-2 ${
    error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'
  } text-slate-800 placeholder-slate-400 transition`;
}
