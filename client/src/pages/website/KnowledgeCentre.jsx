import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowRight, BookOpen, Shield, GraduationCap, Users, Zap, DollarSign } from 'lucide-react';
import { fadeUp, stagger, VP, EASE } from '@/utils/animations';
import { FAQ_CATEGORIES, ALL_FAQS_FLAT } from '@/data/faqData';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const CATEGORY_ICONS = {
  'Fees & Payments':        DollarSign,
  'Data & Security':        Shield,
  'Academic & Curriculum':  GraduationCap,
  'Portals & Parents':      Users,
  'Getting Started':        Zap,
};

const RESOURCES = [
  {
    Icon: BookOpen,
    title: 'Platform overview',
    desc: 'Every module explained — what it does, who uses it, and how it connects to the rest of the school.',
    href: '/platform',
    cta: 'See all modules',
  },
  {
    Icon: Zap,
    title: 'Implementation guide',
    desc: 'What happens between signing up and going live — four phases, 30 days, your records migrated.',
    href: '/implementation',
    cta: 'Read the guide',
  },
  {
    Icon: Shield,
    title: 'Security & data residency',
    desc: 'How your school\'s data is stored, encrypted, isolated, and backed up. African data residency.',
    href: '/security',
    cta: 'Trust Centre',
  },
  {
    Icon: DollarSign,
    title: 'Pricing explained',
    desc: 'KES 250 per student per term. No hidden modules. No negotiation required to find out the number.',
    href: '/pricing',
    cta: 'See pricing',
  },
  {
    Icon: GraduationCap,
    title: 'Vision roadmap',
    desc: 'What Msingi has now, what\'s coming in 12 months, and the 3-year direction for the platform.',
    href: '/roadmap',
    cta: 'Read the roadmap',
  },
  {
    Icon: Users,
    title: 'Book a discovery session',
    desc: 'A 30-minute session with someone who knows what you\'re building. No demo pressure.',
    href: '/contact',
    cta: 'Book now',
  },
];

/* Answer text stays permanently in the DOM (just visually collapsed via
   height/opacity) instead of being conditionally mounted — see FAQ.jsx
   for the full rationale. Same bug, same fix, duplicated component. */
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
        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="overflow-hidden"
        aria-hidden={!open}
      >
        <p className="text-sm text-slate-500 leading-relaxed pb-5">{a}</p>
      </motion.div>
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

export default function KnowledgeCentre() {
  const [activeCategory, setActiveCategory] = useState(null);

  const displayed = activeCategory
    ? FAQ_CATEGORIES.filter(c => c.category === activeCategory)
    : FAQ_CATEGORIES;

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Knowledge Centre | Msingi</title>
        <meta name="description" content="Guides, FAQs, and resources for schools considering or using Msingi — fees, data security, curriculum support, implementation, and more." />
        <link rel="canonical" href="https://msingi.io/knowledge" />
        <meta property="og:title" content="Msingi Knowledge Centre" />
        <meta property="og:url" content="https://msingi.io/knowledge" />
        <script type="application/ld+json">{JSON.stringify(FAQ_SCHEMA)}</script>
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Knowledge Centre', href: '/knowledge' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">
                Knowledge Centre
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-white leading-[1.07] mb-6">
                Everything you need to know{' '}
                <span className="text-slate-400">before you decide.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                Guides, answers, and resources — organised by the questions schools actually ask.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Resource cards */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.06)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Guides & resources</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Start here.</motion.h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {RESOURCES.map((r, i) => (
                  <motion.div key={i} variants={fadeUp}>
                    <Link
                      to={r.href}
                      className="group flex flex-col h-full border border-slate-200 rounded-2xl p-6 hover:border-indigo-200 hover:shadow-sm transition-all"
                    >
                      <div className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-indigo-50 flex items-center justify-center mb-4 transition-colors">
                        <r.Icon size={16} className="text-slate-600 group-hover:text-indigo-600 transition-colors" />
                      </div>
                      <p className="font-semibold text-slate-900 mb-2 text-sm">{r.title}</p>
                      <p className="text-xs text-slate-500 leading-relaxed flex-1 mb-4">{r.desc}</p>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 group-hover:gap-2.5 transition-all">
                        {r.cta} <ArrowRight size={12} />
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* FAQ section */}
        <section className="relative py-20 bg-slate-50 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                Common questions
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-8">
                What schools ask before switching.
              </motion.h2>

              {/* Category filter */}
              <motion.div variants={fadeUp} className="flex flex-wrap gap-2 mb-10">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    activeCategory === null
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  All
                </button>
                {FAQ_CATEGORIES.map(c => {
                  const Icon = CATEGORY_ICONS[c.category];
                  return (
                    <button
                      key={c.category}
                      onClick={() => setActiveCategory(c.category === activeCategory ? null : c.category)}
                      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        activeCategory === c.category
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-slate-400'
                      }`}
                    >
                      {Icon && <Icon size={11} />}
                      {c.category}
                    </button>
                  );
                })}
              </motion.div>

              {/* FAQ items */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeCategory ?? 'all'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  {displayed.map((cat, i) => (
                    <div key={cat.category} className={`mb-10 last:mb-0 ${activeCategory === null && i > 0 ? 'pt-8 border-t border-slate-200' : ''}`}>
                      {activeCategory === null && (
                        <div className="flex items-center gap-2 mb-4">
                          {CATEGORY_ICONS[cat.category] && (
                            <div className="w-6 h-6 rounded-lg bg-slate-200 flex items-center justify-center">
                              {(() => { const Icon = CATEGORY_ICONS[cat.category]; return <Icon size={12} className="text-slate-600" />; })()}
                            </div>
                          )}
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{cat.category}</p>
                        </div>
                      )}
                      <div className="bg-white border border-slate-200 rounded-2xl px-6">
                        {cat.faqs.map((faq, j) => (
                          <FaqItem key={j} q={faq.q} a={faq.a} />
                        ))}
                      </div>
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-2xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">
                Still have questions?
              </motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">
                Book a 30-minute session. We'll answer every question about your school specifically — not a generic demo.
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all"
                >
                  Book a discovery session <ArrowRight size={14} />
                </Link>
                <Link
                  to="/platform"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all"
                >
                  Explore the platform
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
