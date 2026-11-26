/* ============================================================
   Msingi — what a school backup holds, and how it is written and read
   (v5.286.0)

   The backup used to follow a hand-kept list of collections, and about 60
   kinds of record added since were never in it (streams, payroll, lesson
   plans, KG marks…). Now EVERY collection with this school's records is
   backed up, except the ones named in EXCLUDED with the reason. A new
   feature's records are included without anyone remembering to add them.

   File (one per school per night): gzipped lines, AES-256-GCM encrypted
   when BACKUP_ENCRYPTION_KEY is set:
     {"_meta":{…}}                       first
     {"c":"streams","d":{…}}             one record per line, Extended JSON
                                         (ids, dates and files keep their type)
     {"_end":{"total":n,"stats":{…}}}    last: a file without it is cut short
   Written and read as a stream: a school is never held in memory at once.
   ============================================================ */
'use strict';

const fs       = require('fs');
const zlib     = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');
const { encryptFileStream, decryptFileStream, encryptReady } = require('./backupEncrypt');

const { EJSON } = mongoose.mongo.BSON;
const FORMAT = 'msingi-backup-4';

/* Not a school's own records, or of no use after a restore. */
const EXCLUDED = Object.freeze({
  // Sign-in and secrets: never in a file. People reset their password after a restore.
  identities: 'password hashes, shared across schools', sessions: 'sign-ins', login_failures: 'sign-in attempts',
  security_events: 'sign-in monitoring', mobile_devices: 'phone push tokens', elearning_tokens: 'Google access tokens (teachers reconnect)',
  child_link_codes: 'one-time codes',
  // Work in progress, rebuilt or re-run by itself.
  queue_jobs: 'job queue', notification_digests: 'emails waiting to go', email_failures: 'email delivery log',
  birthday_sent: 'sent markers', smart_reminder_runs: 'sent markers', app_migrations: 'server bookkeeping',
  // The platform's own, not a school's.
  backup_logs: 'the backups\' own log', platform_operators: 'platform staff', platform_settings: 'platform', landing_content: 'website',
  system_announcements: 'platform notices', release_certificates: 'platform', organizations: 'platform', demo_requests: 'sales',
  referral_partners: 'referrals', referral_conversions: 'referrals', referral_payout_requests: 'referrals',
  platform_error_samples: 'telemetry', platform_health_samples: 'telemetry', platform_school_day: 'telemetry', platform_school_hour: 'telemetry',
  platform_traffic_day: 'telemetry', platform_traffic_hour: 'telemetry', platform_traffic_min: 'telemetry', platform_user_days: 'telemetry',
});

