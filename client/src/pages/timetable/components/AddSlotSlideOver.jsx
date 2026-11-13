/* ============================================================
   AddSlotSlideOver — add OR edit a lesson slot
   Props:
     classId        string          — required for create mode
     editSlot       object|null     — if set, operates in edit mode
     defaults       { day, period } — pre-fills on create
     onClose        fn
     onCreated      fn              — called after successful save (both modes)
     lessonPeriods  []              — non-break periods from the active bell schedule

   Enhancements (v4.17):
     • Subject dropdown from class curriculum (classSubjects)
     • Room dropdown from registered rooms registry
     • Auto-fill teacher + room from teaching assignments when subject is picked
   ============================================================ */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, AlertTriangle, X, Edit2, Zap, Lock } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  timetable as ttApi,
  teachers as teachersApi,
  classSubjects,
  teachingAssignments as assignmentsApi,
  rooms as roomsApi,
  streams as streamsApi,
} from '@/api/client.js';
import { DAYS, DAY_FULL, DEFAULT_BELL } from '../constants.js';
import { FField, iCls } from './TimetablePrimitives.jsx';

const EMPTY_FORM = {
  day: 'monday', period: '1', subject: '',
  teacherId: '', teacherName: '',
  assistantTeacherId: '', assistantTeacherName: '',
  // Taught together (v5.270.0): co-teachers are in the lesson and clash-checked like the main teacher.
  coTeacherIds: [], coTeacherNames: [],
  room: '', roomId: '', type: 'lesson', locked: false,
};

