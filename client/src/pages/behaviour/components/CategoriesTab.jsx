/* ============================================================
   CategoriesTab — school-editable behaviour categories (admin only).
   Auto-seeded with 8 defaults on first load; each category's
   merit/demerit point values feed Award Points directly, so editing
   here changes what awarding produces immediately (no separate
   "publish" step).
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, Plus, X, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Save } from 'lucide-react';
import { behaviour as behaviourApi, teachers as teachersApi, settings as settingsApi } from '@/api/client.js';
import { EmptyMsg, ErrState, FField, iCls } from './BehaviourPrimitives.jsx';
import { useToast } from '@/hooks/useToast.jsx';

const EMPTY_FORM = { name: '', meritPoints: '', demeritPoints: '', description: '' };

// Mirrors hr/PayrollSettingsModal.jsx's own local copy — same built-in
// role set, kept local rather than shared since each caller only needs
// {key,label}, not the module-specific extras the HR copy carries.
const BUILT_IN_STAFF_ROLES = [
  { key: 'admin',                label: 'Admin' },
  { key: 'deputy_principal',     label: 'Deputy Principal' },
  { key: 'section_head',         label: 'Section Head' },
  { key: 'teacher',              label: 'Teacher' },
  { key: 'discipline_committee', label: 'Discipline Committee / Pastoral Office' },
  { key: 'front_office',         label: 'Front Office' },
];

/* ── Behaviour Officer assignment (admin/superadmin only) ────────
   Reuses the same {assigneeType:'role'|'user', assigneeValue}
   primitive HR/payroll/report-card approval chains already use
   (server/utils/workflow-config.js) — a role or a specific person,
   never hardcoded. Whoever is assigned gets full Behaviour access
   regardless of their base role's own permissions. */
