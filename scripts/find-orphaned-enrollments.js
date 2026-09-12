/**
 * find-orphaned-enrollments.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * Reported directly: three Trinitas applicants and one Mascit Lab
 * Academy applicant showed as "Enrolled" on the Admissions board, but
 * none of them had a real Student record — unsearchable in Students,
 * not counted in its totals, no login, nothing to bill. Investigated
 * directly and found THREE separate write paths on the `admissions`
 * collection that could set `stage: "enrolled"` as a bare field value,
 * with none of the real enroll logic (Student creation, admission
 * number, guardian link, invoice) behind it:
 *   - PATCH /:id/stage (the "Move Applicant" dialog)
 *   - PUT   /:id       (a plain field update)
 *   - POST  /          (creating a brand-new application already there)
 * All three are now blocked (v5.82.0 / v5.83.0) — an application can
 * only ever reach "enrolled" through POST /:id/enroll, which always
 * creates the Student and links it via studentId in the same request.
 * This script is the permanent, read-only safety net for that
 * invariant: it finds any application that's still at "enrolled" with
 * no studentId, so this can be caught by running a check, not by
 * someone noticing an applicant is missing from Students weeks later.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes, creates zero Student records,
 * links zero guardians, generates zero invoices. It cannot and does not
 * attempt to repair anything; the only correct repair is running the
 * real Enroll Student action in the app (see ADMISSIONS_GUIDE.md §8),
 * which this script deliberately does not call on the caller's behalf.
 *
 * For each orphaned application, prints its id/ref, school, applicant
 * name and DOB, whether a class was ever assigned, its full stage
 * history (the shape of which usually reveals which of the three now-
 * closed paths produced it — see CHANGELOG.md v5.82.0/v5.83.0), and two
 * cross-checks that matter before anyone re-enrolls it: whether a
 * Student with a matching name already exists ANYWHERE in the database
 * (would mean this isn't a clean "never enrolled" case after all) and
 * whether either parent email already has a guardian login account
 * (relevant to what POST /:id/enroll's guardian-linking will do).
 *
 * Usage:
 *   node scripts/find-orphaned-enrollments.js                    # all schools
 *   node scripts/find-orphaned-enrollments.js --school <schoolId>
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
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('Connected [READ-ONLY — this script makes no writes]\n');

  const Schools    = _model('schools');
  const Admissions = _model('admissions');
  const Students   = _model('students');
  const Users      = _model('users');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();
  const schoolName = Object.fromEntries(schools.map(s => [s.id, s.name]));

  const filter = { stage: 'enrolled', studentId: { $exists: false } };
  if (TARGET_SCHOOL) filter.schoolId = TARGET_SCHOOL;

  const orphans = await Admissions.find(filter)
    .select('id applicationRef schoolId firstName lastName dateOfBirth gender applyingForClass applyingForClassName parentEmail motherEmail fatherEmail stageHistory createdAt updatedAt')
    .sort({ schoolId: 1, createdAt: 1 })
    .lean();

  if (orphans.length === 0) {
    console.log(TARGET_SCHOOL
      ? `0 orphaned enrollment(s) found at school ${TARGET_SCHOOL}.`
      : '0 orphaned enrollment(s) found across all schools.');
    await mongoose.disconnect();
    return;
  }

  let bySchool = new Map();
  for (const a of orphans) {
    if (!bySchool.has(a.schoolId)) bySchool.set(a.schoolId, []);
    bySchool.get(a.schoolId).push(a);
  }

  for (const [schoolId, apps] of bySchool) {
    console.log(`── ${schoolName[schoolId] ?? '(unknown school)'} (${schoolId}) — ${apps.length} orphaned enrollment(s) ──`);
    for (const a of apps) {
      const name = [a.firstName, a.lastName].filter(Boolean).join(' ') || '(no name)';
      console.log(`\n  ${name}  —  id=${a.id}  ref=${a.applicationRef ?? '—'}`);
      console.log(`    DOB: ${a.dateOfBirth ?? '(missing)'}  Gender: ${a.gender ?? '(missing)'}`);
      console.log(`    Class assigned: ${a.applyingForClass ? `${a.applyingForClassName || a.applyingForClass}` : 'NONE — will need a class assigned after enrolling'}`);
      console.log(`    Created: ${a.createdAt ?? '(unknown)'}    Last updated: ${a.updatedAt ?? '(unknown)'}`);

      const history = (a.stageHistory || []).map(h => `${h.stage}@${h.date}${h.notes ? ` ("${h.notes}")` : ''}`).join('  ->  ');
      console.log(`    Stage history: ${history || '(none recorded)'}`);
      if (!a.stageHistory || a.stageHistory.length === 1) {
        console.log('    -> Signature matches: created directly at "enrolled" (the POST / creation-time bug, v5.83.0).');
      } else {
        console.log('    -> Signature matches: moved to "enrolled" via the old quick stage-change dialog (v5.82.0).');
      }

      // Cross-check 1: does a Student with this name already exist ANYWHERE
      // (not just this school) — if so, this is NOT a clean orphan and
      // needs a human look before re-enrolling, not a routine repair.
      const nameMatch = await Students.find({
        firstName: new RegExp(`^${(a.firstName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        lastName:  new RegExp(`^${(a.lastName  || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      }).select('id schoolId admissionNumber').lean();
      if (nameMatch.length > 0) {
        console.log(`    !! POSSIBLE MATCH FOUND — a Student named "${name}" already exists (schoolId=${nameMatch[0].schoolId}, admissionNumber=${nameMatch[0].admissionNumber ?? '—'}). Do NOT re-enroll without checking this first.`);
      } else {
        console.log('    Confirmed: no Student with this name exists anywhere in the database.');
      }

      // Cross-check 2: does either parent email already have a guardian
      // login account — relevant to what POST /:id/enroll's guardian
      // linking will do on re-enroll (link vs. no-op).
      const emails = [...new Set([a.parentEmail, a.motherEmail, a.fatherEmail].filter(Boolean).map(e => e.toLowerCase().trim()))];
      if (emails.length) {
        const guardianAccts = await Users.find({ schoolId: a.schoolId, email: { $in: emails } }).select('email role').lean();
        console.log(guardianAccts.length
          ? `    Existing guardian account(s) found: ${guardianAccts.map(u => u.email).join(', ')} — re-enrolling will link to ${guardianAccts.length === 1 ? 'it' : 'these'}.`
          : '    No existing guardian account for either parent email — re-enrolling will not link or create one automatically.');
      }
    }
    console.log('');
  }

  console.log(`Found ${orphans.length} orphaned enrollment(s) across ${bySchool.size} school(s). No changes were made — this is a report only.`);
  console.log('To resolve one: open the application in Admissions and click "Enroll Student" — never create the Student record by hand.');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
