/* ============================================================
   Events & Calendar — school events with month/list views
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Plus, ChevronLeft, ChevronRight, List,
  LayoutGrid, MapPin, Users, Trash2, Edit2, X, Check, Download,
} from 'lucide-react';
import { events as eventsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Constants ────────────────────────────────────────────── */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const CATEGORIES = {
  term:     { label: 'Term',         color: '#4f46e5' },
  exam:     { label: 'Exam',         color: '#0f766e' },
  meeting:  { label: 'Meeting',      color: '#0891b2' },
  sports:   { label: 'Sports',       color: '#16a34a' },
  cultural: { label: 'Cultural',     color: '#be185d' },
  training: { label: 'Training',     color: '#dc2626' },
  academic: { label: 'Academic',     color: '#7c3aed' },
  break:    { label: 'Break',        color: '#d97706' },
  general:  { label: 'General',      color: '#6b7280' },
};

const ADMIN_ROLES = ['superadmin','admin','deputy_principal','timetabler'];

/* ── Helpers ──────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function isSameDay(a, b) {
  return a.slice(0,10) === b.slice(0,10);
}

function eventDotColor(evt) {
  return CATEGORIES[evt.category]?.color ?? evt.color ?? '#6b7280';
}

/* ── Modal ────────────────────────────────────────────────── */
function EventModal({ event, onClose, onSave, onDelete, canAdmin }) {
  const [editing, setEditing] = useState(!event?.id);
  const [form, setForm] = useState(
    event ?? { title:'', description:'', startDate:'', endDate:'', allDay:true, category:'general', location:'', audience:['all'] }
  );

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function submit(e) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div
        initial={{ opacity:0, scale:0.96 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.96 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{event?.id ? (editing ? 'Edit Event' : 'Event Details') : 'New Event'}</h2>
          <div className="flex items-center gap-2">
            {event?.id && canAdmin && !editing && (
              <button onClick={() => setEditing(true)} className="text-slate-500 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50 transition"><Edit2 size={14} /></button>
            )}
            {event?.id && canAdmin && (
              <button onClick={() => onDelete(event.id)} className="text-slate-500 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition"><Trash2 size={14} /></button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"><X size={14} /></button>
          </div>
        </div>

        {editing ? (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
              <input required value={form.title} onChange={e => set('title', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Start Date *</label>
                <input required type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">End Date</label>
                <input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40">
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. School Hall"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={event?.id ? () => setEditing(false) : onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
                Cancel
              </button>
              <button type="submit"
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition flex items-center gap-1.5">
                <Check size={13} /> Save Event
              </button>
            </div>
          </form>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white mb-2"
                style={{ background: eventDotColor(event) }}>
                {CATEGORIES[event.category]?.label ?? event.category}
              </div>
              <h3 className="text-lg font-bold text-slate-900">{event.title}</h3>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2"><Calendar size={14} className="text-slate-400" />
                {fmtDate(event.startDate)}
                {event.endDate && event.endDate !== event.startDate && ` → ${fmtDate(event.endDate)}`}
              </div>
              {event.location && (
                <div className="flex items-center gap-2"><MapPin size={14} className="text-slate-400" />{event.location}</div>
              )}
              {event.audience?.length && (
                <div className="flex items-center gap-2"><Users size={14} className="text-slate-400" />{(event.audience ?? []).join(', ')}</div>
              )}
            </div>
            {event.description && <p className="text-sm text-slate-700 leading-relaxed border-t border-slate-100 pt-3">{event.description}</p>}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function exportEventsCSV(events) {
  const header = ['Title','Category','Start Date','End Date','Location','Audience'];
  const rows = events.map(e => [
    e.title ?? '',
    CATEGORIES[e.category]?.label ?? e.category ?? '',
    e.startDate ?? '',
    e.endDate ?? e.startDate ?? '',
    e.location ?? '',
    Array.isArray(e.audience) ? e.audience.join('; ') : (e.audience ?? ''),
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const el   = document.createElement('a');
  el.href = url;
  el.download = `events_${new Date().toISOString().slice(0,10)}.csv`;
  el.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function EventsPage() {
  const qc         = useQueryClient();
  const user       = useAuthStore(s => s.session?.user);
  const canAdmin   = ADMIN_ROLES.includes(user?.role);

  const [view, setView]           = useState('month');  // month | list
  const [current, setCurrent]     = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selected, setSelected]   = useState(null); // { event? } | null
  const [showNew, setShowNew]     = useState(false);

  /* ── Query ── */
  const { data, isLoading } = useQuery({
    queryKey: ['events', current.year, current.month],
    queryFn:  () => eventsApi.list({
      from: `${current.year}-${String(current.month + 1).padStart(2,'0')}-01`,
      to:   `${current.year}-${String(current.month + 1).padStart(2,'0')}-31`,
    }),
  });
  const events = data?.events ?? [];

  /* For list view: show next 60 days */
  const { data: listData } = useQuery({
    queryKey: ['events', 'upcoming'],
    queryFn:  () => eventsApi.list({ from: new Date().toISOString().slice(0,10) }),
    enabled:  view === 'list',
  });
  const upcomingEvents = listData?.events ?? [];

  /* ── Mutations ── */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['events'] });
  };

  const createMut  = useMutation({ mutationFn: eventsApi.create, onSuccess: invalidate });
  const updateMut  = useMutation({ mutationFn: ({ id, ...d }) => eventsApi.update(id, d), onSuccess: invalidate });
  const deleteMut  = useMutation({ mutationFn: eventsApi.remove, onSuccess: invalidate });

  function handleSave(form) {
    const color = CATEGORIES[form.category]?.color ?? '#4f46e5';
    if (form.id) {
      updateMut.mutate({ ...form, color }, { onSuccess: () => { setSelected(null); setShowNew(false); } });
    } else {
      createMut.mutate({ ...form, color }, { onSuccess: () => { setSelected(null); setShowNew(false); } });
    }
  }

  function handleDelete(id) {
    if (!confirm('Delete this event?')) return;
    deleteMut.mutate(id, { onSuccess: () => { setSelected(null); } });
  }

  /* ── Calendar grid ── */
  const calDays = useMemo(() => {
    const firstDay = new Date(current.year, current.month, 1).getDay();
    const daysInMonth = new Date(current.year, current.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [current]);

  function eventsOnDay(day) {
    if (!day) return [];
    const dateStr = `${current.year}-${String(current.month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return events.filter(e => {
      const s = e.startDate?.slice(0,10);
      const en = (e.endDate || e.startDate)?.slice(0,10);
      return dateStr >= s && dateStr <= en;
    });
  }

  const today = new Date();
  const isToday = (day) => day && today.getFullYear() === current.year && today.getMonth() === current.month && today.getDate() === day;

  function prevMonth() {
    setCurrent(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 });
  }
  function nextMonth() {
    setCurrent(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 });
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Events & Calendar</h1>
          <p className="text-slate-500 text-sm mt-0.5">School events, holidays, and important dates.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setView('month')} className={`p-1.5 rounded-md transition ${view === 'month' ? 'bg-white shadow-sm text-violet-600' : 'text-slate-500 hover:text-slate-700'}`}>
              <LayoutGrid size={15} />
            </button>
            <button onClick={() => setView('list')} className={`p-1.5 rounded-md transition ${view === 'list' ? 'bg-white shadow-sm text-violet-600' : 'text-slate-500 hover:text-slate-700'}`}>
              <List size={15} />
            </button>
          </div>
          {/* Today nav shortcut */}
          <button
            onClick={() => { const d = new Date(); setCurrent({ year: d.getFullYear(), month: d.getMonth() }); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
          >
            Today
          </button>
          <button
            onClick={() => exportEventsCSV(view === 'list' ? upcomingEvents : events)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
            title="Export events CSV"
          >
            <Download size={13} /> Export
          </button>
          {canAdmin && (
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition">
              <Plus size={14} /> Add Event
            </button>
          )}
        </div>
      </div>

      {/* ── MONTH VIEW ── */}
      {view === 'month' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Nav */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronLeft size={16} /></button>
            <h2 className="font-semibold text-slate-900">{MONTHS[current.month]} {current.year}</h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronRight size={16} /></button>
          </div>
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {DAYS.map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400">{d}</div>
            ))}
          </div>
          {/* Cells */}
          <div className="grid grid-cols-7">
            {calDays.map((day, i) => {
              const dayEvts = eventsOnDay(day);
              return (
                <div key={i} className={`min-h-[80px] p-1.5 border-b border-r border-slate-100 ${!day ? 'bg-slate-50/50' : 'hover:bg-slate-50 cursor-pointer'} ${isToday(day) ? 'bg-violet-50/50' : ''}`}
                  onClick={() => day && dayEvts.length && setSelected({ event: dayEvts[0] })}>
                  {day && (
                    <>
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isToday(day) ? 'bg-violet-600 text-white' : 'text-slate-700'}`}>
                        {day}
                      </span>
                      <div className="mt-0.5 space-y-0.5">
                        {dayEvts.slice(0, 2).map(e => (
                          <div key={e.id} onClick={ev => { ev.stopPropagation(); setSelected({ event: e }); }}
                            className="truncate rounded text-[10px] font-medium px-1 py-0.5 text-white cursor-pointer"
                            style={{ background: eventDotColor(e) }}>
                            {e.title}
                          </div>
                        ))}
                        {dayEvts.length > 2 && <div className="text-[9px] text-slate-400 pl-1">+{dayEvts.length - 2} more</div>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-center text-slate-400 py-16 text-sm">Loading events…</p>
          ) : upcomingEvents.length === 0 ? (
            <div className="text-center py-16">
              <Calendar size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 text-sm">No upcoming events.</p>
              {canAdmin && <button onClick={() => setShowNew(true)} className="mt-3 text-violet-600 text-sm hover:underline">Add the first event</button>}
            </div>
          ) : (
            upcomingEvents.map((e, i) => (
              <motion.div key={e.id} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.04 }}
                className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-4 hover:shadow-sm transition cursor-pointer"
                onClick={() => setSelected({ event: e })}>
                <div className="shrink-0 w-1 self-stretch rounded-full" style={{ background: eventDotColor(e) }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-slate-400">{fmtDate(e.startDate)}</span>
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: eventDotColor(e) }}>
                      {CATEGORIES[e.category]?.label ?? e.category}
                    </span>
                  </div>
                  <p className="font-semibold text-slate-900 text-sm truncate">{e.title}</p>
                  {e.location && <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><MapPin size={10} />{e.location}</p>}
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {(selected || showNew) && (
          <EventModal
            event={selected?.event ?? null}
            canAdmin={canAdmin}
            onClose={() => { setSelected(null); setShowNew(false); }}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
