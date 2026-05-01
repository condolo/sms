const { _model } = require('../utils/model');

/* ── Tenant resolution ───────────────────────────────────────────
   Reads the school from one of:
     1. req.jwtUser.schoolId  (most requests — already authenticated)
     2. X-School-Slug header  (login requests — not yet authenticated)
     3. Subdomain             (e.g. innolearn.innolearn.com)
   Attaches req.school = { id, slug, plan, addOns, isActive }
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

    // 3. From subdomain (e.g. InnoLearn.InnoLearn.com)
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

async function _findSchool(filter) {
  try {
    const Sch = _model('schools');
    const doc = await Sch.findOne(filter).lean();
    if (!doc) return null;
    return { id: doc.id || doc._id.toString(), slug: doc.slug,
             plan: doc.plan || 'core', addOns: doc.addOns || [],
             isActive: doc.isActive !== false, name: doc.name };
  } catch { return null; }
}

module.exports = { tenantMiddleware };
