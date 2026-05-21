/* ============================================================
   Finance — Premium Tabs: Summary | Invoices | Payments
   /platform-audit fixes:
   - Currency from session.school (was hardcoded £ GBP)
   - Summary reads correct API paths: data.invoices.* and data.paymentsByMethod
   - Create invoice slide-over (was dead button)
   - Record payment slide-over (was dead button)
   - Void invoice action
   - Search / filter on invoices
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Wallet, FileText, CreditCard, Plus, Search, X, Filter,
  Loader2, CheckCircle2, AlertTriangle, TrendingUp,
  BadgeDollarSign, Ban, ChevronRight, ListChecks, Trash2,
  Zap, ChevronDown, Users, Printer,
} from 'lucide-react';
import { finance as financeApi, students as studentsApi, classes as classesApi } from '@/api/client.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;
const TABS  = [
  { id: 'summary',   label: 'Overview',      Icon: TrendingUp    },
  { id: 'invoices',  label: 'Invoices',      Icon: FileText      },
  { id: 'overdue',   label: 'Overdue',       Icon: AlertTriangle },
  { id: 'payments',  label: 'Payments',      Icon: CreditCard    },
  { id: 'feestr',    label: 'Fee Structure', Icon: ListChecks    },
];

const INV_STATUS_BADGE = {
  paid:    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  unpaid:  'bg-amber-50   text-amber-700  ring-1 ring-amber-200',
  partial: 'bg-blue-50    text-blue-700   ring-1 ring-blue-200',
  void:    'bg-slate-100  text-slate-400',
  overdue: 'bg-red-50     text-red-600    ring-1 ring-red-200',
};

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-slate-300 mt-0.5">{payload[0].value?.toLocaleString?.() ?? payload[0].value}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
export default function FinancePage() {
  const [tab,  setTab]  = useState('summary');
  const [page, setPage] = useState(1);
  const school = useAuthStore(s => s.session?.school);
  const role   = useAuthStore(s => s.session?.user?.role ?? '');
  const can    = useAuthStore(s => s.can.bind(s));
  const canCreate = can('finance') || role === 'admin' || role === 'superadmin';

  const currency       = school?.currency       ?? 'KES';
  const currencySymbol = school?.currencySymbol ?? 'KSh';

  function fmtCurrency(n) {
    if (n == null || isNaN(Number(n))) return '—';
    try {
      return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${currencySymbol} ${Number(n).toLocaleString()}`;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Finance</h1>
            <p className="text-sm text-slate-500 mt-0.5">Invoices, payments, and financial overview</p>
          </div>
          {canCreate && tab === 'invoices' && <CreateInvoiceButton fmtCurrency={fmtCurrency} currency={currency} />}
          {canCreate && tab === 'payments' && <RecordPaymentButton fmtCurrency={fmtCurrency} currency={currency} />}
          {canCreate && tab === 'feestr'   && <CreateFeeStructureButton fmtCurrency={fmtCurrency} />}
        </div>

        {/* Tabs */}
        <div className="max-w-screen-2xl mx-auto mt-4 flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setPage(1); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
            >
              <t.Icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5">
        {tab === 'summary'  && <SummaryTab  fmtCurrency={fmtCurrency} />}
        {tab === 'invoices' && <InvoicesTab fmtCurrency={fmtCurrency} page={page} onPage={setPage} canCreate={canCreate} school={school} />}
        {tab === 'overdue'  && <OverdueTab  fmtCurrency={fmtCurrency} />}
        {tab === 'payments' && <PaymentsTab fmtCurrency={fmtCurrency} page={page} onPage={setPage} school={school} />}
        {tab === 'feestr'   && <FeeStructureTab fmtCurrency={fmtCurrency} canCreate={canCreate} currency={currency} />}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SUMMARY TAB — correct API path: data.invoices.*
   ══════════════════════════════════════════════════════════ */
