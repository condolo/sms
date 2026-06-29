/* ============================================================
   CreateInvoiceSlideOver — slide-over form to create an invoice
   Default export: CreateInvoiceSlideOver (the slide-over)
   Named export:   CreateInvoiceButton  (header button + portal)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Search, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { finance as financeApi, students as studentsApi } from '@/api/client.js';

/* ── Header button ─────────────────────────────────────────── */
export function CreateInvoiceButton({ fmtCurrency, currency }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <Plus size={15} /> New Invoice
      </button>
      <AnimatePresence>
        {open && (
          <CreateInvoiceSlideOver
            fmtCurrency={fmtCurrency}
            currency={currency}
            onClose={() => setOpen(false)}
            onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['finance'] }); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ── Slide-over ────────────────────────────────────────────── */
export default function CreateInvoiceSlideOver({ fmtCurrency, onClose, onCreated }) {
  const [studentSearch,   setStudentSearch]   = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [title,   setTitle]   = useState('School Fee Invoice');
  const [dueDate, setDueDate] = useState('');
  const [items,   setItems]   = useState([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [errors,  setErrors]  = useState({});

  const { data: stuData } = useQuery({
    queryKey: ['students', 'search-fin', studentSearch],
    queryFn:  () => studentsApi.list({ search: studentSearch, limit: 10, status: 'active' }),
    enabled:  studentSearch.length > 1,
  });
  const stuResults = stuData?.data ?? [];

  const lineTotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.quantity || 1), 0);

  const mutation = useMutation({
    mutationFn: data => financeApi.invoices.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create invoice' }),
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
    if (!selectedStudent) e.student = 'Select a student';
    if (!items.every(i => i.description.trim())) e.items = 'All line items need a description';
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate({
      studentId: selectedStudent.id ?? selectedStudent._id,
      title,
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
          <h2 className="text-base font-semibold text-slate-900">New Invoice</h2>
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

          {/* Student picker */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Student *</label>
            {selectedStudent ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                <span className="text-sm font-medium text-emerald-800">{selectedStudent.firstName} {selectedStudent.lastName}</span>
                <button onClick={() => setSelectedStudent(null)} className="text-emerald-500 hover:text-emerald-700"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                  placeholder="Search student name…"
                  className="w-full pl-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                {stuResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-10 mt-1 max-h-48 overflow-y-auto">
                    {stuResults.map(s => (
                      <button
                        key={s._id ?? s.id}
                        onClick={() => { setSelectedStudent(s); setStudentSearch(''); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm flex items-center gap-2"
                      >
                        <span className="font-medium text-slate-800">{s.firstName} {s.lastName}</span>
                        <span className="text-slate-400 text-xs">{s.admissionNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {errors.student && <p className="text-[11px] text-red-500 mt-1">{errors.student}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Invoice Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
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

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Line Items *</label>
              <button type="button" onClick={addItem} className="text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1">
                <Plus size={12} /> Add line
              </button>
            </div>
            {errors.items && <p className="text-[11px] text-red-500 mb-2">{errors.items}</p>}
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={item.description}
                    onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="Description"
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
                    placeholder="Price"
                    className="w-24 text-sm px-3 py-2 border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)} className="text-slate-400 hover:text-red-500 p-1"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
              <div className="text-sm font-semibold text-slate-800">Total: {fmtCurrency(lineTotal)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
