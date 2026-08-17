/**
 * find-duplicate-staff-emails.js — READ-ONLY diagnostic
 *
 * WHY THIS EXISTS
 * A user reported "Email 'x@y.com' is already used by another teacher"
 * while editing an existing staff member's HR Records tab — a field
 * completely unrelated to email. Investigated the save path directly
 * (server/routes/teachers.js's PUT /:id) and confirmed it correctly
 * excludes the record's own id when checking for a duplicate email
 * (`id: { $ne: req.params.id }`) — the route is not the bug. Also
 * confirmed both the "Add Staff" form (POST /) and the CSV bulk-import
 * path (import-export.js's _importTeachers) already check for an
 * existing email before creating a new record, so today's code cannot
 * produce this. The only remaining explanation: a genuine SECOND
 * `teachers` document already exists in the database sharing that exact
 * email — most plausibly a historical artifact from before either of
 * those safeguards existed, per the user's own account: "initially
 * anyone imported or added was done so and assumed to be a teacher" —
 * i.e. someone was later given a corrected record (right staffType)
 * without the original, wrong one ever being removed.
 *
 * WHAT THIS SCRIPT DOES (and does NOT do)
 * Purely read-only — makes zero writes, zero deletes, zero merges. It
 * cannot safely decide which of two colliding records is "the real one"
 * (one may have payroll history, leave records, or timetable/teaching
 * assignments tied to it that the other doesn't) — that call needs a
 * human looking at both records. This script's only job is to make
 * every such collision, across every school, visible in one place
 * instead of surfacing one at a time as a confusing save-time error —
 * `teachers` is the whole-staff directory (see server/routes/teachers.js:
 * `staffType` is a free-form string, not restricted to actual teaching
 * roles), so this can affect anyone from that same "assumed everyone
 * was a teacher" import era, not just the one person who happened to
 * hit Save first.
 *
 * For each colliding email, prints every matching record's id, staffId,
 * name, staffType, status, whether it has a linked login account
 * (userId), and createdAt — the linked-login-account signal is usually
 * the strongest hint for which record is the one actually in active
 * use, since a person can only meaningfully sign in through one of them.
 *
 * Usage:
 *   node scripts/find-duplicate-staff-emails.js                  # all schools
 *   node scripts/find-duplicate-staff-emails.js --school <schoolId>
 *   node scripts/find-duplicate-staff-emails.js --email x@y.com  # one email, any school
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TARGET_SCHOOL = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();
const TARGET_EMAIL  = (() => { const i = process.argv.indexOf('--email');  return i !== -1 ? process.argv[i + 1].toLowerCase().trim() : null; })();

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

  const Schools  = _model('schools');
  const Teachers = _model('teachers');
  const Users    = _model('users');

  const schools = await Schools.find(TARGET_SCHOOL ? { id: TARGET_SCHOOL } : {})
    .select('id name').lean();

  let totalCollisions = 0;
  let totalRecords     = 0;

  for (const school of schools) {
    const filter = { schoolId: school.id, email: { $exists: true, $ne: null, $ne: '' } };
    const teachers = await Teachers.find(filter)
      .select('id staffId firstName lastName email staffType status userId createdAt')
      .lean();
    if (!teachers.length) continue;

    const byEmail = new Map();
    for (const t of teachers) {
      const email = (t.email || '').toLowerCase().trim();
      if (!email) continue;
      if (TARGET_EMAIL && email !== TARGET_EMAIL) continue;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(t);
    }

    const collisions = [...byEmail.entries()].filter(([, docs]) => docs.length > 1);
    if (!collisions.length) continue;

    console.log(`── ${school.name} (${school.id}) ──`);
    for (const [email, docs] of collisions) {
      totalCollisions++;
      console.log(`  ${email}  (${docs.length} records)`);
      for (const d of docs) {
        totalRecords++;
        const name = [d.firstName, d.lastName].filter(Boolean).join(' ') || '(no name)';
        const hasLogin = d.userId ? `linked login (userId: ${d.userId})` : 'no linked login';
        console.log(
          `    - id=${d.id ?? d._id}  staffId=${d.staffId ?? '—'}  "${name}"  ` +
          `staffType=${d.staffType ?? '(unset)'}  status=${d.status ?? '(unset)'}  ` +
          `${hasLogin}  createdAt=${d.createdAt ?? '(unknown)'}`
        );
      }
      // Cross-reference: does a real login account exist for this email, and
      // which (if either) of the colliding teacher records is it linked to?
      const userAcct = await Users.findOne({ schoolId: school.id, email }).select('id role isActive').lean();
      if (userAcct) {
        const linkedDoc = docs.find(d => d.userId === userAcct.id);
        console.log(
          `    Login account: id=${userAcct.id}, role=${userAcct.role}, active=${userAcct.isActive !== false}` +
          (linkedDoc ? `, linked to staffId=${linkedDoc.staffId ?? linkedDoc.id}` : ' — NOT linked to any of the records above')
        );
      } else {
        console.log('    No login account exists for this email at all.');
      }
      console.log('');
    }
  }

  if (totalCollisions === 0) {
    console.log(TARGET_EMAIL
      ? `No duplicate '${TARGET_EMAIL}' found${TARGET_SCHOOL ? ` at school ${TARGET_SCHOOL}` : ''}.`
      : 'No duplicate staff emails found.');
  } else {
    console.log(`Found ${totalCollisions} colliding email(s) across ${totalRecords} record(s). No changes were made — this is a report only.`);
    console.log('To resolve one: decide which record to keep (the one with the linked login account is usually correct), then either');
    console.log('deactivate/delete the other via the HR staff list, or update its email so it no longer collides.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
