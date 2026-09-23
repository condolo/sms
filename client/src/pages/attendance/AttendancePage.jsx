/* ============================================================
   Attendance — Premium Register with Quick-Mark & Summary Strip
   /platform-audit: Replaced alert(), radio buttons → status buttons,
   added quick-mark all, attendance rate summary strip, success toast
   ============================================================ */
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronDown, CheckCircle2, Clock,
  Users, Save, Loader2, AlertTriangle,
  CheckSquare, Square, BarChart3, ChevronLeft, ChevronRight, Printer, Download,
  Layers,
} from 'lucide-react';
import { attendance as attendanceApi, classes as classesApi, streams as streamsApi, timetable as timetableApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import SchoolReportPanel from './components/SchoolReportPanel.jsx';
import AbsenteesPanel from './components/AbsenteesPanel.jsx';
import ConflictsPanel from './components/ConflictsPanel.jsx';

/* ── Status config ───────────────────────────────────────────── */
const STATUSES = [
  { value: 'present',  label: 'Present',  short: 'P', color: 'bg-emerald-500', ring: 'ring-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
  { value: 'absent',   label: 'Absent',   short: 'A', color: 'bg-red-500',     ring: 'ring-red-400',     text: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200'     },
  { value: 'late',     label: 'Late',     short: 'L', color: 'bg-amber-500',   ring: 'ring-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200'   },
  { value: 'authorised_absence', label: 'Excused',  short: 'E', color: 'bg-blue-500',    ring: 'ring-blue-400',    text: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200'    },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.value, s]));

function statusCfg(val) { return STATUS_MAP[val] ?? STATUS_MAP.absent; }

/* ── Date helpers ────────────────────────────────────────────── */
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dayOfWeekFor(dateStr) {
  return DAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()];
}

/* ══════════════════════════════════════════════════════════════ */
export default function AttendancePage() {
  const today   = new Date().toISOString().slice(0, 10);
  /* Read ?classId=&streamId= from the URL so the Dashboard's "Take Att."
     link on today's timetable can jump straight into the right register
     instead of dropping the teacher on an empty "Select a class…" state
     they'd have to fill in by hand. */
  const [searchParams] = useSearchParams();
  const [date, setDate]       = useState(today);
  // 'register': today's existing per-class/stream take/view flow.
  // 'report': the School-Wide Report — a distinct, more-restrictive view
  // (see attendance.js's GET /school-report) most roles won't have; the
  // tab itself is always shown (this app never pre-filters UI by
  // permission — see AttendancePage.jsx's own name-backfill comment
  // history for the established convention) and the server's 403 message
  // surfaces plainly inside the panel for anyone without the grant.
  const [viewMode, setViewMode] = useState('register');
  const [classId, setClassId] = useState(() => searchParams.get('classId') ?? '');
  const [streamId, setStreamId] = useState(() => searchParams.get('streamId') ?? '');
  const [edits, setEdits]     = useState({});   // { studentId: status }
  const [toast, setToast]     = useState(null); // { type: 'success'|'error', msg: string }
  const qc = useQueryClient();

  /* React to a later navigation to this same page with different params
     (e.g. clicking a different lesson's "Take Att." link while already
     on Attendance) — same pattern as StudentList.jsx's own classId/
     streamId deep-link support. */
  useEffect(() => {
    const cid = searchParams.get('classId') ?? '';
    const sid = searchParams.get('streamId') ?? '';
    if (cid) {
      setClassId(cid);
      setStreamId(sid);
      setEdits({});
    }
  }, [searchParams.get('classId'), searchParams.get('streamId')]); // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  /* ── Classes dropdown ──────────────────────────────────────────
     attendanceScope narrows this to the caller's own real teaching/
     homeroom assignments — a DIFFERENT, narrower flag than classes.js's
     own `assignedOnly` (used by Exams/Growth Profile), and deliberately
     so: several roles (exams_officer, admissions_officer, finance, hr,
     timetabler, discipline_committee) are legitimately unrestricted for
     their OWN module but have no business seeing every class's daily
     register just because of that (see scopeEngine.js's
     resolveAttendanceScope). Only admin/superadmin/principal/
     deputy_principal/deputy stay unrestricted here. This is a DIFFERENT
     query key from the plain '['classes','all']' used elsewhere in the
     app (Students, Admissions, Teachers) deliberately: those pages need
     the full unrestricted list and must never share a cache entry with
     this narrowed one. The write routes this feeds (POST /attendance,
     POST /attendance/bulk) already enforce the same scope authoritatively
     server-side regardless of what this dropdown shows — this just keeps
     the picker from offering a class the write would reject anyway. */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'attendanceScope'],
    queryFn:  () => classesApi.list({ limit: 200, attendanceScope: true }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];
  const noClassesAssigned = classesData?.pagination?.noAssignments === true;

  /* ── Streams within the selected class ───────────────────────
     Classes are subdivided into streams (e.g. "Year 3A", "Year 3B") that
     each run their own timetable — a teacher covering both has two
     separate lessons at two separate times, not one merged group. A class
     with more than one stream therefore needs a register PER STREAM, not
     one combined list spanning every stream the caller can see. Same
     attendanceScope convention as the class picker above: narrows to the
     caller's own real assigned streams within this class; unlike
     classes.js's `assignedOnly`, NOT a no-op for exams_officer/
     admissions_officer/finance/hr/timetabler/discipline_committee. */
  const { data: streamsData } = useQuery({
    queryKey: ['streams', 'attendanceScope', classId],
    queryFn:  () => streamsApi.list({ classId, status: 'active', limit: 50, attendanceScope: true }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const streamList = streamsData?.data ?? [];
  const needsStreamSelection = streamList.length > 1;
  // The identifier actually used to fetch/save the register: once a class
  // has more than one stream, nothing is fetched until a specific stream
  // is chosen — there is no meaningful "whole class" register anymore.
  const effectiveStreamId = needsStreamSelection ? streamId : (streamList[0]?.id ?? '');
  const canLoadRegister = !!classId && (!needsStreamSelection || !!streamId);

  /* ── Attendance records for selected class/stream + date ───── */
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['attendance', 'list', { classId, streamId: effectiveStreamId, date }],
    queryFn:  () => attendanceApi.list({ classId, ...(effectiveStreamId ? { streamId: effectiveStreamId } : {}), date, limit: 200 }),
    enabled:  canLoadRegister,
  });
  const rows = data?.data ?? [];

  /* ── Students in class/stream (for unrecorded rows) ─────────
     Once the class is subdivided, fetch the ONE selected stream's own
     roster (already correctly scoped server-side — see
     streams.js's GET /:id/students) instead of the whole class's. */
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: needsStreamSelection
      ? ['streams', streamId, 'students']
      : ['classes', classId, 'students'],
    queryFn: () => needsStreamSelection
      ? streamsApi.students(streamId, { limit: 500, status: 'active' })
      : classesApi.students(classId, { limit: 500, status: 'active' }),
    enabled: canLoadRegister,
    staleTime: 5 * 60_000,
  });
  const classStudents = studentsData?.data ?? [];

  /* ── Timetable alignment ──────────────────────────────────────
     Purely informational — confirms what the register being taken
     actually corresponds to on the timetable (period + time), it never
     gates or changes what can be saved. Reuses the same "my weekly
     schedule" data TimetablePortal.jsx already fetches for the teacher's
     own timetable view. Only meaningful (and only RBAC-granted) for the
     'teacher' role itself — an admin/deputy marking a register on someone
     else's behalf has no personal "my schedule" to align against, and
     unconditionally calling this for every role would 403 for anyone
     without Timetable module access. */
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const { data: myTimetableData } = useQuery({
    queryKey: ['timetable', 'my'],
    queryFn:  () => timetableApi.my(),
    enabled:  role === 'teacher',
    staleTime: 5 * 60_000,
  });
  const todaysSlots = (myTimetableData?.data?.slots ?? [])
    .filter(s => (s.day ?? '').toLowerCase() === dayOfWeekFor(date))
    .filter(s => s.classId === classId)
    .filter(s => !effectiveStreamId || !s.streamId || s.streamId === effectiveStreamId)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  /* ── Merge: existing records + unrecorded students ───────────
     An attendance document only ever stores studentId/status/date — it
     never carries a studentName (that field is built server-side only
     for notification text, never persisted onto the record itself —
     see attendance.js's absence-alert code). Every row sourced from
     `rows` (i.e. every ALREADY-recorded student) therefore had no name
     to render at all — blank text plus the "?" avatar fallback — the
     instant a register was reopened after being saved once, since only
     the *unrecorded* students below ever got a real studentName
     attached. Backfilled here from the roster (classStudents), which
     does carry real names; a student who has since left the roster
     (e.g. transferred out) but still has a historical record here
     keeps the same "?" fallback as before — not a regression, just an
     edge case this fix doesn't need to solve. */
  const nameById = Object.fromEntries(classStudents.map(s => [s.id ?? s._id, `${s.firstName} ${s.lastName}`]));
  const recorded = new Set(rows.map(r => r.studentId));
  const merged   = [
    ...rows.map(r => ({ ...r, studentName: nameById[r.studentId] ?? r.studentName })),
    ...classStudents.filter(s => !recorded.has(s.id ?? s._id)).map(s => ({
      studentId:   s.id ?? s._id,
      studentName: `${s.firstName} ${s.lastName}`,
      status:      null,
    })),
  ];

  const setStatus = useCallback((studentId, status) => {
    setEdits(e => ({ ...e, [studentId]: status }));
  }, []);

  function markAll(status) {
    const all = {};
    merged.forEach(r => { all[r.studentId] = status; });
    setEdits(all);
  }

  function clearEdits() { setEdits({}); }

  /* ── Summary counts ────────────────────────────────────────── */
  const counts = { present: 0, absent: 0, late: 0, authorised_absence: 0, unmarked: 0 };
  merged.forEach(r => {
    const s = edits[r.studentId] ?? r.status;
    if (s && counts[s] !== undefined) counts[s]++;
    else if (!s) counts.unmarked++;
  });
  const total      = merged.length;
  const attendRate = total > 0 ? Math.round(((counts.present + counts.late) / total) * 100) : 0;

  /* ── Bulk save ─────────────────────────────────────────────── */
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => {
      const records = merged.map(r => ({
        studentId: r.studentId,
        classId,
        date,
        status: edits[r.studentId] ?? r.status ?? 'absent',
      }));
      return attendanceApi.bulkMark({ classId, ...(effectiveStreamId ? { streamId: effectiveStreamId } : {}), date, records });
    },
    onSuccess: () => {
      setEdits({});
      qc.invalidateQueries({ queryKey: ['attendance'] });
      showToast('success', 'Attendance register saved successfully.');
    },
    onError: err => showToast('error', err?.message ?? 'Failed to save attendance'),
  });

  const hasEdits   = Object.keys(edits).length > 0;
  const selectedClass  = classList.find(c => (c.id ?? c._id) === classId);
  const selectedStream = streamList.find(s => (s.id ?? s._id) === effectiveStreamId);
  const registerLoading = isLoading || studentsLoading;

  function exportRegisterCSV() {
    const cls  = selectedClass?.name ? `${selectedClass.name}${selectedStream?.name ? ` ${selectedStream.name}` : ''}` : 'Class';
    const header = 'Student,Status';
    const lines  = merged.map(r => {
      const status = edits[r.studentId] ?? r.status ?? 'unmarked';
      return `"${r.studentName}","${status}"`;
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `attendance_${cls.replace(/\s+/g,'_')}_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printRegister() {
    const cls  = selectedClass?.name ? `${selectedClass.name}${selectedStream?.name ? ` ${selectedStream.name}` : ''}` : 'Class';
    const rows$ = merged.map(r => {
      const status = edits[r.studentId] ?? r.status ?? '—';
      const cfg    = STATUS_MAP[status];
      const badge  = cfg
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${
            status==='present'?'#d1fae5':status==='absent'?'#fee2e2':status==='late'?'#fef3c7':'#dbeafe'};color:${
            status==='present'?'#065f46':status==='absent'?'#991b1b':status==='late'?'#92400e':'#1e40af'}">${cfg.label}</span>`
        : '<span style="color:#94a3b8">—</span>';
      return `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9">${r.studentName}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:center">${badge}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>Attendance Register — ${cls} — ${fmtDate(date)}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;margin:32px;color:#1e293b}h2{margin:0 0 4px}p{margin:0 0 20px;color:#64748b;font-size:13px}table{width:100%;border-collapse:collapse;font-size:13px}thead th{background:#f8fafc;padding:9px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0}tfoot td{padding:9px 12px;font-size:12px;color:#64748b;border-top:2px solid #e2e8f0}@media print{body{margin:16px}}</style>
</head><body>
<h2>Attendance Register</h2>
<p>${cls} &nbsp;·&nbsp; ${fmtDate(date)}</p>
<table>
<thead><tr><th style="width:70%">Student</th><th style="text-align:center">Status</th></tr></thead>
<tbody>${rows$}</tbody>
<tfoot><tr><td colspan="2">Present: ${counts.present} &nbsp; Absent: ${counts.absent} &nbsp; Late: ${counts.late} &nbsp; Excused: ${counts.authorised_absence} &nbsp; Unmarked: ${counts.unmarked} &nbsp;·&nbsp; Rate: ${attendRate}%</td></tr></tfoot>
</table></body></html>`;

    const win = window.open('', '_blank', 'width=680,height=900');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium border ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-800 border-red-200'
            }`}
          >
            {toast.type === 'success'
              ? <CheckCircle2 size={15} className="shrink-0" />
              : <AlertTriangle size={15} className="shrink-0" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Attendance</h1>
            <p className="text-sm text-slate-500 mt-0.5">Mark and review daily registers</p>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 mt-3 w-fit">
              <button
                onClick={() => setViewMode('register')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Register
              </button>
              <button
                onClick={() => setViewMode('report')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                School Report
              </button>
              <button
                onClick={() => setViewMode('absentees')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'absentees' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Absentees
              </button>
              <button
                onClick={() => setViewMode('conflicts')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'conflicts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Conflicts
              </button>
            </div>
            {noClassesAssigned && viewMode === 'register' && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} />
                No classes are assigned to your account yet — ask your school admin to assign classes.
              </p>
            )}
            {/* Timetable alignment — informational only, never gates saving.
               Confirms this register matches what's actually on the
               timetable for this class/stream on the selected date. */}
            {viewMode === 'register' && classId && (!needsStreamSelection || streamId) && todaysSlots.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                <Clock size={12} className="text-indigo-400 shrink-0" />
                {todaysSlots.map(s => (
                  <span key={s.id ?? `${s.day}-${s.period}`} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {s.subject ? `${s.subject} · ` : ''}Period {s.period}
                    {s.startTime && s.endTime ? ` · ${s.startTime}–${s.endTime}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Controls */}
          {viewMode === 'register' && (
          <div className="flex items-center gap-3 flex-wrap">
            {/* Date navigator */}
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

            {/* Class selector */}
            <div className="relative">
              <select
                value={classId}
                onChange={e => { setClassId(e.target.value); setStreamId(''); setEdits({}); }}
                className="text-sm text-slate-700 font-medium bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 appearance-none cursor-pointer"
              >
                <option value="">Select class…</option>
                {classList.map(c => (
                  <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

            {/* Stream selector — only when this class actually has more than
               one stream. Each stream runs its own timetable (different
               time, sometimes a different room), so a class with multiple
               streams needs a register PER STREAM, never one list merging
               every stream a teacher can see. */}
            {classId && needsStreamSelection && (
              <div className="relative">
                <select
                  value={streamId}
                  onChange={e => { setStreamId(e.target.value); setEdits({}); }}
                  className="text-sm text-slate-700 font-medium bg-white border border-slate-200 rounded-lg pl-8 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 appearance-none cursor-pointer"
                >
                  <option value="">Select stream…</option>
                  {streamList.map(s => (
                    <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.name}</option>
                  ))}
                </select>
                <Layers size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            )}

            {/* Export / Print register */}
            {classId && !registerLoading && merged.length > 0 && (
              <>
                <button
                  onClick={exportRegisterCSV}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800 transition-colors"
                  title="Export register as CSV"
                >
                  <Download size={14} />
                  CSV
                </button>
                <button
                  onClick={printRegister}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800 transition-colors"
                  title="Print attendance register"
                >
                  <Printer size={14} />
                  Print
                </button>
              </>
            )}

            {/* Save button */}
            {hasEdits && classId && (
              <button
                onClick={() => save()}
                disabled={saving}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : `Save (${Object.keys(edits).length})`}
              </button>
            )}
          </div>
          )}
        </div>
      </div>

      {viewMode === 'report' ? (
        <SchoolReportPanel />
      ) : viewMode === 'absentees' ? (
        <AbsenteesPanel />
      ) : viewMode === 'conflicts' ? (
        <ConflictsPanel />
      ) : (
      <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-5">

        {/* Summary strip — only shown when class + data loaded */}
        {classId && !registerLoading && merged.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Attendance rate */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-2 bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <BarChart3 size={16} className="text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Attendance Rate</p>
                <p className={`text-xl font-bold ${attendRate >= 80 ? 'text-emerald-600' : attendRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{attendRate}%</p>
              </div>
            </div>
            {/* Status counts */}
            {STATUSES.map(s => (
              <div key={s.value} className={`bg-white rounded-xl border ${s.border} px-4 py-3`}>
                <p className={`text-xs font-medium ${s.text}`}>{s.label}</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">{counts[s.value]}</p>
              </div>
            ))}
            {/* Unmarked */}
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs font-medium text-slate-500">Unmarked</p>
              <p className={`text-xl font-bold mt-0.5 ${counts.unmarked > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{counts.unmarked}</p>
            </div>
          </div>
        )}

        {/* Register */}
        {!classId ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <CalendarDays size={36} className="mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">Select a class to view the register</p>
            <p className="text-xs mt-1">Choose a class from the dropdown above</p>
          </div>
        ) : needsStreamSelection && !streamId ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Layers size={36} className="mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">Select a stream to view the register</p>
            <p className="text-xs mt-1">
              {selectedClass?.name ?? 'This class'} has {streamList.length} streams — each runs its own timetable, so attendance is taken per stream
            </p>
          </div>
        ) : registerLoading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <AlertTriangle size={24} className="text-red-400" />
            <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load register'}</p>
            <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
          </div>
        ) : merged.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Users size={36} className="mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">
              No students in {selectedClass?.name ?? 'this class'}{selectedStream?.name ? ` ${selectedStream.name}` : ''}
            </p>
            <p className="text-xs mt-1">Add students to this {selectedStream ? 'stream' : 'class'} first</p>
          </div>
        ) : (
          <>
            {/* Quick-action toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-500 mr-1">Quick mark:</span>
              {STATUSES.map(s => (
                <button
                  key={s.value}
                  onClick={() => markAll(s.value)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${s.bg} ${s.border} ${s.text} hover:opacity-80`}
                >
                  <CheckSquare size={12} />
                  All {s.label}
                </button>
              ))}
              {hasEdits && (
                <button
                  onClick={clearEdits}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors ml-auto"
                >
                  <Square size={12} />
                  Clear edits
                </button>
              )}
            </div>

            {/* Register table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</span>
                <div className="flex items-center gap-2">
                  {STATUSES.map(s => (
                    <span key={s.value} className="w-[74px] text-center text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:block">
                      {s.label}
                    </span>
                  ))}
                  <span className="w-[74px] text-center text-xs font-semibold text-slate-500 uppercase tracking-wide sm:hidden">Status</span>
                </div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-100">
                {merged.map((r, idx) => {
                  const current = edits[r.studentId] ?? r.status;
                  const cfg     = current ? statusCfg(current) : null;
                  const initials = (r.studentName ?? '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
                  const gradients = ['from-violet-500 to-purple-600','from-blue-500 to-cyan-500','from-emerald-500 to-teal-500','from-amber-500 to-orange-500','from-pink-500 to-rose-500'];
                  const grad = gradients[idx % gradients.length];

                  return (
                    <motion.div
                      key={r.studentId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="grid grid-cols-[1fr_auto] items-center px-4 py-3 hover:bg-slate-50 transition-colors"
                    >
                      {/* Student name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                          <span className="text-[10px] font-bold text-white">{initials}</span>
                        </div>
                        <span className="text-sm font-medium text-slate-800 truncate">{r.studentName}</span>
                        {/* Mobile: current status pill */}
                        {cfg && (
                          <span className={`sm:hidden text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                            {cfg.short}
                          </span>
                        )}
                        {!cfg && (
                          <span className="sm:hidden text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">—</span>
                        )}
                      </div>

                      {/* Status buttons */}
                      <div className="flex items-center gap-2">
                        {STATUSES.map(s => {
                          const active = current === s.value;
                          return (
                            <button
                              key={s.value}
                              onClick={() => setStatus(r.studentId, s.value)}
                              title={s.label}
                              className={`w-[74px] py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                                active
                                  ? `${s.bg} ${s.text} ${s.border} ring-2 ${s.ring} ring-offset-1`
                                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600'
                              }`}
                            >
                              {s.short}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  {total} student{total !== 1 ? 's' : ''}
                  {selectedStream?.name ? ` · ${selectedClass?.name ?? ''} ${selectedStream.name}` : ''} · {fmtDate(date)}
                </p>
                {hasEdits ? (
                  <button
                    onClick={() => save()}
                    disabled={saving}
                    className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? 'Saving…' : `Save register (${Object.keys(edits).length} changed)`}
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 size={13} />
                    {rows.length > 0 ? 'Register saved' : 'No changes'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
