/* ============================================================
   Platform Admin Routes — YOUR private dashboard API
   Protected by X-Platform-Key header (not school JWT)
   ============================================================ */
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { platformAdmin } = require('../middleware/auth');
const { sign } = require('../utils/jwt');

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

/* PATCH /api/platform/schools/:id — update plan/addOns/status */
router.patch('/schools/:id', async (req, res) => {
  try {
    const School = _model('schools');
    const update = {};
    if (req.body.plan)     update.plan     = req.body.plan;
    if (req.body.addOns)   update.addOns   = req.body.addOns;
    if (typeof req.body.isActive === 'boolean') update.isActive = req.body.isActive;
    if (req.body.planExpiry) update.planExpiry = req.body.planExpiry;

    const doc = await School.findOneAndUpdate({ id: req.params.id }, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'School not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/platform/schools/:id/impersonate — get a JWT for any school's superadmin */
router.post('/schools/:id/impersonate', async (req, res) => {
  try {
    const User = _model('users');
    const admin = await User.findOne({ schoolId: req.params.id, role: 'superadmin' }).lean();
    if (!admin) return res.status(404).json({ error: 'No superadmin found for this school' });

    const token = sign({
      userId: admin.id, schoolId: req.params.id,
      email: admin.email, role: 'superadmin', roles: ['superadmin'],
      impersonated: true
    });
    res.json({ token, user: { ...admin, password: undefined } });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

module.exports = router;
