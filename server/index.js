/* ============================================================
   Msingi — API Server
   Node.js + Express + MongoDB
   Serves both the API (/api/*) and the static frontend
   ============================================================ */
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const monitoring = require('./utils/monitoring');
const { connect }             = require('./config/db');
const { ensureIndexes }       = require('./utils/indexes');
const { repairPermissions }   = require('./utils/repairPermissions');
const { seedDemo }            = require('./scripts/seed-demo');

/* ── Monitoring: initialise BEFORE anything else ──────────────
   Registers uncaughtException + unhandledRejection handlers.
   Optionally activates Sentry (if SENTRY_DSN env var is set
   and @sentry/node is installed).                              */
monitoring.init();

/* ── Security: warn if JWT_SECRET not set ───────────────────── */
if (!process.env.JWT_SECRET) {
  console.warn('\n⚠️  [Security] JWT_SECRET env var is NOT set — using insecure default. Set it in your .env file or Render dashboard!\n');
}

const app  = express();
const PORT = process.env.PORT || 3005;

/* ── Trust Render / Heroku / nginx reverse proxy ────────────────
   Without this, req.ip returns the proxy IP (10.x.x.x) instead
   of the real client IP.  Level 1 = trust exactly one hop.
   Required for M-Pesa IP allowlist and rate-limit IP accuracy.  */
app.set('trust proxy', 1);

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

/* ── Monitoring: request context (Sentry, if active) ───────── */
app.use(monitoring.requestHandler());

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
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/analytics',      require('./routes/analytics'));
app.use('/api/bell-schedule',  require('./routes/bell-schedule'));
app.use('/api/departments',       require('./routes/departments'));
app.use('/api/subjects',          require('./routes/subjects'));
app.use('/api/class-subjects',    require('./routes/class-subjects'));
app.use('/api/subject-rules',     require('./routes/subject-rules'));
app.use('/api/student-subjects',  require('./routes/student-subjects'));
app.use('/api/events',            require('./routes/events'));
app.use('/api/hr',                require('./routes/hr'));
app.use('/api/mpesa',             require('./routes/mpesa'));
app.use('/api/rooms',                 require('./routes/rooms'));
app.use('/api/teaching-assignments',  require('./routes/teaching-assignments'));
app.use('/api/sections',              require('./routes/sections'));

/* ── v4.29.0: Library / Transport / Hostel ── */
app.use('/api/library',   require('./routes/library'));
app.use('/api/transport', require('./routes/transport'));
app.use('/api/hostel',    require('./routes/hostel'));

/* ── v4.33.0: Lessons / Syllabus Tracker ── */
app.use('/api/lessons',  require('./routes/lessons'));

/* ── eLearning — Google Classroom integration ── */
app.use('/api/elearning', require('./routes/elearning'));

/* ── Billing — platform subscription invoicing ── */
app.use('/api/billing',        require('./routes/billing'));

/* ── Student & Parent portals ── */
app.use('/api/student-portal', require('./routes/student-portal'));
app.use('/api/parent-portal',  require('./routes/parent-portal'));

/* ── Growth Profile (v4.22.0) ── */
app.use('/api/growth-profile',         require('./routes/growth-profile'));
app.use('/api/growth-records',         require('./routes/growth-records'));
app.use('/api/growth-projects',        require('./routes/growth-projects'));
// Recommendations + Aspirations share one route file.
// Aspirations accessible at /api/growth-recommendations/aspirations/:studentId
app.use('/api/growth-recommendations', require('./routes/growth-recommendations'));

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
    version: require('../package.json').version,
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

// SPA fallback — serve the appropriate index.html for all non-API routes.
// Universal wildcard: any new React route works without editing this file.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API endpoint not found' } });
  }
  // Legacy HTML pages with their own entry points
  if (req.path === '/onboard' || req.path === '/onboard/') {
    return res.sendFile(path.join(ROOT_DIR, 'onboard.html'));
  }
  if (req.path === '/platform' || req.path === '/platform/') {
    return res.sendFile(path.join(ROOT_DIR, 'platform.html'));
  }
  // React SPA — serve index.html with no-cache so browsers always fetch
  // the latest entry point after a new deploy (prevents stale-chunk errors)
  if (reactBuilt) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(path.join(REACT_DIST, 'index.html'));
  }
  // No build available (dev mode without running `npm run build`)
  res.status(503).send('<h2>Msingi is starting up — run <code>cd client && npm run build</code> first, or use <code>npm run dev:react</code> for development.</h2>');
});

