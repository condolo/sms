/* ============================================================
   TimetableSettingsModal — "Days & rules" (v5.265.0 days, v5.268.0 rules)
   Working days: the days lessons can be placed on. Removing a day keeps
   its lessons (they stay visible to move or remove).
   Rules: how a good timetable looks. The automatic timetable generator
   follows them; "lessons a day" (with teacher availability) is also
   shown as a warning on the draft. They never block editing by hand.
   Saved together via PUT /api/timetable/settings.
   Props: settings { workingDays, rules }, onClose fn, onSaved fn(result)
   ============================================================ */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, CalendarDays, Loader2 } from 'lucide-react';
import { timetable as ttApi, subjects as subjectsApi } from '@/api/client.js';
import { ALL_DAYS, DAY_FULL } from '../constants.js';

const RULE_TEXT = {
  maxTeacherLessonsPerDay: { label: 'Most lessons a teacher teaches in a day', unit: 'lessons' },
  maxSubjectPerDay:        { label: 'Most times a class has the same subject in a day', unit: 'times', hint: 'A double lesson counts once.' },
  avoidTeacherGaps:        { label: 'Keep each teacher’s lessons together, with few free periods in between' },
  spreadAcrossWeek:        { label: 'Spread each subject across the week' },
  usePreferredRooms:       { label: 'Use each teacher’s preferred room when it’s free' },
  coreSubjectsMorning:     { label: 'Put these subjects in the morning where possible' },
};

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-200'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

/* Subject time rules (v5.270.0): when a subject must NOT be taught, e.g.
   "no PE in lesson 1", "no Chemistry on Friday". Lesson numbers count a
   class's lessons in the day (breaks not counted), so one rule works for
   every section's bell. The generator never breaks these; a lesson placed
   by hand there shows as a warning. */
