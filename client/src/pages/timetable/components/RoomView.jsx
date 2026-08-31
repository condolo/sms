/* ============================================================
   RoomView — room occupancy timetable grid
   Mirrors the "Classrooms PDF" — shows Subject · Teacher · Class
   per cell, with room conflicts highlighted.

   Props:
     slots     []        — ALL active timetable slots (school-wide)
     rooms     []        — room registry from /api/rooms
     bell      []        — bell schedule periods (for THIS view's grid
                            layout only — see conflicts note below)
     conflicts []        — GET /timetable/conflicts' own room_double_booked
                            entries. This grid used to decide "conflict"
                            purely by two slots sharing the same period
                            NUMBER — but a room shared across sections
                            (e.g. Primary + Secondary both booking it for
                            their own "Period 1") can have genuinely
                            different clock times for the same period
                            label, since each section runs its own bell
                            schedule. That produced false "double-booked"
                            flags here even when GET /conflicts — which
                            compares each slot's own real startTime/
                            endTime — correctly found no actual overlap.
                            Now sourced from that same, already-correct
                            computation instead of re-deriving a weaker
                            one, so this view can never disagree with the
                            top-level "No conflicts" indicator again.
   ============================================================ */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { DoorOpen, AlertTriangle } from 'lucide-react';
import { DAYS, DAY_FULL, DAY_SHORT, DEFAULT_BELL, slotColor } from '../constants.js';

/* ── Build room-slot map: { [room]: { [day]: { [period]: slot[] } } } ── */
function buildRoomMap(slots) {
  const m = {};
  slots.forEach(s => {
    const room = (s.room || '').trim();
    if (!room) return;
    const day    = (s.day || '').toLowerCase();
    const period = String(s.period);
    if (!m[room])         m[room]         = {};
    if (!m[room][day])    m[room][day]    = {};
    if (!m[room][day][period]) m[room][day][period] = [];
    m[room][day][period].push(s);
  });
  return m;
}

