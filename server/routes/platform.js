/* ============================================================
   Platform Admin Routes — YOUR private dashboard API
   Protected by X-Platform-Key header (not school JWT)
   ============================================================ */
const express    = require('express');
const crypto     = require('crypto');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const { platformSession } = require('../middleware/auth');
const { invalidatePlanCache } = require('../middleware/plan');
const AuditService      = require('../services/audit');
const { sign } = require('../utils/jwt');
const email    = require('../utils/email');
const { tenantModel } = require('../utils/tenant-model');
const { provisionOrganizationForSchool } = require('../utils/provision-organizations');
const { provisionMembershipForUser } = require('../utils/provision-memberships');

const router = express.Router();

/* ── Platform Settings (public GET — no auth required) ───────── */
/* GET /api/platform/settings — public read for landing page, etc. */
router.get('/settings', async (req, res) => {
  try {
    const Settings = _model('platform_settings');
    const doc = await Settings.findOne({ id: 'global' }).lean();
    // Return safe public subset (no internal fields)
    const settings = doc || {};
    return res.json({
      platformName:   settings.platformName   || 'Msingi',
      tagline:        settings.tagline        || 'The Digital Operating System for Modern Schools.',
      logoUrl:        settings.logoUrl        || null,
      faviconUrl:     settings.faviconUrl     || null,
      primaryColor:   settings.primaryColor   || '#4f46e5',
      contactEmail:   settings.contactEmail   || 'support@msingi.io',
      contactPhone:   settings.contactPhone   || '+254 769 024 153',
      socialLinks:    settings.socialLinks    || {},
      updatedAt:      settings.updatedAt      || null,
    });
  } catch (err) {
    console.error('[platform/settings GET]', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── Landing page CMS — public GET (no platform key) ─────────── */
router.get('/landing-content', async (req, res) => {
  try {
    const LC  = _model('landing_content');
    const doc = await LC.findOne({ id: 'global' }).lean();
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, data: doc?.content || null });
  } catch (err) {
    console.error('[platform/landing-content GET]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── Platform admin authentication ──────────────────────────
   Login / logout are public (no platformSession required).
   All routes BELOW router.use(platformSession) are protected.
   ─────────────────────────────────────────────────────────── */

// 5 failed attempts per IP per 15 min — only counts failures
const _loginLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    5,
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many failed login attempts. Please wait 15 minutes before trying again.' } },
});

/* POST /api/platform/auth/login */
router.post('/auth/login', _loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  const expectedUser = process.env.PLATFORM_ADMIN_USER      || '';
  const passHash     = process.env.PLATFORM_ADMIN_PASS_HASH || '';
  const secret       = process.env.PLATFORM_JWT_SECRET      || '';

  if (!expectedUser || !passHash || !secret) {
    console.error('[platform/login] Missing env vars: PLATFORM_ADMIN_USER, PLATFORM_ADMIN_PASS_HASH, PLATFORM_JWT_SECRET');
    return res.status(503).json({ success: false, error: { code: 'MISCONFIGURED', message: 'Platform admin credentials are not configured on this server.' } });
  }

  if (!username || !password) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Username and password are required.' } });
  }

  // Constant-time username comparison (pad to same length to avoid length oracle)
  const uBuf  = Buffer.from(username.trim());
  const eBuf  = Buffer.from(expectedUser);
  const len   = Math.max(uBuf.length, eBuf.length, 1);
  const uPad  = Buffer.concat([uBuf, Buffer.alloc(len - uBuf.length)]);
  const ePad  = Buffer.concat([eBuf, Buffer.alloc(len - eBuf.length)]);
  const userMatch = crypto.timingSafeEqual(uPad, ePad) && uBuf.length === eBuf.length;

  // bcrypt.compare is inherently constant-time
  const passMatch = await bcrypt.compare(password, passHash);

  if (!userMatch || !passMatch) {
    AuditService.log({ action: 'platform.login.failed', actor: { userId: 'platform', role: 'platform', email: null }, schoolId: null, target: { type: 'platform', id: null, label: 'platform-admin' }, details: { attemptedUser: (username || '').slice(0, 32) }, req });
    return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
  }

  const token = jwt.sign({ sub: 'platform-admin' }, secret, { expiresIn: '2h' });
  res.cookie('platform_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   2 * 60 * 60 * 1000,
  });

  AuditService.log({ action: 'platform.login.success', actor: { userId: 'platform', role: 'platform', email: null }, schoolId: null, target: { type: 'platform', id: null, label: 'platform-admin' }, details: {}, req });
  return res.json({ success: true });
});

/* POST /api/platform/auth/logout */
router.post('/auth/logout', (req, res) => {
  res.clearCookie('platform_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  return res.json({ success: true });
});

// All routes below require a valid platform session cookie
router.use(platformSession);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* GET /api/platform/schools — list all schools with stats */
router.get('/schools', async (req, res) => {
  try {
    const School  = _model('schools');
    // Projection: only load fields needed for the dashboard list + stats
    // Avoids pulling large fields (logoUrl, branding, email templates) into RAM for every school
    const schools = await School.find({})
      .select('id _id slug name shortName plan isActive status adminName adminEmail currency currencySymbol trialEnds createdAt primaryColor sections curriculum')
      .lean();

    const withStats = await Promise.all(schools.map(async s => {
      // lean() docs don't apply Mongoose virtuals, so s.id is the raw stored
      // field (or undefined for schools provisioned before this fix).
      // Fall back to _id.toString() so stats still work for legacy docs.
      const sid = s.id || s._id?.toString();
      const [students, staff] = await Promise.all([
        tenantModel('students', { schoolId: sid }).countDocuments({ schoolId: sid, status: 'active' }),
        tenantModel('users', { schoolId: sid }).countDocuments({ schoolId: sid, isActive: true })
      ]);
      return { ...s, _stats: { students, staff } };
    }));

    res.json(withStats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/schools — provision a new school.
   Optional `organizationId`: adds the school to an EXISTING organization
   instead of the default (a brand-new 1:1 organization, created
   immediately in this same request — no longer deferred to the next
   server restart's backfill job). When targeting an existing org, the
   school's slug is namespaced under the org's slug (e.g. org `green-
   valley` + campus slug `eldoret` → school slug `green-valley-eldoret`)
   so schools sharing an organization are recognizable by URL. */
router.post('/schools', async (req, res) => {
  try {
    const { name, shortName, slug, plan, adminName, adminEmail, adminPassword, currency, timezone, organizationId } = req.body;
    if (!name || !slug || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: 'name, slug, adminEmail, adminPassword required' });
    }

    const School = _model('schools');
    const Org    = _model('organizations');

    let org = null;
    let finalSlug = _sanitiseSlug(slug);
    if (organizationId) {
      org = await Org.findOne({ id: organizationId }).lean();
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      finalSlug = _deriveSlugForOrg(org.slug, finalSlug);
    }
    if (!finalSlug) return res.status(400).json({ error: 'Could not derive a valid slug' });

    // Check slug uniqueness (on the final, possibly org-prefixed slug)
    const exists = await School.findOne({ slug: finalSlug }).lean();
    if (exists) return res.status(409).json({ error: `Slug '${finalSlug}' is already taken` });

    // Cross-collection check: schools and organizations are separate slug
    // namespaces with no shared uniqueness constraint. Without this, a new
    // school could be provisioned with a slug that collides with an
    // UNRELATED organization's slug — at which point the 1:1-org upsert
    // below (provisionOrganizationForSchool) throws a duplicate-key error
    // that gets silently swallowed, permanently orphaning the school
    // (organizationId stays null forever; the boot backfill retries the
    // same colliding slug on every restart and fails every time). For a
    // 1:1-genesis org, org.slug === school.slug is the deliberate, by-design
    // steady state (provision-organizations.js:61) — this check only
    // guards against an UNRELATED org, so it excludes the org this school
    // is being explicitly attached to, if any.
    const orgSlugClash = await Org.findOne({ slug: finalSlug, id: { $ne: org?.id || null } }).lean();
    if (orgSlugClash) return res.status(409).json({ error: `Slug '${finalSlug}' is already taken by an organization` });

    const schoolId = `sch_${finalSlug}_${Date.now().toString(36)}`;
    const userId   = `u_${finalSlug}_admin`;

    // Use raw collection API to bypass Mongoose's `id` virtual, which would
    // silently strip any field named "id" passed to Model.create().
    const db = mongoose.connection.db;

    // Create school record
    const schoolDoc = {
      id: schoolId, slug: finalSlug, name, shortName: shortName || name,
      plan: plan || process.env.BOOTSTRAP_PLAN || 'base', addOns: [], isActive: true,
      currency: currency || 'KES', timezone: timezone || 'Africa/Nairobi',
      organizationId: org ? org.id : null,
      createdAt: new Date().toISOString()
    };
    const insertResult = await db.collection('schools').insertOne(schoolDoc);
    schoolDoc._id = insertResult.insertedId;

    // Create superadmin user
    const hashed = await bcrypt.hash(adminPassword, 12);
    await db.collection('users').insertOne({
      id: userId, schoolId, name: adminName || adminEmail,
      email: adminEmail.toLowerCase(), password: hashed,
      role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
      isActive: true, createdAt: new Date().toISOString()
    });

    // Seed essential base records (academic year, role_permissions, etc.)
    await _seedBaseData(schoolId);

    // No existing org targeted — create this school's own 1:1 organization
    // now, synchronously, instead of waiting for the next server restart's
    // backfill job (provisionOrganizations()) to pick it up.
    if (!org) {
      try {
        const newOrg = await provisionOrganizationForSchool(schoolDoc, { Schools: School, Orgs: Org });
        if (newOrg) schoolDoc.organizationId = newOrg.id;
      } catch (err) {
        console.error('[platform/schools POST] immediate org provisioning failed (will self-heal at next restart):', err.message);
      }
    }

    res.status(201).json({ school: schoolDoc, adminUserId: userId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/platform/schools/pending — list schools awaiting approval */
router.get('/schools/pending', async (req, res) => {
  try {
    const School = _model('schools');
    const schools = await School.find({ status: 'pending' }).lean();
    res.json(schools);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/platform/organizations — list organizations with their member
   schools and rolled-up plan/status stats. */
router.get('/organizations', async (req, res) => {
  try {
    const Org    = _model('organizations');
    const School = _model('schools');

    const [orgs, schools] = await Promise.all([
      Org.find({}).sort({ createdAt: -1 }).lean(),
      School.find({})
        .select('id _id organizationId name shortName slug plan isActive status trialEnds')
        .lean(),
    ]);

    const schoolsByOrg = {};
    for (const s of schools) {
      const oid = s.organizationId;
      if (!oid) continue;
      (schoolsByOrg[oid] = schoolsByOrg[oid] || []).push({
        id:        s.id || s._id?.toString(),
        name:      s.name,
        shortName: s.shortName,
        slug:      s.slug,
        plan:      s.plan,
        isActive:  s.isActive,
        status:    s.status,
        trialEnds: s.trialEnds,
      });
    }

    const organizations = orgs.map(o => {
      const memberSchools = schoolsByOrg[o.id] || [];
      const byPlan = {};
      memberSchools.forEach(s => {
        const p = s.plan || 'base';
        byPlan[p] = (byPlan[p] || 0) + 1;
      });
      return {
        id:                  o.id,
        name:                o.name,
        slug:                o.slug,
        status:              o.status,
        multiSchoolEnabled:  !!o.multiSchoolEnabled,
        logoUrl:             o.logoUrl || null,
        primaryColor:        o.primaryColor || null,
        tagline:             o.tagline || null,
        createdAt:           o.createdAt,
        schools:             memberSchools,
        _stats: {
          schoolCount: memberSchools.length,
          activeCount: memberSchools.filter(s => s.isActive).length,
          byPlan,
        },
      };
    });

    const unlinkedSchools = schools.filter(s => !s.organizationId).length;

    res.json({ organizations, unlinkedSchools });
  } catch (err) {
    console.error('[platform/organizations GET]', err);
    res.status(500).json({ error: err.message });
  }
});

function _sanitiseSlug(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/\s+/g, '-')       // spaces become hyphens, not dropped
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

/* Namespaces a school's slug under its organization's slug, school first:
   rawSlug 'eldoret' + orgSlug 'green-valley' -> 'eldoret-green-valley'.
   Idempotent — a slug already carrying the suffix isn't double-suffixed. */
function _deriveSlugForOrg(orgSlug, rawSlug) {
  const clean = _sanitiseSlug(rawSlug);
  if (!orgSlug) return clean;
  const suffix = `-${orgSlug}`;
  if (clean.endsWith(suffix)) return clean.substring(0, 60);
  // Truncate the school-specific part, not the org suffix — the suffix
  // must always survive intact so the slug reliably ends with -orgSlug.
  const maxCleanLen = Math.max(1, 60 - suffix.length);
  return `${clean.substring(0, maxCleanLen)}${suffix}`;
}

/* POST /api/platform/organizations — create an organization explicitly.
   multiSchoolEnabled is deliberately never settable here — per
   Constitution §10 Stage 3, that flag means "auth begins reading
   Memberships", a capability that doesn't exist yet (gated behind D-001).
   This route only creates the Organization entity itself — grouping
   schools for admin/reporting visibility, not enabling multi-school
   login or switching. */
router.post('/organizations', async (req, res) => {
  try {
    const { name, slug, logoUrl, primaryColor, tagline } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const finalSlug = _sanitiseSlug(slug || name);
    if (!finalSlug) {
      return res.status(400).json({ error: 'Could not derive a valid slug from the name/slug provided' });
    }

    const Org    = _model('organizations');
    const School = _model('schools');
    const exists = await Org.findOne({ slug: finalSlug }).lean();
    if (exists) {
      return res.status(409).json({ error: `Slug '${finalSlug}' is already taken by another organization` });
    }

    // Cross-collection check: this route creates a standalone organization
    // ahead of attaching any school to it (see header comment) — unlike a
    // 1:1-genesis org, there is no legitimate reason for a freshly created
    // org here to share a slug with an existing school. Prevents the same
    // silent-orphan hazard described in POST /schools's matching check.
    const schoolSlugClash = await School.findOne({ slug: finalSlug }).lean();
    if (schoolSlugClash) {
      return res.status(409).json({ error: `Slug '${finalSlug}' is already taken by a school` });
    }

    const now = new Date().toISOString();
    const org = {
      id:                  `org_${crypto.randomUUID()}`,
      name:                name.trim(),
      slug:                finalSlug,
      status:              'active',
      multiSchoolEnabled:  false,   // opt-in later — platform-admin only (Constitution §10 Stage 3)
      // Branding is optional and additive — org-level fields, distinct from
      // a school's own branding. Not yet consumed by anything (see
      // ADR-0007's future public org-info endpoint); safe to leave null.
      logoUrl:             logoUrl || null,
      primaryColor:        primaryColor || null,
      tagline:             tagline || null,
      createdBy:           'platform-admin',
      createdAt:           now,
      updatedAt:           now,
    };
    await Org.create(org);

    res.status(201).json({ organization: org });
  } catch (err) {
    console.error('[platform/organizations POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* PATCH /api/platform/organizations/:id — rename an organization.
   `slug` is deliberately never accepted here, same reasoning as schools'
   PATCH route: it's fixed at creation time (used in the shared portal URL)
   and stays that way regardless of how the org's display name changes. */
router.patch('/organizations/:id', async (req, res) => {
  try {
    if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const name = req.body.name.trim();

    const Org = _model('organizations');
    const doc = await Org.findOneAndUpdate(
      { id: req.params.id },
      { $set: { name, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: doc });
  } catch (err) {
    console.error('[platform/organizations/:id PATCH]', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── Organization activation toggle (org-shared-slug feature) ──
   Single gate: multiSchoolEnabled. Activates both JWT orgId/membershipId +
   C9 switching, AND the org-slug public login surface (auth.js's
   POST /auth/org-login) — subject also to the platform-global
   IDENTITY_CUTOVER_ENABLED env var, entirely outside this route's
   control. Originally two separate flags (this one plus a since-removed
   orgSlugLoginEnabled requiring it first); collapsed into one after real
   usage showed the split added an activation step without adding real
   safety — see ADR-0007's amendment note for the reasoning. */

async function _findOrgOr404(id, res) {
  const Org = _model('organizations');
  const org = await Org.findOne({ id }).lean();
  if (!org) { res.status(404).json({ error: 'Organization not found' }); return null; }
  return org;
}

/* POST /api/platform/organizations/:id/enable-multi-school
   Includes qa-health.js's identity-migration status in the response,
   called as a direct in-process function (both files run in the same
   server; no new HTTP round trip) purely for platform-admin visibility
   into cutover-readiness — informational only, never a hard block here,
   since IDENTITY_CUTOVER_ENABLED is a platform-global operator lever this
   route has no authority over. */
router.post('/organizations/:id/enable-multi-school', async (req, res) => {
  try {
    const org = await _findOrgOr404(req.params.id, res);
    if (!org) return;

    const Org = _model('organizations');
    const now = new Date().toISOString();
    await Org.updateOne({ id: org.id }, { $set: { multiSchoolEnabled: true, updatedAt: now } });

    let identityMigration = null;
    try {
      // Lazy require: qa-health.js pulls in authMiddleware and other
      // route-level dependencies at module scope. Requiring it eagerly at
      // the top of this file would load all of that into every test/route
      // that merely requires platform.js. Loaded here, on-demand, instead.
      identityMigration = await require('./qa-health')._identityMigrationStatus();
    } catch { /* informational only */ }

    AuditService.log({
      action: 'platform.organization.multi_school_enabled',
      actor:  { userId: 'platform', role: 'platform', email: null },
      schoolId: null,
      target: { type: 'organization', id: org.id, label: org.name },
      details: {},
      req,
    });

    res.json({
      organization: { ...org, multiSchoolEnabled: true, updatedAt: now },
      identityMigration,
      note: 'This activates JWT orgId/membershipId enrichment, the school switcher (C9), and the shared org-slug login page for this organization. The org-slug login page additionally requires the platform-global IDENTITY_CUTOVER_ENABLED environment variable, which this route cannot set or verify — identityMigration above reflects current backfill/cutover readiness for informational purposes only.',
    });
  } catch (err) {
    console.error('[platform/organizations/:id/enable-multi-school POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/platform/organizations/:id/disable-multi-school */
router.post('/organizations/:id/disable-multi-school', async (req, res) => {
  try {
    const org = await _findOrgOr404(req.params.id, res);
    if (!org) return;

    const Org = _model('organizations');
    const now = new Date().toISOString();
    await Org.updateOne({ id: org.id }, { $set: { multiSchoolEnabled: false, updatedAt: now } });

    AuditService.log({
      action: 'platform.organization.multi_school_disabled',
      actor:  { userId: 'platform', role: 'platform', email: null },
      schoolId: null,
      target: { type: 'organization', id: org.id, label: org.name },
      details: {},
      req,
    });

    res.json({ organization: { ...org, multiSchoolEnabled: false, updatedAt: now } });
  } catch (err) {
    console.error('[platform/organizations/:id/disable-multi-school POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/platform/users/search?email=... — cross-school identity search.
   Something /api/users can't do (it's always school-scoped by design).
   Used by the "Link Identity" flow to find an existing person before
   granting them access to a second school. Strips credentials/MFA/token
   fields — this is platform-admin tooling, not a general user lookup. */
router.get('/users/search', async (req, res) => {
  try {
    const email = (req.query.email || '').trim();
    if (!email || email.length < 3) {
      return res.status(400).json({ error: 'email query (min 3 chars) is required' });
    }

    const User    = _model('users');
    const School  = _model('schools');
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(escaped, 'i');

    const users = await User.find({ email: regex }).limit(10).lean();
    const schoolIds = [...new Set(users.map(u => u.schoolId).filter(Boolean))];
    const schools = schoolIds.length
      ? await School.find({ id: { $in: schoolIds } }).select('id name organizationId').lean()
      : [];
    const schoolMap = Object.fromEntries(schools.map(s => [s.id, s]));

    res.json({
      users: users.map(u => {
        const school = u.schoolId ? schoolMap[u.schoolId] : null;
        return {
          id:             u.id || u._id?.toString(),
          name:           u.name || null,
          email:          u.email,
          role:           u.role,
          schoolId:       u.schoolId || null,
          schoolName:     school ? school.name : null,
          organizationId: school ? (school.organizationId || null) : null,
        };
      }),
    });
  } catch (err) {
    console.error('[platform/users/search GET]', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/platform/memberships — grant an existing person access to a
   SECOND school under the SAME organization (Constitution §6 boundary:
   identity is organization-scoped, not platform-global — cross-org linking
   is explicitly out of scope for this phase and is rejected with 409
   rather than silently allowed).

   RECORD-ONLY: this writes to the `memberships` shadow collection but
   makes NO change to auth.js/JWT/sessionService/rbac — the granted user
   still cannot log into the target school with this alone (Constitution
   §10 Stage 3, not yet built). The response's `note` field says so
   explicitly, so the limitation is visible to whoever uses this, not
   just documented in a comment. */
router.post('/memberships', async (req, res) => {
  try {
    const { userId, schoolId, role } = req.body;
    if (!userId || !schoolId) {
      return res.status(400).json({ error: 'userId and schoolId are required' });
    }

    const User        = _model('users');
    const School       = _model('schools');
    const Org          = _model('organizations');
    const Memberships  = _model('memberships');

    const user = await User.findOne({ id: userId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const targetSchool = await School.findOne({ id: schoolId }).lean();
    if (!targetSchool) return res.status(404).json({ error: 'School not found' });

    const currentSchool = user.schoolId ? await School.findOne({ id: user.schoolId }).lean() : null;
    const currentOrgId  = currentSchool ? currentSchool.organizationId : null;
    const targetOrgId   = targetSchool.organizationId;

    if (!currentOrgId || !targetOrgId || currentOrgId !== targetOrgId) {
      return res.status(409).json({
        error: "Cross-organization identity linking is not supported yet — the user's current school and the target school must belong to the same organization.",
      });
    }

    const existing = await Memberships.findOne({ userId, schoolId }).lean();
    if (existing) {
      return res.status(409).json({ error: 'This user already has a membership for that school' });
    }

    const membership = await provisionMembershipForUser(
      { ...user, schoolId, role: role || user.role },
      { Schools: School, Orgs: Org, Memberships, opts: { isPrimary: false, source: 'platform_admin_grant', createdBy: 'platform-admin' } }
    );
    if (!membership) {
      return res.status(500).json({ error: 'Could not create membership' });
    }

    AuditService.log({
      action: 'platform.membership.grant',
      actor:  { userId: 'platform', role: 'platform', email: null },
      schoolId,
      target: { type: 'user', id: userId, label: user.email },
      details: { grantedSchoolId: schoolId, orgId: targetOrgId },
      req,
    });

    res.status(201).json({
      membership,
      note: 'This creates a record only — it does not yet enable the user to log into this school. Login continues to be governed by the school assigned on their account.',
    });
  } catch (err) {
    console.error('[platform/memberships POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/platform/schools/:id/approve — approve a pending school */
router.post('/schools/:id/approve', async (req, res) => {
  try {
    const School = _model('schools');
    // Not tenantModel(): userQuery below OR-s schoolId with an email fallback
    // for accounts whose schoolId is missing/mismatched — the exact case
    // /orphans exists to clean up. Forcing tenantModel()'s injected
    // schoolId as a top-level AND condition would defeat that fallback for
    // precisely the broken records this route needs to still recover.
    const User   = _model('users');

    /* Find by MongoDB _id — always reliable regardless of custom id field */
    const school = await School.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: true, status: 'active', approvedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    /* Locate the superadmin: try schoolId (custom id field) first, fall back to email */
    const userQuery = { role: 'superadmin',
      $or: [
        ...(school.id  ? [{ schoolId: school.id }]         : []),
        ...(school.adminEmail ? [{ email: school.adminEmail }] : []),
      ]
    };
    const adminUser    = await User.findOne(userQuery).lean();
    const tempPassword = adminUser?.tempPassword || null;

    /* Activate superadmin(s) and clear stored temp password */
    await User.updateMany(userQuery,
      { $set: { isActive: true }, $unset: { tempPassword: '' } }
    );

    /* Send emails — include login credentials in the welcome email */
    await Promise.all([
      email.sendApprovalWelcome({
        adminName:    school.adminName || school.name,
        adminEmail:   school.adminEmail,
        schoolName:   school.name,
        slug:         school.slug,
        plan:         school.plan,
        tempPassword,
      }),
      email.sendAdminApprovalAlert({
        schoolName: school.name,
        adminEmail: school.adminEmail,
        plan:       school.plan
      })
    ]);

    console.log(`[PLATFORM] Approved school: ${school.name} (credentials emailed)`);
    res.json({ success: true, school });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/schools/:id/reject — reject a pending school */
router.post('/schools/:id/reject', async (req, res) => {
  try {
    const School = _model('schools');
    const { reason } = req.body;

    const school = await School.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'rejected', isActive: false, rejectedAt: new Date().toISOString(), rejectionReason: reason || '' } },
      { new: true }
    ).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    await email.sendRejectionEmail({
      adminName:  school.adminName || school.name,
      adminEmail: school.adminEmail,
      schoolName: school.name,
      reason
    });

    console.log(`[PLATFORM] Rejected school: ${school.name}`);
    res.json({ success: true, school });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PATCH /api/platform/schools/:id — update name/plan/addOns/status
   Accepts either MongoDB _id (ObjectId) or custom id string (sch_slug_ts).
   `slug` is deliberately never accepted here — it's fixed at provisioning
   time (used in URLs, tenant resolution, etc.) and stays that way. */
router.patch('/schools/:id', async (req, res) => {
  try {
    const School = _model('schools');
    const update = {};
    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      update.name = name;
    }
    if (req.body.plan)     update.plan     = req.body.plan;
    if (req.body.addOns)   update.addOns   = req.body.addOns;
    if (typeof req.body.isActive === 'boolean') update.isActive = req.body.isActive;
    if (req.body.planExpiry) update.planExpiry = req.body.planExpiry;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Support both MongoDB _id (ObjectId string) and custom id field (sch_...)
    const rid = req.params.id;
    const query = mongoose.isValidObjectId(rid)
      ? { $or: [{ _id: rid }, { id: rid }] }
      : { id: rid };

    const doc = await School.findOneAndUpdate(query, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'School not found' });
    // Bust plan cache immediately so active sessions see the new plan right away
    if (update.plan && doc.id) invalidatePlanCache(doc.id);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function _findSchoolQuery(rid) {
  return mongoose.isValidObjectId(rid)
    ? { $or: [{ _id: rid }, { id: rid }] }
    : { id: rid };
}

/* GET /api/platform/schools/:id/entitlements — list all entitlements
   (active + revoked) for a school, for audit visibility. Independent of
   plan tier — see PLATFORM_ARCHITECTURE_EVOLUTION_v1.md §8. */
router.get('/schools/:id/entitlements', async (req, res) => {
  try {
    const School       = _model('schools');
    const Entitlements = _model('entitlements');

    const school = await School.findOne(_findSchoolQuery(req.params.id)).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    const schoolId     = school.id || school._id.toString();
    const entitlements = await Entitlements.find({ schoolId }).sort({ createdAt: -1 }).lean();

    res.json({ entitlements });
  } catch (err) {
    console.error('[platform/schools/:id/entitlements GET]', err);
    res.status(500).json({ error: err.message });
  }
});

const _ENTITLEMENT_KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

/* POST /api/platform/schools/:id/entitlements — grant a capability to a
   school, independent of its plan tier (PLATFORM_ARCHITECTURE_EVOLUTION_v1.md
   §8: "plans and features must never be coupled"). Consulted by
   plan.js's planGate() as an additive override — see ADR-0004
   (dependency graph C10): it only ever grants access beyond what the
   school's plan tier already provides, never suppresses it. Upserts on
   {schoolId,key}: granting an already-revoked key re-activates the same
   doc (audit trail preserved) instead of creating a duplicate. */
router.post('/schools/:id/entitlements', async (req, res) => {
  try {
    const { key, notes, expiresAt } = req.body;
    if (!key || !_ENTITLEMENT_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'key is required and must be a lowercase slug (letters, digits, underscores, starting with a letter)' });
    }

    const School       = _model('schools');
    const Entitlements = _model('entitlements');

    const school = await School.findOne(_findSchoolQuery(req.params.id)).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    const schoolId = school.id || school._id.toString();
    const now      = new Date().toISOString();

    const entitlement = await Entitlements.findOneAndUpdate(
      { schoolId, key },
      {
        $setOnInsert: {
          id:        `ent_${crypto.randomUUID()}`,
          schoolId,
          key,
          source:    'platform_grant',
          createdAt: now,
        },
        $set: {
          status:    'active',
          notes:     notes || null,
          expiresAt: expiresAt || null,
          grantedBy: 'platform-admin',
          updatedAt: now,
        },
      },
      { upsert: true, new: true }
    ).lean();

    AuditService.log({
      action: 'platform.entitlement.grant',
      actor:  { userId: 'platform', role: 'platform', email: null },
      schoolId,
      target: { type: 'school', id: schoolId, label: school.name },
      details: { key, expiresAt: expiresAt || null },
      req,
    });

    res.status(201).json({
      entitlement,
      note: "This entitlement is consulted by plan.js's planGate() as an override when the school's plan tier alone would deny the feature. It never suppresses access the plan already grants.",
    });
  } catch (err) {
    console.error('[platform/schools/:id/entitlements POST]', err);
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/platform/schools/:id/entitlements/:key — revoke a
   capability. Soft: sets status:'revoked', never deletes the doc, so
   the grant history stays auditable. */
router.delete('/schools/:id/entitlements/:key', async (req, res) => {
  try {
    const School       = _model('schools');
    const Entitlements = _model('entitlements');

    const school = await School.findOne(_findSchoolQuery(req.params.id)).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    const schoolId = school.id || school._id.toString();
    const key      = req.params.key;

    const existing = await Entitlements.findOne({ schoolId, key }).lean();
    if (!existing) return res.status(404).json({ error: 'No entitlement found for that key' });

    const now = new Date().toISOString();
    await Entitlements.updateOne({ schoolId, key }, { $set: { status: 'revoked', updatedAt: now } });

    AuditService.log({
      action: 'platform.entitlement.revoke',
      actor:  { userId: 'platform', role: 'platform', email: null },
      schoolId,
      target: { type: 'school', id: schoolId, label: school.name },
      details: { key },
      req,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[platform/schools/:id/entitlements DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/platform/schools/:id/impersonate — get a JWT for any school's superadmin */
router.post('/schools/:id/impersonate', async (req, res) => {
  /* Gate: disabled in production unless ALLOW_IMPERSONATION=true is explicitly set */
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_IMPERSONATION !== 'true') {
    return res.status(403).json({ error: 'Impersonation is disabled in production. Set ALLOW_IMPERSONATION=true to enable.' });
  }

  try {
    const School   = _model('schools');
    // Not tenantModel(): same email-fallback reasoning as /approve above —
    // this route exists partly to recover superadmin access for schools
    // whose admin user has a missing/mismatched schoolId.
    const User     = _model('users');

    /* Support both MongoDB _id and custom id string */
    const rid = req.params.id;
    const schoolQuery = mongoose.isValidObjectId(rid)
      ? { $or: [{ _id: rid }, { id: rid }] }
      : { id: rid };

    const school = await School.findOne(schoolQuery).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    /* Try by custom schoolId field (if stored), then fall back to admin email */
    const userQuery = { role: 'superadmin',
      $or: [
        ...(school.id         ? [{ schoolId: school.id }]         : []),
        ...(school.adminEmail ? [{ email: school.adminEmail }]     : []),
      ]
    };
    const admin = await User.findOne(userQuery).lean();
    if (!admin) return res.status(404).json({ error: 'No superadmin found for this school' });

    /* Use the schoolId stored on the user — it's what the app already knows */
    const resolvedSchoolId = admin.schoolId || school.id || req.params.id;
    const token = sign({
      userId:      admin.id,
      schoolId:    resolvedSchoolId,
      email:       admin.email,
      role:        'superadmin',
      roles:       ['superadmin'],
      schoolName:  school.name,
      impersonated: true
    });

    AuditService.log({ action: 'platform.impersonate', actor: { userId: 'platform', role: 'platform', email: null }, schoolId: resolvedSchoolId, target: { type: 'school', id: resolvedSchoolId, label: school.name }, details: { targetEmail: admin.email }, req });

    /* Set HttpOnly cookie so the React SPA's authMiddleware accepts subsequent requests */
    res.cookie('token', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   8 * 60 * 60 * 1000,
    });

    /* Merge schoolName into the user object so the React SPA sidebar can display it.
       Also return the full school doc — mirrors /api/auth/login's `school: req.school`
       shape exactly — so the client's session has real plan/branding/moduleConfig
       instead of silently falling back to hardcoded defaults (e.g. TopBar's plan
       badge falling all the way through to the literal 'core' fallback). */
    res.json({
      token,
      user: {
        ...admin,
        password:   undefined,
        schoolName: school.name,
        schoolId:   resolvedSchoolId,
      },
      school,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* All tenant-scoped collections to wipe when a school is deleted.
   Keep in sync with BACKUP_COLLECTIONS in backup.js and ALLOWED in collections.js. */
const TENANT_COLS = [
  // Core
  'users','students','teachers','classes','subjects',
  'academic_years','sections','role_permissions','admissions',
  'events','messages','notifications','announcements',

  // Timetable & structure
  'timetable','bell_schedule','rooms','departments',
  'class_subjects','student_subjects','subject_rules','teaching_assignments',

  // Attendance & behaviour
  'attendance',
  'behaviour_incidents','behaviour_appeals','behaviour_categories',
  'merit_milestones','demerit_stages','detention_types','houses','key_stages',

  // Finance
  'invoices','payments','fee_structures',

  // Grades, exams & report cards
  'grades','exams','exam_results',
  'assessment_marks','assessment_config','grade_boundaries',
  'report_card_snapshots','publish_batches',
  'mark_audit_log','mark_submissions','exam_series',

  // Curriculum / lessons
  'lesson_coverage','syllabus_topics',

  // Growth / co-curricular portfolio
  'growth_projects','growth_leadership','growth_activities',
  'growth_service','growth_awards','growth_recommendations','growth_aspirations',

  // Library, hostel, transport
  'library_books','library_loans',
  'hostels','hostel_rooms','hostel_assignments',
  'transport_routes','transport_assignments',

  // HR
  'leave_requests','payroll',

  // E-learning
  'elearning_tokens','elearning_course_links',
  'elearning_coursework_links','elearning_sessions',

  // Billing & misc
  'billing_snapshots','comment_banks',
  'user_photos',
];

/**
 * Build a mongo $or query that matches tenant docs for a school using
 * THREE strategies so orphaned docs are never left behind:
 *   1. school.id          — the custom "sch_slug_timestamp" string stored as id field
 *   2. school._id.toString() — the MongoDB ObjectId as string (used by some docs)
 *   3. school.adminEmail  — used directly on the users collection as final fallback
 */
function _tenantQuery(school) {
  const clauses = [];
  // Strategy 1 — custom id field (primary FK used by onboard.js)
  if (school.id && typeof school.id === 'string' && school.id.startsWith('sch_')) {
    clauses.push({ schoolId: school.id });
  }
  // Strategy 2 — ObjectId string (some older docs may use this)
  const monIdStr = school._id?.toString();
  if (monIdStr) clauses.push({ schoolId: monIdStr });

  return clauses.length ? { $or: clauses } : null;
}

/* DELETE /api/platform/schools/all — wipe all non-demo schools */
router.delete('/schools/all', async (req, res) => {
  try {
    const School     = _model('schools');
    const DEMO_SLUGS = ['msingi', 'demo'];

    const toPurge    = await School.find({ slug: { $nin: DEMO_SLUGS } }).lean();
    const schoolMonIds = toPurge.map(s => s._id);

    /* Collect every adminEmail for a guaranteed user cleanup */
    const adminEmails = toPurge.map(s => s.adminEmail).filter(Boolean);

    /* Build one combined $or query covering all schools' tenant IDs */
    const allTenantClauses = toPurge.flatMap(s => {
      const q = _tenantQuery(s);
      return q ? q.$or : [];
    });

    const tenantFilter = allTenantClauses.length ? { $or: allTenantClauses } : null;

    const ops = [School.deleteMany({ _id: { $in: schoolMonIds } })];

    // Not tenantModel(): tenantFilter is a combined $or across MULTIPLE
    // schools' tenant IDs at once (a bulk multi-tenant wipe) — tenantModel()
    // is single-schoolId-per-call by design and would have to run once per
    // school per collection, changing this from one deleteMany to N; left
    // as a reviewed direct-access exception for this destructive,
    // superadmin-only reset operation.
    if (tenantFilter) {
      TENANT_COLS.forEach(col => ops.push(_model(col).deleteMany(tenantFilter)));
    }

    /* Always delete users by adminEmail — this is the guaranteed fallback
       that prevents email addresses from being "remembered" after a wipe */
    if (adminEmails.length) {
      ops.push(_model('users').deleteMany({ email: { $in: adminEmails } }));
    }

    await Promise.all(ops);

    console.log(`[PLATFORM] Wiped ${toPurge.length} school(s) and all tenant data`);
    res.json({ success: true, deleted: toPurge.length });
  } catch (err) {
    console.error('[PLATFORM] Wipe error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/platform/schools/:id — delete one school and all its data */
router.delete('/schools/:id', async (req, res) => {
  try {
    const School = _model('schools');
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: 'School not found' });

    // Guard: the demo school is permanent and cannot be deleted
    if (school.slug === 'demo' || school.id === 'sch_demo') {
      return res.status(403).json({ error: 'The demo school cannot be deleted. It is required for platform demonstrations.' });
    }

    const tenantFilter = _tenantQuery(school);
    const adminEmail   = school.adminEmail;

    const ops = [School.findByIdAndDelete(req.params.id)];

    // Not tenantModel(): tenantFilter is a $or across this school's TWO id
    // forms (custom sch_ id and raw ObjectId string — see the dual-ID-forms
    // pattern used throughout this codebase). tenantModel()'s scoped-filter
    // only recognizes a top-level schoolId key; it would AND-inject
    // {schoolId: school.id} onto this filter and silently make the
    // _id.toString() branch of the $or unreachable, leaving legacy-form
    // tenant docs behind on delete.
    if (tenantFilter) {
      TENANT_COLS.forEach(col => ops.push(_model(col).deleteMany(tenantFilter)));
    }

    /* Always delete the user by email — catches orphaned accounts even if
       schoolId matching fails due to Mongoose virtual id conflict.
       Not tenantModel(): deliberately NOT schoolId-scoped, same orphan-
       catching reasoning as /approve and /impersonate above. */
    if (adminEmail) {
      ops.push(_model('users').deleteMany({ email: adminEmail }));
    }

    await Promise.all(ops);

    console.log(`[PLATFORM] Deleted school: ${school.name} (${school.slug})`);
    res.json({ success: true, name: school.name });
  } catch (err) {
    console.error('[PLATFORM] Delete school error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/platform/billing/all — all billing snapshots (platform admin) */
router.get('/billing/all', async (req, res) => {
  try {
    // Not tenantModel() — deliberately platform-wide, same as billing.js's
    // own GET /all superadmin view.
    const Snapshot = _model('billing_snapshots');
    const School   = _model('schools');

    const snapshots = await Snapshot.find({})
      .sort({ generatedAt: -1 })
      .limit(500)
      .lean();

    const schoolIds = [...new Set(snapshots.map(s => s.schoolId))];
    const schools   = await School.find({ id: { $in: schoolIds } }).select('id name slug').lean();
    const schoolMap = Object.fromEntries(schools.map(s => [s.id, s]));

    const enriched = snapshots.map(s => ({
      ...s,
      schoolName: schoolMap[s.schoolId]?.name ?? s.schoolId,
      schoolSlug: schoolMap[s.schoolId]?.slug ?? '',
    }));

    return res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('[platform GET /billing/all]', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load billing data' } });
  }
});

/* GET /api/platform/stats — MRR, school counts, plan breakdown */
router.get('/stats', async (req, res) => {
  try {
    // Not tenantModel() — deliberately platform-wide aggregate stats
    // (total students, MRR) across every school.
    const School   = _model('schools');
    const Student  = _model('students');
    const Snapshot = _model('billing_snapshots');

    const [allSchools, totalStudents, recentSnapshots] = await Promise.all([
      School.find({}).select('plan isActive id').lean(),
      Student.countDocuments({ status: 'active' }),
      // Most recent billing snapshot per school — actual invoiced amounts
      Snapshot.find({ status: { $ne: 'cancelled' } })
        .sort({ generatedAt: -1 })
        .limit(500)
        .lean(),
    ]);

    // MRR = latest termly invoice per school ÷ 4 months (one term ≈ 4 months)
    const latestBySchool = {};
    recentSnapshots.forEach(s => {
      if (!latestBySchool[s.schoolId]) latestBySchool[s.schoolId] = s;
    });
    const mrr = Object.values(latestBySchool).reduce((sum, s) => {
      return sum + Math.round((s.totalAmount || 0) / 4);
    }, 0);

    const byPlan = {};
    allSchools.forEach(s => {
      const plan = s.plan || 'base';
      if (!byPlan[plan]) byPlan[plan] = 0;
      byPlan[plan]++;
    });

    res.json({
      totalSchools:  allSchools.length,
      activeSchools: allSchools.filter(s => s.isActive).length,
      totalStudents,
      mrr,
      byPlan,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Base data seed for new schools ─── */
async function _seedBaseData(schoolId) {
  const AY    = tenantModel('academic_years', { schoolId });
  const Perm  = tenantModel('role_permissions', { schoolId });
  const Sec   = tenantModel('sections', { schoolId });

  const ayId  = `ay_${schoolId}_2025`;
  await AY.updateOne({ id: ayId }, { $set: {
    id: ayId, schoolId, name: '2025-2026', isCurrent: true,
    startDate: '2025-09-01', endDate: '2026-07-31',
    terms: [
      { id: `t1_${schoolId}`, name: 'Term 1', startDate: '2025-09-01', endDate: '2025-12-15', isCurrent: false },
      { id: `t2_${schoolId}`, name: 'Term 2', startDate: '2026-01-08', endDate: '2026-04-10', isCurrent: true },
      { id: `t3_${schoolId}`, name: 'Term 3', startDate: '2026-04-27', endDate: '2026-07-11', isCurrent: false },
    ]
  }}, { upsert: true });

  // Default sections
  const secs = [
    { id:`sec_kg_${schoolId}`,  name:'KG',        code:'KG',  order:1 },
    { id:`sec_pri_${schoolId}`, name:'Primary',   code:'PRI', order:2 },
    { id:`sec_sec_${schoolId}`, name:'Secondary', code:'SEC', order:3 },
    { id:`sec_al_${schoolId}`,  name:'A-Level',   code:'AL',  order:4 },
  ];
  await Promise.all(secs.map(s => Sec.updateOne({ id: s.id }, { $set: { ...s, schoolId } }, { upsert: true })));

  // Default role permissions — seeded for every new school
  const ALL_ACTIONS = ['read', 'create', 'update', 'delete'];
  const RW  = ['read', 'create', 'update'];
  const R   = ['read'];

  const ALL_MODULES = [
    'students','teachers','staff','users','classes','sections',
    'attendance','grades','exams','timetable','subjects',
    'finance','hr','admissions','behaviour','messages','events',
    'reports','announcements','settings','academic_years','role_permissions'
  ];

  // Helper: build full-access permissions object
  function _allPerms() {
    return Object.fromEntries(ALL_MODULES.map(m => [m, ALL_ACTIONS]));
  }

  const roleDefaults = [
    {
      roleKey: 'superadmin',
      permissions: _allPerms(),
    },
    {
      roleKey: 'admin',
      permissions: _allPerms(),
    },
    {
      roleKey: 'teacher',
      permissions: {
        students:   R,
        attendance: RW,
        grades:     RW,
        exams:      R,
        timetable:  R,
        subjects:   R,
        classes:    R,
        messages:   RW,
        events:     R,
        reports:    R,
        announcements: R,
      },
    },
    {
      roleKey: 'section_head',
      permissions: {
        students:   R,
        teachers:   R,
        attendance: RW,
        grades:     RW,
        exams:      RW,
        timetable:  RW,
        subjects:   R,
        classes:    RW,
        messages:   RW,
        events:     RW,
        reports:    R,
        announcements: R,
      },
    },
    {
      roleKey: 'deputy_principal',
      permissions: {
        students:   [...R, 'update'],
        teachers:   R,
        staff:      R,
        attendance: RW,
        grades:     R,
        exams:      RW,
        timetable:  RW,
        subjects:   RW,
        classes:    RW,
        behaviour:  RW,
        messages:   RW,
        events:     RW,
        reports:    R,
        announcements: RW,
        sections:   R,
      },
    },
    {
      roleKey: 'finance',
      permissions: {
        finance:    ALL_ACTIONS,
        students:   R,
        staff:      R,
        reports:    R,
        messages:   RW,
        events:     R,
        announcements: R,
      },
    },
    {
      roleKey: 'hr',
      permissions: {
        hr:         ALL_ACTIONS,
        staff:      RW,
        teachers:   R,
        users:      R,
        messages:   RW,
        events:     R,
        reports:    R,
        announcements: R,
      },
    },
    {
      roleKey: 'admissions_officer',
      permissions: {
        admissions: ALL_ACTIONS,
        students:   RW,
        classes:    R,
        sections:   R,
        messages:   RW,
        events:     R,
        announcements: R,
      },
    },
    {
      roleKey: 'discipline_committee',
      permissions: {
        students:   R,
        behaviour:  RW,
        attendance: R,
        messages:   RW,
        events:     R,
        announcements: R,
      },
    },
    {
      roleKey: 'parent',
      permissions: {
        grades:     R,
        attendance: R,
        timetable:  R,
        messages:   RW,
        events:     R,
        announcements: R,
      },
    },
    {
      roleKey: 'student',
      permissions: {
        grades:     R,
        attendance: R,
        timetable:  R,
        exams:      R,
        subjects:   R,
        messages:   RW,
        events:     R,
        announcements: R,
      },
    },
  ];

  await Promise.all(roleDefaults.map(({ roleKey, permissions }) =>
    Perm.updateOne(
      { schoolId, roleKey },
      { $set: { schoolId, roleKey, permissions } },
      { upsert: true }
    )
  ));
}

/* ════════════════════════════════════════════════════════════
   SYSTEM ANNOUNCEMENTS — Platform admin creates global notices
   visible on all school dashboards and sent via email
   ════════════════════════════════════════════════════════════ */

function _annId() {
  return 'ann_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* GET /api/platform/announcements — list all announcements */
router.get('/announcements', async (req, res) => {
  try {
    const Ann = _model('system_announcements');
    const list = await Ann.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/announcements — create a system announcement
   Body: { title, description, type, scheduledAt, affectsAt, expiresAt, notifyAll }
   type: 'maintenance' | 'update' | 'security' | 'info'
*/
router.post('/announcements', async (req, res) => {
  try {
    const { title, description, type, scheduledAt, affectsAt, expiresAt, notifyAll } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'title and description required' });

    const Ann    = _model('system_announcements');
    const School = _model('schools');
    const now    = new Date().toISOString();

    const ann = await Ann.create({
      id:           _annId(),
      title,
      description,
      type:         type || 'info',
      scheduledAt:  scheduledAt || null,
      affectsAt:    affectsAt   || null,
      expiresAt:    expiresAt   || null,
      createdAt:    now,
      status:       'active',
      dismissedBy:  [],
      notifiedCount: 0
    });

    /* Email all school admins if requested */
    if (notifyAll) {
      const schools = await School.find({ isActive: true, adminEmail: { $exists: true, $ne: '' } }).lean();
      let sent = 0;

      for (const school of schools) {
        if (!school.adminEmail) continue;
        await email.sendSystemUpdateNotice({
          adminName:   school.adminName || school.name,
          adminEmail:  school.adminEmail,
          schoolName:  school.name,
          title,
          description,
          type:        type || 'info',
          scheduledAt: scheduledAt || null,
          affectsAt:   affectsAt   || null
        }).catch(err => console.error(`[ANNOUNCE email] ${school.adminEmail}:`, err.message));
        sent++;
      }

      await Ann.updateOne({ id: ann.id }, { notifiedCount: sent });
      console.log(`[ANNOUNCE] Created "${title}", emailed ${sent} schools`);
    }

    res.status(201).json(ann.toObject());
  } catch (err) {
    console.error('[announcements/create]', err);
    res.status(500).json({ error: err.message });
  }
});

/* PATCH /api/platform/announcements/:id — update status (cancel/complete/reactivate) */
router.patch('/announcements/:id', async (req, res) => {
  try {
    const Ann  = _model('system_announcements');
    const update = {};
    if (req.body.status)      update.status      = req.body.status;
    if (req.body.title)       update.title       = req.body.title;
    if (req.body.description) update.description = req.body.description;
    if (req.body.expiresAt)   update.expiresAt   = req.body.expiresAt;

    const doc = await Ann.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Announcement not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/platform/announcements/:id */
router.delete('/announcements/:id', async (req, res) => {
  try {
    const Ann = _model('system_announcements');
    await Ann.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/platform/orphans — purge user accounts with no matching school
   Fixes emails that remain "remembered" after a wipe due to the Mongoose id virtual conflict */
router.delete('/orphans', async (req, res) => {
  try {
    const School = _model('schools');
    // Not tenantModel() — this route's entire purpose is finding superadmin
    // accounts across ALL schools whose email/schoolId no longer matches
    // any existing school. Tenant-scoping it would defeat the search.
    const User   = _model('users');

    /* Get all active school adminEmails and custom schoolIds */
    const allSchools  = await School.find({}).lean();
    const activeEmails   = new Set(allSchools.map(s => s.adminEmail).filter(Boolean));
    const activeSchoolIds = new Set(allSchools.map(s => s.id).filter(Boolean));

    /* Find users who are superadmins but whose school no longer exists */
    const orphanedUsers = await User.find({ role: 'superadmin' }).lean();
    const toDelete = orphanedUsers.filter(u => {
      const emailOrphaned   = u.email   && !activeEmails.has(u.email);
      const schoolOrphaned  = u.schoolId && !activeSchoolIds.has(u.schoolId);
      return emailOrphaned || schoolOrphaned;
    });

    if (toDelete.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No orphaned users found' });
    }

    const orphanIds = toDelete.map(u => u._id);
    await User.deleteMany({ _id: { $in: orphanIds } });

    console.log(`[PLATFORM] Purged ${toDelete.length} orphaned user(s):`, toDelete.map(u => u.email));
    res.json({ success: true, deleted: toDelete.length, emails: toDelete.map(u => u.email) });
  } catch (err) {
    console.error('[PLATFORM] Orphan cleanup error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/platform/test-email — verify SMTP is working (sends a test email to PLATFORM_EMAIL) */
router.get('/test-email', async (req, res) => {
  const smtpUser    = process.env.SMTP_USER;
  const smtpPass    = process.env.SMTP_PASS;
  const platformAddr = process.env.PLATFORM_EMAIL || smtpUser;
  const appUrl      = process.env.APP_URL || '(not set)';

  const config = {
    SMTP_USER:      smtpUser     ? `${smtpUser.slice(0, 4)}***` : '❌ NOT SET',
    SMTP_PASS:      smtpPass     ? '*** (set)'                   : '❌ NOT SET',
    PLATFORM_EMAIL: platformAddr ? platformAddr                   : '❌ NOT SET',
    APP_URL:        appUrl,
    smtpReady:      !!(smtpUser && smtpPass),
  };

  if (!config.smtpReady) {
    return res.status(503).json({
      success: false,
      config,
      error: 'SMTP_USER and SMTP_PASS environment variables are not set. Add them in Render dashboard → Environment.',
    });
  }

  const sent = await email.sendAdminNewSchoolAlert({
    schoolName: 'TEST SCHOOL (diagnostic)',
    slug:       'test',
    adminName:  'Platform Admin',
    adminEmail: platformAddr,
    plan:       'core',
    country:    'KE', city: 'Nairobi',
    curriculum: ['CBC'], sections: ['primary'],
  });

  res.json({
    success: sent,
    config,
    message: sent
      ? `✅ Test email sent successfully to ${platformAddr}`
      : `❌ Email send failed — check Render logs for SMTP error details`,
  });
});

/* ── Platform Settings — manage branding, socials, contact info ─ */

/* PUT /api/platform/settings — update platform-level settings */
router.put('/settings', async (req, res) => {
  try {
    const {
      platformName, tagline, logoUrl, faviconUrl, primaryColor,
      contactEmail, contactPhone,
      socialLinks,  // { twitter, linkedin, facebook, instagram, youtube, whatsapp }
    } = req.body;

    const Settings = _model('platform_settings');

    const update = { updatedAt: new Date().toISOString() };
    if (platformName  !== undefined) update.platformName  = String(platformName).trim().slice(0, 100);
    if (tagline       !== undefined) update.tagline       = String(tagline).trim().slice(0, 300);
    if (logoUrl       !== undefined) update.logoUrl       = logoUrl ? String(logoUrl).trim() : null;
    if (faviconUrl    !== undefined) update.faviconUrl    = faviconUrl ? String(faviconUrl).trim() : null;
    if (primaryColor  !== undefined) update.primaryColor  = /^#[0-9a-f]{6}$/i.test(primaryColor) ? primaryColor : '#4f46e5';
    if (contactEmail  !== undefined) update.contactEmail  = String(contactEmail).trim().slice(0, 200);
    if (contactPhone  !== undefined) update.contactPhone  = String(contactPhone).trim().slice(0, 50);
    if (socialLinks   !== undefined && typeof socialLinks === 'object') {
      update.socialLinks = {
        twitter:   socialLinks.twitter   ? String(socialLinks.twitter).trim()   : '',
        linkedin:  socialLinks.linkedin  ? String(socialLinks.linkedin).trim()  : '',
        facebook:  socialLinks.facebook  ? String(socialLinks.facebook).trim()  : '',
        instagram: socialLinks.instagram ? String(socialLinks.instagram).trim() : '',
        youtube:   socialLinks.youtube   ? String(socialLinks.youtube).trim()   : '',
        whatsapp:  socialLinks.whatsapp  ? String(socialLinks.whatsapp).trim()  : '',
      };
    }

    const doc = await Settings.findOneAndUpdate(
      { id: 'global' },
      { $set: { id: 'global', ...update } },
      { upsert: true, new: true }
    ).lean();

    console.log('[PLATFORM] Settings updated');
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[platform/settings PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── Platform branding asset upload (logo/favicon) ──────────────
   Mirrors settings.js's PUT /school/logo pattern exactly — a school
   already uploads its own logo this way (base64 stored directly on its
   own doc, served back via a public binary-serving GET route) — same
   shape here, on the single global platform_settings doc instead of a
   school doc. No new file-storage infra (S3, multer-to-disk, etc.):
   base64-in-Mongo is what the already-shipped school-side feature uses,
   and a 500KB cap keeps that cheap. Replaces the old plain-URL text
   fields, which only ever accepted a real direct image URL — a pasted
   Google Drive "file" share link is an HTML viewer page, never a raw
   image, so it silently rendered nothing no matter what the rest of
   this feature did. */
function _validateBase64Image(b64, maxKB) {
  if (!/^data:image\/(jpeg|jpg|png|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/.test(b64)) {
    return 'Invalid image. Use JPEG, PNG, WebP, GIF, SVG, or ICO.';
  }
  const data = b64.split(',')[1] || '';
  const sizeBytes = Math.ceil(data.length * 0.75);
  if (sizeBytes > maxKB * 1024) {
    return `Image too large. Maximum size is ${maxKB} KB.`;
  }
  return null;
}

/* PUT /api/platform/settings/logo */
router.put('/settings/logo', async (req, res) => {
  try {
    const { logoBase64 } = req.body;
    if (!logoBase64) return res.status(400).json({ error: 'logoBase64 is required.' });
    const err = _validateBase64Image(logoBase64, 500);
    if (err) return res.status(400).json({ error: err });

    const Settings = _model('platform_settings');
    const logoUrl  = '/api/public/platform-asset/logo';
    const now      = new Date().toISOString();
    await Settings.updateOne(
      { id: 'global' },
      { $set: { id: 'global', logoBase64, logoUrl, updatedAt: now } },
      { upsert: true }
    );
    res.json({ success: true, logoUrl });
  } catch (err) {
    console.error('[platform/settings/logo PUT]', err);
    res.status(500).json({ error: 'Failed to upload logo.' });
  }
});

/* DELETE /api/platform/settings/logo — revert to the default wordmark */
router.delete('/settings/logo', async (req, res) => {
  try {
    const Settings = _model('platform_settings');
    await Settings.updateOne(
      { id: 'global' },
      { $set: { logoUrl: null, updatedAt: new Date().toISOString() }, $unset: { logoBase64: '' } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[platform/settings/logo DELETE]', err);
    res.status(500).json({ error: 'Failed to remove logo.' });
  }
});

/* PUT /api/platform/settings/favicon */
router.put('/settings/favicon', async (req, res) => {
  try {
    const { faviconBase64 } = req.body;
    if (!faviconBase64) return res.status(400).json({ error: 'faviconBase64 is required.' });
    const err = _validateBase64Image(faviconBase64, 100);
    if (err) return res.status(400).json({ error: err });

    const Settings   = _model('platform_settings');
    const faviconUrl = '/api/public/platform-asset/favicon';
    const now        = new Date().toISOString();
    await Settings.updateOne(
      { id: 'global' },
      { $set: { id: 'global', faviconBase64, faviconUrl, updatedAt: now } },
      { upsert: true }
    );
    res.json({ success: true, faviconUrl });
  } catch (err) {
    console.error('[platform/settings/favicon PUT]', err);
    res.status(500).json({ error: 'Failed to upload favicon.' });
  }
});

/* DELETE /api/platform/settings/favicon — revert to the default favicon */
router.delete('/settings/favicon', async (req, res) => {
  try {
    const Settings = _model('platform_settings');
    await Settings.updateOne(
      { id: 'global' },
      { $set: { faviconUrl: null, updatedAt: new Date().toISOString() }, $unset: { faviconBase64: '' } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[platform/settings/favicon DELETE]', err);
    res.status(500).json({ error: 'Failed to remove favicon.' });
  }
});

/* ── School-side dismiss (uses platform router via /api/platform/announcements/:id/dismiss)
   But schools need JWT auth, not platform key. So we expose a separate public endpoint
   in the main collections route instead. Dismiss is tracked as schoolId in dismissedBy[].
   We handle this via a special route here with a loose auth fallback: ── */

/* ══════════════════════════════════════════════════════════════
   LANDING PAGE CMS
   GET  /api/platform/landing-content  — public (registered before platformAdmin above)
   PUT  /api/platform/landing-content  — platform admin key required, partial merge
   ══════════════════════════════════════════════════════════════ */

/* Platform-admin PUT — partial merge update */
router.put('/landing-content', async (req, res) => {
  try {
    const { section, data } = req.body;
    if (!section || !data) {
      return res.status(400).json({ success: false, error: 'section and data are required.' });
    }

    const ALLOWED_SECTIONS = ['hero', 'conviction', 'ecosystem', 'showcase', 'trust', 'footer', 'seo'];
    if (!ALLOWED_SECTIONS.includes(section)) {
      return res.status(400).json({ success: false, error: `Unknown section: ${section}. Allowed: ${ALLOWED_SECTIONS.join(', ')}` });
    }

    const LC  = _model('landing_content');
    const now = new Date().toISOString();

    await LC.findOneAndUpdate(
      { id: 'global' },
      { $set: { [`content.${section}`]: data, updatedAt: now } },
      { upsert: true, new: true }
    );

    console.log(`[platform/landing-content] Section '${section}' updated`);
    return res.json({ success: true, section, updatedAt: now });
  } catch (err) {
    console.error('[platform/landing-content PUT]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
// Exposed for direct unit testing — router is a function, so attaching a
// property doesn't affect `app.use('/api/platform', require(...))` usage.
module.exports._deriveSlugForOrg = _deriveSlugForOrg;
