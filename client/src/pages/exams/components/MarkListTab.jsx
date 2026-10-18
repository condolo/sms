/* ============================================================
   MarkListTab — "MarkList" (2026-10-18)

   Raised directly: an exam officer had to open the Markbook one
   subject at a time to see whose marks were still missing for a
   sitting. This shows every subject for a class as columns in one
   table for a given assessment sitting — blank when a student isn't
   enrolled in an elective, MISSING when they are enrolled but no mark
   exists yet.

   Selector bar mirrors MarkbookTab's own (Year → Term → Class → Stream
   → Assessment, + Instance when the type has more than one) so this
   reads as the same feature family, not a separate tool.
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, AlertTriangle } from 'lucide-react';
import {
  classes as classesApi,
  streams as streamsApi,
  assessment as assessmentApi,
} from '@/api/client.js';
import { Skeleton, SelField } from '../../grades/components/GradesPrimitives.jsx';
import { DEFAULT_CUSTOM_TYPES } from '../../grades/constants.js';

const TERM_NUMBERS = [1, 2, 3];

export default function MarkListTab({ years }) {
  const [yearId,     setYearId]     = useState('');
  const [termNumber, setTermNumber] = useState('');
  const [classId,    setClassId]    = useState('');
  const [streamId,   setStreamId]   = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [instance,   setInstance]   = useState(1);

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all-active'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const { data: streamsData } = useQuery({
    queryKey: ['streams', 'by-class', classId],
    queryFn:  () => streamsApi.list({ classId, status: 'active', limit: 50 }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const streamList = classId ? (streamsData?.data ?? []) : [];

  const { data: scheduleData } = useQuery({
    queryKey: ['assessment', 'schedule', yearId],
    queryFn:  () => assessmentApi.getSchedule({ academicYearId: yearId || undefined }),
    staleTime: 5 * 60_000,
  });
  const allSchedule = scheduleData?.data ?? [];
  const filteredSchedule = useMemo(() =>
    termNumber ? allSchedule.filter(s => String(s.termNumber) === termNumber) : allSchedule,
    [allSchedule, termNumber]
  );
  const selectedEntry = filteredSchedule.find(s => s.id === scheduleId);

  const { data: configData } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => assessmentApi.getConfig(),
    staleTime: 10 * 60_000,
  });
  const customTypes = configData?.data?.customTypes ?? DEFAULT_CUSTOM_TYPES;
  const selectedType = customTypes.find(t => t.key === selectedEntry?.assessmentType);
  const instanceCount = selectedType?.instances ?? 1;

  function onClassChange(v) { setClassId(v); setStreamId(''); }
  function onYearChange(v) { setYearId(v); setTermNumber(''); setScheduleId(''); }
  function onTermChange(v) { setTermNumber(v); setScheduleId(''); }
  function onScheduleChange(v) { setScheduleId(v); setInstance(1); }

  const canQuery = !!(classId && termNumber && selectedEntry);

  const { data: markListData, isLoading, isError, error } = useQuery({
    queryKey: ['assessment', 'mark-list', { classId, streamId, termNumber, assessmentType: selectedEntry?.assessmentType, instance, academicYearId: selectedEntry?.academicYearId }],
    queryFn:  () => assessmentApi.markList({
      classId, streamId: streamId || undefined,
      termNumber: Number(termNumber), assessmentType: selectedEntry.assessmentType,
      instance, academicYearId: selectedEntry.academicYearId || undefined,
    }),
    enabled: canQuery,
    staleTime: 15_000,
  });
  const students = markListData?.data?.students ?? [];
  const subjects = markListData?.data?.subjects ?? [];
  const cells    = markListData?.data?.cells ?? {};
  const isWholeSchoolView = markListData?.data?.isWholeSchoolView ?? false;

  const missingCount = useMemo(() => {
    let n = 0;
    for (const stu of students) for (const subj of subjects) {
      if (cells[stu.id]?.[subj.id]?.markState === 'MISSING') n++;
    }
    return n;
  }, [students, subjects, cells]);

  const selCls = 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 transition';

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Mark List — every subject, one table</p>
        <div className="flex flex-wrap gap-3 items-end">
          <SelField
            label="Academic Year"
            value={yearId}
            onChange={onYearChange}
            options={years.map(y => ({ value: y.id ?? y._id, label: y.name ?? y.year }))}
            placeholder="Current year"
          />
          <SelField
            label="Term"
            value={termNumber}
            onChange={onTermChange}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))}
            placeholder="Select term"
          />
          <SelField
            label="Class"
            value={classId}
            onChange={onClassChange}
            options={classList.map(c => ({ value: c.id ?? c._id, label: c.name }))}
            placeholder="Select class"
          />
          <SelField
            label="Stream"
            value={streamId}
            onChange={setStreamId}
            options={streamList.map(st => ({ value: st.id ?? st._id, label: st.name }))}
            placeholder={classId ? 'All streams' : 'Select a class first'}
            disabled={!classId || streamList.length === 0}
          />
          <div className="flex flex-col gap-1.5 min-w-[200px]">
            <label className="text-xs font-medium text-slate-600">Assessment</label>
            <select value={scheduleId} onChange={e => onScheduleChange(e.target.value)} className={selCls}>
              <option value="">Select assessment…</option>
              {filteredSchedule.map(s => (
                <option key={s.id} value={s.id}>{s.label || s.assessmentType}</option>
              ))}
            </select>
          </div>
          {instanceCount > 1 && (
            <SelField
              label="Instance"
              value={String(instance)}
              onChange={v => setInstance(Number(v))}
              options={Array.from({ length: instanceCount }, (_, i) => ({ value: String(i + 1), label: `${selectedEntry.assessmentType} ${i + 1}` }))}
            />
          )}
        </div>
      </div>

      {!canQuery ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center gap-2">
          <ListChecks size={28} className="text-slate-300" />
          <p className="text-sm text-slate-500">Select a class, term and assessment above</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-10 animate-pulse" />)}</div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load the mark list.'}</p>
        </div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <ListChecks size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">No active students in this class/stream.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <p className="text-xs text-slate-500">
              {students.length} student{students.length !== 1 ? 's' : ''} · {subjects.length} subject{subjects.length !== 1 ? 's' : ''}
              {!isWholeSchoolView && ' · showing only subjects you teach'}
            </p>
            {missingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                <AlertTriangle size={11} /> {missingCount} missing mark{missingCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-wide sticky left-0 bg-slate-800 min-w-[160px]">Student</th>
                  {subjects.map(s => (
                    <th key={s.id} className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center whitespace-nowrap min-w-[52px]" title={s.name}>
                      {s.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map(stu => (
                  <tr key={stu.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="px-3 py-2 font-semibold text-slate-800 sticky left-0 bg-white whitespace-nowrap">
                      {stu.name}{stu.admissionNo ? <span className="text-slate-400 font-normal"> · {stu.admissionNo}</span> : ''}
                    </td>
                    {subjects.map(s => {
                      const cell = cells[stu.id]?.[s.id];
                      // Reported directly: "if a student is not enrolled,
                      // it leaves blank" — truly empty, not a dash (which
                      // this session's own report-card work already
                      // established reads as "0 / failed" at a glance).
                      if (!cell) return <td key={s.id} className="px-2 py-2 text-center"></td>;
                      if (cell.markState === 'MISSING') {
                        return <td key={s.id} className="px-2 py-2 text-center font-bold text-red-600 bg-red-50">X</td>;
                      }
                      if (cell.markState !== 'present') {
                        return <td key={s.id} className="px-2 py-2 text-center font-semibold text-amber-600">{cell.markState}</td>;
                      }
                      return <td key={s.id} className="px-2 py-2 text-center text-slate-700">{cell.rawScore}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
