const { _model } = require('../utils/model');
const demo = require('../utils/demo');

/* Demo tenants are real schools with an expiry date. Block resolution (and
   therefore login) the moment that date passes — the operator console can
   still see them, and the sweep freezes/purges them later. */
function _rejectExpiredDemo(res, doc) {
  if (demo.isDemoSchoolDoc(doc) && doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
    res.status(403).json({
      success: false,
      error: {
        code: 'DEMO_EXPIRED',
        message: 'This demo has ended. Your data is kept for 30 days — contact us to reopen it or move to a paid school.',
        loginUrl: '/demo-expired',
      },
    });
    return true;
  }
  return false;
}

/* ── Tenant resolution ───────────────────────────────────────────
   Reads the school from one of:
     1. req.jwtUser.schoolId  (most requests — already authenticated)
     2. X-School-Slug header  (login requests — not yet authenticated)
     3. Subdomain             (e.g. greenwood.msingi.io)
   Attaches req.school = the full session-safe school shape
─────────────────────────────────────────────────────────────────── */

async function tenantMiddleware(req, res, next) {
  try {
    // 1. From JWT (already resolved schoolId)
    if (req.jwtUser?.schoolId) {
      const doc = await _findSchool({ id: req.jwtUser.schoolId });
      if (!doc) return res.status(404).json({ error: 'School not found' });
      if (!doc.isActive) return res.status(403).json({ error: 'School account is inactive' });
      if (_rejectExpiredDemo(res, doc)) return;
      req.school = doc;
      return next();
    }

    // 2. From X-School-Slug header (login flow)
    const slug = req.headers['x-school-slug'];
    if (slug) {
      const doc = await _findSchool({ slug });
      if (!doc) return res.status(404).json({ error: `School '${slug}' not found` });
      if (!doc.isActive) return res.status(403).json({ error: 'School account is inactive' });
      if (_rejectExpiredDemo(res, doc)) return;
      req.school = doc;
      return next();
    }

    // 3. From subdomain (e.g. greenwood.msingi.io)
    const host = req.hostname || '';
    const parts = host.split('.');
    if (parts.length >= 3) {
      const subSlug = parts[0];
      if (subSlug !== 'www' && subSlug !== 'app') {
        const doc = await _findSchool({ slug: subSlug });
        if (doc?.isActive) {
          if (_rejectExpiredDemo(res, doc)) return;
          req.school = doc;
          return next();
        }
      }
    }

    // 4. From custom domain
    const doc = await _findSchool({ customDomain: host });
    if (doc?.isActive) {
      if (_rejectExpiredDemo(res, doc)) return;
      req.school = doc;
      return next();
    }

    return res.status(400).json({ error: 'Could not resolve school from request' });
  } catch (err) {
    next(err);
  }
}

/* ── Map ISO currency codes → display symbols ────────────────── */
const CURRENCY_SYMBOLS = {
  KES: 'KSh', USD: '$',   EUR: '€',    GBP: '£',   UGX: 'USh',
  TZS: 'TSh', RWF: 'RF',  ETB: 'Br',   ZAR: 'R',   NGN: '₦',
  GHS: 'GH₵', XOF: 'CFA', XAF: 'FCFA', INR: '₹',   AUD: 'A$',
  CAD: 'C$',  JPY: '¥',   CNY: '¥',
};

/**
 * Map a raw Mongoose school document to the session-safe shape
 * sent to the client on every login / tenant resolution.
 *
 * Exported separately so the shape contract can be unit-tested
 * without touching MongoDB.
 *
 * IMPORTANT: every field that any client module reads from
 * session.school MUST appear here with an explicit default.
 * Silent omissions cause runtime fallbacks to wrong values
 * (e.g. currency showing USD instead of KES).
 */
