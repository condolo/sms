/* ============================================================
   MarkEntryTab — continuous assessment mark entry
   Supports CA / HW / MT / ET with multi-instance CA/HW
   ============================================================ */
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Save, PenLine, BookOpen } from 'lucide-react';
import { assessment as api, classes as classesApi } from '@/api/client.js';
import {
  TERM_NUMBERS, ASSESSMENT_TYPES, TYPE_LABELS,
  _pct, _scoreColor,
} from '../constants.js';
import { Skeleton, Toast, SelField, iCls, TypePill } from './GradesPrimitives.jsx';

export default function MarkEntryTab() {
  const qc = useQueryClient();
  const [classId,        setClassId]        = useState('');
  const [subjectId,      setSubjectId]      = useState('');
  const [termNumber,     setTermNumber]      = useState('');
  const [assessmentType, setAssessmentType]  = useState('');
  const [instance,       setInstance]        = useState('1');
  const [scores,         setScores]          = useState({});
  const [toast,          setToast]           = useState(null);

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classesList = classesData?.data ?? [];

  const { data: configData } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
    staleTime: 5 * 60_000,
  });
  const cfg       = configData?.data ?? {};
  const instances = cfg.instances ?? { CA: 2, HW: 2 };
  const maxInst   = assessmentType === 'CA' ? (instances.CA ?? 2)
                  : assessmentType === 'HW' ? (instances.HW ?? 2)
                  : 1;

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const students = studentsData?.data ?? [];

  const canQuery = !!(classId && subjectId && termNumber && assessmentType);
  const { data: existingData } = useQuery({
    queryKey: ['assessment', 'marks', { classId, subjectId, termNumber, assessmentType, instance }],
    queryFn:  () => api.getMarks({ classId, subjectId, termNumber: Number(termNumber), assessmentType }),
    enabled:  canQuery,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!existingData) return;
    const map = {};
    for (const m of (existingData?.data ?? [])) {
      if (String(m.instance) === String(instance)) {
        map[m.studentId] = m.rawScore;
      }
    }
    setScores(map);
  }, [existingData, instance]);

  const { mutate: submitMarks, isPending: submitting } = useMutation({
    mutationFn: () => api.bulkMarks({
      marks: students
        .filter(s => scores[s._id ?? s.id] != null)
        .map(s => ({
          studentId:      s._id ?? s.id,
          subjectId,
          classId,
          termNumber:     Number(termNumber),
          assessmentType,
          instance:       Number(instance),
          rawScore:       Number(scores[s._id ?? s.id]),
        })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'marks'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setToast({ msg: 'Marks saved successfully.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save marks.', type: 'error' }),
  });

  const vals  = useMemo(() => Object.values(scores).filter(v => v != null).map(Number), [scores]);
  const avg   = vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : null;
  const pass  = vals.filter(v => v >= 50).length;
  const ready = canQuery && students.length > 0;

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Select Assessment</p>
        <div className="flex flex-wrap gap-3">
          <SelField label="Class" value={classId} onChange={setClassId}
            options={classesList.map(c => ({ value: c._id ?? c.id, label: c.name }))} placeholder="Select class" />
          <div className="flex flex-col gap-1.5 min-w-[160px]">
            <label className="text-xs font-medium text-slate-600">Subject</label>
            <input type="text" value={subjectId} onChange={e => setSubjectId(e.target.value)}
              placeholder="e.g. Mathematics" className={iCls()} />
          </div>
          <SelField label="Term" value={termNumber} onChange={setTermNumber}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} placeholder="Select term" />
          <SelField label="Assessment type" value={assessmentType}
            onChange={v => { setAssessmentType(v); setInstance('1'); }}
            options={ASSESSMENT_TYPES.map(t => ({ value: t, label: `${t} — ${TYPE_LABELS[t]}` }))} placeholder="Select type" />
          {maxInst > 1 && (
            <SelField label="Instance" value={instance} onChange={setInstance} placeholder=""
              options={Array.from({ length: maxInst }, (_, i) => ({ value: String(i + 1), label: `${assessmentType} ${i + 1}` }))} />
          )}
        </div>
      </div>

      {!ready ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <PenLine size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-500">Select class, subject, term and assessment type above</p>
        </div>
      ) : studentsLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <BookOpen size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">No students in this class.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <div>
              <div className="flex items-center gap-2">
                <TypePill type={assessmentType} />
                <span className="text-sm font-semibold text-slate-800">
                  {assessmentType} {maxInst > 1 ? instance : ''} — {subjectId} — Term {termNumber}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Enter marks out of 100</p>
            </div>
            <button onClick={() => submitMarks()} disabled={submitting || vals.length === 0}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {submitting ? 'Saving…' : 'Save marks'}
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-2.5 w-8">#</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5">Student</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5 hidden sm:table-cell">Adm. No.</th>
                <th className="text-right text-xs font-medium text-slate-500 px-5 py-2.5 w-32">Score /100</th>
                <th className="text-right text-xs font-medium text-slate-500 px-5 py-2.5 w-20 hidden md:table-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s, i) => {
                const sid   = s._id ?? s.id;
                const score = scores[sid];
                return (
                  <tr key={sid} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-2.5 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2.5 font-medium text-slate-800">{s.firstName} {s.lastName}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-400 hidden sm:table-cell">{s.admissionNumber ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      <input type="number" min="0" max="100" step="0.5"
                        value={score ?? ''}
                        onChange={e => {
                          const v = e.target.value === '' ? undefined : Number(e.target.value);
                          setScores(prev => ({ ...prev, [sid]: v }));
                        }}
                        className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition"
                        placeholder="—" />
                    </td>
                    <td className="px-5 py-2.5 text-right hidden md:table-cell">
                      {score == null ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : score >= 50 ? (
                        <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded border bg-emerald-50 text-emerald-700 border-emerald-200">Pass</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded border bg-red-50 text-red-600 border-red-200">Fail</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {vals.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
              <span>Entered: <strong className="text-slate-700">{vals.length}/{students.length}</strong></span>
              <span>Avg: <strong className={_scoreColor(avg)}>{_pct(avg)}</strong></span>
              <span>Pass rate: <strong className="text-slate-700">{Math.round((pass / vals.length) * 100)}%</strong></span>
              <span>Highest: <strong className="text-emerald-600">{Math.max(...vals)}%</strong></span>
              <span>Lowest: <strong className="text-red-500">{Math.min(...vals)}%</strong></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
