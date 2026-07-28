/* ============================================================
   CategoriesTab — school-editable behaviour categories (admin only).
   Auto-seeded on first load with the full SAA Behaviour Point System
   default set: 8 categories, each holding its own list of individually
   named, individually pointed items (merit or demerit). Both
   categories and the items within them are fully editable/deletable
   per school — editing here changes what Award Points offers
   immediately (no separate "publish" step).
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Tag, Plus, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Save,
  ChevronDown, ChevronRight, Pencil, Trash2,
} from 'lucide-react';
import { behaviour as behaviourApi, teachers as teachersApi, settings as settingsApi } from '@/api/client.js';
import { EmptyMsg, ErrState, FField, iCls } from './BehaviourPrimitives.jsx';
import { useToast } from '@/hooks/useToast.jsx';

const EMPTY_CATEGORY_FORM = { name: '', description: '' };
const EMPTY_ITEM_FORM     = { label: '', direction: 'merit', points: '', description: '' };

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

/* ── A single item row within an expanded category — view, or an
   inline edit form when `editing`. Edits/removes are resolved against
   the category's full item list by the parent CategoryCard (via
   onEdit/onRemove), since this row only knows about itself. ──────── */
function ItemRow({ item, saving, onEdit, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);

  function startEdit() {
    setForm({ label: item.label, direction: item.direction, points: String(item.points), description: item.description || '' });
    setEditing(true);
  }

  function saveEdit() {
    onEdit(item.id, { label: form.label.trim(), direction: form.direction, points: Number(form.points), description: form.description || undefined })
      .then(() => setEditing(false));
  }

  if (editing && form) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-2 px-2 bg-slate-50 rounded-lg">
        <input
          value={form.label}
          onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          className={`${iCls()} flex-1 min-w-[180px]`}
        />
        <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))} className={iCls()}>
          <option value="merit">Merit</option>
          <option value="demerit">Demerit</option>
        </select>
        <input
          type="number" min="0" value={form.points}
          onChange={e => setForm(f => ({ ...f, points: e.target.value }))}
          className={`${iCls()} w-20`}
        />
        <button onClick={() => setEditing(false)} className="text-xs text-slate-500 px-2 py-1">Cancel</button>
        <button
          disabled={saving || !form.label.trim() || form.points === ''}
          onClick={saveEdit}
          className="flex items-center gap-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg px-3 py-1.5"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}Save
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50">
      <span className="text-sm text-slate-700 truncate">{item.label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`inline-flex items-center text-xs font-bold rounded-full px-2 py-0.5 border ${
          item.direction === 'merit'
            ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>
          {item.direction === 'merit' ? '+' : '-'}{item.points}
        </span>
        <button onClick={startEdit} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-700 rounded transition">
          <Pencil size={12} />
        </button>
        <button
          onClick={() => { if (confirm(`Delete "${item.label}"?`)) onRemove(item.id); }}
          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 rounded transition"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── One expandable category card: header + item list + add-item form. */
function CategoryCard({ category, expanded, onToggle, onDeleted }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addingItem, setAddingItem] = useState(false);
  const [itemForm, setItemForm]     = useState(EMPTY_ITEM_FORM);
  const [itemError, setItemError]   = useState('');

  const items = category.items ?? [];
  const meritCount   = items.filter(i => i.direction === 'merit').length;
  const demeritCount = items.filter(i => i.direction === 'demerit').length;

  const patchMut = useMutation({
    mutationFn: (patch) => behaviourApi.categories.update(category.id ?? category._id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }),
    onError:   err => toast.error(err?.message ?? 'Failed to save'),
  });

  const removeMut = useMutation({
    mutationFn: () => behaviourApi.categories.remove(category.id ?? category._id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }); onDeleted?.(); },
  });

  // A single mutation handles add/edit/remove of one item by resolving
  // the shape against the category's current item list, then PUTs the
  // whole array back (server replaces items wholesale on PUT).
  function mutateItems(spec) {
    let next = items;
    if (spec.__removeItem) {
      next = items.filter(i => i.id !== spec.__removeItem);
    } else if (spec.__replaceItem) {
      const { __replaceItem, ...rest } = spec;
      next = items.map(i => i.id === __replaceItem ? { ...i, ...rest } : i);
    } else {
      next = [...items, spec]; // new item, no id — server assigns one
    }
    return patchMut.mutateAsync({ items: next });
  }

  function submitNewItem(ev) {
    ev.preventDefault();
    if (!itemForm.label.trim()) { setItemError('Label is required'); return; }
    if (itemForm.points === '' || Number(itemForm.points) < 0) { setItemError('Points must be 0 or greater'); return; }
    mutateItems({
      label: itemForm.label.trim(),
      direction: itemForm.direction,
      points: Number(itemForm.points),
      description: itemForm.description || undefined,
    }).then(() => {
      setItemForm(EMPTY_ITEM_FORM);
      setAddingItem(false);
      setItemError('');
    }).catch(err => setItemError(err?.message ?? 'Failed to add item'));
  }

  return (
    <div className="group bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-start justify-between gap-2 p-4 text-left hover:bg-slate-50 transition-colors">
        <div className="flex items-start gap-2">
          {expanded ? <ChevronDown size={15} className="mt-0.5 text-slate-400 shrink-0" /> : <ChevronRight size={15} className="mt-0.5 text-slate-400 shrink-0" />}
          <div>
            <span className="text-sm font-semibold text-slate-800">{category.name}</span>
            {category.description && <p className="text-xs text-slate-500 mt-0.5">{category.description}</p>}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">{meritCount} merit</span>
              <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">{demeritCount} demerit</span>
            </div>
          </div>
        </div>
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); if (confirm(`Delete category "${category.name}" and all its items?`)) removeMut.mutate(); }}
          className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0"
        >
          <Trash2 size={13} />
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="border-t border-slate-100 p-3 space-y-1">
              {items.length === 0 && !addingItem && (
                <p className="text-xs text-slate-400 py-2 px-2">No items yet — add one below.</p>
              )}
              {items.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  saving={patchMut.isPending}
                  onEdit={(itemId, patch) => mutateItems({ __replaceItem: itemId, ...patch })}
                  onRemove={(itemId) => mutateItems({ __removeItem: itemId })}
                />
              ))}

              {addingItem ? (
                <form onSubmit={submitNewItem} className="flex flex-wrap items-center gap-2 pt-2 mt-1 border-t border-slate-100">
                  <input
                    autoFocus
                    value={itemForm.label}
                    onChange={e => { setItemForm(f => ({ ...f, label: e.target.value })); setItemError(''); }}
                    placeholder="Item label, e.g. Outstanding contribution to class discussion"
                    className={`${iCls()} flex-1 min-w-[220px]`}
                  />
                  <select value={itemForm.direction} onChange={e => setItemForm(f => ({ ...f, direction: e.target.value }))} className={iCls()}>
                    <option value="merit">Merit</option>
                    <option value="demerit">Demerit</option>
                  </select>
                  <input
                    type="number" min="0" placeholder="Pts"
                    value={itemForm.points}
                    onChange={e => { setItemForm(f => ({ ...f, points: e.target.value })); setItemError(''); }}
                    className={`${iCls()} w-20`}
                  />
                  <button type="button" onClick={() => { setAddingItem(false); setItemForm(EMPTY_ITEM_FORM); setItemError(''); }} className="text-xs text-slate-500 px-2 py-1">Cancel</button>
                  <button
                    type="submit"
                    disabled={patchMut.isPending}
                    className="flex items-center gap-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg px-3 py-1.5"
                  >
                    {patchMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}Add
                  </button>
                  {itemError && <p className="w-full text-xs text-red-600">{itemError}</p>}
                </form>
              ) : (
                <button
                  onClick={() => setAddingItem(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:underline pt-2 mt-1"
                >
                  <Plus size={12} />Add item
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CategoriesTab() {
  const qc                    = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(EMPTY_CATEGORY_FORM);
  const [errors, setErrors]   = useState({});
  const [expandedId, setExpandedId] = useState(null);

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
      items: [],
    }),
    onSuccess: (res) => {
      setShowAdd(false);
      setForm(EMPTY_CATEGORY_FORM);
      qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] });
      const newId = res?.data?.id ?? res?.data?._id;
      if (newId) setExpandedId(newId); // jump straight into adding items
    },
    onError: err => setErrors({ _server: err?.message ?? 'Failed to create' }),
  });

  function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
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
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">
                After creating, you'll add the merit/demerit items that belong under this category.
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
        <div className="grid gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg
          icon={<Tag size={36} />}
          title="No categories"
          subtitle="Add a category to get started — categories and their items are fully editable."
        />
      ) : (
        <div className="grid gap-3">
          {rows.map(c => {
            const id = c.id ?? c._id;
            return (
              <CategoryCard
                key={id}
                category={c}
                expanded={expandedId === id}
                onToggle={() => setExpandedId(x => x === id ? null : id)}
                onDeleted={() => setExpandedId(x => x === id ? null : x)}
              />
            );
          })}
        </div>
      )}

      <OfficerAssignmentSection />
    </motion.div>
  );
}
