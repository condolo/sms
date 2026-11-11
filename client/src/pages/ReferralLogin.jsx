/**
 * Msingi — Affiliate sign-in (/refer/login)
 *
 * There is no password. An affiliate enters the email they signed up with
 * and we re-issue their private dashboard link. The response is always the
 * same generic message so the form cannot be used to enumerate partners.
 */
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle2, LayoutDashboard, Loader2,
  Mail, Send, Wallet,
} from 'lucide-react';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';

const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function ReferralLogin() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/referrals/partners/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) throw new Error(json?.error?.message || 'Could not send the dashboard link.');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Affiliate sign-in — Msingi</title>
        <meta name="description" content="Get a fresh private link to your Msingi creator dashboard." />
        <meta name="robots" content="noindex" />
      </Helmet>
      <PublicNav />

      <main className="min-h-screen bg-[#F7F6FB] pb-20 pt-28">
        <div className="mx-auto grid max-w-5xl gap-10 px-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div>
            <Link to="/refer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#55506B] hover:text-[#17123B]">
              <ArrowLeft size={15} /> Back to the creator program
            </Link>

            <p className="mt-8 font-mono text-[11px] tracking-[0.16em] text-[#6B6880]">AFFILIATE SIGN-IN</p>
            <h1 className="font-creator mt-3 text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[0.98] tracking-[-0.03em] text-[#17123B] text-balance">
              Find your dashboard.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#5B5672]">
              There is no password. Enter the email you signed up with and we will send your
              private dashboard link. If you still have the welcome email, you can open that link directly.
            </p>

            {sent ? (
              <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={24} className="text-emerald-600" />
                  <div>
                    <p className="text-sm font-bold text-emerald-900">Check your inbox</p>
                    <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                      If that email is registered, we have sent a fresh private dashboard link.
                      It can take a minute; check spam if you don't see it.
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => { setSent(false); setEmail(''); }}
                  className="mt-5 text-xs font-semibold text-emerald-800 underline">
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-8 max-w-md space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold text-[#3F3A56]">Email you signed up with</span>
                  <div className="relative mt-1.5">
                    <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className={`${inputCls} pl-10`}
                      placeholder="you@example.com"
                    />
                  </div>
                </label>

                {error && <p className="text-sm text-rose-600">{error}</p>}

                <button type="submit" disabled={busy || !email.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#DFF45A] px-5 py-3.5 text-sm font-bold text-[#17123B] transition hover:bg-[#d2e94b] disabled:cursor-not-allowed disabled:opacity-60">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {busy ? 'Sending your link…' : 'Email me my dashboard link'}
                </button>

                <p className="text-[11px] leading-relaxed text-[#8E89A3]">
                  For security, we don't confirm whether an email is registered. Your old dashboard
                  link stays valid until a new one is requested.
                </p>
              </form>
            )}

            <p className="mt-6 text-sm text-[#5B5672]">
              Not a partner yet?{' '}
              <Link to="/refer" className="font-semibold text-[#17123B] underline">
                Join the creator program <ArrowRight size={13} className="inline" />
              </Link>
            </p>
          </div>

          <aside className="rounded-2xl bg-[#17123B] p-6 text-white md:p-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#DFF45A]">Inside your dashboard</p>
            <h2 className="font-creator mt-2 text-2xl font-bold leading-tight">Your code, payouts and referrals in one place.</h2>
            <div className="mt-6 space-y-5">
              {[
                { Icon: LayoutDashboard, title: 'Your referral links', body: 'Code, onboarding link and demo link, ready to copy.' },
                { Icon: Wallet, title: 'Payout details', body: 'M-Pesa or bank details, locked while a request is under review.' },
                { Icon: Send, title: 'Payout requests', body: 'Request your available rewards and track the manual review.' },
              ].map(({ Icon, title, body }) => (
                <div key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#DFF45A]">
                    <Icon size={15} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-[#C9C4E4]">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 border-t border-white/10 pt-4 text-xs leading-relaxed text-[#A7A1C9]">
              The dashboard link is a private credential. Do not forward it.
            </p>
          </aside>
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
