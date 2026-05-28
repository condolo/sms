/* ============================================================
   ProjectsSection — Growth Profile projects with supervisor ref.
   Supervisor name is denormalized at save time.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit2, Trash2, X, Save, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  growthProfile as gpApi,
  teachers        as teachersApi,
} from '@/api/client.js';
import VerificationBadge from '../components/VerificationBadge.jsx';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

const STATUS_LABELS = { planning: 'Planning', in_progress: 'In Progress', completed: 'Completed', published: 'Published' };
const STATUS_COLORS = {
  planning:    'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-50 text-blue-700',
  completed:   'bg-emerald-50 text-emerald-700',
  published:   'bg-violet-50 text-violet-700',
};

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function ProjectCard({ project, canEdit, canVerify, isAdmin, onEdit, onDelete, onVerify, isVerifying }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50/50 transition" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800">{project.title}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[project.status] ?? 'bg-slate-100 text-slate-500'}`}>
              {STATUS_LABELS[project.status] ?? project.status}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {project.category && <span className="text-xs text-slate-500">{project.category}</span>}
            {project.supervisorName && <span className="text-xs text-slate-400">Supervisor: {project.supervisorName}</span>}
            {project.startDate && <span className="text-xs text-slate-400">{fmtDate(project.startDate)}{project.endDate ? ` — ${fmtDate(project.endDate)}` : ''}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <VerificationBadge status={project.verificationStatus} canVerify={canVerify} onVerify={(status, notes) => onVerify(project, status, notes)} isPending={isVerifying} isAdmin={isAdmin} />
          {canEdit && (
            <>
              <button onClick={() => onEdit(project)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition" title="Edit"><Edit2 size={13} /></button>
              <button onClick={() => onDelete(project)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition" title="Delete"><Trash2 size={13} /></button>
            </>
          )}
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2 text-sm text-slate-600">
              {project.description && <p className="leading-relaxed">{project.description}</p>}
              {project.outcome && (
                <p className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg inline-block">{project.outcome}</p>
              )}
              {project.subjectArea && <p className="text-xs text-slate-400">Subject area: {project.subjectArea}</p>}
              {project.evidenceUrls && project.evidenceUrls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {project.evidenceUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <ExternalLink size={10} /> Evidence {i + 1}
                    </a>
                  ))}
                </div>
              )}
              {project.verificationNotes && <p className="text-xs text-slate-400 italic">{project.verificationNotes}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ProjectForm({ studentId, initial = null, onClose }) {
  const [form, setForm] = useState(initial ?? { title: '', description: '', category: '', subjectArea: '', supervisorId: '', supervisorName: '', startDate: '', endDate: '', status: 'in_progress', outcome: '', evidenceUrls: [], isPublic: true });
  const [urlInput, setUrlInput] = useState('');
  const [error, setError]       = useState(null);
  const qc = useQueryClient();
  const isEdit = !!initial?.id;

  /* Supervisor picker */
  const { data: teacherData } = useQuery({
    queryKey: ['teachers'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teachers = teacherData?.data ?? [];

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit ? gpApi.projects.update(initial.id, data) : gpApi.projects.create({ ...data, studentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-projects', studentId] });
      qc.invalidateQueries({ queryKey: ['growth-profile', studentId] });
      onClose();
    },
    onError: (e) => setError(e.message ?? 'Failed to save'),
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function addUrl() {
    if (!urlInput.trim()) return;
    try { new URL(urlInput.trim()); } catch { setError('Invalid URL'); return; }
    setForm(f => ({ ...f, evidenceUrls: [...(f.evidenceUrls ?? []), urlInput.trim()] }));
    setUrlInput('');
  }

  function handleSupervisorChange(e) {
    const id = e.target.value;
    const t  = teachers.find(t => t.id === id);
    setForm(f => ({
      ...f,
      supervisorId:   id,
      supervisorName: t ? `${t.title ? t.title + ' ' : ''}${t.firstName} ${t.lastName}`.trim() : '',
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    mutate(form);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="bg-slate-50 border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-slate-800">{isEdit ? 'Edit Project' : 'Add Project'}</h4>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition"><X size={14} /></button>
      </div>
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Project title *</label>
            <input className={iCls()} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Solar-Powered Water Purifier" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select className={iCls()} value={form.status} onChange={e => set('status', e.target.value)}>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <input className={iCls()} value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. STEM, Social Enterprise" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Subject area</label>
            <input className={iCls()} value={form.subjectArea} onChange={e => set('subjectArea', e.target.value)} placeholder="e.g. Physics, Computer Science" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Supervisor</label>
            <select className={iCls()} value={form.supervisorId} onChange={handleSupervisorChange}>
              <option value="">Select supervisor</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title ? `${t.title} ` : ''}{t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Start date</label>
            <input type="date" className={iCls()} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">End date</label>
            <input type="date" className={iCls()} value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
          <textarea rows={3} className={`${iCls()} resize-none`} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Project overview, methodology, goals…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Outcome / results</label>
          <input className={iCls()} value={form.outcome} onChange={e => set('outcome', e.target.value)} placeholder="What did the project achieve?" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Evidence links (up to 5)</label>
          <div className="flex gap-2">
            <input className={`${iCls()} flex-1`} value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://…" />
            <button type="button" onClick={addUrl} className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 transition">Add</button>
          </div>
          {form.evidenceUrls && form.evidenceUrls.length > 0 && (
            <ul className="mt-2 space-y-1">
              {form.evidenceUrls.map((url, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-blue-600">
                  <span className="truncate flex-1">{url}</span>
                  <button type="button" onClick={() => setForm(f => ({ ...f, evidenceUrls: f.evidenceUrls.filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-red-500"><X size={10} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={isPending} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add project'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
        </div>
      </form>
    </motion.div>
  );
}

export default function ProjectsSection({ studentId, canEdit, canVerify, isAdmin }) {
  const [showForm, setShowForm]     = useState(false);
  const [editProject, setEdit]      = useState(null);
  const [deleteTarget, setDelete]   = useState(null);
  const [verifyingId, setVerifying] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['growth-projects', studentId],
    queryFn:  () => gpApi.projects.list({ studentId, limit: 100 }),
    enabled:  !!studentId,
    staleTime: 2 * 60_000,
  });
  const projects = data?.data ?? [];

  const { mutate: deleteProject, isPending: deleting } = useMutation({
    mutationFn: (id) => gpApi.projects.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['growth-projects', studentId] }); qc.invalidateQueries({ queryKey: ['growth-profile', studentId] }); setDelete(null); },
  });

  const { mutate: verifyProject } = useMutation({
    mutationFn: ({ id, status, notes }) => gpApi.projects.verify(id, { status, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['growth-projects', studentId] }); setVerifying(null); },
    onMutate: ({ id }) => setVerifying(id),
    onError: () => setVerifying(null),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        {canEdit && !showForm && !editProject && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition">
            <Plus size={13} /> Add project
          </button>
        )}
      </div>

      <AnimatePresence>
        {showForm && <ProjectForm studentId={studentId} onClose={() => setShowForm(false)} />}
        {editProject && <ProjectForm studentId={studentId} initial={editProject} onClose={() => setEdit(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-red-700">Delete this project?</p>
              <p className="text-xs text-red-500 mt-0.5">"{deleteTarget.title}" — this cannot be undone.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => deleteProject(deleteTarget.id)} disabled={deleting} className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">{deleting ? 'Deleting…' : 'Delete'}</button>
              <button onClick={() => setDelete(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {projects.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-slate-600">No projects yet</p>
          <p className="text-xs text-slate-400 mt-1">Research, STEM, entrepreneurship, and independent study projects.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {projects.map(p => (
              <ProjectCard key={p.id ?? p._id} project={p} canEdit={canEdit} canVerify={canVerify} isAdmin={isAdmin}
                onEdit={setEdit} onDelete={setDelete}
                onVerify={(proj, status, notes) => verifyProject({ id: proj.id, status, notes })}
                isVerifying={verifyingId === p.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
