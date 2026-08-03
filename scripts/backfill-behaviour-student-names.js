/**
 * backfill-behaviour-student-names.js — one-time data-quality backfill
 *
 * behaviour_incidents/behaviour_appeals never carried a denormalized
 * studentName (unlike category/itemLabel, which always did), and
 * behaviour_incidents never carried classId at all — every incident/
 * appeal created before the server-side resolve fix in
 * server/routes/behaviour.js's POST /incidents has one or both missing,
 * which is why the Behaviour UI falls back to showing the raw studentId
 * (e.g. "std_demo_6") instead of a real name, and the Dashboard's
 * behaviour heatmap groups everything under "Unknown Class". New records
 * created after that fix are resolved server-side regardless of what the
 * client sends; this script patches the ones that predate it. Only
 * behaviour_incidents gets classId — behaviour_appeals' schema has no
 * such field.
 *
 * Usage:
 *   node scripts/backfill-behaviour-student-names.js              # all schools
 *   node scripts/backfill-behaviour-student-names.js --dry-run    # preview only
 *   node scripts/backfill-behaviour-student-names.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN   = process.argv.includes('--dry-run');
const TARGET_ID = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

const COLLECTIONS = ['behaviour_incidents', 'behaviour_appeals'];

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true, id: false });
  return mongoose.model(name, schema, col);
}

async function _backfillCollection(collection, schoolId, studentById, dryRun) {
  const Coll = _model(collection);
  const patchesClassId = collection === 'behaviour_incidents'; // AppealSchema has no classId field

  const missingName = [{ studentName: null }, { studentName: { $exists: false } }, { studentName: '' }];
  const missingClassId = [{ classId: null }, { classId: { $exists: false } }, { classId: '' }];
  const query = patchesClassId
    ? { schoolId, $or: [...missingName, ...missingClassId] }
    : { schoolId, $or: missingName };

  const orphans = await Coll.find(query).select('id studentId studentName classId').lean();

  let patched = 0;
  const unresolved = [];

  for (const doc of orphans) {
    const student = studentById.get(doc.studentId);
    if (!student) { unresolved.push(doc.studentId); continue; }

    const set = {};
    if (!doc.studentName) set.studentName = `${student.firstName} ${student.lastName}`.trim();
    if (patchesClassId && !doc.classId && student.classId) set.classId = student.classId;
    if (Object.keys(set).length === 0) continue;

    if (!dryRun) {
      await Coll.updateOne({ id: doc.id, schoolId }, { $set: set });
    }
    patched++;
  }

  return { total: orphans.length, patched, unresolved: [...new Set(unresolved)] };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Schools = _model('schools');
  const schools = await Schools.find(TARGET_ID ? { id: TARGET_ID } : {}).select('id name').lean();
  console.log(`Processing ${schools.length} school(s)\n`);

  const Students = _model('students');
  let grandPatched = 0;

  for (const school of schools) {
    const students = await Students.find({ schoolId: school.id }).select('id firstName lastName classId').lean();
    const studentById = new Map(students.map(s => [s.id, s]));

    const results = {};
    for (const collection of COLLECTIONS) {
      results[collection] = await _backfillCollection(collection, school.id, studentById, DRY_RUN);
    }

    const anyWork = Object.values(results).some(r => r.total > 0);
    if (!anyWork) continue;

    console.log(`── ${school.name} (${school.id}) ──`);
    for (const [collection, r] of Object.entries(results)) {
      if (r.total === 0) continue;
      console.log(`  ${collection}: ${r.patched}/${r.total} patched`);
      if (r.unresolved.length) {
        console.log(`    unresolved studentIds (no matching student record): ${r.unresolved.join(', ')}`);
      }
      grandPatched += r.patched;
    }
  }

  console.log(`\n${DRY_RUN ? 'Would patch' : 'Patched'} ${grandPatched} record(s) total.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
