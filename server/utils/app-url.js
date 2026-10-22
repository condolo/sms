/* ============================================================
   app-url.js — the ONE definition of the application's base URL.

   WHY THIS EXISTS
   APP_URL was defined independently in server/utils/email.js and
   server/utils/school-url.js, and a third copy appeared in
   server/routes/platform.js with a DIFFERENT fallback
   ('http://localhost:3005' instead of 'https://msingi.io').

   That difference was not cosmetic. If APP_URL is ever unset in a
   deployment, every other email would still link to the real site while
   the platform-team invite email would contain
   "http://localhost:3005/platform?invite=..." — a link that only
   resolves on the server itself, so the invitee could never activate
   their account and the invite would silently expire. A base URL must
   have exactly one definition, and its fallback must be the real site.

   The trailing-slash trim happens here too, so callers can safely do
   appUrl('/platform') without producing a double slash.
   ============================================================ */
'use strict';

const RAW_APP_URL = process.env.APP_URL || '';
const APP_URL = (RAW_APP_URL || 'https://msingi.io').replace(/\/+$/, '');

/** Absolute URL for a path on this deployment, e.g. appUrl('/platform'). */
function appUrl(pathname = '') {
  if (!pathname) return APP_URL;
  return APP_URL + (pathname.startsWith('/') ? pathname : `/${pathname}`);
}

module.exports = { APP_URL, RAW_APP_URL, appUrl };
