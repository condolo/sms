/* ============================================================
   AcademicSection — Read-only aggregation of existing academic data.
   Pulls from grades, attendance, and report_card_snapshots.
   NEVER modifies any existing academic records.
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, CalendarCheck, FileText, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { growthProfile as gpApi } from '@/api/client.js';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

function pctColor(p) {
  if (p == null) return 'text-slate-400';
  if (p >= 70)   return 'text-emerald-600';
  if (p >= 50)   return 'text-amber-600';
  return 'text-red-500';
}

function pctBar(p) {
  if (p == null) return 'bg-slate-200';
  if (p >= 70)   return 'bg-emerald-500';
  if (p >= 50)   return 'bg-amber-400';
  return 'bg-red-400';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AcademicSection({ studentId }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['growth-academic', studentId],
    queryFn:  () => gpApi.academic(studentId),
    enabled:  !!studentId,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );

  if (isError || !data?.data) return (
    <div className="py-10 text-center">
      <GraduationCap size={24} className="mx-auto text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">Academic data unavailable.</p>
    </div>
  );

  const { grades, attendance, reports } = data.data;

  return (
    <div className="space-y-5">

      {/* ── Overall grade summary ─────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <GraduationCap size={15} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700">Grade Performance</h3>
        </div>

        {grades.subjectCount === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No grade data recorded yet.</p>
        ) : (
          <>
            {/* Overall average */}
            {grades.overallAverage != null && (
              <div className="flex items-center gap-4 mb-4 p-3 bg-slate-50 rounded-xl">
                <div className={`text-3xl font-bold ${pctColor(grades.overallAverage)}`}>
                  {grades.overallAverage}%
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-600">Overall average</p>
                  <p className="text-xs text-slate-400">{grades.subjectCount} subject{grades.subjectCount !== 1 ? 's' : ''}</p>
                  <div className="mt-1.5 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${pctBar(grades.overallAverage)}`}
                      style={{ width: `${Math.min(grades.overallAverage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Subject breakdown */}
            <div className="space-y-2">
              {grades.subjects.map(s => (
                <div key={s.subjectId} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-700 truncate">{s.subjectId}</span>
                      <span className={`text-xs font-bold shrink-0 ml-2 ${pctColor(s.weightedAverage)}`}>
                        {s.weightedAverage != null ? `${s.weightedAverage}%` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pctBar(s.weightedAverage)}`}
                        style={{ width: `${Math.min(s.weightedAverage ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 w-12 text-right">{s.entries} entry{s.entries !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Attendance ────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarCheck size={15} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700">Attendance</h3>
        </div>

        {!attendance ? (
          <p className="text-sm text-slate-400 text-center py-4">No attendance records found.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500">Attendance rate</span>
              <span className={`text-xl font-bold ${pctColor(attendance.attendanceRate)}`}>
                {attendance.attendanceRate != null ? `${attendance.attendanceRate}%` : '—'}
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mb-4">
              <div
                className={`h-2.5 rounded-full ${pctBar(attendance.attendanceRate)}`}
                style={{ width: `${Math.min(attendance.attendanceRate ?? 0, 100)}%` }}
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Present',    value: attendance.present,    color: 'text-emerald-600' },
                { label: 'Absent',     value: attendance.absent,     color: 'text-red-500'     },
                { label: 'Late',       value: attendance.late,       color: 'text-amber-600'   },
                { label: 'Authorised', value: attendance.authorised, color: 'text-blue-500'    },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className={`text-lg font-bold ${color}`}>{value ?? 0}</p>
                  <p className="text-[10px] text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Recent report cards ───────────────────────────────── */}
      {reports && reports.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={15} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-700">Published Reports</h3>
            <span className="text-xs text-slate-400 ml-auto">Latest {reports.length}</span>
          </div>
          <div className="space-y-2">
            {reports.map(r => {
              const change = r.rankings?.class?.rank;
              return (
                <div key={r.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {r.termName || r.academicYear || 'Report Card'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{fmtDate(r.publishedAt)}</p>
                  </div>
                  <div className="text-right">
                    {r.averageScore != null && (
                      <p className={`text-sm font-bold ${pctColor(r.averageScore)}`}>{r.averageScore.toFixed(1)}%</p>
                    )}
                    {change != null && (
                      <p className="text-xs text-slate-400">Rank {change}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 text-center">Academic data is read-only and reflects official school records.</p>
        </div>
      )}
    </div>
  );
}
