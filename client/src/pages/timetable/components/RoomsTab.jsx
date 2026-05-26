/* ============================================================
   RoomsTab — manage the school's room / venue registry
   Props:
     canEdit  bool   — admin / timetabler gate
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DoorOpen, Plus, Pencil, Trash2, Save, X,
  Loader2, AlertTriangle, Building2,
} from 'lucide-react';
import { rooms as roomsApi } from '@/api/client.js';

const ROOM_TYPES = [
  { value: 'classroom', label: 'Classroom'  },
  { value: 'lab',       label: 'Laboratory' },
  { value: 'hall',      label: 'Hall'       },
  { value: 'sports',    label: 'Sports'     },
  { value: 'library',   label: 'Library'    },
  { value: 'other',     label: 'Other'      },
];

const TYPE_COLORS = {
  classroom: 'bg-blue-50 text-blue-700',
  lab:       'bg-emerald-50 text-emerald-700',
  hall:      'bg-violet-50 text-violet-700',
  sports:    'bg-amber-50 text-amber-700',
  library:   'bg-rose-50 text-rose-700',
  other:     'bg-slate-100 text-slate-600',
};

const EMPTY_FORM = { name: '', code: '', type: 'classroom', capacity: '', notes: '' };

/* ── Small form component ───────────────────────────────────── */
function RoomForm({ initial = EMPTY_FORM, onSave, onCancel, isPending, serverErr }) {
  const [f, setF] = useState(initial);
  const [errs, setErrs] = useState({});

  function set(k, v) {
    setF(p => ({ ...p, [k]: v }));
    setErrs(e => { const n = { ...e }; delete n[k]; delete n._s; return n; });
  }

  function submit() {
    const e = {};
    if (!f.name.trim()) e.name = 'Room name is required';
    if (Object.keys(e).length) { setErrs(e); return; }
    onSave({
      name:     f.name.trim(),
      code:     f.code.trim() || undefined,
      type:     f.type,
      capacity: f.capacity ? Number(f.capacity) : undefined,
      notes:    f.notes.trim() || undefined,
    });
  }

  const iCls = (err) =>
    `w-full text-sm px-3 py-2 rounded-lg border ${err ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'} focus:outline-none focus:ring-2 focus:ring-slate-900/10`;

  return (
    <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
      {(serverErr || errs._s) && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="shrink-0" />
          {serverErr || errs._s}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Room Name *</label>
          <input
            value={f.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Mathematics 1"
            className={`mt-1 ${iCls(errs.name)}`}
            autoFocus
          />
          {errs.name && <p className="text-[10px] text-red-500 mt-0.5">{errs.name}</p>}
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Code</label>
          <input
            value={f.code}
            onChange={e => set('code', e.target.value)}
            placeholder="e.g. M1, AL-2"
            className={`mt-1 ${iCls()}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Type</label>
          <select value={f.type} onChange={e => set('type', e.target.value)} className={`mt-1 ${iCls()}`}>
            {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Capacity</label>
          <input
            type="number" min="1" max="2000"
            value={f.capacity}
            onChange={e => set('capacity', e.target.value)}
            placeholder="Max students"
            className={`mt-1 ${iCls()}`}
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
        <input
          value={f.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Optional notes…"
          className={`mt-1 ${iCls()}`}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 transition">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={isPending}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition"
        >
          {isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          {isPending ? 'Saving…' : 'Save room'}
        </button>
      </div>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────── */
export default function RoomsTab({ canEdit }) {
  const qc = useQueryClient();
  const [showAdd,   setShowAdd]   = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [serverErr, setServerErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['rooms'],
    queryFn:  () => roomsApi.list(),
    staleTime: 2 * 60_000,
  });
  const roomList = data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['rooms'] });

  const createMut = useMutation({
    mutationFn: roomsApi.create,
    onSuccess:  () => { invalidate(); setShowAdd(false); setServerErr(''); },
    onError:    err => setServerErr(err?.message ?? 'Failed to create room'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => roomsApi.update(id, data),
    onSuccess:  () => { invalidate(); setEditId(null); setServerErr(''); },
    onError:    err => setServerErr(err?.message ?? 'Failed to update room'),
  });

  const removeMut = useMutation({
    mutationFn: roomsApi.remove,
    onSuccess:  invalidate,
    onError:    err => alert(err?.message ?? 'Failed to remove room'),
  });

  function confirmRemove(room) {
    if (!confirm(`Remove room "${room.name}"? This will not delete existing timetable slots that reference it.`)) return;
    removeMut.mutate(room.id);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-slate-400" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Room Registry</p>
            <p className="text-xs text-slate-400">{roomList.length} venue{roomList.length !== 1 ? 's' : ''} configured</p>
          </div>
        </div>
        {canEdit && !showAdd && (
          <button
            onClick={() => { setShowAdd(true); setEditId(null); setServerErr(''); }}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
          >
            <Plus size={12} /> Add room
          </button>
        )}
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          >
            <RoomForm
              onSave={data => createMut.mutate(data)}
              onCancel={() => { setShowAdd(false); setServerErr(''); }}
              isPending={createMut.isPending}
              serverErr={createMut.isPending ? '' : serverErr}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Room list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-white border border-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> Failed to load rooms
        </div>
      ) : roomList.length === 0 && !showAdd ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 flex flex-col items-center gap-3">
          <DoorOpen size={28} className="text-slate-200" />
          <p className="text-sm font-medium text-slate-400">No rooms yet</p>
          {canEdit && (
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs font-medium text-slate-600 underline"
            >
              Add your first room
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-50">
          {roomList.map(room => (
            <div key={room.id} className="group">
              {editId === room.id ? (
                <div className="p-3">
                  <RoomForm
                    initial={{
                      name:     room.name     ?? '',
                      code:     room.code     ?? '',
                      type:     room.type     ?? 'classroom',
                      capacity: room.capacity ?? '',
                      notes:    room.notes    ?? '',
                    }}
                    onSave={data => updateMut.mutate({ id: room.id, data })}
                    onCancel={() => { setEditId(null); setServerErr(''); }}
                    isPending={updateMut.isPending}
                    serverErr={updateMut.isPending ? '' : serverErr}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <DoorOpen size={14} className="text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {room.name}
                      {room.code && <span className="ml-1.5 font-mono text-[11px] text-slate-400">({room.code})</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${TYPE_COLORS[room.type] ?? TYPE_COLORS.other}`}>
                        {room.type}
                      </span>
                      {room.capacity && (
                        <span className="text-[10px] text-slate-400">Cap: {room.capacity}</span>
                      )}
                      {room.notes && (
                        <span className="text-[10px] text-slate-400 truncate hidden sm:block">{room.notes}</span>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                      <button
                        onClick={() => { setEditId(room.id); setShowAdd(false); setServerErr(''); }}
                        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => confirmRemove(room)}
                        disabled={removeMut.isPending}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Double-booking note */}
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Rooms can be double-booked — the timetable will warn but not block. Use the Room View tab to spot conflicts visually.
      </p>
    </div>
  );
}