function SummaryTab({ fmtCurrency }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn:  () => financeApi.summary(),
    staleTime: 5 * 60_000,
  });

  // CORRECT paths: data.invoices.totalPaid, not data.totalCollected
  const inv   = data?.data?.invoices         ?? {};
  const meths = data?.data?.paymentsByMethod ?? [];

  const totalInvoiced = inv.totalInvoiced ?? 0;
  const totalPaid     = inv.totalPaid     ?? 0;
  const totalBalance  = inv.totalBalance  ?? 0;
  const countInvoices = inv.countInvoices ?? 0;
  const countPaid     = inv.countPaid     ?? 0;
  const countUnpaid   = inv.countUnpaid   ?? 0;
  const countPartial  = inv.countPartial  ?? 0;
  const collectionRate = totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0;

  const pieFeeData = totalInvoiced > 0 ? [
    { name: 'Collected',   value: totalPaid,    fill: '#10b981' },
    { name: 'Outstanding', value: totalBalance, fill: '#f59e0b' },
  ] : [];

  const statusData = [
    { name: 'Paid',    value: countPaid,    fill: '#10b981' },
    { name: 'Unpaid',  value: countUnpaid,  fill: '#f59e0b' },
    { name: 'Partial', value: countPartial, fill: '#3b82f6' },
  ].filter(d => d.value > 0);

  const methodBarData = meths.map((m, i) => ({
    method: m._id ?? 'Other',
    amount: m.totalCollected,
    count:  m.count,
  }));

  const METHOD_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ec4899'];

  if (isLoading) return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-28" />)}
    </div>
  );
  if (isError) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertTriangle size={24} className="text-red-400" />
      <p className="text-sm text-slate-500">{error?.message}</p>
      <button onClick={refetch} className="text-xs underline text-slate-700">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Total Invoiced"   value={fmtCurrency(totalInvoiced)} accent="slate"   icon={<FileText size={18} />} />
        <SummaryCard label="Fees Collected"   value={fmtCurrency(totalPaid)}     accent="emerald" icon={<CheckCircle2 size={18} />} sub={`${collectionRate}% collection rate`} />
        <SummaryCard label="Outstanding"      value={fmtCurrency(totalBalance)}  accent="amber"   icon={<BadgeDollarSign size={18} />} />
        <SummaryCard label="Total Invoices"   value={countInvoices.toLocaleString()} accent="blue" icon={<Wallet size={18} />} sub={`${countPaid} paid · ${countUnpaid} unpaid`} />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Fee collection donut */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Fee Collection</p>
          {pieFeeData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={pieFeeData} innerRadius={38} outerRadius={60} paddingAngle={3} dataKey="value">
                    {pieFeeData.map((d,i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3">
                {pieFeeData.map(d => (
                  <div key={d.name}>
                    <div className="flex justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                        <span className="text-xs text-slate-600">{d.name}</span>
                      </div>
                      <span className="text-xs font-semibold text-slate-800">{fmtCurrency(d.value)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${totalInvoiced > 0 ? Math.round((d.value/totalInvoiced)*100) : 0}%`, background: d.fill }} />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">{collectionRate}% collection rate</p>
              </div>
            </div>
          ) : <p className="text-xs text-slate-400 py-8 text-center">No invoice data yet</p>}
        </div>

        {/* Invoice status donut */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Invoice Status</p>
          {statusData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={statusData} innerRadius={38} outerRadius={60} paddingAngle={3} dataKey="value">
                    {statusData.map((d,i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2.5">
                {statusData.map(d => (
                  <div key={d.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                      <span className="text-xs text-slate-600">{d.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-800 tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-xs text-slate-400 py-8 text-center">No invoices yet</p>}
        </div>

        {/* Payment methods bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Payment Methods</p>
          {methodBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={methodBarData} margin={{ top:0, right:0, left:-25, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="method" tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:10, fill:'#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="count" radius={[4,4,0,0]} maxBarSize={32}>
                  {methodBarData.map((_,i) => <Cell key={i} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-slate-400 py-8 text-center">No payment data yet</p>}
        </div>
      </div>
    </div>
  );
}

const METHOD_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ec4899'];

function SummaryCard({ label, value, sub, accent, icon }) {
  const ACCENT = {
    slate:   { bg: 'bg-slate-50',   icon: 'text-slate-600'   },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600'   },
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600'    },
  };
  const c = ACCENT[accent] ?? ACCENT.slate;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center ${c.icon} mb-4`}>{icon}</div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      <p className="text-xs font-medium text-slate-500 mt-3">{label}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   OVERDUE TAB
   ══════════════════════════════════════════════════════════ */
function OverdueTab({ fmtCurrency }) {
  const today = new Date();
  today.setHours(0,0,0,0);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance','invoices','overdue'],
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
      ['Invoice No.','Student','Total','Balance','Due Date','Days Overdue'],
      ...rows.map(r => [
        r.invoiceNumber ?? '',
        r.studentName ?? '',
        r.total ?? '',
        r.balance ?? '',
        r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-GB') : '',
        daysOverdue(r.dueDate),
      ]),
    ].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `overdue_invoices_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  if (isLoading) return <RowSkeleton count={5} />;
  if (isError) return <EmptyOrError icon={<AlertTriangle size={24} className="text-red-400" />} msg={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Overdue Invoices"   value={rows.length.toLocaleString()} accent="red"   icon={<AlertTriangle size={18} />} />
        <SummaryCard label="Total Balance Due"  value={fmtCurrency(totalBalance)}   accent="amber" icon={<BadgeDollarSign size={18} />} />
        <SummaryCard label="Avg Days Overdue"   value={rows.length ? `${avgDays} days` : '—'} accent="slate" icon={<FileText size={18} />} />
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
            <h3 className="text-sm font-medium text-slate-700">{rows.length} overdue invoice{rows.length !== 1 ? 's' : ''}</h3>
            <button onClick={exportOverdue} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition">
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
                const days = daysOverdue(inv.dueDate);
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
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}
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

/* ══════════════════════════════════════════════════════════
   INVOICES TAB
   ══════════════════════════════════════════════════════════ */
function InvoicesTab({ fmtCurrency, page, onPage, canCreate, school }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const timer = useState(null);

  function printInvoice(inv) {
    const schoolName = school?.name ?? 'School';
    const invNo   = inv.invoiceNumber ?? `INV-${(inv._id ?? inv.id ?? '').slice(-6).toUpperCase()}`;
    const dueDate = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : '—';
    const itemRows = (inv.items ?? []).map(item =>
      `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9">${item.description}</td>
       <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:center">${item.quantity ?? 1}</td>
       <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${fmtCurrency(item.unitPrice)}</td>
       <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${fmtCurrency((item.quantity ?? 1) * (item.unitPrice ?? 0))}</td></tr>`
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
      page, limit: LIMIT,
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
      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search invoices…"
            className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400 transition"
          />
          {search && <button onClick={() => { setSearch(''); setDebSearch(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X size={13} /></button>}
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
                const id  = inv._id ?? inv.id;
                const sts = INV_STATUS_BADGE[inv.status] ?? INV_STATUS_BADGE.unpaid;
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
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'}
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PAYMENTS TAB
   ══════════════════════════════════════════════════════════ */
function PaymentsTab({ fmtCurrency, page, onPage, school }) {
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
    const paidDate   = p.date ? new Date(p.date).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : '—';
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
<div class="ref"><span><div class="label">Receipt No.</div><div class="val">${receiptNo}</div></span><span><div class="label">Date</div><div class="val">${paidDate}</div></span></div>
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
        {isLoading ? <RowSkeleton count={6} /> :
         isError   ? <EmptyOrError icon={<AlertTriangle size={24} className="text-red-400" />} msg={error?.message} onRetry={refetch} /> :
         rows.length === 0 ? <EmptyOrError icon={<CreditCard size={28} className="opacity-40" />} msg="No payments recorded yet" /> : (
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
                    {p.date ? new Date(p.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'}
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

/* ── Header action buttons ────────────────────────────────── */
function CreateInvoiceButton({ fmtCurrency, currency }) {
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
        {open && <CreateInvoiceSlideOver fmtCurrency={fmtCurrency} currency={currency} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['finance'] }); }} />}
      </AnimatePresence>
    </>
  );
}

function RecordPaymentButton({ fmtCurrency, currency }) {
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
        {open && <RecordPaymentSlideOver fmtCurrency={fmtCurrency} currency={currency} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['finance'] }); }} />}
      </AnimatePresence>
    </>
  );
}

/* ── Create Invoice Slide-Over ────────────────────────────── */
function CreateInvoiceSlideOver({ fmtCurrency, onClose, onCreated }) {
  const [studentSearch, setStudentSearch] = useState('');
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
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: field === 'description' ? val : Number(val) } : item));
  }
  function addItem()    { setItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0 }]); }
  function removeItem(i){ setItems(prev => prev.filter((_, idx) => idx !== i)); }

  function submit() {
    const e = {};
    if (!selectedStudent) e.student = 'Select a student';
    if (!items.every(i => i.description.trim())) e.items = 'All line items need a description';
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate({
      studentId: selectedStudent._id ?? selectedStudent.id,
      title,
      dueDate: dueDate || undefined,
      lineItems: items,
    });
  }

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">New Invoice</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
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
                      <button key={s._id??s.id} onClick={() => { setSelectedStudent(s); setStudentSearch(''); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm flex items-center gap-2">
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
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
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
                  <input value={item.description} onChange={e => updateItem(i,'description',e.target.value)}
                    placeholder="Description" className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
                  <input type="number" min="1" value={item.quantity} onChange={e => updateItem(i,'quantity',e.target.value)}
                    className="w-14 text-sm px-2 py-2 border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
                  <input type="number" min="0" value={item.unitPrice} onChange={e => updateItem(i,'unitPrice',e.target.value)}
                    placeholder="Price" className="w-24 text-sm px-3 py-2 border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)} className="text-slate-400 hover:text-red-500 p-1"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
              <div className="text-sm font-semibold text-slate-800">
                Total: {fmtCurrency(lineTotal)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={submit} disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Record Payment Slide-Over ────────────────────────────── */
function RecordPaymentSlideOver({ fmtCurrency, onClose, onCreated }) {
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date,   setDate]   = useState(new Date().toISOString().slice(0,10));
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
      invoiceId: selectedInvoice._id ?? selectedInvoice.id,
      studentId: selectedInvoice.studentId,
      amount: Number(amount),
      method, date, notes,
    });
  }

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Record Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

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
                      <button key={inv._id??inv.id} onClick={() => { setSelectedInvoice(inv); setInvoiceSearch(''); setAmount(String(inv.balance ?? '')); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm flex justify-between items-center">
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
            <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className={`w-full text-sm px-3 py-2 border ${errors.amount ? 'border-red-300' : 'border-slate-200'} rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10`} />
            {errors.amount && <p className="text-[11px] text-red-500 mt-1">{errors.amount}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Payment Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10">
                {['cash','mpesa','bank_transfer','cheque','card','other'].map(m => (
                  <option key={m} value={m} className="capitalize">{m.replace('_',' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Payment Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Reference number, notes…"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 resize-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={submit} disabled={mutation.isPending}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Recording…' : 'Record Payment'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   FEE STRUCTURE TAB
   ══════════════════════════════════════════════════════════ */
function FeeStructureTab({ fmtCurrency, canCreate }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(null);
  const [genResult,  setGenResult]  = useState(null);
  const [expanded,   setExpanded]   = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'fee-structures'],
    queryFn:  () => financeApi.feeStructures.list(),
    staleTime: 5 * 60_000,
  });
  const structures = data?.data ?? [];

  const removeMut = useMutation({
    mutationFn: id => financeApi.feeStructures.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['finance', 'fee-structures'] }),
  });

  async function generate(fs) {
    setGenerating(fs.id);
    setGenResult(null);
    try {
      const r = await financeApi.feeStructures.generate(fs.id);
      setGenResult({ id: fs.id, count: r.data?.created ?? 0, msg: r.data?.message });
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (err) {
      setGenResult({ id: fs.id, error: err?.message ?? 'Generation failed' });
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <ListChecks size={14} className="text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          Define standard fee structures per term/class. Once saved, use <strong>Generate Invoices</strong> to bulk-create invoices for all matching active students — skipping any who already have an invoice from that structure.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}</div>
      ) : isError ? (
        <EmptyOrError icon={<AlertTriangle size={24} className="text-red-400" />} msg={error?.message} onRetry={refetch} />
      ) : structures.length === 0 ? (
        <EmptyOrError icon={<ListChecks size={32} className="opacity-40" />} msg="No fee structures yet. Create one to get started." />
      ) : (
        <div className="space-y-3">
          {structures.map(fs => {
            const isExpanded = expanded === fs.id;
            const result     = genResult?.id === fs.id ? genResult : null;
            return (
              <div key={fs.id ?? fs._id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800">{fs.name}</p>
                      {fs.academicYear && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{fs.academicYear}</span>}
                      {fs.term && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">Term {fs.term}</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fs.lineItems?.length ?? 0} line item{(fs.lineItems?.length ?? 0) !== 1 ? 's' : ''} · Total: {fmtCurrency(fs.total)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canCreate && (
                      <button
                        onClick={() => generate(fs)}
                        disabled={!!generating}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
                        title="Generate invoices for all active students"
                      >
                        {generating === fs.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Zap size={12} />
                        }
                        Generate Invoices
                      </button>
                    )}
                    <button
                      onClick={() => setExpanded(isExpanded ? null : fs.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                    >
                      <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {canCreate && (
                      <button
                        onClick={() => confirm(`Delete "${fs.name}"?`) && removeMut.mutate(fs.id ?? fs._id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Generation result */}
                {result && (
                  <div className={`mx-5 mb-3 px-3 py-2 rounded-lg text-xs font-medium ${result.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                    {result.error
                      ? `Error: ${result.error}`
                      : result.count > 0
                        ? `Success — ${result.count} invoice${result.count !== 1 ? 's' : ''} created.`
                        : (result.msg ?? 'No new invoices created (already up to date).')}
                  </div>
                )}

                {/* Expanded line items */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-5 py-4">
                    {fs.description && <p className="text-xs text-slate-500 mb-3">{fs.description}</p>}
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left py-1.5 font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                          <th className="text-center py-1.5 font-semibold text-slate-500 uppercase tracking-wide w-16">Qty</th>
                          <th className="text-right py-1.5 font-semibold text-slate-500 uppercase tracking-wide w-24">Unit Price</th>
                          <th className="text-right py-1.5 font-semibold text-slate-500 uppercase tracking-wide w-24">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {(fs.lineItems ?? []).map((item, i) => (
                          <tr key={i}>
                            <td className="py-2 text-slate-700">{item.description}</td>
                            <td className="py-2 text-center text-slate-500">{item.quantity ?? 1}</td>
                            <td className="py-2 text-right text-slate-700">{fmtCurrency(item.unitPrice)}</td>
                            <td className="py-2 text-right font-medium text-slate-800">{fmtCurrency((item.unitPrice ?? 0) * (item.quantity ?? 1))}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200">
                          <td colSpan={3} className="py-2 text-right font-semibold text-slate-700">Total</td>
                          <td className="py-2 text-right font-bold text-slate-900">{fmtCurrency(fs.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {fs.dueDate && (
                      <p className="text-xs text-slate-400 mt-2">Due date: {new Date(fs.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    )}
                    {fs.classIds?.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">Applies to {fs.classIds.length} class{fs.classIds.length !== 1 ? 'es' : ''}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Create Fee Structure Button + Slide-Over ─────────────── */
function CreateFeeStructureButton({ fmtCurrency }) {
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

function FeeStructureSlideOver({ fmtCurrency, onClose, onCreated }) {
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
    setItems(prev => prev.map((item, idx) => idx === i
      ? { ...item, [field]: field === 'description' ? val : Number(val) }
      : item));
  }
  function addItem()    { setItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0 }]); }
  function removeItem(i){ setItems(prev => prev.filter((_, idx) => idx !== i)); }

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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Structure Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Term 2 2025 — Full Fee"
              className={`w-full text-sm px-3 py-2 border ${errors.name ? 'border-red-300' : 'border-slate-200'} rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10`} />
            {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Description (optional)</label>
            <input value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Brief description…"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Academic Year</label>
              <input value={year} onChange={e => setYear(e.target.value)} placeholder="2025"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Term</label>
              <select value={term} onChange={e => setTerm(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10">
                <option value="">All terms</option>
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
            </div>
          </div>

          {/* Line items */}
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
                  <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="e.g. Tuition Fee" className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
                  <input type="number" min="1" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)}
                    className="w-14 text-sm px-2 py-2 border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
                  <input type="number" min="0" value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                    placeholder="Amount" className="w-28 text-sm px-3 py-2 border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
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
          <button onClick={submit} disabled={mutation.isPending}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Save Fee Structure'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Shared helpers ───────────────────────────────────────── */
function RowSkeleton({ count = 5 }) {
  return (
    <div className="divide-y divide-slate-50">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
          <div className="h-3 bg-slate-100 rounded w-24" />
          <div className="flex-1 h-3 bg-slate-100 rounded" />
          <div className="h-3 bg-slate-100 rounded w-16" />
          <div className="h-5 bg-slate-100 rounded w-14" />
        </div>
      ))}
    </div>
  );
}

function EmptyOrError({ icon, msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
      {icon}
      <p className="text-sm text-slate-500">{msg ?? 'Nothing to show'}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>}
    </div>
  );
}
