/**
 * Msingi — Creator referral program (/refer)
 *
 * Public growth page for people with an audience: education creators,
 * teacher influencers, school consultants and community admins. They get
 * a code, share it with schools, and earn a cash bounty after the school's
 * first subscription payment.
 */
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, BadgeCheck, CheckCircle2, Copy, Gift, LayoutDashboard,
  Link2, Loader2, MessageCircle, Smartphone, Users, Video,
} from 'lucide-react';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';

const INITIAL = { name: '', email: '', phone: '', payoutPhone: '', schoolName: '', note: '' };
const INK = '#17123B';
const LIME = '#DFF45A';
const SCHOOLS = [
  'Riverside Academy',
  'Hilltop Junior',
  'Mwangaza Academy',
  'Lakeview Primary',
  'Green Valley School',
  'St. Mary’s Academy',
  'Sunrise Junior',
  'Kilimani School',
  'Mascit Lab Academy',
  'Mwangaza High',
];

const inputCls =
  'w-full rounded-xl border border-[#D8D5E6] bg-white px-4 py-3 text-[15px] text-[#17123B] placeholder:text-[#6F6A82] focus:outline-none focus:ring-2 focus:ring-[#4338CA] focus:border-[#4338CA] transition';

function money(amount, currency = 'KES') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

function incentiveCopy(program) {
  if (!program) return '';
  const { type, value } = program.refereeIncentive || {};
  if (type === 'percent' && value) return `Referred schools also get ${value}% off their first termly invoice.`;
  if (type === 'fixed' && value) return `Referred schools also get ${money(value, program.currency)} off their first termly invoice.`;
  return '';
}

function perkPhrase(program) {
  const { type, value } = program?.refereeIncentive || {};
  if (type === 'percent' && value) return `${value}% off their first term`;
  if (type === 'fixed' && value) return `${money(value, program.currency)} off their first term`;
  return '';
}

function buildTemplates({ code, onboardUrl, demoUrl, perk }) {
  const perkPart = perk ? ` for ${perk.replace('their', 'your')}` : '';
  return [
    {
      key: 'bio',
      label: 'Link in bio',
      Icon: Link2,
      text: `Helping schools run better with Msingi. Running one? Use my code ${code}${perkPart} → ${onboardUrl}`,
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp / group post',
      Icon: MessageCircle,
      text: `Hey [first name] — if your school is still juggling registers, report cards and fee follow-ups, Msingi puts it in one place. Here's a demo: ${demoUrl}. Use my code ${code} when you sign up.`,
    },
    {
      key: 'video',
      label: 'Short-video hook',
      Icon: Video,
      text: `Three things your school is still doing by hand this term — and what I'd do instead. If you run a school, start here: ${demoUrl} — code ${code}.`,
    },
  ];
}

