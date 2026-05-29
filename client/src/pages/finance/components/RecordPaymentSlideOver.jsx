/* ============================================================
   RecordPaymentSlideOver — slide-over to record a payment
   Default export: RecordPaymentSlideOver (the slide-over)
   Named export:   RecordPaymentButton   (header button + portal)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Search, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';

/* ── Header button ─────────────────────────────────────────── */
export function RecordPaymentButton({ fmtCurrency, currency }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <Plus size={15} /> Record Payment
      </button>
      <AnimatePresence>
        {open && (
          <RecordPaymentSlideOver
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
export default function RecordPaymentSlideOver({ fmtCurrency, onClose, onCreated }) {
  const [invoiceSearch,   setInvoiceSearch]   = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date,   setDate]   = useState(new Date().toISOString().slice(0, 10));
  const [notes,  setNotes]  = useState('');
  const [errors, setErrors] = useState({});

  const { data: invData } = useQuery({
    queryKey: ['finance', 'invoices', 'search-pay', invoiceSearch],
    queryFn:  () => financeApi.invoices.list({ search: invoiceSearch, limit: 10, status: 'unpaid' }),
    enabled:  invoiceSearch.length > 1,
  });
  const invResults = invData?.data ?? [];

  const mutation = useMutation({
    mutationFn: data => financeApi.payments.record(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to record payment' }),
  });

  function submit() {
    const e = {};
    if (!selectedInvoice) e.invoice = 'Select an invoice';
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) e.amount = 'Enter a valid amount';
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate({
      invoiceId: selectedInvoice.id ?? selectedInvoice._id,
      studentId: selectedInvoice.studentId,
      amount: Number(amount),
      method, date, notes,
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
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Record Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          {/* Invoice picker */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Invoice *</label>
            {selectedInvoice ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-emerald-800">{selectedInvoice.invoiceNumber}</p>
                  <p className="text-xs text-emerald-600">{selectedInvoice.studentName} · Balance: {fmtCurrency(selectedInvoice.balance)}</p>
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="text-emerald-500 hover:text-emerald-700"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearch}
                  onChange={e => setInvoiceSearch(e.target.value)}
                  placeholder="Search invoice or student…"
                  className="w-full pl-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                {invResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-10 mt-1 max-h-48 overflow-y-auto">
                    {invResults.map(inv => (
                      <button
                        key={inv._id ?? inv.id}
                        onClick={() => { setSelectedInvoice(inv); setInvoiceSearch(''); setAmount(String(inv.balance ?? '')); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm flex justify-between items-center"
                      >
                        <span className="font-medium text-slate-800">{inv.invoiceNumber} — {inv.studentName}</span>
                        <span className="text-amber-600 font-medium text-xs">{fmtCurrency(inv.balance)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {errors.invoice && <p className="text-[11px] text-red-500 mt-1">{errors.invoice}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Amount *</label>
            <input
              type="number" min="0" step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className={`w-full text-sm px-3 py-2 border ${errors.amount ? 'border-red-300' : 'border-slate-200'} rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10`}
            />
            {errors.amount && <p className="text-[11px] text-red-500 mt-1">{errors.amount}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Payment Method</label>
              <select
                value={method}
                onChange={e => setMethod(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                {['cash', 'mpesa', 'bank_transfer', 'cheque', 'card', 'other'].map(m => (
                  <option key={m} value={m} className="capitalize">{m.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Payment Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Reference number, notes…"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Recording…' : 'Record Payment'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
