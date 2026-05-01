/* ============================================================
   InnoLearn — Seed Utility
   Seeds the InnoLearn International School demo school + all
   demo users into MongoDB Atlas.

   Usage:
     node server/utils/seedSchool.js
     node server/utils/seedSchool.js --wipe   (drop existing InnoLearn data first)

   Requires MONGODB_URI in .env (or environment)
   ============================================================ */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const WIPE = process.argv.includes('--wipe');

/* ── Generic model factory (matches server/routes/platform.js) ── */
function model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* ── School definition ────────────────────────────────────── */
const SCHOOL_ID = 'sch_innolearn_001';
const SCHOOL = {
  id:        SCHOOL_ID,
  slug:      'innolearn',
  name:      'InnoLearn International School',
  shortName: 'InnoLearn',
  type:      'International School',
  country:   'Kenya',
  city:      'Nairobi',
  currency:  'KES',
  timezone:  'Africa/Nairobi',
  plan:      'premium',
  addOns:    [],
  isActive:  true,
  curriculum: ['cambridge', 'ib'],
  sections:   ['kg', 'primary', 'secondary', 'alevel'],
  website:   'https://innolearn.ac.ke',
  trialEnds: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

/* ── Demo users ───────────────────────────────────────────── */
const USERS = [
  { id:'u_inno_superadmin', name:'Dr. Sarah Mitchell',    email:'superadmin@innolearn.ac.ke', role:'superadmin',  pw:'Admin1234!' },
  { id:'u_inno_admin',      name:'James Odhiambo',        email:'admin@innolearn.ac.ke',      role:'admin',       pw:'Admin1234!' },
  { id:'u_inno_teacher',    name:'Ms. Amina Hassan',      email:'teacher@innolearn.ac.ke',    role:'teacher',     pw:'Teacher123!' },
  { id:'u_inno_parent',     name:'Robert & Jane Kariuki', email:'parent@innolearn.ac.ke',     role:'parent',      pw:'Parent123!' },
  { id:'u_inno_student',    name:'Aisha Kariuki',         email:'student@innolearn.ac.ke',    role:'student',     pw:'Student123!' },
  { id:'u_inno_finance',    name:'Patricia Wambua',       email:'finance@innolearn.ac.ke',    role:'finance',     pw:'Finance123!' },
  { id:'u_inno_deputy',     name:'Mr. David Ngugi',       email:'deputy@innolearn.ac.ke',     role:'deputy',      pw:'Deputy123!' },
  { id:'u_inno_discipline', name:'Mrs. Grace Achieng',    email:'discipline@innolearn.ac.ke', role:'discipline',  pw:'Discipline1!' },
];

/* ── Sections ─────────────────────────────────────────────── */
const SECTIONS = [
  { id:`sec_kg_${SCHOOL_ID}`,  name:'KG / Pre-Primary', code:'KG',  order:1, sectionKey:'kg'        },
  { id:`sec_pri_${SCHOOL_ID}`, name:'Primary',           code:'PRI', order:2, sectionKey:'primary'   },
  { id:`sec_sec_${SCHOOL_ID}`, name:'Secondary',         code:'SEC', order:3, sectionKey:'secondary' },
  { id:`sec_al_${SCHOOL_ID}`,  name:'Sixth Form / A-Level', code:'AL', order:4, sectionKey:'alevel'  },
];

/* ── Academic year ────────────────────────────────────────── */
const ACADEMIC_YEAR = {
  id: `ay_${SCHOOL_ID}_2025`,
  schoolId: SCHOOL_ID,
  name: '2025-2026',
  isCurrent: true,
  startDate: '2025-09-01',
  endDate:   '2026-07-31',
  terms: [
    { id:`t1_${SCHOOL_ID}`, name:'Term 1', startDate:'2025-09-01', endDate:'2025-12-15', isCurrent:false },
    { id:`t2_${SCHOOL_ID}`, name:'Term 2', startDate:'2026-01-08', endDate:'2026-04-10', isCurrent:true  },
    { id:`t3_${SCHOOL_ID}`, name:'Term 3', startDate:'2026-04-27', endDate:'2026-07-11', isCurrent:false },
  ]
};

/* ── Role permissions (superadmin full access) ─────────────── */
const ROLE_PERMISSION = {
  id: `rp_sa_${SCHOOL_ID}`,
  schoolId: SCHOOL_ID,
  roleKey: 'superadmin',
  permissions: { _all: { view: true, edit: true, delete: true, create: true } }
};

/* ── Main ─────────────────────────────────────────────────── */
async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI is not set.  Create a .env file from .env.example first.');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB Atlas…');
  await mongoose.connect(uri, { dbName: 'innolearn' });
  console.log('✅  Connected.\n');

  const School = model('schools');
  const User   = model('users');
  const Sec    = model('sections');
  const AY     = model('academic_years');
  const Perm   = model('role_permissions');

  if (WIPE) {
    console.log('🗑   Wiping existing InnoLearn data…');
    await Promise.all([
      School.deleteMany({ id: SCHOOL_ID }),
      User.deleteMany({ schoolId: SCHOOL_ID }),
      Sec.deleteMany({ schoolId: SCHOOL_ID }),
      AY.deleteMany({ schoolId: SCHOOL_ID }),
      Perm.deleteMany({ schoolId: SCHOOL_ID }),
    ]);
    console.log('    Done.\n');
  }

  /* School */
  await School.updateOne({ id: SCHOOL_ID }, { $set: SCHOOL }, { upsert: true });
  console.log('🏫  School upserted:', SCHOOL.name);

  /* Users */
  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.pw, 12);
    await User.updateOne({ id: u.id }, { $set: {
      id: u.id, schoolId: SCHOOL_ID,
      name: u.name, email: u.email.toLowerCase(),
      password: hashed, role: u.role,
      primaryRole: u.role, roles: [u.role],
      isActive: true, createdAt: new Date().toISOString(),
    }}, { upsert: true });
    console.log(`   👤  ${u.role.padEnd(12)} ${u.email}`);
  }

  /* Sections */
  for (const s of SECTIONS) {
    await Sec.updateOne({ id: s.id }, { $set: { ...s, schoolId: SCHOOL_ID } }, { upsert: true });
  }
  console.log('📚  Sections seeded:', SECTIONS.map(s => s.code).join(', '));

  /* Academic year */
  await AY.updateOne({ id: ACADEMIC_YEAR.id }, { $set: ACADEMIC_YEAR }, { upsert: true });
  console.log('📅  Academic year seeded: 2025-2026');

  /* Role permissions */
  await Perm.updateOne({ id: ROLE_PERMISSION.id }, { $set: ROLE_PERMISSION }, { upsert: true });
  console.log('🔐  Role permissions seeded');

  console.log('\n✅  InnoLearn International School seeded successfully!');
  console.log('   Login at /index.html with any of the credentials above.');
  console.log('   Password for all demo accounts: see USERS array above.\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
