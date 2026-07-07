import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const JOURNEY = [
  { role: 'Physics Teacher',        desc: 'Teaching secondary school physics and seeing first-hand how administrative overhead cuts into teaching time.' },
  { role: 'Academic Coordinator',   desc: 'Managing timetables, reports, and academic records — and running them on spreadsheets that were never designed for the job.' },
  { role: 'STEM Educator',          desc: 'Training teachers in technology and watching great educators struggle with tools that worked against them.' },
  { role: 'AI in Education Trainer',desc: 'Exploring how AI can support African education without replacing the educator at the centre of it.' },
  { role: 'Founder, Msingi',        desc: 'Building the platform he always needed — and never found.' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>About Msingi | Founder Story — Collins Ndolo</title>
        <meta name="description" content="Collins Ndolo — Physics teacher, academic coordinator, STEM educator, and founder of Msingi. Built by someone who taught in these schools." />
        <link rel="canonical" href="https://msingi.io/about" />
        <meta property="og:title" content="About Msingi | Founder Story" />
        <meta property="og:description" content="Built by someone who taught in these schools. The story behind Msingi." />
        <meta property="og:url" content="https://msingi.io/about" />
        <script type="application/ld+json">{JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: 'Collins Ndolo',
          jobTitle: 'Founder',
          worksFor: { '@type': 'Organization', name: 'Msingi', url: 'https://msingi.io' },
          description: 'Physics teacher, academic coordinator, STEM educator, and founder of Msingi.',
        })}</script>
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Founder Story', href: '/about' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">
                Founder Story
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tighter text-white leading-[1.07] mb-8">
                Built by someone who taught in these schools.
              </motion.h1>
              <motion.p variants={fadeUp} className="text-xl text-slate-400 leading-relaxed max-w-2xl">
                Collins Ndolo — Physics teacher, academic coordinator, STEM educator, AI in Education trainer, and founder of Msingi.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* The origin */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6">The origin</motion.p>
              <motion.div variants={fadeUp} className="space-y-5 text-base text-slate-600 leading-relaxed">
                <p>
                  The problem was not obvious at first. It became visible over years — in the timetable that took a week to build by hand, in the report cards that kept the staff room busy for three weeks every term, in the parent who called five times asking about a fee receipt that nobody could find quickly enough.
                </p>
                <p>
                  The gap wasn't that schools lacked technology. Most schools had computers. Some had software. But the software was built for somewhere else — built for systems and workflows that had nothing to do with an East African school managing CBC, collecting fees via M-Pesa, and generating KCSE-ready reports.
                </p>
                <p>
                  The question that started Msingi was simple: what would school management software look like if you started with the school, not with the software?
                </p>
                <p>
                  The answer took years of teaching, coordinating, training, and building to find. Msingi is that answer — built from inside the problem, not looking at it from outside.
                </p>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Journey */}
        <section className="relative py-20 bg-slate-50 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">The journey</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Five roles. One direction.</motion.h2>
              <div className="space-y-4">
                {JOURNEY.map((step, i) => (
                  <motion.div key={i} variants={fadeUp}
                    className="flex gap-5 p-5 bg-white border border-slate-200 rounded-xl">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{i + 1}</div>
                      {i < JOURNEY.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                    </div>
                    <div className="pb-2">
                      <p className="font-semibold text-slate-900 mb-1">{step.role}</p>
                      <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Mission */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">Our mission</motion.p>
              <motion.blockquote variants={fadeUp}
                className="text-2xl sm:text-3xl font-bold text-white leading-snug mb-10">
                "To give every African school the operational clarity and institutional intelligence to focus on what they were built to do — educate."
              </motion.blockquote>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/contact"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Book a discovery session <ArrowRight size={14} />
                </Link>
                <Link to="/why"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all">
                  Read our philosophy
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