/* Credentials never leave the server, whichever screen or file asks. */
const SECRET_USER_KEY = /^(password|passwordHash|pinHash|tempPassword|mfaOtp|mfaExpiry)$|(Secret|Hash|Otp)$|^(reset|invite|verify|activation).*Token/i;
function clean(col, doc) {
  if (col === 'users') return Object.fromEntries(Object.entries(doc).filter(([k]) => !SECRET_USER_KEY.test(k)));
  if (col === 'schools') { const { smtpPassEnc, mpesa, ...rest } = doc; return rest; }
  return doc;
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Both forms a school is referred to by (older records hold its Mongo id). */
function schoolForms(school) {
  return [...new Set([school.id, school._id && String(school._id)].filter(v => typeof v === 'string' && v))];
}

/** The records of `col` that belong to the school. */
function schoolFilter(col, school) {
  const forms = schoolForms(school);
  if (col === 'schools') return { _id: school._id };
  // Number sequences (admission, receipt…): the school is inside the key.
  if (col === 'counters') return { _id: { $regex: `(^|_)(${forms.map(escapeRx).join('|')})(_|$)` } };
  return { schoolId: { $in: forms } };
}

/** Is this record the school's? Checked again on restore, whatever the file says. */
function belongsTo(col, doc, school) {
  const forms = schoolForms(school);
  if (col === 'schools') return forms.includes(doc.id) || forms.includes(String(doc._id));
  if (col === 'counters') return new RegExp(`(^|_)(${forms.map(escapeRx).join('|')})(_|$)`).test(String(doc._id));
  return forms.includes(doc.schoolId);
}

/** Every collection that may hold a school's records, by name. */
async function backupCollections(db) {
  const all = await db.listCollections({}, { nameOnly: false }).toArray();
  return all
    .filter(c => (c.type ?? 'collection') === 'collection' && !c.name.startsWith('system.') && !EXCLUDED[c.name])
    .map(c => c.name).sort();
}

/** { c, d } for each of the school's records, a batch at a time. `stats` is filled as it goes. */
async function* schoolRecords(db, school, stats = {}) {
  for (const c of await backupCollections(db)) {
    let n = 0;
    const cursor = db.collection(c).find(schoolFilter(c, school), { batchSize: 200 });
    try {
      for await (const d of cursor) { n += 1; yield { c, d: clean(c, d) }; }
    } finally { await cursor.close().catch(() => {}); }
    if (n) stats[c] = n;
  }
}

const sum = (stats) => Object.values(stats).reduce((a, b) => a + b, 0);

/** Writes the school's backup to filePath. Returns { total, stats, bytes, encrypted }. */
async function writeBackupFile(db, school, filePath, meta = {}) {
  const stats = {};
  async function* lines() {
    yield `${JSON.stringify({ _meta: { format: FORMAT, schoolId: school.id ?? String(school._id), schoolName: school.name ?? '', exportedAt: new Date().toISOString(), ...meta, warning: 'Sensitive school data. Store securely and do not share.' } })}\n`;
    for await (const r of schoolRecords(db, school, stats)) yield `{"c":${JSON.stringify(r.c)},"d":${EJSON.stringify(r.d, { relaxed: true })}}\n`;
    yield `${JSON.stringify({ _end: { total: sum(stats), stats } })}\n`;
  }
  const encrypted = encryptReady();
  const gzip = zlib.createGzip();
  if (encrypted) await encryptFileStream(Readable.from(lines()), gzip, filePath);
  else await pipeline(Readable.from(lines()), gzip, fs.createWriteStream(filePath));
  return { total: sum(stats), stats, bytes: fs.statSync(filePath).size, encrypted };
}

/**
 * The lines of a backup file, parsed: { meta } | { c, d } | { end }.
 * Throws when the file is damaged, cut short, or was encrypted with another key.
 */
async function* readBackupFile(filePath) {
  const encrypted = filePath.endsWith('.enc');
  const gunzip = zlib.createGunzip();
  const src = encrypted ? decryptFileStream(filePath) : fs.createReadStream(filePath);
  src.on('error', e => gunzip.destroy(e));
  src.pipe(gunzip);
  const rl = readline.createInterface({ input: gunzip, crlfDelay: Infinity });
  let failed = null;
  gunzip.on('error', e => { failed = e; rl.close(); });
  const seen = {};
  let ended = null;
  let first = true;
  for await (const line of rl) {
    if (!line) continue;
    if (first) {
      first = false;
      const meta = JSON.parse(line)._meta;
      if (meta?.format !== FORMAT) throw new Error('This is not a Msingi backup this version can read.');
      yield { meta };
      continue;
    }
    if (line.startsWith('{"_end":')) { ended = JSON.parse(line)._end; continue; }
    const r = EJSON.parse(line, { relaxed: true });
    seen[r.c] = (seen[r.c] || 0) + 1;
    yield { c: r.c, d: r.d };
  }
  if (failed) throw new Error(`The backup file could not be opened: it is damaged${encrypted ? ', or BACKUP_ENCRYPTION_KEY is not the key it was written with' : ''} (${failed.message}).`);
  if (!ended) throw new Error('The backup file is cut short.');
  const same = sum(seen) === ended.total && Object.entries(ended.stats).every(([k, n]) => seen[k] === n);
  if (!same) throw new Error('The backup file does not hold the records it lists.');
  yield { end: ended };
}

/** Reads the whole file back. Returns { meta, total, stats } or throws. */
async function verifyBackupFile(filePath) {
  let meta = null;
  let end = null;
  for await (const r of readBackupFile(filePath)) { if (r.meta) meta = r.meta; if (r.end) end = r.end; }
  return { meta, ...end };
}

/** The school's own record, as saved in the file. */
async function schoolInFile(filePath) {
  for await (const r of readBackupFile(filePath)) if (r.c === 'schools') return r.d;
  return null;
}

/**
 * What a restore would add, and (apply) adds it: records in the file that the
 * database no longer has, matched by _id. Never changes or removes a record.
 * @returns {Promise<{collections: Object<string,{inBackup,missing,added,refused}>}>}
 */
async function restoreMissing(db, filePath, school, { only = null, apply = false } = {}) {
  // First pass: the whole file is sound, and every record is this school's, before anything is written.
  for await (const r of readBackupFile(filePath)) {
    if (r.c && !belongsTo(r.c, r.d, school)) throw new Error(`A record in ${r.c} belongs to another school. Nothing was written.`);
  }
  const out = {};
  let batch = [];
  let current = null;
  const flush = async () => {
    if (!batch.length) return;
    const s = out[current];
    const have = new Set((await db.collection(current).find({ _id: { $in: batch.map(d => d._id) } }, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
    const missing = batch.filter(d => !have.has(String(d._id)));
    s.missing += missing.length;
    if (apply && missing.length) {
      try { s.added += (await db.collection(current).insertMany(missing, { ordered: false })).insertedCount; } catch (err) {
        // A unique rule (say the same email on a newer account) refuses that record; the rest go in.
        if (err?.code !== 11000 && !(err?.writeErrors?.length)) throw err;
        const added = err.insertedCount ?? err.result?.insertedCount ?? 0;
        s.added += added;
        s.refused += missing.length - added;
      }
    }
    batch = [];
  };
  for await (const r of readBackupFile(filePath)) {
    if (!r.c) continue;
    if (EXCLUDED[r.c] || (only && !only.includes(r.c))) continue;
    if (r.c !== current) { await flush(); current = r.c; }
    const s = out[r.c] = out[r.c] || { inBackup: 0, missing: 0, added: 0, refused: 0 };
    s.inBackup += 1;
    batch.push(r.d);
    if (batch.length >= 300) await flush();
  }
  await flush();
  return { collections: out };
}

module.exports = {
  FORMAT, EXCLUDED, clean, schoolForms, schoolFilter, belongsTo, backupCollections, schoolRecords,
  writeBackupFile, readBackupFile, verifyBackupFile, schoolInFile, restoreMissing,
};