function CopyButton({ value, label = 'Copy', dark = false }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  }

  const base = dark
    ? 'border-white/20 text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DFF45A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17123B]'
    : 'border-[#D8D5E6] text-[#55506B] hover:bg-[#F7F6FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4338CA] focus-visible:ring-offset-2';

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${base}`}
    >
      {copied ? <CheckCircle2 size={13} className={dark ? 'text-[#DFF45A]' : 'text-emerald-600'} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function PayoutReceipt({ bounty, currency, count, setCount }) {
  const reduce = useReducedMotion();
  const total = bounty * count;
  const shown = Math.min(count, 4);

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 24, rotate: reduce ? 0 : 1.2 }}
      animate={{ opacity: 1, y: 0, rotate: reduce ? 0 : 1.2 }}
      transition={{ duration: 0.65, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-full max-w-md"
    >
      <div aria-hidden className="absolute -inset-4 rotate-2 rounded-2xl bg-[#DFF45A]/15" />
      <div className="relative rounded-2xl bg-white p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-dashed border-[#D8D5C7] pb-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-[#777264]">MSINGI / CREATOR PAYOUT</p>
            <p className="font-creator mt-1 text-xl font-bold text-[#17123B]">Example statement</p>
          </div>
          <span className="rounded-full bg-[#17123B] px-2.5 py-1 font-mono text-[10px] font-semibold text-[#DFF45A]">SAMPLE</span>
        </div>

        <div className="space-y-2.5 py-4" aria-live="polite">
          {Array.from({ length: shown }).map((_, index) => (
            <div key={SCHOOLS[index]} className="flex items-baseline justify-between gap-3 font-mono text-xs">
              <span className="truncate text-[#4A4560]">
                {String(index + 1).padStart(2, '0')} · {SCHOOLS[index]}
              </span>
              <span className="shrink-0 text-[#17123B]">+ {money(bounty, currency)}</span>
            </div>
          ))}
          {count > shown && (
            <p className="font-mono text-[11px] text-[#7B7668]">+ {count - shown} more school{count - shown === 1 ? '' : 's'}</p>
          )}
        </div>

        <div className="border-t border-dashed border-[#D8D5C7] pt-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-[#777264]">YOUR PAYOUT</p>
              <p className="font-mono text-2xl font-bold text-[#17123B]">{money(total, currency)}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#17123B]/20 px-2.5 py-1 font-mono text-[10px] font-semibold text-[#17123B]">
              <Smartphone size={11} /> M-PESA
            </span>
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-[#F3F1E8] p-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="school-count" className="text-xs font-semibold text-[#3F3A56]">
              How many schools can you reach?
            </label>
            <span className="font-mono text-sm font-bold text-[#17123B]">{count}</span>
          </div>
          <input
            id="school-count"
            type="range"
            min="1"
            max="10"
            step="1"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#D8D4C4] accent-[#17123B]"
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-[#6F6A5E]">
            <span>1</span>
            <span>10</span>
          </div>
        </div>

        <p className="mt-3 text-center font-mono text-[10px] text-[#6F6A5E]">
          Example only. Paid after each school's first subscription payment.
        </p>
      </div>
    </motion.div>
  );
}

function ClaimForm({ form, set, submit, busy, enabled, error }) {
  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      {!enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The creator program is temporarily paused. <Link to="/contact" className="font-semibold underline">Contact us</Link> and we'll let you know when it reopens.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-[#3F3A56]">Your creator name</span>
          <input required value={form.name} onChange={set('name')} className={`mt-1.5 ${inputCls}`} placeholder="Jane Wanjiru" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-[#3F3A56]">Email</span>
          <input required type="email" value={form.email} onChange={set('email')} className={`mt-1.5 ${inputCls}`} placeholder="you@example.com" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-[#3F3A56]">Phone / WhatsApp</span>
          <input required value={form.phone} onChange={set('phone')} className={`mt-1.5 ${inputCls}`} placeholder="+254 7xx xxx xxx" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-[#3F3A56]">M-Pesa number <span className="font-normal text-[#6F6A82]">(if different)</span></span>
          <input value={form.payoutPhone} onChange={set('payoutPhone')} className={`mt-1.5 ${inputCls}`} placeholder="+254 7xx xxx xxx" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-[#3F3A56]">Your channel or community <span className="font-normal text-[#6F6A82]">(optional)</span></span>
          <input value={form.schoolName} onChange={set('schoolName')} className={`mt-1.5 ${inputCls}`} placeholder="e.g. TeacherTok, school leaders' group" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-[#3F3A56]">What do you create about? <span className="font-normal text-[#6F6A82]">(optional)</span></span>
          <input value={form.note} onChange={set('note')} className={`mt-1.5 ${inputCls}`} placeholder="School operations, CBC, parenting…" />
        </label>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        type="submit"
        disabled={busy || !enabled}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#17123B] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#2A2360] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4338CA] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Gift size={17} />}
        {busy ? 'Creating your code…' : 'Get my creator code'}
        {!busy && <ArrowRight size={16} />}
      </button>

      <p className="text-[11px] leading-relaxed text-[#6F6A82]">
        No account needed. Rewards are paid after the referred school's first subscription payment.
        We'll email your code and private dashboard link.
      </p>
    </form>
  );
}

export default function ReferralProgram() {
  const reduce = useReducedMotion();
  const [program, setProgram] = useState(null);
  const [form, setForm] = useState(INITIAL);
  const [state, setState] = useState('form');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [schoolCount, setSchoolCount] = useState(3);

  useEffect(() => {
    fetch('/api/referrals/program')
      .then((response) => response.json())
      .then((json) => setProgram(json?.data || null))
      .catch(() => setProgram({ enabled: false }));
  }, []);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/referrals/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) throw new Error(json?.error?.message || 'Could not create your referral code.');
      setResult(json.data);
      setState('success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const activeProgram = result?.program || program;
  const enabled = activeProgram?.enabled === true;
  const bounty = Number(activeProgram?.bountyAmount ?? 5000);
  const currency = activeProgram?.currency || 'KES';
  const perk = perkPhrase(activeProgram);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://msingi.io';
  const sampleCode = 'YOUR-CODE';
  const templates = buildTemplates({
    code: result?.code || sampleCode,
    onboardUrl: result?.links?.onboardUrl || `${origin}/onboard?ref=${sampleCode}`,
    demoUrl: result?.links?.demoUrl || `${origin}/demo?ref=${sampleCode}`,
    perk,
  });

  const fadeUp = (delay = 0) => ({
    initial: { opacity: 0, y: reduce ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] },
  });

  return (
    <>
      <Helmet>
        <title>Creator program — Msingi</title>
        <meta name="description" content="Share Msingi with schools in your audience. Earn a cash bounty when a school you refer makes its first payment — paid by M-Pesa." />
      </Helmet>
      <PublicNav />

      <main className="min-h-screen bg-[#F7F6FB] pt-16 motion-safe:scroll-smooth">
        {/* ---------- Hero ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
        <section className="relative overflow-hidden bg-[#17123B]">
          <div aria-hidden className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full bg-[#DFF45A]/15 blur-[120px]" />
          <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 h-[460px] w-[460px] rounded-full bg-[#4338CA]/40 blur-[120px]" />

          <div className="relative mx-auto max-w-6xl px-5 pb-14 pt-16 md:pb-20 md:pt-24">
            <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
              <motion.div {...fadeUp(0)}>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#DFF45A]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#DFF45A]" />
                  Msingi Creator Program
                </div>

                <h1 className="font-creator mt-6 text-[clamp(2.9rem,6.5vw,5.2rem)] font-extrabold leading-[0.94] tracking-[-0.03em] text-white text-balance">
                  Your audience<br /> trusts you.<br />
                  <span className="mt-2 inline-block -rotate-1 bg-[#DFF45A] px-2 pb-1 pt-0.5 text-[#17123B]">Get paid for it.</span>
                </h1>

                <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#C9C4E4]">
                  Join the Msingi Creator Program. Share your code with schools in your audience.
                  When a school you refer makes its first subscription payment, you earn{' '}
                  <strong className="font-semibold text-white">{money(bounty, currency)}</strong> — paid by M-Pesa.
                </p>

                {incentiveCopy(activeProgram) && (
                  <p className="mt-3 text-sm font-medium text-[#DFF45A]">{incentiveCopy(activeProgram)}</p>
                )}

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {result?.links?.hubUrl ? (
                    <a href={result.links.hubUrl} className="inline-flex items-center gap-2 rounded-xl bg-[#DFF45A] px-5 py-3 text-sm font-bold text-[#17123B] transition hover:bg-[#d2e94b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#17123B]">
                      <LayoutDashboard size={16} /> Open your dashboard
                    </a>
                  ) : (
                    <a href="#claim" className="inline-flex items-center gap-2 rounded-xl bg-[#DFF45A] px-5 py-3 text-sm font-bold text-[#17123B] transition hover:bg-[#d2e94b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#17123B]">
                      Get my creator code <ArrowRight size={16} />
                    </a>
                  )}
                  <a href="#payout" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DFF45A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17123B]">
                    How the payout works
                  </a>
                </div>

                <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#A7A1C9]">
                  {['No account needed', 'No cap on referrals', 'Paid after first payment'].map((item) => (
                    <span key={item} className="inline-flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-[#DFF45A]" /> {item}
                    </span>
                  ))}
                </div>
              </motion.div>

              <PayoutReceipt bounty={bounty} currency={currency} count={schoolCount} setCount={setSchoolCount} />
            </div>

            <div className="relative mt-14 border-t border-white/10 pt-5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#A7A1C9]">Built for</span>
                {['Teacher-creators', 'School consultants', 'Admissions advisors', 'Parent community leads', 'Education YouTubers', 'WhatsApp group admins'].map((item) => (
                  <span key={item} className="text-sm text-[#C9C4E4]">{item}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Creator kit -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
        <section id="kit" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 md:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <p className="font-mono text-[11px] tracking-[0.16em] text-[#6B6880]">THE CREATOR KIT</p>
              <h2 className="font-creator mt-3 text-[clamp(2.1rem,4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.025em] text-[#17123B] text-balance">
                Steal these three posts.
              </h2>
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#5B5672]">
                We wrote the copy so you can keep being a creator, not a salesperson. Paste your link,
                hit post, and let the schools in your audience find their way in.
              </p>
              <p className="mt-4 text-sm font-semibold text-[#17123B]">
                {result ? 'Your code is already in every line below.' : 'Your code drops into every line after you join.'}
              </p>
            </div>

            <div className="border-y border-[#E4E2EF]">
              {templates.map(({ key, label, Icon, text }) => (
                <div key={key} className="grid gap-3 border-b border-[#E4E2EF] py-6 last:border-b-0 sm:grid-cols-[8.5rem_1fr_auto] sm:items-start">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#17123B]">
                    <Icon size={15} className="text-[#4338CA]" /> {label}
                  </div>
                  <p className="text-[15px] leading-relaxed text-[#47415F]">{text}</p>
                  <CopyButton value={text} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Payout path -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
        <section id="payout" className="scroll-mt-16 bg-[#DFF45A]">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <h2 className="font-creator text-[clamp(2.1rem,4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.025em] text-[#17123B] text-balance">
                  From link to payout.
                </h2>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#3A3718]">
                  No tiers. No monthly quota. One flat bounty per school that becomes a paying customer.
                </p>
              </div>
              <a href="#claim" className="inline-flex items-center gap-2 rounded-xl bg-[#17123B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2A2360]">
                Get my code <ArrowRight size={15} />
              </a>
            </div>

            <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { title: 'Get your code', body: 'One minute, no account, no approval queue.' },
                { title: 'Put it in your content', body: 'Link in bio, caption, community post or video description.' },
                { title: 'A school signs up', body: 'They enter your code when they onboard or book a demo.' },
                { title: 'First payment, then payout', body: `${money(bounty, currency)} by M-Pesa after their first subscription payment.` },
              ].map((step, index) => (
                <li key={step.title} className="border-t border-[#17123B]/25 pt-5">
                  <span className="font-mono text-xs font-semibold text-[#3A3718]">0{index + 1}</span>
                  <h3 className="font-creator mt-2 text-xl font-bold leading-tight text-[#17123B]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#3A3718]">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Claim -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */}
        <section id="claim" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 md:py-24">
          <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              {state === 'success' && result ? (
                <div className="rounded-2xl bg-[#17123B] p-6 text-white md:p-8">
                  <div className="flex items-center gap-2 text-[#DFF45A]">
                    <BadgeCheck size={20} />
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em]">Code unlocked</span>
                  </div>
                  <h2 className="font-creator mt-3 text-3xl font-extrabold leading-tight">You're in.</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#C9C4E4]">
                    Your code and links are live. We also emailed them, together with your private dashboard.
                  </p>

                  <div className="mt-5 rounded-xl bg-[#0F0B2C] p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#A7A1C9]">Your code</p>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                      <p className="font-mono text-3xl font-bold tracking-[0.1em] text-[#DFF45A]">{result.code}</p>
                      <CopyButton value={result.code} dark />
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {[
                      ['Onboarding link', result.links?.onboardUrl],
                      ['Demo link', result.links?.demoUrl],
                      ['Private dashboard', result.links?.hubUrl],
                    ].filter(([, value]) => value).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3.5 py-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#A7A1C9]">{label}</p>
                          <p className="truncate text-sm text-white">{value}</p>
                        </div>
                        <CopyButton value={value} dark />
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <a href={result.links.hubUrl} className="inline-flex items-center gap-2 rounded-xl bg-[#DFF45A] px-4 py-2.5 text-sm font-bold text-[#17123B] transition hover:bg-[#d2e94b]">
                      <LayoutDashboard size={15} /> Open dashboard
                    </a>
                    <button
                      type="button"
                      onClick={() => { setState('form'); setResult(null); setForm(INITIAL); }}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      Refer another school
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#6B6880]">YOUR CREATOR CODE</p>
                  <h2 className="font-creator mt-3 text-[clamp(2.1rem,4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.025em] text-[#17123B] text-balance">
                    Claim your code. Then go make content.
                  </h2>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[#5B5672]">
                    No account. No approval queue. Just a code, two links and a dashboard that updates
                    when a school in your audience signs up.
                  </p>
                  <p className="mt-2 text-sm text-[#5B5672]">
                    Already a partner?{' '}
                    <Link to="/refer/login" className="font-semibold text-[#17123B] underline">
                      Email me my dashboard link
                    </Link>
                  </p>
                  <ClaimForm form={form} set={set} submit={submit} busy={busy} enabled={enabled} error={error} />
                </>
              )}
            </div>

            <aside className="lg:pt-10">
              <div className="border-t border-[#17123B]/15 pt-6">
                <h3 className="font-creator text-2xl font-bold text-[#17123B]">What lands in your inbox</h3>
                <ul className="mt-5 space-y-4">
                  {[
                    ['Your code + two ready links', 'For your bio, captions, groups and DMs.'],
                    ['A private creator dashboard', 'See schools, conversions, pending and paid rewards.'],
                    ['A ready-to-post kit', 'The three templates above, with your code already in them.'],
                    ['M-Pesa payouts', 'One flat bounty per school after its first subscription payment.'],
                  ].map(([title, body]) => (
                    <li key={title} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#17123B] text-[#DFF45A]">
                        <CheckCircle2 size={14} />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#17123B]">{title}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-[#5B5672]">{body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8 rounded-2xl bg-[#DFF45A] p-5 text-[#17123B]">
                <div className="flex items-center gap-2">
                  <Users size={16} />
                  <p className="text-sm font-bold">One school or ten — there is no cap.</p>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[#3A3718]">
                  Every school that enters your code and makes its first payment counts as its own payout.
                </p>
              </div>
            </aside>
          </div>
        </section>

        {/* ---------- FAQ ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ */}
        <section className="border-t border-[#E4E2EF]">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-[0.7fr_1.3fr] md:py-20">
            <h2 className="font-creator text-3xl font-extrabold leading-tight tracking-[-0.02em] text-[#17123B]">
              The fine print,<br />without the fine print.
            </h2>
            <dl className="divide-y divide-[#E4E2EF] border-y border-[#E4E2EF]">
              {[
                ['Do I need a school account?', 'No. The program is open to anyone — teachers, consultants, creators, community admins. You do not need to work at a school.'],
                ['What counts as a referral?', 'A school enters your code when it onboards or books a demo, then makes its first subscription payment. Signups alone do not trigger a payout.'],
                ['How and when do I get paid?', `After the school's first payment, the ${money(bounty, currency)} bounty is marked payable. Our team reviews it, settles it by M-Pesa and emails you the reference.`],
                ['Can I refer more than one school?', 'Yes — there is no cap. Every school that becomes a paying customer earns its own bounty.'],
              ].map(([question, answer]) => (
                <div key={question} className="py-5">
                  <dt className="text-sm font-semibold text-[#17123B]">{question}</dt>
                  <dd className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#5B5672]">{answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  );
}

