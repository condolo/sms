import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const EFFECTIVE = '1 July 2026';
const EMAIL = 'accessibility@msingi.io';

const MET = [
  'All pages use semantic HTML landmarks (main, nav, header, footer)',
  'Interactive elements are keyboard navigable with visible focus indicators',
  'Form fields have associated labels; required fields are marked and announced',
  'Images and icons used for meaning have descriptive alt text or aria-label attributes',
  'Colour contrast ratios meet WCAG 2.1 AA standards (minimum 4.5:1 for body text, 3:1 for large text)',
  'Error messages are programmatically associated with the relevant form field',
  'Page titles are descriptive and unique per route',
  'Language is declared in the HTML element (lang="en")',
  'Tables include proper thead, th, and scope attributes',
  'No content flashes more than three times per second',
];

const PARTIAL = [
  { issue: 'Complex data tables in analytics module', note: 'Some nested tables lack full ARIA descriptions. Being addressed in Q3 2026.' },
  { issue: 'PDF report exports', note: 'Generated PDFs are not fully tagged for screen readers. Tagged PDF export is on the roadmap.' },
  { issue: 'Some modal dialogs', note: 'Focus management on modal close returns to trigger in most cases but not all. Under review.' },
];

const SECTIONS = [
  {
    title: 'Our commitment',
    body: [
      'Msingi is committed to making the platform usable by everyone, regardless of ability or assistive technology. Accessibility is not an afterthought — it is part of how we build.',
      'We target WCAG 2.1 Level AA conformance across all public-facing pages and the core staff portal. Our accessibility testing includes keyboard-only navigation, screen reader testing (NVDA, VoiceOver), and automated scanning using axe-core.',
    ],
  },
  {
    title: 'Supported technologies',
    body: [
      'Msingi is designed to work with the following assistive technologies: NVDA (Windows), JAWS (Windows), VoiceOver (macOS and iOS), TalkBack (Android), Dragon NaturallySpeaking, and standard keyboard navigation without a mouse.',
      'Supported browsers with assistive technology: Chrome (latest), Firefox (latest), Safari (latest, macOS and iOS), and Edge (latest). Other browsers may work but are not formally tested.',
    ],
  },
  {
    title: 'Known issues',
    body: [
      'The following known issues affect full WCAG 2.1 AA conformance. We are actively working to resolve them. The table below lists the issue, affected area, and our planned resolution timeline.',
    ],
  },
  {
    title: 'Mobile accessibility',
    body: [
      'The Msingi web application is responsive and has been tested on mobile devices with VoiceOver (iOS) and TalkBack (Android). Touch targets meet the minimum size of 44×44 CSS pixels as recommended by WCAG 2.1 Success Criterion 2.5.5.',
      'The parent portal is specifically designed for mobile use, as many parents in East Africa access the platform on a smartphone as their primary device. Mobile accessibility is therefore a primary consideration, not a secondary one.',
    ],
  },
  {
    title: 'Feedback and contact',
    body: [
      `If you experience an accessibility barrier on any part of the Msingi platform, please contact us at ${EMAIL}. Tell us the page or feature you were trying to use, the assistive technology you were using, and what happened. We will acknowledge your message within 2 business days and aim to resolve confirmed issues as quickly as possible.`,
      'We welcome accessibility audits and feedback from schools, disability organisations, and individual users. If your school has specific accessibility requirements, contact us before or during onboarding and we will work with you to ensure the platform meets your needs.',
    ],
  },
  {
    title: 'Regulatory compliance',
    body: [
      'This statement addresses the accessibility requirements of the Kenya Persons with Disabilities Act 2003 and is aligned with international best practice as defined by WCAG 2.1 (W3C, 2018).',
      'Msingi reviews this accessibility statement annually and following any significant platform update that may affect conformance.',
    ],
  },
];

export default function AccessibilityStatement() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Accessibility Statement | Msingi</title>
        <meta name="description" content="Msingi accessibility statement — WCAG 2.1 AA commitment, known issues, supported assistive technologies, and how to report barriers." />
        <link rel="canonical" href="https://msingi.io/legal/accessibility" />
      </Helmet>

      <BreadcrumbSchema items={[
        { name: 'Legal', href: '/privacy' },
        { name: 'Accessibility', href: '/legal/accessibility' },
      ]} />
      <PublicNav />

      <main className="pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Legal</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter text-slate-900 mb-4">
              Accessibility Statement
            </h1>
            <p className="text-slate-500 text-sm">Last reviewed: {EFFECTIVE} · Standard: WCAG 2.1 Level AA</p>
          </div>

          {/* Conformance badge */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6 mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-700 mb-2">Conformance Target</p>
            <p className="text-2xl font-bold text-indigo-900 mb-1">WCAG 2.1 Level AA</p>
            <p className="text-sm text-indigo-700">Partial conformance — known issues documented below.</p>
          </div>

          {SECTIONS.slice(0, 1).map((s, i) => (
            <div key={i} className="mb-10">
              <h2 className="text-lg font-bold text-slate-900 mb-4">{s.title}</h2>
              {s.body.map((p, j) => <p key={j} className="text-slate-600 text-sm leading-relaxed mb-3 last:mb-0">{p}</p>)}
            </div>
          ))}

          {/* What we've implemented */}
          <div className="mb-10">
            <h2 className="text-lg font-bold text-slate-900 mb-4">What we have implemented</h2>
            <ul className="space-y-2">
              {MET.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                  <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {SECTIONS.slice(1, 2).map((s, i) => (
            <div key={i} className="mb-10">
              <h2 className="text-lg font-bold text-slate-900 mb-4">{s.title}</h2>
              {s.body.map((p, j) => <p key={j} className="text-slate-600 text-sm leading-relaxed mb-3 last:mb-0">{p}</p>)}
            </div>
          ))}

          {/* Known issues */}
          <div className="mb-10">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Known issues</h2>
            <p className="text-slate-500 text-sm mb-6">The following areas do not yet fully meet WCAG 2.1 AA and are being addressed.</p>
            <div className="space-y-3">
              {PARTIAL.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-4 border border-amber-200 bg-amber-50 rounded-xl text-sm">
                  <AlertCircle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-slate-800">{item.issue}</p>
                    <p className="text-slate-500 mt-0.5">{item.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {SECTIONS.slice(3).map((s, i) => (
            <div key={i} className="mb-10">
              <h2 className="text-lg font-bold text-slate-900 mb-4">{s.title}</h2>
              {s.body.map((p, j) => <p key={j} className="text-slate-600 text-sm leading-relaxed mb-3 last:mb-0">{p}</p>)}
            </div>
          ))}

          <div className="mt-16 pt-8 border-t border-slate-200">
            <p className="text-sm text-slate-500 mb-6">
              Report an accessibility barrier: <a href={`mailto:${EMAIL}`} className="text-slate-900 underline underline-offset-2">{EMAIL}</a>
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link to="/privacy" className="text-slate-500 hover:text-slate-900 transition-colors">Privacy Policy →</Link>
              <Link to="/legal/responsible-ai" className="text-slate-500 hover:text-slate-900 transition-colors">Responsible AI →</Link>
              <Link to="/security" className="text-slate-500 hover:text-slate-900 transition-colors">Security →</Link>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
