/* ============================================================
   InnoLearn — API Server
   Node.js + Express + MongoDB
   Serves both the API (/api/*) and the static frontend
   ============================================================ */
require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { connect }             = require('./config/db');
const { ensureIndexes }       = require('./utils/indexes');
const { repairPermissions }   = require('./utils/repairPermissions');
const { seedDemo }            = require('./scripts/seed-demo');

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
  'https://msingi.io',
  'https://www.msingi.io',
  'http://localhost:3005',
  'http://localhost:3000',
  'http://127.0.0.1:3005'
);

// Regex: allow any *.msingi.io subdomain (school portals live here)
const MSINGI_SUBDOMAIN_RE = /^https:\/\/[a-z0-9][a-z0-9-]*\.msingi\.io$/;

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // Allow explicit list OR any *.msingi.io subdomain OR non-production
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      MSINGI_SUBDOMAIN_RE.test(origin) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return cb(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));   // 10MB for bulk sync payloads
app.use(express.urlencoded({ extended: true }));

/* ── Rate limiting ──────────────────────────────────────────── */
// General limiter: 300 requests per 15 min per IP across all /api/* routes
const apiLimiter = rateLimit({
  windowMs:          15 * 60 * 1000,
  max:               300,
  standardHeaders:   true,   // Return rate-limit info in RateLimit-* headers
  legacyHeaders:     false,
  message:           { error: 'Too many requests — please slow down and try again shortly.' },
  skip: (req) => process.env.NODE_ENV !== 'production', // disabled in dev/test
});

// Strict auth limiter: 20 attempts per 15 min per IP — blocks brute-force
const authLimiter = rateLimit({
  windowMs:          15 * 60 * 1000,
  max:               20,
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { error: 'Too many login attempts — please wait 15 minutes before trying again.' },
  // Always enforce, even in development, so the behaviour is testable
});

app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);   // applied on top of the general limiter

console.log('[Security] rate limiting active — general: 300/15min, auth: 20/15min');

/* ── API Routes ─────────────────────────────────────────────── */
app.use('/api/public',      require('./routes/public'));   // no auth — school branding
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/onboard',     require('./routes/onboard'));
app.use('/api/sync',        require('./routes/sync'));
app.use('/api/platform',    require('./routes/platform'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/backup',      require('./routes/backup'));

/* ── Phase 1+2: Production resource routes (RBAC + paginated) ── */
app.use('/api/students',        require('./routes/students'));
app.use('/api/teachers',        require('./routes/teachers'));
app.use('/api/classes',         require('./routes/classes'));
app.use('/api/attendance',      require('./routes/attendance'));
app.use('/api/finance',         require('./routes/finance'));
app.use('/api/behaviour',       require('./routes/behaviour'));
app.use('/api/exams',           require('./routes/exams'));
app.use('/api/grades',          require('./routes/grades'));
app.use('/api/admissions',      require('./routes/admissions'));
app.use('/api/timetable',       require('./routes/timetable'));
app.use('/api/messages',        require('./routes/messages'));
app.use('/api/academic-config', require('./routes/academic-config'));
app.use('/api/assessment',      require('./routes/assessment'));
app.use('/api/report-cards',   require('./routes/report-cards'));
app.use('/api/import-export',  require('./routes/import-export'));

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
    version: '4.9.7',
    timestamp: new Date().toISOString(),
    db: require('./config/db').isConnected() ? 'connected' : 'disconnected'
  });
});

/* ── Static frontend ────────────────────────────────────────── */
const ROOT_DIR   = path.join(__dirname, '..');
const REACT_DIST = path.join(__dirname, '..', 'client', 'dist');
const fs         = require('fs');
const reactBuilt = fs.existsSync(path.join(REACT_DIST, 'index.html'));

// In production, prefer the compiled React app; fall back to legacy app root.
const STATIC_DIR = (process.env.NODE_ENV === 'production' && reactBuilt) ? REACT_DIST : ROOT_DIR;

// Serve React build assets (hashed filenames → long cache)
if (reactBuilt) {
  app.use(express.static(REACT_DIST, {
    index: false,   // SPA fallback handled below
    setHeaders: (res, filePath) => {
      if (/\.[0-9a-f]{8}\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
}

// Serve legacy vanilla-JS static assets (css, js, images, html files)
// index:false — do NOT auto-serve index.html for /, that is handled by the
// SPA fallback route below so the React app takes precedence when built.
app.use(express.static(ROOT_DIR, {
  index: false,
  setHeaders: (res) => {
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// SPA fallback — serve the appropriate index.html for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // Onboarding page gets its own HTML
  if (req.path === '/onboard' || req.path === '/onboard/') {
    return res.sendFile(path.join(ROOT_DIR, 'onboard.html'));
  }
  // Platform admin dashboard
  if (req.path === '/platform' || req.path === '/platform/') {
    return res.sendFile(path.join(ROOT_DIR, 'platform.html'));
  }
  // React SPA routes (/dashboard, /students, /login, etc.)
  if (reactBuilt && (
    req.path.startsWith('/dashboard') ||
    req.path.startsWith('/students')  ||
    req.path.startsWith('/teachers')  ||
    req.path.startsWith('/classes')   ||
    req.path.startsWith('/attendance')||
    req.path.startsWith('/finance')   ||
    req.path.startsWith('/behaviour') ||
    req.path.startsWith('/exams')        ||
    req.path.startsWith('/admissions')   ||
    req.path.startsWith('/timetable')    ||
    req.path.startsWith('/settings')     ||
    req.path.startsWith('/reports')        ||
    req.path.startsWith('/report-cards')   ||
    req.path.startsWith('/grades')         ||
    req.path.startsWith('/platform-audit') ||
    req.path === '/login'
  )) {
    return res.sendFile(path.join(REACT_DIST, 'index.html'));
  }
  // If React is built, serve it for all remaining routes (landing, school login, etc.)
  if (reactBuilt) {
    return res.sendFile(path.join(REACT_DIST, 'index.html'));
  }
  // Legacy app catch-all (only when React build is absent)
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

/* ── Error handler ──────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

/* ── Start ──────────────────────────────────────────────────── */
async function start() {
  await connect();        // Connect to MongoDB (no-op if MONGODB_URI not set)
  await ensureIndexes();  // Idempotent — safe to run on every startup

  app.listen(PORT, () => {
    console.log(`\n🎓 Msingi API running on port ${PORT}`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/api/health`);
    console.log(`   Mode:    ${process.env.NODE_ENV || 'development'}\n`);

    // Self-healing: run non-blocking AFTER HTTP is serving.
    // Detects and repairs broken role_permissions (legacy object → array format).
    // Idempotent — becomes a sub-1ms no-op once all schools are repaired.
    repairPermissions();   // Fix legacy permission format (idempotent)
    seedDemo();            // Ensure demo.msingi.io school + users exist (idempotent)
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
