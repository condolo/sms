/* ============================================================
   Public Routes — no authentication required
   Used by the frontend to fetch school branding before login,
   so the login page can display the school's logo, name, and
   colors without the user having logged in yet.
   ============================================================ */
const express  = require('express');
const { _model } = require('../utils/model');

const router = express.Router();

/* GET /api/public/school-info
   Query:  ?slug=greenwood
   Header: X-School-Slug: greenwood  (fallback)
   Host:   greenwood.innolearn.com   (auto-detected from subdomain)

   Returns the public-safe school profile used to brand the
   school's own login page. Never returns sensitive data.
*/
router.get('/school-info', async (req, res) => {
  try {
    let slug = req.query.slug || req.headers['x-school-slug'];

    // Auto-detect from subdomain if no explicit slug provided
    if (!slug) {
      const host  = req.hostname || '';
      const parts = host.split('.');
      if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'app') {
        slug = parts[0];
      }
    }

    if (!slug) {
      return res.status(400).json({ error: 'slug required' });
    }

    const School = _model('schools');
    const school = await School.findOne({ slug: slug.toLowerCase() }).lean();

    if (!school) {
      return res.status(404).json({ error: `School '${slug}' not found` });
    }

    // Return only public-safe branding fields — no PII or credentials
    res.json({
      slug:         school.slug,
      name:         school.name          || 'School Portal',
      shortName:    school.shortName     || school.name || 'School',
      logoUrl:      school.logoUrl       || null,
      primaryColor: school.primaryColor  || '#4f46e5',
      accentColor:  school.accentColor   || '#7c3aed',
      website:      school.website       || null,
      isActive:     school.isActive !== false,
      status:       school.status        || 'active',
    });
  } catch (err) {
    console.error('[public/school-info]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/ping — simple liveness check (no DB) */
router.get('/ping', (req, res) => res.json({ ok: true }));

module.exports = router;
