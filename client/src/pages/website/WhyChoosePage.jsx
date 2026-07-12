import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const SECTIONS = [
  {
    title: 'Built by educators.',
    body: [
      'The founder of Msingi taught Physics in secondary school before writing a line of production code. He managed timetables, coordinated academic programmes, trained teachers in technology, and spent years understanding how a school actually runs — not how a software company imagines it runs.',
      'That background is not incidental. It shapes every product decision: what gets built first, what language appears on the screen, what workflows are supported, and what complexity is hidden from the people who should not need to see it.',
    ],
  },
  {
    title: 'Designed for African schools.',
    body: [
      'M-Pesa is not an integration. CBC is not a plugin. Kiswahili is not a translation layer. These are first-class features built into the platform from day one — because African schools should not have to use software that was designed for somewhere else.',
      'Msingi understands Paybill reconciliation, bursary management, KCSE preparation, CBC strand reports, CAIE grading curves, and the specific operational reality of a school with 800 students, 40 staff, and one administrator covering everything.',
    ],
  },
  {
    title: 'Transparent pricing.',
    body: [
      'KES 250 per student per term. That is the base price. It does not require a sales call to find out. It does not change at renewal. There is no module-by-module pricing that makes the total number impossible to predict.',
      'We publish it because we believe schools should be able to make informed decisions without negotiating. If you know your student count, you know what Msingi costs.',
    ],
  },
  {
    title: 'Continuous innovation.',
    body: [
      'Every major feature released in the last three versions was requested by a school using Msingi. The product roadmap is not driven by what is easiest to build — it is driven by what schools need next.',
      'Schools get access to every new feature as it is released. There is no feature tier. The platform you pay for today is the platform that keeps getting better.',
    ],
  },
  {
    title: 'Security by design.',
    body: [
      'School data is not a product. It is a responsibility. Msingi is built with tenant isolation at the database layer, RBAC enforced server-side on every API request, immutable academic records, and a full permanent audit trail.',
      'Data stays in Africa. Schools own their data completely. Export is always available. Nothing is held hostage.',
    ],
  },
  {
    title: 'Grows with your school.',
    body: [
      'A school that starts with 200 students and grows to 1,200 does not need a new platform. Msingi scales linearly — pricing adjusts per student, modules activate as the school grows, and nothing needs to be reconfigured.',
      'The record of every student who ever enrolled travels with them through every year of their education — cohort by cohort, term by term, in the same system.',
    ],
  },
  {
    title: 'Long-term partnership.',
    body: [
      'When a school adopts Msingi, they get a named contact who understands their configuration. Not a ticket system. Not a chatbot. A person who knows the school.',
      'We are not building for the next funding round. We are building for the next decade of African education. Schools that trust us with their data deserve a partner that will still be here in ten years.',
    ],
  },
  {
    title: 'Responsible AI.',
    body: [
      'Msingi uses AI to suggest, not to decide. Report card comments are drafted by AI and reviewed by teachers. Attendance patterns are surfaced by AI and acted on by the principal. No AI makes a consequential decision about a student without a human in the loop.',
      'No student data is used to train third-party models. AI-assisted features can be disabled. The educator is always in control.',
    ],
  },
];

export default function WhyChoosePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Why Schools Choose Msingi</title>
        <meta name="description" content="Eight reasons school leaders choose Msingi — from educator-built design to transparent pricing, long-term partnership, and responsible AI." />
        <link rel="canonical" href="https://msingi.io/why-choose" />
        <meta property="og:title" content="Why Schools Choose Msingi" />
        <meta property="og:url" content="https://msingi.io/why-choose" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Why Schools Choose Msingi', href: '/why-choose' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">Why Schools Choose Msingi</motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tighter text-white leading-[1.07] mb-6">
                What school leaders tell us{' '}
                <span className="text-slate-400">after the first year.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                Not testimonials. Not feature bullet points. The real reasons schools that run on Msingi stay on Msingi.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Sections */}
        <div>
          {SECTIONS.map((section, i) => (
            <section key={i} className={`py-16 border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
              <div className="max-w-3xl mx-auto px-6 lg:px-8">
                <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
                  <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                    {String(i + 1).padStart(2, '0')}
                  </motion.p>
                  <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-6">{section.title}</motion.h2>
                  {section.body.map((para, j) => (
                    <motion.p key={j} variants={fadeUp} className="text-base text-slate-600 leading-relaxed mb-4 last:mb-0">
                      {para}
                    </motion.p>
                  ))}
                </motion.div>
              </div>
            </section>
          ))}
        </div>

        {/* CTA */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-2xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">
                A 30-minute conversation tells you more than this page.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">
                No demo pressure. No commitment. A conversation about your school.
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Book a discovery session <ArrowRight size={14} />
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
