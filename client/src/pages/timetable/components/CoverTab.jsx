/* ============================================================
   CoverTab — daily substitution management
   Reads from substitutions collection; never touches timetable_slots.
   Props: teachers []  — active teacher list
   ============================================================ */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, UserX, ClipboardList, CheckCircle2, AlertCircle,
  Zap, Printer, ChevronRight, History,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { timetable as ttApi } from '@/api/client.js';
import { ABSENCE_REASONS } from '../constants.js';
import { Toast } from './TimetablePrimitives.jsx';

/* ── Available-teacher picker per substitution row ─────────────
   React Query deduplicates — two rows at the same period share one
   request. ── */
function SubstituteCell({ sub, date, onAssign }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tt-avail', date, String(sub.period), sub.subject ?? ''],
    queryFn:  () => ttApi.availableTeachers({ date, period: sub.period, subject: sub.subject }),
    staleTime: 60_000,
    enabled:  !!date && sub.period !== undefined,
  });
  const available = data?.data?.available ?? [];
  const suggested = available.find(a => a.suggested);

  return (
    <>
      <div className="print:hidden">
        {isLoading ? (
          <div className="h-6 w-40 bg-slate-100 rounded animate-pulse" />
        ) : (
          <select
            value={sub.substituteTeacherId ?? ''}
            onChange={e => onAssign(sub.id, e.target.value || null)}
            className="text-xs rounded border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900/20 text-slate-800 min-w-[180px] max-w-[260px]"
          >
            <option value="">— assign substitute —</option>
            {suggested && (
              <option value={suggested.id}>
                ⭐ {suggested.name}{suggested.sameDepartment ? ' (dept)' : ''} · {suggested.weeklyLoad} lessons
              </option>
            )}
            {available.filter(t => !t.suggested).map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.sameDepartment ? ' ★' : ''} · {t.weeklyLoad} lessons
              </option>
            ))}
            {available.length === 0 && (
              <option disabled value="">No teachers available at this period</option>
            )}
          </select>
        )}
      </div>
      <span className="hidden print:inline text-sm font-medium">
        {sub.substituteTeacherName ?? '—'}
      </span>
    </>
  );
}

