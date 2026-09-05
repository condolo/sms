/**
 * audit-legacy-admissions-students-fields.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * The 2026-09 field update (Mother/Father split, required Gender/DOB,
 * email-mandatory guardian fields, per-parent portal accounts) tightened
 * validation on NEW writes only. Nothing in that work touched a single
 * existing document — this platform's collections are schema-less
 * (`strict: false`, no `required` fields — server/utils/model.js), so
 * live data created before the change is completely untouched and may
 * not match the new rules at all. Three concrete risks that code review
 * and mocked tests cannot see, because they only exist in real data:
 *
 * 1. POST /api/admissions/:id/enroll (server/routes/admissions.js)
 *    builds the new Student document directly from the application and
 *    writes it WITHOUT running it through StudentCreateSchema. An
 *    application that predates the Gender/DOB requirement and is
 *    already sitting at stage "acceptance" or "enrolled" will enroll
 *    TODAY with a Student record silently missing dateOfBirth/gender —
 *    no error, no warning.
 * 2. Any admission application with a Mother or Father NAME but no
 *    EMAIL for that parent (legal before the 2026-09 email-mandatory
 *    tightening) will now be rejected the moment staff touches ANY
 *    guardian field on it via PUT — correct per the new rule, but will
 *    look like an unrelated break unless someone already knows why.
 * 3. Any Student record with a Mother/Father name but no email for that
 *    parent can never get that parent an independent portal account
 *    (POST /:id/parent-account with guardian: 'mother'|'father') until
 *    the missing email is filled in via a profile edit.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes. Reports counts and specific
 * IDs for each of the three risks above, per school, so you can decide
 * whether real production data is actually affected before treating
 * this as theoretical.
 *
 * Usage:
 *   node scripts/audit-legacy-admissions-students-fields.js
 *   node scripts/audit-legacy-admissions-students-fields.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TARGET_SCHOOL = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'innolearn',
  });
  console.log('Connected [READ-ONLY — this script makes no writes]\n');

  const Schools    = _model('schools');
  const Apps       = _model('admissions');
  const Students   = _model('students');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let riskEnrollCount = 0;
  let riskGuardianAppCount = 0;
  let riskGuardianStudentCount = 0;

  for (const school of schools) {
    console.log(`\n=== ${school.name} (${school.id}) ===`);

    /* Risk 1 — enrollable applications missing dateOfBirth/gender.
       These will enroll TODAY with an incomplete Student record. */
    const enrollRisk = await Apps.find({
      schoolId: school.id,
      stage: { $in: ['acceptance', 'enrolled'] },
      $or: [
        { dateOfBirth: { $exists: false } }, { dateOfBirth: '' }, { dateOfBirth: null },
        { gender:      { $exists: false } }, { gender:      '' }, { gender:      null },
      ],
    }).select('id firstName lastName stage studentId dateOfBirth gender').lean();

    if (enrollRisk.length) {
      riskEnrollCount += enrollRisk.length;
      console.log(`  [RISK 1] ${enrollRisk.length} application(s) at acceptance/enrolled missing DOB/gender:`);
      for (const a of enrollRisk) {
        const status = a.studentId ? `ALREADY ENROLLED as student ${a.studentId} — check that record now` : 'not yet enrolled — enrolling today will carry the gap forward';
        console.log(`    - ${a.id} (${a.firstName} ${a.lastName}, stage=${a.stage}) — ${status}`);
      }
    }

    /* Risk 2 — applications with a named parent but no email for them.
       PUT will reject the NEXT edit that touches any guardian field. */
    const guardianAppRisk = await Apps.find({
      schoolId: school.id,
      $or: [
        { motherName: { $exists: true, $nin: [null, ''] }, $or: [{ motherEmail: { $exists: false } }, { motherEmail: '' }, { motherEmail: null }] },
        { fatherName: { $exists: true, $nin: [null, ''] }, $or: [{ fatherEmail: { $exists: false } }, { fatherEmail: '' }, { fatherEmail: null }] },
      ],
    }).select('id firstName lastName motherName motherEmail fatherName fatherEmail').lean();

    if (guardianAppRisk.length) {
      riskGuardianAppCount += guardianAppRisk.length;
      console.log(`  [RISK 2] ${guardianAppRisk.length} application(s) with a named parent missing that parent's email (next guardian-field edit will be rejected until fixed):`);
      for (const a of guardianAppRisk) {
        const missing = [];
        if (a.motherName && !a.motherEmail) missing.push('motherEmail');
        if (a.fatherName && !a.fatherEmail) missing.push('fatherEmail');
        console.log(`    - ${a.id} (${a.firstName} ${a.lastName}) — missing: ${missing.join(', ')}`);
      }
    }

    /* Risk 3 — students with a named parent but no email for them.
       That parent can never get their own portal account until fixed. */
    const guardianStudentRisk = await Students.find({
      schoolId: school.id,
      $or: [
        { motherName: { $exists: true, $nin: [null, ''] }, $or: [{ motherEmail: { $exists: false } }, { motherEmail: '' }, { motherEmail: null }] },
        { fatherName: { $exists: true, $nin: [null, ''] }, $or: [{ fatherEmail: { $exists: false } }, { fatherEmail: '' }, { fatherEmail: null }] },
      ],
    }).select('id firstName lastName motherName motherEmail fatherName fatherEmail').lean();

    if (guardianStudentRisk.length) {
      riskGuardianStudentCount += guardianStudentRisk.length;
      console.log(`  [RISK 3] ${guardianStudentRisk.length} student(s) with a named parent who can't yet get their own portal account (missing email):`);
      for (const s of guardianStudentRisk) {
        const missing = [];
        if (s.motherName && !s.motherEmail) missing.push('Mother');
        if (s.fatherName && !s.fatherEmail) missing.push('Father');
        console.log(`    - ${s.id} (${s.firstName} ${s.lastName}) — missing email for: ${missing.join(', ')}`);
      }
    }

    if (!enrollRisk.length && !guardianAppRisk.length && !guardianStudentRisk.length) {
      console.log('  No issues found for this school.');
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log('SUMMARY (all schools scanned)');
  console.log(`  Risk 1 — enrollable applications missing DOB/gender: ${riskEnrollCount}`);
  console.log(`  Risk 2 — applications with an incomplete guardian email: ${riskGuardianAppCount}`);
  console.log(`  Risk 3 — students with an incomplete guardian email: ${riskGuardianStudentCount}`);
  console.log('─────────────────────────────────────────');
  console.log('This script made zero writes.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
