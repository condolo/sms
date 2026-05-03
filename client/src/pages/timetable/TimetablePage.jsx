import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { timetable as timetableApi, classes as classesApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export default function TimetablePage() {
  const [classId, setClassId] = useState('');

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const classList = classesData?.data ?? [];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['timetable', 'class', classId],
    queryFn:  () => timetableApi.byClass(classId),
    enabled:  !!classId,
  });

  // Group by day
  const byDay = {};
  (data?.data ?? []).forEach((slot) => {
    if (!byDay[slot.day]) byDay[slot.day] = [];
    byDay[slot.day].push(slot);
  });
  DAYS.forEach((d) => { if (!byDay[d]) byDay[d] = []; });

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Timetable</h2>

      <div className="card !py-3 flex gap-3 items-center">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="form-select max-w-xs">
          <option value="">Select class…</option>
          {classList.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </div>

      {!classId ? (
        <EmptyState icon="🗓" title="Select a class" description="Choose a class above to view its timetable." />
      ) : isLoading ? (
        <PageSpinner message="Loading timetable…" />
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {DAYS.map((day) => (
            <div key={day} className="card">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 border-b border-surface-border pb-2">{day}</h3>
              {byDay[day].length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No lessons</p>
              ) : (
                <div className="space-y-2">
                  {byDay[day]
                    .sort((a, b) => (a.period ?? 0) - (b.period ?? 0))
                    .map((slot) => (
                      <div key={slot._id} className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2">
                        <p className="text-xs font-semibold text-brand-700">{slot.subject}</p>
                        <p className="text-xs text-slate-500 mt-0.5">P{slot.period} · {slot.teacherName ?? '—'}</p>
                        {slot.room && <p className="text-xs text-slate-400">{slot.room}</p>}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
