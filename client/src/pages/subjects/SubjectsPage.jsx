/* ============================================================
   SubjectsPage — Department + Subject Registry
   Admin-editable. Grouped by department.
   HoD assignment, section pills, compulsory toggle.
   ============================================================ */
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Search,
  X, BookOpen, Users, Library, AlertTriangle, Check,
} from 'lucide-react';
import clsx from 'clsx';
import { departments as deptsApi, subjects as subsApi, teachers as teachersApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── helpers ─────────────────────────────────────────────── */
const SECTIONS = [
  { value: 'all',       label: 'All Sections' },
  { value: 'kg',        label: 'KG / Pre-Primary' },
  { value: 'primary',   label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'alevel',    label: 'A-Level' },
];

const SECTION_COLORS = {
  all:       'bg-slate-100 text-slate-700',
  kg:        'bg-pink-100 text-pink-700',
  primary:   'bg-blue-100 text-blue-700',
  secondary: 'bg-violet-100 text-violet-700',
  alevel:    'bg-amber-100 text-amber-700',
};

const DEPT_COLORS = [
  '#6366F1','#0EA5E9','#10B981','#F59E0B','#EC4899',
  '#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316',
];

function canEdit(role) {
  return ['superadmin','admin','deputy'].includes(role);
}

/* ── small reusable ──────────────────────────────────────── */
function SectionPill({ value }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', SECTION_COLORS[value] ?? 'bg-slate-100 text-slate-700')}>
      {SECTIONS.find(s => s.value === value)?.label ?? value}
    </span>
  );
}

