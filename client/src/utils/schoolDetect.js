/**
 * School slug detection — determines which school's portal the user is on.
 *
 * Priority order:
 *  1. Subdomain   — greenwood.msingi.io  → slug = "greenwood"
 *  2. Query param — ?school=greenwood    → slug = "greenwood"  (dev/testing)
 *  3. localStorage — last used school    → slug = "..."        (returning user shortcut)
 *  4. No slug     → main domain / landing page
 *
 * "Main domain" hosts (no school context):
 *  localhost, 127.0.0.1, app.*, www.*, school-management-ecosystem.onrender.com
 */

const MAIN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'school-management-ecosystem.onrender.com',
  'msingi.io',
  'www.msingi.io',
  'app.msingi.io',
]);

const NON_SCHOOL_SUBDOMAINS = new Set(['www', 'app', 'api', 'mail', 'admin', 'platform']);

/**
 * Detect the current school slug from the browser URL.
 * Returns { slug: string|null, isSchool: boolean, source: string }
 */
export function detectSchool() {
  const host  = window.location.hostname.toLowerCase();
  const parts = host.split('.');

  // 1. Subdomain detection — {slug}.domain.tld
  //    Must be 3+ parts and the subdomain must not be a reserved name
  if (
    parts.length >= 3 &&
    !MAIN_HOSTS.has(host) &&
    !NON_SCHOOL_SUBDOMAINS.has(parts[0])
  ) {
    return { slug: parts[0], isSchool: true, source: 'subdomain' };
  }

  // 2. Query param — ?school=greenwood (dev / QR-code links)
  const qs = new URLSearchParams(window.location.search);
  const qSlug = qs.get('school');
  if (qSlug) {
    return { slug: qSlug.toLowerCase(), isSchool: true, source: 'query' };
  }

  // 3. localStorage shortcut — only apply when NOT on a known main host
  //    (prevents stored slug from hijacking msingi.io landing page)
  if (!MAIN_HOSTS.has(host)) {
    const stored = localStorage.getItem('il_school_slug');
    if (stored) {
      return { slug: stored, isSchool: true, source: 'stored' };
    }
  }

  // 4. Main domain — show landing page
  return { slug: null, isSchool: false, source: 'main' };
}

/**
 * Build the dedicated school portal URL for a given slug.
 * e.g.  greenwood → https://greenwood.innolearn.com
 *
 * Falls back to  ?school=greenwood  on localhost.
 */
export function schoolPortalUrl(slug) {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${window.location.origin}?school=${slug}`;
  }
  // Replace the first segment (or prepend) with the slug
  const parts = host.split('.');
  const base  = parts.length >= 2
    ? parts.slice(parts.length >= 3 ? 1 : 0).join('.')
    : host;
  return `${window.location.protocol}//${slug}.${base}`;
}

/** Persist the school slug for returning-user shortcut */
export function storeSchoolSlug(slug) {
  if (slug) localStorage.setItem('il_school_slug', slug);
  else      localStorage.removeItem('il_school_slug');
}

/** Clear stored school slug (call on logout) */
export function clearStoredSchoolSlug() {
  localStorage.removeItem('il_school_slug');
}
