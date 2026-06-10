/**
 * KpiCard — Shared school-branded KPI card.
 *
 * Two visual variants:
 *
 *   variant="filled"  — Full-bleed school-colour background with a large
 *                       watermark icon. Used for the 4-card row on the main
 *                       dashboard. Colour cycles through the school palette.
 *
 *   variant="tinted"  — White background with a school-coloured icon tint.
 *                       Used for module page mini-cards (Finance, Library,
 *                       Transport, Hostel, Reports, etc.).
 *
 * Props
 * ─────
 *   icon        React element  e.g. <Users size={20} />
 *               OR React component  e.g. Users  (we normalise internally)
 *   label       string
 *   value       string | number
 *   sub         string — secondary line below the value
 *   to          string — react-router path; wraps card in <Link>
 *   colorIndex  0-3 — which palette/tint slot to use (default 0)
 *   loading     bool
 *   error       bool
 *   variant     'filled' | 'tinted' (default 'tinted')
 */
import React from 'react';
import { Link }  from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useSchoolTheme } from '@/hooks/useSchoolTheme.js';

/* ── Icon normaliser ──────────────────────────────────────────── */
// Accepts both a component (<Users />) and an already-rendered element.
function normaliseIcon(icon, size = 18) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  // It's a component — render it
  return React.createElement(icon, { size });
}

/* ── Skeleton blocks ──────────────────────────────────────────── */
function FilledSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-7 w-20 rounded-lg" style={{ background: 'rgba(255,255,255,0.3)' }} />
      <div className="h-3 w-32 rounded-lg" style={{ background: 'rgba(255,255,255,0.2)' }} />
    </div>
  );
}
function TintedSkeleton() {
  return <div className="h-5 w-16 bg-slate-100 rounded animate-pulse mt-0.5" />;
}

/* ── Main component ───────────────────────────────────────────── */
export function KpiCard({
  icon,
  label,
  value,
  sub,
  to,
  colorIndex = 0,
  loading    = false,
  error      = false,
  variant    = 'tinted',
}) {
  const { palette, tint } = useSchoolTheme();
  const slot = palette[colorIndex % palette.length];
  const t    = tint(colorIndex);

  const iconEl      = normaliseIcon(icon, 18);
  // Watermark — same icon rendered large (Lucide honours the `size` prop)
  const watermarkEl = iconEl
    ? React.cloneElement(iconEl, { size: 64, strokeWidth: 1.2 })
    : null;

  /* ── Filled variant ─────────────────────────────────────── */
  if (variant === 'filled') {
    const inner = (
      <div
        className="relative rounded-xl p-5 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 group"
        style={{
          background:  slot.bg,
          color:       slot.text,
          boxShadow:   '0 2px 8px rgba(0,0,0,0.10)',
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.20)'; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)'; }}
      >
        {/* Watermark */}
        {watermarkEl && (
          <div
            className="absolute -right-4 -bottom-4 pointer-events-none select-none"
            style={{ opacity: 0.15 }}
          >
            {watermarkEl}
          </div>
        )}

        {/* Content */}
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div style={{ opacity: 0.90 }}>{iconEl}</div>
            {to && (
              <ChevronRight
                size={14}
                className="opacity-50 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0"
              />
            )}
          </div>

          {loading ? <FilledSkeleton /> : error ? (
            <div className="flex items-center gap-1.5 opacity-70 text-sm">
              <AlertTriangle size={13} /><span>Failed to load</span>
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{value ?? '—'}</p>
              {sub && <p className="text-xs mt-0.5 truncate" style={{ opacity: 0.72 }}>{sub}</p>}
            </>
          )}

          <p className="text-xs font-semibold mt-3 uppercase tracking-wide" style={{ opacity: 0.70 }}>
            {label}
          </p>
        </div>
      </div>
    );

    return to
      ? <Link to={to} className="block focus:outline-none rounded-xl">{inner}</Link>
      : inner;
  }

  /* ── Tinted variant ─────────────────────────────────────── */
  const inner = (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 hover:shadow-md hover:border-slate-300 transition-all group">
      {/* Icon box */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: t.iconBg, color: t.iconColor }}
      >
        {iconEl}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {loading ? <TintedSkeleton /> : error ? (
          <div className="flex items-center gap-1 text-slate-400 mt-0.5">
            <AlertTriangle size={11} /><span className="text-xs">—</span>
          </div>
        ) : (
          <>
            <p className="text-xl font-bold text-slate-800 tabular-nums leading-tight">{value ?? '—'}</p>
            {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
          </>
        )}
      </div>

      {to && (
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition shrink-0" />
      )}
    </div>
  );

  return to
    ? <Link to={to} className="block focus:outline-none rounded-xl">{inner}</Link>
    : inner;
}

export default KpiCard;
