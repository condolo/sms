import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import FloatingActions from '@/components/landing/FloatingActions';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowRight, MessageCircle } from 'lucide-react';
import { FAQ_CATEGORIES, ALL_FAQS_FLAT } from '@/data/faqData';
import { WA_URL } from '@/data/landingData';
import { fadeUp, stagger, VP, EASE } from '@/utils/animations';

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between gap-4 py-5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-slate-800 leading-snug">{q}</span>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="text-sm text-slate-500 leading-relaxed pb-5 pr-8">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: ALL_FAQS_FLAT.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export default function FAQ() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">

      <Helmet>
        <title>FAQ — Msingi School Management Platform</title>
        <meta name="description" content="Answers to the most common questions from Kenyan school administrators — M-Pesa fee collection, data security, CBC support, parent portals, and how to get started with Msingi." />
        <link rel="canonical" href="https://msingi.io/faq" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://msingi.io/faq" />
        <meta property="og:title" content="FAQ — Msingi School Management Platform" />
        <meta property="og:description" content="Answers to the most common questions from Kenyan school administrators — M-Pesa fees, data security, CBC support, and how to get started." />
        <meta property="og:image" content="https://msingi.io/images/og-faq.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="FAQ — Msingi School Management Platform" />
        <meta name="twitter:description" content="Answers to the most common questions from Kenyan school administrators." />
        <meta name="twitter:image" content="https://msingi.io/images/og-faq.png" />
        <script type="application/ld+json">{JSON.stringify(FAQ_SCHEMA)}</script>
      </Helmet>

      {/* Navbar */}
      <nav className="border-b border-slate-100 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold">M</div>
            <span className="text-sm font-bold text-slate-900 tracking-tight">Msingi</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/plans" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Plans</Link>
            <Link to="/contact" className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors">
              Book Demo
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 pt-16 pb-12">
        <motion.div initial="hidden" animate="visible" variants={stagger(0.07)}>
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Frequently asked questions
          </motion.p>
          <motion.h1 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-4 leading-tight">
            Common questions from school administrators
          </motion.h1>
          <motion.p variants={fadeUp} className="text-base text-slate-500 max-w-xl leading-relaxed">
            Real answers to the questions Kenyan school leaders ask before switching from spreadsheets, WhatsApp, and manual registers.
          </motion.p>
        </motion.div>
      </section>

      {/* FAQ categories */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 pb-24">
        <div className="grid lg:grid-cols-[200px_1fr] gap-10 lg:gap-16 items-start">

          {/* Sticky category nav — desktop only */}
          <nav className="hidden lg:block sticky top-20 space-y-1" aria-label="FAQ categories">
            {FAQ_CATEGORIES.map(({ category }) => (
              <a
                key={category}
                href={`#${category.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-')}`}
                className="block text-sm text-slate-500 hover:text-indigo-600 py-1.5 transition-colors"
              >
                {category}
              </a>
            ))}
            <div className="pt-4 border-t border-slate-100 mt-4">
              <a href={WA_URL} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors">
                <MessageCircle size={13} />
                Ask on WhatsApp
              </a>
            </div>
          </nav>

          {/* Questions */}
          <div className="space-y-12">
            {FAQ_CATEGORIES.map(({ category, faqs }) => (
              <motion.div
                key={category}
                id={category.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-')}
                initial="hidden"
                whileInView="visible"
                viewport={VP}
                variants={stagger(0.05)}
              >
                <motion.h2 variants={fadeUp} className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1 pb-3 border-b border-slate-100">
                  {category}
                </motion.h2>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5">
                  {faqs.map((faq, i) => (
                    <motion.div key={i} variants={fadeUp}>
                      <FaqItem q={faq.q} a={faq.a} />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}

            {/* Pricing redirect */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)}>
              <motion.h2 variants={fadeUp} className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1 pb-3 border-b border-slate-100">
                Pricing
              </motion.h2>
              <motion.div variants={fadeUp} className="bg-slate-50 rounded-2xl border border-slate-100 p-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800 mb-1">Questions about cost and setup fees?</p>
                  <p className="text-sm text-slate-500">Our Plans page covers per-student pricing, setup fee bands, upgrade paths, and the interactive cost estimator.</p>
                </div>
                <Link to="/plans"
                  className="inline-flex items-center gap-1.5 shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  See plans
                  <ArrowRight size={13} />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-slate-950 py-16">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-base font-semibold text-white mb-1">Still have questions?</p>
            <p className="text-sm text-slate-400">Book a 30-minute call and we'll walk through your school's specific setup.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a href={WA_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:text-white hover:border-slate-500 transition-colors">
              <MessageCircle size={14} />
              WhatsApp us
            </a>
            <Link to="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
              Book a demo
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-800/60">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-700">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
          <div className="flex gap-5 text-xs text-slate-700">
            <Link to="/"        className="hover:text-slate-400 transition-colors">Home</Link>
            <Link to="/plans"   className="hover:text-slate-400 transition-colors">Plans</Link>
            <Link to="/contact" className="hover:text-slate-400 transition-colors">Contact</Link>
            <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            <Link to="/terms"   className="hover:text-slate-400 transition-colors">Terms</Link>
          </div>
        </div>
      </footer>

      <FloatingActions />
    </div>
  );
}
