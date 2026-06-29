/* ============================================================
   FeeStructureTab — fee structure list with expand/collapse,
   generate invoices, and delete actions
   Props: fmtCurrency fn, canCreate bool
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ListChecks, Loader2, Zap, ChevronDown, Trash2,
} from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import { EmptyOrError } from './FinancePrimitives.jsx';

export default function FeeStructureTab({ fmtCurrency, canCreate }) {
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
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}
        </div>
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
                      <p className="text-xs text-slate-400 mt-2">
                        Due date: {new Date(fs.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                    )}
                    {fs.classIds?.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">
                        Applies to {fs.classIds.length} class{fs.classIds.length !== 1 ? 'es' : ''}
                      </p>
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
