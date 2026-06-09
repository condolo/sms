/* ============================================================
   Msingi — SMTP Password Encryption Utility
   AES-256-GCM — authenticated encryption with random IV per call.

   Key source: SMTP_ENCRYPTION_KEY env var (32 bytes, base64-encoded).
   Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

   Stored format (in MongoDB smtpPassEnc field):
     <iv_hex>:<authTag_hex>:<ciphertext_hex>

   Both encrypt() and decrypt() throw if the key is missing or invalid.
   Callers should gate on smtpEncryptReady() before storing credentials.
   ============================================================ */
const crypto = require('crypto');

const ALG        = 'aes-256-gcm';
const IV_BYTES   = 16;    // GCM recommended IV length
const TAG_BYTES  = 16;    // GCM auth tag length (default)
const SEP        = ':';   // separator between stored parts

/* Lazy-load and cache the decoded key so the env var is read once */
let _key = null;

function _getKey() {
  if (_key) return _key;
  const raw = process.env.SMTP_ENCRYPTION_KEY;
  if (!raw) throw new Error('[smtpEncrypt] SMTP_ENCRYPTION_KEY env var is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error(`[smtpEncrypt] SMTP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}). Re-generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  _key = buf;
  return _key;
}

/**
 * Returns true if the encryption key is present and valid.
 * Use this to gate the custom-SMTP feature.
 */
function smtpEncryptReady() {
  try { _getKey(); return true; } catch { return false; }
}

/**
 * Encrypt a plaintext SMTP password.
 * @param {string} plaintext
 * @returns {string}  "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
function encrypt(plaintext) {
  const key    = _getKey();
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(SEP);
}

/**
 * Decrypt a stored SMTP password.
 * @param {string} stored  "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * @returns {string}  plaintext password
 */
function decrypt(stored) {
  const key = _getKey();
  const parts = stored.split(SEP);
  if (parts.length !== 3) throw new Error('[smtpEncrypt] Invalid stored format — expected iv:tag:ciphertext');
  const [ivHex, tagHex, ctHex] = parts;
  const iv      = Buffer.from(ivHex,  'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const ct      = Buffer.from(ctHex,  'hex');
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, smtpEncryptReady };
