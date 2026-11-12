/* ============================================================
   Where to send someone after they sign in.

   Reported 2026-11-12: parents tapped "View Snapshot" in a notification
   email and, after signing in, landed on their default dashboard (or,
   before the email fix, the msingi.io homepage) — "there's nothing".
   A page that needs a session sends the reader to /login remembering
   where they were going (React Router state). That memory used to be
   lost at the school picker (`navigate('/login?school=…')` drops state),
   across Google/Microsoft sign-in (a full page round-trip), and it only
   ever kept the path, never the `?child=…` part.

   rememberDest() also stores the destination for this browser tab
   (sessionStorage), so it survives all of those. Only same-site paths
   are ever accepted — never another host — so a crafted link can't use
   login to bounce someone to an outside site.
   ============================================================ */

const KEY = 'msingi_post_login_dest';

/** A safe in-app path, or null. Rejects other hosts, protocol-relative
    `//evil`, backslash tricks, and /login itself (would loop). */
export function safeDest(path) {
  if (typeof path !== 'string') return null;
  const p = path.trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(p)) return null;
  if (/^\/login(?:[/?#]|$)/i.test(p)) return null;
  return p.slice(0, 1000);
}

/** Path + query (+ hash) of a React Router location, if safe. */
export function locationToDest(loc) {
  if (!loc || typeof loc.pathname !== 'string') return null;
  return safeDest(`${loc.pathname}${loc.search || ''}${loc.hash || ''}`);
}

export function rememberDest(path) {
  const d = safeDest(path);
  if (!d) return;
  try { sessionStorage.setItem(KEY, d); } catch { /* storage blocked — state/query still work */ }
}

export function peekDest() {
  try { return safeDest(sessionStorage.getItem(KEY)); } catch { return null; }
}

export function clearDest() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
