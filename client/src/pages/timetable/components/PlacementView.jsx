/* ============================================================
   PlacementView — "Lessons to place" (v5.265.0)
   For each class (or stream) and subject: the lessons per week its
   teaching assignments ask for, how many are on the draft, and how
   many are still to place. Also per teacher, and lessons on the
   timetable that no assignment asks for.
   Data: GET /api/timetable/placement (server/utils/timetable-placement.js)
   Props:
     onOpenClass fn(classId, streamId) — jump to that class's grid
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle, HelpCircle, ArrowUpCircle, ListChecks, Loader2 } from 'lucide-react';
import { timetable as ttApi } from '@/api/client.js';

const STATUS = {
  short:     { label: 'To place',   cls: 'bg-amber-50 text-amber-700 border-amber-200',       Icon: AlertCircle },
  over:      { label: 'Too many',   cls: 'bg-sky-50 text-sky-700 border-sky-200',             Icon: ArrowUpCircle },
  no_target: { label: 'No target',  cls: 'bg-slate-100 text-slate-600 border-slate-200',      Icon: HelpCircle },
  done:      { label: 'Done',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
};

const FILTERS = [
  { id: 'open',      label: 'Needs attention' },
  { id: 'short',     label: 'To place' },
  { id: 'over',      label: 'Too many' },
  { id: 'no_target', label: 'No target' },
  { id: 'done',      label: 'Done' },
  { id: 'all',       label: 'All' },
];

function StatusChip({ status }) {
  const s = STATUS[status] ?? STATUS.done;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>
      <s.Icon size={10} /> {s.label}
    </span>
  );
}

function Stat({ label, value, tone = 'slate' }) {
  const tones = { slate: 'text-slate-900', amber: 'text-amber-700', emerald: 'text-emerald-700', sky: 'text-sky-700' };
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-w-0">
      <p className={`text-xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

const matches = (filter, r) =>
  filter === 'all' ? true
  : filter === 'open' ? r.status !== 'done'
  : filter === 'no_target' ? r.missingTarget
  : r.status === filter;

export default function PlacementView({ onOpenClass }) {
  const [mode,   setMode]   = useState('classes');   // classes | teachers
  const [filter, setFilter] = useState('open');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['timetable', 'placement'],
    queryFn:  () => ttApi.placement(),
    staleTime: 30_000,
  });
  const p = data?.data;

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 size={14} className="animate-spin" /> Working out what's left to place…
      </div>
    );
  }
  if (isError || !p) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
        <AlertCircle size={20} className="text-red-400" />
        <p className="text-sm text-slate-600">Couldn't load the lessons to place.</p>
      </div>
    );
  }

  const { summary, classes, teachers, unassigned } = p;
  const rows = (mode === 'classes' ? classes : teachers).filter(r => matches(filter, r));

  if (!summary.groups) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-14 flex flex-col items-center gap-3 text-center">
        <ListChecks size={26} className="text-indigo-300" />
        <p className="text-sm font-semibold text-slate-600">No teaching assignments yet</p>
        <p className="text-xs text-slate-400 max-w-md">
          This list is built from teaching assignments (Teachers → a teacher → Assignments): which teacher
          teaches which subject to which class, and how many lessons a week. Add those first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="lessons a week needed" value={summary.lessonsNeeded} />
        <Stat label="placed" value={summary.lessonsPlaced} tone="emerald" />
        <Stat label="still to place" value={summary.lessonsToPlace} tone={summary.lessonsToPlace ? 'amber' : 'emerald'} />
        <Stat label="subjects with no lessons-per-week set" value={summary.noTarget} tone={summary.noTarget ? 'amber' : 'slate'} />
      </div>

      {summary.noTarget > 0 && (
        <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {summary.noTarget} class subject{summary.noTarget === 1 ? ' has' : 's have'} no <b>lessons per week</b> set, so
          the list can't tell how many to place. Set it on the teacher's assignment (Teachers → a teacher → Assignments → Periods/wk).
        </p>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {[['classes', 'By class'], ['teachers', 'By teacher']].map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${mode === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${filter === f.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-600">
                {mode === 'classes' ? (
                  <>
                    <th className="text-left px-4 py-2.5">Class</th>
                    <th className="text-left px-3 py-2.5">Subject</th>
                    <th className="text-left px-3 py-2.5 hidden md:table-cell">Teacher</th>
                  </>
                ) : (
                  <th className="text-left px-4 py-2.5">Teacher</th>
                )}
                <th className="text-center px-3 py-2.5">Needed</th>
                <th className="text-center px-3 py-2.5">Placed</th>
                <th className="text-center px-3 py-2.5">To place</th>
                <th className="text-left px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-sm text-slate-400">Nothing here.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={mode === 'classes' ? `${r.classId}|${r.streamId}|${r.subjectId}` : r.teacherId ?? i}
                  className={`hover:bg-slate-50/60 transition ${mode === 'classes' && onOpenClass ? 'cursor-pointer' : ''}`}
                  onClick={() => mode === 'classes' && onOpenClass?.(r.classId, r.streamId)}
                  title={mode === 'classes' ? 'Open this class\'s timetable' : undefined}>
                  {mode === 'classes' ? (
                    <>
                      <td className="px-4 py-2.5 text-xs font-medium text-slate-800 whitespace-nowrap">
                        {r.className || r.classId}{r.streamName ? <span className="text-slate-400"> · {r.streamName}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-700">{r.subjectName}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 hidden md:table-cell">{r.teachers.join(', ') || '—'}</td>
                    </>
                  ) : (
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-800">{r.teacherName || r.teacherId}</td>
                  )}
                  <td className="px-3 py-2.5 text-center text-xs text-slate-700">{r.needed || (r.missingTarget ? '?' : 0)}{r.needed && r.missingTarget ? '+?' : ''}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-slate-700">{r.placed}</td>
                  <td className={`px-3 py-2.5 text-center text-xs font-semibold ${r.remaining ? 'text-amber-700' : 'text-slate-300'}`}>{r.remaining}</td>
                  <td className="px-3 py-2.5"><StatusChip status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lessons no assignment asks for */}
      {mode === 'classes' && unassigned.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">On the timetable, but no teaching assignment</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {summary.unassignedLessons} lesson{summary.unassignedLessons === 1 ? '' : 's'} a week. Add the assignment, or check the subject name matches.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {unassigned.map((u, i) => (
              <li key={i} className="px-4 py-2 flex items-center justify-between gap-3 text-xs cursor-pointer hover:bg-slate-50/60"
                onClick={() => onOpenClass?.(u.classId, u.streamId)}>
                <span className="text-slate-700">{u.className || u.classId} · {u.subjectName}</span>
                <span className="text-slate-500">{u.placed} a week</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
