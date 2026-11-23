/**
 * Landing — Refer & Earn
 *
 * The public creator program lives at /refer. This section exists to make it
 * discoverable from the homepage: one clear promise, the three steps, and the
 * live bounty from /api/referrals/program (defaults to KES 5,000, the same
 * fallback /refer uses when the API is unavailable).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Banknote, Gift, Share2, Smartphone, UserPlus } from 'lucide-react';
import { EASE, fadeUp, stagger, VP } from '@/utils/animations';

const INK = '#17123B';
const LIME = '#DFF45A';

function money(amount, currency) {
  return `${currency} ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function perkLine(program) {
  const { type, value } = program?.refereeIncentive || {};
  if (type === 'percent' && value) return `They also get ${value}% off their first term.`;
  if (type === 'fixed' && value) return `They also get ${money(value, program.currency || 'KES')} off their first term.`;
  return '';
}

const STEPS = [
  {
    Icon: Gift,
    title: 'Get your code',
    body: 'Join free in under a minute. We email your code and a private dashboard link.',
  },
  {
    Icon: Share2,
    title: 'Share it',
    body: 'Send it to a school leader, a WhatsApp group, or the audience that already trusts you.',
  },
  {
    Icon: Banknote,
    title: 'Get paid',
    body: 'M-Pesa lands after the school you referred makes its first subscription payment.',
  },
];

export default function ReferAndEarnSection() {
  const [program, setProgram] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/referrals/program')
      .then((response) => response.json())
      .then((json) => { if (alive) setProgram(json?.data ?? null); })
      .catch(() => { /* fall back to the default bounty */ });
    return () => { alive = false; };
  }, []);

  const bounty = Number(program?.bountyAmount ?? 5000);
  const currency = program?.currency || 'KES';
  const paused = program?.enabled === false;
  const perk = paused ? '' : perkLine(program);

  return (
    <section id="refer" aria-labelledby="refer-heading" className="relative py-24 sm:py-32 overflow-hidden" style={{ backgroundColor: INK }}>
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 right-0 w-[32rem] h-[32rem] rounded-full blur-[120px]" style={{ backgroundColor: 'rgba(223,244,90,0.12)' }} />
        <div className="absolute -bottom-40 -left-24 w-[30rem] h-[30rem] rounded-full blur-[120px]" style={{ backgroundColor: 'rgba(67,56,202,0.35)' }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-16 items-center">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: LIME }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LIME }} />
              Refer &amp; earn{paused ? ' · opening soon' : ''}
            </motion.div>

            <motion.h2
              id="refer-heading"
              variants={fadeUp}
              className="font-['Crimson_Pro'] mt-6 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.08]"
            >
              Know a school that should run on Msingi?
              <br />
              <span style={{ color: LIME }}>Get paid when they switch.</span>
            </motion.h2>

            <motion.p variants={fadeUp} className="mt-6 max-w-xl text-lg leading-relaxed" style={{ color: '#C9C4E4' }}>
              Share your personal code with a school leader. When the school subscribes, we pay you a
              cash bounty by M-Pesa — no invoicing, no chasing, no account to maintain.
            </motion.p>

            {perk ? (
              <motion.p variants={fadeUp} className="mt-3 text-sm font-medium" style={{ color: LIME }}>
                {perk}
              </motion.p>
            ) : null}

            <motion.div variants={fadeUp} className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
              <Link
                to={paused ? '/contact' : '/refer'}
                className="group inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                style={{ backgroundColor: LIME, color: INK }}
              >
                {paused ? 'Register your interest' : 'Join the creator program'}
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <span className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: '#A49FC0' }}>
                <Smartphone size={14} />
                Paid by M-Pesa
              </span>
            </motion.div>

            <motion.p variants={fadeUp} className="mt-5 max-w-md text-[11px] leading-relaxed" style={{ color: '#8F89AC' }}>
              {paused
                ? "The creator program is paused right now. Register your interest and we'll let you know when it reopens."
                : "Open to education creators, consultants, teachers and anyone who knows a school. Rewards are paid after the referred school's first subscription payment."}
            </motion.p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VP}
            transition={{ duration: 0.7, delay: 0.12, ease: EASE }}
            className="relative"
          >
            <div aria-hidden className="absolute -inset-3 rotate-1 rounded-3xl" style={{ backgroundColor: 'rgba(223,244,90,0.10)' }} />
            <div className="relative rounded-3xl border border-white/10 bg-white/[0.05] p-6 sm:p-8 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <p className="font-mono text-[10px] tracking-[0.18em]" style={{ color: '#A49FC0' }}>
                  PER SCHOOL YOU REFER
                </p>
                <span className="rounded-full px-2.5 py-1 font-mono text-[10px] font-bold" style={{ backgroundColor: LIME, color: INK }}>
                  PAID BY M-PESA
                </span>
              </div>

              <p className="mt-3 font-mono text-4xl sm:text-5xl font-bold text-white">
                {money(bounty, currency)}
              </p>
              <p className="mt-1 text-sm" style={{ color: '#C9C4E4' }}>
                after their first subscription payment
              </p>

              <div className="mt-7 space-y-5 border-t border-white/10 pt-6">
                {STEPS.map(({ Icon, title, body }, index) => (
                  <div key={title} className="flex gap-4">
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: 'rgba(223,244,90,0.14)', color: LIME }}
                    >
                      <Icon size={17} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        <span className="font-mono mr-2 text-[10px]" style={{ color: LIME }}>
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        {title}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed" style={{ color: '#A49FC0' }}>{body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-7 flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5">
                <UserPlus size={14} style={{ color: LIME }} />
                <p className="text-[11px] leading-relaxed" style={{ color: '#C9C4E4' }}>
                  Example: three schools = <span className="font-semibold text-white">{money(bounty * 3, currency)}</span>{' '}
                  paid out.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
