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
  website:   'https://www.innolearn.edu.ke',
  trialEnds: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

/* ── Demo users ─────────────────────────────────────────────
   Credentials must match the localStorage seed in js/data.js
   AND the DEMO_CREDS object in js/app.js so that demo login
   works whether the user is online (server auth) or offline
   (localStorage fallback).
   ────────────────────────────────────────────────────────── */
const USERS = [
  { id:'u_super',          name:'System Administrator',    email:'superadmin@innolearn.edu.ke',    role:'superadmin',           pw:'super123'       },
  { id:'u_admin1',         name:'Mwalimu Ndolo',           email:'admin@innolearn.edu.ke',         role:'admin',                pw:'admin123'       },
  { id:'u_tch1',           name:'Ms. Sarah Smith',         email:'sarah.smith@innolearn.edu.ke',   role:'teacher',              pw:'teacher123'     },
  { id:'u_par1',           name:'Mr. & Mrs. Johnson',      email:'parent1@innolearn.edu.ke',       role:'parent',               pw:'parent123'      },
  { id:'u_stu1',           name:'Emily Johnson',           email:'student1@innolearn.edu.ke',      role:'student',              pw:'student123'     },
  { id:'u_fin1',           name:'Ms. Nancy Njeri',         email:'finance@innolearn.edu.ke',       role:'finance',              pw:'finance123'     },
  { id:'u_dp1',            name:'Mr. Thomas Wangila',      email:'deputy@innolearn.edu.ke',        role:'deputy_principal',     pw:'deputy123'      },
  { id:'u_dc1',            name:'Mrs. Patricia Nduta',     email:'discipline@innolearn.edu.ke',    role:'discipline_committee', pw:'discipline123'  },
  // Additional staff from localStorage seed (for full parity)
  { id:'u_admin2',         name:'Mr. David Kariuki',       email:'vice@innolearn.edu.ke',          role:'admin',                pw:'admin123'       },
  { id:'u_sh_kg',          name:'Ms. Rose Akinyi',         email:'head.kg@innolearn.edu.ke',       role:'section_head',         pw:'section123'     },
  { id:'u_sh_pri',         name:'Mr. Collins Kimani',      email:'head.primary@innolearn.edu.ke',  role:'section_head',         pw:'section123'     },
  { id:'u_sh_sec',         name:'Dr. Amira Osei',          email:'head.secondary@innolearn.edu.ke',role:'section_head',         pw:'section123'     },
  { id:'u_hr1',            name:'Mr. Peter Muthoni',       email:'hr@innolearn.edu.ke',            role:'hr',                   pw:'hr123'          },
  { id:'u_adm1',           name:'Ms. Joy Wambua',          email:'admissions@innolearn.edu.ke',    role:'admissions_officer',   pw:'admissions123'  },
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
  console.log('   Demo credentials (same as localStorage seed + demo cards):');
  console.log('   superadmin@innolearn.edu.ke  /  super123');
  console.log('   admin@innolearn.edu.ke        /  admin123');
  console.log('   sarah.smith@innolearn.edu.ke  /  teacher123');
  console.log('   finance@innolearn.edu.ke       /  finance123');
  console.log('   parent1@innolearn.edu.ke       /  parent123');
  console.log('   student1@innolearn.edu.ke      /  student123');
  console.log('   deputy@innolearn.edu.ke        /  deputy123');
  console.log('   discipline@innolearn.edu.ke    /  discipline123\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
