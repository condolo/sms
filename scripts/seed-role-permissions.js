/**
 * One-off migration: seed default role_permissions for all existing schools
 * that are missing them. Safe to re-run — uses upsert so it won't
 * overwrite any customised permission records.
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ALL_ACTIONS = ['read', 'create', 'update', 'delete'];
const RW  = ['read', 'create', 'update'];
const R   = ['read'];

const ALL_MODULES = [
  'students','teachers','staff','users','classes','sections',
  'attendance','grades','exams','timetable','subjects',
  'finance','hr','admissions','behaviour','messages','events',
  'reports','announcements','settings','academic_years','role_permissions'
];

function _allPerms() {
  return Object.fromEntries(ALL_MODULES.map(m => [m, ALL_ACTIONS]));
}

const ROLE_DEFAULTS = [
  { roleKey: 'superadmin', permissions: _allPerms() },
  { roleKey: 'admin',      permissions: _allPerms() },
  {
    roleKey: 'teacher',
    permissions: {
      students:   R, attendance: RW, grades: RW, exams: R,
      timetable:  R, subjects:   R,  classes: R, messages: RW,
      events:     R, reports:    R,  announcements: R,
    },
  },
  {
    roleKey: 'section_head',
    permissions: {
      students:   R, teachers: R, attendance: RW, grades: RW,
      exams:      RW, timetable: RW, subjects: R, classes: RW,
      messages:   RW, events: RW, reports: R, announcements: R,
    },
  },
  {
    roleKey: 'deputy_principal',
    permissions: {
      students:     [...R, 'update'], teachers: R, staff: R,
      attendance:   RW, grades: R, exams: RW, timetable: RW,
      subjects:     RW, classes: RW, behaviour: RW,
      messages:     RW, events: RW, reports: R,
      announcements: RW, sections: R,
    },
  },
  {
    roleKey: 'finance',
    permissions: {
      finance: ALL_ACTIONS, students: R, staff: R,
      reports: R, messages: RW, events: R, announcements: R,
    },
  },
  {
    roleKey: 'hr',
    permissions: {
      hr: ALL_ACTIONS, staff: RW, teachers: R, users: R,
      messages: RW, events: R, reports: R, announcements: R,
    },
  },
  {
    roleKey: 'admissions_officer',
    permissions: {
      admissions: ALL_ACTIONS, students: RW, classes: R,
      sections: R, messages: RW, events: R, announcements: R,
    },
  },
  {
    roleKey: 'discipline_committee',
    permissions: {
      students: R, behaviour: RW, attendance: R,
      messages: RW, events: R, announcements: R,
    },
  },
  {
    roleKey: 'parent',
    permissions: {
      grades: R, attendance: R, timetable: R,
      messages: RW, events: R, announcements: R,
    },
  },
  {
    roleKey: 'student',
    permissions: {
      grades: R, attendance: R, timetable: R, exams: R,
      subjects: R, messages: RW, events: R, announcements: R,
    },
  },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'innolearn' });
  const db = mongoose.connection.db;

  const schools = await db.collection('schools').find({}).project({ id: 1, _id: 1, slug: 1 }).toArray();
  console.log(`Found ${schools.length} school(s)`);

  for (const school of schools) {
    const schoolId = school.id || school._id.toString();
    console.log(`\n[${school.slug || school._id}] schoolId = ${schoolId}`);

    for (const { roleKey, permissions } of ROLE_DEFAULTS) {
      const existing = await db.collection('role_permissions').findOne({ schoolId, roleKey });
      if (existing) {
        console.log(`  [SKIP] ${roleKey} — already exists`);
      } else {
        await db.collection('role_permissions').insertOne({ schoolId, roleKey, permissions });
        console.log(`  [ADD]  ${roleKey}`);
      }
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
