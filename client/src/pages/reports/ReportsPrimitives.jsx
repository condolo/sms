/* ============================================================
   Reports & Analytics — shared presentational primitives.
   Extracted from ReportsPage.jsx so AssessmentAnalyticsPage.jsx (and any
   future promoted-to-its-own-page tab) can reuse the exact same KPI
   card / panel / chart-tooltip look without a second copy drifting.
   ============================================================ */
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useSchoolTheme } from '@/hooks/useSchoolTheme.js';

export const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

/**
 * Stat — Reports page KPI card.
 * colorIndex selects the school's palette tint slot.
 * trend is kept as semantic green/red (has UX meaning).
 */
export function Stat({ label, value, sub, trend, Icon, colorIndex = 0 }) {
  const { tint } = useSchoolTheme();
  const t = tint(colorIndex);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className="rounded-lg p-2" style={{ background: t.iconBg, color: t.iconColor }}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      {trend != null && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(trend)}% vs last term
        </div>
      )}
    </div>
  );
}

export function Card({ title, children, action }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-slate-300">{p.name}: <span className="text-white font-semibold">{p.value?.toLocaleString()}</span></p>
      ))}
    </div>
  );
}
