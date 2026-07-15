/* ============================================================
   KanbanBoard — board + column + applicant card
   ============================================================ */
import { motion } from 'framer-motion';
import { Calendar, ArrowRight } from 'lucide-react';
import { avatarColor, initials, formatDate, PRIORITY_CONFIG, applicantClassLabel } from '../constants.js';
import { CardSkeleton, EmptyCol } from './AdmissionsPrimitives.jsx';

/* ── Applicant card ───────────────────────────────────────── */
function ApplicantCard({ applicant, col, onClick, onStageClick }) {
  const a   = applicant;
  const pri = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.normal;
  const av  = avatarColor(`${a.firstName}${a.lastName}`);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
    >
      <div className="p-4">
        {/* Top row: avatar + name + priority */}
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
            {initials(a.firstName, a.lastName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {a.firstName} {a.lastName}
            </p>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {applicantClassLabel(a) || 'No class specified'}
              {a.applyingForStreamName && ` · ${a.applyingForStreamName}`}
            </p>
          </div>
          {a.priority === 'high' && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${pri.cls}`}>
              HIGH
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Calendar size={10} />
            {formatDate(a.createdAt)}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onStageClick(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-0.5"
          >
            Move <ArrowRight size={10} />
          </button>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div className={`h-0.5 ${col.color} rounded-b-xl opacity-60`} />
    </motion.div>
  );
}

/* ── Kanban column ────────────────────────────────────────── */
function KanbanColumn({ col, onCardClick, onStageClick }) {
  return (
    <div className="flex-shrink-0 w-72 flex flex-col">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${col.dot}`} />
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{col.label}</span>
          <span className="text-xs text-slate-400 font-medium bg-slate-100 rounded-full px-1.5 py-0.5">
            {col.isLoading ? '…' : col.items.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2.5">
        {col.isLoading
          ? [1, 2, 3].map(i => <CardSkeleton key={i} />)
          : col.items.length === 0
            ? <EmptyCol label={col.label} />
            : col.items.map(item => (
                <ApplicantCard
                  key={item.id ?? item._id}
                  applicant={item}
                  col={col}
                  onClick={() => onCardClick(item)}
                  onStageClick={() => onStageClick(item)}
                />
              ))
        }
      </div>
    </div>
  );
}

/* ── Kanban board ─────────────────────────────────────────── */
export default function KanbanBoard({ cols, onCardClick, onStageClick }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-6" style={{ minHeight: 'calc(100vh - 260px)' }}>
      {cols.map(col => (
        <KanbanColumn key={col.id} col={col} onCardClick={onCardClick} onStageClick={onStageClick} />
      ))}
    </div>
  );
}
