/* ============================================================
   Firebase Admin — one initialisation for the whole server.

   Two features hang off the same service account, which is why this lives
   in its own module rather than inside either caller:
     - the mobile app's Google sign-in  (auth.js: verifyIdToken)
     - push notifications               (utils/push.js: messaging)

   It is deliberately LAZY and NULLABLE: nothing here may stop the server
   from booting, and a deployment that has not set up Firebase yet must get
   a clear "not configured" answer rather than a crash or a hung request.
   Callers check isFirebaseConfigured() and answer 503 — which is exactly
   what the app shows on the Google button until Phase 0b's project exists.

   Credentials, in order of preference:
     FIREBASE_SERVICE_ACCOUNT        — the service-account JSON, as a string
     FIREBASE_SERVICE_ACCOUNT_BASE64 — the same JSON, base64 (for env vars
                                       that dislike newlines/quotes)
     GOOGLE_APPLICATION_CREDENTIALS  — a file path (ADC, firebase-admin default)
   ============================================================ */
'use strict';

let _app = null;
let _tried = false;

function _credentialFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    : process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) return null; // fall through to ADC if a credentials path is set

  try {
    const parsed = JSON.parse(raw);
    // .env files escape newlines inside the private key as literal "\n"
    if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed;
  } catch (err) {
    console.error('[firebase] FIREBASE_SERVICE_ACCOUNT is not valid JSON —', err.message);
    return null;
  }
}

/** True when a service account is configured — never creates the app. */
function isFirebaseConfigured() {
  return Boolean(_credentialFromEnv() || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

/**
 * The lazily-initialised admin app, or null when Firebase is not configured.
 * Never throws: a misconfiguration is a logged warning and a null.
 */
function getFirebaseAdmin() {
  if (_app) return _app;
  if (_tried) return null;   // one attempt per process — no retry storms
  _tried = true;

  const credential = _credentialFromEnv();
  if (!credential && !process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;

  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    console.warn('[firebase] firebase-admin is not installed — Google sign-in and push are off.');
    return null;
  }

  try {
    const existing = admin.apps?.length ? admin.app() : null;
    _app = existing || admin.initializeApp({
      credential: credential ? admin.credential.cert(credential) : admin.credential.applicationDefault(),
    });
    return _app;
  } catch (err) {
    console.error('[firebase] initialiseApp failed:', err.message);
    return null;
  }
}

/** Verify a Firebase ID token from the app. Throws when unconfigured or invalid. */
async function verifyIdToken(idToken) {
  const admin = getFirebaseAdmin();
  if (!admin) {
    const err = new Error('Google sign-in is not configured on this server.');
    err.code = 'GOOGLE_NOT_CONFIGURED';
    throw err;
  }
  return admin.auth().verifyIdToken(idToken);
}

module.exports = { getFirebaseAdmin, isFirebaseConfigured, verifyIdToken };
