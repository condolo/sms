/* ============================================================
   GenerateView — automatic timetable (v5.269.0)
   1. Pick a scope (a section, or chosen classes) and Check: what will be
      placed, what will be replaced, and anything that can't fit.
   2. Generate: the server places the lessons from the teaching
      assignments (no clashes, teacher availability, room types, doubles,
      the school's timetable rules) and stores the result as a run.
   3. Preview, then Apply to draft: replaces the scope's UNLOCKED draft
      lessons; locked lessons stay. Nothing reaches teachers, students or
      parents until Publish. Undo puts the replaced lessons back.
   Data: /api/timetable/generate (server/routes/timetable-generate.js)
   Props:
     classList  [{ id|_id, name }]
     sections   [{ id, label }]   from useSections (the 'all' tab is skipped)
     days       working days, in order
     onApplied  fn()              refresh the page's timetable queries
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wand2, Loader2, AlertCircle, AlertTriangle, CheckCircle2, Undo2, ClipboardCheck, History } from 'lucide-react';
import { timetable as ttApi } from '@/api/client.js';
import { DAY_SHORT } from '../constants.js';

const classKey = c => c.id ?? c._id;

function Notice({ level, children }) {
  const err = level === 'error';
  const Icon = err ? AlertCircle : AlertTriangle;
  return (
    <li className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${err ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
      <Icon size={14} className="mt-0.5 flex-shrink-0" /> <span>{children}</span>
    </li>
  );
}

/* One class's generated week: rows = its periods (by start time), columns = days. */
function ClassPreview({ name, lessons, days }) {
  const times = [...new Map(lessons.map(l => [l.startTime, { start: l.startTime, end: l.endTime, period: l.period }])).values()]
    .sort((a, b) => a.start.localeCompare(b.start));
  const at = (day, start) => lessons.filter(l => l.day === day && l.startTime === start);
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-100 text-sm font-semibold text-slate-800">{name}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold text-slate-500 w-20">Time</th>
              {days.map(d => <th key={d} className="text-left px-2 py-1.5 font-semibold text-slate-500">{DAY_SHORT[d] ?? d}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {times.map(t => (
              <tr key={t.start}>
                <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{t.start}–{t.end}</td>
                {days.map(d => (
                  <td key={d} className="px-2 py-1 align-top">
                    {at(d, t.start).map((l, i) => (
                      <div key={i} className={`rounded px-1.5 py-1 mb-0.5 ${l.doubleId ? 'bg-violet-50 border border-violet-200' : 'bg-slate-50 border border-slate-200'}`}>
                        <p className="font-semibold text-slate-800 truncate">{l.subject}</p>
                        <p className="text-[10px] text-slate-500 truncate">{l.teacherName}{l.room ? ` · ${l.room}` : ''}</p>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GenerateView({ classList = [], sections = [], days = [], onApplied }) {
  const qc = useQueryClient();
  const sectionOptions = sections.filter(s => s.id && s.id !== 'all');
  const [mode, setMode] = useState('section');           // 'section' | 'classes'
  const [sectionKey, setSectionKey] = useState(sectionOptions[0]?.id ?? '');
  const [picked, setPicked] = useState([]);
  const [runId, setRunId] = useState(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [message, setMessage] = useState(null);           // { ok, text }

  const scope = mode === 'section' ? (sectionKey ? { sectionKey } : null) : (picked.length ? { classIds: picked } : null);
  const scopeKey = JSON.stringify(scope);

  const precheck = useMutation({ mutationFn: () => ttApi.generator.precheck(scope).then(r => ({ ...r.data, scopeKey })) });
  const generate = useMutation({
    mutationFn: () => ttApi.generator.generate(scope).then(r => r.data),
    onSuccess: (run) => { setRunId(run.id); setConfirmApply(false); setMessage(null); qc.invalidateQueries({ queryKey: ['timetable', 'generator', 'runs'] }); },
  });
  const { data: run, isFetching: runLoading } = useQuery({
    queryKey: ['timetable', 'generator', 'run', runId],
    queryFn: () => ttApi.generator.run(runId).then(r => r.data),
    enabled: !!runId,
  });
  const { data: runs = [] } = useQuery({
    queryKey: ['timetable', 'generator', 'runs'],
    queryFn: () => ttApi.generator.runs().then(r => r.data),
  });
  const refreshAfterChange = () => {
    qc.invalidateQueries({ queryKey: ['timetable'] });
    onApplied?.();
  };
  const apply = useMutation({
    mutationFn: (id) => ttApi.generator.apply(id).then(r => r.data),
    onSuccess: (r) => { setConfirmApply(false); setMessage({ ok: true, text: `Applied to the draft: ${r.applied} lessons placed, ${r.replaced} replaced. Publish when you're ready.` }); refreshAfterChange(); },
    onError: (e) => setMessage({ ok: false, text: e.message }),
  });
  // Undo first asks the server; if generated lessons were edited by hand
  // since applying, it says which and we ask before removing them too.
  const [undoConfirm, setUndoConfirm] = useState(null);   // { id, text, details }
  const undo = useMutation({
    mutationFn: ({ id, confirmEdited }) => ttApi.generator.undo(id, confirmEdited).then(r => r.data),
    onSuccess: (r) => { setUndoConfirm(null); setMessage({ ok: true, text: `Undone: generated lessons removed, ${r.restored} earlier lessons put back.` }); refreshAfterChange(); },
    onError: (e, vars) => {
      const details = e.extra?.error?.details ?? [];
      if (e.code === 'EDITED_SINCE') { setMessage(null); setUndoConfirm({ id: vars.id, text: e.message, details }); return; }
      setUndoConfirm(null);
      setMessage({ ok: false, text: e.message, details });
    },
  });

  const pre = precheck.data && precheck.data.scopeKey === scopeKey ? precheck.data : null;
  const errors = pre?.precheck.filter(p => p.level === 'error') ?? [];
  const warnings = pre?.precheck.filter(p => p.level === 'warning') ?? [];
  const nothing = pre?.precheck.some(p => p.code === 'nothing_to_place' || p.code === 'no_classes');

  const classNameById = useMemo(() => Object.fromEntries(classList.map(c => [String(classKey(c)), c.name])), [classList]);
  const byClass = useMemo(() => {
    const m = new Map();
    for (const l of run?.lessons ?? []) {
      const k = `${l.classId}|${l.streamId || ''}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    }
    return [...m.entries()].sort((a, b) => (classNameById[a[0].split('|')[0]] ?? '').localeCompare(classNameById[b[0].split('|')[0]] ?? ''));
  }, [run, classNameById]);
  const latestApplied = runs.find(r => r.appliedAt && !r.undoneAt);
  const v = run?.stats?.violations ?? {};

  function toggleClass(id) {
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  }

  return (
    <div className="space-y-5">
      {/* ── 1. Scope ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Wand2 size={18} className="text-violet-600 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Generate a timetable</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Places lessons from the teaching assignments (periods per week, doubles), avoiding clashes and the times teachers marked unavailable,
              using the right room types and your Days &amp; rules. Locked lessons and other sections stay as they are. The result goes to the
              draft only after you apply it, and nobody sees it until you publish.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
            {[['section', 'A section'], ['classes', 'Chosen classes']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMode(id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md ${mode === id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                {label}
              </button>
            ))}
          </div>
          {mode === 'section' && (
            <select value={sectionKey} onChange={e => setSectionKey(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700">
              {sectionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
        </div>
        {mode === 'classes' && (
          <div className="flex flex-wrap gap-1.5">
            {classList.map(c => {
              const id = String(classKey(c));
              const on = picked.includes(id);
              return (
                <button key={id} type="button" onClick={() => toggleClass(id)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!scope || precheck.isPending} onClick={() => precheck.mutate()}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {precheck.isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />} Check
          </button>
          <button type="button" disabled={!pre || nothing || generate.isPending} onClick={() => generate.mutate()}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
            {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {generate.isPending ? 'Generating… (up to 10 s)' : errors.length ? 'Generate anyway' : 'Generate'}
          </button>
        </div>
        {!pre && scope && <p className="text-xs text-slate-400">Check first: it lists anything that can't fit before you generate.</p>}
        {precheck.isError && <p className="text-xs text-red-600">{precheck.error?.message}</p>}
        {generate.isError && <p className="text-xs text-red-600">{generate.error?.message}</p>}

        {pre && (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              <strong>{pre.lessonsNeeded}</strong> lessons to place for {pre.classes.length} class{pre.classes.length === 1 ? '' : 'es'}
              {pre.classes.length ? ` (${pre.classes.join(', ')})` : ''}. Applying will replace <strong>{pre.replaceable}</strong> unlocked draft lesson{pre.replaceable === 1 ? '' : 's'} of those subjects
              {pre.kept ? <>; <strong>{pre.kept}</strong> other lesson{pre.kept === 1 ? '' : 's'} (subjects with no periods per week) stay where they are</> : ''}.
            </p>
            {(errors.length > 0 || warnings.length > 0) ? (
              <ul className="space-y-1.5">
                {errors.map((p, i) => <Notice key={`e${i}`} level="error">{p.message}</Notice>)}
                {warnings.map((p, i) => <Notice key={`w${i}`} level="warning">{p.message}</Notice>)}
              </ul>
            ) : (
              <p className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Nothing found that would stop a full timetable.</p>
            )}
            {errors.length > 0 && !nothing && (
              <p className="text-xs text-slate-500">You can still generate: the generator places everything it can and lists the rest with the reason.</p>
            )}
          </div>
        )}
      </div>

      {message && (
        <div className={`text-sm rounded-lg px-4 py-2.5 border ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {message.text}
          {message.details?.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-xs space-y-0.5">{message.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
          )}
        </div>
      )}
      {undoConfirm && (
        <div className="text-sm rounded-lg px-4 py-3 border bg-amber-50 border-amber-200 text-amber-900 space-y-2">
          <p className="font-medium">{undoConfirm.text}</p>
          {undoConfirm.details.length > 0 && (
            <ul className="list-disc pl-5 text-xs space-y-0.5">{undoConfirm.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => undo.mutate({ id: undoConfirm.id, confirmEdited: true })} disabled={undo.isPending}
              className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white disabled:opacity-50">
              {undo.isPending ? 'Undoing…' : 'Undo anyway'}
            </button>
            <button type="button" onClick={() => setUndoConfirm(null)} className="text-sm px-3 py-1.5 rounded-lg border border-amber-300 text-amber-900">Keep my changes</button>
          </div>
        </div>
      )}

      {/* ── 2. Result ── */}
      {runId && (
        runLoading && !run ? (
          <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading result…</div>
        ) : run && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Placed {run.stats.lessonsPlaced} of {run.stats.lessonsNeeded} lessons
                    {run.stats.lessonsUnplaced ? <span className="text-amber-700"> · {run.stats.lessonsUnplaced} not placed</span> : <span className="text-emerald-700"> · all placed</span>}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {run.scopeLabel} · rule breaks: {v.teacherOverDay ?? 0} over a teacher's daily limit, {v.subjectOverDay ?? 0} extra same-subject in a day,
                    {' '}{v.teacherGaps ?? 0} teacher gaps{v.coreAfternoon ? `, ${v.coreAfternoon} core lessons in the afternoon` : ''} · {(run.stats.durationMs / 1000).toFixed(1)} s
                    {run.stats.lessonsWithoutRoom ? <span className="text-amber-700"> · {run.stats.lessonsWithoutRoom} lesson{run.stats.lessonsWithoutRoom === 1 ? '' : 's'} without a room</span> : null}
                  </p>
                </div>
                {!run.appliedAt ? (
                  confirmApply ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600">Replace {run.stats.replaces} unlocked draft lesson{run.stats.replaces === 1 ? '' : 's'} of these subjects?</span>
                      <button type="button" onClick={() => apply.mutate(run.id)} disabled={apply.isPending}
                        className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-50">
                        {apply.isPending ? 'Applying…' : 'Yes, apply'}
                      </button>
                      <button type="button" onClick={() => setConfirmApply(false)} className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600">Cancel</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmApply(true)} disabled={!run.lessons?.length}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50">
                      <CheckCircle2 size={14} /> Apply to draft
                    </button>
                  )
                ) : (
                  <span className="text-xs font-semibold text-emerald-700">{run.undoneAt ? 'Applied, then undone' : 'Applied to the draft'}</span>
                )}
              </div>

              {run.unplaced?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">Not placed</p>
                  <ul className="space-y-1">
                    {run.unplaced.map((u, i) => (
                      <li key={i} className="text-xs text-slate-700"><span className="font-medium">{u.label}</span>: {u.reason}.</li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-slate-400 mt-1.5">Place these by hand after applying, or change what's in the way (availability, periods per week, rooms, Days &amp; rules) and generate again.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {byClass.map(([k, lessons]) => (
                <ClassPreview key={k} name={`${classNameById[k.split('|')[0]] ?? k.split('|')[0]}${k.split('|')[1] ? ' (stream)' : ''}`} lessons={lessons} days={days} />
              ))}
            </div>
            <p className="text-[11px] text-slate-400">Preview shows the generated lessons only; locked lessons and other sections are on the Class Grid. Purple = double lesson.</p>
          </div>
        )
      )}

      {/* ── 3. Recent runs ── */}
      {runs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-semibold text-slate-600 flex items-center gap-1.5"><History size={13} /> Recent runs</div>
          <ul className="divide-y divide-slate-100">
            {runs.slice(0, 8).map(r => (
              <li key={r.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                <button type="button" onClick={() => setRunId(r.id)} className="text-left text-slate-700 hover:underline">
                  {new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {r.scopeLabel} · {r.stats?.lessonsPlaced}/{r.stats?.lessonsNeeded} placed
                </button>
                <span className="flex items-center gap-2">
                  <span className={r.undoneAt ? 'text-slate-400' : r.appliedAt ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                    {r.undoneAt ? 'Undone' : r.appliedAt ? 'Applied' : 'Not applied'}
                  </span>
                  {latestApplied?.id === r.id && (
                    <button type="button" onClick={() => undo.mutate({ id: r.id })} disabled={undo.isPending}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      <Undo2 size={12} /> Undo
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
