/* ============================================================
   Demo tenant helpers — shared constants and small utilities.

   A demo tenant is a real school document with `isDemo: true` and an
   `expiresAt` date. Everything (auth, middleware, sweep, platform console)
   reads these two fields rather than a separate collection, so a demo
   converts to a paid tenant by clearing the flag — no data move.
   ============================================================ */
'use strict';

const crypto = require('crypto');
const { _model } = require('./model');

const TRIAL_DAYS         = Math.max(1, parseInt(process.env.DEMO_TRIAL_DAYS || '7', 10));
const EXTENSION_DAYS     = Math.max(1, parseInt(process.env.DEMO_EXTENSION_DAYS || '7', 10));
const MAX_EXTENSIONS     = Math.max(0, parseInt(process.env.DEMO_MAX_EXTENSIONS || '2', 10));
const PURGE_AFTER_DAYS   = Math.max(1, parseInt(process.env.DEMO_PURGE_AFTER_DAYS || '30', 10));
const TEMPLATE_SCHOOL_ID = process.env.DEMO_TEMPLATE_SCHOOL_ID || 'sch_demo';

/* Password alphabet avoids 0/O/1/l/I so credentials survive being read
   aloud or retyped from an email. 14 chars ≈ 83 bits of entropy. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

function generatePassword(length = 14) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

function shortId(length = 6) {
  return crypto.randomBytes(16).toString('hex').slice(0, length);
}

function slugifySchool(name) {
  return String(name || 'school')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 28) || 'school';
}

function makeDemoSlug(name) {
  return `demo-${slugifySchool(name)}-${shortId(4)}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isDemoSchoolDoc(school) {
  return !!(school && school.isDemo);
}

function daysLeft(school) {
  if (!school?.expiresAt) return null;
  return Math.ceil((new Date(school.expiresAt).getTime() - Date.now()) / 86400000);
}

function isExpired(school) {
  return isDemoSchoolDoc(school) && school.expiresAt && new Date(school.expiresAt) < new Date();
}

function isPurgeDue(school) {
  if (!isDemoSchoolDoc(school) || !school.expiresAt) return false;
  return addDays(new Date(school.expiresAt), PURGE_AFTER_DAYS) < new Date();
}

/* Small cache: demo checks run inside email sending and every authenticated
   request, which can be hot. 30s is plenty for a flag that changes at most
   daily. */
const _demoCache = new Map(); // schoolId -> { isDemo, expiresAt, at }
const DEMO_CACHE_TTL = 30 * 1000;

async function getDemoState(schoolId) {
  if (!schoolId) return { isDemo: false, expiresAt: null };
  const hit = _demoCache.get(schoolId);
  if (hit && Date.now() - hit.at < DEMO_CACHE_TTL) return hit;
  try {
    const doc = await _model('schools').findOne({ id: schoolId }, { isDemo: 1, expiresAt: 1 }).lean();
    const state = { isDemo: !!(doc && doc.isDemo), expiresAt: doc?.expiresAt || null, at: Date.now() };
    _demoCache.set(schoolId, state);
    return state;
  } catch {
    return { isDemo: false, expiresAt: null }; // never block on a lookup failure
  }
}

async function isDemoSchool(schoolId) {
  return (await getDemoState(schoolId)).isDemo;
}

function isDemoStateExpired(state) {
  return !!(state?.isDemo && state.expiresAt && new Date(state.expiresAt) < new Date());
}

function invalidateDemoCache(schoolId) {
  if (schoolId) _demoCache.delete(schoolId);
  else _demoCache.clear();
}

function loginUrlFor(slug) {
  const base = (process.env.APP_URL || 'http://localhost:3005').replace(/\/$/, '');
  return `${base}/login?school=${encodeURIComponent(slug)}`;
}

/* Role logins created for every demo tenant. One shared password per
   tenant (never a global one), so the email can list every role without
   exploding into six different secrets. */
const DEMO_ROLE_LOGINS = [
  { key: 'admin',            username: 'admin',    label: 'Administrator',        role: 'admin' },
  { key: 'deputy_principal', username: 'principal', label: 'Deputy Principal',    role: 'deputy_principal' },
  { key: 'teacher',          username: 'teacher',  label: 'Teacher',              role: 'teacher' },
  { key: 'finance',          username: 'finance',  label: 'Finance Officer',      role: 'finance' },
  { key: 'parent',           username: 'parent',   label: 'Parent / Guardian',    role: 'parent' },
  { key: 'student',          username: 'student',  label: 'Student',              role: 'student' },
];

module.exports = {
  TRIAL_DAYS,
  EXTENSION_DAYS,
  MAX_EXTENSIONS,
  PURGE_AFTER_DAYS,
  TEMPLATE_SCHOOL_ID,
  DEMO_ROLE_LOGINS,
  generatePassword,
  shortId,
  slugifySchool,
  makeDemoSlug,
  addDays,
  isDemoSchoolDoc,
  isExpired,
  isPurgeDue,
  daysLeft,
  isDemoSchool,
  getDemoState,
  isDemoStateExpired,
  invalidateDemoCache,
  loginUrlFor,
};
