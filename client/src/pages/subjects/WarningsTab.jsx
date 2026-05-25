/* ============================================================
   WarningsTab — Enrollment rule violations.

   Shows students who have too few or too many subjects based
   on the subject_rules configured in the Timetable settings.

   School-wide view: only classes with at least one violation shown.
   Per-class view: full breakdown including ok students.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import {
  classes       as classesApi,
  classSubjects as csApi,
} from '@/api/client.js';

const STATUS_CONFIG = {
  ok:         { label: 'OK',          color: 'bg-emerald-100 text-emerald-700' },
  below_min:  { label: 'Too few',     color: 'bg-red-100    text-red-700'      },
  above_max:  { label: 'Too many',    color: 'bg-amber-100  text-amber-700'    },
  no_rule:    { label: 'No rule',     color: 'bg-slate-100  text-slate-500'    },
};

const SECTION_BADGE = {
  primary:   'bg-blue-100 text-blue-700',
  secondary: 'bg-violet-100 text-violet-700',
  alevel:    'bg-amber-100 text-amber-700',
  all:       'bg-slate-100 text-slate-600',
  kg:        'bg-pink-100 text-pink-700',
};

function ClassWarningCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const { summary, rule, students, className, sectionKey } = item;

  const hasViolations = summary.belowMin > 0 || summary.aboveMax > 0;

  return (
    <div className={clsx('rounded-xl border bg-white shadow-sm overflow-hidden', hasViolations ? 'border-red-200' : 'border-slate-200')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-slate-50 transition select-none" onClick={() => setExpanded(e => !e)}>
        <div className={clsx('h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-white text-xs font-bold', hasViolations ? 'bg-red-500' : 'bg-emerald-500')}>
          {hasViolations ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 text-sm">{className}</span>
            {sectionKey && <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-medium', SECTION_BADGE[sectionKey] ?? 'bg-slate-100 text-slate-600')}>{sectionKey}</span>}
            {rule && <span className="text-[11px] text-slate-400">Rule: {rule.minSubjects}–{rule.maxSubjects} subjects</span>}
            {!rule && <span className="text-[11px] text-amber-600 font-medium">No rule configured</span>}
          </div>
          <div className="flex gap-2 mt-0.5">
            {summary.belowMin > 0  && <span className="text-[11px] text-red-600 font-medium">{summary.belowMin} below min</span>}
            {summary.aboveMax > 0  && <span className="text-[11px] text-amber-600 font-medium">{summary.aboveMax} above max</span>}
            {summary.ok > 0        && <span className="text-[11px] text-slate-400">{summary.ok} ok</span>}
            {summary.total === 0   && <span className="text-[11px] text-slate-400">No students</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Summary pills */}
          {summary.belowMin > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{summary.belowMin} ↓</span>
          )}
          {summary.aboveMax > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{summary.aboveMax} ↑</span>
          )}
          {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </div>

      {/* Student breakdown */}
      {expanded && (
        <div className="border-t border-slate-100">
          {students.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-400 text-center">No students in this class</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {students.map(s => {
                const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.no_rule;
                const isViolation = s.status === 'below_min' || s.status === 'above_max';
                return (
                  <div key={s.id} className={clsx('flex items-center gap-3 px-5 py-2.5', isViolation && 'bg-red-50/40')}>
                    <div className="h-7 w-7 shrink-0 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-xs font-semibold">
                      {(s.firstName?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                      {s.admissionNumber && <p className="text-[11px] text-slate-400">{s.admissionNumber}</p>}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-sm text-slate-600 font-medium">{s.subjectCount} subj.</span>
                      <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.color)}>{cfg.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WarningsTab({ flash }) {
  const [classId, setClassId] = useState('');  // empty = school-wide

  /* ── queries ─────────────────────────────────────────────── */
  const { data: classes = [] } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    select:   r => (r?.data ?? (Array.isArray(r) ? r : [])).sort((a,b) => (a.order ?? 0) - (b.order ?? 0)),
    staleTime: 60_000,
  });

  const { data: warningsData, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['enrollment-warnings', classId],
    queryFn:  () => csApi.warnings(classId ? { classId } : {}),
    select:   r => r?.data ?? r ?? { classes: [] },
    staleTime: 30_000,
  });

  const classResults = warningsData?.classes ?? [];

  /* ── summary stats ────────────────────────────────────────── */
  const totalViolations = classResults.reduce((a, c) => a + c.summary.belowMin + c.summary.aboveMax, 0);
  const totalBelow      = classResults.reduce((a, c) => a + c.summary.belowMin, 0);
  const totalAbove      = classResults.reduce((a, c) => a + c.summary.aboveMax, 0);

  /* Group classes by section */
  const classBySection = classes.reduce((acc, c) => {
    const key = c.sectionKey ?? 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});
  const sectionOrder = ['kg','primary','secondary','alevel','other'];

  /* ── render ─────────────────────────────────────────────── */
  return (
    <div className="px-6 py-5">

      {/* Controls */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <select
          value={classId}
          onChange={e => setClassId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[200px]"
        >
          <option value="">School-wide (all violations)</option>
          {sectionOrder.map(sec => {
            const group = classBySection[sec];
            if (!group?.length) return null;
            return (
              <optgroup key={sec} label={sec.charAt(0).toUpperCase() + sec.slice(1)}>
                {group.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            );
          })}
        </select>

        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>

        {!classId && (
          <p className="text-xs text-slate-500">
            Showing only classes with ≥1 violation. Select a class to see all students.
          </p>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="py-16 text-center text-slate-400 flex items-center justify-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" />Checking enrollment rules…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Failed to load warnings: {error.message}
        </div>
      )}

      {/* Stats strip */}
      {!isLoading && !error && classResults.length > 0 && !classId && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total violations', value: totalViolations, color: 'text-red-600' },
            { label: 'Below minimum',    value: totalBelow,      color: 'text-red-700' },
            { label: 'Above maximum',    value: totalAbove,      color: 'text-amber-600' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl bg-white border border-slate-200 px-5 py-3.5 shadow-sm">
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className={clsx('text-2xl font-bold mt-0.5', stat.color)}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* All-clear */}
      {!isLoading && !error && classResults.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-emerald-200 py-20 text-center">
          <CheckCircle size={36} className="mx-auto text-emerald-400 mb-3" />
          <p className="text-sm font-medium text-slate-700">
            {classId ? 'No enrollment violations in this class' : 'No enrollment violations across the school'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            All students are within the configured min/max subject bounds.
          </p>
        </div>
      )}

      {/* Class cards */}
      {!isLoading && classResults.length > 0 && (
        <div className="space-y-3">
          {classResults.map(item => (
            <ClassWarningCard key={item.classId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
