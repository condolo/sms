/* ============================================================
   Msingi — multi-role / multi-school demo personas

   Seeds the accounts the mobile credential login + role switching were built
   for, so the flows can be walked on the demo DB:

     1. teacher.parent@demo.msingi.io
        Teacher PRIMARY who is ALSO a linked parent (one child at the demo
        school). Opens as Teacher; Profile offers "Switch to parent view".

     2. admin.parent@demo.msingi.io
        Office/staff PRIMARY who is ALSO a linked parent. Opens as Staff;
        Profile offers "Switch to parent view".

     3. three.schools@demo.msingi.io
        ONE parent account, SAME password, at THREE schools, one child each.
        Signing in shows the school picker (409 multiple_schools) and each
        school opens its own parent face with its own child.

   All three use the shared demo password (Demo2025!), like the rest of the
   demo school. Idempotent: rerun any time; --cleanup removes everything this
   script created (users, the two extra schools and their students).

     node scripts/seed-multi-role-demo.js
     node scripts/seed-multi-role-demo.js --cleanup
   ============================================================ */
'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DEMO_SCHOOL = 'sch_demo';
const DEMO_STUDENT = 'std_demo_1';
const PASSWORD = 'Demo2025!';

const EXTRA_SCHOOLS = [
  { id: 'sch_seed_north', slug: 'seed-north', name: 'Seed North Academy', shortName: 'Seed North' },
  { id: 'sch_seed_south', slug: 'seed-south', name: 'Seed South School', shortName: 'Seed South' },
];

const EXTRA_STUDENTS = [
  {
    id: 'std_seed_north_1', schoolId: 'sch_seed_north',
    firstName: 'Neema', lastName: 'Kiptoo', fullName: 'Neema Kiptoo',
    admissionNumber: 'SN-2026-00001', classId: 'cls_seed_north_1', className: 'Form 1N',
  },
  {
    id: 'std_seed_south_1', schoolId: 'sch_seed_south',
    firstName: 'Tatu', lastName: 'Mwangi', fullName: 'Tatu Mwangi',
    admissionNumber: 'SS-2026-00001', classId: 'cls_seed_south_1', className: 'Form 2S',
  },
];

function userDoc({ id, schoolId, email, name, role, roles, childId, password }) {
  return {
    id, schoolId, email, name,
    role, primaryRole: role, roles,
    guardianOf: [childId], studentIds: [childId],
    isActive: true,
    mustChangePassword: false,
    password,
    passwordChangedAt: new Date().toISOString(),
    tokenVersion: 0,
    mfaEnabled: false,
  };
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/innolearn';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const ids = {
    users: ['u_seed_teacher_parent', 'u_seed_admin_parent', 'u_seed_three_demo', 'u_seed_three_north', 'u_seed_three_south'],
    schools: EXTRA_SCHOOLS.map(s => s.id),
    students: EXTRA_STUDENTS.map(s => s.id),
  };

  if (process.argv.includes('--cleanup')) {
    await db.collection('users').deleteMany({ id: { $in: ids.users } });
    await db.collection('schools').deleteMany({ id: { $in: ids.schools } });
    await db.collection('students').deleteMany({ id: { $in: ids.students } });
    console.log('multi-role demo personas removed');
    await mongoose.disconnect();
    return;
  }

  const demoChild = await db.collection('students').findOne({ schoolId: DEMO_SCHOOL, id: DEMO_STUDENT });
  if (!demoChild) {
    throw new Error(`demo student ${DEMO_STUDENT} not found — start the server once so the demo school seeds`);
  }

  const now = new Date().toISOString();
  const password = await bcrypt.hash(PASSWORD, 10);

  for (const school of EXTRA_SCHOOLS) {
    await db.collection('schools').updateOne(
      { id: school.id },
      {
        $set: {
          ...school,
          isActive: true,
          isDemo: false,
          status: 'active',
          plan: 'family',
          addOns: [],
          currency: 'KES',
          country: 'Kenya',
          timezone: 'Africa/Nairobi',
          academicYear: '2026–2027',
          primaryColor: '#4f46e5',
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }

  for (const student of EXTRA_STUDENTS) {
    await db.collection('students').updateOne(
      { id: student.id },
      {
        $set: { ...student, status: 'active', updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }

  const users = [
    userDoc({
      id: 'u_seed_teacher_parent', schoolId: DEMO_SCHOOL,
      email: 'teacher.parent@demo.msingi.io', name: 'Teacher Parent',
      role: 'teacher', roles: ['teacher', 'parent'], childId: demoChild.id, password,
    }),
    userDoc({
      id: 'u_seed_admin_parent', schoolId: DEMO_SCHOOL,
      email: 'admin.parent@demo.msingi.io', name: 'Office Parent',
      role: 'admin', roles: ['admin', 'parent'], childId: demoChild.id, password,
    }),
    userDoc({
      id: 'u_seed_three_demo', schoolId: DEMO_SCHOOL,
      email: 'three.schools@demo.msingi.io', name: 'Three Schools Parent',
      role: 'parent', roles: ['parent'], childId: demoChild.id, password,
    }),
    userDoc({
      id: 'u_seed_three_north', schoolId: 'sch_seed_north',
      email: 'three.schools@demo.msingi.io', name: 'Three Schools Parent',
      role: 'parent', roles: ['parent'], childId: 'std_seed_north_1', password,
    }),
    userDoc({
      id: 'u_seed_three_south', schoolId: 'sch_seed_south',
      email: 'three.schools@demo.msingi.io', name: 'Three Schools Parent',
      role: 'parent', roles: ['parent'], childId: 'std_seed_south_1', password,
    }),
  ];

  for (const user of users) {
    await db.collection('users').updateOne(
      { id: user.id },
      { $set: { ...user, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  }

  console.log([
    'seeded multi-role / multi-school personas (password: ' + PASSWORD + ')',
    '  teacher.parent@demo.msingi.io  teacher + parent, 1 child (demo)',
    '  admin.parent@demo.msingi.io    admin + parent,   1 child (demo)',
    '  three.schools@demo.msingi.io   parent at 3 schools, 1 child each:',
    '    demo (Amara) · seed-north (Neema Kiptoo) · seed-south (Tatu Mwangi)',
  ].join('\n'));

  await mongoose.disconnect();
}

main().catch(err => { console.error(err.message); process.exit(1); });