/* ── Single occupancy cell ───────────────────────────────────── */
function RoomCell({ entries, conflictSlotIds }) {
  if (!entries || entries.length === 0) {
    return <div className="h-full min-h-[68px]" />;
  }

  // A cell can legitimately hold >1 entry without being a real conflict —
  // e.g. two different sections' own "Period 1" sharing this room label
  // but not actually overlapping in clock time. Only flag entries the
  // server's own time-overlap-aware check actually confirmed.
  const slotId = s => s.id ?? String(s._id ?? '');
  const firstConflictIdx = entries.findIndex(s => conflictSlotIds.has(slotId(s)));

  return (
    <div className="h-full min-h-[68px] space-y-1">
      {entries.map((s, i) => {
        const col = slotColor(s.subject ?? '');
        const thisEntryConflicts = conflictSlotIds.has(slotId(s));
        return (
          <div
            key={i}
            className={`rounded-md border px-2 py-1 ${
              thisEntryConflicts
                ? 'bg-red-50 border-red-300'
                : `${col.bg} ${col.border}`
            }`}
          >
            {thisEntryConflicts && i === firstConflictIdx && (
              <div className="flex items-center gap-1 mb-0.5">
                <AlertTriangle size={9} className="text-red-500 shrink-0" />
                <span className="text-[9px] font-semibold text-red-600">Double-booked</span>
              </div>
            )}
            <p className={`text-[11px] font-semibold leading-tight truncate ${thisEntryConflicts ? 'text-red-800' : col.text}`}>
              {s.subject || '—'}
            </p>
            {s.teacherName && (
              <p className={`text-[10px] truncate ${thisEntryConflicts ? 'text-red-600' : col.sub} opacity-80`}>
                {s.teacherName}
              </p>
            )}
            {s.className && (
              <p className={`text-[10px] truncate ${thisEntryConflicts ? 'text-red-500' : col.sub} opacity-60`}>
                {s.className}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Room grid for one room ──────────────────────────────────── */
function RoomGrid({ roomName, slotMap, bell, conflictSlotIds }) {
  // Count grid cells that actually contain a server-confirmed conflict —
  // matches exactly what the grid below highlights in red, so the badge
  // and the grid can never tell a different story from each other.
  const conflictCount = Object.values(slotMap[roomName] ?? {}).reduce((acc, dayEntries) => {
    Object.values(dayEntries).forEach(entries => {
      if (entries.some(s => conflictSlotIds.has(s.id ?? String(s._id ?? '')))) acc++;
    });
    return acc;
  }, 0);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Room header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <DoorOpen size={14} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-800">{roomName}</span>
        </div>
        {conflictCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            <AlertTriangle size={10} />
            {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Day header row */}
      <div className="flex bg-slate-50 border-b border-slate-200">
        <div className="shrink-0 border-r border-slate-200" style={{ width: '80px', minWidth: '80px' }} />
        {DAYS.map((day, i) => (
          <div
            key={day}
            className={`flex-1 py-2 text-center text-xs font-semibold text-slate-600 ${i < DAYS.length - 1 ? 'border-r border-slate-200' : ''}`}
          >
            <span className="hidden sm:inline">{DAY_FULL[day]}</span>
            <span className="sm:hidden">{DAY_SHORT[day]}</span>
          </div>
        ))}
      </div>

      {/* Period rows */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: '540px' }}>
          {bell.map(b => {
            if (b.isBreak) {
              return (
                <div key={b.p} className="flex border-b border-slate-100 bg-slate-50/40" style={{ minHeight: '26px' }}>
                  <div className="flex items-center px-2 border-r border-slate-100" style={{ width: '80px', minWidth: '80px' }}>
                    <span className="text-[9px] text-slate-400">{b.start}</span>
                  </div>
                  <div className="flex-1 flex items-center px-3 gap-2">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">{b.label}</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                </div>
              );
            }
            return (
              <div key={b.p} className="flex border-b border-slate-100" style={{ minHeight: '72px' }}>
                <div
                  className="flex flex-col justify-center px-2 border-r border-slate-100 shrink-0"
                  style={{ width: '80px', minWidth: '80px' }}
                >
                  <span className="text-[10px] font-bold text-slate-500">P{b.p}</span>
                  <span className="text-[9px] text-slate-400">{b.start}</span>
                  <span className="text-[9px] text-slate-400">–{b.end}</span>
                </div>
                {DAYS.map((day, i) => {
                  const entries = slotMap[roomName]?.[day]?.[String(b.p)];
                  return (
                    <div
                      key={day}
                      className={`flex-1 p-1.5 ${i < DAYS.length - 1 ? 'border-r border-slate-100' : ''}`}
                      style={{ minWidth: 0 }}
                    >
                      <RoomCell entries={entries} conflictSlotIds={conflictSlotIds} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────── */
export default function RoomView({ slots = [], rooms = [], bell = DEFAULT_BELL, conflicts = [] }) {
  const [selectedRoom, setSelectedRoom] = useState('');

  // Slot ids GET /timetable/conflicts already confirmed are a genuine
  // room double-booking (real clock-time overlap, not just a shared
  // period label) — same room-name normalization (lowercase + trim) that
  // route uses, so this can't drift from what it actually matched.
  const conflictSlotIds = new Set(
    conflicts
      .filter(c => c.type === 'room_double_booked' && (c.room || '').toLowerCase().trim() === selectedRoom.toLowerCase().trim())
      .flatMap(c => c.slotIds ?? []),
  );

  /* Build set of room names that actually appear in slots */
  const usedRoomNames = new Set(
    slots.map(s => (s.room || '').trim()).filter(Boolean),
  );

  /* Merge: registered rooms + any ad-hoc rooms used in slots */
  const registeredNames = new Set(rooms.map(r => r.name));
  const allRoomNames = [
    ...rooms.map(r => r.name),                                          // registered first
    ...[...usedRoomNames].filter(n => !registeredNames.has(n)).sort(), // then unregistered
  ];

  const slotMap = buildRoomMap(slots);

  return (
    <div className="space-y-4">
      {/* Room selector */}
      <div className="flex items-center gap-3">
        <DoorOpen size={14} className="text-slate-400 shrink-0" />
        <select
          value={selectedRoom}
          onChange={e => setSelectedRoom(e.target.value)}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700 max-w-xs"
        >
          <option value="">Select a room…</option>
          {allRoomNames.map(name => (
            <option key={name} value={name}>
              {name}
              {!registeredNames.has(name) ? ' (unregistered)' : ''}
            </option>
          ))}
        </select>
        {selectedRoom && (
          <span className="text-xs text-slate-400">
            {Object.values(slotMap[selectedRoom] ?? {})
              .flatMap(d => Object.values(d))
              .flat().length} slot(s) this week
          </span>
        )}
      </div>

      {/* Grid or empty state */}
      {!selectedRoom ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 flex flex-col items-center gap-3">
          <DoorOpen size={28} className="text-slate-200" />
          <p className="text-sm font-medium text-slate-400">Select a room above to view its weekly schedule</p>
          {allRoomNames.length === 0 && (
            <p className="text-xs text-slate-400">No rooms have been added yet — go to the Rooms tab to register them</p>
          )}
        </div>
      ) : (
        <motion.div
          key={selectedRoom}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <RoomGrid
            roomName={selectedRoom}
            slotMap={slotMap}
            bell={bell}
            conflictSlotIds={conflictSlotIds}
          />
        </motion.div>
      )}
    </div>
  );
}
