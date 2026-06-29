const { _model } = require('../utils/model');

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
      req.school = doc;
      return next();
    }

    // 2. From X-School-Slug header (login flow)
    const slug = req.headers['x-school-slug'];
    if (slug) {
      const doc = await _findSchool({ slug });
      if (!doc) return res.status(404).json({ error: `School '${slug}' not found` });
      if (!doc.isActive) return res.status(403).json({ error: 'School account is inactive' });
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
        if (doc?.isActive) { req.school = doc; return next(); }
      }
    }

    // 4. From custom domain
    const doc = await _findSchool({ customDomain: host });
    if (doc?.isActive) { req.school = doc; return next(); }

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
    /* ── Branding / theme ── */
    primaryColor:   doc.primaryColor || '#4f46e5',
    accentColor:    doc.accentColor  || '#7c3aed',
    themePreset:    doc.themePreset  || null,
    faviconUrl:     doc.faviconUrl   || null,
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

async function _findSchool(filter) {
  try {
    const Sch = _model('schools');
    const doc = await Sch.findOne(filter).lean();
    if (!doc) return null;
    return _mapSchoolDoc(doc);
  } catch { return null; }
}

module.exports = { tenantMiddleware, _mapSchoolDoc, CURRENCY_SYMBOLS };
