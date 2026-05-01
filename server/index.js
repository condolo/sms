/* ============================================================
   InnoLearn — API Server
   Node.js + Express + MongoDB
   Serves both the API (/api/*) and the static frontend
   ============================================================ */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { connect } = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3005;

/* ── Middleware ─────────────────────────────────────────────── */
app.use(cors({
  origin: (origin, cb) => cb(null, true),  // Allow all origins (tighten in prod if needed)
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));   // 10MB for bulk sync payloads
app.use(express.urlencoded({ extended: true }));

/* ── API Routes ─────────────────────────────────────────────── */
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/onboard',     require('./routes/onboard'));
app.use('/api/sync',        require('./routes/sync'));
app.use('/api/platform',    require('./routes/platform'));
app.use('/api/collections', require('./routes/collections'));

/* ── Health check ───────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.1.5',
    timestamp: new Date().toISOString(),
    db: require('./config/db').isConnected() ? 'connected' : 'disconnected'
  });
});

/* ── Static frontend ────────────────────────────────────────── */
const STATIC_DIR = path.join(__dirname, '..');
app.use(express.static(STATIC_DIR, {
  index: 'index.html',
  // Don't cache JS/CSS during development
  setHeaders: (res, filePath) => {
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // Onboarding page gets its own HTML
  if (req.path === '/onboard' || req.path === '/onboard/') {
    return res.sendFile(path.join(STATIC_DIR, 'onboard.html'));
  }
  // Platform admin dashboard (private — served as its own SPA)
  if (req.path === '/platform' || req.path === '/platform/') {
    return res.sendFile(path.join(STATIC_DIR, 'platform.html'));
  }
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

/* ── Error handler ──────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

/* ── Start ──────────────────────────────────────────────────── */
async function start() {
  await connect();   // Connect to MongoDB (no-op if MONGODB_URI not set)
  app.listen(PORT, () => {
    console.log(`\n🎓 InnoLearn API running on port ${PORT}`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/api/health`);
    console.log(`   Mode:    ${process.env.NODE_ENV || 'development'}\n`);
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
