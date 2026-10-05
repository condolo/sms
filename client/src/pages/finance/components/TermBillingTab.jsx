/* ============================================================
   Finance → Term Billing
   Puts each student's transport fare (one-way or two-way) and extra-curricular
   activities onto their invoice for one term. Always preview first: the
   preview shows exactly what would be billed and what would be skipped, and
   why, before any invoice is created. Running it again for the same term is
   safe: students already billed are skipped.

   Early payment (paid before the term starts) is confirmed by the bursar,
   per invoice, below. Confirming applies the discount only if a payment was
   received on or before the deadline; the server checks that.
   ============================================================ */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { finance as financeApi } from '@/api/client.js';
import AcademicPeriodPicker from './AcademicPeriodPicker.jsx';

function EarlyPaymentPanel({ termId, money, canConfirm }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const { data: resp, isLoading } = useQuery({
    queryKey: ['finance', 'term-early-payments', termId],
    queryFn:  () => financeApi.termBilling.earlyPayments(termId),
    enabled:  !!termId,
    staleTime: 0,
  });
  const rows = resp?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance', 'term-early-payments', termId] });

  const confirmMut = useMutation({
    mutationFn: (id) => financeApi.termBilling.confirmEarlyPayment(id),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(e.message ?? 'Could not confirm early payment'),
  });
  const changeMut = useMutation({
    mutationFn: ({ id, deadline }) => financeApi.termBilling.changeEarlyPayment(id, { deadline }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(e.message ?? 'Could not change the deadline'),
  });

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">Early payment (bursar confirms)</h3>
      <p className="text-xs text-slate-500">
        Early payment is paid before the term starts. Confirm it here once the payment has been received. The deadline can be changed until it is confirmed.
      </p>
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      {isLoading ? <Loader2 className="animate-spin text-slate-400" size={18} /> : rows.length === 0 ? (
        <p className="text-xs text-slate-400">No early-payment terms on this term's invoices. A policy must be active when the term is billed.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500">
            <th className="py-2 font-semibold">Student</th>
            <th className="py-2 font-semibold">Invoice</th>
            <th className="py-2 font-semibold">Pay by</th>
            <th className="py-2 font-semibold text-right">Discount</th>
            <th className="py-2 font-semibold">Status</th>
            {canConfirm && <th />}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="py-2">{r.studentName}</td>
                <td className="py-2 text-xs">{r.invoiceNumber}</td>
                <td className="py-2 text-xs">{r.earlyPaymentDeadline}</td>
                <td className="py-2 text-right text-xs">{r.earlyPaymentPct}%</td>
                <td className="py-2 text-xs">
                  {r.earlyPaymentApplied
                    ? <span className="text-emerald-700">Confirmed {r.earlyPaymentConfirmedAt ? new Date(r.earlyPaymentConfirmedAt).toLocaleDateString('en-GB') : ''}</span>
                    : <span className="text-amber-700">Awaiting confirmation</span>}
                </td>
                {canConfirm && (
                  <td className="py-2 text-right whitespace-nowrap">
                    {!r.earlyPaymentApplied && (
                      <>
                        <button onClick={() => {
                          const deadline = window.prompt('New pay-by date (YYYY-MM-DD)', r.earlyPaymentDeadline);
                          if (deadline) changeMut.mutate({ id: r.id, deadline });
                        }} className="text-xs text-slate-600 hover:underline mr-3">Change date</button>
                        <button onClick={() => confirmMut.mutate(r.id)} disabled={confirmMut.isPending}
                          className="text-xs text-indigo-600 hover:underline">Confirm early payment</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {termId && rows.length > 0 && <p className="text-[11px] text-slate-400">Confirmation fails unless a payment was received on or before the pay-by date.</p>}
    </section>
  );
}

export default function TermBillingTab({ fmtCurrency, canCreate }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState({ academicYearId: '', termId: '' });
  const [preview, setPreview] = useState(null);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const money = (n) => (fmtCurrency ? fmtCurrency(n) : `KES ${Number(n).toLocaleString()}`);

  const previewMut = useMutation({
    mutationFn: () => financeApi.termBilling.preview({ academicYearId: period.academicYearId || undefined, termId: period.termId }),
    onSuccess: (r) => { setPreview(r?.data ?? null); setResult(null); setError(''); },
    onError:   (e) => { setPreview(null); setError(e.message ?? 'Preview failed'); },
  });

  const generateMut = useMutation({
    mutationFn: () => financeApi.termBilling.generate({ academicYearId: period.academicYearId || undefined, termId: period.termId }),
    onSuccess: (r) => {
      setResult(r?.data ?? null);
      setPreview(null);
      setError('');
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
    onError: (e) => setError(e.message ?? 'Term billing failed'),
  });

  function runGenerate() {
    const n = preview?.billable?.length ?? 0;
    if (!window.confirm(`Create ${n} term invoice${n === 1 ? '' : 's'} now? Students already billed for this term are skipped.`)) return;
    generateMut.mutate();
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Bill a term</h3>
        <p className="text-xs text-slate-500">
          Transport is billed at the fare each student chose (one-way or two-way) on their route. Extra-curricular is billed at each activity's amount.
          Students with no fare type chosen, or a route with no fare for it, are never billed silently: they appear under "Not billed" with the reason.
        </p>
        <AcademicPeriodPicker
          academicYearId={period.academicYearId}
          termId={period.termId}
          onChange={(p) => { setPeriod(p); setPreview(null); setResult(null); }}
        />
        {canCreate && (
          <div className="flex gap-2">
            <button onClick={() => previewMut.mutate()} disabled={!period.termId || previewMut.isPending}
              className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-medium px-3 py-2 rounded-lg">
              {previewMut.isPending && <Loader2 size={12} className="animate-spin" />} Preview
            </button>
            <button onClick={runGenerate} disabled={!preview || preview.billable.length === 0 || generateMut.isPending}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg">
              {generateMut.isPending && <Loader2 size={12} className="animate-spin" />} Create term invoices
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </section>

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
          Created {result.created} term invoice{result.created === 1 ? '' : 's'}.
          {result.skipped?.length > 0 && ` ${result.skipped.length} student${result.skipped.length === 1 ? '' : 's'} not billed (see below).`}
        </div>
      )}

      {preview && (
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Will be billed ({preview.billable.length})</h3>
          {preview.dueDate && (
            <p className="text-xs text-slate-600">
              Due by <span className="font-medium">{preview.dueDate}</span> (end of the term's first week).
            </p>
          )}
          {preview.billable.length === 0 ? (
            <p className="text-xs text-slate-400">No student would be billed for this term.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-semibold">Student</th>
                <th className="py-2 font-semibold">Charges</th>
                <th className="py-2 font-semibold text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview.billable.map(b => (
                  <tr key={b.studentId} className="align-top">
                    <td className="py-2">{b.studentName}</td>
                    <td className="py-2 text-xs text-slate-600">
                      {b.lines.map((l, i) => <div key={i}>{l.description} · {money(l.unitPrice)}</div>)}
                      {b.warnings?.length > 0 && <div className="text-amber-700">{b.warnings.join('; ')}</div>}
                    </td>
                    <td className="py-2 text-right">{money(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {preview.skipped.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-slate-800 pt-2">Not billed ({preview.skipped.length})</h3>
              <ul className="text-xs text-slate-600 space-y-1">
                {preview.skipped.map(s => (
                  <li key={s.studentId}><span className="font-medium">{s.studentName}</span>: {s.reasons.join('; ')}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {period.termId && (
        <EarlyPaymentPanel termId={period.termId} money={money} canConfirm={canCreate} />
      )}
    </div>
  );
}
