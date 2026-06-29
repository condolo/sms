/**
 * scopeMiddleware.js — Data Access Scope Engine
 *
 * The third authorization layer in Msingi, sitting after RBAC:
 *
 *   Authentication  → who are you?
 *   RBAC            → can you access this module?
 *   Data Scope      → which records inside this module can you see?
 *
 * Usage:
 *   router.get('/', authMiddleware, PLAN, rbac('students', 'read'), scopeMiddleware, handler)
 *
 * After this middleware runs, req.scope is one of:
 *   null                    — school-level role, no record restrictions
 *   { level, classIds, ... } — restricted; use ScopeEngine.applyToFilter() in the handler
 *
 * Scope levels (configurable per school in future — currently role-based defaults):
 *   'school'    — sees all records in the school (admin, deputy principal, etc.)
 *   'section'   — sees records within their assigned section's classes
 *   'assigned'  — sees only records in their assigned classes / subjects (teacher)
 *   'guardian'  — sees only their linked students (parent)
 *   'self'      — sees only their own record (student)
 *
 * Cache: 5 minutes per userId::schoolId — same TTL as RBAC permission cache.
 * Invalidate by calling invalidateScopeCache(userId, schoolId) when assignments change.
 */
'use strict';

const { _model } = require('../utils/model');

/* ── Scope level per role ───────────────────────────────────── */
// Determines how broadly a role can see records within permitted modules.
// Custom roles not listed here default to 'assigned' (strict deny on no assignments).
const ROLE_SCOPE_LEVEL = {
  superadmin:           'school',
  admin:                'school',
  deputy_principal:     'school',
  deputy:               'school',    // legacy alias for deputy_principal
  principal:            'school',
  timetabler:           'school',
  exams_officer:        'school',
  admissions_officer:   'school',
  finance:              'school',
  hr:                   'school',
  discipline_committee: 'school',
  section_head:         'section',
  teacher:              'assigned',
  parent:               'guardian',
  student:              'self',
};

// Modules where 'assigned'-level users have unrestricted access across the school.
// behaviour: teachers can reward any student. events/messages: school-wide.
const SCOPE_EXEMPT = new Set(['behaviour', 'events', 'messages', 'announcements']);

/* ── Cache ──────────────────────────────────────────────────── */
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function _key(userId, schoolId) { return `${userId}::${schoolId}`; }

function _getCached(userId, schoolId) {
  const entry = _cache.get(_key(userId, schoolId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(_key(userId, schoolId)); return null; }
  return entry.scope;
}

function _setCache(userId, schoolId, scope) {
  _cache.set(_key(userId, schoolId), { scope, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateScopeCache(userId, schoolId) {
  if (userId && schoolId) _cache.delete(_key(userId, schoolId));
}

/* ── Assignment loader ──────────────────────────────────────── */
async function _loadAssigned(userId, schoolId) {
  const rows = await _model('teaching_assignments')
    .find({ schoolId, teacherId: userId })
    .select('classId subjectId')
    .lean();

  return {
    classIds:   [...new Set(rows.map(r => r.classId).filter(Boolean))],
    subjectIds: [...new Set(rows.map(r => r.subjectId).filter(Boolean))],
  };
}

/* ── Section scope loader ───────────────────────────────────── */
async function _loadSection(userId, schoolId) {
  const user = await _model('users')
    .findOne({ $or: [{ id: userId }, { _id: userId }], schoolId })
    .select('sectionAssigned')
    .lean();

  if (!user?.sectionAssigned) return { classIds: [], subjectIds: [] };

  const classes = await _model('classes')
    .find({ schoolId, sectionKey: user.sectionAssigned })
    .select('id')
    .lean();

  return {
    classIds:   classes.map(c => c.id).filter(Boolean),
    subjectIds: [], // section heads see all subjects within their section classes
  };
}

/* ── Middleware ─────────────────────────────────────────────── */
async function scopeMiddleware(req, res, next) {
  try {
    const { userId, schoolId, role, roles = [] } = req.jwtUser || {};

    const effectiveRole = role || roles[0] || '';

    // Resolve scope level. Custom roles not in the map default to 'assigned'.
    let level = ROLE_SCOPE_LEVEL[effectiveRole];
    if (!level) {
      // Check if it's a known custom role with a base role we can use
      try {
        const customRole = await _model('custom_roles')
          .findOne({ schoolId, key: effectiveRole })
          .select('baseRole')
          .lean();
        level = ROLE_SCOPE_LEVEL[customRole?.baseRole] ?? 'assigned';
      } catch {
        level = 'assigned'; // fail safe
      }
    }

    // School-level: no record restrictions — req.scope = null signals "full access"
    if (level === 'school') {
      req.scope = null;
      return next();
    }

    // Serve from cache
    const cached = _getCached(userId, schoolId);
    if (cached) { req.scope = cached; return next(); }

    let scope;

    if (level === 'assigned') {
      const { classIds, subjectIds } = await _loadAssigned(userId, schoolId);
      scope = { level, userId, classIds, subjectIds, houseIds: [], departmentIds: [], unrestrictedModules: [...SCOPE_EXEMPT] };

    } else if (level === 'section') {
      const { classIds } = await _loadSection(userId, schoolId);
      // Section heads see all subjects in their section
      scope = { level, userId, classIds, subjectIds: [], houseIds: [], departmentIds: [], unrestrictedModules: [...SCOPE_EXEMPT] };

    } else {
      // guardian / self — handled at route level; inject minimal scope
      scope = { level, userId, classIds: [], subjectIds: [], houseIds: [], departmentIds: [], unrestrictedModules: [] };
    }

    _setCache(userId, schoolId, scope);
    req.scope = scope;
    next();
  } catch (err) {
    console.error('[ScopeMiddleware] Error computing scope:', err);
    // Fail safe: restrict to nothing rather than grant everything
    req.scope = {
      level: 'assigned', userId: req.jwtUser?.userId,
      classIds: [], subjectIds: [], houseIds: [], departmentIds: [],
      unrestrictedModules: [],
    };
    next();
  }
}

module.exports = { scopeMiddleware, invalidateScopeCache, ROLE_SCOPE_LEVEL };
