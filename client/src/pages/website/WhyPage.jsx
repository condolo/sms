import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const BELIEFS = [
  'Technology should never replace educators — it should give them time back.',
  'Schools should own their data permanently and completely.',
  'Every learner deserves continuity of record across every year of their education.',
  'Every teacher deserves tools that respect their expertise and their time.',
  'Every parent deserves real visibility into their child\'s education, not just report-day summaries.',
  'Every school deserves technology that grows with them — not software they outgrow.',
];

export default function WhyPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Why Msingi Exists | Our Philosophy</title>
        <meta name="description" content="Msingi was built because African schools deserve technology designed for them — not adapted from elsewhere. Read why we exist." />
        <link rel="canonical" href="https://msingi.io/why" />
        <meta property="og:title" content="Why Msingi Exists" />
        <meta property="og:description" content="Purpose-built for African schools. Read the philosophy behind Msingi." />
        <meta property="og:url" content="https://msingi.io/why" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Why Msingi Exists', href: '/why' }]} />
      <PublicNav />

      <main>
        {/* Opening statement */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div
              initial="hidden" animate="visible" variants={stagger(0.08)}
            >
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">
                Our Philosophy
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[56px] font-bold tracking-tighter text-white leading-[1.06] mb-8">
                We built Msingi because African schools deserve technology built for them —{' '}
                <span className="text-slate-400">not adapted for them.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                Purpose-built means every decision — architecture, pricing, curriculum support, workflows, even the language on the screen — was made for an African school, not translated from software designed for somewhere else.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Morning narrative */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6">The problem we set out to solve</motion.p>
              <motion.div variants={fadeUp} className="space-y-5 text-base text-slate-600 leading-relaxed">
                <p>
                  Every morning, before the first lesson begins, a school leader in Nairobi is already making dozens of decisions.
                  Admissions. Attendance. Teacher coverage. Fee balances. Parent communications. Exam schedules.
                </p>
                <p>
                  The information needed to make those decisions exists — in registers, in spreadsheets, in WhatsApp threads, in the finance office, in the staffroom noticeboard. It exists everywhere except where it needs to be: in one place, in real time, accessible to the person who needs to act on it.
                </p>
                <p>
                  That is not a technology problem. That is a problem of who builds the technology, and for whom.
                </p>
                <p>
                  The school ERPs that exist were built for hospitals, for logistics companies, for corporate HR departments — and then adapted for schools. African schools got what remained after those adaptations: software that doesn't understand CBC, that has never heard of M-Pesa, that assumes a finance department of twelve rather than one.
                </p>
                <p>
                  Msingi was built from a different starting point. Not "how do we adapt existing software for African schools?" but "what would we build if we started with the school?"
                </p>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* We believe */}
        <section className="relative py-20 bg-slate-50 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">What we believe</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Our commitments to every school we work with.</motion.h2>
              <div className="space-y-4">
                {BELIEFS.map((belief, i) => (
                  <motion.div key={i} variants={fadeUp}
                    className="flex gap-4 p-5 bg-white border border-slate-200 rounded-xl">
                    <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </div>
                    <p className="text-slate-700 leading-relaxed">{belief}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Commitment */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-white mb-6">
                This is not a startup experiment.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 leading-relaxed mb-4">
                Msingi is built to last. Not for the next funding round. Not for the next acquisition. For the next decade of African education.
              </motion.p>
              <motion.p variants={fadeUp} className="text-slate-400 leading-relaxed mb-10">
                Every school that runs on Msingi is a long-term partner, not a customer. We take that seriously in every product decision we make.
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3">
                <Link to="/about"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Read the founder's story <ArrowRight size={14} />
                </Link>
                <Link to="/platform"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all">
                  See the platform
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
