import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bus, Plus, Search, MapPin, Users, Trash2, Edit2,
  X, RefreshCw, UserPlus, ChevronDown, UserMinus, UserCheck,
  Truck, ShieldCheck, Wrench, User, Phone, CalendarClock,
} from 'lucide-react';
import { transport as transportApi, students as studentsApi, classes as classesApi } from '@/api/client.js';
import { KpiCard } from '@/components/ui/KpiCard.jsx';
import useAuthStore from '@/store/auth.js';
import { useToast } from '@/hooks/useToast.jsx';

/* KpiCard — shared themed component (see @/components/ui/KpiCard.jsx) */

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Icon size={40} className="mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/* ── Route modal ──────────────────────────────────────────── */
function RouteModal({ route, onClose, onSave, vehicles = [], drivers = [] }) {
  const [form, setForm] = useState({
    name:          route?.name          ?? '',
    origin:        route?.origin        ?? '',
    destination:   route?.destination   ?? '',
    stops:         (route?.stops ?? []).join(', '),
    departureTime: route?.departureTime ?? '',
    arrivalTime:   route?.arrivalTime   ?? '',
    vehicleType:   route?.vehicleType   ?? 'bus',
    vehicleReg:    route?.vehicleReg    ?? '',
    driverName:    route?.driverName    ?? '',
    driverPhone:   route?.driverPhone   ?? '',
    capacity:      route?.capacity      ?? '',
    oneWayFare:    (route?.fares ?? []).find(f => f.fareType === 'one_way')?.amount ?? '',
    twoWayFare:    (route?.fares ?? []).find(f => f.fareType === 'two_way')?.amount ?? '',
    notes:         route?.notes         ?? '',
    // The fleet vehicle / driver this run uses. Empty means "not on file" —
    // a school with nothing registered still describes its runs in words.
    vehicleId:     route?.vehicleId     ?? '',
    driverId:      route?.driverId      ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { oneWayFare, twoWayFare, ...rest } = form;
      const fares = [
        ...(oneWayFare !== '' ? [{ fareType: 'one_way', amount: Number(oneWayFare) }] : []),
        ...(twoWayFare !== '' ? [{ fareType: 'two_way', amount: Number(twoWayFare) }] : []),
      ];
      const payload = {
        ...rest,
        fares,
        stops:    form.stops ? form.stops.split(',').map(s => s.trim()).filter(Boolean) : [],
        capacity: form.capacity ? Number(form.capacity) : null,
      };
      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save route');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{route ? 'Edit Route' : 'New Route'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Route Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Origin</label>
              <input value={form.origin} onChange={e => set('origin', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Destination</label>
              <input value={form.destination} onChange={e => set('destination', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Stops (comma-separated)</label>
            <input value={form.stops} onChange={e => set('stops', e.target.value)} placeholder="Stop A, Stop B, Stop C"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Departure Time</label>
              <input type="time" value={form.departureTime} onChange={e => set('departureTime', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Arrival Time</label>
              <input type="time" value={form.arrivalTime} onChange={e => set('arrivalTime', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Vehicle</label>
              <select value={form.vehicleId} onChange={e => set('vehicleId', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Not on the fleet</option>
                {vehicles.map(v => (
                  <option key={v.id ?? v._id} value={v.id ?? v._id}>
                    {v.registration}{[v.make, v.model].filter(Boolean).length ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}{v.capacity ? ` · ${v.capacity} seats` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                {vehicles.length === 0
                  ? 'No vehicles registered yet — describe this run below.'
                  : 'Its plate, type and seats are copied onto the route automatically.'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Driver</label>
              <select value={form.driverId} onChange={e => set('driverId', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Not assigned</option>
                {drivers.map(d => (
                  <option key={d.id ?? d._id} value={d.id ?? d._id}>
                    {d.name}{d.phone ? ` · ${d.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Vehicle type</label>
              <select value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}
                disabled={!!form.vehicleId}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400">
                <option value="bus">Bus</option>
                <option value="van">Van</option>
                <option value="matatu">Matatu</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Registration</label>
              <input value={form.vehicleReg} onChange={e => set('vehicleReg', e.target.value)}
                disabled={!!form.vehicleId} placeholder={form.vehicleId ? '' : 'KDH 485Z'}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity</label>
              <input type="number" min={1} value={form.capacity} onChange={e => set('capacity', e.target.value)}
                disabled={!!form.vehicleId}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
              {form.vehicleId && <p className="text-[11px] text-slate-400 mt-1">From the vehicle's seats.</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Driver name</label>
              <input value={form.driverName} onChange={e => set('driverName', e.target.value)}
                disabled={!!form.driverId}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Driver phone</label>
              <input type="tel" value={form.driverPhone} onChange={e => set('driverPhone', e.target.value)}
                disabled={!!form.driverId}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">One-way fare per term (KSh)</label>
              <input type="number" min={0} value={form.oneWayFare} onChange={e => set('oneWayFare', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Two-way fare per term (KSh)</label>
              <input type="number" min={0} value={form.twoWayFare} onChange={e => set('twoWayFare', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">A student is charged the fare for the type chosen when they are assigned to this route. Leave a fare blank if the route does not offer that type.</p>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              placeholder="Anything the office should know about this run — e.g. morning pickup zones, who to call."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Assign modal ─────────────────────────────────────────── */
function AssignModal({ routes, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    routeId: '', pickupStop: '', direction: 'both', startDate: today, fareType: '',
  });
  // Several students can be chosen, across the class search. Each is saved as
  // its own assignment; they all share the route, fare, pickup and dates above.
  const [picked, setPicked] = useState([]); // [{ studentId, studentName, studentClass }]
  // The fare types offered are only the ones this route actually has a fare for.
  const selectedRoute = routes.find(r => (r.id ?? r._id) === form.routeId);
  const offeredFares  = selectedRoute?.fares ?? [];
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  // Student is picked from the school's records, never typed: choose a class,
  // then search that class by name or admission number.
  const [classId, setClassId] = useState('');
  const [search,  setSearch]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: classesResp } = useQuery({
    queryKey: ['transport', 'assign-classes'],
    queryFn:  () => classesApi.list(),
    staleTime: 5 * 60_000,
  });
  const classList = classesResp?.data ?? [];

  const { data: studentsResp, isFetching: searching } = useQuery({
    queryKey: ['transport', 'assign-students', classId, search.trim()],
    queryFn:  () => studentsApi.list({ classId, search: search.trim() || undefined, status: 'active', limit: 20 }),
    enabled:  !!classId,
    staleTime: 30_000,
  });
  const studentResults = studentsResp?.data ?? [];

  const isPicked = (id) => picked.some(p => p.studentId === id);
  function togglePick(s) {
    const id = s.id ?? s._id;
    if (isPicked(id)) { setPicked(p => p.filter(x => x.studentId !== id)); return; }
    const cls = classList.find(c => (c.id ?? c._id) === classId);
    setPicked(p => [...p, {
      studentId:    id,
      studentName:  s.studentName ?? [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' '),
      studentClass: s.studentClass ?? cls?.name ?? '',
    }]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (picked.length === 0) { setError('Choose at least one student'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ ...form, startDate: form.startDate || null, students: picked });
      onClose();
    }
    catch (err) { setError(err.message ?? 'Failed to assign students'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Assign Student to Route</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Route *</label>
            <select value={form.routeId} onChange={e => setForm(f => ({ ...f, routeId: e.target.value, fareType: '' }))} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select route…</option>
              {routes.map(r => <option key={r.id ?? r._id} value={r.id ?? r._id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Fare *</label>
            <select value={form.fareType} onChange={e => set('fareType', e.target.value)} required disabled={!form.routeId}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400">
              <option value="">{form.routeId ? 'Choose one-way or two-way…' : 'Choose a route first'}</option>
              {offeredFares.map(f => (
                <option key={f.fareType} value={f.fareType}>
                  {f.fareType === 'one_way' ? 'One way' : 'Two way'} — KSh {Number(f.amount).toLocaleString()} per term
                </option>
              ))}
            </select>
            {form.routeId && offeredFares.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">This route has no fare set. Set one on the route first.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class *</label>
            <select value={classId} onChange={e => { setClassId(e.target.value); setSearch(''); }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select class…</option>
              {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Students * <span className="font-normal text-slate-400">({picked.length} selected)</span></label>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {picked.map(p => (
                  <span key={p.studentId} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 text-xs text-slate-800">
                    {p.studentName}{p.studentClass ? <span className="text-slate-500">· {p.studentClass}</span> : null}
                    <button type="button" onClick={() => togglePick({ id: p.studentId })} aria-label={`Remove ${p.studentName}`}
                      className="text-blue-700 hover:text-blue-900 px-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              disabled={!classId}
              placeholder={classId ? 'Search by name or admission number' : 'Choose a class first'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
            />
            {classId && (
              <div className="mt-1 max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {searching && <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>}
                {!searching && studentResults.length === 0 && (
                  <p className="px-3 py-2 text-xs text-slate-400">No active students match in this class.</p>
                )}
                {studentResults.map(s => {
                  const id = s.id ?? s._id;
                  return (
                    <label key={id} className="w-full px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={isPicked(id)} onChange={() => togglePick(s)} className="rounded border-slate-300" />
                      <span className="text-slate-800 flex-1">{[s.firstName, s.lastName].filter(Boolean).join(' ')}</span>
                      <span className="font-mono text-xs text-slate-500">{s.admissionNumber ?? '—'}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pickup Stop</label>
              <input value={form.pickupStop} onChange={e => set('pickupStop', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Direction</label>
              <select value={form.direction} onChange={e => set('direction', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="both">Both ways</option>
                <option value="to_school">To school</option>
                <option value="from_school">From school</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Start Date</label>
            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || picked.length === 0 || !form.routeId || !form.fareType}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Edit assignment modal ────────────────────────────────────
   PATCH /api/transport/assignments/:id deliberately allows only the fields
   that do not change what the family is billed: pickup stop, direction, end
   date, notes and status. Route and fare are absent because changing either
   is a new assignment — the old one keeps its own fare history for billing,
   so the office removes and re-assigns instead of silently repricing. */
function EditAssignmentModal({ assignment, onClose, onSave }) {
  const [form, setForm] = useState({
    pickupStop: assignment?.pickupStop ?? '',
    direction:  assignment?.direction  ?? 'both',
    endDate:    (assignment?.endDate ?? '').slice(0, 10),
    notes:      assignment?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave({ ...form, endDate: form.endDate || null });
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save the assignment');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-semibold text-slate-800">Edit Assignment</h2>
            <p className="text-xs text-slate-400">
              {assignment?.studentName || assignment?.studentId} · {assignment?.routeName || assignment?.routeId}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pickup Stop</label>
              <input value={form.pickupStop} onChange={e => set('pickupStop', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Direction</label>
              <select value={form.direction} onChange={e => set('direction', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="both">Both ways</option>
                <option value="to_school">To school</option>
                <option value="from_school">From school</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">End Date
              <span className="font-normal text-slate-400"> (optional — the day the family stops riding)</span>
            </label>
            <input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <p className="text-[11px] text-slate-400">
            Fare and route are fixed for billing. To move this student, remove the assignment and assign them again.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Expiry state for insurance / inspection / licence dates ──────
   A compliance date is only useful if it shouts before it lapses, so the
   same thresholds drive a colour everywhere one is shown. */
function _expiryState(date, warnDays = 60) {
  if (!date) return { label: 'Not on file', cls: 'text-slate-400' };
  const at = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at)) return { label: String(date), cls: 'text-slate-400' };
  const days = Math.round((at - Date.now()) / 86400000);
  const shown = `${String(date).slice(0, 10)}`;
  if (days < 0)      return { label: shown, cls: 'text-rose-600 font-semibold', note: `expired ${Math.abs(days)}d ago`, overdue: true };
  if (days <= warnDays) return { label: shown, cls: 'text-amber-600 font-semibold', note: `in ${days}d`, soon: true };
  return { label: shown, cls: 'text-slate-500' };
}

/* ── Vehicle (fleet) modal ─────────────────────────────────────── */
const VEHICLE_TYPES = [
  { value: 'bus', label: 'Bus' },
  { value: 'van', label: 'Van' },
  { value: 'matatu', label: 'Matatu' },
  { value: 'other', label: 'Other' },
];
const VEHICLE_STATUSES = [
  { value: 'active', label: 'In service' },
  { value: 'maintenance', label: 'In maintenance' },
  { value: 'retired', label: 'Retired' },
];

function VehicleModal({ vehicle, onClose, onSave }) {
  const [form, setForm] = useState({
    registration:     vehicle?.registration     ?? '',
    vehicleType:      vehicle?.vehicleType      ?? 'bus',
    make:             vehicle?.make             ?? '',
    model:            vehicle?.model            ?? '',
    year:             vehicle?.year             ?? '',
    capacity:         vehicle?.capacity         ?? '',
    ownership:        vehicle?.ownership        ?? 'owned',
    status:           vehicle?.status           ?? 'active',
    insuranceExpiry:  (vehicle?.insuranceExpiry  ?? '').slice(0, 10),
    inspectionExpiry: (vehicle?.inspectionExpiry ?? '').slice(0, 10),
    notes:            vehicle?.notes            ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave({
        ...form,
        year:     form.year === '' ? null : Number(form.year),
        capacity: form.capacity === '' ? null : Number(form.capacity),
      });
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save the vehicle');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{vehicle ? 'Edit Vehicle' : 'Add Vehicle'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Registration *</label>
              <input value={form.registration} onChange={e => set('registration', e.target.value)} required
                placeholder="KDH 485Z"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {VEHICLE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Make</label>
              <input value={form.make} onChange={e => set('make', e.target.value)} placeholder="Toyota"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Model</label>
              <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="Coaster"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Year</label>
              <input type="number" min={1950} max={2100} value={form.year} onChange={e => set('year', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Seats</label>
              <input type="number" min={1} value={form.capacity} onChange={e => set('capacity', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Ownership</label>
              <select value={form.ownership} onChange={e => set('ownership', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="owned">School-owned</option>
                <option value="hired">Hired</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {VEHICLE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Insurance expires</label>
              <input type="date" value={form.insuranceExpiry} onChange={e => set('insuranceExpiry', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Inspection due</label>
              <input type="date" value={form.inspectionExpiry} onChange={e => set('inspectionExpiry', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Driver modal ──────────────────────────────────────────────── */
const DRIVER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'left', label: 'Left' },
];

function DriverModal({ driver, onClose, onSave }) {
  const [form, setForm] = useState({
    name:          driver?.name          ?? '',
    phone:         driver?.phone         ?? '',
    licenceNumber: driver?.licenceNumber ?? '',
    licenceExpiry: (driver?.licenceExpiry ?? '').slice(0, 10),
    status:        driver?.status        ?? 'active',
    notes:         driver?.notes         ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save the driver');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{driver ? 'Edit Driver' : 'Add Driver'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Full name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required
              placeholder="Mr. John Nderitu"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
              placeholder="+254 712 345 678"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-[11px] text-slate-400 mt-1">Shown to parents and students on the run they drive, tappable to call.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Licence number</label>
              <input value={form.licenceNumber} onChange={e => set('licenceNumber', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Licence expires</label>
              <input type="date" value={form.licenceExpiry} onChange={e => set('licenceExpiry', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {DRIVER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save driver'}
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
export default function TransportPage() {
  const qc      = useQueryClient();
  const { toast } = useToast();
  const role = useAuthStore(s => s.session?.user?.role ?? 'student');
  const can  = useAuthStore(s => s.can.bind(s));
  // transport:read is granted broadly by default (everyone can browse
  // routes) — check 'create' specifically so read-only roles don't see
  // manage controls they'd just get a 403 clicking. The real enforcement
  // boundary is the server's rbac('transport', action, subKey) checks.
  const canEdit = can('transport', 'create') || role === 'admin' || role === 'superadmin';

  const [tab,         setTab]         = useState('routes');
  const [search,      setSearch]      = useState('');
  const [routeModal,  setRouteModal]  = useState(null);   // null | 'new' | route-obj
  const [assignModal, setAssignModal] = useState(false);
  const [deletingRoute, setDeletingRoute] = useState(null);
  // The API filters server-side; 'active' is the working default, and 'all'
  // exists so the Inactive KPI below is not a number you cannot open.
  const [assignStatus, setAssignStatus] = useState('active');
  const [editAssignment, setEditAssignment] = useState(null);
  // Fleet + drivers. The lists are also needed by the route form's pickers, so
  // they load for any of the three tabs that use them.
  const [vehicleModal, setVehicleModal] = useState(null);   // null | 'new' | vehicle
  const [driverModal,  setDriverModal]  = useState(null);   // null | 'new' | driver
  const [deletingVehicle, setDeletingVehicle] = useState(null);
  const [deletingDriver,  setDeletingDriver]  = useState(null);
  const [fleetSearch,  setFleetSearch]  = useState('');
  const [driverSearch, setDriverSearch] = useState('');

  /* ── Queries ─────────────────────────────────────────────── */
  const { data: summaryRaw } = useQuery({
    queryKey: ['transport-summary'],
    queryFn:  () => transportApi.summary(),
    staleTime: 60_000,
  });

  const { data: routesRaw, isLoading: routesLoading } = useQuery({
    queryKey: ['transport-routes', search],
    queryFn:  () => transportApi.routes.list({ q: search || undefined, limit: 50 }),
    staleTime: 30_000,
  });

  const { data: assignmentsRaw, isLoading: assignLoading } = useQuery({
    queryKey: ['transport-assignments', assignStatus],
    queryFn:  () => transportApi.assignments.list({
      ...(assignStatus === 'all' ? {} : { status: assignStatus }),
      limit: 100,
    }),
    staleTime: 30_000,
    enabled:  tab === 'assignments',
  });

  /* The fleet and the driver list are also the route form's pickers, so they
     load for any of the three tabs that use them, not just their own. */
  const { data: vehiclesRaw, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['transport-vehicles', fleetSearch],
    queryFn:  () => transportApi.vehicles.list({ q: fleetSearch || undefined, limit: 100 }),
    staleTime: 30_000,
    enabled:  tab === 'routes' || tab === 'fleet',
  });

  const { data: driversRaw, isLoading: driversLoading } = useQuery({
    queryKey: ['transport-drivers', driverSearch],
    queryFn:  () => transportApi.drivers.list({ q: driverSearch || undefined, limit: 100 }),
    staleTime: 30_000,
    enabled:  tab === 'routes' || tab === 'drivers',
  });

  const summary     = summaryRaw?.data     ?? summaryRaw  ?? {};
  const routes      = routesRaw?.data      ?? [];
  const assignments = assignmentsRaw?.data ?? [];
  const vehicles    = vehiclesRaw?.data    ?? [];
  const drivers     = driversRaw?.data     ?? [];
  const vehiclesById = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id ?? v._id, v])), [vehicles]);
  const driversById  = useMemo(() => Object.fromEntries(drivers.map(d => [d.id ?? d._id, d])), [drivers]);

  /* ── Mutations ───────────────────────────────────────────── */
  const createRoute = useMutation({
    mutationFn: (data) => transportApi.routes.create(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['transport-routes'] }),
    onError:    err => toast.error(err?.message ?? 'Failed to create route.'),
  });
  const updateRoute = useMutation({
    mutationFn: ({ id, data }) => transportApi.routes.update(id, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['transport-routes'] }),
    onError:    err => toast.error(err?.message ?? 'Failed to update route.'),
  });
  const deleteRoute = useMutation({
    mutationFn: (id) => transportApi.routes.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['transport-routes'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      setDeletingRoute(null);
      toast.success('Route deleted.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to delete route.'),
  });
  const assignStudent = useMutation({
    mutationFn: (data) => transportApi.assignments.assignBulk(data),
    onSuccess:  (r) => {
      qc.invalidateQueries({ queryKey: ['transport-assignments'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      const created = r?.data?.created ?? 0;
      const skipped = r?.data?.skipped?.length ?? 0;
      toast.success(`${created} student${created === 1 ? '' : 's'} assigned to route.${skipped ? ` ${skipped} already on this route, skipped.` : ''}`);
    },
    onError: err => toast.error(err?.message ?? 'Failed to assign students.'),
  });
  const removeAssignment = useMutation({
    mutationFn: (id) => transportApi.assignments.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['transport-assignments'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      toast.success('Assignment removed.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to remove assignment.'),
  });

  /* PATCH /assignments/:id — the edit and the deactivate/reactivate toggle both
     go through here, because the API treats "stopped riding" as a status, not
     a deletion: the record keeps its own fare history. */
  const updateAssignment = useMutation({
    mutationFn: ({ id, data }) => transportApi.assignments.update(id, data),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['transport-assignments'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      toast.success(vars?.data?.status === 'inactive' ? 'Assignment deactivated.'
        : vars?.data?.status === 'active' ? 'Assignment reactivated.'
        : 'Assignment updated.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to update assignment.'),
  });

  /* ── Fleet ─────────────────────────────────────────────────────
     Every write also refreshes the route lists: the server copies the
     vehicle's registration/type/seats onto each route that uses it, so a
     corrected plate has to show up on the routes tab too. */
  const createVehicle = useMutation({
    mutationFn: (data) => transportApi.vehicles.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-vehicles'] });
      qc.invalidateQueries({ queryKey: ['transport-routes'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      setVehicleModal(null);
      toast.success('Vehicle added to the fleet.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to add the vehicle.'),
  });
  const updateVehicle = useMutation({
    mutationFn: ({ id, data }) => transportApi.vehicles.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-vehicles'] });
      qc.invalidateQueries({ queryKey: ['transport-routes'] });
      setVehicleModal(null);
      toast.success('Vehicle updated.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to update the vehicle.'),
  });
  const deleteVehicle = useMutation({
    mutationFn: (id) => transportApi.vehicles.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-vehicles'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      setDeletingVehicle(null);
      toast.success('Vehicle removed from the fleet.');
    },
    onError: err => { setDeletingVehicle(null); toast.error(err?.message ?? 'Failed to remove the vehicle.'); },
  });

  /* ── Drivers ────────────────────────────────────────────── */
  const createDriver = useMutation({
    mutationFn: (data) => transportApi.drivers.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-drivers'] });
      qc.invalidateQueries({ queryKey: ['transport-routes'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      setDriverModal(null);
      toast.success('Driver added.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to add the driver.'),
  });
  const updateDriver = useMutation({
    mutationFn: ({ id, data }) => transportApi.drivers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-drivers'] });
      qc.invalidateQueries({ queryKey: ['transport-routes'] });
      setDriverModal(null);
      toast.success('Driver updated.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to update the driver.'),
  });
  const deleteDriver = useMutation({
    mutationFn: (id) => transportApi.drivers.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport-drivers'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      setDeletingDriver(null);
      toast.success('Driver removed.');
    },
    onError: err => { setDeletingDriver(null); toast.error(err?.message ?? 'Failed to remove the driver.'); },
  });

  /* the vehicle/driver a route points at, for the routes table's "on file" column */
  function routeVehicleLabel(route) {
    const v = route.vehicleId ? vehiclesById[route.vehicleId] : null;
    return v ? `${v.registration}` : (route.vehicleReg || '');
  }
  function routeDriverLabel(route) {
    const d = route.driverId ? driversById[route.driverId] : null;
    return d ? d.name : (route.driverName || '');
  }

  async function handleSaveRoute(form) {
    try {
      if (routeModal && routeModal !== 'new') {
        await updateRoute.mutateAsync({ id: routeModal.id ?? routeModal._id, data: form });
        toast.success('Route updated.');
      } else {
        await createRoute.mutateAsync(form);
        toast.success('Route created.');
      }
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
    } catch (err) {
      toast.error(err?.message ?? 'Failed to save route.');
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-xl">
            <Bus size={22} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Transport</h1>
            <p className="text-xs text-slate-500">Routes, fleet, drivers &amp; student assignments</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<Bus size={18} />}        label="Routes"        value={summary.totalRoutes}        colorIndex={0} />
        <KpiCard icon={<Truck size={18} />}      label="Vehicles"      value={summary.totalVehicles}      colorIndex={3} />
        <KpiCard icon={<User size={18} />}       label="Drivers"       value={summary.totalDrivers}       colorIndex={2} />
        <KpiCard icon={<Users size={18} />}      label="Assigned"      value={summary.totalAssignments}  colorIndex={1} />
        <KpiCard icon={<UserCheck size={18} />}  label="Active"        value={summary.activeAssignments} colorIndex={2} />
        <KpiCard icon={<UserMinus size={18} />}  label="Inactive"      value={summary.inactiveAssignments} colorIndex={3} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {[
          { id: 'routes',      label: 'Routes'      },
          { id: 'fleet',       label: 'Fleet'       },
          { id: 'drivers',     label: 'Drivers'     },
          { id: 'assignments', label: 'Assignments' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm rounded-lg transition ${tab === t.id ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Primary actions move with the tab, so "New Fleet" is not offered over a list of drivers. */}
      {tab === 'routes' && canEdit && (
        <div className="flex gap-2">
          <button onClick={() => setRouteModal('new')}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600">
            <Plus size={15} /> New Route
          </button>
        </div>
      )}
      {tab === 'fleet' && canEdit && (
        <div className="flex gap-2">
          <button onClick={() => setVehicleModal('new')}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600">
            <Plus size={15} /> New Vehicle
          </button>
        </div>
      )}
      {tab === 'drivers' && canEdit && (
        <div className="flex gap-2">
          <button onClick={() => setDriverModal('new')}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600">
            <Plus size={15} /> New Driver
          </button>
        </div>
      )}
      {tab === 'assignments' && canEdit && (
        <div className="flex gap-2">
          <button onClick={() => { setTab('assignments'); setAssignModal(true); }}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700">
            <UserPlus size={15} /> Assign Student
          </button>
        </div>
      )}

      {/* Fleet tab */}
      {tab === 'fleet' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <Search size={15} className="text-slate-400" />
            <input value={fleetSearch} onChange={e => setFleetSearch(e.target.value)}
              placeholder="Search registration, make, model…"
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-slate-400" />
            {fleetSearch && <button onClick={() => setFleetSearch('')} className="p-1 rounded-md hover:bg-slate-100 text-slate-400"><X size={13} /></button>}
          </div>
          {vehiclesLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : vehicles.length === 0 ? (
            <EmptyState icon={Truck} message="No vehicles on the fleet yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Vehicle</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Type</th>
                    <th className="px-4 py-3 text-center hidden sm:table-cell">Seats</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Insurance</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Inspection</th>
                    <th className="px-4 py-3 text-left hidden lg:table-cell">On routes</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vehicles.map(v => {
                    const ins  = _expiryState(v.insuranceExpiry);
                    const insp = _expiryState(v.inspectionExpiry);
                    return (
                      <tr key={v.id ?? v._id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3">
                          <div className="font-mono font-medium text-slate-800">{v.registration}</div>
                          {[v.make, v.model, v.year].filter(Boolean).length > 0 && (
                            <div className="text-xs text-slate-400">{[v.make, v.model, v.year].filter(Boolean).join(' · ')}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-700 hidden sm:table-cell">{v.vehicleType}</td>
                        <td className="px-4 py-3 text-center text-slate-700 hidden sm:table-cell">{v.capacity ?? '—'}</td>
                        <td className={clsx('px-4 py-3 text-xs hidden md:table-cell', ins.cls)}>
                          {ins.label}
                          {ins.note && <span className="font-normal opacity-80"> · {ins.note}</span>}
                        </td>
                        <td className={clsx('px-4 py-3 text-xs hidden md:table-cell', insp.cls)}>
                          {insp.label}
                          {insp.note && <span className="font-normal opacity-80"> · {insp.note}</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">
                          {(v.routes ?? []).length === 0 ? '—' : (v.routes ?? []).map(r => r.name).join(', ')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            v.status === 'active' ? 'bg-emerald-100 text-emerald-700'
                              : v.status === 'maintenance' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-500'}`}>
                            {v.status === 'active' ? 'In service' : v.status === 'maintenance' ? 'In maintenance' : 'Retired'}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => setVehicleModal(v)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => setDeletingVehicle(v)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                                <Trash2 size={14} />
                              </button>
                            </div>
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

      {/* Drivers tab */}
      {tab === 'drivers' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <Search size={15} className="text-slate-400" />
            <input value={driverSearch} onChange={e => setDriverSearch(e.target.value)}
              placeholder="Search driver, phone, licence…"
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-slate-400" />
            {driverSearch && <button onClick={() => setDriverSearch('')} className="p-1 rounded-md hover:bg-slate-100 text-slate-400"><X size={13} /></button>}
          </div>
          {driversLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : drivers.length === 0 ? (
            <EmptyState icon={User} message="No drivers on file yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Driver</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Phone</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Licence</th>
                    <th className="px-4 py-3 text-left hidden lg:table-cell">On routes</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drivers.map(d => {
                    const lic = _expiryState(d.licenceExpiry);
                    return (
                      <tr key={d.id ?? d._id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{d.name}</div>
                          {d.notes && <div className="text-xs text-slate-400 line-clamp-1 max-w-[16rem]" title={d.notes}>{d.notes}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                          {d.phone
                            ? <a href={`tel:${String(d.phone).replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800">
                                <Phone size={11} /> {d.phone}
                              </a>
                            : '—'}
                        </td>
                        <td className={clsx('px-4 py-3 text-xs hidden md:table-cell', lic.cls)}>
                          <div className="font-mono text-[11px] text-slate-600">{d.licenceNumber || '—'}</div>
                          <div>{lic.label}{lic.note && <span className="font-normal opacity-80"> · {lic.note}</span>}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">
                          {(d.routes ?? []).length === 0 ? '—' : (d.routes ?? []).map(r => r.name).join(', ')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            d.status === 'active' ? 'bg-emerald-100 text-emerald-700'
                              : d.status === 'suspended' ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-500'}`}>
                            {d.status === 'active' ? 'Active' : d.status === 'suspended' ? 'Suspended' : 'Left'}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => setDriverModal(d)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => setDeletingDriver(d)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                                <Trash2 size={14} />
                              </button>
                            </div>
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

      {/* Routes tab */}
      {tab === 'routes' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <Search size={15} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search routes, driver, vehicle…"
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-slate-400" />
            {search && <button onClick={() => setSearch('')} className="p-1 rounded-md hover:bg-slate-100 text-slate-400"><X size={13} /></button>}
          </div>
          {routesLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : routes.length === 0 ? (
            <EmptyState icon={Bus} message="No transport routes configured yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Route</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Vehicle</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Driver</th>
                    <th className="px-4 py-3 text-center hidden sm:table-cell">Capacity</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Fee/Term</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {routes.map(route => (
                    <tr key={route.id ?? route._id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{route.name}</div>
                        {(route.origin || route.destination) && (
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin size={10} />
                            {route.origin}{route.origin && route.destination ? ' → ' : ''}{route.destination}
                          </div>
                        )}
                        {route.notes && (
                          <div className="text-xs text-slate-400 mt-0.5 line-clamp-1 max-w-[22rem]" title={route.notes}>
                            {route.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="capitalize text-slate-700">{route.vehicleType}</div>
                        {route.vehicleReg && (
                          <div className="text-xs text-slate-400 font-mono">
                            {route.vehicleReg}
                            {route.vehicleId && vehiclesById[route.vehicleId] && (
                              <span className="ml-1 font-sans text-emerald-600">· on fleet</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">
                        <div>{route.driverName || '—'}</div>
                        {route.driverPhone && (
                          <div className="text-xs text-slate-400 flex items-center gap-1">
                            <Phone size={9} /> {route.driverPhone}
                            {route.driverId && driversById[route.driverId] && (
                              <span className="text-emerald-600">· on file</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700 hidden sm:table-cell">{route.capacity ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700 hidden md:table-cell">
                        {(route.fares ?? []).length === 0 ? '—' : (route.fares ?? []).map(f => (
                          <div key={f.fareType} className="text-xs whitespace-nowrap">
                            {f.fareType === 'one_way' ? 'One way' : 'Two way'} KSh {Number(f.amount).toLocaleString()}
                          </div>
                        ))}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setRouteModal(route)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => setDeletingRoute(route)}
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

      {/* Assignments tab */}
      {tab === 'assignments' && (
        <div className="space-y-3">
          {/* Status filter — the API filters server-side, and the summary KPI
              counts inactive rows, so they have to be reachable. */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {[
                { id: 'active',   label: 'Active' },
                { id: 'inactive', label: 'Inactive' },
                { id: 'all',      label: 'All' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => setAssignStatus(s.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                    assignStatus === s.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {s.label}
                  {s.id === 'inactive' && summary.inactiveAssignments > 0 && (
                    <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                      {summary.inactiveAssignments}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {assignLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : assignments.length === 0 ? (
            <EmptyState icon={Users} message={
              assignStatus === 'active' ? 'No active student assignments'
                : assignStatus === 'inactive' ? 'No inactive assignments'
                  : 'No student assignments yet'
            } />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Student</th>
                    <th className="px-4 py-3 text-left">Route</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Pickup Stop</th>
                    <th className="px-4 py-3 text-center hidden md:table-cell">Direction</th>
                    <th className="px-4 py-3 text-left hidden lg:table-cell">Fare</th>
                    <th className="px-4 py-3 text-left hidden lg:table-cell">Dates</th>
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
                        {a.notes && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1 max-w-[16rem]" title={a.notes}>{a.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{a.routeName || a.routeId}</td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{a.pickupStop || '—'}</td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <span className="text-xs text-slate-500 capitalize">{a.direction?.replace('_', ' ') ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {/* Which fare the family is billed — the assignment carries
                            it, and the route's current fares are not it. */}
                        <span className="text-xs text-slate-600">
                          {a.fareType === 'one_way' ? 'One way' : a.fareType === 'two_way' ? 'Two way' : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-slate-500">{a.startDate || '—'}</span>
                        {a.endDate && <span className="text-xs text-slate-500"> → {a.endDate}</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {a.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setEditAssignment(a)}
                              title="Edit pickup stop, direction, end date or notes"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => updateAssignment.mutate({
                                id: a.id ?? a._id,
                                data: { status: a.status === 'active' ? 'inactive' : 'active' },
                              })}
                              title={a.status === 'active' ? 'Deactivate (keeps the record and its fare history)' : 'Reactivate'}
                              disabled={updateAssignment.isPending}
                              className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 disabled:opacity-50"
                            >
                              {a.status === 'active' ? <UserMinus size={14} /> : <UserCheck size={14} />}
                            </button>
                            <button onClick={() => removeAssignment.mutate(a.id ?? a._id)}
                              title="Delete this assignment"
                              disabled={removeAssignment.isPending}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 disabled:opacity-50">
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
        </div>
      )}

      {/* Modals */}
      {routeModal && (
        <RouteModal
          route={routeModal === 'new' ? null : routeModal}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setRouteModal(null)}
          onSave={handleSaveRoute}
        />
      )}
      {assignModal && (
        <AssignModal
          routes={routes}
          onClose={() => setAssignModal(false)}
          onSave={(data) => assignStudent.mutateAsync(data)}
        />
      )}
      {/* Edit assignment — covers PATCH /assignments/:id */}
      {editAssignment && (
        <EditAssignmentModal
          assignment={editAssignment}
          onClose={() => setEditAssignment(null)}
          onSave={(data) => updateAssignment.mutateAsync({ id: editAssignment.id ?? editAssignment._id, data })}
        />
      )}

      {/* Fleet + drivers */}
      {vehicleModal && (
        <VehicleModal
          vehicle={vehicleModal === 'new' ? null : vehicleModal}
          onClose={() => setVehicleModal(null)}
          onSave={(data) => (vehicleModal === 'new'
            ? createVehicle.mutateAsync(data)
            : updateVehicle.mutateAsync({ id: vehicleModal.id ?? vehicleModal._id, data }))}
        />
      )}
      {driverModal && (
        <DriverModal
          driver={driverModal === 'new' ? null : driverModal}
          onClose={() => setDriverModal(null)}
          onSave={(data) => (driverModal === 'new'
            ? createDriver.mutateAsync(data)
            : updateDriver.mutateAsync({ id: driverModal.id ?? driverModal._id, data }))}
        />
      )}

      {deletingVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="font-semibold text-slate-800">Delete Vehicle?</h3>
            <p className="text-sm text-slate-600">
              Remove <span className="font-medium font-mono">{deletingVehicle.registration}</span> from the fleet?
              Routes that use it are refused, so take it off them first.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingVehicle(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteVehicle.mutate(deletingVehicle.id ?? deletingVehicle._id)}
                disabled={deleteVehicle.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleteVehicle.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="font-semibold text-slate-800">Delete Driver?</h3>
            <p className="text-sm text-slate-600">
              Remove <span className="font-medium">{deletingDriver.name}</span>? Routes that list them are refused,
              so take them off those runs first. To keep the record and stop the run, mark them "Left" instead.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingDriver(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteDriver.mutate(deletingDriver.id ?? deletingDriver._id)}
                disabled={deleteDriver.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleteDriver.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete route confirm */}
      {deletingRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="font-semibold text-slate-800">Delete Route?</h3>
            <p className="text-sm text-slate-600">Remove <span className="font-medium">"{deletingRoute.name}"</span>? This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingRoute(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteRoute.mutate(deletingRoute.id ?? deletingRoute._id)}
                disabled={deleteRoute.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleteRoute.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
