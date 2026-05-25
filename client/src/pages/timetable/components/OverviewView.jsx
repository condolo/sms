/* ============================================================
   OverviewView — institution-wide slot count table
   Props: classList []  — all class documents
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { timetable as ttApi } from '@/api/client.js';
import { DAYS, DAY_SHORT } from '../constants.js';

export default function OverviewView({ classList }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timetable', 'overview'],
    queryFn:  () => ttApi.overview(),
    staleTime: 60_000,
  });
  const overviewClasses = data?.data?.classes ?? [];
  const totalSlots      = data?.data?.totalSlots ?? 0;

  const classMap = {};
  classList.forEach(c => { classMap[c._id ?? c.id] = c.name; });

  const rows = overviewClasses
    .map(oc => ({
      classId: oc.classId,
      name:    classMap[oc.classId] ?? oc.classId,
      total:   oc.total,
      byDay:   oc.byDay,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 animate-pulse space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded" />)}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">All Classes</span>
        <span className="text-xs text-slate-400">{totalSlots} total lesson slots</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Class</th>
              {DAYS.map(d => (
                <th key={d} className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">
                  {DAY_SHORT[d]}
                </th>
              ))}
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-sm text-slate-400">
                  No timetable data yet.
                </td>
              </tr>
            ) : rows.map(row => (
              <tr key={row.classId} className="hover:bg-slate-50/50 transition">
                <td className="px-4 py-2.5 text-xs font-medium text-slate-800">{row.name}</td>
                {DAYS.map(d => (
                  <td key={d} className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-medium ${
                      (row.byDay[d] ?? 0) === 0 ? 'text-slate-300' : 'text-slate-700'
                    }`}>
                      {row.byDay[d] ?? 0}
                    </span>
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center">
                  <span className="text-xs font-semibold text-slate-900">{row.total}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
