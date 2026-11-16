/* ============================================================
   Platform telemetry — pure helpers.

   Kept free of Express/Mongoose so the route normaliser, module
   mapper and percentile maths can be unit-tested under node.
   ============================================================ */
'use strict';

const { MODULE_KEYS } = require('../config/moduleRegistry');

/** Upper bound (ms) of each fixed latency bucket. The last bucket is
 *  "10 s or more" — a histogram, not a list of request timings. */
const LATENCY_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const LATENCY_FIELDS = LATENCY_BOUNDS.map((_, i) => `b${i}`);

const MODULE_SET = new Set([
  ...MODULE_KEYS,
  // Surfaces that are real traffic but not permissioned modules.
  'auth', 'public', 'platform', 'system', 'mobile', 'other',
]);

/* Route families whose URL name and permission key differ. Keep this list
   SHORT: a new module must not need an edit here. Anything unmapped falls
   through to the first path segment, then to `other`. */
const MODULE_ALIASES = {
  'report-cards': 'report_cards',
  'rc-templates': 'report_cards',
  'report-card-templates': 'report_cards',
  'weekly-snapshots': 'weekly_snapshot',
  'weekly-snapshot': 'weekly_snapshot',
  'lesson-plans': 'lessons',
  'teaching-assignments': 'teachers',
  'class-subjects': 'subjects',
  'student-subjects': 'subjects',
  'exam-series': 'exams',
  'mark-submissions': 'assessment',
  'indicator-marks': 'assessment',
  'comment-banks': 'assessment',
  'growth-profile': 'growth_profile',
  'growth-records': 'growth_profile',
  'growth-projects': 'growth_profile',
  'growth-recommendations': 'growth_profile',
  'growth-aspirations': 'growth_profile',
  'student-portal': 'students',
  'parent-portal': 'students',
  'teacher-portal': 'teachers',
  'bell-schedule': 'timetable',
  'smart-reminders': 'messages',
  'audit': 'settings',
  'backup': 'settings',
  'collections': 'settings',
  'billing': 'finance',
  'ops': 'platform',
  'referrals': 'platform',
  'demo': 'platform',
  'onboard': 'platform',
  'sync': 'platform',
};

/** `/api/finance/invoices` -> `finance`; unknown -> `other`. */
function moduleForPath(baseUrl = '') {
  const clean = String(baseUrl).split('?')[0].replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  const idx = parts[0] === 'api' ? 1 : 0;
  const raw = (parts[idx] || '').toLowerCase();
  if (!raw) return 'other';
  const mapped = MODULE_ALIASES[raw] || raw.replace(/-/g, '_');
  return MODULE_SET.has(mapped) ? mapped : 'other';
}

/** Replace ids and opaque tokens so route cardinality stays bounded. */
function normalizeRoute({ baseUrl = '', routePath = '', originalUrl = '' } = {}) {
  let route = routePath
    ? `${baseUrl || ''}${routePath}`
    : `/${String(originalUrl).split('?')[0].split('/').filter(Boolean).slice(0, 3).join('/')}`;

  route = route
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')          // Mongo ObjectId
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, '/:id') // UUID
    .replace(/\/\d+(?=\/|$)/g, '/:id')                     // numeric id
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token');  // invite/opaque tokens

  route = route.replace(/\/+$/, '') || '/';
  return route;
}

/** Histogram bucket for a response time. */
function bucketFor(ms) {
  for (let i = 0; i < LATENCY_BOUNDS.length; i++) {
    if (ms <= LATENCY_BOUNDS[i]) return i;
  }
  return LATENCY_BOUNDS.length - 1;
}

/** p-th percentile from b0..bN counts. Returns the bucket's upper bound. */
function percentileFromBucketCounts(counts, p = 0.95) {
  const total = (counts || []).reduce((a, b) => a + (Number(b) || 0), 0);
  if (!total) return 0;
  const target = total * p;
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    seen += Number(counts[i]) || 0;
    if (seen >= target) return LATENCY_BOUNDS[i];
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1];
}

/** Pull b0..bN out of a Mongo doc / group into a plain array. */
function latencyArray(doc = {}) {
  return LATENCY_BOUNDS.map((_, i) => Number(doc[`b${i}`]) || 0);
}

/** A Mongo $group fragment that sums every latency bucket. */
function latencySumGroup() {
  return Object.fromEntries(LATENCY_FIELDS.map((f) => [f, { $sum: `$${f}` }]));
}

function emptyLatencyFields() {
  return Object.fromEntries(LATENCY_FIELDS.map((f) => [f, 0]));
}

/** Routes we never count: the console itself and cheap health probes. */
function shouldSkipPath(path = '') {
  const p = String(path);
  if (!p.startsWith('/api/')) return true; // static assets / SPA
  return (
    p.startsWith('/api/health') ||
    p.startsWith('/api/platform/analytics') ||
    p.startsWith('/api/ops') ||
    p.startsWith('/api/platform/stats')
  );
}

module.exports = {
  LATENCY_BOUNDS,
  LATENCY_FIELDS,
  MODULE_SET,
  moduleForPath,
  normalizeRoute,
  bucketFor,
  percentileFromBucketCounts,
  latencyArray,
  latencySumGroup,
  emptyLatencyFields,
  shouldSkipPath,
};