export default function AddSlotSlideOver({
  classId,
  editSlot   = null,
  defaults,
  onClose,
  onCreated,
  lessonPeriods = DEFAULT_BELL.filter(b => !b.isBreak),
  days = DAYS,           // the school's working days (Timetable → Days)
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
        assistantTeacherId:   editSlot.assistantTeacherId   ?? '',
        assistantTeacherName: editSlot.assistantTeacherName ?? '',
        coTeacherIds:   editSlot.coTeacherIds   ?? [],
        coTeacherNames: editSlot.coTeacherNames ?? [],
        room:        editSlot.room        ?? '',
        roomId:      editSlot.roomId      ?? '',
        type:        editSlot.type        ?? 'lesson',
        locked:      !!editSlot.locked,
      };
    }
    return { ...EMPTY_FORM, ...defaults };
  }

  const [form,   setFormState] = useState(buildForm);
  const [errors, setErrors]    = useState({});

  // subjectId: FK for the assignment lookup (separate from form.subject which is the display name)
  const [subjectId,         setSubjectId]         = useState(editSlot?.subjectId ?? '');
  const [userPickedSubject, setUserPickedSubject] = useState(false);
  const [autoFillApplied,   setAutoFillApplied]   = useState(false);
  // Set only when this slot is for one specific stream. Defaults to the
  // stream the caller was already viewing (TimetablePage's own class→stream
  // picker — each stream runs its own timetable, so "Add slot" from within
  // a specific stream's grid should stay scoped to that stream throughout,
  // not just for compulsory subjects). Empty = whole-class slot (e.g. a
  // genuine school-wide Assembly/Registration entry).
  const [streamId,          setStreamId]          = useState(editSlot?.streamId ?? editSlot?.streamIds?.[0] ?? defaults?.streamId ?? '');
  // Other streams taught together with `streamId` in this lesson (v5.270.0).
  const [togetherStreams,   setTogetherStreams]   = useState(editSlot?.streamIds?.slice(1) ?? []);

  // Re-init when editSlot changes (user clicks a different slot)
  useEffect(() => {
    setFormState(buildForm());
    setErrors({});
    setSubjectId(editSlot?.subjectId ?? '');
    setStreamId(editSlot?.streamId ?? editSlot?.streamIds?.[0] ?? defaults?.streamId ?? '');
    setTogetherStreams(editSlot?.streamIds?.slice(1) ?? []);
    setUserPickedSubject(false);
    setAutoFillApplied(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSlot?.id ?? editSlot?._id, defaults?.day, defaults?.period, defaults?.streamId]);

  function set(k, v) {
    setFormState(f => ({ ...f, [k]: v }));
    setErrors(e => { const n = { ...e }; delete n[k]; delete n._server; return n; });
  }

  /* ── Teachers ────────────────────────────────────────────── */
  const { data: teachersData } = useQuery({
    queryKey: ['teachers', 'picker'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teachers = teachersData?.data ?? [];
  function teacherKey(t) { return t.userId ?? t.id ?? String(t._id); }

  /* ── Class curriculum subjects ───────────────────────────── */
  const { data: csData } = useQuery({
    queryKey: ['class-subjects', classId],
    queryFn:  () => classSubjects.list({ classId }),
    staleTime: 5 * 60_000,
    enabled:  !!classId,
  });
  const curriculumSubjects = csData?.data ?? [];

  /* ── Streams of this class ────────────────────────────────── */
  const { data: streamsData } = useQuery({
    queryKey: ['streams', classId],
    queryFn:  () => streamsApi.list({ classId, status: 'active' }),
    staleTime: 5 * 60_000,
    enabled:  !!classId,
  });
  const streamList = streamsData?.data ?? [];
  const selectedSubjectMeta = curriculumSubjects.find(s => s.subjectId === subjectId);
  const streamRequired = !!selectedSubjectMeta?.isCompulsoryForClass && streamList.length > 0;

  /* ── Registered rooms ────────────────────────────────────── */
  const { data: roomsData } = useQuery({
    queryKey: ['rooms'],
    queryFn:  () => roomsApi.list(),
    staleTime: 5 * 60_000,
  });
  const roomList = roomsData?.data ?? [];

  /* ── Teaching assignment lookup ──────────────────────────── */
  // For a compulsory subject with per-stream teachers, streamId is what
  // tells the lookup WHICH of the (possibly several) assignments for this
  // class+subject to auto-fill from — without it, a class with two
  // different stream teachers for the same subject couldn't be told apart.
  // Deliberately doesn't fire yet if a stream is required but not picked.
  const lookupReady = !!classId && !!subjectId && userPickedSubject && (!streamRequired || !!streamId);
  const { data: lookupData, isFetching: lookingUp } = useQuery({
    queryKey: ['ta-lookup', classId, subjectId, streamId],
    queryFn:  () => assignmentsApi.lookup(classId, subjectId, streamId || undefined),
    staleTime: 60_000,
    enabled:  lookupReady,
  });
  const assignment = lookupData?.data?.[0] ?? null;
  const { data: groupData } = useQuery({
    queryKey: ['ta-group', classId, subjectId, assignment?.lessonGroupId],
    queryFn:  () => assignmentsApi.list({ classId, subjectId }),
    staleTime: 60_000,
    enabled:  !!assignment?.lessonGroupId,
  });
  const groupRows = assignment?.lessonGroupId ? (groupData?.data ?? []).filter(r => r.lessonGroupId === assignment.lessonGroupId) : [];

  // Auto-fill teacher + room when an assignment comes back
  useEffect(() => {
    if (!assignment || !userPickedSubject) return;
    setFormState(f => ({
      ...f,
      teacherId:   assignment.teacherId         ?? f.teacherId,
      teacherName: assignment.teacherName       ?? f.teacherName,
      room:        assignment.preferredRoomName ?? f.room,
      roomId:      assignment.preferredRoomId   ?? f.roomId,
    }));
    setAutoFillApplied(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?._id]);
  useEffect(() => {
    if (!userPickedSubject || !groupRows.length) return;
    const others = [];
    const names = [];
    for (const r of groupRows) {
      if (r.teacherId && r.teacherId !== assignment.teacherId && !others.includes(r.teacherId)) { others.push(r.teacherId); names.push(r.teacherName ?? ''); }
    }
    setFormState(f => ({ ...f, coTeacherIds: others, coTeacherNames: names }));
    const st = [...new Set(groupRows.map(r => r.streamId).filter(Boolean))];
    if (st.length > 1) setTogetherStreams(st.filter(x => x !== (streamId || st[0])));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupRows.map(r => r.id).join(',')]);

  function handleSubjectSelect(cs) {
    const name = cs.subject?.name ?? cs.subjectId;
    // Clear teacher + room so auto-fill can write them. streamId is
    // deliberately left as-is — it reflects which stream this whole
    // add-slot session is scoped to (see the streamId state's own
    // comment above), not something a subject change should reset.
    setFormState(f => ({ ...f, subject: name, teacherId: '', teacherName: '', room: '', roomId: '', coTeacherIds: [], coTeacherNames: [] }));
    setTogetherStreams([]);
    setSubjectId(cs.subjectId);
    setUserPickedSubject(true);
    setAutoFillApplied(false);
    setErrors(e => { const n = { ...e }; delete n.subject; delete n.streamId; return n; });
  }

  /* ── Mutation ────────────────────────────────────────────── */
  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const payload = {
        day:         form.day,
        period:      form.period,
        subject:     form.subject.trim()     || undefined,
        subjectId:   subjectId               || undefined,
        // One stream → streamId; with streams taught together → streamIds (and streamId cleared).
        ...(togetherStreams.filter(x => x !== streamId).length && streamId
          ? { streamIds: [streamId, ...togetherStreams.filter(x => x !== streamId)], streamId: isEdit ? '' : undefined }
          : { streamId: streamId || undefined, ...(isEdit ? { streamIds: [] } : {}) }),
        teacherId:   form.teacherId          || undefined,
        teacherName: form.teacherName.trim() || undefined,
        assistantTeacherId:   form.assistantTeacherId            || undefined,
        assistantTeacherName: form.assistantTeacherName.trim()   || undefined,
        // Always sent on edit so removing every co-teacher really clears them.
        ...(isEdit || form.coTeacherIds.length ? { coTeacherIds: form.coTeacherIds.filter(id => id && id !== form.teacherId) } : {}),
        // Always sent explicitly (never `undefined`, which a partial PUT
        // reads as "leave untouched") — this is the one field whose empty
        // state must always be able to reach the server, since clearing
        // roomId (unlinking a room) and blanking room (clearing free text)
        // are both real, deliberate edits, not "field not touched."
        room:        form.room.trim() || '',
        roomId:      form.roomId      || '',
        type:        form.type,
        locked:      !!form.locked,
      };
      if (isEdit) return ttApi.update(editSlot.id ?? editSlot._id, payload);
      return ttApi.create({ ...payload, classId });
    },
    onSuccess: onCreated,
    onError:   err => setErrors({ _server: err?.message ?? `Failed to ${isEdit ? 'update' : 'add'} slot.` }),
  });

  function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.subject.trim()) errs.subject = 'Subject is required.';
    if (streamRequired && !streamId) errs.streamId = 'This subject is compulsory here — select which stream this lesson is for.';
    if (form.assistantTeacherId && form.assistantTeacherId === form.teacherId) {
      errs.assistantTeacherId = 'Assistant teacher must be different from the primary teacher.';
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    mutate();
  }

  /* ── Room field helpers ───────────────────────────────────── */
  // A legacy slot (or one from any other API caller) can have room text with
  // no roomId yet. If that text is an exact match for a currently-registered
  // room, silently link it in local form state — the next Save then carries
  // a real roomId without the user having to touch the field at all. This is
  // the same one-slot-at-a-time version of what scripts/backfill-timetable-
  // room-id.js does in bulk for every existing slot at once.
  useEffect(() => {
    if (form.roomId || !form.room || !roomList.length) return;
    const match = roomList.find(r => r.name.trim().toLowerCase() === form.room.trim().toLowerCase());
    if (match) setFormState(f => (f.roomId ? f : { ...f, roomId: match.id ?? String(match._id) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomList.length, form.room]);

  const roomInRegistry = !!form.roomId && roomList.some(r => (r.id ?? String(r._id)) === form.roomId);
  // Show free-text fallback when the stored room doesn't match any registered room
  const showRoomFallback = roomList.length > 0 && !!form.room && !roomInRegistry;

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
        {/* Header */}
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

        {/* Form */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {isEdit && editSlot.locked && form.locked && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Lock size={12} className="shrink-0 mt-0.5" />
              <span>This lesson is locked, so it can't be changed or removed. Untick <b>Lock this lesson</b> below to change it.</span>
            </div>
          )}
          {errors._server && (
            <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{errors._server}</span>
            </div>
          )}

          {/* ── Subject ────────────────────────────────────── */}
          <FField label="Subject *" error={errors.subject}>
            {curriculumSubjects.length > 0 ? (
              <div className="space-y-1">
                <select
                  value={subjectId || ''}
                  onChange={e => {
                    if (!e.target.value) {
                      // User cleared the selection — reset
                      set('subject', '');
                      setSubjectId('');
                      setUserPickedSubject(false);
                      setAutoFillApplied(false);
                      return;
                    }
                    const cs = curriculumSubjects.find(s => s.subjectId === e.target.value);
                    if (cs) handleSubjectSelect(cs);
                  }}
                  className={iCls(errors.subject)}
                  autoFocus={!isEdit}
                >
                  <option value="">Select subject…</option>
                  {curriculumSubjects.map(cs => (
                    <option key={cs.subjectId} value={cs.subjectId}>
                      {cs.subject?.name ?? cs.subjectId}
                    </option>
                  ))}
                </select>
                {/* Show existing value when it came from old free-text and doesn't match curriculum */}
                {!subjectId && form.subject && (
                  <p className="text-[11px] text-slate-500 pl-1">Current: <span className="font-medium">{form.subject}</span></p>
                )}
              </div>
            ) : (
              /* No curriculum configured — free text fallback */
              <input
                value={form.subject}
                onChange={e => set('subject', e.target.value)}
                placeholder="e.g. Mathematics"
                className={iCls(errors.subject)}
                autoFocus={!isEdit}
              />
            )}
          </FField>

          {/* ── Stream ─────────────────────────────────────── */}
          {subjectId && streamList.length > 0 && (
            <FField label={`Stream${streamRequired ? ' *' : ' (optional — leave blank for the whole class)'}`} error={errors.streamId}>
              <select
                value={streamId}
                onChange={e => { setStreamId(e.target.value); setAutoFillApplied(false); setErrors(er => { const n = { ...er }; delete n.streamId; return n; }); }}
                className={iCls(errors.streamId)}
              >
                <option value="">{streamRequired ? 'Select stream…' : 'Whole class (every stream)'}</option>
                {streamList.map(s => (
                  <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.name}</option>
                ))}
              </select>
              {streamRequired && !errors.streamId && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  This subject is compulsory for this class — each stream has its own lesson and teacher.
                </p>
              )}
              {streamId && streamList.length > 1 && (
                <div className="mt-1.5">
                  <p className="text-[11px] text-slate-500">Taught together with (optional):</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {streamList.filter(s => (s.id ?? s._id) !== streamId).map(s => {
                      const id = s.id ?? s._id;
                      const on = togetherStreams.includes(id);
                      return (
                        <label key={id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] cursor-pointer ${on ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => setTogetherStreams(cur => (on ? cur.filter(x => x !== id) : [...cur, id]))} />
                          {s.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </FField>
          )}

          {/* ── Auto-fill status banner ─────────────────────── */}
          {/* Waiting on a required stream pick — don't claim "not found"
              before the lookup has even had a chance to run. */}
          {subjectId && userPickedSubject && streamRequired && !streamId ? null : subjectId && userPickedSubject && (
            <div className={`flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg border ${
              lookingUp
                ? 'bg-slate-50 text-slate-400 border-slate-200'
                : autoFillApplied && assignment
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-100'
            }`}>
              {lookingUp ? (
                <><Loader2 size={11} className="animate-spin shrink-0" /> Looking up assignment…</>
              ) : autoFillApplied && assignment ? (
                <><Zap size={11} className="shrink-0" /> Teacher and room auto-filled — edit below if needed</>
              ) : (
                <><AlertTriangle size={11} className="shrink-0" /> No teaching assignment found — fill manually</>
              )}
            </div>
          )}

          {/* ── Day + Period ────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <FField label="Day">
              <select value={form.day} onChange={e => set('day', e.target.value)} className={iCls()}>
                {/* Working days, plus this lesson's own day if the school has since removed it. */}
                {[...days, ...(days.includes(form.day) ? [] : [form.day])].map(d => <option key={d} value={d}>{DAY_FULL[d] ?? d}</option>)}
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

          {/* ── Teacher ─────────────────────────────────────── */}
          <FField label="Teacher">
            <select
              value={form.teacherId}
              onChange={e => {
                const t = teachers.find(t => teacherKey(t) === e.target.value);
                set('teacherId',   e.target.value);
                set('teacherName', t ? `${t.title ?? ''} ${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() : '');
                if (autoFillApplied) setAutoFillApplied(false);
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

          {/* ── Co-teachers (v5.270.0) ───────────────────────── */}
          <FField label="Also teaching (optional)" error={errors.coTeacherIds}>
            {form.coTeacherIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {form.coTeacherIds.map((id, i) => (
                  <span key={id} className="inline-flex items-center gap-1 text-[11px] bg-violet-50 text-violet-800 border border-violet-200 rounded-full pl-2 pr-1 py-0.5">
                    {form.coTeacherNames[i] || teachers.find(t => teacherKey(t) === id)?.firstName || 'Teacher'}
                    <button type="button" aria-label="Remove co-teacher" className="p-0.5 rounded-full hover:bg-violet-100"
                      onClick={() => setFormState(f => ({ ...f, coTeacherIds: f.coTeacherIds.filter((_, j) => j !== i), coTeacherNames: f.coTeacherNames.filter((_, j) => j !== i) }))}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <select
              value=""
              onChange={e => {
                const id = e.target.value;
                if (!id || id === form.teacherId || form.coTeacherIds.includes(id)) return;
                const t = teachers.find(x => teacherKey(x) === id);
                setFormState(f => ({ ...f, coTeacherIds: [...f.coTeacherIds, id], coTeacherNames: [...f.coTeacherNames, t ? `${t.title ?? ''} ${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() : ''] }));
              }}
              className={iCls(errors.coTeacherIds)}
            >
              <option value="">Add a co-teacher…</option>
              {teachers.filter(t => teacherKey(t) !== form.teacherId && !form.coTeacherIds.includes(teacherKey(t))).map(t => (
                <option key={teacherKey(t)} value={teacherKey(t)}>{t.firstName} {t.lastName}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Teaches this lesson too: shown on their timetable and checked for clashes like the main teacher.
            </p>
          </FField>

          {/* ── Assistant teacher ─────────────────────────────── */}
          <FField label="Assistant teacher (optional)" error={errors.assistantTeacherId}>
            <select
              value={form.assistantTeacherId}
              onChange={e => {
                const t = teachers.find(t => teacherKey(t) === e.target.value);
                set('assistantTeacherId',   e.target.value);
                set('assistantTeacherName', t ? `${t.title ?? ''} ${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() : '');
              }}
              className={iCls(errors.assistantTeacherId)}
            >
              <option value="">No assistant teacher</option>
              {teachers.map(t => (
                <option key={teacherKey(t)} value={teacherKey(t)}>
                  {t.firstName} {t.lastName}
                  {t.department ? ` · ${t.department}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Shown alongside the primary teacher on this slot — for a teaching assistant. Doesn't affect attendance, grading, or scheduling conflict checks (use Also teaching for a co-teacher).
            </p>
          </FField>

          {/* ── Room ────────────────────────────────────────── */}
          <FField label="Room">
            {roomList.length > 0 ? (
              <div className="space-y-1.5">
                <select
                  value={roomInRegistry ? form.roomId : ''}
                  onChange={e => {
                    const id = e.target.value;
                    const r  = roomList.find(x => (x.id ?? String(x._id)) === id);
                    setFormState(f => ({ ...f, roomId: id, room: r?.name ?? '' }));
                    setErrors(err => { const n = { ...err }; delete n.room; delete n._server; return n; });
                    if (autoFillApplied) setAutoFillApplied(false);
                  }}
                  className={iCls()}
                >
                  <option value="">No room assigned</option>
                  {roomList.map(r => (
                    <option key={r.id ?? r._id} value={r.id ?? String(r._id)}>{r.name}</option>
                  ))}
                </select>
                {/* Free-text fallback: shown when existing room isn't in the registry */}
                {showRoomFallback && (
                  <div className="flex items-center gap-2">
                    <input
                      value={form.room}
                      onChange={e => { set('room', e.target.value); if (autoFillApplied) setAutoFillApplied(false); }}
                      placeholder="Custom room name…"
                      className={iCls()}
                    />
                    <button
                      type="button"
                      onClick={() => setFormState(f => ({ ...f, room: '', roomId: '' }))}
                      className="text-slate-400 hover:text-slate-600 transition"
                      title="Clear"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
                {showRoomFallback && (
                  <p className="text-[10px] text-amber-600">
                    "{form.room}" is not in the registered rooms list
                  </p>
                )}
              </div>
            ) : (
              <input
                value={form.room}
                onChange={e => set('room', e.target.value)}
                placeholder="e.g. Lab 2, Hall A"
                className={iCls()}
              />
            )}
          </FField>

          {/* ── Slot type ────────────────────────────────────── */}
          <FField label="Slot type">
            <select value={form.type} onChange={e => set('type', e.target.value)} className={iCls()}>
              <option value="lesson">Lesson</option>
              <option value="assembly">Assembly</option>
              <option value="registration">Registration</option>
              <option value="free">Free period</option>
            </select>
          </FField>

          {/* ── Lock (v5.265.0) ──────────────────────────────── */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!form.locked}
              onChange={e => set('locked', e.target.checked)}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              <span className="flex items-center gap-1 text-sm font-medium text-slate-700"><Lock size={12} /> Lock this lesson</span>
              <span className="block text-[11px] text-slate-400">Keeps it in place: it can't be edited, moved or removed until unlocked, and replacing a class's timetable leaves it alone.</span>
            </span>
          </label>
        </form>

        {/* Footer */}
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
