/**
 * Msingi Landing Page
 * Shown on the main domain (e.g. msingi.io or localhost without ?school=).
 * Visitors can explore the demo or register their school.
 */
import { useState } from 'react';
import { schoolPortalUrl, storeSchoolSlug } from '@/utils/schoolDetect.js';

const FEATURES = [
  {
    icon: '🎓',
    title: 'Student Information System',
    desc:  'Full profiles, enrolment, and academic history for every learner.',
  },
  {
    icon: '📊',
    title: 'Gradebook & Academics',
    desc:  'Cambridge, IB, CBC, and custom curriculum grading with report cards.',
  },
  {
    icon: '💳',
    title: 'Financial Management',
    desc:  'Fee structures, invoicing, payment tracking, and financial summaries.',
  },
  {
    icon: '📅',
    title: 'Timetable & Attendance',
    desc:  'Drag-and-drop timetables and real-time attendance with reports.',
  },
  {
    icon: '💬',
    title: 'Communication Hub',
    desc:  'Secure messaging between staff, parents, and students.',
  },
  {
    icon: '🏆',
    title: 'Admissions & Behaviour',
    desc:  'Pipeline-based admissions and behaviour incident management.',
  },
];

const ROLES = [
  { label: 'Super Admin', emoji: '🔑', desc: 'Full school control',   slug: 'innolearn', hint: 'All modules & settings' },
  { label: 'Teacher',     emoji: '📖', desc: 'Classes & grades',      slug: 'innolearn', hint: 'Grades, attendance, timetable' },
  { label: 'Parent',      emoji: '👨‍👩‍👧', desc: 'Child progress',        slug: 'innolearn', hint: 'Reports & messages' },
  { label: 'Finance',     emoji: '💰', desc: 'Fees & payments',       slug: 'innolearn', hint: 'Invoices, payments, reports' },
  { label: 'Student',     emoji: '🎒', desc: 'My academics',          slug: 'innolearn', hint: 'Grades & timetable' },
  { label: 'Deputy',      emoji: '📋', desc: 'School operations',     slug: 'innolearn', hint: 'Staff, timetable, reports' },
];

export default function Landing() {
  const [schoolInput, setSchoolInput] = useState('');
  const [finding,     setFinding]     = useState(false);
  const [findError,   setFindError]   = useState('');

  /** Open a school's portal by its slug */
  function goToSchool(slug) {
    storeSchoolSlug(slug);
    window.location.href = schoolPortalUrl(slug);
  }

  async function handleFindSchool(e) {
    e.preventDefault();
    const slug = schoolInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) return;
    setFinding(true); setFindError('');
    try {
      const res = await fetch(`/api/public/school-info?slug=${slug}`);
      if (!res.ok) {
        setFindError(`No school found for "${slug}". Check the school name and try again.`);
        setFinding(false);
        return;
      }
      goToSchool(slug);
    } catch {
      setFindError('Could not connect. Please try again.');
      setFinding(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-sm">
              MS
            </div>
            <span className="text-lg font-bold text-slate-900">Msingi</span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/onboard.html"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Get Started →
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <span className="inline-block rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 mb-6 uppercase tracking-wide">
          Complete School Management Platform
        </span>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 leading-tight">
          Your school's own
          <br />
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
            dedicated portal
          </span>
        </h1>
        <p className="mt-6 text-lg text-slate-500 max-w-xl mx-auto">
          Every school gets its own branded URL, login page, and management system —
          students, staff, academics, and finance, all in one place.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="/onboard.html"
            className="rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
          >
            Create your school →
          </a>
          <button
            onClick={() => goToSchool('innolearn')}
            className="rounded-xl border border-slate-200 bg-white px-8 py-3.5 text-base font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            🎬 View demo
          </button>
        </div>
      </section>

      {/* ── Find your school ────────────────────────────────── */}
      <section className="bg-indigo-50 py-12">
        <div className="max-w-xl mx-auto px-6 text-center">
          <h2 className="text-lg font-bold text-slate-900 mb-2">Already have a school account?</h2>
          <p className="text-sm text-slate-500 mb-6">Enter your school name to go to your dedicated portal</p>

          <form onSubmit={handleFindSchool} className="flex gap-2">
            <input
              type="text"
              value={schoolInput}
              onChange={(e) => { setSchoolInput(e.target.value); setFindError(''); }}
              placeholder="e.g. greenwood-academy"
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="submit"
              disabled={finding || !schoolInput.trim()}
              className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {finding ? '…' : 'Go →'}
            </button>
          </form>

          {findError && (
            <p className="mt-3 text-sm text-red-600">{findError}</p>
          )}
        </div>
      </section>

      {/* ── URL Example ─────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Your school. Your URL.</h2>
        <p className="text-slate-500 max-w-lg mx-auto mb-8">
          When you register, your school gets its own branded login page at a dedicated address — just like this:
        </p>

        <div className="inline-flex items-center gap-0 rounded-2xl border border-slate-200 overflow-hidden shadow-sm text-sm font-mono">
          <span className="bg-slate-100 px-4 py-3 text-slate-500">https://</span>
          <span className="px-3 py-3 text-indigo-600 font-bold">your-school</span>
          <span className="bg-slate-100 px-4 py-3 text-slate-500">.msingi.io</span>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
          {['greenwood-academy', 'sunrise-school', 'mla', 'testsync-academy'].map(slug => (
            <button
              key={slug}
              onClick={() => goToSchool(slug)}
              className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
            >
              {slug}.msingi.io
            </button>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section className="bg-slate-50 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-10">Everything your school needs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-slate-900 mb-1">{f.title}</h3>
                <p className="text-sm text-slate-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Demo mode ───────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 p-10 text-center text-white">
          <h2 className="text-2xl font-bold mb-2">Explore the demo</h2>
          <p className="text-white/80 mb-8 max-w-md mx-auto">
            Log in as any role on our demo school to see exactly how Msingi works for your team.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-md mx-auto mb-8">
            {ROLES.map((r) => (
              <button
                key={r.label}
                onClick={() => goToSchool('innolearn')}
                className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 p-3 text-left transition-colors"
              >
                <div className="text-xl mb-1">{r.emoji}</div>
                <div className="text-sm font-semibold">{r.label}</div>
                <div className="text-xs text-white/60">{r.desc}</div>
              </button>
            ))}
          </div>
          <button
            onClick={() => goToSchool('innolearn')}
            className="rounded-xl bg-white text-indigo-700 font-semibold px-8 py-3 hover:bg-indigo-50 transition-colors"
          >
            Open demo school →
          </button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-xs">MS</div>
            <span className="text-sm font-semibold text-slate-700">Msingi</span>
          </div>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-slate-400">
            <a href="mailto:hello@msingi.io" className="hover:text-slate-600">Contact Us</a>
            <a href="/onboard.html" className="hover:text-slate-600">Register a school</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
