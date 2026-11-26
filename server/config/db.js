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
    // Mongoose's defaults are bufferCommands=true with a 10s bufferTimeoutMS.
    // On a brief reconnect every in-flight query therefore waits ~10s and
    // then either fails or (where a route swallows the error) returns a slow
    // empty 200 — exactly the "p95 10,000ms, 0% 5xx" signature in Live
    // Analytics. Bound the buffer so a disconnect shows up as a fast,
    // observable failure instead of a hidden multi-second stall. Keep the
    // initial server-selection timeout generous enough for Atlas cold starts.
    await mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB_NAME || 'innolearn',
      bufferTimeoutMS: Number(process.env.MONGO_BUFFER_TIMEOUT_MS || 2000),
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 15000),
    });
    _connected = true;
    console.log('[DB] MongoDB connected.');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { connect, isConnected: () => _connected };
