/* ============================================================
   Msingi — Demo School Seed Script
   Creates / refreshes the `demo` school with users for every
   role so visitors can explore the platform at demo.msingi.io

   Idempotent: safe to run on every server start.
   Runs after DB connection is confirmed.

   Demo credentials (all roles):
     admin@demo.msingi.io      / Demo2025!  — Admin
     principal@demo.msingi.io  / Demo2025!  — Deputy Principal
     teacher@demo.msingi.io    / Demo2025!  — Teacher
     finance@demo.msingi.io    / Demo2025!  — Finance Officer
     parent@demo.msingi.io     / Demo2025!  — Parent / Guardian
     student@demo.msingi.io    / Demo2025!  — Student
   ============================================================ */
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const DEMO_SLUG     = 'demo';
const DEMO_PASSWORD = 'Demo2025!';
const { seedDemoData } = require('./seed-demo-data');

/* ── Mongoose model factory (same pattern as the rest of the app) ── */
function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* ── Users to provision ── */
const DEMO_USERS = [
  { id: 'u_demo_admin',      name: 'Demo Admin',          email: 'admin@demo.msingi.io',      role: 'admin'            },
  { id: 'u_demo_principal',  name: 'Demo Principal',      email: 'principal@demo.msingi.io',  role: 'deputy_principal' },
  { id: 'u_demo_teacher',    name: 'Demo Teacher',        email: 'teacher@demo.msingi.io',    role: 'teacher'          },
  { id: 'u_demo_finance',    name: 'Demo Finance',        email: 'finance@demo.msingi.io',    role: 'finance'          },
  { id: 'u_demo_parent',     name: 'Demo Parent',         email: 'parent@demo.msingi.io',     role: 'parent'           },
  { id: 'u_demo_student',    name: 'Demo Student',        email: 'student@demo.msingi.io',    role: 'student'          },
];

