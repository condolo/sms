/* ============================================================
   AddSlotSlideOver — add OR edit a lesson slot
   Props:
     classId        string          — required for create mode
     editSlot       object|null     — if set, operates in edit mode
     defaults       { day, period } — pre-fills on create
     onClose        fn
     onCreated      fn              — called after successful save (both modes)
     lessonPeriods  []              — non-break periods from the active bell schedule
   ============================================================ */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, AlertTriangle, X, Edit2 } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { timetable as ttApi, teachers as teachersApi } from '@/api/client.js';
import { DAYS, DAY_FULL, DEFAULT_BELL } from '../constants.js';
import { FField, iCls } from './TimetablePrimitives.jsx';

const EMPTY_FORM = {
  day: 'monday', period: '1', subject: '',
  teacherId: '', teacherName: '', room: '', type: 'lesson',
};

export default function AddSlotSlideOver({
  classId,
  editSlot   = null,
  defaults,
  onClose,
  onCreated,
  lessonPeriods = DEFAULT_BELL.filter(b => !b.isBreak),
}) {
  const isEdit = !!editSlot;

  function buildForm() {
    if (isEdit) {
      return {
        day:         editSlot.day         ?? 'monday',
        period:      String(editSlot.period ?? '1'),
        subject:     editSlot.subject     ?? '',
        teacherId:   editSlot.teacherId   ?? '',
        teacherName: editSlot.teacherName ?? '',
        room:        editSlot.room        ?? '',
        type:        editSlot.type        ?? 'lesson',
      };
    }
    return { ...EMPTY_FORM, ...defaults };
  }

  const [form,   setFormState] = useState(buildForm);
  const [errors, setErrors]    = useState({});

  // Re-init if editSlot changes (e.g. user clicks a different slot)
  useEffect(() => {
    setFormState(buildForm());
    setErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSlot?.id ?? editSlot?._id, defaults?.day, defaults?.period]);

  function set(k, v) {
    setFormState(f => ({ ...f, [k]: v }));
    setErrors(e => { const n = { ...e }; delete n[k]; delete n._server; return n; });
  }

  const { data: teachersData } = useQuery({
    queryKey: ['teachers', 'picker'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teachers = teachersData?.data ?? [];

  // Key: use userId (the format timetable slots use for teacherId)
  // so conflict detection and workload queries match correctly.
  function teacherKey(t) {
    return t.userId ?? t.id ?? String(t._id);
  }

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const payload = {
        day:         form.day,
        period:      form.period,
        subject:     form.subject.trim()     || undefined,
        teacherId:   form.teacherId          || undefined,
        teacherName: form.teacherName.trim() || undefined,
        room:        form.room.trim()        || undefined,
        type:        form.type,
      };
      if (isEdit) {
        return ttApi.update(editSlot.id ?? editSlot._id, payload);
      }
      return ttApi.create({ ...payload, classId });
    },
    onSuccess: onCreated,
    onError:   err => setErrors({ _server: err?.message ?? `Failed to ${isEdit ? 'update' : 'add'} slot.` }),
  });

  function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.subject.trim()) errs.subject = 'Subject is required.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    mutate();
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              {isEdit && <Edit2 size={14} className="text-slate-400" />}
              {isEdit ? 'Edit Lesson Slot' : 'Add Lesson Slot'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isEdit
                ? `${editSlot.subject || 'Slot'} · ${DAY_FULL[editSlot.day] ?? editSlot.day} P${editSlot.period}`
                : 'Assign a lesson to the schedule'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{errors._server}</span>
            </div>
          )}

          <FField label="Subject *" error={errors.subject}>
            <input
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              placeholder="e.g. Mathematics"
              className={iCls(errors.subject)}
              autoFocus
            />
          </FField>

          <div className="grid grid-cols-2 gap-3">
            <FField label="Day">
              <select value={form.day} onChange={e => set('day', e.target.value)} className={iCls()}>
                {DAYS.map(d => <option key={d} value={d}>{DAY_FULL[d]}</option>)}
              </select>
            </FField>
            <FField label="Period">
              <select value={form.period} onChange={e => set('period', e.target.value)} className={iCls()}>
                {lessonPeriods.map(b => (
                  <option key={b.p} value={String(b.p)}>P{b.p} · {b.start}</option>
                ))}
              </select>
            </FField>
          </div>

          <FField label="Teacher">
            <select
              value={form.teacherId}
              onChange={e => {
                const t = teachers.find(t => teacherKey(t) === e.target.value);
                set('teacherId',   e.target.value);
                set('teacherName', t ? `${t.title ?? ''} ${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() : '');
              }}
              className={iCls()}
            >
              <option value="">No teacher assigned</option>
              {teachers.map(t => (
                <option key={teacherKey(t)} value={teacherKey(t)}>
                  {t.firstName} {t.lastName}
                  {t.department ? ` · ${t.department}` : ''}
                </option>
              ))}
            </select>
          </FField>

          <FField label="Room">
            <input
              value={form.room}
              onChange={e => set('room', e.target.value)}
              placeholder="e.g. Lab 2, Hall A"
              className={iCls()}
            />
          </FField>

          <FField label="Slot type">
            <select value={form.type} onChange={e => set('type', e.target.value)} className={iCls()}>
              <option value="lesson">Lesson</option>
              <option value="assembly">Assembly</option>
              <option value="registration">Registration</option>
              <option value="free">Free period</option>
            </select>
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isPending}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isPending ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save changes' : 'Add slot')}
          </button>
        </div>
      </motion.div>
    </>
  );
}
