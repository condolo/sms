/* ============================================================
   FeeStructureSlideOver — slide-over to create a fee structure
   Default export: FeeStructureSlideOver    (the slide-over)
   Named export:   CreateFeeStructureButton (header button + portal)
   ============================================================ */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';

/* ── Header button ─────────────────────────────────────────── */
export function CreateFeeStructureButton({ fmtCurrency }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <Plus size={15} /> New Fee Structure
      </button>
      <AnimatePresence>
        {open && (
          <FeeStructureSlideOver
            fmtCurrency={fmtCurrency}
            onClose={() => setOpen(false)}
            onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['finance', 'fee-structures'] }); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ── Slide-over ────────────────────────────────────────────── */
export default function FeeStructureSlideOver({ fmtCurrency, onClose, onCreated }) {
  const [name,    setName]    = useState('');
  const [desc,    setDesc]    = useState('');
  const [year,    setYear]    = useState(new Date().getFullYear().toString());
  const [term,    setTerm]    = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items,   setItems]   = useState([{ description: 'Tuition Fee', quantity: 1, unitPrice: 0 }]);
  const [errors,  setErrors]  = useState({});

  const total = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.quantity || 1), 0);

  const mutation = useMutation({
    mutationFn: data => financeApi.feeStructures.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create fee structure' }),
  });

  function updateItem(i, field, val) {
    setItems(prev => prev.map((item, idx) =>
      idx === i ? { ...item, [field]: field === 'description' ? val : Number(val) } : item
    ));
  }
  function addItem()     { setItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0 }]); }
  function removeItem(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  function submit() {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!items.every(i => i.description.trim())) e.items = 'All line items need a description';
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate({
      name: name.trim(),
      description: desc.trim() || undefined,
      academicYear: year || undefined,
      term: term ? Number(term) : undefined,
      dueDate: dueDate || undefined,
      lineItems: items,
    });
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Fee Structure</h2>
            <p className="text-xs text-slate-400 mt-0.5">Define fees for a term/year — bulk generate invoices later</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Structure Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Term 2 2025 — Full Fee"
              className={`w-full text-sm px-3 py-2 border ${errors.name ? 'border-red-300' : 'border-slate-200'} rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10`}
            />
            {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Description (optional)</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Brief description…"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Academic Year</label>
              <input
                value={year}
                onChange={e => setYear(e.target.value)}
                placeholder="2025"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Term</label>
              <select
                value={term}
                onChange={e => setTerm(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                <option value="">All terms</option>
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>

          {/* Fee line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Fee Items *</label>
              <button type="button" onClick={addItem} className="text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1">
                <Plus size={12} /> Add item
              </button>
            </div>
            {errors.items && <p className="text-[11px] text-red-500 mb-2">{errors.items}</p>}
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={item.description}
                    onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="e.g. Tuition Fee"
                    className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  <input
                    type="number" min="1"
                    value={item.quantity}
                    onChange={e => updateItem(i, 'quantity', e.target.value)}
                    className="w-14 text-sm px-2 py-2 border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  <input
                    type="number" min="0"
                    value={item.unitPrice}
                    onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                    placeholder="Amount"
                    className="w-28 text-sm px-3 py-2 border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)} className="text-slate-400 hover:text-red-500 p-1"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
              <div className="text-sm font-bold text-slate-800">Total per student: {fmtCurrency(total)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Save Fee Structure'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
