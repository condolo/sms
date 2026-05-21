/* ============================================================
   Attendance — Premium Register with Quick-Mark & Summary Strip
   /platform-audit: Replaced alert(), radio buttons → status buttons,
   added quick-mark all, attendance rate summary strip, success toast
   ============================================================ */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronDown, CheckCircle2, XCircle, Clock,
  FileText, Users, RefreshCw, Save, Loader2, AlertTriangle,
  CheckSquare, Square, BarChart3, ChevronLeft, ChevronRight, Printer, Download,
} from 'lucide-react';
import { attendance as attendanceApi, classes as classesApi } from '@/api/client.js';

/* ── Status config ───────────────────────────────────────────── */
const STATUSES = [
  { value: 'present',  label: 'Present',  short: 'P', color: 'bg-emerald-500', ring: 'ring-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
  { value: 'absent',   label: 'Absent',   short: 'A', color: 'bg-red-500',     ring: 'ring-red-400',     text: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200'     },
  { value: 'late',     label: 'Late',     short: 'L', color: 'bg-amber-500',   ring: 'ring-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200'   },
  { value: 'excused',  label: 'Excused',  short: 'E', color: 'bg-blue-500',    ring: 'ring-blue-400',    text: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200'    },
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

/* ══════════════════════════════════════════════════════════════ */
export default function AttendancePage() {
  const today   = new Date().toISOString().slice(0, 10);
  const [date, setDate]       = useState(today);
  const [classId, setClassId] = useState('');
  const [edits, setEdits]     = useState({});   // { studentId: status }
  const [toast, setToast]     = useState(null); // { type: 'success'|'error', msg: string }
  const qc = useQueryClient();

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  /* ── Classes dropdown ──────────────────────────────────────── */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  /* ── Attendance records for selected class + date ─────────── */
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['attendance', 'list', { classId, date }],
    queryFn:  () => attendanceApi.list({ classId, date, limit: 200 }),
    enabled:  !!classId,
  });
  const rows = data?.data ?? [];

  /* ── Students in class (for unrecorded rows) ─────────────── */
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId, { limit: 500, status: 'active' }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const classStudents = studentsData?.data ?? [];

  /* ── Merge: existing records + unrecorded students ─────────── */
  const recorded = new Set(rows.map(r => r.studentId));
  const merged   = [
    ...rows,
    ...classStudents.filter(s => !recorded.has(s._id ?? s.id)).map(s => ({
      studentId:   s._id ?? s.id,
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
  const counts = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
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
      return attendanceApi.bulkMark({ classId, date, records });
    },
    onSuccess: () => {
      setEdits({});
      qc.invalidateQueries({ queryKey: ['attendance'] });
      showToast('success', 'Attendance register saved successfully.');
    },
    onError: err => showToast('error', err?.message ?? 'Failed to save attendance'),
  });

  const hasEdits   = Object.keys(edits).length > 0;
  const selectedClass = classList.find(c => (c._id ?? c.id) === classId);
  const registerLoading = isLoading || studentsLoading;

  function exportRegisterCSV() {
    const cls  = selectedClass?.name ?? 'Class';
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
    const cls  = selectedClass?.name ?? 'Class';
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
<tfoot><tr><td colspan="2">Present: ${counts.present} &nbsp; Absent: ${counts.absent} &nbsp; Late: ${counts.late} &nbsp; Excused: ${counts.excused} &nbsp; Unmarked: ${counts.unmarked} &nbsp;·&nbsp; Rate: ${attendRate}%</td></tr></tfoot>
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
          </div>

          {/* Controls */}
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
                onChange={e => { setClassId(e.target.value); setEdits({}); }}
                className="text-sm text-slate-700 font-medium bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 appearance-none cursor-pointer"
              >
                <option value="">Select class…</option>
                {classList.map(c => (
                  <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

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
        </div>
      </div>

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
            <p className="text-sm font-medium text-slate-600">No students in {selectedClass?.name ?? 'this class'}</p>
            <p className="text-xs mt-1">Add students to this class first</p>
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
                <p className="text-xs text-slate-500">{total} student{total !== 1 ? 's' : ''} · {fmtDate(date)}</p>
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
    </div>
  );
}
