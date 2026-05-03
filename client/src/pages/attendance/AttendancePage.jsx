import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { attendance as attendanceApi, classes as classesApi } from '@/api/client.js';
import { PageSpinner, Spinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { Badge } from '@/components/ui/Badge.jsx';

const STATUS_OPTIONS = ['present', 'absent', 'late', 'excused'];
const STATUS_COLORS  = { present: 'success', absent: 'danger', late: 'warning', excused: 'info' };

export default function AttendancePage() {
  const today  = new Date().toISOString().slice(0, 10);
  const [date, setDate]       = useState(today);
  const [classId, setClassId] = useState('');
  const [edits, setEdits]     = useState({});   // { studentId: status }
  const qc = useQueryClient();

  // Classes dropdown
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const classList = classesData?.data ?? [];

  // Attendance records for selected class + date
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['attendance', 'list', { classId, date }],
    queryFn:  () => attendanceApi.list({ classId, date, limit: 100 }),
    enabled:  !!classId,
  });
  const rows = data?.data ?? [];

  // Students in class (for rows not yet recorded)
  const { data: studentsData } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId, { limit: 200, status: 'active' }),
    enabled:  !!classId,
    staleTime: 5 * 60 * 1000,
  });
  const classStudents = studentsData?.data ?? [];

  // Merge: existing records + any students with no record yet
  const recorded = new Set(rows.map((r) => r.studentId));
  const merged   = [
    ...rows,
    ...classStudents.filter((s) => !recorded.has(s._id)).map((s) => ({
      studentId: s._id,
      studentName: `${s.firstName} ${s.lastName}`,
      status: null,
    })),
  ];

  function setStudentStatus(studentId, status) {
    setEdits((e) => ({ ...e, [studentId]: status }));
  }

  // Bulk save
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => {
      const records = merged.map((r) => ({
        studentId: r.studentId,
        classId,
        date,
        status: edits[r.studentId] ?? r.status ?? 'absent',
      }));
      return attendanceApi.bulkMark({ classId, date, records });
    },
    onSuccess: () => {
      setEdits({});
      qc.invalidateQueries({ queryKey: ['attendance'] });
      alert('Attendance saved.');
    },
  });

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Attendance</h2>

      {/* Filters */}
      <div className="card !py-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="form-label">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="form-input" />
        </div>
        <div>
          <label className="form-label">Class</label>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="form-select min-w-[160px]">
            <option value="">Select class…</option>
            {classList.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
        {hasEdits && (
          <button onClick={() => save()} className="btn-primary" disabled={saving}>
            {saving ? <><Spinner size="sm" /> Saving…</> : `Save register (${Object.keys(edits).length} changed)`}
          </button>
        )}
      </div>

      {/* Register */}
      {!classId ? (
        <EmptyState icon="✅" title="Select a class" description="Choose a class above to view or mark attendance." />
      ) : isLoading ? (
        <PageSpinner message="Loading register…" />
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : merged.length === 0 ? (
        <EmptyState icon="👥" title="No students in this class" />
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                {STATUS_OPTIONS.map((s) => (
                  <th key={s} className="text-center capitalize">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => {
                const current = edits[r.studentId] ?? r.status;
                return (
                  <tr key={r.studentId}>
                    <td className="font-medium text-slate-700">{r.studentName}</td>
                    {STATUS_OPTIONS.map((s) => (
                      <td key={s} className="text-center">
                        <input
                          type="radio"
                          name={`att-${r.studentId}`}
                          value={s}
                          checked={current === s}
                          onChange={() => setStudentStatus(r.studentId, s)}
                          className="accent-brand-600 h-4 w-4"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
