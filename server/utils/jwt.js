const jwt = require('jsonwebtoken');

const SECRET  = process.env.JWT_SECRET  || 'dev_secret_change_in_production';
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

function verify(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

module.exports = { sign, verify };
