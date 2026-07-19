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
// Shared by /school-info and /resolve-portal's school branch — the two
// response shapes must stay byte-identical, so both build off one mapper
// rather than risking silent drift between two hand-maintained field lists.
function _mapPublicSchoolInfo(school) {
  return {
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
  };
}

function _resolveSlugFromRequest(req) {
  let slug = req.query.slug || req.headers['x-school-slug'];
  if (!slug) {
    const host  = req.hostname || '';
    const parts = host.split('.');
    if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'app') {
      slug = parts[0];
    }
  }
  return slug ? slug.toLowerCase() : null;
}

router.get('/school-info', async (req, res) => {
  try {
    const slug = _resolveSlugFromRequest(req);
    if (!slug) {
      return res.status(400).json({ error: 'slug required' });
    }

    const School = _model('schools');
    const school = await School.findOne({ slug }).lean();

    if (!school) {
      return res.status(404).json({ error: `School '${slug}' not found` });
    }

    res.json(_mapPublicSchoolInfo(school));
  } catch (err) {
    console.error('[public/school-info]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/resolve-portal
   Query:  ?slug=greenwood | ?slug=green-valley
   Header: X-School-Slug: greenwood  (fallback)
   Host:   greenwood.msingi.io       (auto-detected from subdomain)

   Tells the client, before rendering any login form, whether a slug
   belongs to a single school (today's normal case — same response shape
   as /school-info, plus type:'school') or a multi-school organization
   that has opted into a shared login portal (type:'organization',
   org-shared-slug login, org-shared-slug login flow — auth.js's
   POST /auth/org-login). Checks schools FIRST: a 1:1-genesis org's slug
   is indistinguishable from its one school's slug and must still resolve
   as that school, not a one-entry organization picker.

   Deliberately returns the SAME 404 shape whether nothing matches at all
   OR a real organization exists at that slug but hasn't opted in
   (multiSchoolEnabled/orgSlugLoginEnabled false, or fewer than 2 schools)
   — response-shape differences must never leak organization existence to
   an unauthenticated caller guessing a slug. */
router.get('/resolve-portal', async (req, res) => {
  try {
    const slug = _resolveSlugFromRequest(req);
    if (!slug) {
      return res.status(400).json({ error: 'slug required' });
    }

    const School = _model('schools');
    const school = await School.findOne({ slug }).lean();
    if (school) {
      return res.json({ type: 'school', ..._mapPublicSchoolInfo(school) });
    }

    const Org = _model('organizations');
    const org = await Org.findOne({ slug }).lean();
    if (org?.multiSchoolEnabled && org?.orgSlugLoginEnabled) {
      const schoolCount = await School.countDocuments({ organizationId: org.id });
      if (schoolCount >= 2) {
        return res.json({
          type:         'organization',
          slug:         org.slug,
          name:         org.name       || 'Organization Portal',
          logoUrl:      org.logoUrl    || null,
          primaryColor: org.primaryColor || null,
          tagline:      org.tagline    || null,
        });
      }
    }

    return res.status(404).json({ error: `Portal '${slug}' not found` });
  } catch (err) {
    console.error('[public/resolve-portal]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/schools/search
   Query: ?q=greenwood
   Returns up to 10 schools whose name, slug, OR organization's name/slug
   contains the query string — so searching "Green Valley Schools" (an
   organization with multiple campuses) surfaces every campus under it,
   not just a school whose own name happens to match. Used by the
   school-finder autocomplete on the login page. Only active schools are
   returned; only public-safe fields exposed.
*/
router.get('/schools/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ schools: [] });

    const School  = _model('schools');
    const Org     = _model('organizations');
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(escaped, 'i');

    // Organizations matching the query — their schools should surface too,
    // even if an individual school's own name/slug doesn't match at all.
    const matchingOrgs = await Org.find({ $or: [{ name: regex }, { slug: regex }] })
      .select('id name')
      .limit(20)
      .lean();
    const matchingOrgIds = matchingOrgs.map(o => o.id);

    const schools = await School.find({
      isActive: { $ne: false },
      $or: [
        { name: regex }, { shortName: regex }, { slug: regex },
        ...(matchingOrgIds.length ? [{ organizationId: { $in: matchingOrgIds } }] : []),
      ],
    })
      .select('slug name shortName logoUrl primaryColor accentColor organizationId')
      .limit(10)
      .lean();

    // Look up organization names for every result (not just the ones that
    // matched by org) so the dropdown can always show which group a school
    // belongs to when it shares an organization with other schools.
    const orgIds = [...new Set(schools.map(s => s.organizationId).filter(Boolean))];
    const orgMap = Object.fromEntries(matchingOrgs.filter(o => orgIds.includes(o.id)).map(o => [o.id, o.name]));
    const missingOrgIds = orgIds.filter(id => !(id in orgMap));
    if (missingOrgIds.length) {
      const extraOrgs = await Org.find({ id: { $in: missingOrgIds } }).select('id name').lean();
      extraOrgs.forEach(o => { orgMap[o.id] = o.name; });
    }

    res.json({
      schools: schools.map(s => ({
        slug:             s.slug,
        name:             s.name      || 'School Portal',
        shortName:        s.shortName || s.name || 'School',
        logoUrl:          s.logoUrl   || null,
        primaryColor:     s.primaryColor || '#4f46e5',
        organizationName: s.organizationId ? (orgMap[s.organizationId] || null) : null,
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