function OfficerAssignmentSection() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: cfgData, isLoading } = useQuery({
    queryKey: ['behaviour', 'officer-config'],
    queryFn:  () => behaviourApi.officerConfig.get(),
  });
  const currentStep = cfgData?.data?.steps?.[0] ?? null;

  const { data: teachersData } = useQuery({
    queryKey: ['teachers', 'for-behaviour-officer'],
    queryFn:  () => teachersApi.list({ limit: 200 }),
  });
  const teachers = teachersData?.teachers ?? teachersData?.data ?? [];

  const { data: customRolesData } = useQuery({
    queryKey: ['settings', 'custom-roles', 'for-behaviour-officer'],
    queryFn:  () => settingsApi.customRoles.list(),
  });
  const customRoles = customRolesData ?? [];

  const [assigneeType, setAssigneeType]   = useState(currentStep?.assigneeType ?? 'role');
  const [assigneeValue, setAssigneeValue] = useState(currentStep?.assigneeValue ?? '');
  const [editing, setEditing] = useState(false);

  function startEditing() {
    setAssigneeType(currentStep?.assigneeType ?? 'role');
    setAssigneeValue(currentStep?.assigneeValue ?? '');
    setEditing(true);
  }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (steps) => behaviourApi.officerConfig.save({ steps }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['behaviour', 'officer-config'] });
      setEditing(false);
      toast.success('Behaviour Officer updated.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save.'),
  });

  function currentLabel() {
    if (!currentStep) return null;
    if (currentStep.assigneeType === 'role') {
      return BUILT_IN_STAFF_ROLES.find(r => r.key === currentStep.assigneeValue)?.label
        ?? customRoles.find(r => r.key === currentStep.assigneeValue)?.label
        ?? currentStep.assigneeValue;
    }
    const t = teachers.find(t => (t.userId ?? t.id ?? t._id) === currentStep.assigneeValue);
    return t ? (t.name ?? `${t.firstName} ${t.lastName}`) : 'Unknown person';
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Behaviour Officer</h3>
      </div>
      <p className="text-xs text-slate-500">
        Assign a role or a specific person to oversee this module. They get full Behaviour access
        (categories, incidents, resets) regardless of their own role's normal permissions.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-xs py-2"><Loader2 size={13} className="animate-spin" /> Loading…</div>
      ) : !editing ? (
        <div className="flex items-center justify-between gap-3">
          {currentStep ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-1">
              {currentLabel()}{currentStep.assigneeType === 'role' ? ' (role)' : ''}
            </span>
          ) : (
            <span className="text-xs text-slate-400">No Behaviour Officer assigned — normal role permissions apply to everyone.</span>
          )}
          <button onClick={startEditing} className="shrink-0 text-xs font-semibold text-violet-600 hover:underline">
            {currentStep ? 'Change' : 'Assign'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select value={assigneeType} onChange={e => { setAssigneeType(e.target.value); setAssigneeValue(''); }} className={iCls()}>
              <option value="role">Role</option>
              <option value="user">Specific person</option>
            </select>
            {assigneeType === 'role' ? (
              <select value={assigneeValue} onChange={e => setAssigneeValue(e.target.value)} className={`${iCls()} flex-1`}>
                <option value="">Select a role…</option>
                {BUILT_IN_STAFF_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                {customRoles.map(r => <option key={r.key} value={r.key}>{r.label} (custom)</option>)}
              </select>
            ) : (
              <select value={assigneeValue} onChange={e => setAssigneeValue(e.target.value)} className={`${iCls()} flex-1`}>
                <option value="">Select a person…</option>
                {teachers.map(t => {
                  const id = t.userId ?? t.id ?? t._id;
                  return <option key={id} value={id}>{t.name ?? `${t.firstName} ${t.lastName}`}</option>;
                })}
              </select>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            {currentStep && (
              <button onClick={() => save([])} disabled={saving}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                Remove assignment
              </button>
            )}
            <button onClick={() => save([{ assigneeType, assigneeValue }])} disabled={saving || !assigneeValue}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CategoriesTab() {
  const qc                    = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [errors, setErrors]   = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'categories'],
    queryFn:  () => behaviourApi.categories.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const rows = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: d => behaviourApi.categories.create({
      name: d.name,
      description: d.description || undefined,
      meritPoints:   d.meritPoints   !== '' ? Number(d.meritPoints)   : undefined,
      demeritPoints: d.demeritPoints !== '' ? Number(d.demeritPoints) : undefined,
    }),
    onSuccess: () => {
      setShowAdd(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] });
    },
    onError: err => setErrors({ _server: err?.message ?? 'Failed to create' }),
  });

  const removeMut = useMutation({
    mutationFn: id => behaviourApi.categories.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }),
  });

  function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.meritPoints === '' && form.demeritPoints === '') e.points = 'Set at least a merit or demerit point value';
    if (Object.keys(e).length) { setErrors(e); return; }
    createMut.mutate(form);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} categor{rows.length !== 1 ? 'ies' : 'y'}</p>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={14} />Add Category
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">New Category</h3>
              {errors._server && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-200">
                  <AlertTriangle size={13} />{errors._server}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <FField label="Name *" error={errors.name}>
                  <input
                    value={form.name}
                    onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErrors({}); }}
                    placeholder="e.g. Punctuality"
                    className={iCls(errors.name)}
                  />
                </FField>
                <FField label="Description">
                  <input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional"
                    className={iCls()}
                  />
                </FField>
                <FField label="Merit Points" error={errors.points}>
                  <input
                    type="number" min="0"
                    value={form.meritPoints}
                    onChange={e => { setForm(f => ({ ...f, meritPoints: e.target.value })); setErrors({}); }}
                    placeholder="Leave blank if not applicable"
                    className={iCls(errors.points)}
                  />
                </FField>
                <FField label="Demerit Points">
                  <input
                    type="number" min="0"
                    value={form.demeritPoints}
                    onChange={e => { setForm(f => ({ ...f, demeritPoints: e.target.value })); setErrors({}); }}
                    placeholder="Leave blank if not applicable"
                    className={iCls()}
                  />
                </FField>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">
                Set only Merit Points for a merit-only category (e.g. Leadership), only Demerit Points for a demerit-only one, or both.
              </p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowAdd(false)} className="text-sm font-medium text-slate-600 px-4 py-2">Cancel</button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {createMut.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg
          icon={<Tag size={36} />}
          title="No categories"
          subtitle="Add a category to get started — categories are fully editable, including their point values."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(c => (
            <div key={c._id ?? c.id} className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm hover:border-slate-300 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                  {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {c.meritPoints != null && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">+{c.meritPoints}</span>
                    )}
                    {c.demeritPoints != null && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">-{c.demeritPoints}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) removeMut.mutate(c.id ?? c._id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <OfficerAssignmentSection />
    </motion.div>
  );
}
