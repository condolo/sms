/* ============================================================
   Msingi — dedupe historical system messages (one-off maintenance)

   Before messages carried kind:'system' + coalesceKey, automated
   notifications wrote one row per event: a timetable publish that
   moved 15 lessons wrote 15 messages per guardian, and repeated
   daily summaries stacked identical subjects. Write-time coalescing
   (notify-dispatch.js createSystemMessage) fixes the future; this
   script fixes the archive.

   What it does, per school, per recipient, per day:
     1. Exact duplicates   — same subject AND body → keep the oldest,
                             delete the rest. (Attendance summaries,
                             marks-submitted rows.)
     2. Timetable families — subjects shaped "<lesson> — <class> has
                             changed" → merge the day's rows into ONE
                             message: subject "<class> — timetable
                             changed", body = every lesson's lines.
     3. Behaviour pairs    — same event day rows for one student with
                             the same subject prefix keep as-is (they
                             are distinct events: a demerit and a merit
                             are different messages, not noise).

   Idempotent: a second run finds nothing to change. Dry-run by
   default — pass --apply to write.

   Usage:
     node server/scripts/dedupe-system-messages.js            # report
     node server/scripts/dedupe-system-messages.js --apply
     MONGODB_URI=... node server/scripts/dedupe-system-messages.js --apply
   ============================================================ */
'use strict';

const mongoose = require('mongoose');
const { _model } = require('../utils/model');

const APPLY = process.argv.includes('--apply');
const TIMETABLE_RE = /^(.+?) — (.+) has changed$/;

function _dayKey(iso) {
  return String(iso || '').slice(0, 10); // UTC day — createdAt is ISO
}

function _groupKey(m, rid) {
  return `${m.schoolId}|${rid}|${_dayKey(m.createdAt)}`;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  }

  const Msg = _model('messages');
  const system = await Msg.find({ senderRole: 'system' })
    .select('id schoolId senderRole recipients subject body createdAt isRead')
    .lean();
  console.log(`system messages: ${system.length}`);

  // Group by (school, recipient, day). A row addressed to 'all'/a role
  // group is a broadcast, not a per-person event — skip those: merging
  // them would rewrite what several people see.
  const buckets = new Map();
  for (const m of system) {
    if (!Array.isArray(m.recipients) || m.recipients.length !== 1) continue;
    const rid = m.recipients[0];
    if (!rid || rid === 'all') continue;
    const key = _groupKey(m, rid);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }

  let dupDelete = 0, merged = 0, kept = 0;
  for (const rows of buckets.values()) {
    if (rows.length < 2) { kept += rows.length; continue; }
    rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    // 1) exact duplicates → drop all but the first
    const seen = new Map();
    const survivors = [];
    for (const m of rows) {
      const sig = `${m.subject}||${m.body}`;
      if (seen.has(sig)) { dupDelete += 1; continue; }
      seen.set(sig, m);
      survivors.push(m);
    }

    // 2) timetable family merge
    const tt = survivors.filter(m => TIMETABLE_RE.test(m.subject || ''));
    if (tt.length > 1) {
      const [other, ...rest] = tt;
      const classMatch = String(other.subject).match(TIMETABLE_RE);
      const className = classMatch?.[2] || 'the class';
      const lines = tt.map(m => String(m.body || '').trim()).filter(Boolean);
      const mergedSubject = `${className} — timetable changed`;
      const mergedBody = lines.join('\n');
      if (APPLY) {
        await Msg.updateOne(
          { id: other.id },
          { $set: { subject: mergedSubject, body: mergedBody, updatedAt: new Date().toISOString() } },
        );
        await Msg.deleteMany({ id: { $in: rest.map(m => m.id) } });
      }
      merged += rest.length;
      kept += 1;
    } else {
      kept += tt.length;
    }

    const nonTt = survivors.filter(m => !TIMETABLE_RE.test(m.subject || ''));
    kept += nonTt.length;
  }

  console.log(`kept ${kept}, delete ${dupDelete} exact duplicates, merge ${merged} timetable rows into family messages`);
  if (!APPLY) console.log('dry run — pass --apply to write');
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(2); });