async function seedDemo() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    console.warn('[seed-demo] DB not connected — skipping.');
    return;
  }

  const School = _model('schools');
  const User   = _model('users');
  const AY     = _model('academic_years');
  const Perm   = _model('role_permissions');
  const Sec    = _model('sections');

  const now       = new Date().toISOString();
  const trialEnds = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const schoolId  = 'sch_demo';

  /* ── 1. Upsert demo school — ALWAYS force enterprise via $set ── */
  await School.updateOne({ slug: DEMO_SLUG }, {
    $set: {
      id: schoolId, slug: DEMO_SLUG,
      name: 'Msingi Demo School', shortName: 'Demo',
      type: 'private', country: 'Kenya', city: 'Nairobi',
      plan: 'enterprise', addOns: [], isActive: true, status: 'active',
      curriculum: ['cbc', 'cambridge'], sections: ['primary', 'secondary'],
      primaryColor: '#4f46e5', accentColor: '#7c3aed',
      trialEnds, currency: 'KES', currencySymbol: 'KSh',
      timezone: 'Africa/Nairobi',
      adminName: 'Demo Admin', adminEmail: 'admin@demo.msingi.io',
      updatedAt: now,
    },
    $setOnInsert: { createdAt: now },
  }, { upsert: true });

  /* ── 1a. Hard verification — read plan back from DB immediately ── */
  // Catches wrong-document matches, auth errors, or silent write failures
  const saved = await School.findOne({ slug: DEMO_SLUG }).lean();
  if (!saved) {
    throw new Error(`CRITICAL: demo school document not found after upsert (slug='${DEMO_SLUG}')`);
  }
  if (saved.plan !== 'enterprise') {
    throw new Error(
      `CRITICAL: demo school plan is '${saved.plan}' after upsert — expected 'enterprise'. ` +
      `DB schoolId: '${saved.id}'. This means the $set did not persist — check MongoDB write concern.`
    );
  }
  console.log(`[seed-demo] ✅ Plan verified: '${saved.plan}' (schoolId: ${saved.id})`);

  /* ── 1b. Invalidate plan cache — no try/catch, must succeed ── */
  // plan.js is always required by route files before seedDemo() runs, so this is always available
  const { invalidatePlanCache } = require('../middleware/plan');
  invalidatePlanCache(schoolId);
  console.log('[seed-demo] ✅ Plan cache cleared — enterprise plan is live immediately');

  /* ── 2. Hash the shared demo password once ── */
  const hashed = await bcrypt.hash(DEMO_PASSWORD, 10);

  /* ── 3. Upsert each demo user ── */
  await Promise.all(DEMO_USERS.map(u =>
    User.updateOne({ id: u.id }, {
      $set: {
        id: u.id, schoolId, name: u.name,
        email: u.email, password: hashed,
        role: u.role, primaryRole: u.role, roles: [u.role],
        isActive: true, mustChangePassword: false,
        passwordChangedAt: now, updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    }, { upsert: true })
  ));
  console.log(`[seed-demo] ✅ ${DEMO_USERS.length} demo users provisioned`);

  /* ── 4. Academic year ── */
  const year = new Date().getFullYear();
  await AY.updateOne({ id: `ay_${schoolId}_${year}` }, {
    $set: {
      id: `ay_${schoolId}_${year}`, schoolId,
      name: `${year}–${year + 1}`, isCurrent: true,
      startDate: `${year}-01-01`, endDate: `${year}-12-31`,
      terms: [
        { id: 't1_demo', name: 'Term 1', startDate: `${year}-01-08`, endDate: `${year}-04-05`, isCurrent: false },
        { id: 't2_demo', name: 'Term 2', startDate: `${year}-04-28`, endDate: `${year}-08-09`, isCurrent: true  },
        { id: 't3_demo', name: 'Term 3', startDate: `${year}-09-01`, endDate: `${year}-11-30`, isCurrent: false },
      ],
    }
  }, { upsert: true });

  /* ── 5. Sections ── */
  const SECTIONS = [
    { key: 'primary',   name: 'Primary',   code: 'PRI', order: 1 },
    { key: 'secondary', name: 'Secondary', code: 'SEC', order: 2 },
  ];
  await Promise.all(SECTIONS.map(s =>
    Sec.updateOne({ id: `sec_${s.key}_${schoolId}` }, {
      $set: { id: `sec_${s.key}_${schoolId}`, schoolId, ...s }
    }, { upsert: true })
  ));

  /* ── 6. Role permissions ── */
  const FULL = ['read', 'create', 'update', 'delete'];
  const RCU  = ['read', 'create', 'update'];
  const R    = ['read'];

  const ALL_MODS = ['students','teachers','classes','attendance','finance',
                    'behaviour','exams','grades','admissions','timetable',
                    'messages','settings','assessment','report_cards','lessons'];

  const PERMS = {
    admin:            Object.fromEntries(ALL_MODS.map(m => [m, FULL])),
    deputy_principal: { students: R, teachers: R, classes: RCU, attendance: RCU, finance: R, behaviour: RCU, exams: RCU, grades: RCU, admissions: R, timetable: RCU, messages: RCU, settings: R, assessment: RCU, report_cards: RCU, lessons: FULL },
    teacher:          { students: R, teachers: R, classes: R, attendance: RCU, finance: [], behaviour: RCU, exams: RCU, grades: RCU, admissions: [], timetable: R, messages: RCU, settings: [], assessment: RCU, report_cards: R, lessons: FULL },
    finance:          { students: R, teachers: [], classes: [], attendance: [], finance: FULL, behaviour: [], exams: [], grades: [], admissions: R, timetable: [], messages: R, settings: [], assessment: [], report_cards: [] },
    parent:           { students: R, teachers: [], classes: [], attendance: R, finance: R, behaviour: R, exams: [], grades: R, admissions: [], timetable: R, messages: RCU, settings: [], assessment: R, report_cards: R, lessons: R },
    student:          { students: R, teachers: [], classes: R, attendance: R, finance: R, behaviour: R, exams: R, grades: R, admissions: [], timetable: R, messages: RCU, settings: [], assessment: R, report_cards: R, lessons: R },
  };

  await Promise.all(Object.entries(PERMS).map(([roleKey, permissions]) =>
    Perm.updateOne({ id: `rp_${roleKey}_${schoolId}` }, {
      $set: { id: `rp_${roleKey}_${schoolId}`, schoolId, roleKey, permissions }
    }, { upsert: true })
  ));

  console.log('[seed-demo] ✅ Demo school fully provisioned — plan: enterprise');

  // Seed realistic demo data (students, teachers, behaviour, finance, timetable, admissions)
  await seedDemoData();
}

module.exports = { seedDemo };
