/* ============================================================
   Platform Admin Routes — YOUR private dashboard API
   Protected by X-Platform-Key header (not school JWT)
   ============================================================ */
const express  = require('express');
const crypto   = require('crypto');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { platformAdmin } = require('../middleware/auth');
const { sign } = require('../utils/jwt');
const email    = require('../utils/email');

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
      contactEmail:   settings.contactEmail   || 'hello@msingi.io',
      contactPhone:   settings.contactPhone   || '+254 769 024 153',
      socialLinks:    settings.socialLinks    || {},
      updatedAt:      settings.updatedAt      || null,
    });
  } catch (err) {
    console.error('[platform/settings GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// All routes below require the platform admin key
router.use(platformAdmin);

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
    const User    = _model('users');
    const Student = _model('students');
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
        Student.countDocuments({ schoolId: sid, status: 'active' }),
        User.countDocuments({ schoolId: sid, isActive: true })
      ]);
      return { ...s, _stats: { students, staff } };
    }));

    res.json(withStats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/schools — provision a new school */
router.post('/schools', async (req, res) => {
  try {
    const { name, shortName, slug, plan, adminName, adminEmail, adminPassword, currency, timezone } = req.body;
    if (!name || !slug || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: 'name, slug, adminEmail, adminPassword required' });
    }

    const School = _model('schools');
    const User   = _model('users');

    // Check slug uniqueness
    const exists = await School.findOne({ slug }).lean();
    if (exists) return res.status(409).json({ error: `Slug '${slug}' is already taken` });

    const schoolId = `sch_${slug}_${Date.now().toString(36)}`;
    const userId   = `u_${slug}_admin`;

    // Use raw collection API to bypass Mongoose's `id` virtual, which would
    // silently strip any field named "id" passed to Model.create().
    const db = mongoose.connection.db;

    // Create school record
    const schoolDoc = {
      id: schoolId, slug, name, shortName: shortName || name,
      plan: plan || process.env.BOOTSTRAP_PLAN || 'enterprise', addOns: [], isActive: true,
      currency: currency || 'KES', timezone: timezone || 'Africa/Nairobi',
      createdAt: new Date().toISOString()
    };
    await db.collection('schools').insertOne(schoolDoc);

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

/* POST /api/platform/schools/:id/approve — approve a pending school */
router.post('/schools/:id/approve', async (req, res) => {
  try {
    const School = _model('schools');
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

/* PATCH /api/platform/schools/:id — update plan/addOns/status
   Accepts either MongoDB _id (ObjectId) or custom id string (sch_slug_ts) */
router.patch('/schools/:id', async (req, res) => {
  try {
    const School = _model('schools');
    const update = {};
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
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/schools/:id/impersonate — get a JWT for any school's superadmin */
router.post('/schools/:id/impersonate', async (req, res) => {
  try {
    const School = _model('schools');
    const User   = _model('users');

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
    /* Merge schoolName into the user object so the React SPA sidebar can display it */
    res.json({
      token,
      user: {
        ...admin,
        password:   undefined,
        schoolName: school.name,
        schoolId:   resolvedSchoolId,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const TENANT_COLS = [
  'users','students','teachers','classes','attendance_records',
  'finance_records','behaviour_incidents','behaviour_appeals',
  'exam_schedules','grades','admissions','timetable_slots',
  'messages','academic_years','sections','role_permissions',
  'subjects','events','hr_records'
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

    if (tenantFilter) {
      TENANT_COLS.forEach(col => ops.push(_model(col).deleteMany(tenantFilter)));
    }

    /* Always delete the user by email — catches orphaned accounts even if
       schoolId matching fails due to Mongoose virtual id conflict */
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

/* GET /api/platform/stats — MRR, school counts, plan breakdown */
router.get('/stats', async (req, res) => {
  try {
    const School  = _model('schools');
    const Student = _model('students');

    const [allSchools, totalStudents] = await Promise.all([
      School.find({}).select('plan isActive').lean(),   // only fields needed for MRR calc
      Student.countDocuments({ status: 'active' })
    ]);

    const PLAN_PRICE = { core: 15000, standard: 35000, premium: 65000, enterprise: 250000 };
    const byPlan = {};
    let mrr = 0;

    allSchools.forEach(s => {
      if (!byPlan[s.plan]) byPlan[s.plan] = 0;
      byPlan[s.plan]++;
      if (s.isActive) mrr += PLAN_PRICE[s.plan] || 0;
    });

    res.json({
      totalSchools: allSchools.length,
      activeSchools: allSchools.filter(s => s.isActive).length,
      totalStudents, mrr, byPlan
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Base data seed for new schools ─── */
async function _seedBaseData(schoolId) {
  const AY    = _model('academic_years');
  const Perm  = _model('role_permissions');
  const Sec   = _model('sections');

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

/* ── School-side dismiss (uses platform router via /api/platform/announcements/:id/dismiss)
   But schools need JWT auth, not platform key. So we expose a separate public endpoint
   in the main collections route instead. Dismiss is tracked as schoolId in dismissedBy[].
   We handle this via a special route here with a loose auth fallback: ── */

/* ══════════════════════════════════════════════════════════════
   LANDING PAGE CMS
   GET  /api/platform/landing-content  — public, cached 60s (Landing.jsx uses this)
   PUT  /api/platform/landing-content  — platform admin key required, partial merge
   ══════════════════════════════════════════════════════════════ */

/* Public GET — no platform key required (landing page needs it without auth) */
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
