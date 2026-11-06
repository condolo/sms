/**
 * eLearning → Assignments → one assignment (teacher workspace)
 *
 * Replaces the old roster modal: full-width KPIs, a submissions table with
 * expandable answers, per-question review, attachments and the Markbook
 * write result. Everything a teacher needs to close an assignment lives on
 * one page.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Award, CheckCircle2, ChevronDown, ChevronRight,
  ClipboardCheck, Clock, FileText, ListChecks, Loader2, Paperclip, Percent,
  RefreshCw, Trash2, Users,
} from 'lucide-react';
import { assignments as api } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

const MODE_LABEL = {
  written: 'Written answer',
  file: 'File upload',
  both: 'Text + file',
  quiz: 'Quiz',
};

const QUESTION_TYPE_LABEL = {
  MCQ_SINGLE: 'Single choice',
  MCQ_MULTI: 'Multiple choice',
  SHORT_TEXT: 'Short answer',
  LONG_TEXT: 'Long answer',
  FILE: 'File upload',
};

function Kpi({ icon: Icon, label, value, sub, tone = 'indigo' }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-500',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className={cls('w-8 h-8 rounded-lg flex items-center justify-center mb-3', tones[tone])}>
        <Icon size={16} />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AssignmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.session?.user);
  const [grades, setGrades] = useState({});
  const [feedback, setFeedback] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState(null);

  const query = useQuery({
    queryKey: ['assignments', id, 'workspace'],
    queryFn: () => api.submissions(id),
  });
  const assignment = query.data?.data?.assignment;
  const rows = query.data?.data?.rows ?? [];

  const exceptionsQuery = useQuery({
    queryKey: ['assignments', 'exceptions', id],
    queryFn: () => api.exceptions({ assignmentId: id }),
    retry: false,
  });
  const exceptions = exceptionsQuery.data?.data?.exceptions ?? [];

  const stats = useMemo(() => {
    const submitted = rows.filter(r => r.submission && r.submission.status !== 'ASSIGNED');
    const graded = rows.filter(r => r.submission?.status === 'GRADED' || r.submission?.status === 'RETURNED');
    const percentages = graded
      .map(r => (r.submission.rawScore != null ? r.submission.rawScore : null))
      .filter(v => v != null);
    return {
      total: rows.length,
      submitted: submitted.length,
      graded: graded.length,
      average: percentages.length
        ? Math.round((percentages.reduce((a, b) => a + b, 0) / percentages.length) * 10) / 10
        : null,
      missing: rows.length - submitted.length,
    };
  }, [rows]);

  const grade = useMutation({
    mutationFn: ({ studentId }) => api.grade(id, {
      studentId,
      assignedGrade: Number(grades[studentId]),
      feedback: feedback[studentId] || '',
    }),
    onSuccess: (res, vars) => {
      const mw = res?.data?.markWrite;
      const who = rows.find(r => r.studentId === vars.studentId)?.name || 'Student';
      const msg = mw?.status === 'WRITTEN'
        ? `${who}: grade saved and written to the Markbook.`
        : mw?.status === 'SKIPPED'
          ? `${who}: grade saved, but not written to the Markbook (${String(mw.reason).replace(/_/g, ' ')}).`
          : `${who}: grade saved on the assignment (no Markbook window linked).`;
      setToast({ type: mw?.status === 'SKIPPED' ? 'error' : 'success', msg });
      qc.invalidateQueries({ queryKey: ['assignments', id, 'workspace'] });
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: err => setToast({ type: 'error', msg: err.message }),
  });

  const remove = useMutation({
    mutationFn: () => api.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments'] });
      navigate('/elearning/assignments');
    },
    onError: err => setToast({ type: 'error', msg: err.message }),
  });

  const isCreator = assignment?.teacherId === user?.id;
  const canDelete = isCreator || ['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy'].includes(user?.role);
  const questionById = useMemo(
    () => Object.fromEntries((assignment?.questions || []).map(q => [q.id, q])),
    [assignment],
  );

  function attachmentLinks(ids = []) {
    return ids.map((attId, i) => (
      <a
        key={attId}
        href={api.attachmentUrl(id, attId)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline mr-3"
      >
        <Paperclip size={11} /> File {i + 1}
      </a>
    ));
  }

  if (query.isLoading) {
    return <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-slate-400" /></div>;
  }
  if (query.isError || !assignment) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error?.message || 'Assignment not found.'}
        </div>
      </div>
    );
  }

  const progress = stats.total ? Math.round((stats.submitted / stats.total) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              onClick={() => navigate('/elearning/assignments')}
              className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              <ArrowLeft size={15} /> Assignments
            </button>
            <div className="h-8 w-px bg-slate-200 hidden sm:block" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 truncate">{assignment.title}</h1>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {MODE_LABEL[assignment.answerMode] || assignment.answerMode || 'Written'}
                </span>
                <span className={cls(
                  'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border',
                  assignment.status === 'PUBLISHED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200',
                )}>
                  {assignment.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {assignment.subjectName || assignment.subjectId} · {assignment.className || assignment.classId}
                {assignment.dueDate ? ` · Due ${assignment.dueDate}${assignment.dueTime ? ` ${assignment.dueTime}` : ''}` : ''}
                {assignment.maxPoints ? ` · ${assignment.maxPoints} points` : ''}
                {assignment.timeLimitMinutes ? ` · ${assignment.timeLimitMinutes} min` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw size={13} /> Refresh
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => { if (window.confirm('Delete this assignment and every submission?')) remove.mutate(); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {toast && (
          <div className={cls(
            'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
            toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800',
          )}>
            {toast.type === 'error' ? <AlertTriangle size={15} className="mt-0.5" /> : <CheckCircle2 size={15} className="mt-0.5" />}
            <span className="flex-1">{toast.msg}</span>
            <button type="button" onClick={() => setToast(null)} className="opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={ClipboardCheck} label="Submitted" value={`${stats.submitted}/${stats.total}`} sub={`${progress}% of the class`} />
          <Kpi icon={Award} label="Graded" value={stats.graded} sub={stats.submitted ? `${stats.submitted - stats.graded} awaiting marking` : 'No submissions yet'} tone="emerald" />
          <Kpi icon={Percent} label="Average" value={stats.average != null ? `${stats.average}%` : '—'} sub={stats.average != null ? 'Of graded work' : 'No marks yet'} tone="amber" />
          <Kpi icon={Users} label="Not submitted" value={stats.missing} sub={stats.missing ? 'Needs a reminder' : 'Everyone is in'} tone="slate" />
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
            <span>Submission progress</span>
            <span className="font-semibold text-slate-700">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {exceptions.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle size={15} className="text-amber-600 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-900">
                {exceptions.length} grade{exceptions.length === 1 ? '' : 's'} could not reach the Markbook
              </p>
              {exceptions.slice(0, 3).map(e => (
                <p key={e.id} className="text-[11px] text-amber-700 mt-0.5">
                  {String(e.kind || '').replace(/_/g, ' ').toLowerCase()} — {e.detail || 'No detail'}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr,320px] gap-5 items-start">
          <main className="bg-white border border-slate-200 rounded-2xl overflow-hidden min-w-0">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Submissions</h2>
                <p className="text-[11px] text-slate-400">Expand a student to see answers, files and feedback.</p>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">{rows.length} students</span>
            </div>

            <div className="divide-y divide-slate-100">
              {rows.map(row => {
                const sub = row.submission;
                const open = expanded === row.studentId;
                const current = grades[row.studentId] ?? (sub?.assignedGrade ?? sub?.autoScore ?? '');
                const graded = sub?.status === 'GRADED' || sub?.status === 'RETURNED';
                const answers = sub?.answers || [];
                return (
                  <div key={row.studentId} className={cls('px-4 sm:px-5 py-3', open && 'bg-slate-50/60')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : row.studentId)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white hover:text-slate-700 border border-transparent hover:border-slate-200"
                        aria-label={open ? 'Collapse' : 'Expand'}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{row.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {row.admissionNumber ? `${row.admissionNumber} · ` : ''}
                          {sub?.status === 'TURNED_IN' && `Submitted ${new Date(sub.submittedAt).toLocaleString()}`}
                          {graded && `Graded${sub.rawScore != null ? ` · ${sub.rawScore}%` : ''}`}
                          {(!sub || sub.status === 'ASSIGNED') && 'Not submitted'}
                          {sub?.autoScore != null ? ` · auto ${sub.autoScore}/${sub.autoMaxScore ?? '?'}` : ''}
                          {sub?.markWriteStatus === 'WRITTEN' && ' · in Markbook'}
                          {sub?.markWriteStatus === 'SKIPPED' && ` · not in Markbook (${String(sub.skipReason || '').replace(/_/g, ' ')})`}
                        </p>
                      </div>
                      <span className={cls(
                        'text-[10px] font-bold uppercase px-2 py-1 rounded-full',
                        graded ? 'bg-emerald-50 text-emerald-700'
                          : sub?.status === 'TURNED_IN' ? 'bg-sky-50 text-sky-700'
                            : 'bg-slate-100 text-slate-500',
                      )}>
                        {graded ? 'Graded' : sub?.status === 'TURNED_IN' ? 'Submitted' : 'Not submitted'}
                      </span>
                      {assignment.type !== 'MATERIAL' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" max={assignment.maxPoints || undefined}
                            value={current}
                            onChange={e => setGrades(g => ({ ...g, [row.studentId]: e.target.value }))}
                            placeholder="—"
                            className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          <span className="text-[11px] text-slate-400">/ {assignment.maxPoints}</span>
                          <button
                            type="button"
                            disabled={grade.isPending || current === '' || current == null}
                            onClick={() => grade.mutate({ studentId: row.studentId })}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>

                    {open && (
                      <div className="mt-3 ml-9 space-y-3">
                        {assignment.questions?.length > 0 ? (
                          <div className="space-y-2">
                            {assignment.questions.map((q, qi) => {
                              const ans = answers.find(a => a.questionId === q.id);
                              const selected = new Set(ans?.selectedOptionIds || []);
                              return (
                                <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="text-xs font-semibold text-slate-700">
                                      <span className="text-slate-400 mr-1">Q{qi + 1}.</span> {q.prompt}
                                    </p>
                                    <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                                      {ans?.awardedPoints != null ? `${ans.awardedPoints}/` : ''}{q.points}
                                    </span>
                                  </div>
                                  {['MCQ_SINGLE', 'MCQ_MULTI'].includes(q.type) ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {(q.options || []).map(o => {
                                        const picked = selected.has(o.id);
                                        const correct = (q.correctOptionIds || []).includes(o.id);
                                        return (
                                          <span
                                            key={o.id}
                                            className={cls(
                                              'text-[11px] px-2 py-1 rounded-lg border',
                                              correct && picked ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                                : correct ? 'bg-emerald-50/50 border-emerald-200 text-emerald-700'
                                                  : picked ? 'bg-red-50 border-red-200 text-red-700'
                                                    : 'bg-slate-50 border-slate-200 text-slate-500',
                                            )}
                                          >
                                            {o.text}{correct ? ' ✓' : ''}{picked && !correct ? ' (picked)' : ''}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  ) : ans?.textAnswer ? (
                                    <p className="mt-2 text-xs text-slate-600 whitespace-pre-wrap">{ans.textAnswer}</p>
                                  ) : (
                                    <p className="mt-2 text-xs text-slate-400">No answer.</p>
                                  )}
                                  {ans?.attachmentIds?.length ? <div className="mt-2">{attachmentLinks(ans.attachmentIds)}</div> : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            {sub?.textAnswer ? (
                              <p className="text-xs text-slate-600 whitespace-pre-wrap">{sub.textAnswer}</p>
                            ) : (
                              <p className="text-xs text-slate-400">No written answer.</p>
                            )}
                            {sub?.attachmentIds?.length ? <div className="mt-2">{attachmentLinks(sub.attachmentIds)}</div> : null}
                          </div>
                        )}

                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Feedback</label>
                          <textarea
                            value={feedback[row.studentId] ?? (sub?.feedback || '')}
                            onChange={e => setFeedback(f => ({ ...f, [row.studentId]: e.target.value }))}
                            rows={2}
                            placeholder="Optional note to the student"
                            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-10">No students in this class.</p>
              )}
            </div>
          </main>

          <aside className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Details</h2>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-2"><dt className="text-slate-400">Mode</dt><dd className="font-medium text-slate-700 text-right">{MODE_LABEL[assignment.answerMode] || assignment.answerMode || 'Written'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-400">Points</dt><dd className="font-medium text-slate-700 text-right">{assignment.maxPoints ?? '—'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-400">Due</dt><dd className="font-medium text-slate-700 text-right">{assignment.dueDate || 'No date'}{assignment.dueTime ? ` · ${assignment.dueTime}` : ''}</dd></div>
                {assignment.timeLimitMinutes ? <div className="flex justify-between gap-2"><dt className="text-slate-400">Time limit</dt><dd className="font-medium text-slate-700 text-right">{assignment.timeLimitMinutes} min</dd></div> : null}
                <div className="flex justify-between gap-2"><dt className="text-slate-400">Late work</dt><dd className="font-medium text-slate-700 text-right">{assignment.allowLate ? 'Allowed' : 'Blocked'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-400">Markbook</dt><dd className="font-medium text-slate-700 text-right">{assignment.assessmentScheduleId ? 'Linked' : 'Not linked'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-400">Source</dt><dd className="font-medium text-slate-700 text-right">{assignment.source === 'google_classroom' ? 'Classroom' : 'Native'}</dd></div>
              </dl>
              {assignment.description && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Instructions</p>
                  <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{assignment.description}</p>
                </div>
              )}
            </div>

            {assignment.questions?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <ListChecks size={15} className="text-indigo-600" />
                  <h2 className="text-sm font-semibold text-slate-800">Questions</h2>
                </div>
                <div className="space-y-3">
                  {assignment.questions.map((q, qi) => {
                    const correctCount = rows.filter(r =>
                      (r.submission?.answers || []).find(a => a.questionId === q.id)?.awardedPoints === q.points,
                    ).length;
                    return (
                      <div key={q.id} className="border-b border-slate-100 last:border-0 pb-2.5 last:pb-0">
                        <p className="text-[11px] font-semibold text-slate-700">
                          <span className="text-slate-400 mr-1">Q{qi + 1}.</span>{q.prompt}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {QUESTION_TYPE_LABEL[q.type]} · {q.points} pt
                          {['MCQ_SINGLE', 'MCQ_MULTI'].includes(q.type) ? ` · ${correctCount} correct` : ''}
                        </p>
                        {['MCQ_SINGLE', 'MCQ_MULTI'].includes(q.type) && (
                          <p className="text-[10px] text-emerald-700 mt-1">
                            Key: {(q.options || []).filter(o => (q.correctOptionIds || []).includes(o.id)).map(o => o.text).join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-800">Attachments</h2>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Student files appear inside each expanded submission and open through an
                access-checked link. Uploads are limited to 10 MB and five files.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-800">Deadline</h2>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Enforced on the server in the school's timezone. A graded submission cannot be
                resubmitted; reopen-after-grading is the next workflow item.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
