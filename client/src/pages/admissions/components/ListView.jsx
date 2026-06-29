/* ============================================================
   ListView — flat table fallback for the admissions pipeline
   ============================================================ */
import { ChevronRight } from 'lucide-react';
import { avatarColor, initials, formatDate, PRIORITY_CONFIG } from '../constants.js';

export default function ListView({ cols, onCardClick, onStageClick }) {
  const allItems = cols.flatMap(col => col.items.map(i => ({ ...i, _stageMeta: col })));

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Applicant</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Grade</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stage</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Priority</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Applied</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {allItems.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-16 text-center text-sm text-slate-400">
                No applications found
              </td>
            </tr>
          ) : (
            allItems.map(a => {
              const sm  = a._stageMeta;
              const pri = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.normal;
              const av  = avatarColor(`${a.firstName}${a.lastName}`);
              return (
                <tr
                  key={a.id ?? a._id}
                  onClick={() => onCardClick(a)}
                  className="hover:bg-slate-50 cursor-pointer transition-colors group"
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {initials(a.firstName, a.lastName)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{a.firstName} {a.lastName}</p>
                        <p className="text-xs text-slate-400">{a.parentEmail || a.parentPhone || ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 hidden sm:table-cell">
                    <span className="text-slate-600 text-sm">{a.applyingForClass || a.applyingForYear || '—'}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${sm.light}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
                      {sm.label}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 hidden md:table-cell">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${pri.cls}`}>{pri.label}</span>
                  </td>
                  <td className="py-3.5 px-4 hidden lg:table-cell text-xs text-slate-400">
                    {formatDate(a.createdAt)}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      onClick={e => { e.stopPropagation(); onStageClick(a); }}
                      className="opacity-0 group-hover:opacity-100 text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 transition"
                    >
                      Move <ChevronRight size={12} />
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
