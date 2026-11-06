/**
 * Student Portal → one assignment
 *
 * Full-page answer experience: written answers, file uploads and quiz
 * questions (single/multi choice, short/long text, file). The timer is
 * server-authoritative; this page only counts down to the server's
 * expiresAt. MCQ answers are marked on submit; written/file answers wait
 * for the teacher.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Loader2, Send, Timer,
} from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import { assignments as api } from '@/api/client.js';
import FileAnswer from '@/components/assignments/FileAnswer.jsx';

const isMcq = (q) => q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI';

function formatRemaining(ms) {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function StudentAssignmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.session?.user);
  const started = useRef(false);

  const [answers, setAnswers] = useState({});
  const [textAnswer, setTextAnswer] = useState('');
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

  const query = useQuery({
    queryKey: ['student', 'assignment', id],
    queryFn: () => api.get(id),
    enabled: !!user,
  });
  const assignment = query.data?.data?.assignment;
  const submission = query.data?.data?.submission;
  const attempt = query.data?.data?.attempt;

  // Start the server clock the first time a timed quiz is opened.
  useEffect(() => {
    if (!assignment?.timeLimitMinutes || started.current) return;
    if (submission?.status && submission.status !== 'ASSIGNED') return;
    started.current = true;
    api.start(id).then(() => query.refetch()).catch(() => {});
  }, [assignment?.timeLimitMinutes, id, submission?.status, query]);

  useEffect(() => {
    if (!assignment?.timeLimitMinutes) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [assignment?.timeLimitMinutes]);

  useEffect(() => {
    const seeded = {};
    for (const a of submission?.answers || []) {
      seeded[a.questionId] = {
        selectedOptionIds: a.selectedOptionIds || [],
        textAnswer: a.textAnswer || '',
        attachmentIds: a.attachmentIds || [],
      };
    }
    setAnswers(seeded);
    setTextAnswer(submission?.textAnswer || '');
    setAttachmentIds(submission?.attachmentIds || []);
  }, [submission?.id]);

  const remaining = attempt?.expiresAt ? new Date(attempt.expiresAt).getTime() - now : null;
  const expired = remaining != null && remaining <= 0;
  const graded = submission?.status === 'GRADED' || submission?.status === 'RETURNED';
  const submitted = submission?.status === 'TURNED_IN';
  const questions = useMemo(() => assignment?.questions || [], [assignment]);
  const quiz = questions.length > 0;
  const mode = assignment?.answerMode || (quiz ? 'quiz' : 'written');

  const setAnswer = (qid, patch) => setAnswers(prev => ({
    ...prev,
    [qid]: { selectedOptionIds: [], textAnswer: '', attachmentIds: [], ...(prev[qid] || {}), ...patch },
  }));

  const submit = useMutation({
    mutationFn: () => {
      if (expired) throw new Error('Time is up for this attempt.');
      if (quiz) {
        for (const q of questions) {
          const a = answers[q.id] || {};
          if (q.required !== false) {
            if (isMcq(q) && !(a.selectedOptionIds || []).length) throw new Error(`Answer: ${q.prompt}`);
            if (!isMcq(q) && !(a.textAnswer || '').trim() && !(a.attachmentIds || []).length) {
              throw new Error(`Answer: ${q.prompt}`);
            }
          }
        }
        return api.submit(id, {
          answers: questions.map(q => ({
            questionId: q.id,
            selectedOptionIds: answers[q.id]?.selectedOptionIds || [],
            textAnswer: answers[q.id]?.textAnswer || '',
            attachmentIds: answers[q.id]?.attachmentIds || [],
          })),
        });
      }
      if (mode === 'file' && attachmentIds.length === 0) throw new Error('Attach a file before submitting.');
      if (mode === 'written' && !textAnswer.trim()) throw new Error('Write an answer before submitting.');
      if (mode === 'both' && !textAnswer.trim() && attachmentIds.length === 0) {
        throw new Error('Add an answer or a file before submitting.');
      }
      return api.submit(id, { textAnswer: textAnswer.trim(), attachmentIds });
    },
    onSuccess: () => {
      setToast({ type: 'success', msg: submitted ? 'Submission updated.' : 'Submitted.' });
      void qc.invalidateQueries({ queryKey: ['student', 'assignments'] });
      void query.refetch();
    },
    onError: err => setError(err.message),
  });

  if (query.isLoading) {
    return <div className="min-h-screen bg-slate-50 flex justify-center pt-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>;
  }
  if (query.isError || !assignment) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-2xl mx-auto rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error?.message || 'Assignment not found.'}
        </div>
      </div>
    );
  }

  const iCls = 'w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 resize-none';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => navigate('/student-assignments')}
              className="mt-0.5 text-slate-500 hover:text-slate-800"
              aria-label="Back to assignments"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold text-slate-900 truncate">{assignment.title}</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {[assignment.subjectName, assignment.className].filter(Boolean).join(' · ')}
                {assignment.dueDate ? ` · Due ${assignment.dueDate}${assignment.dueTime ? ` ${assignment.dueTime}` : ''}` : ''}
                {assignment.maxPoints ? ` · ${assignment.maxPoints} points` : ''}
              </p>
            </div>
            {remaining != null && !graded && (
              <span className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                expired ? 'bg-red-50 text-red-700' : remaining < 60_000 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
              }`}>
                <Timer size={12} /> {formatRemaining(remaining)}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-5 space-y-4">
        {toast && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle2 size={15} className="mt-0.5" /> {toast.msg}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {graded && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-900">
              Graded{submission.assignedGrade != null ? ` ${submission.assignedGrade}/${assignment.maxPoints}` : ''}
              {submission.rawScore != null ? ` · ${submission.rawScore}%` : ''}
            </p>
            {submission.feedback && <p className="text-xs text-emerald-800 mt-1">“{submission.feedback}”</p>}
          </div>
        )}
        {submitted && !graded && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
            Submitted{assignment.allowLate ? '' : ' — you can update it until it is graded'}.
          </div>
        )}

        {assignment.description && (
          <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Instructions</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{assignment.description}</p>
          </div>
        )}

        {quiz ? questions.map((q, qi) => {
          const a = answers[q.id] || { selectedOptionIds: [], textAnswer: '', attachmentIds: [] };
          const awarded = submission?.answers?.find(x => x.questionId === q.id)?.awardedPoints;
          return (
            <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="text-slate-400 mr-1">Q{qi + 1}.</span> {q.prompt}
                </p>
                <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                  {awarded != null ? `${awarded}/${q.points}` : `${q.points} pt`}
                </span>
              </div>

              {isMcq(q) && (
                <div className="mt-3 space-y-2">
                  {(q.options || []).map(opt => {
                    const checked = (a.selectedOptionIds || []).includes(opt.id);
                    return (
                      <label key={opt.id} className={`flex items-center gap-2.5 text-sm rounded-xl border px-3 py-2.5 cursor-pointer ${
                        checked ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-700'
                      } ${graded || expired ? 'opacity-70 cursor-not-allowed' : ''}`}>
                        <input
                          type={q.type === 'MCQ_SINGLE' ? 'radio' : 'checkbox'}
                          name={`q_${q.id}`}
                          checked={checked}
                          disabled={graded || expired}
                          onChange={() => {
                            if (q.type === 'MCQ_SINGLE') setAnswer(q.id, { selectedOptionIds: [opt.id] });
                            else {
                              setAnswer(q.id, {
                                selectedOptionIds: checked
                                  ? a.selectedOptionIds.filter(x => x !== opt.id)
                                  : [...(a.selectedOptionIds || []), opt.id],
                              });
                            }
                          }}
                          className="accent-indigo-600"
                        />
                        {opt.text}
                      </label>
                    );
                  })}
                </div>
              )}

              {!isMcq(q) && q.type !== 'FILE' && (
                <textarea
                  value={a.textAnswer || ''}
                  onChange={e => setAnswer(q.id, { textAnswer: e.target.value })}
                  disabled={graded || expired}
                  rows={q.type === 'LONG_TEXT' ? 6 : 3}
                  placeholder="Your answer…"
                  className={`${iCls} mt-3`}
                />
              )}

              {q.type === 'FILE' && (
                <div className="mt-3">
                  <FileAnswer
                    assignmentId={id}
                    value={a.attachmentIds || []}
                    onChange={ids => setAnswer(q.id, { attachmentIds: ids })}
                    compact
                  />
                </div>
              )}
            </div>
          );
        }) : (
          <>
            {(mode === 'written' || mode === 'both') && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Your answer</label>
                <textarea
                  value={textAnswer}
                  onChange={e => setTextAnswer(e.target.value)}
                  disabled={graded || expired}
                  rows={8}
                  placeholder="Type your answer here…"
                  className={iCls}
                />
              </div>
            )}
            {(mode === 'file' || mode === 'both') && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Attachments</label>
                <FileAnswer assignmentId={id} value={attachmentIds} onChange={setAttachmentIds} />
              </div>
            )}
          </>
        )}

        {expired && !graded && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            Time is up for this attempt. Ask your teacher if you still need to submit.
          </div>
        )}

        <div className="h-24" />
      </main>

      {!graded && (
        <footer className="sticky bottom-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <p className="text-[11px] text-slate-400 flex-1">
              {assignment.timeLimitMinutes
                ? `Timed attempt · ${assignment.timeLimitMinutes} min`
                : assignment.dueDate
                  ? `Due ${assignment.dueDate}${assignment.dueTime ? ` ${assignment.dueTime}` : ''}`
                  : 'No deadline'}
            </p>
            <button
              type="button"
              disabled={submit.isPending || expired}
              onClick={() => { setError(null); submit.mutate(); }}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
            >
              {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {submitted ? 'Update submission' : 'Submit'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
