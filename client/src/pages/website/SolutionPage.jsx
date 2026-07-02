import { Helmet } from 'react-helmet-async';
import { Link, useParams, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';

const SOLUTIONS = {
  principal: {
    role: 'Principals & School Directors',
    h1: 'You run an 800-student school. Msingi runs the paperwork.',
    opening: 'You did not become a principal to approve leave forms and chase fee balances. You became one to lead a school.',
    narrative: [
      'By 7 AM, before the first lesson begins, a principal using Msingi already knows how many students are present, which teachers have not marked registers, what the term fee collection rate is, and whether any parent flagged an issue overnight.',
      'That is not a dashboard of raw data. It is institutional clarity — the kind that lets you make decisions in minutes instead of making phone calls all morning to find out what is already happening in your own school.',
    ],
    features: [
      { title: 'Live school dashboard', desc: 'Attendance, fees, grades, and staff status — all in one view, updated in real time.' },
      { title: 'Academic performance overview', desc: 'See how every class, stream, and subject is performing against targets — without waiting for end-of-term reports.' },
      { title: 'Fee collection insights', desc: 'Term collection rate, outstanding balances, and payment velocity — clear enough to act on immediately.' },
      { title: 'Staff management', desc: 'Leave requests, attendance records, and workload visibility — without the paper trail.' },
    ],
    before: [
      ['You call the deputy to find out if the Form 4 register was marked.', 'The register status is on your dashboard before you sit down.'],
      ['Fee collection rate is a number you calculate at month end.', 'Collection rate is live. You see it update as payments come in.'],
      ['End-of-term report card production takes three weeks.', 'Report cards are generated in hours. You approve before they go out.'],
    ],
    cta: 'Book a Demo',
    meta: { title: 'For Principals | Msingi', desc: 'Msingi gives school principals real-time visibility across attendance, fees, grades, and staff — without the morning phone calls.' },
  },

  teacher: {
    role: 'Teaching Staff',
    h1: 'Mark attendance in 90 seconds. Grade faster. Go home on time.',
    opening: 'The average teacher spends four hours a week on administrative tasks that do not require a teaching degree.',
    narrative: [
      'Registers. Grade entry. Report card comments. Parent communication logs. End-of-term marksheets. All of it is real work — but none of it is the reason anyone became a teacher.',
      'Msingi handles the structure so teachers can focus on the substance. Mark attendance on any device in under two minutes. Enter grades against CBC criteria directly. Generate report card comments with one click — then edit them to sound like you, because the AI suggests, and you decide.',
    ],
    features: [
      { title: 'Fast register marking', desc: 'Mark a full class register in under 90 seconds, on any device, with no login friction.' },
      { title: 'Digital gradebook', desc: 'Enter grades against your curriculum\'s assessment criteria. Msingi calculates totals, averages, and grades automatically.' },
      { title: 'CBC report card generation', desc: 'Strand reports, learner profiles, and teacher comments — generated from grade data you have already entered.' },
      { title: 'Lesson planning', desc: 'Link lessons to schemes of work, curriculum objectives, and assessment tasks — all in one place.' },
    ],
    before: [
      ['You mark attendance on paper and someone enters it later.', 'You mark attendance on your phone. It is live instantly.'],
      ['You calculate end-of-term grades from three separate spreadsheets.', 'Grades calculate automatically from entries you have already made.'],
      ['Report card comments take the last week of term.', 'Draft comments are generated in seconds. You review and personalise them.'],
    ],
    cta: 'Book a Demo',
    meta: { title: 'For Teachers | Msingi', desc: 'Msingi gives teachers back time — fast register marking, digital gradebooks, and CBC report card generation.' },
  },

  finance: {
    role: 'Finance Officers & Bursars',
    h1: 'M-Pesa reconciliation that takes minutes, not mornings.',
    opening: 'Every morning, a finance officer downloads an M-Pesa statement and matches it row by row against a fee register. Msingi does that automatically.',
    narrative: [
      'Fee management in an East African school is not like fee management anywhere else. It involves Paybill codes, multiple fee structures across streams and year groups, bursary allocations, partial payments, term balances carried forward, and parent disputes about receipts that were sent to an old phone number.',
      'Msingi understands all of that. M-Pesa Paybill reconciliation is built in — not integrated, built in. Fee structures, bursary management, arrears tracking, and term statements are all part of the same system that handles the rest of the school.',
    ],
    features: [
      { title: 'M-Pesa Paybill reconciliation', desc: 'Incoming M-Pesa payments are automatically matched to student accounts. Unmatched payments are flagged, not lost.' },
      { title: 'Multi-structure fee management', desc: 'Different fee structures for different streams, year groups, and boarding statuses — all managed in one place.' },
      { title: 'Bursary & scholarship tracking', desc: 'Allocate bursaries, track disbursements, and generate bursary reports for governors and sponsors.' },
      { title: 'Arrears management & statements', desc: 'One-click term statements. Automated arrears reports. Parent communication directly from the finance module.' },
    ],
    before: [
      ['M-Pesa reconciliation takes two hours every morning.', 'Reconciliation runs automatically. You review exceptions, not every row.'],
      ['A parent calls to query their balance. You put them on hold while you check.', 'Parent balances are in the system. You answer in thirty seconds.'],
      ['End-of-term fee reports take two days to compile.', 'Term fee reports generate in one click, always up to date.'],
    ],
    cta: 'Book a Demo',
    meta: { title: 'For Finance Officers | Msingi', desc: 'Msingi automates M-Pesa Paybill reconciliation, fee management, bursary tracking, and term statements for school finance teams.' },
  },

  parent: {
    role: 'Parents & Guardians',
    h1: 'Know how your child is doing — without waiting for report day.',
    opening: 'You pay the fees. You attend the parent meetings. You deserve to know what is happening between those meetings.',
    narrative: [
      'The parent portal gives you live access to the information that matters: whether your child was present today, how they are performing across subjects, what their fee balance looks like, and what the school has communicated this week.',
      'No phone call required. No waiting until the end of term. If your child was marked absent, you get a notification the same morning. If a grade is entered, you see it when the teacher saves it.',
    ],
    features: [
      { title: 'Live attendance visibility', desc: 'See whether your child was present, late, or absent — the same morning it is recorded.' },
      { title: 'Grade & performance updates', desc: 'Track your child\'s academic performance across subjects as grades are entered, not just at end of term.' },
      { title: 'Fee statements & M-Pesa receipts', desc: 'Your fee balance, payment history, and receipts — available any time, from any device.' },
      { title: 'School notices & announcements', desc: 'Fee deadlines, event notices, and school communications — delivered through the portal, not just WhatsApp groups.' },
    ],
    before: [
      ['You find out your child was absent when you get home.', 'You get a notification the same morning attendance is marked.'],
      ['You call the school to ask about a fee receipt.', 'Your receipts are in the portal. You download them yourself.'],
      ['You wait for report day to know how your child is doing.', 'You see grades as they are entered, term by term, subject by subject.'],
    ],
    cta: 'Ask your school about Msingi',
    ctaHref: '/contact',
    meta: { title: 'For Parents | Msingi', desc: 'Msingi\'s parent portal gives families live access to attendance, grades, fee statements, and school notices.' },
  },

  admissions: {
    role: 'Admissions Officers',
    h1: 'From enquiry to enrolled — in one workflow.',
    opening: 'Most admissions officers manage applicants across paper forms, email threads, and a spreadsheet they built themselves last March.',
    narrative: [
      'Admissions in a competitive school is a structured process — enquiry, application, interview, offer, enrolment, and first-day record. But in most schools, that process is split across tools that were never designed to talk to each other.',
      'Msingi gives admissions a single pipeline. Every applicant moves through the same stages. When an applicant accepts an offer, their student record is created automatically — no re-entry, no data migration, no copy-pasting from a spreadsheet into a register.',
    ],
    features: [
      { title: 'Kanban admissions pipeline', desc: 'Every applicant in one view, organised by stage — enquiry, application received, interview scheduled, offer sent, enrolled.' },
      { title: 'Digital application management', desc: 'Receive, review, and respond to applications from one place. No paper forms to track down.' },
      { title: 'Waiting list management', desc: 'Maintain a structured waiting list. Promote applicants when spaces open, with full audit trail.' },
      { title: 'Automatic student record creation', desc: 'When an applicant is enrolled, their record is created in the student module automatically — no re-entry required.' },
    ],
    before: [
      ['You track 60 applicants in a spreadsheet with colour-coded cells.', 'Every applicant is in a structured pipeline with a clear stage and next action.' ],
      ['When a student enrols, you re-enter their details into a separate system.', 'Enrolment creates the student record automatically. Nothing is re-entered.' ],
      ['You send offer letters by email and hope they are received.', 'Offer status is tracked in the pipeline. You always know who has responded.' ],
    ],
    cta: 'Book a Demo',
    meta: { title: 'For Admissions Officers | Msingi', desc: 'Msingi gives admissions teams a structured pipeline from enquiry to enrolled — with automatic student record creation on enrolment.' },
  },
};

export default function SolutionPage() {
  const { role } = useParams();
  const sol = SOLUTIONS[role];
  if (!sol) return <Navigate to="/platform" replace />;

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>{sol.meta.title}</title>
        <meta name="description" content={sol.meta.desc} />
        <link rel="canonical" href={`https://msingi.io/solutions/${role}`} />
        <meta property="og:title" content={sol.meta.title} />
        <meta property="og:url" content={`https://msingi.io/solutions/${role}`} />
      </Helmet>

      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">
                {sol.role}
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-white leading-[1.07] mb-6">
                {sol.h1}
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                {sol.opening}
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Narrative */}
        <section className="py-20 bg-white border-b border-slate-100">
          <div className="max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              {sol.narrative.map((para, i) => (
                <motion.p key={i} variants={fadeUp} className="text-base text-slate-600 leading-relaxed mb-5 last:mb-0">
                  {para}
                </motion.p>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 bg-slate-50 border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">What they see in Msingi.</motion.h2>
              <div className="grid sm:grid-cols-2 gap-5">
                {sol.features.map((f, i) => (
                  <motion.div key={i} variants={fadeUp} className="bg-white border border-slate-200 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                      <h3 className="font-semibold text-slate-900 text-sm">{f.title}</h3>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Before / after */}
        <section className="py-20 bg-white border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">What changes.</motion.h2>
              <div className="space-y-4">
                {sol.before.map(([bef, aft], i) => (
                  <motion.div key={i} variants={fadeUp} className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
                    <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5">
                      <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0 mt-0.5" />
                      <p className="text-sm text-slate-500">{bef}</p>
                    </div>
                    <div className="hidden sm:flex items-center justify-center">
                      <ArrowRight size={14} className="text-indigo-400" />
                    </div>
                    <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3.5">
                      <CheckCircle2 size={14} className="text-indigo-500 shrink-0 mt-0.5" />
                      <p className="text-sm font-medium text-slate-800">{aft}</p>
                    </div>
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
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">See it live in 30 minutes.</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">No commitment. A conversation about your school.</motion.p>
              <motion.div variants={fadeUp}>
                <Link to={sol.ctaHref || '/contact'}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  {sol.cta} <ArrowRight size={14} />
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
