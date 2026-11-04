/* ============================================================
   StudentAttendanceSheet — the conversation starter.

   A teacher sees "Amina · 5 absences" on the dashboard. The number is a
   prompt, not an explanation, so this sheet opens the month behind it: the
   day-by-day register, the summary in a sentence, and — the reason it
   exists — who to tell. The guardians come from the server's own audience
   resolution, so the reply can only ever go to a parent of a child this
   teacher actually teaches.

   Data: GET /api/teacher-portal/students/:studentId/attendance?month=YYYY-MM
   ============================================================ */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Loader2, MessageSquare, Send, X,
} from 'lucide-react';
import clsx from 'clsx';
import { teacherPortalApi } from '@/api/client.js';

const STATUS = {
  present:            { label: 'Present',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  late:               { label: 'Late',       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  absent:             { label: 'Absent',     cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  authorised_absence: { label: 'Authorised', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  // The server's remainder bucket: rows whose status is neither attended,
  // absent nor authorised (excluded, holiday). Shown only when non-zero.
  other:              { label: 'Other',      cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

function _monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) return month ?? '';
  return new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function _shiftMonth(month, by) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function _thisMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function _fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

export default function StudentAttendanceSheet({ student, onClose, onCompose }) {
  const [month, setMonth] = useState(_thisMonth);
  const [error, setError] = useState('');

  const { data, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['teacher-student-attendance', student?.id, month],
    queryFn: () => teacherPortalApi.studentAttendance(student.id, { month }),
    enabled: Boolean(student?.id),
    staleTime: 60_000,
    select: r => r?.data ?? r,
  });

  const summary = data?.summary ?? null;
  const days = data?.days ?? [];
  const guardians = data?.guardians ?? [];
  const studentName = data?.student?.name ?? student?.name ?? 'Student';
  const className = data?.student?.className ?? student?.className ?? '';

  /* The sentence the message should make: "5 absences in October". */
  const problem = useMemo(() => {
    if (!summary || summary.absent === 0) return null;
    return `${summary.absent} absence${summary.absent === 1 ? '' : 's'} in ${_monthLabel(month)}`;
  }, [summary, month]);

  function compose() {
    if (!guardians.length) {
      setError('No guardian is linked to this student yet — ask the office to link one before messaging home.');
      return;
    }
    const detailParts = [];
    if (summary) {
      detailParts.push(`${summary.absent} absent, ${summary.late} late of ${summary.total} register days`);
    }
    onCompose?.({
      student: { id: student?.id, name: studentName, className },
      month,
      kind: 'reminder',
      subject: `Attendance — ${studentName}, ${_monthLabel(month)}`,
      context: {
        type: 'attendance',
        title: `${studentName} — ${_monthLabel(month)}`,
        detail: detailParts.join(' · ').slice(0, 300),
      },
      recipients: guardians.map(g => ({
        id: g.id,
        name: g.name,
        role: g.role,
        roleLabel: String(g.role ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      })),
    });
  }

  return (
    <AnimatePresence>
      {student && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-slate-50 shadow-2xl"
          >
            {/* Header */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Attendance this month
                  </p>
                  <h2 className="truncate text-base font-bold text-slate-900">{studentName}</h2>
                  {className && <p className="truncate text-xs text-slate-400">{className}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Close attendance"
                >
                  <X size={17} />
                </button>
              </div>

              {/* Month stepper */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMonth(m => _shiftMonth(m, -1))}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="min-w-[9rem] text-center text-xs font-semibold text-slate-700">
                  {_monthLabel(month)}
                </span>
                <button
                  type="button"
                  onClick={() => setMonth(m => _shiftMonth(m, 1))}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50"
                  aria-label="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> Loading the register…
                </div>
              ) : isError ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {queryError?.message || 'That register could not be loaded.'}
                </div>
              ) : (
                <>
                  {/* Summary */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-baseline gap-2">
                      <span className={clsx(
                        'text-2xl font-extrabold',
                        summary?.pct == null ? 'text-slate-400'
                          : summary.pct >= 90 ? 'text-emerald-600'
                            : summary.pct >= 80 ? 'text-amber-600' : 'text-rose-600',
                      )}>
                        {summary?.pct == null ? '—' : `${summary.pct}%`}
                      </span>
                      <span className="text-xs text-slate-400">
                        attended{summary?.total ? ` · ${summary.attended} of ${summary.total} register ${summary.total === 1 ? 'day' : 'days'}` : ' · no register marked yet'}
                      </span>
                    </div>
                    {/* present + late + absent + authorised can be less than the
                        total: the server counts excluded/holiday rows as "other",
                        so a non-zero remainder is shown rather than left to look
                        like the figures do not add up. */}
                    <div className={clsx('mt-3 grid gap-2 text-center', (summary?.other ?? 0) > 0 ? 'grid-cols-5' : 'grid-cols-4')}>
                      {[
                        { key: 'present',    value: summary?.present ?? 0 },
                        { key: 'late',       value: summary?.late ?? 0 },
                        { key: 'absent',     value: summary?.absent ?? 0 },
                        { key: 'authorised_absence', value: summary?.authorised ?? 0 },
                        ...((summary?.other ?? 0) > 0
                          ? [{ key: 'other', value: summary.other }]
                          : []),
                      ].map(({ key, value }) => (
                        <div key={key} className={clsx('rounded-xl border px-2 py-2', STATUS[key].cls)}>
                          <p className="text-sm font-bold">{value}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{STATUS[key].label}</p>
                        </div>
                      ))}
                    </div>
                    {problem && (
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700">
                        <AlertTriangle size={11} /> {problem}
                      </p>
                    )}
                  </div>

                  {/* Day by day */}
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-2.5">
                      <p className="text-xs font-semibold text-slate-700">Day by day</p>
                    </div>
                    {days.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-slate-400">
                        No register was marked for this student in {_monthLabel(month)}.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {days.map((day, index) => {
                          const status = STATUS[day.status] ?? { label: String(day.status ?? '—'), cls: 'bg-slate-50 text-slate-600 border-slate-200' };
                          return (
                            /* A student can hold more than one row for the same date
                               (a day register plus a subject register), so the date
                               alone is not a unique key. */
                            <div key={`${day.date}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                              <span className="w-20 shrink-0 text-[11px] font-medium text-slate-600">{_fmtDay(day.date)}</span>
                              <span className={clsx('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold', status.cls)}>
                                {status.label}
                              </span>
                              {day.note && <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{day.note}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Who to tell */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold text-slate-700">Who this message goes to</p>
                    {guardians.length === 0 ? (
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        No guardian is linked to this student yet.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {guardians.map(g => (
                          <li key={g.id} className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-[10px] font-bold text-teal-700">
                              {(g.name ?? '?').charAt(0)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{g.name}</span>
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {String(g.role ?? 'parent').replace(/_/g, ' ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare size={11} /> Opens the composer with this month worked in.
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={compose}
                    disabled={isLoading || isError || guardians.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-45"
                  >
                    <Send size={13} />
                    Message {guardians.length > 1 ? 'guardians' : 'guardian'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
