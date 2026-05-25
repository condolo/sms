/* ============================================================
   FinancePrimitives — shared UI atoms for Finance tabs
   Exports: ChartTip, SummaryCard, RowSkeleton, EmptyOrError,
            METHOD_COLORS
   ============================================================ */

export const METHOD_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ec4899'];

export function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-slate-300 mt-0.5">{payload[0].value?.toLocaleString?.() ?? payload[0].value}</p>
    </div>
  );
}

export function SummaryCard({ label, value, sub, accent, icon }) {
  const ACCENT = {
    slate:   { bg: 'bg-slate-50',   icon: 'text-slate-600'   },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600'   },
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600'    },
    red:     { bg: 'bg-red-50',     icon: 'text-red-600'     },
  };
  const c = ACCENT[accent] ?? ACCENT.slate;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center ${c.icon} mb-4`}>{icon}</div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      <p className="text-xs font-medium text-slate-500 mt-3">{label}</p>
    </div>
  );
}

export function RowSkeleton({ count = 5 }) {
  return (
    <div className="divide-y divide-slate-50">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
          <div className="h-3 bg-slate-100 rounded w-24" />
          <div className="flex-1 h-3 bg-slate-100 rounded" />
          <div className="h-3 bg-slate-100 rounded w-16" />
          <div className="h-5 bg-slate-100 rounded w-14" />
        </div>
      ))}
    </div>
  );
}

export function EmptyOrError({ icon, msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
      {icon}
      <p className="text-sm text-slate-500">{msg ?? 'Nothing to show'}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>}
    </div>
  );
}
