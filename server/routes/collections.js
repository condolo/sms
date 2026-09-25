/* ============================================================
   Generic CRUD router — handles all collections
   Every operation is automatically scoped to req.school.id
   ============================================================ */
const express  = require('express');
const crypto   = require('crypto');
const mongoose = require('mongoose');
const { authMiddleware }   = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { rbac }             = require('../middleware/rbac');
const { tenantModel, tenantContext, PLATFORM_COLLECTIONS } = require('../utils/tenant-model');
const { moduleGate } = require('../middleware/module-gate');
const email    = require('../utils/email');

const router = express.Router();

// Collections that are allowed through this router.
// Keep in sync with BACKUP_COLLECTIONS in backup.js and TENANT_COLS in platform.js.
const ALLOWED = new Set([
  // Core
  'schools','users','students','teachers','classes','subjects',
  'academic_years','sections','role_permissions','admissions',
  'events','messages','notifications','announcements',

  // Timetable & structure
  'timetable','bell_schedule','rooms','departments',
  'class_subjects','student_subjects','subject_rules','teaching_assignments',

  // Attendance & behaviour
  'attendance',
  'behaviour_incidents','behaviour_appeals','behaviour_categories',
  'behaviour_matrix','merit_milestones','demerit_stages',
  'detention_types','houses','key_stages',

  // Finance
  'invoices','payments','fee_structures',

  // Grades, exams & report cards
  'grades','exams','exam_results',
  'assessment_marks','assessment_config','grade_boundaries',
  'report_card_snapshots','publish_batches',
  'mark_audit_log','mark_submissions','exam_series','comment_banks',

  // Curriculum / lessons
  'lesson_coverage','syllabus_topics',

  // Growth / co-curricular portfolio
  'growth_projects','growth_leadership','growth_activities',
  'growth_service','growth_awards','growth_recommendations','growth_aspirations',

  // Library, hostel, transport
  'library_books','library_loans',
  'hostels','hostel_rooms','hostel_assignments',
  'transport_routes','transport_assignments',

  // HR
  'leave_requests','payroll',

  // E-learning
  'elearning_tokens','elearning_course_links',
  'elearning_coursework_links','elearning_sessions',

  // Billing & misc
  'billing_snapshots','user_photos',
]);

// Collections that should NOT be filtered by schoolId (global/platform data)
const GLOBAL = new Set(['behaviour_matrix', 'system_announcements']);

// Collections only admin/superadmin can write to.
// These all have dedicated routes with proper RBAC — block generic writes to prevent BOLA bypass.
const ADMIN_WRITE = new Set([
  'users', 'role_permissions', 'schools', 'fee_structures',
  'grades', 'invoices', 'payments', 'exams', 'exam_results',
  'attendance', 'report_card_snapshots', 'admissions', 'mark_audit_log',
  'assessment_marks', 'mark_submissions', 'billing_snapshots',
]);

// Collections only superadmin can write to
const SUPERADMIN_WRITE = new Set(['schools']);

// Admin roles
const ADMIN_ROLES = new Set(['superadmin', 'admin']);

function _isAdmin(req) {
  const role = req.jwtUser?.role || '';
  const roles = req.jwtUser?.roles || [];
  return ADMIN_ROLES.has(role) || roles.some(r => ADMIN_ROLES.has(r));
}
function _isSuperAdmin(req) {
  const role = req.jwtUser?.role || '';
  const roles = req.jwtUser?.roles || [];
  return role === 'superadmin' || roles.includes('superadmin');
}

/* Collections that must stay admin-only on READ too, not just write —
   raw PII/credentials (users), the permission model itself
   (role_permissions), the school's own platform record (schools), and
   platform billing data (billing_snapshots). Deliberately NOT the same
   set as ADMIN_WRITE: most of ADMIN_WRITE (grades, attendance, exams,
   invoices, ...) restricts WRITES to admin (matching each module's real
   rbac gate, which is stricter for writes than reads), but plenty of
   non-admin roles legitimately have READ access to those same modules
   day-to-day (a teacher has real attendance:RCU/grades:RCU grants) —
   gating their reads to admin-only here would silently break that. */
const READ_ADMIN_ONLY = new Set(['users', 'role_permissions', 'schools', 'billing_snapshots']);

/* The generic CRUD endpoint must apply the same module boundary as the
   dedicated API. Every allowlisted collection is mapped; an unmapped
   collection fails closed. Generic access does not implement the richer
   record-level scopes available on dedicated routes (e.g. own leave
   requests), so callers need the module-level grant that permits access
   to the whole module's records. */
