/**
 * Msingi — Private referral partner dashboard (/refer/hub/:token)
 *
 * The token is the only credential. It shows referral activity, the
 * partner's payout destination and manual payout requests. School contact
 * details are never returned here.
 */
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import {
  Banknote, CheckCircle2, Clock3, Copy, Loader2, Pencil,
  School, Send, Users, X,
} from 'lucide-react';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';

function money(amount, currency = 'KES') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

function when(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS = {
  signed_up: { label: 'Signed up', tone: 'bg-slate-100 text-slate-600' },
  demo: { label: 'Demo', tone: 'bg-sky-50 text-sky-700' },
  converted: { label: 'Converted — reward available', tone: 'bg-amber-50 text-amber-700' },
  payout_requested: { label: 'Payout requested', tone: 'bg-indigo-50 text-indigo-700' },
  reward_paid: { label: 'Reward paid', tone: 'bg-emerald-50 text-emerald-700' },
};

const REQUEST_STATUS = {
  requested: { label: 'Under review', tone: 'bg-amber-50 text-amber-700' },
  paid: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Not settled', tone: 'bg-rose-50 text-rose-700' },
};

const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the value remains selectable */ }
  }
  return (
    <button type="button" onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      {copied ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function ReferralHub() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [editPayout, setEditPayout] = useState(false);
  const [payoutForm, setPayoutForm] = useState({
    method: 'mpesa', payoutPhone: '', bankName: '', bankAccountName: '',
    bankAccountNumber: '', bankBranch: '',
  });

  async function load() {
    const res = await fetch(`/api/referrals/hub/${encodeURIComponent(token || '')}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json?.error?.message || 'This dashboard link is not valid.');
    setData(json.data);
    return json.data;
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!data?.payout) return;
    setPayoutForm({
      method: data.payout.method || 'mpesa',
      payoutPhone: data.payout.phone || '',
      bankName: data.payout.bankName || '',
      bankAccountName: data.payout.bankAccountName || '',
      bankAccountNumber: data.payout.bankAccountNumber || '',
      bankBranch: data.payout.bankBranch || '',
    });
    if (!data.payout.complete) setEditPayout(true);
  }, [data?.payout]);

  const setField = (key) => (event) => setPayoutForm((current) => ({ ...current, [key]: event.target.value }));

  async function savePayout(event) {
    event.preventDefault();
    setBusy('payout');
    setNotice('');
    try {
      const res = await fetch(`/api/referrals/hub/${encodeURIComponent(token || '')}/payout-details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payoutForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json?.error?.message || 'Could not save payout details.');
      setEditPayout(false);
      setNotice('Payout details saved. We emailed you a confirmation.');
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy('');
    }
  }

  async function requestPayout() {
    setBusy('request');
    setNotice('');
    try {
      const res = await fetch(`/api/referrals/hub/${encodeURIComponent(token || '')}/payout-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json?.error?.message || 'Could not request a payout.');
      setNotice('Payout requested. Our team will review it and email you the reference.');
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy('');
    }
  }

  const openRequest = data?.payoutRequests?.find((request) => request.status === 'requested');
  const canRequest = data && data.payout?.complete && data.totals.availableAmount > 0 && !openRequest;
  const methodLabel = data?.payout?.method === 'bank'
    ? `${data.payout.bankName || 'Bank'} · ${data.payout.bankAccountNumberMasked || 'account on file'}`
    : `M-Pesa · ${data?.payout?.phoneMasked || 'number on file'}`;

  return (
    <>
      <Helmet>
        <title>Your creator dashboard — Msingi</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <PublicNav />

      <main className="min-h-screen bg-slate-50 pb-20 pt-24">
        <div className="mx-auto max-w-3xl px-5">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-500">
              <Loader2 className="mr-2 animate-spin" size={18} /> Loading your dashboard…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-lg font-bold text-slate-900">This link is not valid</p>
              <p className="mt-2 text-sm text-slate-500">{error}</p>
              <Link to="/refer" className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-600">
                Join the referral program
              </Link>
            </div>
          )}

          {!loading && data && (
            <>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Creator dashboard</p>
                  <h1 className="text-2xl font-bold text-slate-900">{data.partner.name}</h1>
                  <p className="text-sm text-slate-500">Your private link — do not share it.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${data.partner.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                  {data.partner.status === 'active' ? 'Active partner' : 'Suspended'}
                </span>
              </div>

              <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Your code</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-3xl font-bold tracking-[0.12em] text-indigo-900">{data.partner.code}</p>
                  <CopyButton value={data.partner.code} />
                </div>
                <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                    <span className="truncate text-slate-600">{data.links.onboardUrl}</span>
                    <CopyButton value={data.links.onboardUrl} />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                    <span className="truncate text-slate-600">{data.links.demoUrl}</span>
                    <CopyButton value={data.links.demoUrl} />
                  </div>
                </div>
              </div>

              <div className="mb-6 grid gap-3 sm:grid-cols-4">
                {[
                  { label: 'Schools signed up', value: data.totals.signups, Icon: School },
                  { label: 'Converted', value: data.totals.conversions, Icon: Users },
                  { label: 'Available to request', value: money(data.totals.availableAmount, data.totals.currency), Icon: Banknote },
                  { label: 'Paid to date', value: money(data.totals.paidAmount, data.totals.currency), Icon: CheckCircle2 },
                ].map(({ label, value, Icon }) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                    <Icon size={15} className="mb-2 text-indigo-500" />
                    <p className="text-lg font-bold text-slate-900">{value}</p>
                    <p className="text-[11px] text-slate-500">{label}</p>
                  </div>
                ))}
              </div>

              {notice && (
                <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${/saved|requested/i.test(notice) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                  {notice}
                </div>
              )}

              {/* Payout destination + request */}
              <div className="mb-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payout destination</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{methodLabel}</p>
                      {data.payout?.updatedAt && (
                        <p className="mt-0.5 text-[11px] text-slate-400">Updated {when(data.payout.updatedAt)}</p>
                      )}
                    </div>
                    {data.payout?.complete && !openRequest && !editPayout && (
                      <button type="button" onClick={() => setEditPayout(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </div>

                  {openRequest && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Payout details are locked while your request is under review.
                    </p>
                  )}

                  {!data.payout?.complete && !openRequest && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      Add your payout details before requesting a payout.
                    </p>
                  )}

                  {editPayout && !openRequest && (
                    <form onSubmit={savePayout} className="mt-4 space-y-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Payout method</span>
                        <select value={payoutForm.method} onChange={setField('method')} className={`mt-1 ${inputCls}`}>
                          <option value="mpesa">M-Pesa</option>
                          <option value="bank">Bank transfer</option>
                        </select>
                      </label>

                      {payoutForm.method === 'mpesa' ? (
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-600">M-Pesa number</span>
                          <input value={payoutForm.payoutPhone} onChange={setField('payoutPhone')} className={`mt-1 ${inputCls}`} placeholder="+254 7xx xxx xxx" />
                        </label>
                      ) : (
                        <>
                          <label className="block">
                            <span className="text-xs font-semibold text-slate-600">Bank name</span>
                            <input value={payoutForm.bankName} onChange={setField('bankName')} className={`mt-1 ${inputCls}`} placeholder="e.g. Equity Bank" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-slate-600">Account name</span>
                            <input value={payoutForm.bankAccountName} onChange={setField('bankAccountName')} className={`mt-1 ${inputCls}`} placeholder="Name on the account" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-slate-600">Account number</span>
                            <input value={payoutForm.bankAccountNumber} onChange={setField('bankAccountNumber')} className={`mt-1 ${inputCls}`} placeholder="Account number" />
                          </label>
                          <label className="block">
                            <span className="text-xs font-semibold text-slate-600">Branch <span className="font-normal text-slate-500">(optional)</span></span>
                            <input value={payoutForm.bankBranch} onChange={setField('bankBranch')} className={`mt-1 ${inputCls}`} placeholder="Branch" />
                          </label>
                        </>
                      )}

                      <div className="flex gap-2">
                        <button type="submit" disabled={busy === 'payout'}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-60">
                          {busy === 'payout' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Save payout details
                        </button>
                        {data.payout?.complete && (
                          <button type="button" onClick={() => setEditPayout(false)}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">
                            <X size={13} /> Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </div>

                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">Payout request</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-950">{money(data.totals.availableAmount, data.totals.currency)}</p>
                  <p className="text-xs text-indigo-700">Available to request</p>

                  {data.totals.requestedAmount > 0 && (
                    <p className="mt-2 text-xs text-indigo-700">
                      {money(data.totals.requestedAmount, data.totals.currency)} already requested and under review.
                    </p>
                  )}

                  {openRequest ? (
                    <div className="mt-4 rounded-xl bg-white/70 p-3 text-xs text-indigo-900">
                      <span className="inline-flex items-center gap-1.5 font-semibold"><Clock3 size={13} /> Payout requested</span>
                      <p className="mt-1">{money(openRequest.amount, openRequest.currency)} · {openRequest.methodLabel}</p>
                      <p className="text-indigo-600">Requested {when(openRequest.requestedAt)}. We will email you when it is paid.</p>
                    </div>
                  ) : (
                    <>
                      <button type="button" onClick={requestPayout} disabled={!canRequest || busy === 'request'}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                        {busy === 'request' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        Request payout
                      </button>
                      <p className="mt-2 text-[11px] leading-relaxed text-indigo-700">
                        Manual review. We will email you the M-Pesa or bank reference once settled.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Payout history */}
              {data.payoutRequests?.length > 0 && (
                <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-sm font-bold text-slate-900">Payout requests</h2>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {data.payoutRequests.map((request) => {
                      const status = REQUEST_STATUS[request.status] || REQUEST_STATUS.requested;
                      return (
                        <div key={request.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800">{money(request.amount, request.currency)}</p>
                            <p className="text-[11px] text-slate-400">
                              {when(request.requestedAt)} · {request.methodLabel}
                              {request.payoutReference ? ` · ${request.payoutReference}` : ''}
                            </p>
                            {request.rejectionReason && <p className="mt-0.5 text-[11px] text-rose-600">{request.rejectionReason}</p>}
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-900">Schools you referred</h2>
                </div>
                {data.referrals.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">
                    No signups yet. Share your code or one of the links above.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {data.referrals.map((r, index) => {
                      const status = STATUS[r.status] || STATUS.signed_up;
                      return (
                        <div key={`${r.schoolName}-${index}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{r.schoolName}</p>
                            <p className="text-[11px] text-slate-400">{when(r.joinedAt)}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                          {r.bountyAmount != null && (
                            <span className="text-xs font-semibold text-slate-600">{money(r.bountyAmount, r.currency)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <p className="mt-5 text-xs text-slate-400">
                Payouts are reviewed and settled manually by M-Pesa or bank transfer after a referred school's first
                subscription payment. Questions? <Link to="/contact" className="text-indigo-600 underline">Contact us</Link>.
              </p>
            </>
          )}
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
