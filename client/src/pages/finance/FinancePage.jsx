import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { finance as financeApi } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { ErrorState, EmptyState } from '@/components/ui/EmptyState.jsx';
import { invoiceStatusBadge } from '@/components/ui/Badge.jsx';
import { Pagination } from '@/components/ui/Pagination.jsx';

const LIMIT = 20;
const TABS = ['invoices', 'payments', 'summary'];

export default function FinancePage() {
  const [tab, setTab]   = useState('invoices');
  const [page, setPage] = useState(1);

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Finance</h2>

      <div className="flex gap-2 border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition capitalize ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab page={page} onPage={setPage} />}
      {tab === 'payments' && <PaymentsTab page={page} onPage={setPage} />}
      {tab === 'summary'  && <SummaryTab />}
    </div>
  );
}

function InvoicesTab({ page, onPage }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'invoices', { page }],
    queryFn:  () => financeApi.invoices.list({ page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? {};

  if (isLoading) return <PageSpinner message="Loading invoices…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;
  if (!rows.length) return <EmptyState icon="💳" title="No invoices found" />;

  return (
    <>
      <div className="card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Student</th>
              <th className="text-right">Total</th>
              <th className="text-right hidden sm:table-cell">Outstanding</th>
              <th>Status</th>
              <th className="hidden md:table-cell">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv._id}>
                <td className="font-mono text-xs text-slate-500">{inv.invoiceNumber}</td>
                <td className="text-slate-700">{inv.studentName ?? inv.studentId}</td>
                <td className="text-right font-medium">£{Number(inv.total ?? 0).toFixed(2)}</td>
                <td className="text-right hidden sm:table-cell text-slate-600">£{Number(inv.balance ?? 0).toFixed(2)}</td>
                <td>{invoiceStatusBadge(inv.status)}</td>
                <td className="hidden md:table-cell text-xs text-slate-400">
                  {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={onPage} />
    </>
  );
}

function PaymentsTab({ page, onPage }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'payments', { page }],
    queryFn:  () => financeApi.payments.list({ page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const pagination = data?.pagination ?? {};

  if (isLoading) return <PageSpinner message="Loading payments…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;
  if (!rows.length) return <EmptyState icon="💰" title="No payments recorded" />;

  return (
    <>
      <div className="card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Receipt No.</th>
              <th>Student</th>
              <th className="text-right">Amount</th>
              <th className="hidden sm:table-cell">Method</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td className="font-mono text-xs text-slate-500">{p.receiptNumber}</td>
                <td className="text-slate-700">{p.studentName ?? p.studentId}</td>
                <td className="text-right font-medium text-green-600">£{Number(p.amount ?? 0).toFixed(2)}</td>
                <td className="hidden sm:table-cell capitalize text-slate-500">{p.method ?? '—'}</td>
                <td className="text-xs text-slate-400">
                  {p.date ? new Date(p.date).toLocaleDateString('en-GB') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={onPage} />
    </>
  );
}

function SummaryTab() {
  const year = new Date().getFullYear();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'summary', year],
    queryFn:  () => financeApi.summary({ year }),
  });
  const s = data?.data ?? {};

  if (isLoading) return <PageSpinner message="Loading summary…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;

  const stats = [
    { label: 'Total invoiced',     value: `£${Number(s.totalInvoiced ?? 0).toLocaleString('en-GB')}`,   color: 'text-slate-800' },
    { label: 'Total collected',    value: `£${Number(s.totalCollected ?? 0).toLocaleString('en-GB')}`,  color: 'text-green-600' },
    { label: 'Outstanding',        value: `£${Number(s.outstanding ?? 0).toLocaleString('en-GB')}`,     color: 'text-amber-600' },
    { label: 'Overdue invoices',   value: String(s.overdueCount ?? 0),                                  color: 'text-red-600' },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="card text-center">
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-xs text-slate-500 mt-1">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
