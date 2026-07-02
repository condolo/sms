import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import { ECOSYSTEM_NODES } from '@/data/landingData';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const CURRICULUM = ['CBC', 'CAIE', 'IB', 'British', 'American', 'WASSCE', 'Custom'];

const FLOW = [
  'Student enrolled',
  'Assigned to class',
  'Attendance recorded daily',
  'Grades entered per assessment',
  'Report card auto-generated',
  'Parent notified via portal',
  'Fee statement issued',
  'M-Pesa payment reconciled',
];

const MODULES = {
  // Academic
  'Students':        'Complete student profiles — personal details, admission number, class, stream, photo, and full academic history in one record.',
  'Attendance':      'Daily and per-period register marking on any device in under 90 seconds. Absent students trigger parent notifications automatically.',
  'Grades & Exams':  'Assessment entry against curriculum criteria (CBC, CAIE, IB, WASSCE, custom). Totals, averages, and grades calculated automatically.',
  'Report Cards':    'Auto-generated from grade data. Five-stage approval chain: Teacher → HOD → Principal → verified → Parent Portal. SHA-256 signed with QR verification.',
  'Timetable':       'Drag-and-drop timetable builder with clash detection. Links directly to lesson records and teacher workload views.',
  'Subjects':        'Curriculum mapping per class, stream, and year group. Subjects link to assessments, grading schemes, and syllabus coverage.',
  'Lessons':         'Lesson planning linked to schemes of work and CBC/CAIE objectives. Syllabus coverage tracked live — no notebook required.',
  'E-Learning':      'Lessons, notes, videos, and assignments published online. Student progress tracked per module. Feeds directly into Grades.',
  'Academic Records':'Immutable term-by-term academic archive. Every grade, every report, every approval — permanent and attributable.',
  'Growth Profile':  'Digital student portfolio tracking co-curricular achievements, competencies, and development across the full school journey.',
  'Admissions':      'Kanban pipeline from enquiry to enrolled. Offer tracking, waiting list management, and automatic student record creation on enrolment.',
  // Operations
  'Finance':         'M-Pesa Paybill reconciliation built in. Fee structures, bursary management, arrears tracking, and term statements in one module.',
  'HR':              'Staff records, leave requests, payroll preparation, and appraisal tracking. Leave balances updated automatically on approval.',
  'Library':         'Book catalogue, member management, borrowing records, and overdue alerts. No separate system needed.',
  'Hostel':          'Boarder records, room allocation, and term boarding fee management integrated with the Finance module.',
  'Transport':       'Route management, vehicle allocation, and student transport records. Parents can see route status through the portal.',
  'Events':          'School calendar with audience targeting — notices to parents, staff, or the whole school. Links to Messages and Finance for fee deadlines.',
  'Messages':        'Structured institutional messaging between staff. Replaces informal WhatsApp for school communications with a permanent audit trail.',
  // Insights
  'Analytics':       'Live director dashboard: attendance rates, fee collection velocity, academic performance trends, and staff metrics — no spreadsheet required.',
  'Reports':         'Governed report publishing with full attribution. Every report generation logged. Finance, academic, and HR reports in one place.',
  // Portals
  'Student Portal':  'Student access to timetable, grades, assignments, fee balance, and school notices. Available on any device.',
  'Parent Portal':   'Live attendance, grades, fee statements, M-Pesa receipts, and school announcements — updated as data is entered, not at end of term.',
};

const GROUPS = [
  { label: 'Academic',   nodes: ['Students', 'Attendance', 'Grades & Exams', 'Report Cards', 'Timetable', 'Subjects', 'Lessons', 'E-Learning', 'Academic Records', 'Growth Profile', 'Admissions'] },
  { label: 'Operations', nodes: ['Finance', 'HR', 'Library', 'Hostel', 'Transport', 'Events', 'Messages'] },
  { label: 'Insights',   nodes: ['Analytics', 'Reports'] },
  { label: 'Portals',    nodes: ['Student Portal', 'Parent Portal'] },
];

export default function PlatformPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Platform Overview | Msingi — 22 Modules, One Record</title>
        <meta name="description" content="22 connected modules. One institutional record. Attendance, grades, finance, admissions, report cards, and parent portals — all connected." />
        <link rel="canonical" href="https://msingi.io/platform" />
        <meta property="og:title" content="Msingi Platform — 22 Modules, One Record" />
        <meta property="og:url" content="https://msingi.io/platform" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Platform', href: '/platform' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">Platform Overview</motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[56px] font-bold tracking-tighter text-white leading-[1.06] mb-6">
                22 modules. One record.{' '}
                <span className="text-slate-400">No reconciliation.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl mb-10">
                Every module connects to the same institutional record. Data entered once appears everywhere it needs to be — without re-entry, without reconciliation, without a spreadsheet to bridge the gap.
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3">
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Book a Demo <ArrowRight size={14} />
                </Link>
                <Link to="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all">
                  See Pricing
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Module groups */}
        <section className="py-20 bg-white border-b border-slate-100">
          <div className="max-w-6xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">22 modules</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-12">Organised across four functional areas.</motion.h2>
              <div className="grid sm:grid-cols-2 gap-8">
                {GROUPS.map(group => (
                  <motion.div key={group.label} variants={fadeUp}>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-5">{group.label}</p>
                    <ul className="space-y-4">
                      {group.nodes.map(n => {
                        const node = ECOSYSTEM_NODES.find(x => x.label === n);
                        return (
                          <li key={n} className="flex items-start gap-3">
                            {node && (
                              <span className={`w-6 h-6 rounded-md ${node.color} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                <node.Icon size={11} className="text-white" />
                              </span>
                            )}
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{n}</p>
                              {MODULES[n] && <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{MODULES[n]}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* How it connects */}
        <section className="py-20 bg-slate-50 border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">How it connects</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">One connected chain. No manual handoff.</motion.h2>
              <div className="flex flex-wrap gap-0">
                {FLOW.map((step, i) => (
                  <motion.div key={i} variants={fadeUp} className="flex items-center gap-0">
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 whitespace-nowrap">
                      {step}
                    </div>
                    {i < FLOW.length - 1 && (
                      <ArrowRight size={14} className="text-slate-300 mx-1 flex-shrink-0" />
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Curriculum */}
        <section className="py-20 bg-white border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Curriculum support</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-6">Built for every curriculum your school runs.</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-500 mb-8 max-w-xl">No customisation fee. No separate module. Every supported curriculum is built into the academic engine from day one.</motion.p>
              <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
                {CURRICULUM.map(c => (
                  <span key={c} className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 bg-slate-50">{c}</span>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-2xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">Ready to see it running?</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">A 30-minute demo shows everything live — your questions, your curriculum, your workflows.</motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Book a Demo <ArrowRight size={14} />
                </Link>
                <Link to="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all">
                  See Pricing
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
