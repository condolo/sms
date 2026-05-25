/* ============================================================
   OverdueTab — overdue invoices list + KPI strip + CSV export
   Props: fmtCurrency fn
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, BadgeDollarSign, FileText } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import { SummaryCard, RowSkeleton, EmptyOrError } from './FinancePrimitives.jsx';

export default function OverdueTab({ fmtCurrency }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'invoices', 'overdue'],
    queryFn:  () => financeApi.invoices.list({ status: 'overdue', limit: 200 }),
    staleTime: 2 * 60_000,
  });
  const rows = (data?.data ?? []).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const totalBalance = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const avgDays      = rows.length
    ? Math.round(rows.reduce((s, r) => s + Math.max(0, (today - new Date(r.dueDate)) / 86400000), 0) / rows.length)
    : 0;

  function daysOverdue(dueDate) {
    if (!dueDate) return 0;
    return Math.max(0, Math.floor((today - new Date(dueDate)) / 86400000));
  }

  function exportOverdue() {
    const csv = [
      ['Invoice No.', 'Student', 'Total', 'Balance', 'Due Date', 'Days Overdue'],
      ...rows.map(r => [
        r.invoiceNumber ?? '',
        r.studentName   ?? '',
        r.total         ?? '',
        r.balance       ?? '',
        r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-GB') : '',
        daysOverdue(r.dueDate),
      ]),
    ].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `overdue_invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <RowSkeleton count={5} />;
  if (isError)   return <EmptyOrError icon={<AlertTriangle size={24} className="text-red-400" />} msg={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Overdue Invoices"  value={rows.length.toLocaleString()}               accent="red"   icon={<AlertTriangle size={18} />} />
        <SummaryCard label="Total Balance Due"  value={fmtCurrency(totalBalance)}                  accent="amber" icon={<BadgeDollarSign size={18} />} />
        <SummaryCard label="Avg Days Overdue"   value={rows.length ? `${avgDays} days` : '—'}      accent="slate" icon={<FileText size={18} />} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-2" />
          <p className="text-sm font-medium text-slate-600">No overdue invoices.</p>
          <p className="text-xs text-slate-400 mt-1">All outstanding invoices are within their due dates.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-medium text-slate-700">
              {rows.length} overdue invoice{rows.length !== 1 ? 's' : ''}
            </h3>
            <button
              onClick={exportOverdue}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition"
            >
              <BadgeDollarSign size={12} /> Export CSV
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Student</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Due Date</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Days Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(inv => {
                const days    = daysOverdue(inv.dueDate);
                const urgency = days > 60 ? 'text-red-600 font-bold' : days > 30 ? 'text-amber-600 font-semibold' : 'text-slate-700';
                return (
                  <tr key={inv._id ?? inv.id} className="hover:bg-slate-50 transition">
                    <td className="py-3.5 px-5">
                      <span className="font-mono text-xs text-slate-500">{inv.invoiceNumber ?? '—'}</span>
                      {inv.title && <p className="text-xs text-slate-500 mt-0.5 truncate max-w-36">{inv.title}</p>}
                    </td>
                    <td className="py-3.5 px-4 hidden sm:table-cell text-sm text-slate-700">{inv.studentName ?? '—'}</td>
                    <td className="py-3.5 px-4 text-right font-semibold text-amber-700 tabular-nums">{fmtCurrency(inv.balance)}</td>
                    <td className="py-3.5 px-4 hidden md:table-cell text-xs text-slate-400">
                      {inv.dueDate
                        ? new Date(inv.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <span className={`text-sm tabular-nums ${urgency}`}>{days > 0 ? `${days}d` : '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
