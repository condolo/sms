/* ============================================================
   GradesPrimitives — shared UI atoms used by all grade tabs
   Exports: Skeleton, Toast, SelField, iCls, TypePill,
            StatusBadge, EmptyMsg, ErrState, FField, PaginationBar
   ============================================================ */
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, X,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { TYPE_PILL, EXAM_STATUS_CFG } from '../constants.js';

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded-lg ${className}`} />;
}

export function Toast({ msg, type = 'success', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border shadow-sm ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {msg}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={12} /></button>
    </motion.div>
  );
}

export function SelField({ label, value, onChange, options, placeholder = 'Select…', disabled }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[140px]">
      {label && <label className="text-xs font-medium text-slate-600">{label}</label>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 disabled:opacity-50 transition"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function iCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${
    error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'
  } bg-white focus:outline-none focus:ring-2 ${
    error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'
  } text-slate-800 placeholder-slate-400 transition`;
}

export function TypePill({ type }) {
  return (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded border ${TYPE_PILL[type] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {type}
    </span>
  );
}

export function StatusBadge({ status }) {
  const cfg = EXAM_STATUS_CFG[status] ?? EXAM_STATUS_CFG.draft;
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
}

export function EmptyMsg({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white border border-slate-200 rounded-xl">
      <div className="mb-3 opacity-30">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs mt-1 text-slate-400">{subtitle}</p>}
    </div>
  );
}

export function ErrState({ msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 bg-white border border-red-200 rounded-xl">
      <AlertTriangle size={22} className="text-red-400" />
      <p className="text-sm text-slate-500">{msg ?? 'Failed to load'}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>}
    </div>
  );
}

export function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

export function PaginationBar({ page, totalPages, total, limit, onPage }) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <p className="text-xs text-slate-500">{total > 0 ? `${start}–${end} of ${total}` : '0 results'}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
        <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
        <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}
