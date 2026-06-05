/* ============================================================
   eLearning — Google Classroom + Zoom Live Sessions
   ============================================================ */
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MonitorPlay, Link2, Link2Off, Plus, Trash2, Loader2,
  BookOpen, Users, BarChart3, Upload, Calendar, Clock,
  CheckCircle2, AlertTriangle, ChevronDown, X, FileText,
  ExternalLink, RefreshCcw, Video, Play, StopCircle,
  Mic, MicOff, WifiOff,
} from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';

/* ── API helpers ─────────────────────────────────────────────── */
const BASE = '/api/elearning';

async function apiFetch(path, opts = {}) {
  const raw   = localStorage.getItem('msingi_session');
  const token = raw ? JSON.parse(raw)?.token : null;
  const res   = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/* ── Small reusable components ───────────────────────────────── */
function Toast({ msg, type, onDismiss }) {
  useEffect(() => { const t = setTimeout(onDismiss, 4000); return () => clearTimeout(t); }, [onDismiss]);
  const ok = type === 'success';
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm border
      ${ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {msg}
      <button onClick={onDismiss} className="ml-2 opacity-50 hover:opacity-100"><X size={12} /></button>
    </div>
  );
}

function WorkTypeBadge({ type }) {
  const map = {
    ASSIGNMENT:           { label: 'Assignment',  cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    SHORT_ANSWER_QUESTION:{ label: 'Question',    cls: 'bg-amber-50 text-amber-700 border-amber-200'   },
    MULTIPLE_CHOICE_QUESTION: { label: 'Quiz',   cls: 'bg-violet-50 text-violet-700 border-violet-200' },
    MATERIAL:             { label: 'Material',    cls: 'bg-slate-50 text-slate-600 border-slate-200'   },
  };
  const { label, cls } = map[type] || map.MATERIAL;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

/* ══════════════════════════════════════════════════════════════
   CONNECT CARD — shown when no Google account is linked
   ══════════════════════════════════════════════════════════════ */
function ConnectCard() {
  function connect() {
    window.location.href = '/api/elearning/auth/connect';
  }
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto">
          <MonitorPlay size={28} className="text-indigo-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Connect Google Classroom</h2>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
            Sign in with your Google Workspace account to link your classes,
            create assignments, and sync grades automatically.
          </p>
        </div>
        <button
          onClick={connect}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-sm font-semibold text-slate-800 shadow-sm transition-all hover:shadow"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
        <p className="text-xs text-slate-400 leading-relaxed">
          Requires a Google Workspace for Education account.<br />
          Your school must have Google Classroom enabled.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LINK COURSE MODAL
   ══════════════════════════════════════════════════════════════ */
function LinkCourseModal({ gcCourses, linkedIds, onLink, onClose }) {
  const qc = useQueryClient();
  const [selected,   setSelected]   = useState(null);
  const [subjectId,  setSubjectId]  = useState('');
  const [classId,    setClassId]    = useState('');
  const [toast,      setToast]      = useState(null);
  const [saving,     setSaving]     = useState(false);

  const { data: subjectsData } = useQuery({
    queryKey: ['subjects'],
    queryFn:  () => fetch('/api/subjects', {
      headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('msingi_session') || '{}')?.token}` }
    }).then(r => r.json()),
  });
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => fetch('/api/classes', {
      headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('msingi_session') || '{}')?.token}` }
    }).then(r => r.json()),
  });

  const subjects = subjectsData?.data || subjectsData?.subjects || [];
  const classes  = classesData?.data  || classesData?.classes  || [];
  const unlinked = gcCourses.filter(c => !linkedIds.has(c.id));

  async function handleLink() {
    if (!selected || !subjectId || !classId) return;
    setSaving(true);
    try {
      const subj = subjects.find(s => (s.id || s._id) === subjectId);
      const cls  = classes.find(c  => (c.id || c._id) === classId);
      await apiFetch('/courses/link', {
        method: 'POST',
        body: {
          gcCourseId:   selected.id,
          gcCourseName: selected.name,
          subjectId,
          subjectName:  subj?.name || '',
          classId,
          className:    cls?.name || '',
        },
      });
      qc.invalidateQueries({ queryKey: ['elearning-courses'] });
      onLink();
    } catch (err) {
      setToast({ type: 'error', msg: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Link Google Classroom Course</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}

          {/* GC course picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Google Classroom Course
            </label>
            {unlinked.length === 0 ? (
              <p className="text-sm text-slate-400">All your active courses are already linked.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {unlinked.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-all border
                      ${selected?.id === c.id
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-700'}`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs flex-shrink-0">
                      {c.name?.[0] || 'C'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.name}</p>
                      {c.section && <p className="text-[11px] text-slate-400">{c.section}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Msingi Subject</label>
            <select value={subjectId} onChange={e => setSubjectId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
              <option value="">Select subject…</option>
              {subjects.map(s => <option key={s.id || s._id} value={s.id || s._id}>{s.name}</option>)}
            </select>
          </div>

          {/* Class */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Msingi Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
              <option value="">Select class…</option>
              {classes.map(c => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 px-6 pb-5">
          <button onClick={onClose} type="button"
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
            Cancel
          </button>
          <button
            onClick={handleLink}
            disabled={saving || !selected || !subjectId || !classId}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
            Link Course
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CREATE COURSEWORK MODAL
   ══════════════════════════════════════════════════════════════ */
function CreateCourseworkModal({ courseId, onCreated, onClose }) {
  const [form, setForm] = useState({
    type:        'ASSIGNMENT',
    title:       '',
    description: '',
    dueDate:     '',
    dueTime:     '23:59',
    scheduledTime: '',
    maxPoints:   '',
    assigneeMode: 'ALL_STUDENTS',
  });
  const [file,    setFile]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const fileRef = useRef();

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setToast({ type: 'error', msg: 'Title is required.' }); return; }
    setSaving(true);
    try {
      let driveFileId = null, driveFileName = null;

      // Step 1: upload file to Drive if one was selected
      if (file) {
        const reader = new FileReader();
        const b64 = await new Promise((res, rej) => {
          reader.onload = e => res(e.target.result);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const uploaded = await apiFetch('/drive/upload', {
          method: 'POST',
          body: { fileBase64: b64, fileName: file.name, mimeType: file.type },
        });
        driveFileId   = uploaded.fileId;
        driveFileName = uploaded.fileName;
      }

      // Step 2: create coursework in GC
      await apiFetch(`/courses/${courseId}/coursework`, {
        method: 'POST',
        body: {
          ...form,
          maxPoints:   form.maxPoints ? Number(form.maxPoints) : undefined,
          scheduledTime: form.scheduledTime || undefined,
          driveFileId,
          driveFileName,
        },
      });

      onCreated();
    } catch (err) {
      setToast({ type: 'error', msg: err.message });
    } finally {
      setSaving(false);
    }
  }

  const iCls = 'w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-semibold text-slate-900">Create Classwork</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'ASSIGNMENT',            label: 'Assignment' },
                { v: 'SHORT_ANSWER_QUESTION', label: 'Question'   },
                { v: 'MATERIAL',              label: 'Material'   },
              ].map(({ v, label }) => (
                <button key={v} type="button" onClick={() => set('type', v)}
                  className={`py-2 rounded-xl text-sm font-medium border transition
                    ${form.type === v ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} className={iCls} placeholder="e.g. Week 3 Assignment" required />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Instructions</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              className={`${iCls} resize-none`} rows={3} placeholder="Assignment instructions…" />
          </div>

          {/* Due date + time (not for materials) */}
          {form.type !== 'MATERIAL' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Due Date</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} className={iCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Due Time</label>
                <input type="time" value={form.dueTime} onChange={e => set('dueTime', e.target.value)} className={iCls} />
              </div>
            </div>
          )}

          {/* Points + scheduled */}
          <div className="grid grid-cols-2 gap-3">
            {form.type !== 'MATERIAL' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Points</label>
                <input type="number" min="0" value={form.maxPoints} onChange={e => set('maxPoints', e.target.value)}
                  className={iCls} placeholder="e.g. 100" />
              </div>
            )}
            <div className={form.type === 'MATERIAL' ? 'col-span-2' : ''}>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Schedule for</label>
              <input type="datetime-local" value={form.scheduledTime} onChange={e => set('scheduledTime', e.target.value)} className={iCls} />
              <p className="text-[10px] text-slate-400 mt-1">Leave blank to publish immediately</p>
            </div>
          </div>

          {/* File attachment */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Attachment (optional)</label>
            <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
            {file ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50">
                <FileText size={14} className="text-indigo-600 shrink-0" />
                <span className="text-sm text-indigo-700 truncate flex-1">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-indigo-400 hover:text-indigo-600"><X size={14} /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                <Upload size={14} /> Upload PDF or file → goes to Google Drive
              </button>
            )}
            <p className="text-[10px] text-slate-400 mt-1.5">File is uploaded to your Google Drive and attached in Google Classroom — not stored in Msingi.</p>
          </div>
        </form>

        <div className="flex gap-2 px-6 pb-5 pt-3 border-t border-slate-100 shrink-0">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>
          <button type="submit" form="cw-form" onClick={handleSubmit} disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {saving ? 'Creating…' : 'Create in Google Classroom'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CLASSWORK TAB
   ══════════════════════════════════════════════════════════════ */
function ClassworkTab({ course }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['elearning-cw', course.gcCourseId],
    queryFn:  () => apiFetch(`/courses/${course.gcCourseId}/coursework`),
    staleTime: 60_000,
  });

  const coursework = data?.coursework || [];

  async function handleDelete(cwId) {
    if (!window.confirm('Delete this from Google Classroom?')) return;
    try {
      await apiFetch(`/courses/${course.gcCourseId}/coursework/${cwId}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['elearning-cw', course.gcCourseId] });
      setToast({ type: 'success', msg: 'Deleted from Google Classroom.' });
    } catch (err) {
      setToast({ type: 'error', msg: err.message });
    }
  }

  function formatDue(cw) {
    if (!cw.dueDate) return null;
    const { year, month, day } = cw.dueDate;
    return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <RefreshCcw size={14} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition shadow-sm">
            <Plus size={14} /> Create
          </button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : coursework.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center">
          <BookOpen size={24} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 font-medium">No classwork yet</p>
          <p className="text-xs text-slate-400 mt-1">Create an assignment, question, or material to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {coursework.map(cw => (
            <div key={cw.id}
              className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-start gap-4 hover:border-indigo-200 transition group">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                {cw.workType === 'MATERIAL' ? <FileText size={16} className="text-indigo-500" /> : <BookOpen size={16} className="text-indigo-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-800 text-sm">{cw.title}</p>
                  <WorkTypeBadge type={cw.workType} />
                  {cw.state === 'DRAFT' && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-500 border-slate-200">Scheduled</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                  {cw.maxPoints != null && <span>{cw.maxPoints} pts</span>}
                  {formatDue(cw) && (
                    <span className="flex items-center gap-1">
                      <Calendar size={11} /> Due {formatDue(cw)}
                    </span>
                  )}
                  {cw.scheduledTime && (
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> Publishes {new Date(cw.scheduledTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <a href={cw.alternateLink} target="_blank" rel="noreferrer"
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                  <ExternalLink size={14} />
                </a>
                <button onClick={() => handleDelete(cw.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCourseworkModal
          courseId={course.gcCourseId}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['elearning-cw', course.gcCourseId] });
            setToast({ type: 'success', msg: 'Created in Google Classroom.' });
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   GRADES TAB — pulls submissions from GC, shows auto-sync status
   ══════════════════════════════════════════════════════════════ */
function GradesTab({ course }) {
  const { data: cwData, isLoading: cwLoading } = useQuery({
    queryKey: ['elearning-cw', course.gcCourseId],
    queryFn:  () => apiFetch(`/courses/${course.gcCourseId}/coursework`),
    staleTime: 60_000,
  });

  const gradeable = (cwData?.coursework || []).filter(cw => cw.workType !== 'MATERIAL' && cw.maxPoints);

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
        <CheckCircle2 size={15} className="text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-sm text-indigo-800">
          Grades are auto-synced from Google Classroom via webhook. When you grade a submission in Google Classroom, it appears here automatically — no manual entry needed.
        </p>
      </div>

      {cwLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : gradeable.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center">
          <BarChart3 size={24} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 font-medium">No graded assignments yet</p>
          <p className="text-xs text-slate-400 mt-1">Create an assignment with a point value to start tracking grades.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Assignment</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Points</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Due</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gradeable.map(cw => {
                const due = cw.dueDate
                  ? new Date(cw.dueDate.year, cw.dueDate.month - 1, cw.dueDate.day)
                      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '—';
                return (
                  <tr key={cw.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-3 font-medium text-slate-800">{cw.title}</td>
                    <td className="px-4 py-3 text-slate-500">{cw.maxPoints}</td>
                    <td className="px-4 py-3 text-slate-500">{due}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                        <CheckCircle2 size={10} /> Auto
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PEOPLE TAB — shows GC roster
   ══════════════════════════════════════════════════════════════ */
function PeopleTab({ course }) {
  const { data, isLoading } = useQuery({
    queryKey: ['elearning-students', course.gcCourseId],
    queryFn:  () => apiFetch(`/gc/students/${course.gcCourseId}`),
    staleTime: 5 * 60_000,
  });

  const students = data?.students || [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
        {students.length} student{students.length !== 1 ? 's' : ''} enrolled in Google Classroom
      </p>
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center">
          <Users size={24} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No students enrolled in this Google Classroom course yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {students.map(s => {
            const name  = s.profile?.name?.fullName || s.profile?.emailAddress || '—';
            const email = s.profile?.emailAddress || '';
            const photo = s.profile?.photoUrl;
            return (
              <div key={s.userId} className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition">
                {photo
                  ? <img src={photo} alt={name} className="w-8 h-8 rounded-full object-cover" />
                  : <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold">{name[0]}</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                  <p className="text-xs text-slate-400 truncate">{email}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SCHEDULE SESSION MODAL
   ══════════════════════════════════════════════════════════════ */
function ScheduleSessionModal({ courseId, onCreated, onClose }) {
  const [form, setForm] = useState({
    title:       '',
    scheduledAt: '',
    duration:    '60',
    agenda:      '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.scheduledAt) {
      setError('Title and date/time are required.');
      return;
    }
    setSaving(true); setError('');
    try {
      await apiFetch(`/courses/${courseId}/sessions`, {
        method: 'POST',
        body: {
          ...form,
          scheduledAt: new Date(form.scheduledAt).toISOString(),
          duration: Number(form.duration),
        },
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const iCls = 'w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Video size={16} className="text-indigo-600" />
            <h2 className="font-semibold text-slate-900">Schedule Live Session</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Session Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              className={iCls} placeholder="e.g. Week 4 Live Class — Photosynthesis" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Date & Time *</label>
              <input type="datetime-local" value={form.scheduledAt} onChange={e => set('scheduledAt', e.target.value)} className={iCls} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Duration (mins)</label>
              <select value={form.duration} onChange={e => set('duration', e.target.value)} className={iCls}>
                {[30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Agenda (optional)</label>
            <textarea value={form.agenda} onChange={e => set('agenda', e.target.value)}
              className={`${iCls} resize-none`} rows={2} placeholder="Topics to cover…" />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <Video size={13} className="text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-800 leading-relaxed">
              A Zoom meeting is created automatically. You get the host link, students get the join link. Attendance is tracked via webhook when students join.
            </p>
          </div>
        </form>

        <div className="flex gap-2 px-6 pb-5">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />}
            {saving ? 'Scheduling…' : 'Schedule on Zoom'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LIVE SESSIONS TAB
   ══════════════════════════════════════════════════════════════ */
function LiveTab({ course }) {
  const qc = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);
  const [toast, setToast] = useState(null);

  const { data: zoomStatus } = useQuery({
    queryKey: ['zoom-status'],
    queryFn:  () => apiFetch('/zoom/status'),
    staleTime: 60_000,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['elearning-sessions', course.gcCourseId],
    queryFn:  () => apiFetch(`/courses/${course.gcCourseId}/sessions`),
    staleTime: 30_000,
  });

  const sessions = data?.sessions || [];
  const now      = new Date();

  const upcoming = sessions.filter(s => s.status !== 'cancelled' && new Date(s.scheduledAt) >= now);
  const past     = sessions.filter(s => s.status === 'ended' || (s.status !== 'cancelled' && new Date(s.scheduledAt) < now));

  async function handleCancel(sessionId) {
    if (!window.confirm('Cancel this session? It will be deleted from Zoom.')) return;
    try {
      await apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['elearning-sessions', course.gcCourseId] });
      setToast({ type: 'success', msg: 'Session cancelled.' });
    } catch (err) {
      setToast({ type: 'error', msg: err.message });
    }
  }

  function StatusBadge({ status }) {
    const map = {
      scheduled: { label: 'Scheduled',  cls: 'bg-blue-50 text-blue-700 border-blue-200'   },
      live:      { label: 'Live now',   cls: 'bg-green-50 text-green-700 border-green-200 animate-pulse' },
      ended:     { label: 'Ended',      cls: 'bg-slate-50 text-slate-500 border-slate-200' },
      cancelled: { label: 'Cancelled',  cls: 'bg-red-50 text-red-600 border-red-200'       },
    };
    const { label, cls } = map[status] || map.scheduled;
    return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
  }

  function SessionCard({ session }) {
    const start = new Date(session.scheduledAt);
    const isLive = session.status === 'live';
    const isUpcoming = session.status === 'scheduled' && start >= now;

    return (
      <div className={`bg-white border rounded-xl px-5 py-4 flex items-start gap-4 transition
        ${isLive ? 'border-green-300 shadow-sm shadow-green-100' : 'border-slate-200 hover:border-indigo-200'}`}>

        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5
          ${isLive ? 'bg-green-100' : 'bg-indigo-50'}`}>
          <Video size={18} className={isLive ? 'text-green-600' : 'text-indigo-500'} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-semibold text-slate-800 text-sm">{session.title}</p>
            <StatusBadge status={session.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar size={11} />
              {start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span>{session.duration} min</span>
            {session.attendees?.length > 0 && (
              <span className="flex items-center gap-1">
                <Users size={11} /> {session.attendees.length} attended
              </span>
            )}
          </div>
          {session.agenda && (
            <p className="text-xs text-slate-400 mt-1 truncate">{session.agenda}</p>
          )}
          {session.recordingUrl && (
            <a href={session.recordingUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition">
              <Play size={11} /> View recording
            </a>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 items-end shrink-0">
          {(isLive || isUpcoming) && (
            <a href={session.zoomHostUrl} target="_blank" rel="noreferrer"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition shadow-sm
                ${isLive ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
              {isLive ? <><Mic size={11} /> In session</> : <><Play size={11} /> Start</>}
            </a>
          )}
          {isUpcoming && (
            <button onClick={() => handleCancel(session.id)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 transition">
              <Trash2 size={11} /> Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!zoomStatus?.configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-8 text-center space-y-3">
        <WifiOff size={24} className="text-amber-500 mx-auto" />
        <p className="font-semibold text-amber-800">Zoom not configured</p>
        <p className="text-sm text-amber-700 max-w-sm mx-auto leading-relaxed">
          Add <code className="bg-amber-100 px-1 rounded text-xs">ZOOM_ACCOUNT_ID</code>,{' '}
          <code className="bg-amber-100 px-1 rounded text-xs">ZOOM_CLIENT_ID</code>, and{' '}
          <code className="bg-amber-100 px-1 rounded text-xs">ZOOM_CLIENT_SECRET</code> to your server environment variables to enable live sessions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>{toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <RefreshCcw size={14} />
          </button>
          <button onClick={() => setShowSchedule(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition shadow-sm">
            <Plus size={14} /> Schedule Session
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : sessions.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center">
          <Video size={24} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 font-medium">No sessions yet</p>
          <p className="text-xs text-slate-400 mt-1">Schedule a Zoom session for this course.</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Upcoming</p>
              {upcoming.map(s => <SessionCard key={s.id} session={s} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Past Sessions</p>
              {past.map(s => <SessionCard key={s.id} session={s} />)}
            </div>
          )}
        </>
      )}

      {showSchedule && (
        <ScheduleSessionModal
          courseId={course.gcCourseId}
          onCreated={() => {
            setShowSchedule(false);
            qc.invalidateQueries({ queryKey: ['elearning-sessions', course.gcCourseId] });
            setToast({ type: 'success', msg: 'Session scheduled on Zoom.' });
          }}
          onClose={() => setShowSchedule(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function ELearningPage() {
  const location = useLocation();
  const qc       = useQueryClient();

  const [activeCourse, setActiveCourse] = useState(null);
  const [activeTab,    setActiveTab]    = useState('classwork');
  const [showLink,     setShowLink]     = useState(false);
  const [toast,        setToast]        = useState(null);

  /* Handle OAuth redirect params */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('gc_connected') === '1') {
      setToast({ type: 'success', msg: 'Google Classroom connected successfully!' });
      window.history.replaceState({}, '', '/elearning');
      qc.invalidateQueries({ queryKey: ['elearning-status'] });
    }
    if (params.get('gc_error')) {
      const msgs = { denied: 'Google sign-in was cancelled.', failed: 'Connection failed. Please try again.', invalid_state: 'Invalid state. Please try again.' };
      setToast({ type: 'error', msg: msgs[params.get('gc_error')] || 'Connection failed.' });
      window.history.replaceState({}, '', '/elearning');
    }
  }, [location.search, qc]);

  /* Auth status */
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['elearning-status'],
    queryFn:  () => apiFetch('/auth/status'),
    staleTime: 5 * 60_000,
  });
  const connected = statusData?.connected === true;

  /* Linked courses */
  const { data: coursesData, isLoading: coursesLoading } = useQuery({
    queryKey: ['elearning-courses'],
    queryFn:  () => apiFetch('/courses'),
    enabled:  connected,
    staleTime: 60_000,
  });
  const linkedCourses = coursesData?.courses || [];

  /* GC courses (for link modal) */
  const { data: gcCoursesData } = useQuery({
    queryKey: ['elearning-gc-courses'],
    queryFn:  () => apiFetch('/gc/courses'),
    enabled:  connected && showLink,
    staleTime: 60_000,
  });
  const gcCourses  = gcCoursesData?.courses || [];
  const linkedIds  = new Set(linkedCourses.map(c => c.gcCourseId));

  async function handleUnlink(id) {
    if (!window.confirm('Unlink this course from Msingi? The course stays in Google Classroom.')) return;
    try {
      await apiFetch(`/courses/${id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['elearning-courses'] });
      if (activeCourse?._id === id) setActiveCourse(null);
      setToast({ type: 'success', msg: 'Course unlinked.' });
    } catch (err) {
      setToast({ type: 'error', msg: err.message });
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect your Google account from Msingi eLearning?')) return;
    try {
      await apiFetch('/auth/disconnect', { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['elearning-status'] });
      qc.invalidateQueries({ queryKey: ['elearning-courses'] });
      setActiveCourse(null);
    } catch (err) {
      setToast({ type: 'error', msg: err.message });
    }
  }

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!connected) return <ConnectCard />;

  const TABS = [
    { id: 'classwork', label: 'Classwork', Icon: BookOpen  },
    { id: 'live',      label: 'Live',      Icon: Video     },
    { id: 'people',    label: 'People',    Icon: Users     },
    { id: 'grades',    label: 'Grades',    Icon: BarChart3 },
  ];

  return (
    <div className="flex h-full">
      {/* ── Left sidebar — course list ─────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden">
        {/* Account header */}
        <div className="px-4 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <MonitorPlay size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-800 truncate">eLearning</p>
            <p className="text-[10px] text-slate-400 truncate">{statusData?.googleEmail}</p>
          </div>
          <button onClick={handleDisconnect} title="Disconnect Google account"
            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0">
            <Link2Off size={13} />
          </button>
        </div>

        {/* Course list */}
        <div className="flex-1 overflow-y-auto py-2">
          {coursesLoading
            ? <div className="px-4 py-2 space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}</div>
            : linkedCourses.length === 0
              ? <div className="px-4 py-6 text-center"><p className="text-xs text-slate-400">No courses linked yet.</p></div>
              : linkedCourses.map(c => (
                  <div key={c._id}
                    className={`group flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-xl cursor-pointer transition
                      ${activeCourse?._id === c._id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'}`}
                    onClick={() => { setActiveCourse(c); setActiveTab('classwork'); }}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0
                      ${activeCourse?._id === c._id ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-100 text-slate-600'}`}>
                      {c.gcCourseName?.[0] || 'C'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{c.gcCourseName}</p>
                      <p className="text-[10px] text-slate-400 truncate">{c.subjectName} · {c.className}</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleUnlink(c._id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
          }
        </div>

        {/* Link course button */}
        <div className="px-3 py-3 border-t border-slate-100">
          <button onClick={() => setShowLink(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-600 text-xs font-semibold hover:bg-indigo-50 transition">
            <Link2 size={12} /> Link a course
          </button>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-slate-50">
        {!activeCourse ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <MonitorPlay size={32} className="text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">Select a course</p>
            <p className="text-sm text-slate-400 mt-1">
              {linkedCourses.length === 0
                ? 'Link a Google Classroom course to get started.'
                : 'Pick a course from the left to manage classwork and grades.'}
            </p>
            {linkedCourses.length === 0 && (
              <button onClick={() => setShowLink(true)}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition">
                <Link2 size={14} /> Link your first course
              </button>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6">
            {/* Course header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-slate-900">{activeCourse.gcCourseName}</h1>
                <a href={`https://classroom.google.com/c/${activeCourse.gcCourseId}`} target="_blank" rel="noreferrer"
                  className="text-slate-400 hover:text-indigo-600 transition">
                  <ExternalLink size={14} />
                </a>
              </div>
              <p className="text-sm text-slate-500">{activeCourse.subjectName} · {activeCourse.className}</p>
            </div>

            {/* Toast */}
            {toast && (
              <div className="mb-4">
                <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-0 border-b border-slate-200 mb-6">
              {TABS.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px
                    ${activeTab === id
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'classwork' && <ClassworkTab course={activeCourse} />}
            {activeTab === 'live'      && <LiveTab      course={activeCourse} />}
            {activeTab === 'people'    && <PeopleTab    course={activeCourse} />}
            {activeTab === 'grades'    && <GradesTab    course={activeCourse} />}
          </div>
        )}
      </main>

      {/* Modals */}
      {showLink && (
        <LinkCourseModal
          gcCourses={gcCourses}
          linkedIds={linkedIds}
          onLink={() => { setShowLink(false); qc.invalidateQueries({ queryKey: ['elearning-courses'] }); }}
          onClose={() => setShowLink(false)}
        />
      )}
    </div>
  );
}
