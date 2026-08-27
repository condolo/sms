/**
 * backfill-timetable-academic-year.js — one-time data-quality backfill
 *
 * Academic Year & Term Dependency Map, finding #6. timetable_slots have
 * always had optional academicYearId/termId fields that no client ever
 * populated (grepped the entire client timetable module — zero
 * references) and the server never resolved server-side either. Every
 * existing slot in production has academicYearId: null, which is what
 * let stale slots from a prior year keep registering as live scheduling
 * conflicts against a brand-new year's timetable — this collection has
 * never had per-year versioning, so in practice a school has one live
 * timetable at a time, not years of accumulated distinct copies.
 *
 * This script stamps every school's CURRENTLY-active, untagged slots
 * with that school's live-resolved current academic year + term, using
 * the exact same resolveCurrentPeriod() the rest of the app already
 * treats as the single source of truth for "what year is it right now"
 * — not a reimplementation of that logic. Only isActive: true slots are
 * touched; inactive ones are left alone (already effectively retired,
 * not part of "the current timetable" this backfill is trying to
 * establish a real year for).
 *
 * A school with no academic years configured at all, or where the
 * current period can't be resolved, is skipped and reported —
 * genuinely nothing to backfill it TO.
 *
 * Usage:
 *   node scripts/backfill-timetable-academic-year.js              # all schools
 *   node scripts/backfill-timetable-academic-year.js --dry-run    # preview only
 *   node scripts/backfill-timetable-academic-year.js --school <schoolId>
 */
'use strict';

const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { resolveCurrentPeriod } = require('../server/routes/academic-config');

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

  const Schools  = _model('schools');
  const Years    = _model('academic_years');
  const Timetable = _model('timetable');

  const schools = await Schools.find(TARGET_ID ? { id: TARGET_ID } : {}).select('id name').lean();
  console.log(`Processing ${schools.length} school(s)\n`);

  let grandPatched = 0, grandSkippedNoYear = 0;

  for (const school of schools) {
    const untaggedFilter = {
      schoolId: school.id,
      isActive: true,
      $or: [{ academicYearId: null }, { academicYearId: { $exists: false } }],
    };
    const untagged = await Timetable.find(untaggedFilter).select('id').lean();
    if (untagged.length === 0) continue;

    const years = await Years.find({ schoolId: school.id }).lean();
    const { year, term } = resolveCurrentPeriod(years);

    if (!year) {
      console.log(`── ${school.name} (${school.id}) ── ${untagged.length} untagged active slot(s), SKIPPED — no resolvable current academic year`);
      grandSkippedNoYear += untagged.length;
      continue;
    }

    const resolvedYearId = year.id || year._id?.toString();
    const resolvedTermId = term?.id ?? null;

    console.log(`── ${school.name} (${school.id}) ── ${untagged.length} untagged active slot(s) -> "${year.name}"${term ? ` / ${term.name}` : ''}`);

    if (!DRY_RUN) {
      await Timetable.updateMany(untaggedFilter, {
        $set: { academicYearId: resolvedYearId, termId: resolvedTermId },
      });
    }
    grandPatched += untagged.length;
  }

  console.log(`\n${DRY_RUN ? 'Would patch' : 'Patched'} ${grandPatched} slot(s) total.`);
  if (grandSkippedNoYear) {
    console.log(`${grandSkippedNoYear} slot(s) left untouched — school(s) with no resolvable current academic year.`);
  }
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
