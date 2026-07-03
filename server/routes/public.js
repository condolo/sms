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
   Host:   greenwood.msingi.io       (auto-detected from subdomain)

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
      faviconUrl:   school.faviconUrl    || null,
      primaryColor: school.primaryColor  || '#4f46e5',
      accentColor:  school.accentColor   || '#7c3aed',
      themePreset:  school.themePreset   || null,
      tagline:      school.tagline       || null,
      website:      school.website       || null,
      loginBgUrl:   school.loginBgUrl    || null,
      isActive:     school.isActive !== false,
      status:       school.status        || 'active',
    });
  } catch (err) {
    console.error('[public/school-info]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/schools/search
   Query: ?q=greenwood
   Returns up to 10 schools whose name or slug starts with / contains the
   query string. Used by the school-finder autocomplete on the login page.
   Only active schools are returned; only public-safe fields exposed.
*/
router.get('/schools/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ schools: [] });

    const School  = _model('schools');
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(escaped, 'i');

    const schools = await School.find({
      isActive: { $ne: false },
      $or: [{ name: regex }, { shortName: regex }, { slug: regex }],
    })
      .select('slug name shortName logoUrl primaryColor accentColor')
      .limit(10)
      .lean();

    res.json({
      schools: schools.map(s => ({
        slug:         s.slug,
        name:         s.name      || 'School Portal',
        shortName:    s.shortName || s.name || 'School',
        logoUrl:      s.logoUrl   || null,
        primaryColor: s.primaryColor || '#4f46e5',
      })),
    });
  } catch (err) {
    console.error('[public/schools/search]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/school-asset/logo?slug=...
   GET /api/public/school-asset/favicon?slug=...
   Serves the school logo or favicon as a binary image — no auth needed
   so the login page and browser tab can display it before login.
*/
router.get('/school-asset/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== 'logo' && type !== 'favicon' && type !== 'login-bg') {
      return res.status(400).json({ error: 'type must be logo, favicon, or login-bg' });
    }

    const slug = (req.query.slug || '').toLowerCase().trim();
    if (!slug) return res.status(400).json({ error: 'slug required' });

    const School = _model('schools');
    const school = await School.findOne({ id: slug }).lean();
    const field  = type === 'logo' ? 'logoBase64' : type === 'favicon' ? 'faviconBase64' : 'loginBgBase64';
    const b64    = school?.[field];

    if (!b64) return res.status(404).json({ error: `No ${type} set` });

    const [header, data] = b64.split(',');
    const mimeMatch = header?.match(/data:(image\/[\w+]+);base64/);
    const mime = mimeMatch?.[1] || 'image/png';

    res.set('Content-Type', mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(data, 'base64'));
  } catch (err) {
    console.error('[public/school-asset]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/ping — simple liveness check (no DB) */
router.get('/ping', (req, res) => res.json({ ok: true }));

module.exports = router;
