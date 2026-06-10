import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BedDouble, Plus, Search, Users, Home, Trash2, Edit2,
  X, RefreshCw, UserPlus, LogOut,
} from 'lucide-react';
import { hostel as hostelApi } from '@/api/client.js';
import { KpiCard } from '@/components/ui/KpiCard.jsx';

/* ── Role helpers ─────────────────────────────────────────── */
function useRole() {
  try {
    const s = JSON.parse(localStorage.getItem('msingi_session') || '{}');
    return s?.user?.role ?? 'student';
  } catch { return 'student'; }
}
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'hostel_master']);

/* KpiCard — shared themed component (see @/components/ui/KpiCard.jsx) */

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Icon size={40} className="mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/* ── Hostel form modal ────────────────────────────────────── */
function HostelModal({ hostel, onClose, onSave }) {
  const [form, setForm] = useState({
    name:       hostel?.name       ?? '',
    gender:     hostel?.gender     ?? 'mixed',
    type:       hostel?.type       ?? 'boarding',
    capacity:   hostel?.capacity   ?? '',
    warden:     hostel?.warden     ?? '',
    phone:      hostel?.phone      ?? '',
    location:   hostel?.location   ?? '',
    feePerTerm: hostel?.feePerTerm ?? 0,
    notes:      hostel?.notes      ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave({ ...form, capacity: form.capacity ? Number(form.capacity) : null });
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save hostel');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{hostel ? 'Edit Hostel' : 'New Hostel'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Hostel Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gender</label>
              <select value={form.gender} onChange={e => set('gender', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="boarding">Boarding</option>
                <option value="day">Day</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity</label>
              <input type="number" min={1} value={form.capacity} onChange={e => set('capacity', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Warden</label>
              <input value={form.warden} onChange={e => set('warden', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Location</label>
            <input value={form.location} onChange={e => set('location', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Fee Per Term (KSh)</label>
            <input type="number" min={0} value={form.feePerTerm} onChange={e => set('feePerTerm', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Hostel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Room form modal ──────────────────────────────────────── */
function RoomModal({ room, hostels, onClose, onSave }) {
  const [form, setForm] = useState({
    hostelId:   room?.hostelId   ?? (hostels[0]?.id ?? hostels[0]?._id ?? ''),
    roomNumber: room?.roomNumber ?? '',
    floor:      room?.floor      ?? '',
    type:       room?.type       ?? 'dormitory',
    capacity:   room?.capacity   ?? 1,
    gender:     room?.gender     ?? 'mixed',
    notes:      room?.notes      ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try { await onSave(form); onClose(); }
    catch (err) { setError(err.message ?? 'Failed to save room'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{room ? 'Edit Room' : 'Add Room'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Hostel *</label>
            <select value={form.hostelId} onChange={e => set('hostelId', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              {hostels.map(h => <option key={h.id ?? h._id} value={h.id ?? h._id}>{h.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room Number *</label>
              <input value={form.roomNumber} onChange={e => set('roomNumber', e.target.value)} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Floor / Block</label>
              <input value={form.floor} onChange={e => set('floor', e.target.value)} placeholder="e.g. Ground, 1st"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="dormitory">Dormitory</option>
                <option value="private">Private</option>
                <option value="semi-private">Semi-private</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity *</label>
              <input type="number" min={1} value={form.capacity} onChange={e => set('capacity', e.target.value)} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gender</label>
              <select value={form.gender} onChange={e => set('gender', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Assign modal ─────────────────────────────────────────── */
function AssignModal({ hostels, rooms, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    hostelId: hostels[0]?.id ?? hostels[0]?._id ?? '',
    roomId: '', studentId: '', studentName: '',
    studentClass: '', bedNumber: '', startDate: today,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const filteredRooms = rooms.filter(r => r.hostelId === form.hostelId);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try { await onSave(form); onClose(); }
    catch (err) { setError(err.message ?? 'Failed to assign student'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Assign Student to Room</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Hostel *</label>
              <select value={form.hostelId} onChange={e => { set('hostelId', e.target.value); set('roomId', ''); }} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="">Select…</option>
                {hostels.map(h => <option key={h.id ?? h._id} value={h.id ?? h._id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room *</label>
              <select value={form.roomId} onChange={e => set('roomId', e.target.value)} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="">Select…</option>
                {filteredRooms.map(r => (
                  <option key={r.id ?? r._id} value={r.id ?? r._id}>
                    {r.roomNumber} ({r.occupied ?? 0}/{r.capacity})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Student ID *</label>
            <input value={form.studentId} onChange={e => set('studentId', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Name</label>
              <input value={form.studentName} onChange={e => set('studentName', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class</label>
              <input value={form.studentClass} onChange={e => set('studentClass', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Bed Number</label>
              <input value={form.bedNumber} onChange={e => set('bedNumber', e.target.value)} placeholder="e.g. B1, Top"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Start Date</label>
              <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
              {saving ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function HostelPage() {
  const qc      = useQueryClient();
  const role    = useRole();
  const canEdit = MANAGE_ROLES.has(role);

  const [tab,          setTab]          = useState('hostels');
  const [hostelModal,  setHostelModal]  = useState(null);
  const [roomModal,    setRoomModal]    = useState(null);
  const [assignModal,  setAssignModal]  = useState(false);
  const [deletingHostel, setDeletingHostel] = useState(null);

  /* ── Queries ─────────────────────────────────────────────── */
  const { data: summaryRaw } = useQuery({
    queryKey: ['hostel-summary'],
    queryFn:  () => hostelApi.summary(),
    staleTime: 60_000,
  });
  const { data: hostelsRaw, isLoading: hostelsLoading } = useQuery({
    queryKey: ['hostel-hostels'],
    queryFn:  () => hostelApi.hostels.list({ limit: 50 }),
    staleTime: 30_000,
  });
  const { data: roomsRaw, isLoading: roomsLoading } = useQuery({
    queryKey: ['hostel-rooms'],
    queryFn:  () => hostelApi.rooms.list({ limit: 200 }),
    staleTime: 30_000,
    enabled:  tab === 'rooms' || tab === 'assignments',
  });
  const { data: assignmentsRaw, isLoading: assignLoading } = useQuery({
    queryKey: ['hostel-assignments'],
    queryFn:  () => hostelApi.assignments.list({ status: 'active', limit: 100 }),
    staleTime: 30_000,
    enabled:  tab === 'assignments',
  });

  const summary     = summaryRaw?.data     ?? summaryRaw  ?? {};
  const hostels     = hostelsRaw?.data     ?? [];
  const rooms       = roomsRaw?.data       ?? [];
  const assignments = assignmentsRaw?.data ?? [];

  /* ── Mutations ───────────────────────────────────────────── */
  const createHostel = useMutation({
    mutationFn: (data) => hostelApi.hostels.create(data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['hostel-hostels'] }); qc.invalidateQueries({ queryKey: ['hostel-summary'] }); },
  });
  const updateHostel = useMutation({
    mutationFn: ({ id, data }) => hostelApi.hostels.update(id, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['hostel-hostels'] }),
  });
  const deleteHostel = useMutation({
    mutationFn: (id) => hostelApi.hostels.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hostel-hostels'] });
      qc.invalidateQueries({ queryKey: ['hostel-summary'] });
      setDeletingHostel(null);
    },
  });
  const createRoom = useMutation({
    mutationFn: (data) => hostelApi.rooms.create(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['hostel-rooms'] }),
  });
  const deleteRoom = useMutation({
    mutationFn: (id) => hostelApi.rooms.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['hostel-rooms'] }),
  });
  const assignStudent = useMutation({
    mutationFn: (data) => hostelApi.assignments.assign(data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hostel-assignments'] });
      qc.invalidateQueries({ queryKey: ['hostel-rooms'] });
      qc.invalidateQueries({ queryKey: ['hostel-summary'] });
    },
  });
  const discharge = useMutation({
    mutationFn: (id) => hostelApi.assignments.discharge(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hostel-assignments'] });
      qc.invalidateQueries({ queryKey: ['hostel-rooms'] });
      qc.invalidateQueries({ queryKey: ['hostel-summary'] });
    },
  });

  async function handleSaveHostel(form) {
    if (hostelModal && hostelModal !== 'new') {
      await updateHostel.mutateAsync({ id: hostelModal.id ?? hostelModal._id, data: form });
    } else {
      await createHostel.mutateAsync(form);
    }
  }

  /* ── Gender badge ────────────────────────────────────────── */
  const genderBadge = (g) => {
    const c = { male: 'bg-blue-100 text-blue-700', female: 'bg-pink-100 text-pink-700', mixed: 'bg-slate-100 text-slate-600' };
    return c[g] ?? 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-xl">
            <BedDouble size={22} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Hostel</h1>
            <p className="text-xs text-slate-500">Boarding facilities &amp; residents</p>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setTab('assignments'); setAssignModal(true); }}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700">
              <UserPlus size={15} /> Assign Student
            </button>
            <button onClick={() => { setTab('rooms'); setRoomModal('new'); }}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700">
              <Home size={15} /> Add Room
            </button>
            <button onClick={() => setHostelModal('new')}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-purple-600 text-white hover:bg-purple-700">
              <Plus size={15} /> New Hostel
            </button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<BedDouble size={18} />} label="Hostels"      value={summary.totalHostels}    colorIndex={0} />
        <KpiCard icon={<Home size={18} />}     label="Total Rooms"  value={summary.totalRooms}      colorIndex={1} />
        <KpiCard icon={<Users size={18} />}    label="Capacity"     value={summary.totalCapacity}   colorIndex={2} />
        <KpiCard icon={<Users size={18} />}    label="Occupied"     value={summary.occupiedBeds}    colorIndex={3} />
        <KpiCard icon={<BedDouble size={18} />} label="Available"   value={summary.availableBeds}   colorIndex={0} />
        <KpiCard icon={<Users size={18} />}    label="Residents"    value={summary.activeResidents} colorIndex={1} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {['hostels', 'rooms', 'assignments'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-lg capitalize transition ${tab === t ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Hostels tab */}
      {tab === 'hostels' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {hostelsLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : hostels.length === 0 ? (
            <EmptyState icon={BedDouble} message="No hostels configured yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Hostel</th>
                    <th className="px-4 py-3 text-center">Gender</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Warden</th>
                    <th className="px-4 py-3 text-center hidden sm:table-cell">Capacity</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Fee/Term</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hostels.map(h => (
                    <tr key={h.id ?? h._id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{h.name}</div>
                        {h.location && <div className="text-xs text-slate-400">{h.location}</div>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${genderBadge(h.gender)}`}>{h.gender}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                        <div>{h.warden || '—'}</div>
                        {h.phone && <div className="text-xs text-slate-400">{h.phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700 hidden sm:table-cell">{h.capacity ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700 hidden md:table-cell">
                        {h.feePerTerm > 0 ? `KSh ${h.feePerTerm.toLocaleString()}` : '—'}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setHostelModal(h)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => setDeletingHostel(h)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Rooms tab */}
      {tab === 'rooms' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {roomsLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : rooms.length === 0 ? (
            <EmptyState icon={Home} message="No rooms added yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Room</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Hostel</th>
                    <th className="px-4 py-3 text-center">Occupancy</th>
                    <th className="px-4 py-3 text-center hidden sm:table-cell">Type</th>
                    <th className="px-4 py-3 text-center hidden md:table-cell">Gender</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rooms.map(r => {
                    const pct = r.capacity ? ((r.occupied ?? 0) / r.capacity) * 100 : 0;
                    return (
                      <tr key={r.id ?? r._id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">Room {r.roomNumber}</div>
                          {r.floor && <div className="text-xs text-slate-400">{r.floor}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{r.hostelName ?? r.hostelId}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                            <span className="text-xs text-slate-600">{r.occupied ?? 0}/{r.capacity}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                          <span className="text-xs text-slate-500 capitalize">{r.type?.replace('-', ' ')}</span>
                        </td>
                        <td className="px-4 py-3 text-center hidden md:table-cell">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${genderBadge(r.gender)}`}>{r.gender}</span>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3">
                            <button onClick={() => deleteRoom.mutate(r.id ?? r._id)}
                              disabled={deleteRoom.isPending}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 disabled:opacity-50">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Assignments tab */}
      {tab === 'assignments' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {assignLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : assignments.length === 0 ? (
            <EmptyState icon={Users} message="No active hostel assignments" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Student</th>
                    <th className="px-4 py-3 text-left">Hostel / Room</th>
                    <th className="px-4 py-3 text-center hidden sm:table-cell">Bed</th>
                    <th className="px-4 py-3 text-center hidden md:table-cell">Since</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.map(a => (
                    <tr key={a.id ?? a._id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{a.studentName || a.studentId}</div>
                        {a.studentClass && <div className="text-xs text-slate-400">{a.studentClass}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{a.hostelName || '—'}</div>
                        <div className="text-xs text-slate-400">Room {a.roomNumber}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600 hidden sm:table-cell">{a.bedNumber || '—'}</td>
                      <td className="px-4 py-3 text-center text-slate-500 hidden md:table-cell text-xs">{a.startDate ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {a.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          {a.status === 'active' && (
                            <button onClick={() => discharge.mutate(a.id ?? a._id)}
                              disabled={discharge.isPending}
                              className="flex items-center gap-1 text-xs px-3 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 disabled:opacity-50">
                              <LogOut size={11} /> Discharge
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {hostelModal && (
        <HostelModal
          hostel={hostelModal === 'new' ? null : hostelModal}
          onClose={() => setHostelModal(null)}
          onSave={handleSaveHostel}
        />
      )}
      {roomModal && (
        <RoomModal
          room={roomModal === 'new' ? null : roomModal}
          hostels={hostels}
          onClose={() => setRoomModal(null)}
          onSave={(data) => createRoom.mutateAsync(data)}
        />
      )}
      {assignModal && (
        <AssignModal
          hostels={hostels}
          rooms={rooms}
          onClose={() => setAssignModal(false)}
          onSave={(data) => assignStudent.mutateAsync(data)}
        />
      )}
      {deletingHostel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="font-semibold text-slate-800">Delete Hostel?</h3>
            <p className="text-sm text-slate-600">Remove <span className="font-medium">"{deletingHostel.name}"</span>? All rooms must be removed first.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingHostel(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteHostel.mutate(deletingHostel.id ?? deletingHostel._id)}
                disabled={deleteHostel.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleteHostel.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
