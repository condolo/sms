const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] JWT_SECRET env var is not set in production. Refusing to start with insecure default.');
  process.exit(1);
}

const SECRET  = process.env.JWT_SECRET  || 'dev_secret_change_in_production';
const EXPIRES = process.env.JWT_EXPIRES_IN || '24h';  // reduced from 7d — stolen token window

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

function verify(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

module.exports = { sign, verify };
