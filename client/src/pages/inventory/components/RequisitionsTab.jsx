/* ============================================================
   RequisitionsTab — Inventory milestone 3 (Requisitions + Procurement)

   Requisitions reuse the same configurable Workflow Engine already
   proven for HR's Leave approval chain (server/utils/workflow-config.js)
   — this UI mirrors HRPage.jsx's WorkflowConfigModal/AssigneePicker
   shape (kept as a separate, Inventory-scoped component rather than an
   extraction, since the HR version has leave-specific behavior — a
   fixed trailing "HR always confirms last" step, a >=2-step minimum —
   baked into its markup, and a shared-component refactor of an
   already-shipped, working feature is its own separate piece of work).
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Plus, X, Loader2, AlertTriangle, Settings, Trash2, Check, XCircle,
  PackageCheck, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { inventory as inventoryApi, settings as settingsApi, departments as departmentsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;

const BUILT_IN_ROLES = [
  { key: 'admin', label: 'Admin' }, { key: 'deputy_principal', label: 'Deputy Principal' },
  { key: 'principal', label: 'Principal' }, { key: 'section_head', label: 'Section Head' },
  { key: 'teacher', label: 'Teacher' }, { key: 'finance', label: 'Finance' },
  { key: 'hr', label: 'HR' },
];

function emptyStep() { return { assigneeType: 'role', assigneeValue: '' }; }

export default function RequisitionsTab() {
  const qc = useQueryClient();
  const can = useAuthStore(s => s.can);
  const userId = useAuthStore(s => s.session?.user?.userId ?? s.session?.user?.id);
  const canConfigureWorkflow = can('inventory', 'update');
  const canFulfill = can('inventory', 'create'); // same permission as recording any stock transaction

  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory', 'requisitions', { page }],
    queryFn:  () => inventoryApi.requisitions.list({ page, limit: LIMIT }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages ?? 1;
  const total      = pagination.total ?? rows.length;

  const { data: catData } = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn:  () => inventoryApi.categories.list(),
    staleTime: 60_000,
  });

  const { data: itemsData } = useQuery({
    queryKey: ['inventory', 'items', 'all-for-req'],
    queryFn:  () => inventoryApi.items.list({ limit: 500 }),
    staleTime: 30_000,
  });
  const items = itemsData?.data ?? [];

  const { data: deptsData } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => departmentsApi.list(),
    staleTime: 5 * 60_000,
  });
  const departments = deptsData?.data ?? [];

  const advanceMutation = useMutation({
    mutationFn: ({ id, status, notes }) => inventoryApi.requisitions.advance(id, { status, notes }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] }),
  });
  const fulfillMutation = useMutation({
    mutationFn: (id) => inventoryApi.requisitions.fulfill(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] });
      qc.invalidateQueries({ queryKey: ['inventory', 'items'] });
    },
    onError: err => alert(err?.message ?? 'Failed to fulfill requisition'),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Requester → configured approval chain → Procurement (final step) → Receive Stock</p>
        <div className="flex items-center gap-2">
          {canConfigureWorkflow && (
            <button onClick={() => setShowWorkflow(true)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition">
              <Settings size={13} /> Approval Chain
            </button>
          )}
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-2 rounded-lg transition">
            <Plus size={13} /> Raise Requisition
          </button>
        </div>
      </div>

      {showForm && (
        <RequisitionForm
          categories={catData?.data ?? []}
          items={items}
          departments={departments}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['inventory', 'requisitions'] }); }}
        />
      )}

      {showWorkflow && (
        <WorkflowConfigModal onClose={() => setShowWorkflow(false)} />
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-16 animate-pulse" />)}</div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Clock size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No requisitions yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {rows.map(r => (
            <RequisitionRow
              key={r.id} req={r} userId={userId} canFulfill={canFulfill}
              onAdvance={(status, notes) => advanceMutation.mutate({ id: r.id, status, notes })}
              onFulfill={() => fulfillMutation.mutate(r.id)}
              busy={advanceMutation.isPending || fulfillMutation.isPending}
            />
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
            <p className="text-xs text-slate-500">{total} result{total !== 1 ? 's' : ''}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
              <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

const STATUS_STYLE = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  approved:  'bg-blue-50 text-blue-700 border-blue-200',
  rejected:  'bg-red-50 text-red-700 border-red-200',
  fulfilled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function RequisitionRow({ req, userId, canFulfill, onAdvance, onFulfill, busy }) {
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');
  const isMine = req.requesterId === userId;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">{req.itemName ?? req.description}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {req.quantity} {req.unit} {req.departmentName ? `· ${req.departmentName}` : ''} {!isMine ? `· by ${req.requesterName}` : ''}
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_STYLE[req.status] ?? STATUS_STYLE.pending}`}>{req.status}</span>
      </div>

      {req.status === 'approved' && canFulfill && (
        <div className="mt-2 flex justify-end">
          <button onClick={onFulfill} disabled={busy} className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-300 rounded-lg px-3 py-1.5 transition disabled:opacity-50">
            <PackageCheck size={13} /> Receive Stock
          </button>
        </div>
      )}

      {req.status === 'pending' && (
        <div className="mt-2 flex flex-col items-end gap-2">
          {rejecting ? (
            <div className="w-full flex items-center gap-2">
              <input autoFocus value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for rejection…" className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-400/20" />
              <button onClick={() => { if (notes.trim()) { onAdvance('rejected', notes); setRejecting(false); } }} disabled={busy || !notes.trim()} className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg px-3 py-1.5">Confirm</button>
              <button onClick={() => setRejecting(false)} className="text-slate-400 hover:text-slate-700"><X size={14} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setRejecting(true)} disabled={busy} className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"><XCircle size={13} /> Reject</button>
              <button onClick={() => onAdvance('approved', '')} disabled={busy} className="flex items-center gap-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg px-3 py-1.5"><Check size={13} /> Approve</button>
            </div>
          )}
          <p className="text-[10px] text-slate-400">Approve/Reject only enabled for this request's current step approver — a 403 here means you're not eligible at this step.</p>
        </div>
      )}
    </div>
  );
}

function RequisitionForm({ categories, items, departments, onClose, onSaved }) {
  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [form, setForm] = useState({ itemId: items[0]?.id ?? '', itemName: '', departmentId: '', description: '', quantity: 1, unit: 'pcs' });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const mutation = useMutation({
    mutationFn: () => inventoryApi.requisitions.create({
      ...(mode === 'existing' ? { itemId: form.itemId } : { itemName: form.itemName }),
      departmentId: form.departmentId || undefined,
      description: form.description, quantity: Number(form.quantity), unit: form.unit,
    }),
    onSuccess: onSaved,
  });

  const canSubmit = form.description.trim() && Number(form.quantity) > 0 && (mode === 'existing' ? form.itemId : form.itemName.trim());

  return (
    <form onSubmit={e => { e.preventDefault(); if (canSubmit) mutation.mutate(); }} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 max-w-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Raise Requisition</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
      </div>
      {mutation.isError && <p className="text-xs text-red-600">{mutation.error?.message ?? 'Failed to submit'}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('existing')} className={`flex-1 text-xs px-3 py-2 rounded-lg border transition ${mode === 'existing' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}>Existing item</button>
        <button type="button" onClick={() => setMode('new')} className={`flex-1 text-xs px-3 py-2 rounded-lg border transition ${mode === 'new' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}>New item request</button>
      </div>

      {mode === 'existing' ? (
        <FField label="Item">
          <select required className={iCls()} value={form.itemId} onChange={e => set('itemId', e.target.value)}>
            <option value="">Select an item…</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.categoryName})</option>)}
          </select>
        </FField>
      ) : (
        <FField label="Item name (not yet in the catalogue)">
          <input required className={iCls()} value={form.itemName} onChange={e => set('itemName', e.target.value)} placeholder="e.g. Interactive whiteboard" />
        </FField>
      )}

      <FField label="Department (optional)">
        <select className={iCls()} value={form.departmentId} onChange={e => set('departmentId', e.target.value)}>
          <option value="">— None —</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </FField>

      <FField label="Reason / description">
        <textarea required rows={2} className={`${iCls()} resize-none`} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Why is this needed?" />
      </FField>

      <div className="grid grid-cols-2 gap-4">
        <FField label="Quantity">
          <input type="number" min={1} required className={iCls()} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
        </FField>
        <FField label="Unit">
          <input className={iCls()} value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="pcs" />
        </FField>
      </div>

      <button type="submit" disabled={!canSubmit || mutation.isPending} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
        {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
        {mutation.isPending ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}

/* ── Approval chain configuration ────────────────────────────── */
function WorkflowConfigModal({ onClose }) {
  const qc = useQueryClient();

  const { data: configData } = useQuery({
    queryKey: ['inventory', 'requisitions', 'workflow-config'],
    queryFn:  () => inventoryApi.requisitions.workflowConfig.get(),
  });
  const { data: customRolesData } = useQuery({
    queryKey: ['settings', 'custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
    select:   r => r?.data ?? [],
    staleTime: 60_000,
  });
  const { data: usersData } = useQuery({
    queryKey: ['settings-users'],
    queryFn:  () => settingsApi.users.list(),
    select:   r => r?.data?.users ?? r?.users ?? (Array.isArray(r?.data) ? r.data : []),
    staleTime: 60_000,
  });
  const customRoles = customRolesData ?? [];
  const users = usersData ?? [];

  const config = configData?.data;
  const [steps, setSteps] = useState(() => (config?.steps?.length ? config.steps.map(s => ({ ...s })) : [emptyStep()]));

  const saveMutation = useMutation({
    mutationFn: () => inventoryApi.requisitions.workflowConfig.save({
      steps: steps.map((s, idx) => ({ order: idx + 1, assigneeType: s.assigneeType, assigneeValue: s.assigneeValue })),
      notifyOnly: [],
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory', 'requisitions', 'workflow-config'] }); onClose(); },
  });

  function updateStep(i, next) { setSteps(s => s.map((st, idx) => idx === i ? next : st)); }
  const incomplete = steps.length === 0 || steps.some(s => !s.assigneeValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-900">Requisition Approval Chain</h2>
            <p className="text-xs text-slate-500 mt-0.5">Each step approves in order. The last step is "Procurement" — once it approves, the requisition is ready to receive stock.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2.5">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <div className="flex gap-2 flex-1">
                <select value={step.assigneeType} onChange={e => updateStep(i, { ...step, assigneeType: e.target.value, assigneeValue: '' })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs">
                  <option value="role">Role</option>
                  <option value="user">Specific person</option>
                </select>
                {step.assigneeType === 'role' ? (
                  <select value={step.assigneeValue} onChange={e => updateStep(i, { ...step, assigneeValue: e.target.value })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs flex-1">
                    <option value="">Select a role…</option>
                    {BUILT_IN_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    {customRoles.map(r => <option key={r.key} value={r.key}>{r.label} (custom)</option>)}
                  </select>
                ) : (
                  <select value={step.assigneeValue} onChange={e => updateStep(i, { ...step, assigneeValue: e.target.value })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs flex-1">
                    <option value="">Select a person…</option>
                    {users.map(u => <option key={u.id ?? u._id} value={u.id ?? u._id}>{u.name}</option>)}
                  </select>
                )}
              </div>
              <button onClick={() => setSteps(s => s.filter((_, idx) => idx !== i))} disabled={steps.length <= 1} className="text-slate-400 hover:text-red-600 p-1 disabled:opacity-30 shrink-0"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setSteps(s => [...s, emptyStep()])} className="text-xs font-semibold text-slate-700 hover:underline flex items-center gap-1">
            <Plus size={12} /> Add step
          </button>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={() => saveMutation.mutate()} disabled={incomplete || saveMutation.isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-50">
              {saveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Save Chain
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FField({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}
function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}
