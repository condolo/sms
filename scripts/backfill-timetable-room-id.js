/**
 * backfill-timetable-room-id.js — one-time data-quality backfill
 *
 * timetable.room has always been free text — a school could spell the same
 * physical room two different ways across slots, and a later rename in the
 * Rooms registry (rooms.js) never touched slots that already referenced the
 * old name. Both silently broke room double-booking detection, which used to
 * match purely by case-insensitive room-name string. timetable.js now also
 * stores a real roomId FK, resolved and denormalised at write time by
 * _applyRoomLink whenever a slot is created/edited through the (now id-based)
 * room dropdown, and conflict-checking matches on that id first.
 *
 * Existing slots written before this change only have the free-text `room`
 * field. This script links each one to its real room wherever its stored
 * text is an exact, case-insensitive match for a currently-registered room's
 * name — the same heuristic the client's slot editor now applies live when
 * an existing slot is reopened for editing (see AddSlotSlideOver.jsx's
 * registry-match effect), just run once, up front, over every slot at once.
 *
 * A slot whose room text matches no registered room is left untouched — it
 * stays genuine free text for an unregistered/ad-hoc space, exactly as before.
 *
 * Usage:
 *   node scripts/backfill-timetable-room-id.js              # all schools
 *   node scripts/backfill-timetable-room-id.js --dry-run    # preview only
 *   node scripts/backfill-timetable-room-id.js --school <schoolId>
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

  const Schools   = _model('schools');
  const Rooms     = _model('rooms');
  const Timetable = _model('timetable');

  const schools = await Schools.find(TARGET_ID ? { id: TARGET_ID } : {}).select('id name').lean();
  console.log(`Processing ${schools.length} school(s)\n`);

  let grandLinked = 0, grandUnmatched = 0;

  for (const school of schools) {
    const unlinkedFilter = {
      schoolId: school.id,
      $or: [{ roomId: null }, { roomId: { $exists: false } }],
      room: { $exists: true, $ne: null, $nin: [''] },
    };
    const unlinked = await Timetable.find(unlinkedFilter).select('id room').lean();
    if (unlinked.length === 0) continue;

    const rooms = await Rooms.find({ schoolId: school.id, isActive: { $ne: false } }).select('id name').lean();
    const byLowerName = new Map(rooms.map(r => [r.name.trim().toLowerCase(), r]));

    let linked = 0, unmatched = 0;
    for (const slot of unlinked) {
      const match = byLowerName.get((slot.room || '').trim().toLowerCase());
      if (!match) { unmatched++; continue; }
      linked++;
      if (!DRY_RUN) {
        await Timetable.updateOne(
          { _id: slot._id },
          { $set: { roomId: match.id, room: match.name } },
        );
      }
    }

    console.log(`── ${school.name} (${school.id}) ── ${unlinked.length} slot(s) with free-text room, ${rooms.length} registered room(s) -> ${linked} linked, ${unmatched} left as free text (no matching registered room)`);
    grandLinked += linked;
    grandUnmatched += unmatched;
  }

  console.log(`\n${DRY_RUN ? 'Would link' : 'Linked'} ${grandLinked} slot(s) to a registered room.`);
  console.log(`${grandUnmatched} slot(s) left as free text — no registered room matched their stored name.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
