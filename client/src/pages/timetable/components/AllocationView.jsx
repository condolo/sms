/* ============================================================
   AllocationView — Subject allocation (v5.273.0)
   One place to see and enter who teaches what: every class × subject in
   the curriculum (one row per stream where the subject is compulsory and
   the class has streams), its teachers, lessons per week, double lessons
   and how many lessons the draft timetable has — plus every active
   teacher, including those with no classes.
   Data:   GET /api/timetable/allocation (server/utils/allocation.js)
   Writes: /api/teaching-assignments (the same routes and rules as the
           Teachers page). Changing a teacher updates the row in place.
   Props:
     canEdit      bool — show editing controls (the server checks too)
     onOpenClass  fn(classId, streamId) — jump to that class's grid
   ============================================================ */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, HelpCircle, ArrowUpCircle, UserX, Loader2, Users, Plus, X, Repeat } from 'lucide-react';
import { timetable as ttApi, teachingAssignments as taApi } from '@/api/client.js';

const STATUS = {
  no_teacher: { label: 'No teacher',   cls: 'bg-red-50 text-red-700 border-red-200',             Icon: UserX },
  no_target:  { label: 'No lessons/wk', cls: 'bg-slate-100 text-slate-600 border-slate-200',      Icon: HelpCircle },
  short:      { label: 'To place',     cls: 'bg-amber-50 text-amber-700 border-amber-200',       Icon: AlertCircle },
  over:       { label: 'Too many',     cls: 'bg-sky-50 text-sky-700 border-sky-200',             Icon: ArrowUpCircle },
  done:       { label: 'Done',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
};
const FILTERS = [
  { id: 'open',       label: 'Needs attention', test: r => r.status !== 'done' },
  { id: 'no_teacher', label: 'No teacher',      test: r => r.status === 'no_teacher' },
  { id: 'no_target',  label: 'No lessons/wk',   test: r => r.status === 'no_target' },
  { id: 'all',        label: 'All',             test: () => true },
];

function Chip({ status }) {
  const s = STATUS[status] ?? STATUS.done;
  return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}><s.Icon size={10} /> {s.label}</span>;
}

/* Teacher picker: teachers who teach this subject first, then everyone else. */
function TeacherSelect({ teachers, subjectId, exclude = [], value, onChange, autoFocus }) {
  const ex = new Set(exclude.map(String));
  const list = teachers.filter(t => !ex.has(String(t.teacherId)) && !ex.has(String(t.userId)));
  const fits = list.filter(t => t.canTeach?.includes(subjectId));
  const rest = list.filter(t => !t.canTeach?.includes(subjectId));
  const opt = t => <option key={t.teacherId} value={t.userId || t.teacherId}>{t.name} — {t.needed || 0} lessons/wk{t.assignments === 0 ? ' (no classes)' : ''}</option>;
  return (
    <select autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white max-w-[15rem]">
      <option value="">Choose a teacher…</option>
      {fits.length > 0 && <optgroup label="Teaches this subject">{fits.map(opt)}</optgroup>}
      {rest.length > 0 && <optgroup label="Other teachers">{rest.map(opt)}</optgroup>}
    </select>
  );
}

function NumberCell({ value, onSave, disabled, max = 40 }) {
  const [v, setV] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value ?? ''); }
  return (
    <input
      type="number" min={0} max={max} value={v} disabled={disabled}
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = v === '' ? null : Number(v); if (n !== (value ?? null)) onSave(n); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-14 text-xs text-center border border-slate-200 rounded-md px-1 py-1 disabled:bg-transparent disabled:border-transparent"
    />
  );
}

