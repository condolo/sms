/* ============================================================
   TimeBandGrid — a grid whose rows are the clock times its lessons use.
   Used for the teacher view. Each row is a time band, so a lesson shows at
   the time it actually runs, whichever class's schedule it came from.
   Props:
     slots       []        — the lessons to show
     renderEntry fn(slot)  — what one lesson looks like in its cell
   ============================================================ */
import { DAYS, DAY_FULL, DAY_SHORT, UNTIMED_BAND, timeBandsFromSlots, buildBandMap } from '../constants.js';

export default function TimeBandGrid({ slots = [], renderEntry }) {
  const bands = timeBandsFromSlots(slots);
  const map   = buildBandMap(slots);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex bg-slate-50 border-b border-slate-200">
        <div className="shrink-0 border-r border-slate-200" style={{ width: '88px', minWidth: '88px' }} />
        {DAYS.map((day, i) => (
          <div key={day} className={`flex-1 py-2.5 text-center text-xs font-semibold text-slate-700 ${i < DAYS.length - 1 ? 'border-r border-slate-200' : ''}`}>
            <span className="hidden sm:inline">{DAY_FULL[day]}</span>
            <span className="sm:hidden">{DAY_SHORT[day]}</span>
          </div>
        ))}
      </div>

      {bands.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">No lessons to show.</p>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: '600px' }}>
            {bands.map(b => (
              <div key={b.key} className="flex border-b border-slate-100" style={{ minHeight: '72px' }}>
                <div className="flex flex-col justify-center px-2 border-r border-slate-100 shrink-0" style={{ width: '88px', minWidth: '88px' }}>
                  {b.key === UNTIMED_BAND
                    ? <span className="text-[10px] font-semibold text-amber-700">No time set</span>
                    : <>
                        <span className="text-[10px] font-bold text-slate-500">{b.start}</span>
                        <span className="text-[9px] text-slate-400">–{b.end}</span>
                      </>}
                </div>
                {DAYS.map((day, i) => {
                  const entries = map[day]?.[b.key] ?? [];
                  return (
                    <div key={day} className={`flex-1 p-1.5 space-y-1 ${i < DAYS.length - 1 ? 'border-r border-slate-100' : ''}`} style={{ minWidth: 0 }}>
                      {entries.length === 0
                        ? <div className="h-full min-h-[64px]" />
                        : entries.map(s => <div key={s.id ?? s._id}>{renderEntry(s)}</div>)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
