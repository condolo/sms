import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* Cloudflare Turnstile — bot check for the public contact form.
   Renders nothing, and never blocks submission, when VITE_TURNSTILE_SITE_KEY
   isn't set — same graceful-skip-when-unconfigured convention the server
   uses for TURNSTILE_SECRET_KEY (server/routes/public.js), so local/dev
   never gets stuck behind a captcha it has no key for. */
const SITE_KEY   = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let scriptPromise = null;
function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/* ref.current.reset() — call after every submit attempt (success or
   failure): a Turnstile token is single-use, so a retry after any server-
   side failure needs a fresh one or it will fail verification again even
   though the visitor did nothing wrong. */
const TurnstileWidget = forwardRef(function TurnstileWidget({ onVerify, onExpire }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef  = useRef(null);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.reset(widgetIdRef.current); } catch { /* widget already gone */ }
      }
    },
  }), []);

  useEffect(() => {
    if (!SITE_KEY) return;
    let mounted = true;

    loadScript().then(() => {
      if (!mounted || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey:  SITE_KEY,
        callback: (token) => onVerify(token),
        'expired-callback': () => onExpire?.(),
        'error-callback':   () => setFailed(true),
      });
    }).catch(() => setFailed(true));

    return () => {
      mounted = false;
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* already torn down */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;

  return (
    <div>
      <div ref={containerRef} />
      {failed && (
        <p className="text-xs text-red-600 mt-1.5">Could not load the verification check — refresh the page and try again.</p>
      )}
    </div>
  );
});

export default TurnstileWidget;
