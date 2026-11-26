#!/usr/bin/env node
/* ============================================================
   Are the nightly backups running, and do they hold everything? (v5.286.0)
   Reads only. Prints no record and no secret.

     node server/scripts/check-backups.js
   ============================================================ */
'use strict';
try { require('dotenv').config(); } catch (_) { /* optional */ }
const mongoose = require('mongoose');
const { EXCLUDED, backupCollections, schoolFilter } = require('../utils/school-backup');
const { encryptReady } = require('../utils/backupEncrypt');
const { storageReady } = require('../utils/backupStorage');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1); }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
  const db = mongoose.connection.db;
  console.log(`Encryption key: ${encryptReady() ? 'set' : 'NOT SET: backups are readable by anyone who gets the file'}`);
  console.log(`Cloud storage:  ${storageReady() ? 'set' : 'NOT SET: backups are on the server\'s own disk and are LOST at the next deploy'}`);
  console.log(`Days kept:      ${process.env.BACKUP_KEEP_DAYS || '7 (default)'}\n`);

  const cols = await backupCollections(db);
  const schools = await db.collection('schools').find({ status: { $nin: ['pending', 'rejected'] }, isDemo: { $ne: true }, demoRequestId: { $exists: false } }).toArray();
  for (const school of schools) {
    const schoolId = school.id ?? String(school._id);
    const log = (await db.collection('backup_logs').find({ schoolId, source: 'cron' }).sort({ createdAt: -1 }).limit(1).toArray())[0];
    const now = {};
    for (const c of cols) { const n = await db.collection(c).countDocuments(schoolFilter(c, school)); if (n) now[c] = n; }
    const total = Object.values(now).reduce((a, b) => a + b, 0);
    console.log(`${school.name || schoolId}: ${total} records now in ${Object.keys(now).length} kinds`);
    if (!log) { console.log('  NO nightly backup has ever been logged.\n'); continue; }
    const hours = Math.round((Date.now() - new Date(log.createdAt).getTime()) / 36e5);
    console.log(`  last: ${new Date(log.createdAt).toISOString()} (${hours} h ago)${hours > 26 ? ' LATE' : ''}${log.failed ? ` FAILED: ${log.error}` : `, ${log.totalRecords} records, ${log.encrypted ? 'encrypted' : 'NOT encrypted'}, ${log.cloudStorage ? 'cloud' : 'server disk'}${log.verified ? ', read back and checked' : ''}${log.shrunk ? ', MUCH SMALLER than the one before' : ''}`}`);
    const absent = Object.keys(now).filter(c => !(log.stats || {})[c]);
    if (!log.failed && absent.length) console.log(`  not in that backup: ${absent.map(c => `${c} (${now[c]})`).join(', ')}`);
    console.log('');
  }
  console.log(`Left out on purpose: ${Object.keys(EXCLUDED).join(', ')}`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err.message); process.exit(1); });
