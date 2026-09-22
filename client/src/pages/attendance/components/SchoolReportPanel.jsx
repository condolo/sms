/* ============================================================
   SchoolReportPanel — whole-school attendance, per class/stream,
   for one date. Distinct from the per-class Register: this reads
   GET /api/attendance/school-report, gated by the 'attendance__report'
   sub-permission (hasExplicitSubGrant — no coarse-grant fallback), so
   most roles that can take a register will NOT have this by default.
   That's enforced server-side; this panel just surfaces a clear
   message when the request comes back 403 rather than a blank screen.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Download, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { attendance as attendanceApi } from '@/api/client.js';

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function rateColor(rate) {
  if (rate == null) return 'text-slate-400';
  return rate >= 80 ? 'text-emerald-600' : rate >= 60 ? 'text-amber-600' : 'text-red-600';
}

export default function SchoolReportPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [expanded, setExpanded] = useState(() => new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['attendance', 'school-report', date],
    queryFn:  () => attendanceApi.schoolReport({ date }),
  });

  const report  = data?.data;
  const classes = report?.classes ?? [];

  function toggle(classId) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(classId) ? next.delete(classId) : next.add(classId);
      return next;
    });
  }

  function exportCSV() {
    const header = 'Class,Stream,Roster,Present,Absent,Late,Excused,Unmarked,Rate %';
    const lines = classes.flatMap(c =>
      c.streams.map(s => [
        c.className, s.streamName ?? '', s.roster, s.present, s.absent, s.late, s.authorisedAbsence, s.unmarked, s.rate ?? '',
      ].map(v => `"${v}"`).join(','))
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `school_attendance_report_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-5">
      {/* Date navigator + export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button onClick={() => setDate(d => shiftDate(d, -1))} className="p-1.5 rounded hover:bg-white transition text-slate-600">
            <ChevronLeft size={14} />
          </button>
          <div className="relative flex items-center gap-1.5 px-2">
            <CalendarDays size={13} className="text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={today}
              className="text-sm font-medium text-slate-700 bg-transparent focus:outline-none cursor-pointer"
            />
          </div>
          <button onClick={() => setDate(d => shiftDate(d, 1))} disabled={date >= today} className="p-1.5 rounded hover:bg-white transition text-slate-600 disabled:opacity-40">
            <ChevronRight size={14} />
          </button>
        </div>
        {!isError && classes.length > 0 && (
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800 transition-colors"
          >
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Loader2 size={28} className="animate-spin mb-3" />
          <p className="text-sm">Loading school report…</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
          {error?.status === 403 ? <Lock size={32} className="opacity-40" /> : <AlertTriangle size={24} className="text-red-400" />}
          <p className="text-sm font-medium text-slate-600 max-w-md text-center">
            {error?.message ?? 'Failed to load the school report.'}
          </p>
          {error?.status === 403 && (
            <p className="text-xs text-slate-400 max-w-sm text-center">
              Ask your school admin to grant "School-Wide Report" under Settings → Roles &amp; Permissions → Attendance.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* School-wide summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Whole-School Roster</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">{report.schoolWide.roster}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Present Today</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">{report.schoolWide.present}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Attendance Rate</p>
              <p className={`text-xl font-bold mt-0.5 ${rateColor(report.schoolWide.rate)}`}>
                {report.schoolWide.rate != null ? `${report.schoolWide.rate}%` : '—'}
              </p>
            </div>
          </div>

          {/* Per-class breakdown */}
          {classes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <CalendarDays size={36} className="mb-3 opacity-40" />
              <p className="text-sm font-medium text-slate-600">No classes with students found</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[1fr_repeat(4,72px)] items-center px-4 py-3 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Class</span>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Roster</span>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Present</span>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Unmarked</span>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Rate</span>
              </div>
              <div className="divide-y divide-slate-100">
                {classes.map(c => {
                  const isOpen = expanded.has(c.classId);
                  const unmarked = c.streams.reduce((s, r) => s + r.unmarked, 0);
                  return (
                    <div key={c.classId}>
                      <button
                        onClick={() => toggle(c.classId)}
                        className="w-full grid grid-cols-[1fr_repeat(4,72px)] items-center px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                          {c.className}
                          <span className="text-xs text-slate-400 font-normal">({c.streams.length} stream{c.streams.length !== 1 ? 's' : ''})</span>
                        </span>
                        <span className="text-sm text-slate-600 text-center">{c.roster}</span>
                        <span className="text-sm text-slate-600 text-center">{c.present}</span>
                        <span className={`text-sm text-center ${unmarked > 0 ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{unmarked}</span>
                        <span className={`text-sm font-semibold text-center ${rateColor(c.rate)}`}>{c.rate != null ? `${c.rate}%` : '—'}</span>
                      </button>
                      {isOpen && (
                        <div className="bg-slate-50/60 divide-y divide-slate-100">
                          {c.streams.map(s => (
                            <div key={s.streamId ?? 'unassigned'} className="grid grid-cols-[1fr_repeat(4,72px)] items-center pl-10 pr-4 py-2">
                              <span className="text-sm text-slate-600">{s.streamName}</span>
                              <span className="text-sm text-slate-500 text-center">{s.roster}</span>
                              <span className="text-sm text-slate-500 text-center">{s.present}</span>
                              <span className={`text-sm text-center ${s.unmarked > 0 ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{s.unmarked}</span>
                              <span className={`text-sm font-medium text-center ${rateColor(s.rate)}`}>{s.rate != null ? `${s.rate}%` : '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
                <p className="text-xs text-slate-500">{fmtDate(date)} · {classes.length} class{classes.length !== 1 ? 'es' : ''}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