/* ── Monitoring: Sentry error handler (must come before the final handler) */
app.use(monitoring.errorHandler());

/* ── Error handler ──────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  monitoring.captureException(err, {
    route:    req.path,
    method:   req.method,
    userId:   req.jwtUser?.userId,
    schoolId: req.jwtUser?.schoolId,
  });
  res.status(500).json({ error: 'Internal server error' });
});

/* ── One-time migration: initialize passwordChangedAt ───────────
   Sets passwordChangedAt = now for every user who lacks the field.
   This initialises the 90-day rotation clock for all existing accounts
   so no one is immediately locked out on first deploy of this change.
   Idempotent — the $exists:false filter means it only touches users
   that haven't been updated yet; safe to run on every startup.
   ────────────────────────────────────────────────────────────── */
async function _migratePasswordChangedAt() {
  try {
    const { _model } = require('./utils/model');
    const Users  = _model('users');
    const now    = new Date().toISOString();
    const result = await Users.updateMany(
      { passwordChangedAt: { $exists: false } },
      { $set: { passwordChangedAt: now } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[Migration] passwordChangedAt: initialised for ${result.modifiedCount} user(s) — 90-day clock starts now.`);
    }
  } catch (err) {
    // Non-fatal — next startup will retry
    console.error('[Migration] _migratePasswordChangedAt failed:', err.message);
  }
}

/**
 * _migrateAcademicYears — idempotent startup migration.
 * Ensures every academic_years document has an `id` (uuid) field,
 * and that `isCurrent` defaults to false if missing.
 * Also sets isCurrent:true on the year whose id matches school.academicYear
 * for schools that haven't yet been migrated to the new structure.
 * Safe to run multiple times — uses $setOnInsert-style logic (skips docs that already have the field).
 */
async function _migrateAcademicYears() {
  try {
    const { _model } = require('./utils/model');
    const { v4: uuidv4 } = require('uuid');
    const Years = _model('academic_years');

    // 1. Assign `id` to any doc that is missing it
    const missing = await Years.find({ id: { $exists: false } }).lean();
    if (missing.length > 0) {
      const ops = missing.map(doc => ({
        updateOne: {
          filter: { _id: doc._id },
          update:  { $set: { id: uuidv4() } },
        },
      }));
      const r = await Years.bulkWrite(ops, { ordered: false });
      console.log(`[Migration] academic_years: assigned id to ${r.modifiedCount} doc(s)`);
    }

    // 2. Default isCurrent to false where missing
    const noFlag = await Years.updateMany(
      { isCurrent: { $exists: false } },
      { $set: { isCurrent: false } }
    );
    if (noFlag.modifiedCount > 0) {
      console.log(`[Migration] academic_years: defaulted isCurrent=false for ${noFlag.modifiedCount} doc(s)`);
    }
  } catch (err) {
    console.error('[Migration] _migrateAcademicYears failed:', err.message);
  }
}

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
    repairPermissions()
      .catch(err => console.error('[repairPermissions] Unhandled error:', err));

    seedDemo()
      .catch(err => console.error('[seed-demo] Unhandled top-level error — demo school may not be provisioned correctly:', err));

    // Initialise 90-day password rotation clock for existing users
    _migratePasswordChangedAt()
      .catch(err => console.error('[_migratePasswordChangedAt] Unhandled error:', err));

    // Ensure all academic_years docs have id + isCurrent fields
    _migrateAcademicYears()
      .catch(err => console.error('[_migrateAcademicYears] Unhandled error:', err));

    // Lesson coverage reminder cron jobs (Friday + Saturday)
    try {
      const { startLessonReminders } = require('./utils/lesson-reminders');
      startLessonReminders();
    } catch (err) {
      console.error('[lesson-reminders] Failed to start:', err.message);
    }

    // Billing cron — auto-snapshot on term start dates (daily 06:00 Kenya)
    try {
      const { startBillingCron } = require('./utils/billing-cron');
      startBillingCron();
    } catch (err) {
      console.error('[billing-cron] Failed to start:', err.message);
    }

    // Nightly backup cron — full school data export to disk (daily 02:00 Kenya)
    try {
      const { startBackupCron } = require('./utils/backup-cron');
      startBackupCron();
    } catch (err) {
      console.error('[backup-cron] Failed to start:', err.message);
    }
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
