import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const PHASES = [
  {
    number: '01',
    title: 'Data audit',
    duration: 'Week 1',
    desc: 'We review your existing records — student files, fee history, academic history, staff records. We tell you exactly what we can migrate and in what format.',
  },
  {
    number: '02',
    title: 'Configuration',
    duration: 'Week 1–2',
    desc: 'We set up your school in Msingi — curriculum, classes, fee structures, academic year calendar, user roles, and permissions. You review and approve.',
  },
  {
    number: '03',
    title: 'Parallel run',
    duration: 'Week 2–3',
    desc: 'Your team uses Msingi alongside your existing system for 1–2 weeks. We verify that every record matches, every workflow is configured correctly, and every user is trained.',
  },
  {
    number: '04',
    title: 'Go live',
    duration: 'Week 3–4',
    desc: 'Switch. Old systems are archived, not deleted. Msingi is now your system of record. Your implementation contact remains available for the first 90 days.',
  },
];

const CONCERNS = [
  {
    concern: '"We have 10 years of student records in spreadsheets."',
    answer: 'We have migrated records in every format — Excel, CSV, Google Sheets, old ERP exports, and paper scans. No record is left behind. Every migration is verified before go-live.',
  },
  {
    concern: '"Our staff are not technical."',
    answer: 'Msingi was designed so that a teacher who has never used school software before can mark attendance correctly on day one. We train every user role separately, and training videos remain available forever.',
  },
  {
    concern: '"We are mid-term. We cannot switch right now."',
    answer: 'We recommend starting implementation at the beginning of a term, but it is not a hard requirement. Many schools have switched mid-term without disruption. The parallel run period ensures continuity.',
  },
];

export default function ImplementationPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Implementation | Msingi — Live in 30 Days</title>
        <meta name="description" content="Most schools are live on Msingi in 30 days. We handle data migration, configuration, training, and go-live support." />
        <link rel="canonical" href="https://msingi.io/implementation" />
        <meta property="og:title" content="Msingi Implementation — Live in 30 Days" />
        <meta property="og:url" content="https://msingi.io/implementation" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Implementation', href: '/implementation' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">Implementation</motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tighter text-white leading-[1.07] mb-6">
                Most schools are live in 30 days.{' '}
                <span className="text-slate-400">We handle the migration.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                The question we get most: "What happens to our existing records?" The answer: we bring them with us.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* 4-phase timeline */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.08)}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-12">Four phases. One implementation contact throughout.</motion.h2>
              <div className="space-y-4">
                {PHASES.map((phase, i) => (
                  <motion.div key={i} variants={fadeUp}
                    className="flex gap-6 p-6 border border-slate-200 rounded-2xl bg-white">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className="text-2xl font-bold text-slate-200">{phase.number}</div>
                      {i < PHASES.length - 1 && <div className="w-px flex-1 bg-slate-100 mt-1" />}
                    </div>
                    <div className="pb-2">
                      <div className="flex items-baseline gap-3 mb-2">
                        <h3 className="font-semibold text-slate-900">{phase.title}</h3>
                        <span className="text-xs text-slate-400">{phase.duration}</span>
                      </div>
                      <p className="text-sm text-slate-500 leading-relaxed">{phase.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* What we migrate */}
        <section className="relative py-20 bg-slate-50 border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-4">What we migrate.</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-500 mb-8">Every record. Verified. No data left behind.</motion.p>
              <motion.div variants={fadeUp} className="grid sm:grid-cols-2 gap-3">
                {['Student records & profiles', 'Fee history & payment records', 'Academic history & grades', 'Staff records & HR files', 'Class structures & streams', 'Timetable configuration', 'Previous report cards', 'Parent contact information'].map(item => (
                  <div key={item} className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
                    <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Common concerns */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Things schools always ask before switching.</motion.h2>
              <div className="space-y-6">
                {CONCERNS.map(({ concern, answer }, i) => (
                  <motion.div key={i} variants={fadeUp} className="border-b border-slate-200 pb-6 last:border-0">
                    <p className="text-sm font-semibold text-slate-800 mb-2 italic">{concern}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">{answer}</p>
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
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">Start with a discovery session.</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">We audit your current records and tell you exactly what implementation looks like for your school — before any commitment.</motion.p>
              <motion.div variants={fadeUp}>
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Book a Discovery Session <ArrowRight size={14} />
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
