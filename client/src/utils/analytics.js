/* ============================================================
   Cookie-consent-gated Google Analytics.

   GA4 previously loaded unconditionally in index.html, on every page,
   for every visitor — no consent asked, contradicting the Privacy
   Policy's own "we do not use third-party analytics that profile
   individual users" claim. Fixed: GA now only loads after an explicit
   Accept via CookieConsentBanner.jsx. A decline (or no decision yet)
   means zero GA network requests and zero _ga/_ga_* cookies.
   ============================================================ */

const GA_ID = 'G-YXEMXJVM0L';
const CONSENT_KEY = 'msingi_cookie_consent'; // 'accepted' | 'declined'

export function getCookieConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

export function setCookieConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* ignore */ }
  if (value === 'accepted') loadGoogleAnalytics();
}

// "Cookie Preferences" footer link (PublicFooter.jsx) — lets a visitor
// change their mind at any time. Clears the stored decision and reloads,
// same hard-reload convention used elsewhere (e.g. school switching) for
// "start this clean" resets: the fresh load never runs
// initAnalyticsIfConsented() with a stale 'accepted' value, so GA does not
// load, and the banner (whose own visibility check is "no decision yet")
// shows again immediately.
export function reopenCookiePreferences() {
  try { localStorage.removeItem(CONSENT_KEY); } catch { /* ignore */ }
  window.location.reload();
}

/** Call once on app boot — loads GA immediately only if a prior visit already accepted. */
export function initAnalyticsIfConsented() {
  if (getCookieConsent() === 'accepted') loadGoogleAnalytics();
}

function loadGoogleAnalytics() {
  if (window.gtag) return; // already loaded this session
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
}
