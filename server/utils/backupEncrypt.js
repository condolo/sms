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

module.exports = { encrypt, decrypt, encryptReady };