const POSITIONS = Array.from({ length: 10 }, (_, i) => i + 1);
function SubjectTimeRules({ rule, subjects, days, onChange }) {
  const [adding, setAdding] = useState('');
  const items = rule.items || [];
  const nameOf = id => subjects.find(s => s.id === id)?.name ?? 'Subject';
  const update = (subjectId, patch) => onChange({ items: items.map(i => (i.subjectId === subjectId ? { ...i, ...patch } : i)) });
  const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const used = new Set(items.map(i => i.subjectId));
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <Toggle on={rule.on} onChange={on => onChange({ on })} label="Subject time rules" />
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex-1">Subject time rules</h3>
      </div>
      <p className="text-xs text-slate-500">
        When a subject must not be taught, e.g. no PE in lesson 1. Lesson numbers count the class&apos;s lessons in the day, not breaks.
        The automatic timetable never breaks these; a lesson you place there by hand shows as a warning.
      </p>
      {rule.on && (
        <div className="space-y-2">
          {items.map(it => (
            <div key={it.subjectId} className="border border-slate-200 rounded-xl px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{nameOf(it.subjectId)}</span>
                <button type="button" onClick={() => onChange({ items: items.filter(i => i.subjectId !== it.subjectId) })}
                  className="text-[11px] text-slate-500 hover:text-red-600">Remove</button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-slate-500 w-20">Not in lesson</span>
                {POSITIONS.map(p => {
                  const on = it.notPositions.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => update(it.subjectId, { notPositions: toggle(it.notPositions, p).sort((a, b) => a - b) })}
                      aria-pressed={on} aria-label={`Not in lesson ${p}`}
                      className={`w-7 h-6 rounded text-[11px] border ${on ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300 hover:border-rose-400'}`}>
                      {p}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-slate-500 w-20">Not on</span>
                {days.map(d => {
                  const on = it.notDays.includes(d);
                  return (
                    <button key={d} type="button" onClick={() => update(it.subjectId, { notDays: toggle(it.notDays, d) })}
                      aria-pressed={on}
                      className={`px-2 h-6 rounded text-[11px] border ${on ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300 hover:border-rose-400'}`}>
                      {DAY_FULL[d].slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              {!it.notPositions.length && !it.notDays.length && (
                <p className="text-[11px] text-amber-600">Pick at least one lesson or day, or remove this rule (an empty rule isn&apos;t saved).</p>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <select value={adding} onChange={e => setAdding(e.target.value)} className="flex-1 text-sm px-2 py-1.5 rounded-lg border border-slate-200">
              <option value="">Add a subject…</option>
              {subjects.filter(s => !used.has(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" disabled={!adding}
              onClick={() => { onChange({ items: [...items, { subjectId: adding, notPositions: [], notDays: [] }] }); setAdding(''); }}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50">Add</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function TimetableSettingsModal({ settings, onClose, onSaved }) {
  const [days, setDays]   = useState(settings.workingDays);
  const [rules, setRules] = useState(settings.rules);
  const [error, setError] = useState('');

  const { data: subjectsData } = useQuery({
    queryKey: ['subjects', 'all'],
    queryFn:  () => subjectsApi.list({ limit: 500 }),
    staleTime: 5 * 60_000,
  });
  const subjectList = (subjectsData?.data ?? []).filter(s => s.isActive !== false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => ttApi.saveSettings({ workingDays: ALL_DAYS.filter(d => days.includes(d)), rules }),
    onSuccess: (res) => onSaved(res?.data ?? {}),
    onError:   (err) => setError(err?.message ?? 'Could not save.'),
  });

  const toggleDay = (d) => setDays(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]);
  const setRule = (key, patch) => setRules(r => ({ ...r, [key]: { ...r[key], ...patch } }));
  const toggleCore = (id) => setRule('coreSubjectsMorning', {
    subjectIds: rules.coreSubjectsMorning.subjectIds.includes(id)
      ? rules.coreSubjectsMorning.subjectIds.filter(x => x !== id)
      : [...rules.coreSubjectsMorning.subjectIds, id],
  });

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          role="dialog" aria-label="Days and rules"
          className="pointer-events-auto w-full max-w-lg max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><CalendarDays size={14} /> Days &amp; rules</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"><X size={16} /></button>
          </div>

          <div className="px-5 py-4 space-y-5 overflow-y-auto">
            {/* Working days */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Working days</h3>
              <p className="text-xs text-slate-500">The days lessons can be placed on. Add Saturday if the school teaches on Saturdays.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ALL_DAYS.map(d => (
                  <label key={d} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition ${
                    days.includes(d) ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} className="rounded border-slate-300" />
                    {DAY_FULL[d]}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">Removing a day keeps the lessons already on it, so you can move or remove them.</p>
            </section>

            {/* Rules */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Rules</h3>
              <p className="text-xs text-slate-500">
                How a good timetable looks. The automatic timetable follows these. Editing by hand is never blocked; a teacher over the
                lessons-a-day limit, or teaching when marked unavailable, shows as a warning on the draft.
              </p>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {Object.entries(RULE_TEXT).map(([key, t]) => {
                  const r = rules[key];
                  if (!r) return null;
                  return (
                    <li key={key} className="px-3 py-2.5 space-y-2">
                      <div className="flex items-center gap-3">
                        <Toggle on={r.on} onChange={on => setRule(key, { on })} label={t.label} />
                        <span className={`text-sm flex-1 ${r.on ? 'text-slate-800' : 'text-slate-400'}`}>{t.label}</span>
                        {'value' in r && (
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <input type="number" min="1" max="20" value={r.value} disabled={!r.on}
                              onChange={e => setRule(key, { value: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)) })}
                              className="w-14 text-sm px-2 py-1 rounded-md border border-slate-200 disabled:opacity-50" />
                            {t.unit}
                          </span>
                        )}
                      </div>
                      {t.hint && r.on && <p className="text-[11px] text-slate-400 pl-12">{t.hint}</p>}
                      {key === 'coreSubjectsMorning' && r.on && (
                        <div className="pl-12 flex flex-wrap gap-1.5">
                          {subjectList.length === 0 && <span className="text-[11px] text-slate-400">No subjects yet.</span>}
                          {subjectList.map(s => {
                            const on = r.subjectIds.includes(s.id);
                            return (
                              <button key={s.id} type="button" onClick={() => toggleCore(s.id)}
                                className={`px-2 py-0.5 rounded-full text-[11px] border transition ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'}`}>
                                {s.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Subject time rules (v5.270.0) */}
            {rules.subjectTimes && (
              <SubjectTimeRules
                rule={rules.subjectTimes}
                subjects={subjectList}
                days={ALL_DAYS.filter(d => days.includes(d))}
                onChange={patch => setRule('subjectTimes', patch)}
              />
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button onClick={() => mutate()} disabled={isPending || days.length === 0}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
              {isPending && <Loader2 size={13} className="animate-spin" />} Save
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}
