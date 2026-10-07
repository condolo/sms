/* ============================================================
   BellScheduleSlideOver — school-wide bell schedules
   Admin only. The school can run several schedules at once. Each one
   covers a set of classes, which may come from any section. A class is
   in at most one schedule. Classes in no schedule use the School
   Default. A section default (older schedules) still applies to its own
   section's classes that have no schedule of their own.
   Props: onClose fn
   ============================================================ */
import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, Plus, AlertTriangle, CheckCircle2, X, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bellSchedule as bellApi, classes as classesApi } from '@/api/client.js';
import { DEFAULT_BELL } from '../constants.js';
import { useSections } from '@/hooks/useSections.js';

const NEW = '__new';

/* Order in the picker: School Default, then section defaults, then named schedules. */
function rank(s) {
  if (s.section === 'all' && s.classIds.length === 0) return 0;
  if (s.classIds.length === 0) return 1;
  return 2;
}

export default function BellScheduleSlideOver({ onClose }) {
  const qc = useQueryClient();
  const { sections } = useSections();
  const sectionName = useMemo(
    () => Object.fromEntries(sections.filter(s => s.key).map(s => [s.key, s.name])),
    [sections],
  );

  const [selectedId, setSelectedId] = useState(null); // a schedule id, NEW, or null = the School Default
  const [name, setName] = useState('');
  const [classIds, setClassIds] = useState([]);
  const [rows, setRows] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);

  const { data: listData } = useQuery({
    queryKey: ['bell-schedule', 'list'],
    queryFn:  () => bellApi.list(),
    staleTime: 30_000,
  });
  const schedules = useMemo(
    () => [...(listData?.data ?? [])].sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? '')),
    [listData],
  );
  const schoolDefault = schedules.find(s => rank(s) === 0) ?? null;

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'bell-schedule'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 60_000,
  });
  const classes = classesData?.data ?? [];

  /* What the school runs when nothing is saved yet */
  const { data: effectiveData, isLoading } = useQuery({
    queryKey: ['bell-schedule', 'all'],
    queryFn:  () => bellApi.get('all'),
    staleTime: 60_000,
  });
  const effective = effectiveData?.data;

  const selected = selectedId && selectedId !== NEW ? schedules.find(s => s.id === selectedId) ?? null : null;
  const target = selectedId === NEW ? null : (selected ?? schoolDefault);
  const targetIsDefault = !!target && target.classIds.length === 0;

  // Choosing a schedule loads its own times and classes. A new one starts from the School Default.
  useEffect(() => {
    if (selectedId === NEW) {
      setName('');
      setClassIds([]);
      setRows(((effective?.periods) ?? DEFAULT_BELL).map(p => ({ ...p })));
    } else if (target) {
      setName(target.name ?? '');
      setClassIds(target.classIds);
      setRows(target.periods.map(p => ({ ...p })));
    } else if (effective) {
      setName('');
      setClassIds([]);
      setRows(effective.periods.map(p => ({ ...p })));
    }
    setDirty(false);
  }, [selectedId, effectiveData, listData]);

  // Classes in some other schedule cannot be picked here.
  const takenBy = useMemo(() => {
    const map = {};
    for (const s of schedules) {
      if (target && s.id === target.id) continue;
      for (const id of s.classIds) map[id] = s.name ?? 'another schedule';
    }
    return map;
  }, [schedules, target]);

  // Classes grouped by section, so a schedule can take Year 1 from Primary and Form 1 from Secondary.
  const classGroups = useMemo(() => {
    const groups = {};
    for (const c of classes) {
      const key = c.sectionKey ?? '';
      (groups[key] = groups[key] || []).push(c);
    }
    return Object.entries(groups).map(([key, list]) => ({
      key,
      label: sectionName[key] ?? (key ? key : 'No section'),
      classes: list,
    }));
  }, [classes, sectionName]);

  function setRow(idx, key, val) {
    setRows(r => r.map((p, i) => i === idx ? { ...p, [key]: val } : p));
    setDirty(true);
  }
  function removeRow(idx) { setRows(r => r.filter((_, i) => i !== idx)); setDirty(true); }
  function addBreak() {
    setRows(r => [...(r ?? []), { p: `B${(r ?? []).filter(x => x.isBreak).length + 1}`, start: '10:30', end: '11:00', label: 'Break', isBreak: true }]);
    setDirty(true);
  }
  function addPeriod() {
    const lessons = (rows ?? []).filter(r => !r.isBreak);
    const nextNum = lessons.length + 1;
    setRows(r => [...(r ?? []), { p: String(nextNum), start: '14:00', end: '15:00', label: `Period ${nextNum}`, isBreak: false }]);
    setDirty(true);
  }
  function toggleClass(id) {
    setClassIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
    setDirty(true);
  }

  const showT = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => bellApi.update({
      ...(target ? { id: target.id } : {}),
      // Schedules that cover classes are school-wide. The section only matters for a section default.
      section: target ? target.section : 'all',
      name: name.trim() || undefined,
      classIds,
      periods: rows,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bell-schedule'] });
      qc.invalidateQueries({ queryKey: ['timetable'] });
      setDirty(false);
      setSelectedId(res?.data?.id ?? null);
      showT(`${name.trim() || (classIds.length ? 'Schedule' : 'School Default')} saved. Timetable times updated.`);
    },
    onError: err => showT(err?.message ?? 'Failed to save.', 'error'),
  });

  const { mutate: removeSchedule, isPending: removing } = useMutation({
    mutationFn: () => targetIsDefault && target.section !== 'all'
      ? bellApi.remove(target.section)
      : bellApi.removeById(target.id),
    // The server already knows exactly what was deleted (a named class
    // schedule, a section default, or the School Default itself) and
    // returns an accurate message for each — using it here instead of one
    // fixed string means deleting the School Default correctly says
    // classes fall to the built-in default, not to a "section default"
    // that, for the School Default itself, doesn't exist.
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bell-schedule'] });
      qc.invalidateQueries({ queryKey: ['timetable'] });
      setSelectedId(null);
      showT(res?.message ?? 'Schedule removed.');
    },
    onError: err => showT(err?.message ?? 'Failed to remove.', 'error'),
  });

  const canSave = !!rows?.length && dirty
    && !(selectedId === NEW && classIds.length === 0)            // a new schedule needs classes
    && !(target && !targetIsDefault && classIds.length === 0);   // a class schedule needs classes

  const iCls2 = 'text-xs px-2 py-1.5 rounded border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 w-full';
  const chipLabel = (s) => {
    if (rank(s) === 0) return 'School Default';
    if (rank(s) === 1) return `${sectionName[s.section] ?? s.section} default`;
    return s.name ?? 'Schedule';
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bell Schedules</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Times per class, across the school · teachers checked for real time-overlap
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition"><X size={18} /></button>
        </div>

        {/* Schedules */}
        <div className="px-4 pt-3 space-y-1.5 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {schedules.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                  (target?.id === s.id && selectedId !== NEW) ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {chipLabel(s)}
                {s.classIds.length > 0 && <span className="opacity-60"> · {s.classIds.length} classes</span>}
              </button>
            ))}
            <button
              onClick={() => setSelectedId(NEW)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed transition ${
                selectedId === NEW ? 'border-slate-900 text-slate-900' : 'border-slate-300 text-slate-500 hover:text-slate-700'
              }`}
            >
              <Plus size={11} /> New schedule
            </button>
          </div>
          {!schoolDefault && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No School Default yet. Classes in no schedule use the built-in times until you save one.
            </p>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className={`mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border ${
            toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {toast.type === 'error' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
            {toast.msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Name and classes */}
          {(selectedId === NEW || target) && (
            <div className="space-y-2">
              {!targetIsDefault && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Name</label>
                  <input
                    value={name}
                    onChange={e => { setName(e.target.value); setDirty(true); }}
                    placeholder="e.g. Year 1–2"
                    maxLength={60}
                    className={iCls2}
                  />
                </div>
              )}
              {targetIsDefault && (
                <p className="text-[11px] text-slate-500">
                  {target.section === 'all'
                    ? 'The School Default applies to every class that is in no schedule.'
                    : `The ${sectionName[target.section] ?? target.section} default applies to that section's classes in no schedule.`}
                </p>
              )}
              {!targetIsDefault && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Classes</label>
                  {classGroups.length === 0 && <span className="text-[11px] text-slate-400">No classes yet.</span>}
                  <div className="space-y-2">
                    {classGroups.map(g => (
                      <div key={g.key || 'none'}>
                        <p className="text-[10px] text-slate-400 mb-1">{g.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {g.classes.map(c => {
                            const id = c.id ?? c._id;
                            const on = classIds.includes(id);
                            const blocked = !on && takenBy[id];
                            return (
                              <button
                                key={id}
                                disabled={!!blocked}
                                title={blocked ? `In “${blocked}”. Remove it there first.` : undefined}
                                onClick={() => toggleClass(id)}
                                className={`px-2.5 py-1 rounded-md text-xs border transition ${
                                  on ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : blocked ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                {c.name}
                                {blocked && <span className="ml-1 text-[10px]">· {blocked}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Periods */}
          {isLoading || !rows ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(8)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-lg" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[40px_80px_80px_1fr_28px] gap-2 pb-1 border-b border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase">Key</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">Start</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">End</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">Label</span>
                <span />
              </div>
              {rows.map((row, idx) => (
                <div
                  key={idx}
                  className={`grid grid-cols-[40px_80px_80px_1fr_28px] gap-2 items-center rounded-lg px-2 py-1.5 ${
                    row.isBreak ? 'bg-slate-50 border border-dashed border-slate-200' : 'bg-white border border-slate-200'
                  }`}
                >
                  <input value={row.p} onChange={e => setRow(idx, 'p', e.target.value)} className={iCls2 + ' font-mono'} maxLength={6} />
                  <input type="time" value={row.start} onChange={e => setRow(idx, 'start', e.target.value)} className={iCls2} />
                  <input type="time" value={row.end} onChange={e => setRow(idx, 'end', e.target.value)} className={iCls2} />
                  <input value={row.label} onChange={e => setRow(idx, 'label', e.target.value)} className={iCls2} maxLength={40} />
                  <button onClick={() => removeRow(idx)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <button onClick={addPeriod} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition">
                  <Plus size={12} /> Add Period
                </button>
                <button onClick={addBreak} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-500 transition">
                  <Plus size={12} /> Add Break
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {rows && (
                <span className="text-[11px] text-slate-400">
                  {rows.filter(r => !r.isBreak).length} periods · {rows.filter(r => r.isBreak).length} breaks
                </span>
              )}
              {target && (
                <button
                  onClick={() => { if (window.confirm(
                    targetIsDefault && target.section === 'all'
                      ? 'Remove the School Default? Every class with no schedule of its own will fall back to the built-in default times.'
                      : targetIsDefault
                        ? `Remove “${chipLabel(target)}”? The classes it covered use the School Default instead.`
                        : `Remove “${target.name ?? 'this schedule'}”? Its classes use the next default down.`
                  )) removeSchedule(); }}
                  disabled={removing}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500 underline underline-offset-2 transition ml-2"
                >
                  <Trash2 size={11} /> {removing ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Close</button>
              <button
                onClick={() => save()}
                disabled={saving || !canSave}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
