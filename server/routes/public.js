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
// Field lists for every unauthenticated, no-projection-by-default lookup
// below. Found live (2026-09-28): once a school or organization actually
// has a real logo/login-background image uploaded, `logoBase64`/
// `loginBgBase64` on that document can run 1-2MB+ — and every one of
// these routes is hit on EVERY visitor's page load, unauthenticated, with
// no caching. An unprojected `.findOne().lean()` was pulling that entire
// blob into memory on every single request just to read a handful of
// short string fields, none of which are the base64 data itself (that's
// only ever needed by school-asset/org-asset below). Confirmed as the
// likely cause of intermittent request failures that started right after
// TIS Group's shared portal got a real (1.3MB) login background image.
const SCHOOL_INFO_FIELDS =
  'slug name shortName logoUrl faviconUrl primaryColor accentColor themePreset tagline website loginBgUrl isActive status';
const ORG_PORTAL_FIELDS = 'id slug name logoUrl primaryColor tagline loginBgUrl multiSchoolEnabled';

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
    const school = await School.findOne({ slug }).select(SCHOOL_INFO_FIELDS).lean();

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
   (multiSchoolEnabled false, or fewer than 2 schools)
   — response-shape differences must never leak organization existence to
   an unauthenticated caller guessing a slug. */
router.get('/resolve-portal', async (req, res) => {
  try {
    const slug = _resolveSlugFromRequest(req);
    if (!slug) {
      return res.status(400).json({ error: 'slug required' });
    }

    const School = _model('schools');
    const school = await School.findOne({ slug }).select(SCHOOL_INFO_FIELDS).lean();
    if (school) {
      return res.json({ type: 'school', ..._mapPublicSchoolInfo(school) });
    }

    const Org = _model('organizations');
    const org = await Org.findOne({ slug }).select(ORG_PORTAL_FIELDS).lean();
    if (org?.multiSchoolEnabled) {
      const schoolCount = await School.countDocuments({ organizationId: org.id });
      if (schoolCount >= 2) {
        return res.json({
          type:         'organization',
          slug:         org.slug,
          name:         org.name       || 'Organization Portal',
          logoUrl:      org.logoUrl    || null,
          primaryColor: org.primaryColor || null,
          tagline:      org.tagline    || null,
          // Login.jsx reads branding.loginBgUrl identically for a school
          // or an organization portal — this was the one field missing
          // here, so an org's login background (once set via
          // PUT /api/platform/organizations/:id/login-bg) never actually
          // rendered even though the frontend was already ready for it.
          loginBgUrl:   org.loginBgUrl || null,
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
   Returns up to 10 matching schools GROUPED BY ORGANIZATION — every
   school belongs to exactly one organization (a 1:1-genesis org for the
   common single-school case, or a real multi-school org), so search
   results resolve to organizations universally, not as a special case
   for multi-school customers. Matches name/slug/org-name/org-slug, same
   query logic as before this restructure — only the response shaping
   changed. Only active schools are returned; only public-safe fields
   exposed.

   Each entry in `results` is one of:
     {type:'organization', slug, name, logoUrl, primaryColor}
       — org has multiSchoolEnabled:true and 2+ schools total (not just
       matching ones). Clicking this goes straight to the shared portal
       (resolve-portal already resolves this slug to type:'organization').
     {type:'organization-group', orgName, orgSlug, schools:[...]}
       — org has 2+ schools total but multiSchoolEnabled is still off, so
       org.slug isn't portal-navigable yet (resolve-portal would 404 it).
       Grouped visually so two campuses of the same org never look like
       two confusingly-similar, unrelated results, but expands to
       individual schools on click rather than promising a live portal.
     {type:'school', slug, name, shortName, logoUrl, primaryColor}
       — no grouping needed: a 1:1-genesis org (unchanged from before
       this restructure) or a school with no organizationId at all.
*/
router.get('/schools/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ results: [] });

    const School  = _model('schools');
    const Org     = _model('organizations');
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(escaped, 'i');

    // Organizations matching the query — their schools should surface too,
    // even if an individual school's own name/slug doesn't match at all.
    const matchingOrgs = await Org.find({ $or: [{ name: regex }, { slug: regex }] })
      .select('id')
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

    // Classify every organizationId among the matched schools: fetch full
    // org docs (not just the name-only matchingOrgs list, which may not
    // even cover every org a matched school belongs to) plus each org's
    // TRUE total school count — the real roster, not just how many of its
    // schools happened to match this search — since that total is what
    // decides whether it's a 1:1-genesis org (no grouping needed) or a
    // real multi-school org (grouped, portal-ready or not).
    const orgIds = [...new Set(schools.map(s => s.organizationId).filter(Boolean))];
    const orgDocs = orgIds.length
      ? await Org.find({ id: { $in: orgIds } }).select('id name slug logoUrl primaryColor multiSchoolEnabled').lean()
      : [];
    const orgMap = Object.fromEntries(orgDocs.map(o => [o.id, o]));
    const schoolCounts = orgIds.length
      ? Object.fromEntries(await Promise.all(orgIds.map(async id => [id, await School.countDocuments({ organizationId: id })])))
      : {};

    const results = [];
    const seenOrgIds = new Set();
    const schoolsByOrg = {};
    for (const s of schools) {
      const key = s.organizationId || '';
      (schoolsByOrg[key] = schoolsByOrg[key] || []).push(s);
    }

    function mapSchool(s) {
      return {
        type:      'school',
        slug:      s.slug,
        name:      s.name      || 'School Portal',
        shortName: s.shortName || s.name || 'School',
        logoUrl:   s.logoUrl   || null,
        primaryColor: s.primaryColor || '#4f46e5',
      };
    }

    for (const s of schools) {
      const org = s.organizationId ? orgMap[s.organizationId] : null;
      const totalSchools = org ? (schoolCounts[org.id] || 0) : 0;

      if (!org || totalSchools < 2) {
        // No org, or a 1:1-genesis org — plain school result, unchanged.
        results.push(mapSchool(s));
        continue;
      }

      if (seenOrgIds.has(org.id)) continue; // already emitted this org's grouped entry
      seenOrgIds.add(org.id);

      if (org.multiSchoolEnabled) {
        results.push({
          type:         'organization',
          slug:         org.slug,
          name:         org.name || 'Organization Portal',
          logoUrl:      org.logoUrl || null,
          primaryColor: org.primaryColor || null,
        });
      } else {
        results.push({
          type:    'organization-group',
          orgName: org.name || 'Organization',
          orgSlug: org.slug,
          schools: schoolsByOrg[org.id].map(mapSchool),
        });
      }
    }

    res.json({ results: results.slice(0, 10) });
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

    const field  = type === 'logo' ? 'logoBase64' : type === 'favicon' ? 'faviconBase64' : 'loginBgBase64';
    const School = _model('schools');
    const school = await School.findOne({ id: slug }).select(field).lean();
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

/* GET /api/public/org-asset/logo?slug=...
   GET /api/public/org-asset/login-bg?slug=...
   Serves an ORGANIZATION's logo or shared-portal login background as a
   binary image — mirrors school-asset above exactly, just against the
   organizations collection instead of schools. No auth needed so the
   shared multi-school login portal can display it before anyone signs
   in. `slug` here is actually the org's own `id` (same query-param-name-
   vs-actual-field-used mismatch school-asset already has — kept
   consistent rather than "fixed" in only one of the two).
*/
router.get('/org-asset/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== 'logo' && type !== 'login-bg') {
      return res.status(400).json({ error: 'type must be logo or login-bg' });
    }

    const slug = (req.query.slug || '').toLowerCase().trim();
    if (!slug) return res.status(400).json({ error: 'slug required' });

    const field = type === 'logo' ? 'logoBase64' : 'loginBgBase64';
    const Org   = _model('organizations');
    const org   = await Org.findOne({ id: slug }).select(field).lean();
    const b64   = org?.[field];

    if (!b64) return res.status(404).json({ error: `No ${type} set` });

    const [header, data] = b64.split(',');
    const mimeMatch = header?.match(/data:(image\/[\w+.-]+);base64/);
    const mime = mimeMatch?.[1] || 'image/png';

    res.set('Content-Type', mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(data, 'base64'));
  } catch (err) {
    console.error('[public/org-asset]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/platform-asset/logo
   GET /api/public/platform-asset/favicon
   Serves the platform's own logo/favicon as a binary image — mirrors
   school-asset above exactly, minus the slug lookup (a single global
   platform_settings doc, not one per school). No auth needed so the
   public marketing site can display it before login. */
router.get('/platform-asset/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== 'logo' && type !== 'favicon') {
      return res.status(400).json({ error: 'type must be logo or favicon' });
    }

    const Settings = _model('platform_settings');
    const settings = await Settings.findOne({ id: 'global' }).lean();
    const field    = type === 'logo' ? 'logoBase64' : 'faviconBase64';
    const b64      = settings?.[field];

    if (!b64) return res.status(404).json({ error: `No ${type} set` });

    const [header, data] = b64.split(',');
    const mimeMatch = header?.match(/data:(image\/[\w+.-]+);base64/);
    const mime = mimeMatch?.[1] || 'image/png';

    res.set('Content-Type', mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(data, 'base64'));
  } catch (err) {
    console.error('[public/platform-asset]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/public/ping — simple liveness check (no DB) */
router.get('/ping', (req, res) => res.json({ ok: true }));

module.exports = router;
