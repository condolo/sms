/* ============================================================
   Msingi — Backup File Encryption Utility
   AES-256-GCM authenticated encryption, one random IV per file.

   Key source: BACKUP_ENCRYPTION_KEY env var (32 bytes, base64-encoded).
   Generate a key:
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

   Binary file layout (all written as a single Buffer):
     Bytes  0-15  : IV          (16 bytes, random per file)
     Bytes 16-31  : GCM auth tag (16 bytes — detects tampering)
     Bytes 32+    : Ciphertext  (encrypted UTF-8 JSON)

   Encrypted files use the extension .json.enc
   If BACKUP_ENCRYPTION_KEY is not set the module degrades gracefully:
     - encryptReady() returns false
     - encrypt() throws (caller should check encryptReady first)
     - cron skips encryption and writes plaintext .json with a warning
   ============================================================ */
'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const { pipeline } = require('stream/promises');

const ALG      = 'aes-256-gcm';
const IV_LEN   = 16;
const TAG_LEN  = 16;

let _key = null;

function _getKey() {
  if (_key) return _key;
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) throw new Error('[backupEncrypt] BACKUP_ENCRYPTION_KEY is not set. Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error(`[backupEncrypt] BACKUP_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`);
  _key = buf;
  return _key;
}

/**
 * Returns true if BACKUP_ENCRYPTION_KEY is present and valid.
 * Call this before encrypt() to decide whether to encrypt or skip.
 */
function encryptReady() {
  try { _getKey(); return true; } catch { return false; }
}

/**
 * Encrypt a JSON string.
 * @param   {string} plaintext  — the JSON backup string
 * @returns {Buffer}            — IV + authTag + ciphertext packed as a Buffer
 */
function encrypt(plaintext) {
  const key    = _getKey();
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();               // 16-byte authentication tag
  return Buffer.concat([iv, tag, ct]);              // layout: IV | tag | ciphertext
}

/**
 * Decrypt a Buffer produced by encrypt().
 * @param   {Buffer} buf  — raw file contents of a .json.enc file
 * @returns {string}      — original JSON plaintext
 */
function decrypt(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('[backupEncrypt] decrypt() expects a Buffer');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('[backupEncrypt] Buffer too short — file may be corrupt or not encrypted');
  const key      = _getKey();
  const iv       = buf.subarray(0, IV_LEN);
  const tag      = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct       = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * The same file layout, written as a stream (v5.286.0): the 32-byte head is
 * reserved, then filled in once the tag is known.
 */
async function encryptFileStream(source, transform, filePath) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, _getKey(), iv);
  fs.writeFileSync(filePath, Buffer.alloc(IV_LEN + TAG_LEN));
  await pipeline(source, transform, cipher, fs.createWriteStream(filePath, { flags: 'r+', start: IV_LEN + TAG_LEN }));
  const fd = fs.openSync(filePath, 'r+');
  try { fs.writeSync(fd, Buffer.concat([iv, cipher.getAuthTag()]), 0, IV_LEN + TAG_LEN, 0); } finally { fs.closeSync(fd); }
}

/** Decrypted stream of a file in that layout. Emits 'error' if it was altered or the key is wrong. */
function decryptFileStream(filePath) {
  const head = Buffer.alloc(IV_LEN + TAG_LEN);
  const fd = fs.openSync(filePath, 'r');
  try {
    if (fs.readSync(fd, head, 0, head.length, 0) < head.length) throw new Error('[backupEncrypt] File too short: corrupt or not encrypted');
  } finally { fs.closeSync(fd); }
  const decipher = crypto.createDecipheriv(ALG, _getKey(), head.subarray(0, IV_LEN));
  decipher.setAuthTag(head.subarray(IV_LEN));
  const src = fs.createReadStream(filePath, { start: IV_LEN + TAG_LEN });
  src.on('error', e => decipher.destroy(e));
  return src.pipe(decipher);
}

module.exports = { encrypt, decrypt, encryptReady, encryptFileStream, decryptFileStream };
