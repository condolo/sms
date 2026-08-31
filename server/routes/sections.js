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
const { rbac }           = require('../middleware/rbac');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, E } = require('../utils/response');
const { invalidateScopeCache } = require('../middleware/scopeMiddleware');

const router = express.Router();
// Writes gated on the 'school' sub-key under 'settings' — sections are
// school configuration ("Admin manages these in Settings → School →
// Sections", per the header comment above). No role_permissions entry
// grants 'settings' to anyone but admin/superadmin by default, which
// reproduces the old admin-only check exactly while making it
// Settings-editable (a school could delegate this to a custom role).

/* ── Built-in defaults (seeded on first GET per school) ─────── */
const DEFAULT_SECTIONS = [
  { key: 'kg',        name: 'Kindergarten', color: '#10b981', order: 1 },
  { key: 'primary',   name: 'Primary',      color: '#3b82f6', order: 2 },
  { key: 'secondary', name: 'Secondary',    color: '#8b5cf6', order: 3 },
  { key: 'alevel',    name: 'A-Level',      color: '#f59e0b', order: 4 },
];

/* ── Validation ─────────────────────────────────────────────── */
const SectionSchema = z.object({
  key:           z.string().min(1).max(30)
                   .regex(/^[a-z0-9_]+$/, 'Key must be lowercase letters, numbers, or underscores')
                   .trim(),
  name:          z.string().min(1).max(60).trim(),
  color:         z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour (#rrggbb)').default('#6366f1'),
  order:         z.number().int().min(0).max(999).default(99),
  sectionHeadId: z.string().nullable().optional(),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/**
 * sectionHeadId (set here) used to be purely a display label — "Head:
 * Mrs X" next to the section — with zero effect on what that person could
 * actually see. Real section-scoped access needs TWO things on the
 * person's own user record: role === 'section_head' AND
 * sectionAssigned === this section's key. Neither was ever set here.
 *
 * This cascades the sectionAssigned half automatically — safe to do
 * unprompted because it's inert on its own (does nothing unless their
 * role is ALSO section_head). The role half is deliberately NOT touched
 * here — an unrelated-looking edit silently granting real system access
 * is exactly the failure mode already fixed twice this session
 * (staffType/role separation, custom extraRoles); role changes stay an
 * explicit, confirmed action via Settings → Users only.
 *
 * Returns a warning string when the newly-assigned head's role isn't
 * actually section_head yet, so the UI can say so instead of implying
 * the assignment is fully in effect.
 */
async function _cascadeSectionHead(req, section, newHeadTeacherId) {
  const { schoolId } = req.jwtUser;
  const oldHeadTeacherId = section?.sectionHeadId ?? null;
  const normalizedNew    = newHeadTeacherId || null;
  if (oldHeadTeacherId === normalizedNew) return { warning: null };

  const Teachers = tenantModel('teachers', tenantContext(req));
  const Users    = tenantModel('users', tenantContext(req));

  const [oldTeacher, newTeacher] = await Promise.all([
    oldHeadTeacherId ? Teachers.findOne({ schoolId, id: oldHeadTeacherId }).select('userId').lean() : null,
    normalizedNew    ? Teachers.findOne({ schoolId, id: normalizedNew }).select('userId').lean()    : null,
  ]);

  // Outgoing head: clear sectionAssigned, but only if it still points at
  // THIS section — never clobber an unrelated assignment (e.g. they were
  // reassigned as head of a different section by a separate edit already).
  if (oldTeacher?.userId) {
    await Users.updateOne(
      { schoolId, id: oldTeacher.userId, sectionAssigned: section.key },
      { $set: { sectionAssigned: null } },
    );
    invalidateScopeCache(oldTeacher.userId, schoolId);
  }

  let warning = null;
  if (newTeacher?.userId) {
    await Users.updateOne(
      { schoolId, id: newTeacher.userId },
      { $set: { sectionAssigned: section.key } },
    );
    invalidateScopeCache(newTeacher.userId, schoolId);

    const newUser = await Users.findOne({ schoolId, id: newTeacher.userId }).select('role').lean();
    if (newUser && newUser.role !== 'section_head') {
      warning = `This person's system role is "${newUser.role}", not Section Head — they won't see section-scoped data until their role is changed in Settings → Users.`;
    }
  } else if (normalizedNew) {
    warning = 'This person has no login account linked yet, so section access could not be granted — link or create their account first.';
  }
  return { warning };
}

/* ── Infer a section key from its display name ───────────────── */
function _inferKey(name) {
  const n = (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/kg|kindergarten|nursery|reception|pre.?school/.test(n)) return 'kg';
  if (/primary|elementary|standard|junior/.test(n))            return 'primary';
  if (/secondary|high.?school|form/.test(n))                   return 'secondary';
  if (/a.?level|sixth|advanced/.test(n))                       return 'alevel';
  // generic fallback: slugify name
  return n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'section';
}

/* ── GET /api/sections ───────────────────────────────────────── */
/* Any authenticated user can read sections (needed for filter   */
/* tabs in Classes and Timetable pages for all roles).           */
router.get('/', authMiddleware, async (req, res) => { // rbac: intentionally open to every authenticated user — see comment above
  try {
    const { schoolId, userId } = req.jwtUser;
    const Sections = tenantModel('sections', tenantContext(req));
    let docs = await Sections.find({ schoolId }).sort({ order: 1, name: 1 }).select('-__v').lean();

    // Auto-seed the 4 standard sections on first access per school
    if (!docs.length) {
      const inserts = DEFAULT_SECTIONS.map(d => ({
        ...d, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId,
      }));
      const seeded = await Sections.insertMany(inserts);
      docs = seeded.map(d => (d.toObject ? d.toObject() : d));
    } else {
      // Auto-migrate: backfill missing `key` or `color` fields.
      // Affects schools whose sections were seeded before these fields were added.
      const broken = docs.filter(d => !d.key || !d.color);
      if (broken.length) {
        await Promise.all(broken.map(d => {
          const guess = DEFAULT_SECTIONS.find(
            ds => ds.name.toLowerCase() === (d.name || '').toLowerCase(),
          );
          const patch = {};
          if (!d.key)   patch.key   = guess?.key   || _inferKey(d.name);
          if (!d.color) patch.color = guess?.color || '#6366f1';
          return Sections.updateOne({ _id: d._id }, { $set: patch });
        }));
        // Reload with patched data
        docs = await Sections.find({ schoolId }).sort({ order: 1, name: 1 }).select('-__v').lean();
        console.log(`[sections] Auto-migrated ${broken.length} section(s) — added missing key/color fields`);
      }
    }

    // Enrich with section head teacher name where sectionHeadId is set
    const headIds = docs.map(d => d.sectionHeadId).filter(Boolean);
    if (headIds.length) {
      const Teachers = tenantModel('teachers', tenantContext(req));
      const teachers = await Teachers.find({ schoolId, id: { $in: headIds } })
        .select('id title firstName lastName').lean();
      const tMap = {};
      teachers.forEach(t => {
        tMap[t.id] = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
      });
      docs = docs.map(d => ({
        ...d,
        sectionHeadName: d.sectionHeadId ? (tMap[d.sectionHeadId] || null) : null,
      }));
    } else {
      docs = docs.map(d => ({ ...d, sectionHeadName: null }));
    }

    return ok(res, docs);
  } catch (err) {
    console.error('[sections GET]', err);
    return E.serverError(res);
  }
});

/* ── POST /api/sections ──────────────────────────────────────── */
router.post('/', authMiddleware, rbac('settings', 'create', 'school'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(SectionSchema, req.body);
    if (error) return E.validation(res, error);

    const Sections = tenantModel('sections', tenantContext(req));
    const dup = await Sections.findOne({ schoolId, key: data.key }).lean();
    if (dup) return E.conflict(res, `A section with key '${data.key}' already exists`);

    const doc = await Sections.create({
      ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId,
    });

    let headWarning = null;
    if (data.sectionHeadId) {
      const cascade = await _cascadeSectionHead(req, { key: data.key, sectionHeadId: null }, data.sectionHeadId);
      headWarning = cascade.warning;
    }

    const docObj = doc.toObject ? doc.toObject() : doc;
    return created(res, headWarning ? { ...docObj, headWarning } : docObj);
  } catch (err) {
    console.error('[sections POST]', err);
    return E.serverError(res);
  }
});

/* ── PUT /api/sections/:id ───────────────────────────────────── */
/* key is immutable — only name, color, order can change.        */
router.put('/:id', authMiddleware, rbac('settings', 'update', 'school'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(
      SectionSchema.pick({ name: true, color: true, order: true, sectionHeadId: true }).partial(),
      req.body,
    );
    if (error) return E.validation(res, error);

    const Sections = tenantModel('sections', tenantContext(req));

    // Fetch first — need the section's PRIOR sectionHeadId to know whether
    // the head is actually changing, and to clear the outgoing head's
    // sectionAssigned correctly (see _cascadeSectionHead above).
    const existing = await Sections.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Section not found');

    let headWarning = null;
    if ('sectionHeadId' in data) {
      const cascade = await _cascadeSectionHead(req, existing, data.sectionHeadId);
      headWarning = cascade.warning;
    }

    const doc = await Sections.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true },
    ).lean();
    if (!doc) return E.notFound(res, 'Section not found');
    return ok(res, headWarning ? { ...doc, headWarning } : doc);
  } catch (err) {
    console.error('[sections PUT/:id]', err);
    return E.serverError(res);
  }
});

/* ── DELETE /api/sections/:id ────────────────────────────────── */
/* Blocked if active classes are assigned to this section.       */
router.delete('/:id', authMiddleware, rbac('settings', 'delete', 'school'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const Sections = tenantModel('sections', tenantContext(req));
    const section = await Sections.findOne({ id: req.params.id, schoolId }).lean();
    if (!section) return E.notFound(res, 'Section not found');

    // Referential integrity: block deletion if classes use this section
    const Classes = tenantModel('classes', tenantContext(req));
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
