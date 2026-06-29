/* ============================================================
   InvoicesTab — paginated invoice list with search/filter,
   print, and void actions
   Props: fmtCurrency fn, page, onPage, canCreate, school
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, FileText, Search, X, Ban, Printer, Upload } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { RowSkeleton, EmptyOrError } from './FinancePrimitives.jsx';
import { LIMIT, INV_STATUS_BADGE } from '../constants.js';
import BulkImportSlideOver from '@/components/import/BulkImportSlideOver.jsx';

export default function InvoicesTab({ fmtCurrency, page, onPage, canCreate, school }) {
  const qc = useQueryClient();
  const [search,       setSearch]       = useState('');
  const [debSearch,    setDebSearch]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showImport,   setShowImport]   = useState(false);
  const timer = useState(null);

  function printInvoice(inv) {
    const schoolName = school?.name ?? 'School';
    const invNo      = inv.invoiceNumber ?? `INV-${(inv._id ?? inv.id ?? '').slice(-6).toUpperCase()}`;
    const dueDate    = inv.dueDate
      ? new Date(inv.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const itemRows = (inv.items ?? []).map(item =>
      `<tr>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9">${item.description}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:center">${item.quantity ?? 1}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${fmtCurrency(item.unitPrice)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${fmtCurrency((item.quantity ?? 1) * (item.unitPrice ?? 0))}</td>
      </tr>`
    ).join('');
    const statusColor = inv.status === 'paid' ? '#059669' : inv.status === 'overdue' ? '#dc2626' : '#d97706';
    const html = `<!DOCTYPE html><html><head><title>Invoice ${invNo}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:40px;color:#1e293b;max-width:640px;margin:auto}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:24px}
  .hdr h1{margin:0 0 4px;font-size:22px}.hdr p{margin:0;font-size:12px;color:#64748b}
  .status{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:white;background:${statusColor};text-transform:capitalize}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;font-size:13px}
  .meta .k{color:#64748b;margin-bottom:2px}.meta .v{font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}
  thead th{background:#f8fafc;padding:9px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0}
  .total-row td{padding:12px;font-weight:700;border-top:2px solid #e2e8f0;font-size:15px}
  .footer{margin-top:32px;text-align:center;font-size:11px;color:#94a3b8}
  @media print{body{padding:20px}}
</style></head><body>
<div class="hdr">
  <div><h1>${schoolName}</h1><p>Invoice</p></div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;margin-bottom:6px">${invNo}</div>
    <div class="status">${inv.status ?? 'unpaid'}</div>
  </div>
</div>
<div class="meta">
  <div><div class="k">Student</div><div class="v">${inv.studentName ?? '—'}</div></div>
  <div><div class="k">Due Date</div><div class="v">${dueDate}</div></div>
  <div><div class="k">Total</div><div class="v">${fmtCurrency(inv.total)}</div></div>
  <div><div class="k">Balance Due</div><div class="v" style="color:${inv.balance > 0 ? '#d97706' : '#059669'}">${fmtCurrency(inv.balance)}</div></div>
</div>
${itemRows ? `<table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${itemRows}</tbody>
<tr class="total-row"><td colspan="3">Total</td><td style="text-align:right">${fmtCurrency(inv.total)}</td></tr></table>` : ''}
<div class="footer">${schoolName} · Thank you for your payment.</div>
</body></html>`;
    const win = window.open('', '_blank', 'width=700,height=860');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'invoices', { page, search: debSearch, status: statusFilter }],
    queryFn:  () => financeApi.invoices.list({
      page,
      limit: LIMIT,
      ...(debSearch    && { search: debSearch }),
      ...(statusFilter && { status: statusFilter }),
    }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};

  const { mutate: voidInvoice, variables: voidingId } = useMutation({
    mutationFn: id => financeApi.invoices.void(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });

  function onSearch(v) {
    setSearch(v);
    clearTimeout(timer[0]);
    timer[0] = setTimeout(() => { setDebSearch(v); onPage(1); }, 350);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar — search, filter, import */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search invoices…"
            className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400 transition"
          />
          {search && (
            <button onClick={() => { setSearch(''); setDebSearch(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <X size={13} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); onPage(1); }}
          className="text-sm px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="void">Void</option>
        </select>
        {canCreate && (
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800 transition-colors"
            title="Bulk import invoices from CSV"
          >
            <Upload size={14} />
            Import
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <RowSkeleton count={6} />
        ) : isError ? (
          <EmptyOrError icon={<AlertTriangle size={24} className="text-red-400" />} msg={error?.message} onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyOrError icon={<FileText size={28} className="opacity-40" />} msg="No invoices found" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Student</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Balance</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Due</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(inv => {
                const id       = inv.id ?? inv._id;
                const sts      = INV_STATUS_BADGE[inv.status] ?? INV_STATUS_BADGE.unpaid;
                const isVoiding = voidingId === id;
                return (
                  <tr key={id} className={`hover:bg-slate-50 transition group ${isVoiding ? 'opacity-40' : ''}`}>
                    <td className="py-3.5 px-5">
                      <span className="font-mono text-xs text-slate-500">{inv.invoiceNumber ?? '—'}</span>
                      {inv.title && <p className="text-xs text-slate-600 mt-0.5 truncate max-w-36">{inv.title}</p>}
                    </td>
                    <td className="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-700">{inv.studentName ?? inv.studentId ?? '—'}</td>
                    <td className="py-3.5 px-4 text-right font-semibold text-slate-800 tabular-nums">{fmtCurrency(inv.total)}</td>
                    <td className="py-3.5 px-4 text-right hidden sm:table-cell tabular-nums">
                      <span className={inv.balance > 0 ? 'text-amber-600 font-medium' : 'text-slate-400'}>{fmtCurrency(inv.balance)}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full capitalize ${sts}`}>{inv.status}</span>
                    </td>
                    <td className="py-3.5 px-4 hidden md:table-cell text-xs text-slate-400">
                      {inv.dueDate
                        ? new Date(inv.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={() => printInvoice(inv)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                          title="Print invoice"
                        >
                          <Printer size={13} />
                        </button>
                        {canCreate && inv.status !== 'void' && inv.status !== 'paid' && (
                          <button
                            onClick={() => confirm('Void this invoice? This cannot be undone.') && voidInvoice(id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                            title="Void invoice"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={onPage} />

      <AnimatePresence>
        {showImport && (
          <BulkImportSlideOver
            type="finance"
            label="Invoices"
            onClose={() => setShowImport(false)}
            onImported={() => qc.invalidateQueries({ queryKey: ['invoices'] })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
