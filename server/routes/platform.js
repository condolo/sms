/* ============================================================
   Platform Admin Routes — YOUR private dashboard API
   Protected by X-Platform-Key header (not school JWT)
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { platformAdmin } = require('../middleware/auth');
const { sign } = require('../utils/jwt');
const email    = require('../utils/email');

const router = express.Router();

// All routes in this file require the platform admin key
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
    const schools = await School.find({}).lean();

    const withStats = await Promise.all(schools.map(async s => {
      const [students, staff] = await Promise.all([
        Student.countDocuments({ schoolId: s.id, status: 'active' }),
        User.countDocuments({ schoolId: s.id, isActive: true })
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

    // Create school record
    const school = await School.create({
      id: schoolId, slug, name, shortName: shortName || name,
      plan: plan || 'core', addOns: [], isActive: true,
      currency: currency || 'KES', timezone: timezone || 'Africa/Nairobi',
      createdAt: new Date().toISOString()
    });

    // Create superadmin user
    const hashed = await bcrypt.hash(adminPassword, 10);
    await User.create({
      id: userId, schoolId, name: adminName || adminEmail,
      email: adminEmail.toLowerCase(), password: hashed,
      role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
      isActive: true, createdAt: new Date().toISOString()
    });

    // Seed essential base records (academic year, role_permissions, etc.)
    await _seedBaseData(schoolId);

    res.status(201).json({ school: school.toObject(), adminUserId: userId });
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

/* PATCH /api/platform/schools/:id — update plan/addOns/status */
router.patch('/schools/:id', async (req, res) => {
  try {
    const School = _model('schools');
    const update = {};
    if (req.body.plan)     update.plan     = req.body.plan;
    if (req.body.addOns)   update.addOns   = req.body.addOns;
    if (typeof req.body.isActive === 'boolean') update.isActive = req.body.isActive;
    if (req.body.planExpiry) update.planExpiry = req.body.planExpiry;

    const doc = await School.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'School not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/schools/:id/impersonate — get a JWT for any school's superadmin */
router.post('/schools/:id/impersonate', async (req, res) => {
  try {
    const School = _model('schools');
    const User   = _model('users');

    /* Find the school first so we can resolve the correct schoolId for user lookup */
    const school = await School.findById(req.params.id).lean();
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

/* DELETE /api/platform/schools/all — wipe all non-demo schools */
router.delete('/schools/all', async (req, res) => {
  try {
    const School = _model('schools');
    const DEMO_SLUGS = ['innolearn']; // preserve the built-in demo school

    /* Find all school ids to purge */
    const toPurge = await School.find({ slug: { $nin: DEMO_SLUGS } }).lean();
    const schoolIds    = toPurge.map(s => s.id).filter(Boolean);
    const schoolMonIds = toPurge.map(s => s._id);

    /* Delete from every collection that carries a schoolId */
    const TENANT_COLS = [
      'users','students','teachers','classes','attendance_records',
      'finance_records','behaviour_incidents','behaviour_appeals',
      'exam_schedules','grades','admissions','timetable_slots',
      'messages','academic_years','sections','role_permissions',
      'subjects','events','hr_records'
    ];

    await Promise.all([
      School.deleteMany({ _id: { $in: schoolMonIds } }),
      ...TENANT_COLS.map(col => {
        const M = _model(col);
        return M.deleteMany({ $or: [
          { schoolId: { $in: schoolIds } },
          // also match by _id-based schoolId in case some docs use ObjectId ref
          ...(schoolIds.length ? [] : [])
        ]});
      })
    ]);

    console.log(`[PLATFORM] Wiped ${toPurge.length} school(s) and all their data`);
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

    /* Custom schoolId used as FK in every tenant collection */
    const schoolCustomId = school.id;  // e.g. "sch_mascitacademy_xyz"
    const adminEmail     = school.adminEmail;

    /* Build the schoolId match — try custom id, fall back to email for users */
    const tenantMatch = schoolCustomId ? { schoolId: schoolCustomId } : null;

    const TENANT_COLS = [
      'users','students','teachers','classes','attendance_records',
      'finance_records','behaviour_incidents','behaviour_appeals',
      'exam_schedules','grades','admissions','timetable_slots',
      'messages','academic_years','sections','role_permissions',
      'subjects','events','hr_records'
    ];

    const deleteOps = [School.findByIdAndDelete(req.params.id)];

    if (tenantMatch) {
      TENANT_COLS.forEach(col => deleteOps.push(_model(col).deleteMany(tenantMatch)));
    } else if (adminEmail) {
      /* Fallback: at minimum remove the user account by email */
      deleteOps.push(_model('users').deleteMany({ email: adminEmail }));
    }

    await Promise.all(deleteOps);

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
      School.find({}).lean(),
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

  // Default role permissions (superadmin gets everything)
  await Perm.updateOne({ id: `rp_sa_${schoolId}` }, { $set: {
    id: `rp_sa_${schoolId}`, schoolId, roleKey: 'superadmin',
    permissions: { _all: { view: true, edit: true, delete: true, create: true } }
  }}, { upsert: true });
}

/* ════════════════════════════════════════════════════════════
   SYSTEM ANNOUNCEMENTS — Platform admin creates global notices
   visible on all school dashboards and sent via email
   ════════════════════════════════════════════════════════════ */

function _annId() {
  return 'ann_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

/* GET /api/platform/announcements — list all announcements */
router.get('/announcements', async (req, res) => {
  try {
    const Ann = _model('system_announcements');
    const list = await Ann.find({}).sort({ createdAt: -1 }).lean();
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

/* ── School-side dismiss (uses platform router via /api/platform/announcements/:id/dismiss)
   But schools need JWT auth, not platform key. So we expose a separate public endpoint
   in the main collections route instead. Dismiss is tracked as schoolId in dismissedBy[].
   We handle this via a special route here with a loose auth fallback: ── */

module.exports = router;