export default function CoverTab({ teachers }) {
  const qc = useQueryClient();
  const [date,        setDate]        = useState(() => new Date().toISOString().slice(0, 10));
  const [absentId,    setAbsentId]    = useState('');
  const [reason,      setReason]      = useState('sick');
  const [coverToast,  setCoverToast]  = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  function showT(msg, type = 'success') {
    setCoverToast({ msg, type });
    setTimeout(() => setCoverToast(null), 4500);
  }

  /* Substitutions for selected date */
  const { data: subsData, isLoading: subsLoading } = useQuery({
    queryKey: ['substitutions', date],
    queryFn:  () => ttApi.substitutions.list({ date }),
    staleTime: 30_000,
  });
  const subs = subsData?.data?.substitutions ?? [];

  /* Publish history (lazy) */
  const { data: versionsData } = useQuery({
    queryKey: ['timetable', 'versions'],
    queryFn:  ttApi.versions,
    enabled:  historyOpen,
    staleTime: 60_000,
  });
  const versions = versionsData?.data?.versions ?? [];

  const markAbsent = useMutation({
    mutationFn: () => ttApi.substitutions.markAbsent({ teacherId: absentId, date, reason }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['substitutions', date] });
      qc.invalidateQueries({ queryKey: ['tt-avail', date] });
      setAbsentId('');
      const created = res?.data?.created ?? 0;
      const existed = res?.data?.alreadyExisted ?? 0;
      if (!created && !existed) showT('No lessons found for that teacher on this day.', 'error');
      else if (!created)        showT('Absence already recorded for this teacher.');
      else showT(`${created} lesson${created !== 1 ? 's' : ''} added to cover sheet.`);
    },
    onError: err => showT(err?.message ?? 'Failed to mark absent.', 'error'),
  });

  const assignSub = useMutation({
    mutationFn: ({ id, substituteTeacherId, type }) =>
      ttApi.substitutions.update(id, {
        ...(substituteTeacherId !== undefined ? { substituteTeacherId: substituteTeacherId || null } : {}),
        ...(type !== undefined ? { type } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['substitutions', date] });
      qc.invalidateQueries({ queryKey: ['tt-avail', date] });
    },
    onError: err => showT(err?.message ?? 'Failed to update.', 'error'),
  });

  const autoAssign = useMutation({
    mutationFn: () => ttApi.substitutions.autoAssign({ date }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['substitutions', date] });
      qc.invalidateQueries({ queryKey: ['tt-avail', date] });
      const n = res?.data?.assigned ?? 0;
      showT(n > 0 ? `Auto-assigned ${n} substitute${n !== 1 ? 's' : ''}.` : 'No uncovered lessons to assign.');
    },
    onError: err => showT(err?.message ?? 'Auto-assign failed.', 'error'),
  });

  const removeRecord = useMutation({
    mutationFn: (id) => ttApi.substitutions.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['substitutions', date] });
      qc.invalidateQueries({ queryKey: ['tt-avail', date] });
    },
    onError: err => showT(err?.message ?? 'Failed to remove.', 'error'),
  });

  /* Group subs by absent teacher */
  const byTeacher = {};
  subs.forEach(s => {
    if (!byTeacher[s.originalTeacherId]) {
      byTeacher[s.originalTeacherId] = { name: s.originalTeacherName, slots: [] };
    }
    byTeacher[s.originalTeacherId].slots.push(s);
  });
  const absentGroups   = Object.entries(byTeacher);
  const coveredCount   = subs.filter(s => s.status === 'covered').length;
  const uncoveredCount = subs.filter(s => s.status === 'uncovered').length;

  const summaryLine = absentGroups
    .map(([, { name, slots }]) => {
      const ps = [...new Set(slots.map(s => s.period))]
        .sort((a, b) => String(a).localeCompare(String(b)))
        .join(', ');
      return `${name} (${ps})`;
    })
    .join(' and ');

  const dateLabel = (() => {
    try {
      return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch { return date; }
  })();

  const selCls = 'text-xs rounded border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-900/20 text-slate-800';

  return (
    <div className="space-y-4">

      <AnimatePresence>
        {coverToast && (
          <Toast msg={coverToast.msg} type={coverToast.type} onDismiss={() => setCoverToast(null)} />
        )}
      </AnimatePresence>

      {/* Mark Absent form */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <UserX size={14} className="text-red-400" /> Mark Teacher Absent
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Date</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800"
              style={{ width: '160px' }}
            />
          </div>
          <div style={{ minWidth: '200px', flex: 1 }}>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Absent Teacher *</label>
            <select
              value={absentId} onChange={e => setAbsentId(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800"
            >
              <option value="">Select teacher…</option>
              {teachers.map(t => (
                <option key={t.id ?? t._id} value={t.id ?? t._id}>{t.firstName} {t.lastName}</option>
              ))}
            </select>
          </div>
          <div style={{ width: '160px' }}>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Reason</label>
            <select
              value={reason} onChange={e => setReason(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800"
            >
              {ABSENCE_REASONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </div>
          <button
            disabled={!absentId || markAbsent.isPending}
            onClick={() => markAbsent.mutate()}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {markAbsent.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />}
            {markAbsent.isPending ? 'Marking…' : 'Mark Absent'}
          </button>
        </div>
      </div>

      {/* Cover Sheet */}
      {subsLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 animate-pulse space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
        </div>
      ) : subs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <ClipboardList size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-500">No cover arrangements for {date}</p>
          <p className="text-xs text-slate-400 mt-1">Mark a teacher absent above to generate the cover sheet.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">

          {/* Sheet title */}
          <div className="px-6 pt-5 pb-4 border-b border-slate-100 text-center">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Substitution</h2>
            <p className="text-sm text-slate-600 mt-0.5">{dateLabel}</p>
            {summaryLine && (
              <p className="text-xs text-slate-500 mt-2 max-w-2xl mx-auto leading-relaxed">
                Unfortunately, the following teachers will not teach today:&nbsp;
                <strong className="text-slate-700">{summaryLine}</strong>
              </p>
            )}
          </div>

          {/* Action bar */}
          <div className="px-5 py-2.5 border-b border-slate-100 flex items-center justify-between print:hidden bg-slate-50/60">
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 size={12} /> {coveredCount} covered
              </span>
              <span className="flex items-center gap-1.5 text-amber-600">
                <AlertCircle size={12} /> {uncoveredCount} uncovered
              </span>
            </div>
            <div className="flex items-center gap-2">
              {uncoveredCount > 0 && (
                <button
                  onClick={() => autoAssign.mutate()}
                  disabled={autoAssign.isPending}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white transition"
                >
                  {autoAssign.isPending ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                  {autoAssign.isPending ? 'Assigning…' : 'Auto-assign all'}
                </button>
              )}
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
              >
                <Printer size={11} /> Print
              </button>
            </div>
          </div>

          {/* Substitution table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse" style={{ minWidth: '820px' }}>
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-50 text-left">
                  <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-36">Absent</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-20 text-center">Lesson</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-28">Reason</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-24">Subject</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-24">Class</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-28 print:hidden">Type</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">Substitutes</th>
                  <th className="px-3 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide w-36 hidden print:table-cell">Signature</th>
                </tr>
              </thead>
              <tbody>
                {absentGroups.map(([tid, { name, slots }]) => {
                  const sorted = slots.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
                  return sorted.map((s, idx) => (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50/30 transition">
                      {idx === 0 && (
                        <td rowSpan={sorted.length} className="px-4 py-3 align-top border-r border-slate-100 bg-red-50/30">
                          <span className="text-sm font-semibold text-slate-900 block">{name}</span>
                          <button
                            onClick={() => {
                              if (!window.confirm(`Remove all cover records for ${name} on ${date}?`)) return;
                              sorted.forEach(r => removeRecord.mutate(r.id));
                            }}
                            className="mt-1.5 text-[10px] text-red-400 hover:text-red-600 hover:underline print:hidden"
                          >
                            Clear all
                          </button>
                        </td>
                      )}
                      <td className="px-3 py-3 text-center">
                        <span className="text-base font-bold text-slate-800">{s.period}</span>
                        {s.startTime && (
                          <span className="block text-[10px] text-slate-400 leading-tight">{s.startTime}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {ABSENCE_REASONS.find(r => r.v === s.reason)?.l ?? s.reason}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-sm font-bold text-slate-800">{s.subject || '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-xs font-medium text-slate-700">
                        {s.className || s.classId || '—'}
                      </td>
                      <td className="px-3 py-3 print:hidden">
                        <select
                          value={s.type ?? 'supervision'}
                          onChange={e => assignSub.mutate({ id: s.id, type: e.target.value })}
                          className={selCls}
                        >
                          <option value="supervision">Supervision</option>
                          <option value="cover">Cover</option>
                          <option value="teaching">Teaching</option>
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SubstituteCell
                            sub={s}
                            date={date}
                            onAssign={(id, subId) => assignSub.mutate({ id, substituteTeacherId: subId || null })}
                          />
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 print:hidden ${
                            s.status === 'covered'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {s.status === 'covered'
                              ? <><CheckCircle2 size={9} /> Covered</>
                              : <><AlertCircle  size={9} /> Uncovered</>}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden print:table-cell text-slate-300 text-sm">
                        ______________
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>

          <div className="hidden print:block px-6 py-3 border-t border-slate-200 text-[10px] text-slate-400">
            Page printed: {new Date().toLocaleDateString('en-GB')} {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}

      {/* Publish History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setHistoryOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-2">
            <History size={13} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">Publish History</span>
          </div>
          <ChevronRight size={14} className={`text-slate-400 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
        </button>
        <AnimatePresence>
          {historyOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-slate-100"
            >
              {versions.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No publish history yet.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {versions.map((v, i) => (
                    <div key={v.id} className="px-5 py-3 flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${i === 0 ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800">
                          {v.termLabel || 'Untitled version'}
                          {i === 0 && <span className="ml-2 text-[10px] text-emerald-600 font-semibold">Current</span>}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(v.publishedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                          {' · '}{v.slotCount} slots
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
