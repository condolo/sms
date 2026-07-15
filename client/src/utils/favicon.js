/* ============================================================
   Favicon helper — single place that touches the shared
   <link rel="icon"> DOM node.

   The tab favicon/title are process-global singletons that outlive
   any one React component. Every place that sets a school's favicon
   must also reset it on unmount/navigation-away, or it leaks into
   whatever renders next (a different school, or the public site) —
   this happened in production. Centralising the DOM write here means
   every caller resets to the same default, instead of each one
   reimplementing (and possibly getting wrong) the query/create/reset
   logic independently.
   ============================================================ */

export const DEFAULT_FAVICON = '/favicon.svg';
export const DEFAULT_TITLE   = 'Msingi';

export function setFavicon(url) {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url || DEFAULT_FAVICON;
}
