/**
 * backfill-transport-occupied.js — one-time data-quality backfill
 *
 * transport_routes had no stored seat-occupancy counter — every capacity
 * check (POST /assignments, POST /assignments/bulk) derived it live via
 * countDocuments()/.find().length against transport_assignments, with
 * nothing tying that read back to the write that followed. Two concurrent
 * assigns for a route's last seat could both pass the check and both
 * succeed, silently overfilling the route.
 *
 * Fixed in transport.js by adding a stored, atomically-guarded `occupied`
 * field (mirrors library.js's `available`/`copies` counters) that the
 * assign/bulk-assign/delete/patch routes now maintain via guarded $inc.
 * That guard's `$ifNull: ['$occupied', 0]` only safely covers a route that
 * has never had `occupied` set AND has zero existing active assignments —
 * for a route that already has passengers, defaulting an unset `occupied`
 * to 0 would let new bookings exceed its real capacity until this script
 * (or the lazy self-heal it doesn't have) catches up. So this has to run
 * once, before/alongside that code deploys, not after.
 *
 * Purely additive/corrective: only ever sets `occupied` on transport_routes
 * documents to the true current count of their own active assignments. It
 * never touches transport_assignments, capacity, or any other route field.
 * Idempotent — safe to re-run; a route already correct is left alone.
 *
 * Usage:
 *   node scripts/backfill-transport-occupied.js              # all schools
 *   node scripts/backfill-transport-occupied.js --dry-run    # preview only
 *   node scripts/backfill-transport-occupied.js --school <schoolId>
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

  const Routes      = _model('transport_routes');
  const Assignments = _model('transport_assignments');

  const routes = await Routes.find(TARGET_ID ? { schoolId: TARGET_ID } : {}).select('id schoolId name occupied capacity').lean();
  console.log(`Found ${routes.length} transport_routes document(s)${TARGET_ID ? ` for school ${TARGET_ID}` : ' across all schools'}\n`);

  let updated = 0, unchanged = 0;
  for (const route of routes) {
    const trueOccupied = await Assignments.countDocuments({
      schoolId: route.schoolId, routeId: route.id, status: 'active',
    });
    if (route.occupied === trueOccupied) { unchanged++; continue; }

    console.log(`  ${route.schoolId} / ${route.name} (${route.id}): occupied ${route.occupied ?? '(unset)'} -> ${trueOccupied} (capacity ${route.capacity ?? 'unlimited'})`);
    updated++;
    if (!DRY_RUN) {
      await Routes.updateOne({ id: route.id, schoolId: route.schoolId }, { $set: { occupied: trueOccupied } });
    }
  }

  console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'} ${updated} route(s). ${unchanged} already correct.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
