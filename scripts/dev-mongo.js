/**
 * Local development MongoDB.
 *
 * Starts a MongoDB server on 127.0.0.1:27017 with data persisted to
 * `.local-mongo/` so demo data survives restarts. Uses mongodb-memory-server
 * (already a devDependency) so no system-wide MongoDB install is required.
 *
 * Usage:  node scripts/dev-mongo.js
 *
 * Data lives in `.local-mongo/` (git-ignored). This is a development
 * database, not a backup: deleting the folder re-seeds the demo school on
 * the next server start but loses everything else.
 */
const path = require('path');
const fs = require('fs');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PORT = Number(process.env.DEV_MONGO_PORT) || 27017;

(async () => {
  const dbPath = path.join(__dirname, '..', '.local-mongo');
  fs.mkdirSync(dbPath, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: {
      port: PORT,
      ip: '127.0.0.1',
      dbPath,
      storageEngine: 'wiredTiger',
    },
  });

  console.log(`[dev-mongo] MongoDB running at ${server.getUri()} (data: ${dbPath})`);

  const shutdown = async () => {
    console.log('\n[dev-mongo] Shutting down...');
    await server.stop({ doCleanup: false, force: true });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  if (/address already in use|EADDRINUSE/i.test(err.message || '')) {
    console.error(`[dev-mongo] Port ${PORT} is already in use — is another MongoDB already running?`);
  } else {
    console.error('[dev-mongo] Failed to start:', err.message || err);
  }
  process.exit(1);
});