const COLLECTION_MODULE = {
  schools: 'settings', users: 'settings', role_permissions: 'settings',
  students: 'students', teachers: 'teachers', classes: 'classes',
  subjects: 'subjects', departments: 'subjects', academic_years: 'settings',
  sections: 'classes', admissions: 'admissions',
  events: 'events', messages: 'messages', notifications: 'messages', announcements: 'messages',
  timetable: 'timetable', bell_schedule: 'timetable', rooms: 'timetable',
  class_subjects: 'subjects', student_subjects: 'subjects', subject_rules: 'subjects',
  teaching_assignments: 'timetable',
  attendance: 'attendance', behaviour_incidents: 'behaviour', behaviour_appeals: 'behaviour',
  behaviour_categories: 'behaviour', behaviour_matrix: 'behaviour', merit_milestones: 'behaviour',
  demerit_stages: 'behaviour', detention_types: 'behaviour', houses: 'behaviour', key_stages: 'students',
  invoices: 'finance', payments: 'finance', fee_structures: 'finance',
  grades: 'grades', exams: 'exams', exam_results: 'exams', assessment_marks: 'grades',
  assessment_config: 'assessment', grade_boundaries: 'grades', report_card_snapshots: 'report_cards',
  publish_batches: 'report_cards', mark_audit_log: 'grades', mark_submissions: 'grades',
  exam_series: 'grades', comment_banks: 'grades',
  lesson_coverage: 'lessons', syllabus_topics: 'lessons',
  growth_projects: 'growth_profile', growth_leadership: 'growth_profile',
  growth_activities: 'growth_profile', growth_service: 'growth_profile', growth_awards: 'growth_profile',
  growth_recommendations: 'growth_profile', growth_aspirations: 'growth_profile',
  library_books: 'library', library_loans: 'library', hostels: 'hostel', hostel_rooms: 'hostel',
  hostel_assignments: 'hostel', transport_routes: 'transport', transport_assignments: 'transport',
  leave_requests: 'hr', payroll: 'hr', elearning_tokens: 'elearning',
  elearning_course_links: 'elearning', elearning_coursework_links: 'elearning',
  elearning_sessions: 'elearning', billing_snapshots: 'finance', user_photos: 'students',
};

// Shared behavior matrix is reference configuration, not tenant-editable data.
const READ_ONLY = new Set(['behaviour_matrix']);

/* Collections whose OWN dedicated route has no rbac check at all on GET —
   confirmed by reading each one directly, not assumed from the module they
   map to: subjects.js's GET / and GET /:id ("intentionally open to every
   authenticated user — reference data"), and its own departments route;
   rooms.js's GET /; bell-schedule.js's GET / (planGate only, no rbac);
   sections.js's GET /. Each shares a COLLECTION_MODULE entry with a
   SIBLING collection that IS gated on its own dedicated route (rooms/
   bell_schedule both map to 'timetable', which timetable.js itself gates
   behind timetableManageAccess; sections maps to 'classes', which
   classes.js's own GET / gates behind rbac('classes','read')) — so this
   has to be a per-collection exemption, not a per-module one. Generic
   reads for these collections still require authentication and the
   module to be enabled (moduleGate), matching every other collection;
   only the module-level RBAC check is skipped, matching the real
   openness of their own dedicated GET routes exactly. Writes are
   unaffected — subjects.js's own POST/PUT/DELETE, for example, DO gate
   on rbac('subjects', action), and so does _canAccess here. */
const OPEN_READ = new Set(['subjects', 'departments', 'rooms', 'bell_schedule', 'sections']);

/* Run a middleware and resolve false when it has already ended the
   request. This lets dynamic module/RBAC checks run before the CRUD body. */
function _runGate(middleware, req, res) {
  return new Promise(resolve => middleware(req, res, () => resolve(true)));
}

/* Check the module switch and the caller's RBAC grant for this operation.
   false means a gate already returned the appropriate response. */
