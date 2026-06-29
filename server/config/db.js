const mongoose = require('mongoose');

let _connected = false;

async function connect() {
  if (_connected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[DB] MONGODB_URI not set — running in localStorage-only mode.');
    return;
  }
  try {
    // 'innolearn' is the Atlas database name used in production.
    // Do NOT change this fallback without a DB migration — it would silently
    // point to an empty database and appear to wipe all data.
    // Override via MONGODB_DB_NAME env var only when intentionally migrating.
    await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || 'innolearn' });
    _connected = true;
    console.log('[DB] MongoDB connected.');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { connect, isConnected: () => _connected };
