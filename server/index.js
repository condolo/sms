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

/* ── Security: warn if JWT_SECRET not set ───────────────────── */
if (!process.env.JWT_SECRET) {
  console.warn('\n⚠️  [Security] JWT_SECRET env var is NOT set — using insecure default. Set it in your .env file or Render dashboard!\n');
}

const app  = express();
const PORT = process.env.PORT || 3005;

/* ── Security headers (helmet) ──────────────────────────────── */
try {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: false,  // allow inline scripts in SPA
    crossOriginEmbedderPolicy: false
  }));
  console.log('[Security] helmet headers active');
} catch {
  console.warn('[Security] helmet not installed — run: npm install helmet');
}

/* ── CORS ───────────────────────────────────────────────────── */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
ALLOWED_ORIGINS.push(
  'https://school-management-ecosystem.onrender.com',
  'http://localhost:3005',
  'http://localhost:3000',
  'http://127.0.0.1:3005'
);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // Allow if origin is in the list OR we're not in production
    if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production') {
      return cb(null, true);
    }
    // Block unknown origins in production
    console.warn(`[CORS] Blocked origin: ${origin}`);
    cb(new Error('Not allowed by CORS'));
  },
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
app.use('/api/users',       require('./routes/users'));
app.use('/api/backup',      require('./routes/backup'));

/* ── Phase 1: Production resource routes (RBAC + paginated) ─── */
app.use('/api/students',    require('./routes/students'));
app.use('/api/teachers',    require('./routes/teachers'));
app.use('/api/classes',     require('./routes/classes'));
app.use('/api/attendance',  require('./routes/attendance'));
app.use('/api/finance',     require('./routes/finance'));

/* ── School-facing announcement routes (JWT auth, not platform key) ── */
const { authMiddleware } = require('./middleware/auth');
const { _model: _m }    = require('./utils/model');

/* GET /api/announcements — returns active, non-expired, non-dismissed announcements for this school */
app.get('/api/announcements', authMiddleware, async (req, res) => {
  try {
    const Ann  = _m('system_announcements');
    const now  = new Date().toISOString();
    const schoolId = req.jwtUser.schoolId;
    const list = await Ann.find({
      status: 'active',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      dismissedBy: { $nin: [schoolId] }
    }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch announcements' }); }
});

/* POST /api/announcements/:id/dismiss — per-school dismiss */
app.post('/api/announcements/:id/dismiss', authMiddleware, async (req, res) => {
  try {
    const Ann = _m('system_announcements');
    await Ann.updateOne({ id: req.params.id }, { $addToSet: { dismissedBy: req.jwtUser.schoolId } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to dismiss' }); }
});

/* ── Health check ───────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
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
