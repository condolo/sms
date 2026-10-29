import { useState, useEffect } from 'react';
import { Cookie } from 'lucide-react';
import { getCookieConsent, setCookieConsent } from '@/utils/analytics.js';

/* Shown once, on any page, until a decision is made — mirrors
   FloatingWidgets.jsx's mount pattern (rendered alongside RouterProvider,
   as a sibling, not nested inside it — so a plain <a>, not react-router's
   <Link>, which needs a Router context this component sits outside of).
   Google Analytics stays fully unloaded (no script, no cookies) until
   Accept is clicked here — see utils/analytics.js.

   ── Why this must never sit above a modal ──────────────────────────
   Every modal in the app uses `fixed inset-0 z-50` — that is the
   app-wide convention (dozens of them, in both portals and the admin
   shell). This banner used to be z-[60], i.e. the ONLY thing in the
   product stacked above the modal layer, and because it is anchored to
   the BOTTOM of the viewport, on a phone it landed exactly on top of a
   modal's action row.

   Measured at 390x844 in the parent portal's reply box: the banner
   occupied y=598..844 while the modal's Send button sat at y=601..635 —
   fully covered, with `document.elementFromPoint` at the button's centre
   returning the banner's paragraph. A parent literally could not press
   Send on a phone. On a desktop screen the banner and the modal barely
   overlapped, which is why it went unnoticed.

   Two layers of fix:
     1. z-[30] — below the modal layer (z-50) and below the app's own
        z-40 overlays, so no modal can ever be blocked by it.
     2. It also steps aside entirely while a modal is open, so it does
        not sit dimmed behind the overlay. */
const MODAL_SELECTOR = [
  '[role="dialog"]:not([aria-label="Cookie consent"])', // accessible dialogs
  '[aria-modal="true"]',
  '.fixed.inset-0.z-50',                                // the app's modal convention
].join(', ');

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setVisible(getCookieConsent() === null);
  }, []);

  /* Step aside while any modal is open. A MutationObserver on the body is
     what makes this work for modals owned by components that know
     nothing about this banner (which is every modal in the app). The
     check is throttled to one per animation frame so a busy page cannot
     turn this into a hot path. */
  useEffect(() => {
    if (!visible) return undefined;

    const update = () => setModalOpen(!!document.querySelector(MODAL_SELECTOR));

    update();
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [visible]);

  if (!visible || modalOpen) return null;

  function choose(value) {
    setCookieConsent(value);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[30] px-4 pb-4 sm:px-6 sm:pb-6"
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
