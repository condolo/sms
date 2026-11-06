/* ============================================================
   Msingi — assignment attachment storage

   Two modes:
     • s3    — when ASSIGNMENT_S3_BUCKET/REGION are configured, the
               client uploads directly with a presigned PUT and downloads
               with a short-lived presigned GET. Node never buffers a file.
     • local — development / small deployments: the server stores the
               file under server/uploads and serves it through an
               access-checked route.

   Object key layout is tenant/assignment/student scoped:
     schools/<schoolId>/assignments/<assignmentId>/<studentId|teacher>/<attId>-<name>
   ============================================================ */
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const LOCAL_ROOT = path.join(__dirname, '..', 'uploads', 'assignments');

function storageMode() {
  return process.env.ASSIGNMENT_S3_BUCKET && process.env.ASSIGNMENT_S3_REGION ? 's3' : 'local';
}

let _client = null;
function _s3() {
  if (_client) return _client;
  const config = {
    region: process.env.ASSIGNMENT_S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: process.env.ASSIGNMENT_S3_FORCE_PATH === 'true',
  };
  if (process.env.ASSIGNMENT_S3_ENDPOINT) config.endpoint = process.env.ASSIGNMENT_S3_ENDPOINT;
  _client = new S3Client(config);
  return _client;
}

function safeName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80) || 'file';
}

function buildKey({ schoolId, assignmentId, studentId, attachmentId, fileName }) {
  return [
    'schools', schoolId, 'assignments', assignmentId,
    studentId || 'teacher', `${attachmentId}-${safeName(fileName)}`,
  ].join('/');
}

function localPath(key) {
  const full = path.resolve(LOCAL_ROOT, key);
  if (!full.startsWith(path.resolve(LOCAL_ROOT) + path.sep)) {
    throw new Error('Invalid attachment key');
  }
  return full;
}

async function presignPut(key, contentType, expiresIn = 300) {
  return getSignedUrl(_s3(), new PutObjectCommand({
    Bucket: process.env.ASSIGNMENT_S3_BUCKET,
    Key: key,
    ContentType: contentType,
  }), { expiresIn });
}

async function presignGet(key, expiresIn = 60) {
  return getSignedUrl(_s3(), new GetObjectCommand({
    Bucket: process.env.ASSIGNMENT_S3_BUCKET,
    Key: key,
  }), { expiresIn });
}

async function putObject(key, buffer, contentType) {
  await _s3().send(new PutObjectCommand({
    Bucket: process.env.ASSIGNMENT_S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

async function headObject(key) {
  const out = await _s3().send(new HeadObjectCommand({
    Bucket: process.env.ASSIGNMENT_S3_BUCKET,
    Key: key,
  }));
  return { exists: true, size: out.ContentLength ?? null, contentType: out.ContentType ?? null };
}

async function getObjectStream(key) {
  const out = await _s3().send(new GetObjectCommand({
    Bucket: process.env.ASSIGNMENT_S3_BUCKET,
    Key: key,
  }));
  return out.Body;
}

async function saveLocal(key, buffer) {
  const full = localPath(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer);
}

async function localStat(key) {
  try {
    const st = await fsp.stat(localPath(key));
    return { exists: true, size: st.size };
  } catch {
    return { exists: false, size: null };
  }
}

async function readLocal(key) {
  return fsp.readFile(localPath(key));
}

async function deleteObject(key) {
  if (storageMode() === 's3') {
    await _s3().send(new DeleteObjectCommand({
      Bucket: process.env.ASSIGNMENT_S3_BUCKET,
      Key: key,
    })).catch(() => {});
  } else {
    await fsp.unlink(localPath(key)).catch(() => {});
  }
}

module.exports = {
  storageMode, buildKey, presignPut, presignGet, putObject, headObject, getObjectStream,
  saveLocal, localStat, readLocal, deleteObject, localPath,
};
