/* ============================================================
   Class Detail — manages streams within a year group
   Route: /classes/:classId
   ============================================================ */
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, BookOpen, Users, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Home,
  Hash, UserCheck, Layers, ChevronRight, Pencil,
  Search, UserPlus, UserMinus,
} from 'lucide-react';
import { classes as classesApi, streams as streamsApi, teachers as teachersApi, students as studentsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { useSections } from '@/hooks/useSections.js';

const STREAM_COLORS = [
  'from-violet-500 to-purple-600','from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',    'from-indigo-500 to-blue-600',
  'from-teal-500 to-cyan-500',    'from-orange-500 to-red-500',
];
function streamColor(name='') { return STREAM_COLORS[(name.charCodeAt(0)||0) % STREAM_COLORS.length]; }

/* ══════════════════════════════════════════════════════════ */
export default function ClassDetail() {
  const { classId } = useParams();
  const qc          = useQueryClient();
  const navigate    = useNavigate();
  const can         = useAuthStore(s => s.can.bind(s));
  const role        = useAuthStore(s => s.session?.user?.role ?? '');
  const canManage   = can('classes') || role === 'admin' || role === 'superadmin';

  const { sectionMap } = useSections();
  const [showAdd,              setShowAdd]              = useState(false);
  const [editTarget,           setEditTarget]           = useState(null);
  const [deleteTarget,         setDeleteTarget]         = useState(null);
  const [streamStudentsTarget, setStreamStudentsTarget] = useState(null);

  const { data: clsData, isLoading: clsLoading, isError: clsError, error: clsErrorObj } = useQuery({
    queryKey: ['classes', classId],
    queryFn:  () => classesApi.get(classId),
    staleTime: 5 * 60_000,
  });
  const cls = clsData?.data ?? null;

  const { data: streamData, isLoading: streamsLoading, isError: streamsError, refetch: refetchStreams } = useQuery({
    queryKey: ['streams', { classId }],
    queryFn:  () => streamsApi.list({ classId, limit: 200 }),
    staleTime: 60_000,
    enabled:  !!classId,
  });
  const streamRows = streamData?.data ?? [];

  const { mutate: deleteStream, isPending: deleting } = useMutation({
    mutationFn: id => streamsApi.remove(id),
    onSuccess:  () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['streams', { classId }] }); },
    onError:    err => alert(err?.message ?? 'Failed to delete stream'),
  });

  if (clsLoading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-slate-400" />
    </div>
  );

  if (clsError || !cls) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
      <AlertTriangle size={28} className="text-red-400" />
      <p className="text-sm text-slate-600 font-medium">
        {clsError ? (clsErrorObj?.message ?? 'Failed to load class') : 'Class not found'}
      </p>
      {clsError && clsErrorObj?.status !== 404 && (
        <p className="text-xs text-slate-400">Error {clsErrorObj?.status ?? ''} · Check console for details</p>
      )}
      <Link to="/classes" className="text-xs text-violet-600 hover:text-violet-800 font-medium">
        ← Back to Classes
      </Link>
    </div>
  );

  const sec = cls.sectionKey ? sectionMap[cls.sectionKey] : null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate('/classes')}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ArrowLeft size={15} /> Classes
            </button>
            <span className="text-slate-300">/</span>
            <span className="text-sm font-medium text-slate-700">{cls.name}</span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shrink-0">
                <BookOpen size={20} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-semibold text-slate-900">{cls.name}</h1>
                  {sec && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: sec.color + '18', color: sec.color }}>
                      {sec.name}
                    </span>
                  )}
                </div>
                {cls.description && (
                  <p className="text-sm text-slate-500 mt-0.5">{cls.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  {streamRows.length} stream{streamRows.length !== 1 ? 's' : ''} ·{' '}
                  {streamRows.reduce((sum, s) => sum + (s.studentCount ?? 0), 0).toLocaleString()} students
                </p>
              </div>
            </div>

            {canManage && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0"
              >
                <Plus size={15} /> Add Stream
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Streams grid */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {streamsLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-slate-100 mb-4" />
                <div className="h-4 bg-slate-100 rounded w-20 mb-2" />
                <div className="h-3 bg-slate-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : streamsError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <AlertTriangle size={24} className="text-red-400" />
            <p className="text-sm text-slate-500">Failed to load streams</p>
            <button onClick={refetchStreams} className="text-xs font-medium text-slate-700 underline">Retry</button>
          </div>
        ) : streamRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Layers size={36} className="mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">No streams yet</p>
            <p className="text-xs mt-1 text-center">
              Streams are teaching groups within <span className="font-medium">{cls.name}</span> (e.g. A, B, East)
            </p>
            {canManage && (
              <button onClick={() => setShowAdd(true)} className="mt-4 flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-800 transition">
                <Plus size={14} /> Add first stream
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {streamRows.map(s => {
              const id  = s.id ?? s._id;
              const col = streamColor(s.name);
              const cap = Number(s.capacity) || 0;
              const cnt = Number(s.studentCount) || 0;
              const fillPct   = cap > 0 ? Math.min(Math.round((cnt / cap) * 100), 100) : 0;
              const fillColor = fillPct >= 100 ? 'bg-red-500' : fillPct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
              return (
                <motion.div
                  key={id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-xl border border-slate-200 hover:shadow-md hover:border-slate-300 transition-all group relative overflow-hidden"
                >
                  <div className={`h-1 bg-gradient-to-r ${col}`} />

                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${col} flex items-center justify-center shrink-0`}>
                        <span className="text-white text-sm font-bold">{s.name.charAt(0).toUpperCase()}</span>
                      </div>
                      {canManage && (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                          <button
                            onClick={() => setEditTarget(s)}
                            className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition"
                            title="Edit stream"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(s)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                            title="Delete stream"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-3">
                      <h3 className="font-semibold text-slate-900">Stream {s.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{cls.name}</p>
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Users size={12} className="shrink-0" />
                        <span>{cnt.toLocaleString()} student{cnt !== 1 ? 's' : ''}</span>
                        {cap > 0 && (
                          <span className={`ml-auto text-[10px] font-semibold ${fillPct >= 100 ? 'text-red-500' : fillPct >= 80 ? 'text-amber-500' : 'text-emerald-600'}`}>
                            {fillPct}%
                          </span>
                        )}
                      </div>
                      {cap > 0 && (
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-1.5 rounded-full transition-all ${fillColor}`} style={{ width: `${fillPct}%` }} />
                        </div>
                      )}
                      {s.teacherName && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <UserCheck size={12} className="shrink-0" />
                          <span className="truncate">{s.teacherName}</span>
                        </div>
                      )}
                      {s.room && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Home size={12} className="shrink-0" />
                          <span>{s.room}</span>
                        </div>
                      )}
                      {cap > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Hash size={12} className="shrink-0" />
                          <span>Capacity: {cap}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <button
                        onClick={() => setStreamStudentsTarget(s)}
                        className="text-xs font-medium text-violet-600 hover:text-violet-800 transition flex items-center gap-1"
                      >
                        <Users size={11} />
                        View / assign students
                        <ChevronRight size={10} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddStreamSlideOver
            cls={cls}
            onClose={() => setShowAdd(false)}
            onCreated={() => {
              setShowAdd(false);
              qc.invalidateQueries({ queryKey: ['streams', { classId }] });
              qc.invalidateQueries({ queryKey: ['classes', 'list'] });
            }}
          />
        )}
        {editTarget && (
          <EditStreamSlideOver
            stream={editTarget}
            cls={cls}
            onClose={() => setEditTarget(null)}
            onSaved={() => {
              setEditTarget(null);
              qc.invalidateQueries({ queryKey: ['streams', { classId }] });
            }}
          />
        )}
        {streamStudentsTarget && (
          <StreamStudentsPanel
            stream={streamStudentsTarget}
            cls={cls}
            onClose={() => setStreamStudentsTarget(null)}
          />
        )}
        {deleteTarget && (
          <DeleteStreamModal
            stream={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => deleteStream(deleteTarget.id ?? deleteTarget._id)}
            isLoading={deleting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Delete Stream Modal ──────────────────────────────────── */
function DeleteStreamModal({ stream, onClose, onConfirm, isLoading }) {
  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
              <Trash2 size={18} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Delete Stream</h3>
              <p className="text-xs text-slate-500 mt-0.5">This cannot be undone</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-5">
            Delete <span className="font-medium text-slate-900">Stream {stream.name}</span>?
            {(stream.studentCount ?? 0) > 0 && (
              <span className="block mt-1 text-amber-600 text-xs">
                This stream has {stream.studentCount} active student{stream.studentCount !== 1 ? 's' : ''} — reassign them first.
              </span>
            )}
          </p>
          <div className="flex items-center gap-3 justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading || (stream.studentCount ?? 0) > 0}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ── Add Stream Slide-Over ────────────────────────────────── */
const EMPTY_STREAM = { name:'', formTeacherId:'', room:'', capacity:'', status:'active' };

function AddStreamSlideOver({ cls, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_STREAM);
  const [errors, setErrors] = useState({});

  const { data: teachersData } = useQuery({
    queryKey: ['teachers', { limit: 200, status: 'active' }],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teacherList = teachersData?.data ?? [];

  const mutation = useMutation({
    mutationFn: data => streamsApi.create({
      ...data,
      classId:  cls.id,
      capacity: data.capacity ? Number(data.capacity) : undefined,
    }),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create stream' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n={...e}; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Stream name is required';
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate(form);
  }

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Stream</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Teaching group within <span className="font-medium text-slate-600">{cls.name}</span>
              {cls.sectionKey && <span> · Section inherited</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          <FField label="Stream Name *" error={errors.name}
            hint="e.g. A, B, East, Red — a short label to identify this teaching group">
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. A" className={iCls(errors.name)} />
          </FField>

          <FField label="Form Teacher">
            <select value={form.formTeacherId} onChange={e => set('formTeacherId', e.target.value)} className={iCls()}>
              <option value="">No teacher assigned</option>
              {teacherList.map(t => (
                <option key={t.id ?? t._id} value={t.id ?? t._id}>
                  {t.title ? `${t.title} ` : ''}{t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </FField>

          <div className="grid grid-cols-2 gap-4">
            <FField label="Room">
              <input value={form.room} onChange={e => set('room', e.target.value)}
                placeholder="e.g. Room 12" className={iCls()} />
            </FField>
            <FField label="Capacity">
              <input type="number" min="1" max="500" value={form.capacity}
                onChange={e => set('capacity', e.target.value)}
                placeholder="Max students" className={iCls()} />
            </FField>
          </div>

          <FField label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Stream'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

function FField({ label, error, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-slate-400">{hint}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
function iCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'} bg-white focus:outline-none focus:ring-2 ${error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'} text-slate-800 placeholder-slate-400 transition`;
}

/* ── Edit Stream Slide-Over ───────────────────────────────── */
function EditStreamSlideOver({ stream, cls, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:          stream.name          ?? '',
    formTeacherId: stream.formTeacherId ?? '',
    room:          stream.room          ?? '',
    capacity:      stream.capacity != null ? String(stream.capacity) : '',
    status:        stream.status        ?? 'active',
  });
  const [errors, setErrors] = useState({});

  const { data: teachersData } = useQuery({
    queryKey: ['teachers', { limit: 200, status: 'active' }],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teacherList = teachersData?.data ?? [];

  const mutation = useMutation({
    mutationFn: data => streamsApi.update(stream.id ?? stream._id, {
      ...data,
      capacity: data.capacity ? Number(data.capacity) : undefined,
    }),
    onSuccess:  onSaved,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to update stream' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n={...e}; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Stream name is required';
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate(form);
  }

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Edit Stream</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Stream {stream.name} · <span className="font-medium text-slate-600">{cls.name}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          <FField label="Stream Name *" error={errors.name}
            hint="e.g. A, B, East, Red — a short label to identify this teaching group">
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. A" className={iCls(errors.name)} />
          </FField>

          <FField label="Form Teacher">
            <select value={form.formTeacherId} onChange={e => set('formTeacherId', e.target.value)} className={iCls()}>
              <option value="">No teacher assigned</option>
              {teacherList.map(t => (
                <option key={t.id ?? t._id} value={t.id ?? t._id}>
                  {t.title ? `${t.title} ` : ''}{t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </FField>

          <div className="grid grid-cols-2 gap-4">
            <FField label="Room">
              <input value={form.room} onChange={e => set('room', e.target.value)}
                placeholder="e.g. Room 12" className={iCls()} />
            </FField>
            <FField label="Capacity">
              <input type="number" min="1" max="500" value={form.capacity}
                onChange={e => set('capacity', e.target.value)}
                placeholder="Max students" className={iCls()} />
            </FField>
          </div>

          <FField label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Stream Students Panel ────────────────────────────────── */
function StreamStudentsPanel({ stream, cls, onClose }) {
  const qc = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [search,     setSearch]     = useState('');
  const [toast,      setToast]      = useState(null);

  const streamId = stream.id ?? stream._id;
  const classId  = cls.id ?? cls._id;

  const { data: streamStudentsData, isLoading: loadingStream, refetch: refetchStream } = useQuery({
    queryKey: ['stream-students', streamId],
    queryFn:  () => streamsApi.students(streamId, { limit: 200, status: 'active' }),
    staleTime: 30_000,
  });
  const streamStudents = streamStudentsData?.data ?? [];

  const { data: classStudentsData, isLoading: loadingClass } = useQuery({
    queryKey: ['class-students-unassigned', classId, streamId],
    queryFn:  () => studentsApi.list({ classId, limit: 300, status: 'active' }),
    enabled:  showPicker,
    staleTime: 30_000,
  });
  const classStudents = classStudentsData?.data ?? [];
  const streamStudentIds = new Set(streamStudents.map(s => s.id ?? s._id));
  const unassigned = classStudents.filter(s => {
    const id = s.id ?? s._id;
    if (streamStudentIds.has(id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
           (s.admissionNumber ?? '').toLowerCase().includes(q);
  });

  const { mutate: assign, isPending: assigning } = useMutation({
    mutationFn: studentId => studentsApi.update(studentId, {
      streamId:   streamId,
      streamName: stream.name,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stream-students', streamId] });
      qc.invalidateQueries({ queryKey: ['class-students-unassigned', classId, streamId] });
      qc.invalidateQueries({ queryKey: ['streams', { classId }] });
      setToast({ msg: 'Student assigned to stream', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to assign student', type: 'error' }),
  });

  const { mutate: unassign, isPending: unassigning } = useMutation({
    mutationFn: studentId => studentsApi.update(studentId, {
      streamId:   null,
      streamName: null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stream-students', streamId] });
      qc.invalidateQueries({ queryKey: ['class-students-unassigned', classId, streamId] });
      qc.invalidateQueries({ queryKey: ['streams', { classId }] });
      setToast({ msg: 'Student removed from stream', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to remove student', type: 'error' }),
  });

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Stream {stream.name} — Students</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              <span className="font-medium text-slate-600">{cls.name}</span> · {streamStudents.length} enrolled
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
              className={`mx-6 mt-4 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm ${
                toast.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                         : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {toast.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Assign button */}
        <div className="px-6 pt-4 pb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Enrolled students</span>
          <button
            onClick={() => setShowPicker(p => !p)}
            className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 transition"
          >
            <UserPlus size={13} />
            {showPicker ? 'Hide picker' : 'Assign student'}
          </button>
        </div>

        {/* Inline student picker */}
        <AnimatePresence>
          {showPicker && (
            <motion.div
              initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }}
              className="overflow-hidden border-b border-slate-100"
            >
              <div className="px-6 pb-4 space-y-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or admission number…"
                    className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400"
                  />
                </div>
                {loadingClass ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <Loader2 size={12} className="animate-spin" /> Loading class students…
                  </div>
                ) : unassigned.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">
                    {search ? 'No matching students' : 'All students in this class are already assigned to a stream'}
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {unassigned.map(st => (
                      <div key={st.id ?? st._id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{st.firstName} {st.lastName}</p>
                          {st.admissionNumber && (
                            <p className="text-[11px] text-slate-400">{st.admissionNumber}</p>
                          )}
                        </div>
                        <button
                          onClick={() => assign(st.id ?? st._id)}
                          disabled={assigning}
                          className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800 disabled:opacity-50 transition shrink-0"
                        >
                          {assigning ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />}
                          Assign
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current stream students */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loadingStream ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
              <Loader2 size={12} className="animate-spin" /> Loading students…
            </div>
          ) : streamStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Users size={28} className="mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-600">No students in this stream</p>
              <p className="text-xs mt-1">Use "Assign student" above to add students from {cls.name}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {streamStudents.map(st => (
                <div key={st.id ?? st._id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{st.firstName} {st.lastName}</p>
                    <p className="text-[11px] text-slate-400">
                      {[st.admissionNumber, st.gender].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button
                    onClick={() => unassign(st.id ?? st._id)}
                    disabled={unassigning}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-500 disabled:opacity-50 transition shrink-0"
                    title="Remove from stream"
                  >
                    {unassigning ? <Loader2 size={11} className="animate-spin" /> : <UserMinus size={11} />}
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <p className="text-xs text-slate-400">{streamStudents.length} student{streamStudents.length !== 1 ? 's' : ''} enrolled</p>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Close
          </button>
        </div>
      </motion.div>
    </>
  );
}
