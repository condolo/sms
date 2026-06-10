/* ============================================================
   SummaryTab — finance overview: KPI cards + 3 charts
   Props: fmtCurrency fn
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { AlertTriangle, FileText, CheckCircle2, BadgeDollarSign, Wallet } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import { ChartTip, SummaryCard, METHOD_COLORS } from './FinancePrimitives.jsx';

export default function SummaryTab({ fmtCurrency }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn:  () => financeApi.summary(),
    staleTime: 5 * 60_000,
  });

  const inv   = data?.data?.invoices        ?? {};
  const meths = data?.data?.paymentsByMethod ?? [];

  const totalInvoiced  = inv.totalInvoiced  ?? 0;
  const totalPaid      = inv.totalPaid      ?? 0;
  const totalBalance   = inv.totalBalance   ?? 0;
  const countInvoices  = inv.countInvoices  ?? 0;
  const countPaid      = inv.countPaid      ?? 0;
  const countUnpaid    = inv.countUnpaid    ?? 0;
  const countPartial   = inv.countPartial   ?? 0;
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

  const methodBarData = meths.map(m => ({
    method: m._id ?? 'Other',
    amount: m.totalCollected,
    count:  m.count,
  }));

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
        <SummaryCard label="Total Invoiced"  value={fmtCurrency(totalInvoiced)}          colorIndex={0} icon={<FileText size={18} />} />
        <SummaryCard label="Fees Collected"  value={fmtCurrency(totalPaid)}              colorIndex={1} icon={<CheckCircle2 size={18} />} sub={`${collectionRate}% collection rate`} />
        <SummaryCard label="Outstanding"     value={fmtCurrency(totalBalance)}           colorIndex={2} icon={<BadgeDollarSign size={18} />} />
        <SummaryCard label="Total Invoices"  value={countInvoices.toLocaleString()}      colorIndex={3} icon={<Wallet size={18} />} sub={`${countPaid} paid · ${countUnpaid} unpaid`} />
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
                    {pieFeeData.map((d, i) => <Cell key={i} fill={d.fill} />)}
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
                      <div className="h-full rounded-full" style={{ width: `${totalInvoiced > 0 ? Math.round((d.value / totalInvoiced) * 100) : 0}%`, background: d.fill }} />
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
                    {statusData.map((d, i) => <Cell key={i} fill={d.fill} />)}
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
              <BarChart data={methodBarData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="method" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {methodBarData.map((_, i) => <Cell key={i} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-slate-400 py-8 text-center">No payment data yet</p>}
        </div>
      </div>
    </div>
  );
}
