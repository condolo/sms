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
    await mongoose.connect(uri, { dbName: 'innolearn' });
    _connected = true;
    console.log('[DB] MongoDB connected.');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { connect, isConnected: () => _connected };
