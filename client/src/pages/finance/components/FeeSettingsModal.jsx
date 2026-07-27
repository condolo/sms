/* ============================================================
   FeeSettingsModal — Fee Types catalogue + sibling Discount
   Policies. Mirrors hr/PayrollSettingsModal.jsx's structure
   (type-catalogue editor + a policy list with its own save action).

   Props:
     onClose  fn
   ============================================================ */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Save, Loader2, Percent, CheckCircle2, Bell } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import { useToast } from '@/hooks/useToast.jsx';

function slugify(label) {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (/^[a-z]/.test(base) ? base : `t_${base}`) || 'type';
}
function uniqueKey(label, existingKeys) {
  const base = slugify(label);
  if (!existingKeys.has(base)) return base;
  let n = 2;
  while (existingKeys.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/* ── Fee Types catalogue editor ────────────────────────────────
   `key` is immutable once a row exists — invoice line items store
   feeType as a free string keyed against this catalogue for the
   picker, so changing a key wouldn't relabel existing line items,
   it'd just orphan them. Removing a row here doesn't touch invoices
   already using that key (LineItemSchema.feeType has no FK). */
function FeeTypeCatalogueEditor({ types, onChange }) {
  function updateLabel(i, label) {
    onChange(types.map((t, idx) => idx === i ? { ...t, label } : t));
  }
  function removeType(i) {
    onChange(types.filter((_, idx) => idx !== i));
  }
  function addType() {
    const existingKeys = new Set(types.map(t => t.key));
    const key = uniqueKey('New Fee Type', existingKeys);
    onChange([...types, { key, label: 'New Fee Type' }]);
  }
  const fCls = 'flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40';
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800">Fee Types</h4>
      <p className="text-xs text-slate-500 mt-0.5 mb-2.5">
        Picker options for invoice and fee-structure line items (Tuition, Transport, Lunch, …).
      </p>
      <div className="space-y-1.5">
        {types.map((t, i) => (
          <div key={t.key} className="flex items-center gap-2">
            <input value={t.label} onChange={e => updateLabel(i, e.target.value)} className={fCls} />
            <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-400">{t.key}</span>
            <button onClick={() => removeType(i)}
              className="shrink-0 text-slate-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button onClick={addType} className="mt-2 text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1">
        <Plus size={12} /> Add fee type
      </button>
    </div>
  );
}

function emptyTier() { return { nthChild: 2, discountPct: 0 }; }
function emptyPolicyForm() { return { name: '', active: false, tiers: [emptyTier()] }; }
const ORDINALS = { 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 8: '8th', 9: '9th', 10: '10th' };

/* ── Sibling discount policy form (create or edit) ─────────────── */
function PolicyForm({ initial, onCancel, onSave, saving }) {
  const [form, setForm] = useState(initial);
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function updateTier(i, field, val) {
    setForm(f => ({ ...f, tiers: f.tiers.map((t, idx) => idx === i ? { ...t, [field]: Number(val) } : t) }));
  }
  function addTier() {
    const usedNth = new Set(form.tiers.map(t => t.nthChild));
    let nth = 2;
    while (usedNth.has(nth) && nth <= 10) nth++;
    setForm(f => ({ ...f, tiers: [...f.tiers, { nthChild: nth, discountPct: 0 }] }));
  }
  function removeTier(i) { setForm(f => ({ ...f, tiers: f.tiers.filter((_, idx) => idx !== i) })); }

  const nths = form.tiers.map(t => t.nthChild);
  const invalid = !form.name.trim() || form.tiers.length === 0 || new Set(nths).size !== nths.length;
  const fCls = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40';

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-3">
      <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Policy name, e.g. Sibling Discount 2026"
        className={`${fCls} w-full`} />

      <div className="space-y-1.5">
        {form.tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <select value={t.nthChild} onChange={e => updateTier(i, 'nthChild', e.target.value)} className={fCls}>
              {Object.entries(ORDINALS).map(([n, label]) => <option key={n} value={n}>{label} child</option>)}
            </select>
            <div className="flex items-center gap-1.5">
              <input type="number" min="0" max="100" value={t.discountPct}
                onChange={e => updateTier(i, 'discountPct', e.target.value)}
                className={`${fCls} w-20 text-right`} />
              <Percent size={12} className="text-slate-400" />
            </div>
            <button onClick={() => removeTier(i)} disabled={form.tiers.length <= 1}
              className="text-slate-400 hover:text-red-600 p-1 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      {form.tiers.length < 10 && (
        <button onClick={addTier} className="text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1">
          <Plus size={12} /> Add tier
        </button>
      )}

      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
        Active — applied automatically when generating invoices
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white">Cancel</button>
        <button onClick={() => onSave(form)} disabled={invalid || saving}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </div>
  );
}

function DiscountPoliciesSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'discount-policies'],
    queryFn:  () => financeApi.discountPolicies.list(),
  });
  const policies = data?.data ?? [];
  const [editingId, setEditingId] = useState(null); // null = not editing, 'new' = creating

  const createMut = useMutation({
    mutationFn: (data) => financeApi.discountPolicies.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance', 'discount-policies'] }); setEditingId(null); toast.success('Discount policy created.'); },
    onError:   err => toast.error(err?.message ?? 'Failed to create policy.'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => financeApi.discountPolicies.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance', 'discount-policies'] }); setEditingId(null); toast.success('Discount policy updated.'); },
    onError:   err => toast.error(err?.message ?? 'Failed to update policy.'),
  });
  const removeMut = useMutation({
    mutationFn: (id) => financeApi.discountPolicies.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance', 'discount-policies'] }); toast.success('Discount policy deleted.'); },
    onError:   err => toast.error(err?.message ?? 'Failed to delete policy.'),
  });

  function save(form) {
    const payload = { name: form.name.trim(), active: form.active, tiers: form.tiers };
    if (editingId === 'new') createMut.mutate(payload);
    else updateMut.mutate({ id: editingId, data: payload });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Sibling Discount Policies</h4>
          <p className="text-xs text-slate-500 mt-0.5 max-w-md">
            Discount tiers by birth-enrollment order within a family (2nd child, 3rd child, …). Only one policy
            can be active at a time — it's applied automatically when you Generate Invoices from a fee structure.
          </p>
        </div>
        {editingId === null && (
          <button onClick={() => setEditingId('new')}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Plus size={12} /> Add policy
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-xs py-3"><Loader2 size={13} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-2 space-y-2">
          {policies.map(p => {
            const id = p.id ?? p._id;
            return editingId === id ? (
              <PolicyForm key={id} initial={{ name: p.name, active: p.active, tiers: p.tiers }}
                onCancel={() => setEditingId(null)} onSave={save} saving={updateMut.isPending} />
            ) : (
              <div key={id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{p.name}</span>
                    {p.active && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                        <CheckCircle2 size={10} /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {p.tiers.map(t => `${ORDINALS[t.nthChild] ?? `${t.nthChild}th`} child ${t.discountPct}%`).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditingId(id)} className="text-xs font-semibold text-violet-600 hover:underline px-2 py-1">Edit</button>
                  <button onClick={() => confirm(`Delete "${p.name}"?`) && removeMut.mutate(id)}
                    className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
          {editingId === 'new' && (
            <PolicyForm initial={emptyPolicyForm()} onCancel={() => setEditingId(null)} onSave={save} saving={createMut.isPending} />
          )}
          {policies.length === 0 && editingId !== 'new' && (
            <p className="text-xs text-slate-400 py-2">No discount policies yet — siblings are invoiced at full price.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Overdue-invoice reminder schedule ─────────────────────────
   Drives invoice-overdue-cron.js: a reminder N days before the due
   date, one on the due date, then every N days after. Channel
   on/off (email/in-app) lives in the generic Notification Settings
   page (invoice_due_soon / invoice_overdue events) — this section is
   only the WHEN, not the WHERE. */
function ReminderScheduleSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'invoice-reminder-config'],
    queryFn:  () => financeApi.invoiceReminderConfig.get(),
  });
  const cfg = data?.data;

  const [form, setForm] = useState(null);
  useEffect(() => {
    if (!cfg || form !== null) return;
    setForm({ ...cfg });
  }, [cfg, form]);
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => financeApi.invoiceReminderConfig.save(form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['finance', 'invoice-reminder-config'] });
      setForm({ ...(res?.data ?? form) });
      toast.success('Reminder schedule saved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save reminder schedule.'),
  });

  const fCls = 'w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-violet-400/40';

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs py-3"><Loader2 size={13} className="animate-spin" /> Loading…</div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Bell size={14} /> Overdue Invoice Reminders</h4>
      <p className="text-xs text-slate-500 mt-0.5 mb-2.5">
        Guardians are reminded on this schedule — a reminder before the due date, one on the due date, then
        recurring after. Whether reminders send by email and/or in-app is set per event in Notification Settings.
      </p>

      <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50 mb-2.5">
        <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
        <span className="text-sm font-medium text-slate-800">Send overdue-invoice reminders</span>
      </label>

      {form.enabled && (
        <div className="space-y-2.5 pl-1">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span>Remind</span>
            <input type="number" min="0" max="30" value={form.beforeDueDays}
              onChange={e => set('beforeDueDays', Number(e.target.value))} className={fCls} />
            <span>day{form.beforeDueDays === 1 ? '' : 's'} before the due date (0 to disable)</span>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={form.onDueDate} onChange={e => set('onDueDate', e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
            Remind on the due date
          </label>

          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span>Then repeat every</span>
            <input type="number" min="0" max="30" value={form.afterDueIntervalDays}
              onChange={e => set('afterDueIntervalDays', Number(e.target.value))} className={fCls} />
            <span>day{form.afterDueIntervalDays === 1 ? '' : 's'} while still unpaid (0 to disable)</span>
          </div>
        </div>
      )}

      <div className="flex justify-end mt-3">
        <button onClick={() => save()} disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save Reminder Schedule'}
        </button>
      </div>
    </div>
  );
}

export default function FeeSettingsModal({ onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: cfgData, isLoading } = useQuery({
    queryKey: ['finance', 'fee-config'],
    queryFn:  () => financeApi.feeConfig.get(),
  });
  const cfg = cfgData?.data;

  const [feeTypes, setFeeTypes] = useState(null);
  useEffect(() => {
    if (!cfg || feeTypes !== null) return;
    setFeeTypes(cfg.feeTypes.map(t => ({ ...t })));
  }, [cfg, feeTypes]);

  const { mutate: saveFeeTypes, isPending: savingFeeTypes } = useMutation({
    mutationFn: () => financeApi.feeConfig.save({ feeTypes }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['finance', 'fee-config'] });
      setFeeTypes(res?.data?.feeTypes?.map(t => ({ ...t })) ?? feeTypes);
      toast.success('Fee types saved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save fee types.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-slate-900">Fee Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5">Fee type catalogue and sibling discount policies.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>

        {isLoading || !feeTypes ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
            <Loader2 size={16} className="animate-spin" /> Loading fee settings…
          </div>
        ) : (
          <div className="p-5 space-y-6">
            <FeeTypeCatalogueEditor types={feeTypes} onChange={setFeeTypes} />

            <div className="flex justify-end">
              <button onClick={() => saveFeeTypes()} disabled={savingFeeTypes}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {savingFeeTypes ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {savingFeeTypes ? 'Saving…' : 'Save Fee Types'}
              </button>
            </div>

            <div className="pt-1 border-t border-slate-100" />

            <DiscountPoliciesSection />

            <div className="pt-1 border-t border-slate-100" />

            <ReminderScheduleSection />
          </div>
        )}
      </div>
    </div>
  );
}
