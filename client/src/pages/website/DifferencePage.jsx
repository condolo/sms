import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const COMPARISON = [
  {
    label: 'Generic ERP adapted for schools',
    traits: ['Built for hospitals, logistics, or HR', 'Adapted for schools as a secondary use case', 'Curriculum support bolted on', 'No M-Pesa awareness', 'Finance module designed for accountants, not bursars', 'Complex to configure; expensive to maintain'],
    dim: true,
  },
  {
    label: 'Point-solution school software',
    traits: ['Solves one problem well', 'Does not connect to the rest of the school', 'Fee software that knows nothing about attendance', 'Separate login for every tool', 'Data re-entry between systems', 'Vendor for every module'],
    dim: true,
  },
  {
    label: 'Msingi',
    traits: ['Built for African schools from the first line of code', 'CBC, CAIE, IB, WASSCE — native, not bolted on', 'M-Pesa Paybill integrated at the data layer', 'One record — every module connected', 'Finance sees attendance; attendance informs billing', 'Priced per student, not per module'],
    dim: false,
  },
];

const PILLARS = [
  { title: 'African-first', desc: 'Designed for Nairobi, Kampala, Dar es Salaam, Kigali, Lagos, Accra. Not for London with a Kenya flag on top.' },
  { title: 'Educator-built', desc: 'The founder taught Physics and coordinated academics before writing a line of code. The product reflects that perspective.' },
  { title: 'M-Pesa native', desc: 'Paybill reconciliation is not an integration. It is a core module. Fees, receipts, and statements are built around how East African schools actually collect money.' },
  { title: 'Curriculum-aware', desc: 'CBC, CAIE, IB, British, American, WASSCE, and custom frameworks are built into the academic engine — not layered on top.' },
  { title: 'Permanent records', desc: 'Academic records are immutable. Grades, once entered and approved, cannot be silently edited. Every change is logged and attributed.' },
  { title: 'Long-term partner', desc: 'Not a startup experiment. Not a feature sprint. A platform built to serve the same school for the next twenty years.' },
];

export default function DifferencePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>The Msingi Difference | School OS, Not School Software</title>
        <meta name="description" content="Msingi is not school software. It is a school operating system — built for Africa, from inside the classroom." />
        <link rel="canonical" href="https://msingi.io/difference" />
        <meta property="og:title" content="The Msingi Difference" />
        <meta property="og:url" content="https://msingi.io/difference" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'The Msingi Difference', href: '/difference' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">The Msingi Difference</motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tighter text-white leading-[1.07] mb-6">
                This is not school software.{' '}
                <span className="text-slate-400">It is a school operating system.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                Software solves a task. An operating system changes how work is done. Msingi was designed from the first line of code for how African schools actually operate.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Comparison */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">How Msingi differs</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Not a feature comparison. A category distinction.</motion.h2>
              <div className="grid lg:grid-cols-3 gap-6">
                {COMPARISON.map(col => (
                  <motion.div key={col.label} variants={fadeUp}
                    className={`rounded-2xl border p-7 ${col.dim ? 'border-slate-200 bg-slate-50' : 'border-indigo-200 bg-indigo-50 ring-2 ring-indigo-100'}`}>
                    <p className={`text-sm font-semibold mb-5 ${col.dim ? 'text-slate-400' : 'text-indigo-700'}`}>{col.label}</p>
                    <ul className="space-y-3">
                      {col.traits.map(t => (
                        <li key={t} className={`flex items-start gap-2 text-sm ${col.dim ? 'text-slate-400' : 'text-slate-700'}`}>
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${col.dim ? 'bg-slate-300' : 'bg-indigo-500'}`} />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Six pillars */}
        <section className="relative py-20 bg-slate-50 border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Six things that set Msingi apart.</motion.h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {PILLARS.map((p, i) => (
                  <motion.div key={i} variants={fadeUp}
                    className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h3 className="font-semibold text-slate-900 mb-2">{p.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{p.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-2xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">See the difference in a demo.</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">Thirty minutes. Live platform. Your questions.</motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Book a Demo <ArrowRight size={14} />
                </Link>
                <Link to="/why-choose" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all">
                  Why schools choose us
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
