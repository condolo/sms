/* ============================================================
   PaymentsTab — paginated payment list with receipt print
   Props: fmtCurrency fn, page, onPage, school
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CreditCard, Printer } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import { RowSkeleton, EmptyOrError } from './FinancePrimitives.jsx';
import { LIMIT } from '../constants.js';

export default function PaymentsTab({ fmtCurrency, page, onPage, school }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'payments', { page }],
    queryFn:  () => financeApi.payments.list({ page, limit: LIMIT }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};

  function printReceipt(p) {
    const schoolName = school?.name ?? 'School';
    const receiptNo  = p.receiptNumber ?? `PMT-${(p._id ?? p.id ?? '').slice(-6).toUpperCase()}`;
    const paidDate   = p.date
      ? new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const html = `<!DOCTYPE html><html><head><title>Payment Receipt — ${receiptNo}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:40px;color:#1e293b;max-width:480px;margin:auto}
  .hdr{text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:24px}
  .hdr h1{margin:0 0 4px;font-size:22px}.hdr p{margin:0;font-size:12px;color:#64748b}
  .ref{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
  .ref .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.ref .val{font-weight:700;font-size:15px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
  .row .k{color:#64748b}.row .v{font-weight:500}
  .total{display:flex;justify-content:space-between;padding:14px 0 0;font-size:16px;font-weight:700}
  .footer{margin-top:32px;text-align:center;font-size:11px;color:#94a3b8}
  @media print{body{padding:20px}}
</style></head><body>
<div class="hdr"><h1>${schoolName}</h1><p>Official Payment Receipt</p></div>
<div class="ref">
  <span><div class="label">Receipt No.</div><div class="val">${receiptNo}</div></span>
  <span><div class="label">Date</div><div class="val">${paidDate}</div></span>
</div>
<div class="row"><span class="k">Student</span><span class="v">${p.studentName ?? p.studentId ?? '—'}</span></div>
<div class="row"><span class="k">Payment Method</span><span class="v" style="text-transform:capitalize">${p.method ?? '—'}</span></div>
${p.notes ? `<div class="row"><span class="k">Notes</span><span class="v">${p.notes}</span></div>` : ''}
<div class="total"><span>Amount Received</span><span style="color:#059669">${fmtCurrency(p.amount)}</span></div>
<div class="footer">Thank you. This is an official receipt from ${schoolName}.</div>
</body></html>`;
    const win = window.open('', '_blank', 'width=540,height=720');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <RowSkeleton count={6} />
        ) : isError ? (
          <EmptyOrError icon={<AlertTriangle size={24} className="text-red-400" />} msg={error?.message} onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyOrError icon={<CreditCard size={28} className="opacity-40" />} msg="No payments recorded yet" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Receipt</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Student</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Method</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(p => (
                <tr key={p._id ?? p.id} className="hover:bg-slate-50 transition group">
                  <td className="py-3.5 px-5">
                    <span className="font-mono text-xs text-slate-500">{p.receiptNumber ?? '—'}</span>
                  </td>
                  <td className="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-700">{p.studentName ?? p.studentId ?? '—'}</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-emerald-600 tabular-nums">{fmtCurrency(p.amount)}</td>
                  <td className="py-3.5 px-4 hidden sm:table-cell">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">{p.method ?? '—'}</span>
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-400">
                    {p.date
                      ? new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="py-3.5 px-4">
                    <button
                      onClick={() => printReceipt(p)}
                      title="Print receipt"
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                    >
                      <Printer size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={onPage} />
    </div>
  );
}
