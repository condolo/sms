import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const EFFECTIVE = '1 July 2026';
const EMAIL = 'privacy@msingi.io';

const PRINCIPLES = [
  {
    number: '01',
    title: 'AI suggests. Humans decide.',
    body: 'Every AI-assisted feature in Msingi is designed to support human judgment, not replace it. Report card comments are drafted by AI and reviewed, edited, and approved by the teacher before any student sees them. Attendance anomalies are surfaced by the system and acted on by the principal. No AI makes a consequential decision about a student without a human in the loop.',
  },
  {
    number: '02',
    title: 'Student data is never used to train models.',
    body: 'Msingi does not use identifiable student, parent, or staff data to train AI models — whether Msingi\'s own models or third-party foundation models. AI features are built using general-purpose language models accessed via API. No school\'s data is sent to a model provider in a way that permits that provider to use it for training.',
  },
  {
    number: '03',
    title: 'AI features can be disabled.',
    body: 'Every AI-assisted feature in Msingi can be disabled by the school administrator at the institutional level. Schools that prefer not to use AI-assisted report card drafting, attendance analysis, or any other AI feature may turn them off without losing access to any other part of the platform. The AI is additive — it does not run the core ERP functions.',
  },
  {
    number: '04',
    title: 'Transparency about what is AI-generated.',
    body: 'Where AI has contributed to content that a human will review — such as a draft report card comment — the platform clearly labels it as AI-generated. This is not decoration. It is a signal to the reviewer that the content requires their judgment, not just their signature.',
  },
  {
    number: '05',
    title: 'No profiling or scoring of students by AI.',
    body: 'Msingi does not use AI to generate risk scores, ability classifications, or predictive labels for individual students. Attendance patterns and grade trends are surfaced descriptively — as data for a human to interpret — not as AI-generated judgments about a student\'s future.',
  },
  {
    number: '06',
    title: 'Bias awareness and review.',
    body: 'We recognise that AI models trained on global datasets can reflect biases that are inappropriate for the African school context. We review AI feature outputs for systematic bias before deployment and monitor for patterns that may disadvantage particular student groups. Schools are encouraged to report any concerns about AI-generated content to our team.',
  },
];

const CURRENT_FEATURES = [
  { feature: 'Report card comment drafting', scope: 'Suggests per-student comments based on grade data. Teacher reviews and edits before publishing.', trainedOn: 'No school data used for training.', canDisable: true },
  { feature: 'Attendance anomaly alerts', scope: 'Flags unusual attendance patterns for principal review. No automated action taken.', trainedOn: 'No school data used for training.', canDisable: true },
  { feature: 'Grade trend insights', scope: 'Descriptive trend lines on analytics dashboard. No predictive labels.', trainedOn: 'No school data used for training.', canDisable: true },
];

export default function ResponsibleAI() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Responsible AI | Msingi</title>
        <meta name="description" content="How Msingi uses AI responsibly — human oversight, no student data training, opt-out controls, and our six principles for AI in school management." />
        <link rel="canonical" href="https://msingi.io/legal/responsible-ai" />
      </Helmet>

      <BreadcrumbSchema items={[
        { name: 'Legal', href: '/privacy' },
        { name: 'Responsible AI', href: '/legal/responsible-ai' },
      ]} />
      <PublicNav />

      <main className="pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Legal</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter text-slate-900 mb-4">
              Responsible AI Policy
            </h1>
            <p className="text-slate-500 text-sm">Effective date: {EFFECTIVE}</p>
          </div>

          <div className="bg-slate-950 rounded-2xl p-7 mb-14">
            <p className="text-slate-300 text-sm leading-relaxed">
              Msingi uses AI to give teachers more time and principals better visibility. It does not use AI to judge children, profile students, or automate decisions that belong to humans. This policy explains what we do, what we do not do, and how schools can verify both.
            </p>
          </div>

          {/* Six principles */}
          <div className="mb-16">
            <h2 className="text-xl font-bold text-slate-900 mb-10">Six principles.</h2>
            <div className="space-y-10">
              {PRINCIPLES.map((p, i) => (
                <motion.div key={i} initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
                  <motion.div variants={fadeUp}>
                    <p className="text-xs font-bold text-slate-300 mb-1">{p.number}</p>
                    <h3 className="text-lg font-bold text-slate-900 mb-3">{p.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{p.body}</p>
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Current AI features */}
          <div className="mb-14">
            <h2 className="text-xl font-bold text-slate-900 mb-3">Current AI features</h2>
            <p className="text-slate-500 text-sm mb-6">The table below lists every AI-assisted feature currently deployed in Msingi.</p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Feature</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden sm:table-cell">Scope</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700 hidden md:table-cell">School data</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Can disable</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENT_FEATURES.map((f, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-900">{f.feature}</td>
                      <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{f.scope}</td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{f.trainedOn}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Yes
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Regulatory context */}
          <div className="mb-10">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Regulatory context</h2>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              This policy is written in the context of the Kenya Data Protection Act 2019, the EU AI Act (for schools that may be subject to it), and emerging African AI governance frameworks. It reflects the principle — consistent across these frameworks — that AI used in high-stakes educational decisions requires human oversight, transparency, and the ability to contest automated outputs.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed mb-3">
              Msingi classifies AI-assisted report card drafting and attendance analysis as "limited risk" under the EU AI Act framework: they interact with humans (teachers and principals) who are informed the output is AI-generated and who retain full authority to modify or reject it.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed">
              We will update this policy as AI features evolve and as regulatory frameworks in Kenya and across Africa are formalised. Schools will be notified of material changes.
            </p>
          </div>

          <div className="mb-10">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Questions and concerns</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              If your school has concerns about how AI is used in Msingi, or would like more detail about a specific feature's design, contact us at{' '}
              <a href={`mailto:${EMAIL}`} className="text-slate-900 underline underline-offset-2">{EMAIL}</a>.
              We are happy to discuss AI feature design with school leadership and governing boards.
            </p>
          </div>

          <div className="mt-16 pt-8 border-t border-slate-200">
            <div className="flex flex-wrap gap-4 text-sm">
              <Link to="/privacy" className="text-slate-500 hover:text-slate-900 transition-colors">Privacy Policy →</Link>
              <Link to="/legal/dpa" className="text-slate-500 hover:text-slate-900 transition-colors">Data Processing Agreement →</Link>
              <Link to="/security" className="text-slate-500 hover:text-slate-900 transition-colors">Security →</Link>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
