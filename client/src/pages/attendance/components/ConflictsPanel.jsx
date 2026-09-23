/* ============================================================
   ConflictsPanel — a student marked ABSENT in one class and PRESENT
   in another on the same day. Raised directly: "I need the system to
   alert them if one student has been marked absent in one class, and
   present in one class, it has to flag the admission officer who
   will resolve by giving a reason for records."

   Reads GET /api/attendance/conflicts, gated by the 'attendance__
   conflicts' sub-permission (or the configured Attendance Conflict
   Resolver — assigned under the Settings tab, not here), same
   hasExplicitSubGrant/no-coarse-fallback posture as absentees/report.

   The Resolver assignment itself used to live inline at the top of this
   view — moved to AttendanceSettingsPanel.jsx (Attendance → Settings)
   since it's a configuration action, not part of the day-to-day queue.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon, Lock, AlertTriangle, Loader2, CheckCircle2,
} from 'lucide-react';
import { attendance as attendanceApi } from '@/api/client.js';
import { useToast } from '@/hooks/useToast.jsx';

function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function ConflictRow({ conflict }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [resolving, setResolving] = useState(false);
  const [reason, setReason] = useState('');

  const { mutate: resolve, isPending: saving } = useMutation({
    mutationFn: () => attendanceApi.conflicts.resolve(conflict.id, reason.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance', 'conflicts'] });
      toast.success('Conflict resolved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to resolve.'),
  });

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {conflict.studentName}{conflict.admissionNumber ? ` (#${conflict.admissionNumber})` : ''}
          </p>
          <p className="text-xs text-slate-400">{fmtDate(conflict.date)}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {(conflict.entries ?? []).map((e, i) => (
              <span key={i} className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                e.status === 'absent' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {e.className}{e.period ? ` · P${e.period}` : ''} — {e.status}
              </span>
            ))}
          </div>
        </div>
        {!resolving && (
          <button onClick={() => setResolving(true)} className="shrink-0 text-xs font-semibold text-sky-600 hover:underline">
            Resolve
          </button>
        )}
      </div>
      {resolving && (
        <div className="flex items-center gap-2 pt-1">
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason for the record (e.g. spoke to parent — student left early, teacher marked in error)…"
            className={`${iCls()} flex-1`}
          />
          <button onClick={() => setResolving(false)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => resolve()}
            disabled={saving || !reason.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ConflictsPanel() {
  const [status, setStatus] = useState('open');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['attendance', 'conflicts', status],
    queryFn:  () => attendanceApi.conflicts.list({ status }),
  });

  const conflicts = data?.data ?? [];

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-5">
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setStatus('open')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${status === 'open' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Open
        </button>
        <button
          onClick={() => setStatus('resolved')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${status === 'resolved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Resolved
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Loader2 size={28} className="animate-spin mb-3" />
          <p className="text-sm">Loading conflicts…</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
          {error?.status === 403 ? <Lock size={32} className="opacity-40" /> : <AlertTriangle size={24} className="text-red-400" />}
          <p className="text-sm font-medium text-slate-600 max-w-md text-center">
            {error?.message ?? 'Failed to load attendance conflicts.'}
          </p>
          {error?.status === 403 && (
            <p className="text-xs text-slate-400 max-w-sm text-center">
              Ask your school admin to grant "Attendance Conflicts" under Settings → Roles &amp; Permissions → Attendance,
              or assign you as the Attendance Conflict Resolver under Attendance → Settings.
            </p>
          )}
        </div>
      ) : conflicts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <AlertOctagon size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">
            {status === 'open' ? 'No open attendance conflicts' : 'No resolved conflicts yet'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {conflicts.map(c => <ConflictRow key={c.id} conflict={c} />)}
        </div>
      )}
    </div>
  );
}
