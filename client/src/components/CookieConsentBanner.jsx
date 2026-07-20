import { useState, useEffect } from 'react';
import { Cookie } from 'lucide-react';
import { getCookieConsent, setCookieConsent } from '@/utils/analytics.js';

/* Shown once, on any page, until a decision is made — mirrors
   FloatingWidgets.jsx's mount pattern (rendered alongside RouterProvider,
   as a sibling, not nested inside it — so a plain <a>, not react-router's
   <Link>, which needs a Router context this component sits outside of).
   Google Analytics stays fully unloaded (no script, no cookies) until
   Accept is clicked here — see utils/analytics.js. */
export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getCookieConsent() === null);
  }, []);

  if (!visible) return null;

  function choose(value) {
    setCookieConsent(value);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Cookie size={16} className="text-indigo-600" />
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            We use cookies only for essential login sessions, and — only if you accept — Google Analytics to understand how the site is used. No advertising or tracking cookies either way.{' '}
            <a href="/privacy" className="text-indigo-600 hover:underline font-medium">Read our Privacy Policy</a>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => choose('declined')}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