export default function AllocationView({ canEdit, onOpenClass }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['timetable', 'allocation'], queryFn: ttApi.allocation, staleTime: 15_000 });
  const res = data?.data ?? { rows: [], teachers: [], summary: {}, departments: [] };

  const [filter, setFilter] = useState('open');
  const [section, setSection] = useState('');
  const [dept, setDept] = useState('');
  const [search, setSearch] = useState('');
  const [teacherFilter, setTeacherFilter] = useState(null);
  const [onlyNoClasses, setOnlyNoClasses] = useState(false);
  const [adding, setAdding] = useState(null);       // row key
  const [addPick, setAddPick] = useState('');
  const [change, setChange] = useState(null);       // { row, assignment, to, move, clashes }
  const [changing, setChanging] = useState(null);   // assignment id whose picker is open
  const [changePick, setChangePick] = useState('');
  const [toast, setToast] = useState(null);
  const say = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 5000); };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['timetable', 'allocation'] });
    qc.invalidateQueries({ queryKey: ['timetable', 'placement'] });
    qc.invalidateQueries({ queryKey: ['teaching-assignments'] });
  };
  const onErr = err => say(err?.message ?? 'Could not save.', 'error');

  const create = useMutation({
    mutationFn: ({ row, teacherId }) => taApi.create({ teacherId, subjectId: row.subjectId, classId: row.classId, ...(row.streamId ? { streamId: row.streamId } : {}) }),
    onSuccess: () => { setAdding(null); setAddPick(''); refresh(); say('Teacher assigned. They can now see this class for this subject.'); },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }) => taApi.update(id, patch),
    onSuccess: () => refresh(),
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id) => taApi.remove(id),
    onSuccess: () => { refresh(); say('Removed. Records already taken stay.'); },
    onError: onErr,
  });
  const reassign = useMutation({
    mutationFn: ({ id, to, move }) => taApi.changeTeacher(id, to, move),
    onSuccess: (r) => {
      setChange(null); refresh(); qc.invalidateQueries({ queryKey: ['timetable'] });
      const moved = r?.data?.movedLessons ?? 0;
      say(`Teacher changed.${moved ? ` ${moved} draft lesson${moved === 1 ? '' : 's'} moved — publish to show them.` : ''}`);
    },
    onError: (err) => {
      if (err?.code === 'LESSON_CLASH') setChange(c => ({ ...c, clashes: err.extra?.error?.clashes ?? [], clashMsg: err.message }));
      else onErr(err);
    },
  });

  const sections = useMemo(() => [...new Set(res.rows.map(r => r.sectionKey).filter(Boolean))].sort(), [res.rows]);
  const teacherById = useMemo(() => new Map(res.teachers.map(t => [String(t.teacherId), t])), [res.teachers]);

  const rows = useMemo(() => {
    const f = FILTERS.find(x => x.id === filter) ?? FILTERS[0];
    const q = search.trim().toLowerCase();
    return res.rows.filter(r =>
      f.test(r)
      && (!section || r.sectionKey === section)
      && (!dept || r.departmentId === dept)
      && (!teacherFilter || r.assignments.some(a => String(a.teacherKey) === String(teacherFilter)))
      && (!q || `${r.className} ${r.streamName || ''} ${r.subjectName} ${r.assignments.map(a => a.teacherName).join(' ')}`.toLowerCase().includes(q)));
  }, [res.rows, filter, section, dept, search, teacherFilter]);

  const byClass = useMemo(() => {
    const m = new Map();
    for (const r of rows) { const k = r.classId; if (!m.has(k)) m.set(k, { className: r.className, rows: [] }); m.get(k).rows.push(r); }
    return [...m.entries()];
  }, [rows]);

  const teachers = useMemo(() => res.teachers.filter(t => (!onlyNoClasses || t.status === 'no_classes') && (!dept || t.departmentId === dept)), [res.teachers, onlyNoClasses, dept]);
  const s = res.summary || {};

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500 p-6"><Loader2 size={14} className="animate-spin" /> Loading subject allocation…</div>;
  if (isError) return <div className="text-sm text-red-600 p-6">{error?.message ?? 'Could not load the subject allocation.'}</div>;

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 text-sm px-4 py-2.5 rounded-lg shadow-lg ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>{toast.msg}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Subject allocation</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Every subject in each class&apos;s curriculum, who teaches it and how many lessons a week it needs. The allocation (and the lessons on the timetable) decide who can
            take a class&apos;s register, enter its marks and see its lesson plans from then on; records already taken never change.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">{s.rows ?? 0} class subjects</span>
          <span className={`px-2 py-1 rounded-md ${s.noTeacher ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{s.noTeacher ?? 0} with no teacher</span>
          <span className={`px-2 py-1 rounded-md ${s.noTarget ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{s.noTarget ?? 0} with no lessons/week</span>
          <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">{s.short ?? 0} still to place</span>
          <span className={`px-2 py-1 rounded-md ${s.teachersWithNoClasses ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{s.teachersWithNoClasses ?? 0} of {s.teachers ?? 0} teachers with no classes</span>
          {s.outsideCurriculum > 0 && <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700">{s.outsideCurriculum} outside the curriculum</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`text-xs px-2.5 py-1 rounded-full border ${filter === f.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{f.label}</button>
          ))}
          {sections.length > 1 && (
            <select value={section} onChange={e => setSection(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white">
              <option value="">All sections</option>
              {sections.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          {res.departments?.length > 0 && (
            <select value={dept} onChange={e => setDept(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white">
              <option value="">All departments</option>
              {res.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search class, subject or teacher" className="text-xs border border-slate-200 rounded-md px-2 py-1 w-56" />
          {teacherFilter && (
            <button onClick={() => setTeacherFilter(null)} className="text-xs px-2 py-1 rounded-md bg-sky-50 text-sky-700 border border-sky-200 inline-flex items-center gap-1">
              {teacherById.get(String(teacherFilter))?.name} <X size={11} />
            </button>
          )}
        </div>
      </div>

      {change && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">
            Change {change.row.subjectName}, {change.row.className}{change.row.streamName ? ` ${change.row.streamName}` : ''}: {change.assignment.teacherName} → {res.teachers.find(t => (t.userId || t.teacherId) === change.to)?.name || 'new teacher'}?
          </p>
          <p className="text-xs text-amber-800">
            The new teacher gets this class&apos;s register, marks and lesson plans for this subject straight away. {change.assignment.teacherName} loses them once
            their lessons for it are moved too (tick below); while those lessons stay on the timetable under their name, they keep access through them.
            Registers, marks and plans already recorded stay exactly as they are. Lessons per week, doubles and &quot;taught together&quot; stay on the allocation.
          </p>
          <label className="flex items-center gap-2 text-xs text-amber-900">
            <input type="checkbox" checked={change.move} onChange={e => setChange(c => ({ ...c, move: e.target.checked, clashes: null }))} />
            Also move {change.assignment.teacherName}&apos;s draft lessons for this subject to the new teacher (checked for clashes first; nothing goes live until you publish)
          </label>
          {change.clashes && (
            <div className="text-xs text-red-700 space-y-1">
              <p className="font-semibold">{change.clashMsg}</p>
              <ul className="list-disc pl-4">{change.clashes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => reassign.mutate({ id: change.assignment.id, to: change.to, move: change.move })}
              disabled={reassign.isPending}
              className="text-xs font-medium bg-slate-900 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
            >{reassign.isPending ? 'Saving…' : 'Change teacher'}</button>
            <button onClick={() => setChange(null)} className="text-xs text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {byClass.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              {res.rows.length === 0 ? 'No subjects in any class curriculum yet. Add subjects to classes under Classes → Curriculum.' : 'Nothing matches this filter.'}
            </p>
          ) : byClass.map(([cid, g]) => (
            <div key={cid} className="border-b border-slate-100 last:border-b-0">
              <button onClick={() => onOpenClass?.(cid, '')} className="w-full text-left px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100">{g.className}</button>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                  <tr><th className="text-left font-semibold px-4 py-1.5">Subject</th><th className="text-left font-semibold px-2">Teacher</th><th className="font-semibold px-2">Lessons/wk</th><th className="font-semibold px-2">Doubles</th><th className="font-semibold px-2">Placed</th><th className="text-left font-semibold px-2">Status</th></tr>
                </thead>
                <tbody>
                  {g.rows.map(r => (
                    <tr key={r.key} className="border-t border-slate-50 align-top">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-800">{r.subjectName}{r.streamName && <span className="text-slate-500"> · {r.streamName}</span>}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.compulsory ? 'Compulsory' : 'Optional'}
                          {r.taughtTogether && ' · taught together'}
                          {!r.inCurriculum && <span className="text-amber-600"> · not in this class&apos;s curriculum</span>}
                          {r.note === 'whole_class_row_for_streamed_subject' && <span className="text-amber-600"> · whole-class row for a streamed subject</span>}
                        </div>
                      </td>
                      <td className="px-2 py-2 space-y-1">
                        {r.assignments.map(a => (
                          <div key={a.id} className="flex items-center gap-1.5">
                            <button onClick={() => setTeacherFilter(a.teacherKey)} className="text-slate-800 hover:underline">{a.teacherName}</button>
                            {canEdit && (changing === a.id ? (
                              <>
                                <TeacherSelect autoFocus teachers={res.teachers} subjectId={r.subjectId} exclude={r.assignments.map(x => x.teacherKey)} value={changePick} onChange={setChangePick} />
                                <button
                                  disabled={!changePick}
                                  onClick={() => { setChange({ row: r, assignment: a, to: changePick, move: true, clashes: null }); setChanging(null); setChangePick(''); }}
                                  className="text-[11px] font-medium bg-slate-900 text-white rounded px-2 py-1 disabled:opacity-40"
                                >Next</button>
                                <button onClick={() => { setChanging(null); setChangePick(''); }} className="text-slate-400"><X size={12} /></button>
                              </>
                            ) : (
                              <>
                                <button title="Change teacher" onClick={() => { setChanging(a.id); setChangePick(''); }} className="text-[10px] text-slate-500 hover:text-slate-900 inline-flex items-center gap-0.5 ml-1">
                                  <Repeat size={10} /> Change
                                </button>
                                <button
                                  title="Remove this teacher"
                                  onClick={() => window.confirm(`Remove ${a.teacherName} from ${r.subjectName}, ${r.className}${r.streamName ? ' ' + r.streamName : ''}? Records already taken stay. They stop seeing this class for this subject once they have no lessons for it on the timetable.`) && remove.mutate(a.id)}
                                  className="text-slate-300 hover:text-red-600 ml-1"
                                ><X size={12} /></button>
                              </>
                            ))}
                          </div>
                        ))}
                        {canEdit && (adding === r.key ? (
                          <div className="flex items-center gap-1.5">
                            <TeacherSelect autoFocus teachers={res.teachers} subjectId={r.subjectId} exclude={r.assignments.map(a => a.teacherKey)} value={addPick} onChange={setAddPick} />
                            <button disabled={!addPick || create.isPending} onClick={() => create.mutate({ row: r, teacherId: addPick })} className="text-[11px] font-medium bg-slate-900 text-white rounded px-2 py-1 disabled:opacity-40">Assign</button>
                            <button onClick={() => { setAdding(null); setAddPick(''); }} className="text-slate-400"><X size={12} /></button>
                          </div>
                        ) : (
                          <button onClick={() => { setAdding(r.key); setAddPick(''); }} className="text-[11px] text-sky-700 hover:underline inline-flex items-center gap-0.5">
                            <Plus size={11} /> {r.assignments.length ? 'Add teacher' : 'Assign teacher'}
                          </button>
                        ))}
                      </td>
                      <td className="px-2 py-2 text-center space-y-1">
                        {r.assignments.map(a => <div key={a.id}><NumberCell value={a.periodsPerWeek} disabled={!canEdit} onSave={n => update.mutate({ id: a.id, patch: { periodsPerWeek: n } })} /></div>)}
                      </td>
                      <td className="px-2 py-2 text-center space-y-1">
                        {r.assignments.map(a => <div key={a.id}><NumberCell value={a.doubleLessons} max={20} disabled={!canEdit} onSave={n => update.mutate({ id: a.id, patch: { doubleLessons: n ?? 0 } })} /></div>)}
                      </td>
                      <td className="px-2 py-2 text-center text-slate-700">{r.placed}{r.needed ? <span className="text-slate-400"> / {r.needed}</span> : ''}</td>
                      <td className="px-2 py-2"><Chip status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5"><Users size={13} /> Teachers</span>
            <label className="text-[11px] text-slate-600 flex items-center gap-1.5">
              <input type="checkbox" checked={onlyNoClasses} onChange={e => setOnlyNoClasses(e.target.checked)} /> No classes only
            </label>
          </div>
          <div className="divide-y divide-slate-50 max-h-[70vh] overflow-y-auto">
            {teachers.map(t => (
              <button key={t.teacherId} onClick={() => { setTeacherFilter(t.teacherId); setFilter('all'); }} className="w-full text-left px-4 py-2 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800">{t.name}</span>
                  {t.status === 'no_classes'
                    ? <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">No classes</span>
                    : <span className="text-[10px] text-slate-500">{t.placed}/{t.needed || 0} lessons{t.missingTarget ? ' · some without lessons/wk' : ''}</span>}
                </div>
                {t.classes.length > 0 && <p className="text-[10px] text-slate-400 truncate">{t.subjects.join(', ')} · {t.classes.join(', ')}</p>}
              </button>
            ))}
            {teachers.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No teachers match.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
