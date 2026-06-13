#!/usr/bin/env node
/* ============================================================
   Msingi — Backup Decryption CLI
   Decrypts a .json.enc backup file produced by backup-cron.js.

   Usage (local file):
     node scripts/decrypt-backup.js <path-to-file.json.enc> [output-path]

   Usage (download from S3 then decrypt):
     node scripts/decrypt-backup.js --from-s3 <s3-object-key> [output-path]

   Examples:
     # Decrypt a local file
     node scripts/decrypt-backup.js backups/Msingi_Backup_School_2026-06-13.json.enc

     # Decrypt to a specific output path
     node scripts/decrypt-backup.js backups/Msingi_Backup_School_2026-06-13.json.enc /tmp/restored.json

     # Pipe to jq for inspection
     node scripts/decrypt-backup.js backups/Msingi_Backup_School_2026-06-13.json.enc - | jq '._meta'

     # Download from S3 and decrypt
     node scripts/decrypt-backup.js --from-s3 backups/2026-06-13/Msingi_Backup_School_2026-06-13.json.enc

     # Download from S3, decrypt, pipe to stdout
     node scripts/decrypt-backup.js --from-s3 backups/2026-06-13/Msingi_Backup_School_2026-06-13.json.enc -

   Requirements:
     BACKUP_ENCRYPTION_KEY must be set (same key used during backup).
     For --from-s3: also set BACKUP_S3_BUCKET, BACKUP_S3_REGION,
                    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
     Load from .env: node -r dotenv/config scripts/decrypt-backup.js ...
   ============================================================ */
'use strict';

// Load .env if present (non-fatal if not found)
try { require('dotenv').config(); } catch (_) {}

const fs   = require('fs');
const path = require('path');
const { decrypt }       = require('../server/utils/backupEncrypt');
const { downloadBackup, storageReady } = require('../server/utils/backupStorage');

const args = process.argv.slice(2);

function usage() {
  console.error('Usage:');
  console.error('  Local:  node scripts/decrypt-backup.js <file.json.enc> [output.json | -]');
  console.error('  Cloud:  node scripts/decrypt-backup.js --from-s3 <s3-key> [output.json | -]');
  console.error('  Use "-" as output to write plaintext JSON to stdout.');
}

if (!args.length) {
  usage();
  process.exit(1);
}

let fromS3 = false;
let inputArg, outputArg;

if (args[0] === '--from-s3') {
  fromS3    = true;
  inputArg  = args[1];
  outputArg = args[2];
  if (!inputArg) {
    console.error('Error: --from-s3 requires an S3 object key.');
    usage();
    process.exit(1);
  }
} else {
  inputArg  = args[0];
  outputArg = args[1];
}

async function main() {
  let buf;

  if (fromS3) {
    if (!storageReady()) {
      console.error('Error: cloud storage env vars not set (BACKUP_S3_BUCKET, BACKUP_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).');
      process.exit(1);
    }
    console.error(`Downloading s3://${process.env.BACKUP_S3_BUCKET}/${inputArg} …`);
    try {
      buf = await downloadBackup(inputArg);
    } catch (err) {
      console.error(`Download failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    const inputPath = path.resolve(inputArg);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: file not found — ${inputPath}`);
      process.exit(1);
    }
    if (!inputPath.endsWith('.json.enc')) {
      console.error(`Warning: file does not end with .json.enc — proceeding anyway.`);
    }
    buf = fs.readFileSync(inputPath);
  }

  let plaintext;
  try {
    plaintext = decrypt(buf);
  } catch (err) {
    console.error(`Decryption failed: ${err.message}`);
    console.error('Make sure BACKUP_ENCRYPTION_KEY matches the key used when the backup was created.');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    console.error('Decryption succeeded but output is not valid JSON — file may be corrupt.');
    process.exit(1);
  }

  // Determine output filename
  const basename = fromS3
    ? path.basename(inputArg).replace(/\.enc$/, '')
    : path.resolve(inputArg).replace(/\.enc$/, '');

  const outputTo = outputArg || basename;

  if (outputTo === '-') {
    process.stdout.write(plaintext);
  } else {
    const outputPath = path.resolve(outputTo);
    if (fs.existsSync(outputPath)) {
      console.error(`Error: output file already exists — ${outputPath}`);
      console.error('Delete it first or specify a different output path.');
      process.exit(1);
    }
    fs.writeFileSync(outputPath, plaintext, 'utf8');
    const meta = parsed._meta || {};
    console.log(`Decrypted successfully → ${outputPath}`);
    console.log(`   School:  ${meta.schoolName || 'unknown'}`);
    console.log(`   Records: ${meta.totalRecords ?? 'unknown'}`);
    console.log(`   Date:    ${meta.exportedAt  || 'unknown'}`);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