function ColorDot({ color, size = 'md' }) {
  return (
    <span
      className={clsx('inline-block shrink-0 rounded-full', size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')}
      style={{ backgroundColor: color ?? '#94a3b8' }}
    />
  );
}

/* ── Department slide-over form ───────────────────────────── */
function DeptForm({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    name:        initial?.name        ?? '',
    code:        initial?.code        ?? '',
    color:       initial?.color       ?? DEPT_COLORS[0],
    hodName:     initial?.hodName     ?? '',
    description: initial?.description ?? '',
    order:       initial?.order       ?? 0,
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">
          {initial ? 'Edit Department' : 'New Department'}
        </h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Department Name <span className="text-red-500">*</span></label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="e.g. Mathematics"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Code <span className="text-red-500">*</span></label>
            <input
              value={form.code}
              onChange={e => set('code', e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. MATH"
              maxLength={20}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Order</label>
            <input
              type="number"
              min={0}
              value={form.order}
              onChange={e => set('order', parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Colour</label>
          <div className="flex flex-wrap gap-2">
            {DEPT_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', c)}
                className={clsx('h-7 w-7 rounded-full border-2 transition', form.color === c ? 'border-slate-900 scale-110' : 'border-transparent')}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={form.color}
              onChange={e => set('color', e.target.value)}
              className="h-7 w-7 cursor-pointer rounded-full border border-slate-300 p-0.5"
              title="Custom colour"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Head of Department (HoD)</label>
          <input
            value={form.hodName}
            onChange={e => set('hodName', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Name of department head"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            placeholder="Optional department description"
            maxLength={500}
          />
        </div>
      </div>

      <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200 transition">Cancel</button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim() || !form.code.trim()}
          className="px-4 py-2 rounded-lg text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium"
        >
          {saving ? 'Saving…' : 'Save Department'}
        </button>
      </div>
    </div>
  );
}

/* ── Subject slide-over form ──────────────────────────────── */
function SubjectForm({ initial, departments, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    name:         initial?.name         ?? '',
    code:         initial?.code         ?? '',
    shortName:    initial?.shortName    ?? '',
    departmentId: initial?.departmentId ?? (departments[0]?.id ?? ''),
    sections:     initial?.sections     ?? ['all'],
    isCompulsory: initial?.isCompulsory ?? false,
    color:        initial?.color        ?? '#6366F1',
    order:        initial?.order        ?? 0,
    description:  initial?.description  ?? '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function toggleSection(val) {
    setForm(f => {
      const cur = f.sections;
      if (val === 'all') return { ...f, sections: ['all'] };
      const without = cur.filter(s => s !== 'all' && s !== val);
      const next = cur.includes(val) ? without : [...without, val];
      return { ...f, sections: next.length ? next : ['all'] };
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">
          {initial ? 'Edit Subject' : 'New Subject'}
        </h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Subject Name <span className="text-red-500">*</span></label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="e.g. Pure Mathematics"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Code <span className="text-red-500">*</span></label>
            <input
              value={form.code}
              onChange={e => set('code', e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. PMATH"
              maxLength={20}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Short Name</label>
            <input
              value={form.shortName}
              onChange={e => set('shortName', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. Pure Maths"
              maxLength={50}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Department <span className="text-red-500">*</span></label>
          <select
            value={form.departmentId}
            onChange={e => set('departmentId', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          >
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Sections</label>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map(s => (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleSection(s.value)}
                className={clsx(
                  'rounded-full px-3 py-1 text-xs font-medium border transition',
                  form.sections.includes(s.value)
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-violet-400',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => set('isCompulsory', !form.isCompulsory)}
            className={clsx(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              form.isCompulsory ? 'bg-violet-600' : 'bg-slate-200',
            )}
          >
            <span className={clsx('pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition', form.isCompulsory ? 'translate-x-4' : 'translate-x-0')} />
          </button>
          <span className="text-sm text-slate-700">Compulsory subject</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Colour</label>
            <div className="flex flex-wrap gap-2">
              {DEPT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  className={clsx('h-6 w-6 rounded-full border-2 transition', form.color === c ? 'border-slate-900 scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color ?? '#6366F1'}
                onChange={e => set('color', e.target.value)}
                className="h-6 w-6 cursor-pointer rounded-full border border-slate-300 p-0.5"
                title="Custom colour"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Order</label>
            <input
              type="number"
              min={0}
              value={form.order}
              onChange={e => set('order', parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            placeholder="Optional subject description"
            maxLength={500}
          />
        </div>
      </div>

      <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200 transition">Cancel</button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim() || !form.code.trim() || !form.departmentId}
          className="px-4 py-2 rounded-lg text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium"
        >
          {saving ? 'Saving…' : 'Save Subject'}
        </button>
      </div>
    </div>
  );
}

/* ── Slide-over shell ────────────────────────────────────── */
function SlideOver({ open, onClose, children }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl"
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Delete confirm dialog ───────────────────────────────── */
function DeleteDialog({ item, type, onConfirm, onClose, deleting }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-slate-900 text-sm">Deactivate {type}?</p>
            <p className="text-slate-500 text-sm mt-1">
              <strong>{item.name}</strong> will be hidden from all modules. This can be undone by your system administrator.
            </p>
            {type === 'Department' && (
              <p className="text-amber-600 text-xs mt-2 font-medium">
                All active subjects must be moved or deactivated first.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Removing…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Department card ─────────────────────────────────────── */
function DeptCard({ dept, subjects, editable, onEditDept, onDeleteDept, onAddSubject, onEditSubject, onDeleteSubject }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-slate-50 transition select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ backgroundColor: dept.color ?? '#6366F1' }}>
          {dept.code?.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 text-sm">{dept.name}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-mono">{dept.code}</span>
            {dept.hodName && (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Users size={11} className="shrink-0" />
                {dept.hodName}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {editable && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onAddSubject(dept); }}
                className="p-1.5 rounded-lg text-violet-600 hover:bg-violet-50 transition"
                title="Add subject"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onEditDept(dept); }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                title="Edit department"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onDeleteDept(dept); }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition"
                title="Deactivate department"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </div>

      {/* Subjects list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100">
              {subjects.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-slate-400">
                  No subjects in this department yet.
                  {editable && (
                    <button onClick={() => onAddSubject(dept)} className="ml-1 text-violet-600 hover:underline">Add one</button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {subjects.map(sub => (
                    <div key={sub.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/60 transition group">
                      <ColorDot color={sub.color} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-800">{sub.name}</span>
                          <span className="text-[11px] font-mono text-slate-400">{sub.code}</span>
                          {sub.shortName && sub.shortName !== sub.name && (
                            <span className="text-[11px] text-slate-400">({sub.shortName})</span>
                          )}
                          {sub.isCompulsory && (
                            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">Compulsory</span>
                          )}
                        </div>
                        {sub.sections?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sub.sections.map(s => <SectionPill key={s} value={s} />)}
                          </div>
                        )}
                      </div>
                      {editable && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                          <button
                            onClick={() => onEditSubject(sub)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => onDeleteSubject(sub)}
                            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function SubjectsPage() {
  const role    = useAuthStore(s => s.session?.user?.role ?? '');
  const editable = canEdit(role);
  const qc       = useQueryClient();

  const [search, setSearch]           = useState('');
  const [deptSlide, setDeptSlide]     = useState(null); // null | { mode:'new'|'edit', data }
  const [subSlide, setSubSlide]       = useState(null); // null | { mode:'new'|'edit', data, deptId }
  const [delTarget, setDelTarget]     = useState(null); // null | { type:'Department'|'Subject', item }
  const [toast, setToast]             = useState(null);

  /* ── queries ─────────────────────────────────────────────── */
  const { data: depts = [], isPending: deptsLoading } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => deptsApi.list(),
    staleTime: 60_000,
  });

  const { data: allSubjects = [], isPending: subsLoading } = useQuery({
    queryKey: ['subjects'],
    queryFn:  () => subsApi.list(),
    staleTime: 60_000,
  });

  /* ── mutations — departments ──────────────────────────────── */
  const saveDept = useMutation({
    mutationFn: ({ id, data }) => id ? deptsApi.update(id, data) : deptsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setDeptSlide(null);
      flash('Department saved');
    },
    onError: err => flash(err.message ?? 'Save failed', 'error'),
  });

  const deleteDept = useMutation({
    mutationFn: id => deptsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setDelTarget(null);
      flash('Department deactivated');
    },
    onError: err => flash(err.message ?? 'Delete failed', 'error'),
  });

  /* ── mutations — subjects ─────────────────────────────────── */
  const saveSub = useMutation({
    mutationFn: ({ id, data }) => id ? subsApi.update(id, data) : subsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subjects'] });
      setSubSlide(null);
      flash('Subject saved');
    },
    onError: err => flash(err.message ?? 'Save failed', 'error'),
  });

  const deleteSub = useMutation({
    mutationFn: id => subsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subjects'] });
      setDelTarget(null);
      flash('Subject deactivated');
    },
    onError: err => flash(err.message ?? 'Delete failed', 'error'),
  });

  function flash(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  /* ── filter by search ────────────────────────────────────── */
  const q = search.trim().toLowerCase();
  const filteredDepts = q
    ? depts.filter(d => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q) || (d.hodName ?? '').toLowerCase().includes(q))
    : depts;

  function subjectsFor(deptId) {
    const subs = allSubjects.filter(s => s.departmentId === deptId);
    if (!q) return subs;
    return subs.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }

  /* ── stats ───────────────────────────────────────────────── */
  const totalSubjects = allSubjects.length;
  const compulsoryCount = allSubjects.filter(s => s.isCompulsory).length;

  const loading = deptsLoading || subsLoading;

  return (
    <div className="min-h-full bg-slate-50">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
              <Library size={20} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Subjects &amp; Departments</h1>
              <p className="text-sm text-slate-500">School-wide subject registry, grouped by department</p>
            </div>
          </div>
          {editable && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSubSlide({ mode: 'new', data: null, deptId: depts[0]?.id })}
                className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
              >
                <Plus size={15} />
                Add Subject
              </button>
              <button
                onClick={() => setDeptSlide({ mode: 'new', data: null })}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 transition font-medium"
              >
                <Plus size={15} />
                Add Department
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 px-6 py-4">
        {[
          { label: 'Departments', value: depts.length, color: 'text-violet-600' },
          { label: 'Subjects',    value: totalSubjects, color: 'text-blue-600'   },
          { label: 'Compulsory',  value: compulsoryCount, color: 'text-green-600' },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl bg-white border border-slate-200 px-5 py-3.5 shadow-sm">
            <p className="text-xs text-slate-500">{stat.label}</p>
            <p className={clsx('text-2xl font-bold mt-0.5', stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="px-6 pb-4">
        <div className="relative max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search departments or subjects…"
            className="w-full rounded-lg border border-slate-300 pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="px-6 pb-10 space-y-4">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>
        ) : filteredDepts.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-300 py-16 text-center">
            <Library size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">
              {q ? `No results for "${search}"` : 'No departments yet.'}
            </p>
            {!q && editable && (
              <button
                onClick={() => setDeptSlide({ mode: 'new', data: null })}
                className="mt-3 text-sm text-violet-600 hover:underline"
              >
                Create your first department
              </button>
            )}
          </div>
        ) : (
          filteredDepts.map(dept => (
            <DeptCard
              key={dept.id}
              dept={dept}
              subjects={subjectsFor(dept.id)}
              editable={editable}
              onEditDept={d   => setDeptSlide({ mode: 'edit', data: d })}
              onDeleteDept={d => setDelTarget({ type: 'Department', item: d })}
              onAddSubject={d => setSubSlide({ mode: 'new', data: null, deptId: d.id })}
              onEditSubject={s => setSubSlide({ mode: 'edit', data: s, deptId: s.departmentId })}
              onDeleteSubject={s => setDelTarget({ type: 'Subject', item: s })}
            />
          ))
        )}
      </div>

      {/* ── Department slide-over ───────────────────────────────── */}
      <SlideOver open={!!deptSlide} onClose={() => setDeptSlide(null)}>
        {deptSlide && (
          <DeptForm
            initial={deptSlide.mode === 'edit' ? deptSlide.data : null}
            onSave={form => saveDept.mutate({ id: deptSlide.data?.id, data: form })}
            onClose={() => setDeptSlide(null)}
            saving={saveDept.isPending}
          />
        )}
      </SlideOver>

      {/* ── Subject slide-over ─────────────────────────────────── */}
      <SlideOver open={!!subSlide} onClose={() => setSubSlide(null)}>
        {subSlide && (
          <SubjectForm
            initial={subSlide.mode === 'edit' ? subSlide.data : null}
            departments={depts}
            onSave={form => {
              const data = { ...form };
              if (subSlide.mode === 'new' && subSlide.deptId && !form.departmentId) {
                data.departmentId = subSlide.deptId;
              }
              saveSub.mutate({ id: subSlide.data?.id, data });
            }}
            onClose={() => setSubSlide(null)}
            saving={saveSub.isPending}
          />
        )}
      </SlideOver>

      {/* ── Delete dialog ──────────────────────────────────────── */}
      {delTarget && (
        <DeleteDialog
          item={delTarget.item}
          type={delTarget.type}
          onClose={() => setDelTarget(null)}
          deleting={deleteDept.isPending || deleteSub.isPending}
          onConfirm={() => {
            if (delTarget.type === 'Department') deleteDept.mutate(delTarget.item.id);
            else deleteSub.mutate(delTarget.item.id);
          }}
        />
      )}

      {/* ── Toast ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={clsx(
              'fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white',
            )}
          >
            {toast.type !== 'error' && <Check size={15} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
