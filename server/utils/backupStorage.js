/* ============================================================
   Msingi — Cloud Backup Storage Utility
   Uploads/downloads/lists/deletes encrypted backup files using
   the S3-compatible API (works with AWS S3, Cloudflare R2,
   Backblaze B2, DigitalOcean Spaces, MinIO).

   Required env vars:
     BACKUP_S3_BUCKET          — bucket name
     BACKUP_S3_REGION          — region (use "auto" for Cloudflare R2)
     AWS_ACCESS_KEY_ID         — access key ID
     AWS_SECRET_ACCESS_KEY     — secret access key

   Optional env vars:
     BACKUP_S3_ENDPOINT        — custom endpoint URL for non-AWS providers
                                  Cloudflare R2: https://<account_id>.r2.cloudflarestorage.com
                                  Backblaze B2:  https://s3.<region>.backblazeb2.com
                                  DO Spaces:     https://<region>.digitaloceanspaces.com
     BACKUP_S3_FORCE_PATH      — set to "true" for path-style access (R2, MinIO require this)

   Object key layout: backups/<YYYY-MM-DD>/<filename>
   storageReady() returns false when vars are missing — backup-cron
   degrades to local-disk mode with a warning rather than crashing.
   ============================================================ */
'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

let _client = null;

function _getClient() {
  if (_client) return _client;

  const region   = process.env.BACKUP_S3_REGION;
  const bucket   = process.env.BACKUP_S3_BUCKET;
  const key      = process.env.AWS_ACCESS_KEY_ID;
  const secret   = process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const pathStyle = process.env.BACKUP_S3_FORCE_PATH === 'true';

  if (!bucket || !region || !key || !secret) {
    throw new Error('[backupStorage] Missing required env vars: BACKUP_S3_BUCKET, BACKUP_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
  }

  const config = {
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: pathStyle,
  };
  if (endpoint) config.endpoint = endpoint;

  _client = new S3Client(config);
  return _client;
}

/**
 * Returns true if all required S3 env vars are present.
 */
function storageReady() {
  return !!(
    process.env.BACKUP_S3_BUCKET &&
    process.env.BACKUP_S3_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

function _bucket() {
  return process.env.BACKUP_S3_BUCKET;
}

/**
 * Upload an encrypted backup buffer to S3.
 * @param {string} filename  — e.g. "Msingi_Backup_School_2026-06-13.json.enc"
 * @param {Buffer} buffer    — encrypted binary produced by backupEncrypt.encrypt()
 * @param {string} dateStr   — "YYYY-MM-DD" used for key prefix
 * @returns {string}         — the S3 object key
 */
async function uploadBackup(filename, buffer, dateStr) {
  const client     = _getClient();
  const key        = `backups/${dateStr}/${filename}`;
  const encrypted  = filename.endsWith('.enc');

  await client.send(new PutObjectCommand({
    Bucket:      _bucket(),
    Key:         key,
    Body:        buffer,
    ContentType: encrypted ? 'application/octet-stream' : 'application/json',
    Metadata:    { 'msingi-encrypted': encrypted ? 'true' : 'false' },
  }));

  return key;
}

/**
 * List backup objects for a given school name prefix.
 * @param {string} schoolNameSlug  — e.g. "Greenfields_Academy"
 * @returns {Array<{ key, lastModified }>} sorted newest first
 */
async function listBackups(schoolNameSlug) {
  const client = _getClient();
  const prefix = `backups/`;

  const resp = await client.send(new ListObjectsV2Command({
    Bucket: _bucket(),
    Prefix: prefix,
  }));

  const objects = (resp.Contents || [])
    .filter(o => o.Key.includes(`/Msingi_Backup_${schoolNameSlug}_`))
    .map(o => ({ key: o.Key, lastModified: o.LastModified }))
    .sort((a, b) => b.lastModified - a.lastModified);  // newest first

  return objects;
}

/**
 * Delete an S3 object by key.
 * @param {string} key
 */
async function deleteBackup(key) {
  const client = _getClient();
  await client.send(new DeleteObjectCommand({ Bucket: _bucket(), Key: key }));
}

/**
 * Download a backup object as a Buffer.
 * @param {string} key  — full S3 object key
 * @returns {Buffer}
 */
async function downloadBackup(key) {
  const client = _getClient();
  const resp   = await client.send(new GetObjectCommand({ Bucket: _bucket(), Key: key }));

  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = { storageReady, uploadBackup, listBackups, deleteBackup, downloadBackup };
