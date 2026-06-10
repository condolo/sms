/* ============================================================
   AdmissionsPrimitives — shared UI atoms for Admissions
   ============================================================ */
import { useSchoolTheme } from '@/hooks/useSchoolTheme.js';

/* ── Stat chip (header strip) ─────────────────────────────── */
/**
 * colorIndex cycles through the school palette tints.
 * The legacy `accent` prop is still accepted for backward compat
 * but colorIndex takes precedence when provided.
 */
export function StatChip({ icon, label, value, accent, colorIndex }) {
  const { tint, primary, accent: accentColor } = useSchoolTheme();
  // When colorIndex is given use school theme; otherwise fall back
  // to a legacy static accent so existing callers without colorIndex still work.
  const useTheme = colorIndex != null;
  const t = useTheme ? tint(colorIndex) : null;
  const iconColor = useTheme ? t.iconColor : (accent === 'emerald' ? '#059669' : accent === 'blue' ? '#2563eb' : accent === 'amber' ? '#d97706' : primary);
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span style={{ color: iconColor }}>{icon}</span>
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold" style={{ color: iconColor }}>{value}</span>
    </div>
  );
}

/* ── Form primitives ──────────────────────────────────────── */
export function Section({ label, children }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Field({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

export function inputCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${
    error ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:ring-slate-900/10'
  } bg-white focus:outline-none focus:ring-2 focus:border-slate-400 text-slate-800 placeholder-slate-400 transition`;
}

/* ── Kanban primitives ────────────────────────────────────── */
export function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-slate-100 rounded w-3/4" />
          <div className="h-2.5 bg-slate-100 rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}

export function EmptyCol({ label }) {
  return (
    <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
      <p className="text-xs text-slate-400">No {label.toLowerCase()} applicants</p>
    </div>
  );
}

/* ── Detail panel primitives ──────────────────────────────── */
export function DetailSection({ icon, label, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-slate-400">{icon}</span>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function DetailRow({ label, value, icon }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-slate-400 shrink-0 w-28">{label}</span>
      <span className="text-xs font-medium text-slate-700 text-right flex items-center gap-1">
        {icon}{value}
      </span>
    </div>
  );
}
