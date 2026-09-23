/* ============================================================
   AbsenteesPanel — real per-student absentee list with guardian
   contact details, for one date. Distinct from SchoolReportPanel
   (aggregate counts only, no identities): this reads GET
   /api/attendance/absentees, gated by the 'attendance__absentees'
   sub-permission (hasExplicitSubGrant — no coarse-grant fallback).

   Raised directly: Admissions (and anyone else with access) could
   only ever see "N absent in this stream," never WHO — but Admissions
   is who's actually expected to call the parent to find out why.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Lock, AlertTriangle, Loader2, Phone, Mail, UserX } from 'lucide-react';
import { attendance as attendanceApi, classes as classesApi, streams as streamsApi } from '@/api/client.js';

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AbsenteesPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [classId, setClassId]   = useState('');
  const [streamId, setStreamId] = useState('');

  // Deliberately UNSCOPED (no attendanceScope param, unlike the Register
  // tab's own class picker) — this whole view is already gated to floor
  // roles / the explicit attendance__absentees grant precisely because it's
  // meant to see absences school-wide, not just the caller's own classes.
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'for-absentees-filter'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const { data: streamsData } = useQuery({
    queryKey: ['streams', 'for-absentees-filter', classId],
    queryFn:  () => streamsApi.list({ classId, status: 'active', limit: 50 }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const streamList = streamsData?.data ?? [];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['attendance', 'absentees', date, classId, streamId],
    queryFn:  () => attendanceApi.absentees({ date, classId: classId || undefined, streamId: streamId || undefined }),
  });

  const absentees = data?.data?.absentees ?? [];

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
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

        <select
          value={classId}
          onChange={e => { setClassId(e.target.value); setStreamId(''); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">All classes</option>
          {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
        </select>

        {classId && streamList.length > 0 && (
          <select
            value={streamId}
            onChange={e => setStreamId(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
          >
            <option value="">All streams</option>
            {streamList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Loader2 size={28} className="animate-spin mb-3" />
          <p className="text-sm">Loading absentees…</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
          {error?.status === 403 ? <Lock size={32} className="opacity-40" /> : <AlertTriangle size={24} className="text-red-400" />}
          <p className="text-sm font-medium text-slate-600 max-w-md text-center">
            {error?.message ?? 'Failed to load absentees.'}
          </p>
          {error?.status === 403 && (
            <p className="text-xs text-slate-400 max-w-sm text-center">
              Ask your school admin to grant "View Absent Students &amp; Contact Details" under Settings → Roles &amp; Permissions → Attendance.
            </p>
          )}
        </div>
      ) : absentees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <UserX size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No students marked absent on {fmtDate(date)}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {absentees.length} absent · {fmtDate(date)}
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {absentees.map(a => (
              <div key={`${a.studentId}-${a.classId}-${a.period ?? ''}`} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{a.studentName}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {a.className}{a.streamName ? ` · ${a.streamName}` : ''}{a.admissionNumber ? ` · #${a.admissionNumber}` : ''}
                    {a.note ? ` — ${a.note}` : ''}
                  </p>
                </div>
                {a.guardian?.parentName ? (
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    <div>
                      <p className="text-xs font-medium text-slate-700">{a.guardian.parentName}</p>
                      <p className="text-[11px] text-slate-400">{a.guardian.parentRelationship}</p>
                    </div>
                    {a.guardian.parentPhone && (
                      <a href={`tel:${a.guardian.parentPhone}`} title={a.guardian.parentPhone}
                         className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-colors text-xs font-medium">
                        <Phone size={12} /> Call
                      </a>
                    )}
                    {a.guardian.parentEmail && (
                      <a href={`mailto:${a.guardian.parentEmail}`} title={a.guardian.parentEmail}
                         className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-700 transition-colors text-xs font-medium">
                        <Mail size={12} /> Email
                      </a>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-amber-600 shrink-0">No guardian contact on file</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
