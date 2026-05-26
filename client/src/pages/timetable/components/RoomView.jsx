/* ============================================================
   RoomView — room occupancy timetable grid
   Mirrors the "Classrooms PDF" — shows Subject · Teacher · Class
   per cell, with room conflicts highlighted.

   Props:
     slots   []          — ALL active timetable slots (school-wide)
     rooms   []          — room registry from /api/rooms
     bell    []          — bell schedule periods
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
function RoomCell({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="h-full min-h-[68px]" />;
  }

  const isConflict = entries.length > 1;

  return (
    <div className="h-full min-h-[68px] space-y-1">
      {entries.map((s, i) => {
        const col = slotColor(s.subject ?? '');
        return (
          <div
            key={i}
            className={`rounded-md border px-2 py-1 ${
              isConflict
                ? 'bg-red-50 border-red-300'
                : `${col.bg} ${col.border}`
            }`}
          >
            {isConflict && i === 0 && (
              <div className="flex items-center gap-1 mb-0.5">
                <AlertTriangle size={9} className="text-red-500 shrink-0" />
                <span className="text-[9px] font-semibold text-red-600">Double-booked</span>
              </div>
            )}
            <p className={`text-[11px] font-semibold leading-tight truncate ${isConflict ? 'text-red-800' : col.text}`}>
              {s.subject || '—'}
            </p>
            {s.teacherName && (
              <p className={`text-[10px] truncate ${isConflict ? 'text-red-600' : col.sub} opacity-80`}>
                {s.teacherName}
              </p>
            )}
            {s.className && (
              <p className={`text-[10px] truncate ${isConflict ? 'text-red-500' : col.sub} opacity-60`}>
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
function RoomGrid({ roomName, slotMap, bell }) {
  const periodBells = bell.filter(b => !b.isBreak);
  const conflictCount = periodBells.reduce((acc, b) => {
    DAYS.forEach(day => {
      const entries = slotMap[roomName]?.[day]?.[String(b.p)];
      if (entries && entries.length > 1) acc++;
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
                      <RoomCell entries={entries} />
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
export default function RoomView({ slots = [], rooms = [], bell = DEFAULT_BELL }) {
  const [selectedRoom, setSelectedRoom] = useState('');

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
          />
        </motion.div>
      )}
    </div>
  );
}