async function _canAccess(req, res, col, action) {
  const mod = COLLECTION_MODULE[col];
  if (!mod) {
    res.status(403).json({ error: `Generic access is not configured for collection: ${col}` });
    return false;
  }
  if (READ_ADMIN_ONLY.has(col) && !_isAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  if (!await _runGate(moduleGate(mod), req, res)) return false;
  if (action === 'read' && OPEN_READ.has(col)) return true;
  return _runGate(rbac(mod, action), req, res);
}

function _writeRoleAllowed(req, res, col) {
  if (SUPERADMIN_WRITE.has(col) && !_isSuperAdmin(req)) {
    res.status(403).json({ error: 'Super admin access required' });
    return false;
  }
  if (ADMIN_WRITE.has(col) && !_isAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

/* Strip sensitive fields from user docs — strip BOTH field names to cover legacy docs */
function _sanitiseUser(doc) {
  if (!doc) return doc;
  // auth.js stores hash as `password`; settings.js historically used `passwordHash`
  // strip both so whichever is present never reaches the wire
  const { password, passwordHash, twoFactorSecret, mfaOtp, mfaExpiry, ...safe } = doc;
  return safe;
}

// Was a locally duplicated model factory missing the `id: false` schema
// option the canonical one (server/utils/model.js) carries — that option
// disables Mongoose's default `id` virtual, which otherwise silently
// discards any real `id` field a caller tries to set. Found live via
// academic_years (see seed-demo.js's comment for the full mechanism);
// this router can touch an arbitrary caller-supplied collection name, so
// it's exactly the kind of place that risk should never sit uncovered.
const { _model } = require('../utils/model');

/* col is caller-controlled (URL param, gated by ALLOWED). GLOBAL collections
   are deliberately unscoped by this router's own design (unrelated to
   ADR-0001); PLATFORM_COLLECTIONS ('schools' here) can't go through
   tenantModel() at all. Everything else gets tenant-scoped. */
function _accessor(col, req) {
  if (GLOBAL.has(col) || PLATFORM_COLLECTIONS.has(col)) return _model(col);
  return tenantModel(col, tenantContext(req));
}

/* ── GET /api/collections/:col  — list all docs for this school ── */
router.get('/:col', authMiddleware, async (req, res) => { // rbac: _canRead() below — dynamic per-collection module, see READ_MODULE
  const { col } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (!(await _canAccess(req, res, col, 'read'))) return;
  try {
    const Model  = _accessor(col, req);
    const filter = GLOBAL.has(col) ? {} : { schoolId: req.jwtUser.schoolId };
    let docs     = await Model.find(filter).lean();
    // ⚠️ Security: strip password hashes and OTP fields from user records
    if (col === 'users') docs = docs.map(_sanitiseUser);
    res.json(docs);
  } catch (err) {
    console.error(`[GET /${col}]`, err.message);
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

/* ── POST /api/collections/:col  — insert a document ── */
router.post('/:col', authMiddleware, async (req, res) => { // rbac: ADMIN_WRITE/SUPERADMIN_WRITE checks below — dynamic per-collection
  const { col } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (READ_ONLY.has(col)) return res.status(403).json({ error: 'This collection is read-only' });
  if (!_writeRoleAllowed(req, res, col)) return;
  if (!(await _canAccess(req, res, col, 'create'))) return;
  // ⚠️ Security: only a superadmin may create a superadmin (mirrors the identical
  // guard on PUT below — this route lacked it, letting any admin self-escalate by
  // POSTing {role:'superadmin'} to /api/collections/users).
  if (col === 'users' && !_isSuperAdmin(req) && req.body.role === 'superadmin') {
    return res.status(403).json({ error: 'Cannot assign superadmin role' });
  }
  try {
    const Model  = _accessor(col, req);
    const data  = { ...req.body };
    if (!GLOBAL.has(col)) data.schoolId = req.jwtUser.schoolId;
    if (!data.id) data.id = _uid();
    // ⚠️ Security: never accept a password through this generic endpoint — real
    // account creation goes through the dedicated invite flow (settings.js), which
    // bcrypt-hashes it. Mirrors PUT's identical `delete update.password` below.
    if (col === 'users') { delete data.password; delete data.passwordHash; }
    const doc = await Model.create(data);
    const out = doc.toObject();
    res.status(201).json(col === 'users' ? _sanitiseUser(out) : out);
  } catch (err) {
    console.error(`[POST /${col}]`, err.message);
    res.status(500).json({ error: 'Failed to insert document' });
  }
});

/* ── PUT /api/collections/:col/:id  — update a document ── */
router.put('/:col/:id', authMiddleware, async (req, res) => { // rbac: ADMIN_WRITE/SUPERADMIN_WRITE checks below — dynamic per-collection
  const { col, id } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (READ_ONLY.has(col)) return res.status(403).json({ error: 'This collection is read-only' });
  if (!_writeRoleAllowed(req, res, col)) return;
  if (!(await _canAccess(req, res, col, 'update'))) return;
  try {
    const Model  = _accessor(col, req);
    const filter = GLOBAL.has(col) ? { id } : { id, schoolId: req.jwtUser.schoolId };

    // ── Role change detection (users collection) ──────────
    let oldDoc = null;
    if (col === 'users') {
      oldDoc = await Model.findOne(filter).lean();
      // Prevent non-superadmin from elevating roles to superadmin
      if (!_isSuperAdmin(req) && req.body.role === 'superadmin') {
        return res.status(403).json({ error: 'Cannot assign superadmin role' });
      }
      // Prevent modifying own role (except superadmin)
      if (!_isSuperAdmin(req) && id === req.jwtUser.userId) {
        return res.status(403).json({ error: 'Cannot modify your own role' });
      }
    }

    const update = { ...req.body, updatedAt: new Date().toISOString() };
    delete update._id;
    // ⚠️ Security: never allow overwriting password through this generic endpoint
    if (col === 'users') delete update.password;

    const doc = await Model.findOneAndUpdate(filter, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // ── Send role change notification email ───────────────
    if (col === 'users' && oldDoc && req.body.role && req.body.role !== oldDoc.role) {
      const School = require('../utils/model')._model('schools');
      const school = await School.findOne({ id: req.jwtUser.schoolId }).lean();
      email.sendRoleChanged({
        name:        doc.name,
        email:       doc.email,
        schoolName:  school?.name || '',
        schoolEmail: school?.systemEmail || '',
        schoolId:    req.jwtUser.schoolId,
        oldRole:     oldDoc.role,
        newRole:     req.body.role,
        changedBy:   req.jwtUser.email
      }).catch(err => console.error('[role-change email]', err.message));
    }

    res.json(col === 'users' ? _sanitiseUser(doc) : doc);
  } catch (err) {
    console.error(`[PUT /${col}/${id}]`, err.message);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

/* ── DELETE /api/collections/:col/:id  — delete a document ── */
router.delete('/:col/:id', authMiddleware, async (req, res) => { // rbac: ADMIN_WRITE/SUPERADMIN_WRITE checks below — dynamic per-collection
  const { col, id } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (READ_ONLY.has(col)) return res.status(403).json({ error: 'This collection is read-only' });
  if (!_writeRoleAllowed(req, res, col)) return;
  if (!(await _canAccess(req, res, col, 'delete'))) return;
  try {
    const Model  = _accessor(col, req);
    const filter = GLOBAL.has(col) ? { id } : { id, schoolId: req.jwtUser.schoolId };
    const result = await Model.deleteOne(filter);
    if (!result.deletedCount) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /${col}/${id}]`, err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/* ── POST /api/collections/:col/bulk  — bulk upsert (used by sync) ── */
router.post('/:col/bulk', authMiddleware, async (req, res) => { // rbac: ADMIN_WRITE/SUPERADMIN_WRITE checks below — dynamic per-collection
  const { col } = req.params;
  if (!ALLOWED.has(col)) return res.status(400).json({ error: `Unknown collection: ${col}` });
  if (READ_ONLY.has(col)) return res.status(403).json({ error: 'This collection is read-only' });
  if (!_writeRoleAllowed(req, res, col)) return;
  // Bulk upsert may create or update each row, so require both grants.
  if (!(await _canAccess(req, res, col, 'create'))) return;
  if (!(await _canAccess(req, res, col, 'update'))) return;
  const rows = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Body must be an array' });
  // ⚠️ Security: same guards as POST/PUT above — bulk upserts can insert brand-new
  // 'users' documents (via upsert:true), so it's exposed to the identical
  // role-escalation and password-bypass risk, just via an array instead of one body.
  if (col === 'users' && !_isSuperAdmin(req) && rows.some(r => r?.role === 'superadmin')) {
    return res.status(403).json({ error: 'Cannot assign superadmin role' });
  }
  try {
    const Model  = _accessor(col, req);
    const ops    = rows.map(r => {
      const row = { ...r };
      if (col === 'users') { delete row.password; delete row.passwordHash; }
      return {
        updateOne: {
          filter: { id: row.id, ...(GLOBAL.has(col) ? {} : { schoolId: req.jwtUser.schoolId }) },
          update: { $set: { ...row, schoolId: GLOBAL.has(col) ? row.schoolId : req.jwtUser.schoolId } },
          upsert: true
        }
      };
    });
    const result = await Model.bulkWrite(ops);
    res.json({ upserted: result.upsertedCount, modified: result.modifiedCount });
  } catch (err) {
    console.error(`[BULK /${col}]`, err.message);
    res.status(500).json({ error: 'Bulk write failed' });
  }
});

function _uid() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

module.exports = router;
