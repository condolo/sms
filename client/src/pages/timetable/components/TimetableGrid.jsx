/* ============================================================
   TimetableGrid — period grid, slot cards, break rows
   Props:
     slots    []          — timetable slot documents
     onDelete fn(id)
     onAdd    fn(day, p)
     canEdit  bool
     bell     []          — bell schedule periods (from constants or custom)
   ============================================================ */
import { motion } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import { DAYS, DAY_FULL, DAY_SHORT, DEFAULT_BELL, buildSlotMap, slotColor } from '../constants.js';

/* ── Slot card ───────────────────────────────────────────────── */
function SlotCard({ slot, onDelete, canEdit }) {
  const col = slotColor(slot.subject ?? '');
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      className={`h-full rounded-lg border px-2 py-1.5 group relative ${col.bg} ${col.border}`}
    >
      {canEdit && (
        <button
          onClick={() => onDelete(slot.id ?? slot._id)}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/80 text-slate-400 hover:text-red-500 transition"
        >
          <Trash2 size={10} />
        </button>
      )}
      <p className={`text-[11px] font-semibold leading-tight truncate pr-4 ${col.text}`}>
        {slot.subject || '—'}
      </p>
      {slot.teacherName && (
        <p className={`text-[10px] mt-0.5 truncate ${col.sub} opacity-80`}>{slot.teacherName}</p>
      )}
      {slot.room && (
        <p className={`text-[10px] truncate ${col.sub} opacity-60`}>{slot.room}</p>
      )}
    </motion.div>
  );
}

/* ── Empty cell (add trigger) ────────────────────────────────── */
function EmptyCell({ onAdd, canEdit }) {
  if (!canEdit) return <div className="h-full min-h-[64px]" />;
  return (
    <button
      onClick={onAdd}
      className="w-full h-full min-h-[64px] rounded-lg border border-dashed border-slate-150 flex items-center justify-center opacity-30 hover:opacity-80 hover:border-slate-300 hover:bg-slate-50 transition"
    >
      <Plus size={12} className="text-slate-400" />
    </button>
  );
}

/* ── Break row ───────────────────────────────────────────────── */
function BreakRow({ bell }) {
  return (
    <div className="flex border-b border-slate-100 bg-slate-50/40" style={{ minHeight: '28px' }}>
      <div className="flex items-center px-2 border-r border-slate-100" style={{ width: '88px', minWidth: '88px' }}>
        <span className="text-[9px] text-slate-400">{bell.start}</span>
      </div>
      <div className="flex-1 flex items-center px-3 gap-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">{bell.label}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
    </div>
  );
}

/* ── Period row ──────────────────────────────────────────────── */
function PeriodRow({ bell, slotMap, onDelete, onAdd, canEdit }) {
  return (
    <div className="flex border-b border-slate-100" style={{ minHeight: '72px' }}>
      <div
        className="flex flex-col justify-center px-2 border-r border-slate-100 shrink-0"
        style={{ width: '88px', minWidth: '88px' }}
      >
        <span className="text-[10px] font-bold text-slate-500">P{bell.p}</span>
        <span className="text-[9px] text-slate-400">{bell.start}</span>
        <span className="text-[9px] text-slate-400">–{bell.end}</span>
      </div>
      {DAYS.map((day, i) => {
        const slot   = slotMap[day]?.[bell.p];
        const isLast = i === DAYS.length - 1;
        return (
          <div
            key={day}
            className={`flex-1 p-1.5 ${isLast ? '' : 'border-r border-slate-100'}`}
            style={{ minWidth: 0 }}
          >
            {slot
              ? <SlotCard slot={slot} onDelete={onDelete} canEdit={canEdit} />
              : <EmptyCell onAdd={() => onAdd(day, bell.p)} canEdit={canEdit} />
            }
          </div>
        );
      })}
    </div>
  );
}

/* ── Timetable grid (public export) ─────────────────────────── */
export default function TimetableGrid({ slots, onDelete, onAdd, canEdit, bell = DEFAULT_BELL }) {
  const slotMap = buildSlotMap(slots);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Day header */}
      <div className="flex bg-slate-50 border-b border-slate-200">
        <div className="shrink-0 border-r border-slate-200" style={{ width: '88px', minWidth: '88px' }} />
        {DAYS.map((day, i) => (
          <div
            key={day}
            className={`flex-1 py-2.5 text-center text-xs font-semibold text-slate-700 ${
              i < DAYS.length - 1 ? 'border-r border-slate-200' : ''
            }`}
          >
            <span className="hidden sm:inline">{DAY_FULL[day]}</span>
            <span className="sm:hidden">{DAY_SHORT[day]}</span>
          </div>
        ))}
      </div>

      {/* Period rows */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: '600px' }}>
          {bell.map(b =>
            b.isBreak
              ? <BreakRow key={b.p} bell={b} />
              : (
                <PeriodRow
                  key={b.p}
                  bell={b}
                  slotMap={slotMap}
                  onDelete={onDelete}
                  onAdd={onAdd}
                  canEdit={canEdit}
                />
              )
          )}
        </div>
      </div>
    </div>
  );
}
