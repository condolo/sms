/**
 * eLearning → Assignments → New
 *
 * A full-page builder instead of a modal: basics, delivery, answer mode and
 * the question builder all fit without scrolling a dialog. The right rail
 * keeps the summary and the validation checklist visible while editing.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, CalendarDays, CheckCircle2, ChevronLeft, Clock,
  FileText, Files, Library, ListChecks, Loader2, Paperclip, PenLine, Plus, Save,
} from 'lucide-react';
import {
  assignments as api, assessment, classes, classSubjects, subjects,
} from '@/api/client.js';
import QuestionEditor, { emptyQuestion, QUESTION_TYPE_LABEL, uid } from '@/components/assignments/QuestionEditor.jsx';

function isoPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const MODES = [
  { key: 'written', label: 'Written', hint: 'One text answer', Icon: PenLine },
  { key: 'file', label: 'File upload', hint: 'A file from the student', Icon: Paperclip },
  { key: 'both', label: 'Text + file', hint: 'Either, or both', Icon: Files },
  { key: 'quiz', label: 'Quiz', hint: 'Questions, auto-marked', Icon: ListChecks },
];

function Section({ title, hint, children, icon: Icon }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-2">
        {Icon && <Icon size={16} className="text-indigo-600 mt-0.5" />}
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

export default function AssignmentEditorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    type: 'ASSIGNMENT',
    answerMode: 'written',
    title: '',
    description: '',
    classId: '',
    subjectId: '',
    dueDate: isoPlusDays(7),
    dueTime: '23:59',
    maxPoints: '20',
    timeLimitMinutes: '',
    assessmentScheduleId: '',
    allowLate: false,
  });
  const [questions, setQuestions] = useState([]);
  const [toast, setToast] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const classQuery = useQuery({
    queryKey: ['classes', 'assignment-builder'],
    queryFn: () => classes.list(),
    staleTime: 5 * 60_000,
  });
  const classList = classQuery.data?.data ?? [];

  const subjectQuery = useQuery({
    queryKey: ['subjects'],
    queryFn: () => subjects.list(),
    staleTime: 5 * 60_000,
  });
  const subjectList = subjectQuery.data?.data ?? [];

  const curriculum = useQuery({
    queryKey: ['class-subjects', form.classId],
    queryFn: () => classSubjects.list({ classId: form.classId }),
    enabled: !!form.classId,
    retry: false,
  });
  const allowedSubjectIds = useMemo(
    () => (curriculum.data?.data ?? []).map(r => r.subjectId),
    [curriculum.data],
  );

  const scheduleQuery = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn: () => assessment.getSchedule(),
    retry: false,
  });
  const schedules = scheduleQuery.data?.data ?? [];

  const bankQuery = useQuery({
    queryKey: ['question-bank', form.subjectId],
    queryFn: () => api.questionBank(form.subjectId ? { subjectId: form.subjectId } : {}),
    enabled: form.answerMode === 'quiz',
    retry: false,
  });
  const bankQuestions = bankQuery.data?.data?.questions ?? [];

  const isQuiz = form.answerMode === 'quiz';
  const isMaterial = form.type === 'MATERIAL';
  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  const questionsValid = !isQuiz || (
    questions.length > 0 &&
    questions.every(q => q.prompt.trim() && Number(q.points) > 0 &&
      (!['MCQ_SINGLE', 'MCQ_MULTI'].includes(q.type) ||
        (q.options.filter(o => o.text.trim()).length >= 2 && q.correctOptionIds.length > 0)))
  );

  const valid = !!form.title.trim() && !!form.classId && !!form.subjectId && questionsValid;

  const setQuestion = (id, patch) => setQuestions(qs => qs.map(q => (q.id === id ? { ...q, ...patch } : q)));

  const create = useMutation({
    mutationFn: () => api.create({
      classId: form.classId,
      subjectId: form.subjectId,
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim(),
      dueDate: form.dueDate || null,
      dueTime: form.dueTime || null,
      maxPoints: isMaterial ? null : (isQuiz ? totalPoints : Number(form.maxPoints || 100)),
      assessmentScheduleId: form.assessmentScheduleId || null,
      allowLate: form.allowLate,
      answerMode: isMaterial ? 'written' : form.answerMode,
      questions: isQuiz ? questions.map(q => ({
        type: q.type,
        prompt: q.prompt.trim(),
        points: Number(q.points),
        options: ['MCQ_SINGLE', 'MCQ_MULTI'].includes(q.type) ? q.options : undefined,
        correctOptionIds: ['MCQ_SINGLE', 'MCQ_MULTI'].includes(q.type) ? q.correctOptionIds : undefined,
      })) : undefined,
      timeLimitMinutes: isQuiz && form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
    }),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['assignments'] });
      navigate(`/elearning/assignments/${res.data.assignment.id}`);
    },
    onError: err => setToast({ type: 'error', msg: err.message }),
  });

  function saveToBank(q) {
    api.saveQuestion({
      subjectId: form.subjectId || null,
      type: q.type,
      prompt: q.prompt.trim(),
      points: Number(q.points),
      options: q.options,
      correctOptionIds: q.correctOptionIds,
    })
      .then(() => setToast({ type: 'success', msg: 'Question saved to the bank.' }))
      .catch(err => setToast({ type: 'error', msg: err.message }));
  }

  function addFromBank(bq) {
    const cloned = {
      id: uid(),
      type: bq.type,
      prompt: bq.prompt,
      points: String(bq.points),
      options: (bq.options || []).map(o => ({ id: uid(), text: o.text })),
      correctOptionIds: [],
    };
    cloned.correctOptionIds = (bq.correctOptionIds || [])
      .map(cid => {
        const idx = (bq.options || []).findIndex(o => o.id === cid);
        return idx >= 0 ? cloned.options[idx].id : null;
      })
      .filter(Boolean);
    setQuestions(qs => [...qs, cloned]);
  }

  const iCls = 'w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white';

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/elearning/assignments')}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <ChevronLeft size={15} /> Assignments
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-900">New assignment</h1>
            <p className="text-[11px] text-slate-400">Issue work, collect answers and grade — no Google account needed.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/elearning/assignments')}
            className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={create.isPending || !valid}
            onClick={() => create.mutate()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Create assignment
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid lg:grid-cols-[1fr,320px] gap-6">
        <main className="space-y-5 min-w-0">
          {toast && (
            <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              {toast.type === 'error' ? <AlertTriangle size={15} className="mt-0.5" /> : <CheckCircle2 size={15} className="mt-0.5" />}
              <span className="flex-1">{toast.msg}</span>
              <button type="button" onClick={() => setToast(null)} className="opacity-60 hover:opacity-100">×</button>
            </div>
          )}

          <Section title="Basics" hint="What the student sees first." icon={BookOpen}>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Title *</label>
              <input
                value={form.title}
                onChange={e => set('title', e.target.value)}
                className={iCls}
                placeholder="e.g. Fractions worksheet"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Instructions</label>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                rows={4}
                className={`${iCls} resize-none`}
                placeholder="What should the student do?"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Kind</label>
              <div className="grid grid-cols-3 gap-2">
                {[['ASSIGNMENT', 'Assignment'], ['SHORT_ANSWER_QUESTION', 'Question'], ['MATERIAL', 'Material']].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set('type', v)}
                    className={`py-2 rounded-xl text-sm font-medium border transition ${
                      form.type === v
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-indigo-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Delivery" hint="Who receives it and how they answer." icon={CalendarDays}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Class *</label>
                <select
                  value={form.classId}
                  onChange={e => { set('classId', e.target.value); set('subjectId', ''); }}
                  className={iCls}
                >
                  <option value="">Select class…</option>
                  {classList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Subject *</label>
                <select
                  value={form.subjectId}
                  onChange={e => set('subjectId', e.target.value)}
                  className={iCls}
                  disabled={!form.classId}
                >
                  <option value="">{form.classId ? 'Select subject…' : 'Pick a class first'}</option>
                  {subjectList
                    .filter(s => !allowedSubjectIds.length || allowedSubjectIds.includes(s.id))
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            {!isMaterial && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Answer mode</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MODES.map(({ key, label, hint, Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => set('answerMode', key)}
                      className={`text-left rounded-xl border p-3 transition ${
                        form.answerMode === key
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      <Icon size={15} className={form.answerMode === key ? 'text-indigo-600' : 'text-slate-400'} />
                      <span className="block text-xs font-semibold text-slate-700 mt-1.5">{label}</span>
                      <span className="block text-[10px] text-slate-400 leading-snug">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {!isMaterial && (
            <Section title="Deadline & points" hint="Times are interpreted in the school's timezone." icon={Clock}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Due date</label>
                  <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} className={iCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Due time</label>
                  <input type="time" value={form.dueTime} onChange={e => set('dueTime', e.target.value)} className={iCls} />
                </div>
                {isQuiz ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Total points</label>
                    <div className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 font-semibold text-slate-700">
                      {totalPoints}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Points</label>
                    <input type="number" min="1" value={form.maxPoints} onChange={e => set('maxPoints', e.target.value)} className={iCls} />
                  </div>
                )}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Time limit</label>
                  <input
                    type="number" min="1" max="480"
                    value={form.timeLimitMinutes}
                    onChange={e => set('timeLimitMinutes', e.target.value)}
                    placeholder="No limit"
                    disabled={!isQuiz}
                    className={`${iCls} disabled:bg-slate-50 disabled:text-slate-400`}
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allowLate}
                  onChange={e => set('allowLate', e.target.checked)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-700">Accept late submissions</span>
                  <span className="block text-[11px] text-slate-400">Off by default; the deadline is enforced server-side.</span>
                </span>
              </label>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Feeds Markbook (optional)</label>
                <select value={form.assessmentScheduleId} onChange={e => set('assessmentScheduleId', e.target.value)} className={iCls}>
                  <option value="">Just record the grade on the assignment</option>
                  {schedules.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.assessmentType} · Term {s.termNumber} · instance {s.instance ?? 1}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Linking a window routes the grade through the Markbook's locks and publish flow.
                </p>
              </div>
            </Section>
          )}

          {isQuiz && (
            <Section title="Questions" hint="MCQs are marked automatically; written and file answers wait for you." icon={ListChecks}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">
                  {questions.length} question{questions.length === 1 ? '' : 's'} · {totalPoints} points
                </span>
                <button
                  type="button"
                  onClick={() => setQuestions(qs => [...qs, emptyQuestion()])}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Plus size={13} /> Add question
                </button>
              </div>

              {questions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                  <ListChecks size={24} className="mx-auto text-slate-300" />
                  <p className="text-sm font-medium text-slate-600 mt-2">No questions yet</p>
                  <p className="text-[11px] text-slate-400">Add a question or pull one from the bank.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {questions.map((q, i) => (
                    <QuestionEditor
                      key={q.id}
                      index={i}
                      question={q}
                      onChange={patch => setQuestion(q.id, patch)}
                      onRemove={() => setQuestions(qs => qs.filter(x => x.id !== q.id))}
                      onSaveToBank={() => saveToBank(q)}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}
        </main>

        <aside className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Summary</h2>
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-slate-400">Class</dt><dd className="font-medium text-slate-700 text-right">{classList.find(c => c.id === form.classId)?.name || '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-400">Subject</dt><dd className="font-medium text-slate-700 text-right">{subjectList.find(s => s.id === form.subjectId)?.name || '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-400">Mode</dt><dd className="font-medium text-slate-700 text-right">{MODES.find(m => m.key === form.answerMode)?.label}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-400">Points</dt><dd className="font-medium text-slate-700 text-right">{isMaterial ? '—' : (isQuiz ? totalPoints : form.maxPoints || 0)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-400">Due</dt><dd className="font-medium text-slate-700 text-right">{form.dueDate || 'No date'}{form.dueTime ? ` · ${form.dueTime}` : ''}</dd></div>
              {form.timeLimitMinutes && <div className="flex justify-between gap-2"><dt className="text-slate-400">Limit</dt><dd className="font-medium text-slate-700 text-right">{form.timeLimitMinutes} min</dd></div>}
            </dl>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Ready to publish?</h2>
            <ul className="space-y-2 text-[11px]">
              {[
                [!!form.title.trim(), 'Title'],
                [!!form.classId && !!form.subjectId, 'Class and subject'],
                [!isQuiz || questionsValid, isQuiz ? 'Questions, options and correct answers' : 'Answer mode'],
              ].map(([ok, label]) => (
                <li key={label} className="flex items-center gap-2">
                  {ok
                    ? <CheckCircle2 size={13} className="text-emerald-500" />
                    : <span className="w-3 h-3 rounded-full border border-slate-300" />}
                  <span className={ok ? 'text-slate-600' : 'text-slate-400'}>{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {isQuiz && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Library size={15} className="text-indigo-600" />
                <h2 className="text-sm font-semibold text-slate-800">Question bank</h2>
              </div>
              {!form.subjectId ? (
                <p className="text-[11px] text-slate-400">Pick a subject to see saved questions.</p>
              ) : bankQuery.isLoading ? (
                <p className="text-[11px] text-slate-400">Loading…</p>
              ) : bankQuestions.length === 0 ? (
                <p className="text-[11px] text-slate-400">Nothing saved for this subject yet. Use “Bank” on a question to add it.</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {bankQuestions.map(bq => (
                    <button
                      key={bq.id}
                      type="button"
                      onClick={() => addFromBank(bq)}
                      className="w-full text-left rounded-lg border border-slate-200 px-2.5 py-2 hover:border-indigo-300 hover:bg-indigo-50/40"
                    >
                      <span className="text-[10px] font-semibold text-slate-400">{QUESTION_TYPE_LABEL[bq.type]} · {bq.points} pt</span>
                      <span className="block text-[11px] text-slate-700 truncate">{bq.prompt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
            <p className="text-[11px] text-indigo-900 leading-relaxed">
              <strong>Files</strong> are stored in Msingi's object storage and opened through an
              access-checked link. <strong>Quiz</strong> answer keys stay on the server — students
              never receive them.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
