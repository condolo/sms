/**
 * backfill-assessment-marks-academic-year.js — one-time data backfill (v5.278.0)
 *
 * Markbook marks saved before the Markbook sent an academic year carry
 * academicYearId: null, and every year-filtered read treats null as "every
 * year". Once a school has past years of results (the past-results import),
 * those marks would also appear in past years' Markbook and report cards.
 *
 * Files each untagged mark under the academic year it was entered in (latest
 * year starting on or before its createdAt / _id date) — the same rule the
 * past-results import applies to a school before it imports
 * (server/utils/untagged-marks.js). Marks that already have a year are never
 * touched; marks older than every year are left and reported.
 *
 * Usage:
 *   node scripts/backfill-assessment-marks-academic-year.js --dry-run    # preview only
 *   node scripts/backfill-assessment-marks-academic-year.js              # all schools
 *   node scripts/backfill-assessment-marks-academic-year.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { tagUntaggedMarks } = require('../server/utils/untagged-marks');

const DRY_RUN   = process.argv.includes('--dry-run');
const TARGET_ID = (() => { const i = process.argv.indexOf('--school'); return i !== -1 ? process.argv[i + 1] : null; })();

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'BackfillDoc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: false, id: false });
  return mongoose.model(name, schema, col);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {});
  console.log(`Connected${DRY_RUN ? ' [DRY RUN — no writes]' : ''}\n`);

  const Schools = _model('schools');
  const Years   = _model('academic_years');
  const Marks   = _model('assessment_marks');

  const schools = await Schools.find(TARGET_ID ? { id: TARGET_ID } : {}).select('id name').lean();
  let total = 0, left = 0;
  for (const school of schools) {
    if (!school.id) continue;
    const years = await Years.find({ schoolId: school.id }).lean();
    if (!years.length) continue;
    const r = await tagUntaggedMarks(Marks, school.id, years, { dryRun: DRY_RUN });
    if (!r.untagged) continue;
    const names = Object.fromEntries(years.map(y => [y.id || String(y._id), y.name]));
    const per = Object.entries(r.byYear).map(([y, n]) => `${names[y] || y}: ${n}`).join(', ');
    console.log(`${school.name || school.id}: ${r.untagged} untagged → ${r.tagged} filed${per ? ` (${per})` : ''}${r.left ? `, ${r.left} older than every year left as they are` : ''}`);
    total += r.tagged; left += r.left;
  }
  console.log(`\n${DRY_RUN ? 'Would file' : 'Filed'} ${total} mark(s); ${left} left untagged.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
