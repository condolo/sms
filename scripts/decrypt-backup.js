#!/usr/bin/env node
/* ============================================================
   Msingi — Backup Decryption CLI
   Decrypts a .json.enc backup file produced by backup-cron.js.

   Usage:
     node scripts/decrypt-backup.js <path-to-file.json.enc> [output-path]

   Examples:
     # Decrypt to a new file next to the source
     node scripts/decrypt-backup.js backups/Msingi_Backup_School_2026-06-13.json.enc

     # Decrypt to a specific output path
     node scripts/decrypt-backup.js backups/Msingi_Backup_School_2026-06-13.json.enc /tmp/restored.json

     # Pipe to jq for inspection
     node scripts/decrypt-backup.js backups/Msingi_Backup_School_2026-06-13.json.enc - | jq '._meta'

   Requirements:
     BACKUP_ENCRYPTION_KEY must be set in the environment (same key used during backup).
     Load from .env:  node -e "require('dotenv').config()" && node scripts/decrypt-backup.js ...
     Or inline:       BACKUP_ENCRYPTION_KEY=<key> node scripts/decrypt-backup.js ...
   ============================================================ */
'use strict';

// Load .env if present (non-fatal if not found)
try { require('dotenv').config(); } catch (_) {}

const fs   = require('fs');
const path = require('path');
const { decrypt } = require('../server/utils/backupEncrypt');

const [,, inputArg, outputArg] = process.argv;

if (!inputArg) {
  console.error('Usage: node scripts/decrypt-backup.js <file.json.enc> [output.json | -]');
  console.error('  Use "-" as output to write plaintext JSON to stdout.');
  process.exit(1);
}

const inputPath = path.resolve(inputArg);

if (!fs.existsSync(inputPath)) {
  console.error(`Error: file not found — ${inputPath}`);
  process.exit(1);
}

if (!inputPath.endsWith('.json.enc')) {
  console.error(`Warning: file does not end with .json.enc — proceeding anyway.`);
}

let plaintext;
try {
  const buf = fs.readFileSync(inputPath);
  plaintext = decrypt(buf);
} catch (err) {
  console.error(`Decryption failed: ${err.message}`);
  console.error('Make sure BACKUP_ENCRYPTION_KEY matches the key used when the backup was created.');
  process.exit(1);
}

// Validate the decrypted content is valid JSON
let parsed;
try {
  parsed = JSON.parse(plaintext);
} catch {
  console.error('Decryption succeeded but output is not valid JSON — file may be corrupt.');
  process.exit(1);
}

const outputTo = outputArg || inputPath.replace(/\.enc$/, '');

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
  console.log(`✅ Decrypted successfully → ${outputPath}`);
  console.log(`   School:  ${meta.schoolName || 'unknown'}`);
  console.log(`   Records: ${meta.totalRecords ?? 'unknown'}`);
  console.log(`   Date:    ${meta.exportedAt  || 'unknown'}`);
}
