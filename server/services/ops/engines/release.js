/**
 * Release Engine
 * Generates and persists release certificates to the release_certificates
 * MongoDB collection. Also reads history for trend data.
 *
 * A certificate is:
 *   - Generated at deploy time (CI or manual)
 *   - Sealed with SHA-256 (detect tampering)
 *   - Stored in DB (queryable, not just JSON files)
 *   - Never mutated after creation (append-only)
 */
'use strict';

const crypto = require('crypto');
const { _model } = require('../../../utils/model');

const COLLECTION = 'release_certificates';

/**
 * Persist a certificate object to the DB.
 * Idempotent: if certId already exists, returns the existing doc.
 */
async function persist(cert) {
  return _model(COLLECTION).findOneAndUpdate(
    { certId: cert.certId },
    { $setOnInsert: { ...cert, _createdAt: new Date() } },
    { upsert: true, new: true }
  ).lean();
}

/**
 * Fetch the N most recent certificates for trend display.
 */
async function history({ limit = 30 } = {}) {
  return _model(COLLECTION)
    .find({})
    .sort({ _createdAt: -1 })
    .limit(limit)
    .select('certId version commit.short commit.message generatedAt verdict gates changes.criticalTouched changes.hasMigration safety')
    .lean();
}

/**
 * Fetch a single certificate by certId or version.
 */
async function get({ certId, version } = {}) {
  const filter = certId ? { certId } : { version };
  return _model(COLLECTION).findOne(filter).lean();
}

/**
 * Seal a certificate: compute SHA-256 over all fields (excluding the seal itself).
 */
function seal(cert) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ ...cert, seal: undefined }))
    .digest('hex');
}

/**
 * Verify a certificate's seal has not been tampered with.
 */
function verify(cert) {
  const expected = seal({ ...cert, seal: undefined });
  return expected === cert.seal;
}

module.exports = { persist, history, get, seal, verify };