function _mapSchoolDoc(doc) {
  const currency = doc.currency || 'KES';
  return {
    /* ── Identity ── */
    id:             doc.id || (doc._id ? doc._id.toString() : undefined),
    slug:           doc.slug,
    name:           doc.name,
    shortName:      doc.shortName    || doc.name,
    logoUrl:        doc.logoUrl      || null,
    systemEmail:    doc.systemEmail  || null,
    adminEmail:     doc.adminEmail   || null,
    /* ── Plan / subscription ── */
    plan:           doc.plan         || 'core',
    addOns:         doc.addOns       || [],
    isActive:       doc.isActive !== false,
    planExpiresAt:  doc.planExpiresAt || null,
    /* Display-only signal for the staff banner; enforcement lives in
       middleware/plan.js (ENFORCE_PLAN_EXPIRY + PLAN_GRACE_DAYS). */
    planExpired:    !!(doc.planExpiresAt && new Date(doc.planExpiresAt) < new Date()),
    /* Demo tenant lifecycle (see utils/demo.js). Kept in the mapped shape
       because login/MFA bypass and expiry checks read it from req.school. */
    status:         doc.status        || null,
    isDemo:         !!doc.isDemo,
    expiresAt:      doc.expiresAt     || null,
    demoExpired:    !!doc.demoExpired,
    /* ── Branding / theme ── */
    primaryColor:   doc.primaryColor || '#4f46e5',
    accentColor:    doc.accentColor  || '#7c3aed',
    themePreset:    doc.themePreset  || null,
    faviconUrl:     doc.faviconUrl   || null,
    /* The school's own line — the app shows it on the launch splash. */
    tagline:        doc.tagline      || null,
    /* ── Module visibility ── */
    moduleConfig:   doc.moduleConfig  || null,
    /* ── Student/parent portal config ── */
    portalConfig:    doc.portalConfig    || null,
    /* ── Admission number config ── */
    admissionConfig: doc.admissionConfig || null,
    /* ── Regional / financial ── */
    currency,
    currencySymbol: doc.currencySymbol || CURRENCY_SYMBOLS[currency] || currency,
    timezone:       doc.timezone       || 'Africa/Nairobi',
    country:        doc.country        || null,
    /* ── Academic ── */
    academicYear:   doc.academicYear   || null,
    termsPerYear:   doc.termsPerYear   || null,
  };
}

/* Every field _mapSchoolDoc reads, and nothing else — see _findSchool's own
   comment for why this must stay a projection. _id needs no entry: MongoDB
   returns it unless explicitly excluded. */
const SCHOOL_FIELDS = [
  'id', 'slug', 'name', 'shortName', 'logoUrl', 'systemEmail', 'adminEmail',
  'plan', 'addOns', 'isActive', 'planExpiresAt',
  'status', 'isDemo', 'expiresAt', 'demoExpired',
  'primaryColor', 'accentColor', 'themePreset', 'faviconUrl', 'tagline',
  'moduleConfig', 'portalConfig', 'admissionConfig',
  'currency', 'currencySymbol', 'timezone', 'country',
  'academicYear', 'termsPerYear',
].join(' ');

async function _findSchool(filter) {
  try {
    const Sch = _model('schools');
    /* PROJECTED, and it must stay projected. Without .select() this pulled the
       ENTIRE school document on every resolution, including logoBase64 and
       loginBgBase64 — which run 1-2MB+ the moment a school uploads a real
       image. public.js already documents that exact find (2026-09-28) and
       fixed its own unauthenticated routes with a projection; this one is
       strictly worse, because tenantMiddleware resolves the tenant on EVERY
       school-scoped request, so the whole product paid a multi-megabyte
       document transfer before any route handler ran. Measured live: ~5-6s per
       request for a school with a real upload, against ~1.3s for the same
       query that misses.

       SCHOOL_FIELDS is every field _mapSchoolDoc reads and nothing else.
       tenant-school-shape.test.js pins that the two lists stay in step — a
       field added to the mapper without being added here would silently map to
       its default (null) rather than fail loudly. */
    const doc = await Sch.findOne(filter).select(SCHOOL_FIELDS).lean();
    if (!doc) return null;
    return _mapSchoolDoc(doc);
  } catch { return null; }
}

module.exports = { tenantMiddleware, _mapSchoolDoc, CURRENCY_SYMBOLS };
