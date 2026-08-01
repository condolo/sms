/**
 * backfill-student-medical-notes.js — one-time data-quality backfill
 *
 * Medical Centre milestone 2 superseded the legacy top-level
 * `students.medicalNotes` free-text field with `students.medical.notes`
 * (see server/routes/students.js). New students created after that
 * change already get it mirrored automatically at creation time; this
 * script does the same one-time copy for students created BEFORE the
 * change, so nothing existing gets silently orphaned on the old field.
 *
 * Never overwrites an existing medical.notes value — only fills it in
 * when empty, same "don't clobber something a nurse already entered on
 * the new field" posture as backfill-behaviour-student-names.js.
 *
 * Usage:
 *   node scripts/backfill-student-medical-notes.js              # all schools
 *   node scripts/backfill-student-medical-notes.js --dry-run    # preview only
 *   node scripts/backfill-student-medical-notes.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN   = process.argv.includes('--dry-run');
const TARGET_ID = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Students = _model('students');
  const filter = {
    medicalNotes: { $exists: true, $ne: '' },
    $or: [{ 'medical.notes': { $exists: false } }, { 'medical.notes': '' }],
  };
  if (TARGET_ID) filter.schoolId = TARGET_ID;

  const candidates = await Students.find(filter).select('_id schoolId medicalNotes medical').lean();
  console.log(`Found ${candidates.length} student(s) with medicalNotes not yet mirrored to medical.notes\n`);

  let patched = 0;
  for (const student of candidates) {
    if (!DRY_RUN) {
      // Target by _id (always present) — some pre-migration records have
      // no custom `id` field, same fallback students.js's own routes use.
      await Students.updateOne(
        { _id: student._id },
        { $set: { 'medical.notes': student.medicalNotes } }
      );
    }
    patched++;
  }

  console.log(`${DRY_RUN ? 'Would patch' : 'Patched'} ${patched} student(s).`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
