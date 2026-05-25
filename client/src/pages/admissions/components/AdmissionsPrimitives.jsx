/* ============================================================
   AdmissionsPrimitives — shared UI atoms for Admissions
   ============================================================ */

/* ── Stat chip (header strip) ─────────────────────────────── */
export function StatChip({ icon, label, value, accent }) {
  const accents = { emerald: 'text-emerald-600', blue: 'text-blue-600', amber: 'text-amber-600' };
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className={accent ? accents[accent] : 'text-slate-500'}>{icon}</span>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-semibold ${accent ? accents[accent] : 'text-slate-800'}`}>{value}</span>
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
