import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bus, Plus, Search, MapPin, Users, Trash2, Edit2,
  X, RefreshCw, UserPlus, ChevronDown,
} from 'lucide-react';
import { transport as transportApi } from '@/api/client.js';
import { KpiCard } from '@/components/ui/KpiCard.jsx';

/* ── Role helpers ─────────────────────────────────────────── */
function useRole() {
  try {
    const s = JSON.parse(localStorage.getItem('msingi_session') || '{}');
    return s?.user?.role ?? 'student';
  } catch { return 'student'; }
}
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'transport_officer']);

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
function RouteModal({ route, onClose, onSave }) {
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
    feePerTerm:    route?.feePerTerm    ?? 0,
    notes:         route?.notes         ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Vehicle Type</label>
              <select value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="bus">Bus</option>
                <option value="van">Van</option>
                <option value="matatu">Matatu</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Registration</label>
              <input value={form.vehicleReg} onChange={e => set('vehicleReg', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity</label>
              <input type="number" min={1} value={form.capacity} onChange={e => set('capacity', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Driver Name</label>
              <input value={form.driverName} onChange={e => set('driverName', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Driver Phone</label>
              <input type="tel" value={form.driverPhone} onChange={e => set('driverPhone', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Fee Per Term (KSh)</label>
            <input type="number" min={0} value={form.feePerTerm} onChange={e => set('feePerTerm', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
    routeId: '', studentId: '', studentName: '',
    studentClass: '', pickupStop: '', direction: 'both', startDate: today,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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
          <h2 className="font-semibold text-slate-800">Assign Student to Route</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Route *</label>
            <select value={form.routeId} onChange={e => set('routeId', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select route…</option>
              {routes.map(r => <option key={r.id ?? r._id} value={r.id ?? r._id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Student ID *</label>
            <input value={form.studentId} onChange={e => set('studentId', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Name</label>
              <input value={form.studentName} onChange={e => set('studentName', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class</label>
              <input value={form.studentClass} onChange={e => set('studentClass', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
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
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
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
export default function TransportPage() {
  const qc      = useQueryClient();
  const role    = useRole();
  const canEdit = MANAGE_ROLES.has(role);

  const [tab,         setTab]         = useState('routes');
  const [search,      setSearch]      = useState('');
  const [routeModal,  setRouteModal]  = useState(null);   // null | 'new' | route-obj
  const [assignModal, setAssignModal] = useState(false);
  const [deletingRoute, setDeletingRoute] = useState(null);

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
    queryKey: ['transport-assignments'],
    queryFn:  () => transportApi.assignments.list({ status: 'active', limit: 100 }),
    staleTime: 30_000,
    enabled:  tab === 'assignments',
  });

  const summary     = summaryRaw?.data     ?? summaryRaw  ?? {};
  const routes      = routesRaw?.data      ?? [];
  const assignments = assignmentsRaw?.data ?? [];

  /* ── Mutations ───────────────────────────────────────────── */
  const createRoute = useMutation({
    mutationFn: (data) => transportApi.routes.create(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['transport-routes'] }),
  });
  const updateRoute = useMutation({
    mutationFn: ({ id, data }) => transportApi.routes.update(id, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['transport-routes'] }),
  });
  const deleteRoute = useMutation({
    mutationFn: (id) => transportApi.routes.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['transport-routes'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
      setDeletingRoute(null);
    },
  });
  const assignStudent = useMutation({
    mutationFn: (data) => transportApi.assignments.assign(data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['transport-assignments'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
    },
  });
  const removeAssignment = useMutation({
    mutationFn: (id) => transportApi.assignments.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['transport-assignments'] });
      qc.invalidateQueries({ queryKey: ['transport-summary'] });
    },
  });

  async function handleSaveRoute(form) {
    if (routeModal && routeModal !== 'new') {
      await updateRoute.mutateAsync({ id: routeModal.id ?? routeModal._id, data: form });
    } else {
      await createRoute.mutateAsync(form);
    }
    qc.invalidateQueries({ queryKey: ['transport-summary'] });
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
            <p className="text-xs text-slate-500">Routes &amp; student assignments</p>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => { setTab('assignments'); setAssignModal(true); }}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700">
              <UserPlus size={15} /> Assign Student
            </button>
            <button onClick={() => setRouteModal('new')}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600">
              <Plus size={15} /> New Route
            </button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={<Bus size={18} />}    label="Total Routes"   value={summary.totalRoutes}         colorIndex={0} />
        <KpiCard icon={<Users size={18} />} label="Total Assigned" value={summary.totalAssignments}    colorIndex={1} />
        <KpiCard icon={<Users size={18} />} label="Active"         value={summary.activeAssignments}   colorIndex={2} />
        <KpiCard icon={<MapPin size={18} />} label="Inactive"      value={summary.inactiveAssignments} colorIndex={3} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {['routes', 'assignments'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-lg capitalize transition ${tab === t ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

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
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="capitalize text-slate-700">{route.vehicleType}</div>
                        {route.vehicleReg && <div className="text-xs text-slate-400 font-mono">{route.vehicleReg}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">
                        <div>{route.driverName || '—'}</div>
                        {route.driverPhone && <div className="text-xs text-slate-400">{route.driverPhone}</div>}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700 hidden sm:table-cell">{route.capacity ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700 hidden md:table-cell">
                        {route.feePerTerm > 0 ? `KSh ${route.feePerTerm.toLocaleString()}` : '—'}
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {assignLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : assignments.length === 0 ? (
            <EmptyState icon={Users} message="No active student assignments" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Student</th>
                    <th className="px-4 py-3 text-left">Route</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Pickup Stop</th>
                    <th className="px-4 py-3 text-center hidden md:table-cell">Direction</th>
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
                      <td className="px-4 py-3 text-slate-700">{a.routeName || a.routeId}</td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{a.pickupStop || '—'}</td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <span className="text-xs text-slate-500 capitalize">{a.direction?.replace('_', ' ') ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {a.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <button onClick={() => removeAssignment.mutate(a.id ?? a._id)}
                            disabled={removeAssignment.isPending}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 disabled:opacity-50">
                            <Trash2 size={14} />
                          </button>
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
      {routeModal && (
        <RouteModal
          route={routeModal === 'new' ? null : routeModal}
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
