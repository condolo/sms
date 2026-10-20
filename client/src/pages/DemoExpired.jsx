import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Clock3, ArrowRight, RotateCcw } from 'lucide-react';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';

export default function DemoExpired() {
  const slug = new URLSearchParams(window.location.search).get('school') || '';
  return (
    <>
      <Helmet><title>Demo ended — Msingi</title></Helmet>
      <PublicNav />
      <main className="min-h-screen bg-slate-50 pt-24 pb-20">
        <div className="max-w-xl mx-auto px-5 text-center">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 md:p-10">
            <Clock3 size={42} className="mx-auto text-amber-500" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900">This demo has ended</h1>
            <p className="mt-3 text-slate-600">
              Your workspace {slug ? <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">{slug}</code> : null} is
              read-locked, but nothing has been deleted. Demo data is kept for 30 days.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/contact" className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 font-semibold text-white">
                Reopen or extend <ArrowRight size={18} />
              </Link>
              <Link to="/demo" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700">
                Start a new demo <RotateCcw size={18} />
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Converting to a paid school keeps everything you entered — no re-setup.
            </p>
          </div>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
