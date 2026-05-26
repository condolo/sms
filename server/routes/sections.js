/* ============================================================
   Msingi — /api/sections  (School Curriculum Sections)

   Sections are per-school curriculum groupings that every
   module (Classes, Timetable, Bell Schedule, Attendance,
   Reports) uses for filtering and organisation.

   Admin manages these in Settings → School → Sections.
   On first GET per school the four standard defaults are
   auto-seeded so every new school starts with data.

   Key field is IMMUTABLE after creation — it's the foreign
   key used by classes.sectionKey and bell-schedule storage.
   Name and colour can always be changed safely.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { _model }         = require('../utils/model');
const { ok, created, E } = require('../utils/response');

const router = express.Router();

/* ── Admin guard ─────────────────────────────────────────────── */
function _isAdmin(req) {
  const r  = req.jwtUser?.role  || '';
  const rs = req.jwtUser?.roles || [];
  return r === 'superadmin' || r === 'admin' || rs.includes('superadmin') || rs.includes('admin');
}

/* ── Built-in defaults (seeded on first GET per school) ─────── */
const DEFAULT_SECTIONS = [
  { key: 'kg',        name: 'Kindergarten', color: '#10b981', order: 1 },
  { key: 'primary',   name: 'Primary',      color: '#3b82f6', order: 2 },
  { key: 'secondary', name: 'Secondary',    color: '#8b5cf6', order: 3 },
  { key: 'alevel',    name: 'A-Level',      color: '#f59e0b', order: 4 },
];

/* ── Validation ─────────────────────────────────────────────── */
const SectionSchema = z.object({
  key:   z.string().min(1).max(30)
            .regex(/^[a-z0-9_]+$/, 'Key must be lowercase letters, numbers, or underscores')
            .trim(),
  name:  z.string().min(1).max(60).trim(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour (#rrggbb)').default('#6366f1'),
  order: z.number().int().min(0).max(999).default(99),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── GET /api/sections ───────────────────────────────────────── */
/* Any authenticated user can read sections (needed for filter   */
/* tabs in Classes and Timetable pages for all roles).           */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const Sections = _model('sections');
    let docs = await Sections.find({ schoolId }).sort({ order: 1, name: 1 }).select('-__v').lean();

    // Auto-seed the 4 standard sections on first access per school
    if (!docs.length) {
      const inserts = DEFAULT_SECTIONS.map(d => ({
        ...d, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId,
      }));
      const seeded = await Sections.insertMany(inserts);
      docs = seeded.map(d => (d.toObject ? d.toObject() : d));
    }

    return ok(res, docs);
  } catch (err) {
    console.error('[sections GET]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/sections ──────────────────────────────────────── */
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return E.forbidden(res, 'Admin access required to manage sections');

    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SectionSchema, req.body);
    if (error) return E.validation(res, error);

    const Sections = _model('sections');
    const dup = await Sections.findOne({ schoolId, key: data.key }).lean();
    if (dup) return E.conflict(res, `A section with key '${data.key}' already exists`);

    const doc = await Sections.create({
      ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[sections POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/sections/:id ───────────────────────────────────── */
/* key is immutable — only name, color, order can change.        */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return E.forbidden(res, 'Admin access required to manage sections');

    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(
      SectionSchema.pick({ name: true, color: true, order: true }).partial(),
      req.body,
    );
    if (error) return E.validation(res, error);

    const Sections = _model('sections');
    const doc = await Sections.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true },
    ).lean();
    if (!doc) return E.notFound(res, 'Section not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[sections PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/sections/:id ────────────────────────────────── */
/* Blocked if active classes are assigned to this section.       */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (!_isAdmin(req)) return E.forbidden(res, 'Admin access required to manage sections');

    const { schoolId } = req.jwtUser;
    const Sections = _model('sections');
    const section = await Sections.findOne({ id: req.params.id, schoolId }).lean();
    if (!section) return E.notFound(res, 'Section not found');

    // Referential integrity: block deletion if classes use this section
    const Classes = _model('classes');
    const inUse = await Classes.countDocuments({ schoolId, sectionKey: section.key, status: 'active' });
    if (inUse > 0) {
      return E.conflict(res,
        `Cannot delete "${section.name}" — ${inUse} active class${inUse > 1 ? 'es use' : ' uses'} this section. Reassign them first.`
      );
    }

    await Sections.deleteOne({ id: req.params.id, schoolId });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[sections DELETE/:id]', err);
    return E.serverError(res);
  }
});

module.exports = router;
