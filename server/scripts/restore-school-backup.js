#!/usr/bin/env node
/* ============================================================
   Put back records a school has lost, from a nightly backup (v5.286.0)

   Adds records that are in the backup and no longer in the database,
   matched by their own id. It never changes or deletes a record.
   Without --apply it only reports.

     node server/scripts/restore-school-backup.js --file <path>            report
     node server/scripts/restore-school-backup.js --key <S3 object key>    report
       --only streams,lesson_plans      these kinds of record only
       --apply --confirm <schoolId>     write

   A record someone deleted on purpose since the backup would come back:
   use --only. Not in a backup: passwords (people reset them), e-mail and
   M-Pesa settings, Google sign-ins, and files kept in file storage.

   Needs MONGODB_URI (and MONGODB_DB_NAME where the server uses it), and
   BACKUP_ENCRYPTION_KEY for an .enc file; --key also needs BACKUP_S3_* .
   ============================================================ */
'use strict';
try { require('dotenv').config(); } catch (_) { /* optional */ }
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { verifyBackupFile, schoolInFile, restoreMissing } = require('../utils/school-backup');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const die = (msg) => { console.error(msg); process.exit(1); };

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) die('MONGODB_URI is not set.');
  let file = arg('file');
  let tmp = null;
  if (arg('key')) {
    const { downloadBackup } = require('../utils/backupStorage');
    tmp = path.join(os.tmpdir(), path.basename(arg('key')));
    fs.writeFileSync(tmp, await downloadBackup(arg('key')));
    file = tmp;
  }
  if (!file) die('Give --file <path> or --key <S3 object key>.');

  try {
    const { meta, total } = await verifyBackupFile(file);
    console.log(`Backup of ${meta.schoolName} (${meta.schoolId}), ${meta.exportedAt}: ${total} records, file is complete.`);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...(process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {}) });
    const db = mongoose.connection.db;
    const live = await db.collection('schools').findOne({ id: meta.schoolId });
    const school = live || await schoolInFile(file);
    if (!school) die('The school is neither in the database nor in the file.');
    if (!live) console.log('This school is not in the database: its own record is in the file and would be added too.');

    const apply = process.argv.includes('--apply');
    if (apply && arg('confirm') !== meta.schoolId) die(`To write, add: --confirm ${meta.schoolId}`);
    const only = arg('only') ? arg('only').split(',').map(s => s.trim()).filter(Boolean) : null;

    const { collections } = await restoreMissing(db, file, school, { only, apply });
    let missing = 0;
    for (const [c, s] of Object.entries(collections).sort()) {
      missing += s.missing;
      if (s.missing) console.log(`  ${c.padEnd(30)} in backup ${s.inBackup}, missing ${s.missing}${apply ? `, added ${s.added}${s.refused ? `, refused ${s.refused} (a newer record uses the same unique value)` : ''}` : ''}`);
    }
    console.log(missing ? (apply ? 'Done.' : `${missing} record(s) would be added. Nothing was changed.`) : 'Nothing is missing.');
  } finally {
    if (tmp) fs.unlinkSync(tmp);
    await mongoose.disconnect();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
