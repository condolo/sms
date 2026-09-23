/* ============================================================
   Msingi — /api/lessons   (Lessons & Syllabus Tracker)
   Live curriculum coverage tracking per teacher per class.

   Collections:
     syllabus_topics   — shared curriculum per subject (schoolId + subjectId + academicYear)
     lesson_coverage   — per-teacher-per-class coverage records

   Plan:  standard
   RBAC:  lessons:{read, create, update, delete}

   Key design decisions:
   • Topics are SHARED per subject — any teacher of Maths sees the same
     curriculum. Creating/editing a topic is visible to all teachers of
     that subject in the school.
   • Coverage is PER TEACHER PER CLASS — each teacher independently marks
     what they have covered for each of their assigned classes.
   • Co-teacher sync: when teacher A covers a topic for class X, teacher B
     of the same subject + class X also sees it as covered (shared coverage
     for the same class-subject pair).
   • Copy from colleague: copy another teacher's topics for the same subject.
   ============================================================ */
'use strict';

const express         = require('express');
const { z }           = require('zod');
const { v4: uuidv4 }  = require('uuid');

const { authMiddleware }  = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { scopeMiddleware } = require('../middleware/scopeMiddleware');
const ScopeEngine         = require('../utils/scopeEngine');
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { _model }         = require('../utils/model');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');
const { resolveAcademicPeriod } = require('../utils/academic-period');

const router = express.Router();
const PLAN   = planGate('lessons');
const MODGATE = moduleGate('lessons');

/* ── Role helpers ────────────────────────────────────────────── */
// 'acting_deputy'/'head_of_school' are teacher.extraRoles responsibility
// tags (see server/config/staffResponsibilities.js), not real account
// roles — listed explicitly alongside the real 'deputy'/'deputy_principal'/
// 'principal' role keys so a teacher tagged with that responsibility
// keeps the same admin-level lessons access as before those tag values
// were renamed off of the exact strings SYSTEM_ROLES uses.
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'deputy_principal', 'principal', 'section_head', 'teacher', 'hod', 'deputy', 'acting_deputy', 'head_of_school']);

function _eff(req) {
  const role       = req.jwtUser?.role       ?? '';
  const roles      = req.jwtUser?.roles      ?? [];
  const extraRoles = req.jwtUser?.extraRoles ?? [];
  return new Set([role, ...roles, ...extraRoles]);
}

function isTeacher(req) {
  const eff = _eff(req);
  return eff.has('teacher') || eff.has('hod');
}

function isAdmin(req) {
  const eff = _eff(req);
  return eff.has('admin') || eff.has('superadmin') || eff.has('principal') || eff.has('deputy') || eff.has('deputy_principal')
    || eff.has('acting_deputy') || eff.has('head_of_school'); // extraRoles responsibility tags — see MANAGE_ROLES comment above
}

function isHodOrAdmin(req) {
  const eff = _eff(req);
  return isAdmin(req) || eff.has('hod') || eff.has('section_head');
}

/* ── Validation ─────────────────────────────────────────────── */
const SubtopicSchema = z.object({
  id:    z.string().optional(),
  title: z.string().min(1).max(200).trim(),
  order: z.number().int().min(0).default(0),
});

const TopicSchema = z.object({
  subjectId:    z.string().min(1),
  subjectName:  z.string().max(200).trim().optional(),
  academicYear: z.string().max(20).trim().optional(),
  title:        z.string().min(1).max(300).trim(),
  description:  z.string().max(1000).trim().optional(),
  order:        z.number().int().min(0).default(0),
  subtopics:    z.array(SubtopicSchema).optional().default([]),
});

const CoverageSchema = z.object({
  teacherId:    z.string().optional(),   // admin can submit on behalf
  classId:      z.string().min(1),
  // Set only when the submitting teacher's assignment for this class-
  // subject is stream-scoped (a subject taught separately per stream —
  // see teaching-assignments.js). Omitted, coverage stays shared across
  // the whole class exactly as before this field existed.
  streamId:     z.string().optional(),
  subjectId:    z.string().min(1),
  topicId:      z.string().min(1),       // syllabus_topics.id
  subtopicId:   z.string().optional(),   // id within topic.subtopics
  coveredAt:    z.string().optional(),   // ISO date — defaults to now
  notes:        z.string().max(500).trim().optional(),
});

/* Requested by Trinitas + Trinity (2026-09): a real, per-lesson lesson-plan
   document — Topic/Subtopic picked from this same subject's syllabus_topics
   (a subject with none yet cannot be planned for, by construction, since
   topicId is required and validated against a real topic below), plus
   differentiation/assessment/homework/reflection. Distinct from — and
   never auto-linked to — lesson_coverage: a plan is what a teacher intends
   to teach, coverage is what's actually been taught; conflating the two
   would let planning a future lesson silently mark it "covered" today. */
const LessonPlanSchema = z.object({
  teacherId:   z.string().optional(),   // admin can submit on behalf, same as CoverageSchema
  classId:     z.string().min(1),
  streamId:    z.string().optional(),   // stream-scoped planning — see _streamFilterPart
  subjectId:   z.string().min(1),
  date:        z.string().min(1),       // ISO date ('YYYY-MM-DD') of this specific lesson
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  topicId:     z.string().min(1),
  subtopicId:  z.string().optional(),
  objectives:  z.string().max(2000).trim().optional().default(''),
  activities:  z.string().max(2000).trim().optional().default(''),
  resources:   z.string().max(1000).trim().optional().default(''),
  remarks:     z.string().max(1000).trim().optional().default(''),
  differentiation: z.object({
    low:    z.string().max(1000).trim().optional().default(''),
    middle: z.string().max(1000).trim().optional().default(''),
    high:   z.string().max(1000).trim().optional().default(''),
  }).optional().default({ low: '', middle: '', high: '' }),
  assessment:  z.string().max(2000).trim().optional().default(''),
  homework:    z.string().max(1000).trim().optional().default(''),
  // Filled in after the lesson is actually taught — by the subject teacher
  // only (see PUT /plans/:id's ownership check), so it's fine for this to
  // arrive empty on create and be filled in later via update.
  reflection:  z.object({
    wentWell:    z.string().max(1000).trim().optional().default(''),
    betterIf:    z.string().max(1000).trim().optional().default(''),
    improvement: z.string().max(1000).trim().optional().default(''),
  }).optional().default({ wentWell: '', betterIf: '', improvement: '' }),
  // Per-school custom fields (Settings → Lessons → Template). Self-contained
  // — {key, label, value} rather than {key, value} looked up against the
  // CURRENT template — so a school renaming or removing a custom field
  // later never rewrites or orphans data already recorded on this specific
  // plan. The client is expected to send the label from the template it
  // just fetched; the server trusts it rather than re-resolving, the same
  // way it trusts teacherName/subjectName snapshots elsewhere in this file.
  customFields: z.array(z.object({
    key:   z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    value: z.string().max(2000).trim().optional().default(''),
  })).max(20).optional().default([]),
});

// Update: every field optional, no nested defaults — a bare {} would
// otherwise inject empty differentiation/reflection objects that then blow
// away previously-saved values when merged naively. The PUT handler merges
// differentiation/reflection field-by-field against the existing doc
// instead of replacing them wholesale.
const LessonPlanUpdateSchema = z.object({
  classId:     z.string().min(1).optional(),
  streamId:    z.string().optional(),
  subjectId:   z.string().min(1).optional(),
  date:        z.string().min(1).optional(),
  academicYearId: z.string().optional(),
  termId:         z.string().optional(),
  topicId:     z.string().min(1).optional(),
  subtopicId:  z.string().optional(),
  objectives:  z.string().max(2000).trim().optional(),
  activities:  z.string().max(2000).trim().optional(),
  resources:   z.string().max(1000).trim().optional(),
  remarks:     z.string().max(1000).trim().optional(),
  differentiation: z.object({
    low:    z.string().max(1000).trim().optional(),
    middle: z.string().max(1000).trim().optional(),
    high:   z.string().max(1000).trim().optional(),
  }).partial().optional(),
  assessment:  z.string().max(2000).trim().optional(),
  homework:    z.string().max(1000).trim().optional(),
  reflection:  z.object({
    wentWell:    z.string().max(1000).trim().optional(),
    betterIf:    z.string().max(1000).trim().optional(),
    improvement: z.string().max(1000).trim().optional(),
  }).partial().optional(),
  customFields: z.array(z.object({
    key:   z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    value: z.string().max(2000).trim().optional().default(''),
  })).max(20).optional(),
});

/* ═══════════════════════════════════════════════════════════════
   LESSON PLAN TEMPLATE  (per-school field customization, 2026-09)

   Requested directly, after the fixed-schema version shipped: schools
   want to enable/disable/relabel/require each built-in field, and add
   their own extra fields — configured by whoever holds the new
   lessons__template permission (Settings → Roles & Permissions →
   Lessons), not hardcoded to admin.

   BUILTIN_FIELDS is the fixed registry of the 12 content fields the
   original template already has real Zod validation, PDF rendering, and
   a dedicated document shape for (`differentiation.low` etc.) — a school
   can hide/relabel/require any of these, but never delete or rename its
   `key`/`path`, since that's what every other part of this file (and the
   PDF renderer) still reads/writes directly. CUSTOM fields, by contrast,
   have no fixed path at all — they live in the `customFields` array
   (see LessonPlanSchema above) as self-contained {key,label,value}
   triples, so removing a custom field from the template never touches
   data already recorded under it on existing plans.
   ═══════════════════════════════════════════════════════════════ */
const BUILTIN_FIELDS = [
  { key: 'objectives',              path: 'objectives',              defaultLabel: 'Lesson Objectives',       group: 'lesson' },
  { key: 'activities',              path: 'activities',              defaultLabel: 'Learning Activities',     group: 'lesson' },
  { key: 'resources',               path: 'resources',               defaultLabel: 'Resources / References',  group: 'lesson' },
  { key: 'remarks',                 path: 'remarks',                 defaultLabel: 'Remarks',                 group: 'lesson' },
  { key: 'diff_low',                path: 'differentiation.low',     defaultLabel: 'Low Ability',              group: 'differentiation' },
  { key: 'diff_middle',             path: 'differentiation.middle',  defaultLabel: 'Middle Ability',           group: 'differentiation' },
  { key: 'diff_high',               path: 'differentiation.high',    defaultLabel: 'High Ability',             group: 'differentiation' },
  { key: 'assessment',              path: 'assessment',              defaultLabel: 'Assessment & Evaluation',  group: 'assessment' },
  { key: 'homework',                path: 'homework',                defaultLabel: 'Lesson / Week Assignment', group: 'homework' },
  { key: 'reflection_went_well',    path: 'reflection.wentWell',     defaultLabel: 'What went well',           group: 'reflection' },
  { key: 'reflection_better_if',    path: 'reflection.betterIf',     defaultLabel: 'Even better if',           group: 'reflection' },
  { key: 'reflection_improvement',  path: 'reflection.improvement',  defaultLabel: 'Areas for improvement',    group: 'reflection' },
];
const BUILTIN_KEYS = new Set(BUILTIN_FIELDS.map(f => f.key));

function _defaultTemplate() {
  return {
    fields: BUILTIN_FIELDS.map((f, i) => ({
      key: f.key, path: f.path, group: f.group, builtin: true,
      label: f.defaultLabel, enabled: true, required: false, order: i,
    })),
  };
}

// Merge a school's saved template with the current BUILTIN_FIELDS registry
// — a field added to BUILTIN_FIELDS after a school last saved its template
// appears with defaults (same "backfill missing keys, never overwrite
// existing ones" discipline as _mergePerms on the client). Custom fields
// are carried through as-is; a stale builtin no longer in the registry is
// dropped (never happens today — BUILTIN_FIELDS has never shrunk — but
// keeps this correct if it ever does).
function _mergeTemplate(saved) {
  const savedFields = Array.isArray(saved?.fields) ? saved.fields : [];
  const byKey = Object.fromEntries(savedFields.map(f => [f.key, f]));
  const builtins = BUILTIN_FIELDS.map((f, i) => ({
    key: f.key, path: f.path, group: f.group, builtin: true,
    label:    byKey[f.key]?.label    ?? f.defaultLabel,
    enabled:  byKey[f.key]?.enabled  ?? true,
    required: byKey[f.key]?.required ?? false,
    order:    byKey[f.key]?.order    ?? i,
  }));
  const customs = savedFields
    .filter(f => !BUILTIN_KEYS.has(f.key))
    .map(f => ({
      key: f.key, path: null, group: 'custom', builtin: false,
      label: f.label, enabled: f.enabled !== false, required: !!f.required,
      order: f.order ?? 999,
    }));
  return { fields: [...builtins, ...customs].sort((a, b) => a.order - b.order) };
}

const TemplateFieldSchema = z.object({
  key:      z.string().min(1).max(60),
  label:    z.string().min(1).max(120).trim(),
  enabled:  z.boolean().optional().default(true),
  required: z.boolean().optional().default(false),
  order:    z.number().int().min(0).optional().default(0),
});
const TemplateSchema = z.object({ fields: z.array(TemplateFieldSchema).max(32) });

function _getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Server-side enforcement of the template's own `required` flags — the
// client (LessonPlanSlideOver) already blocks submission for a missing
// required field, but that alone is advisory only: a direct API call, or a
// client with a stale cached template, could otherwise still create/save a
// plan missing something this school has marked required. `planLike` only
// needs to have the same shape POST/PUT's own validated `data` already
// does (objectives/activities/.../differentiation/reflection/customFields)
// — this never touches the DB itself, callers pass in whatever the
// resulting document state would be (see POST's own call for "check the
// incoming data", PUT's for "check the MERGED final state" so a partial
// edit can never un-satisfy a field that was already filled in).
function _missingRequiredFields(planLike, template) {
  const missing = [];
  for (const f of template.fields) {
    if (!f.enabled || !f.required) continue;
    if (f.builtin) {
      const val = _getByPath(planLike, f.path);
      if (!val || !String(val).trim()) missing.push(f.label);
    } else {
      const cf = (planLike.customFields || []).find(c => c.key === f.key);
      if (!cf || !cf.value || !String(cf.value).trim()) missing.push(f.label);
    }
  }
  return missing;
}

/* ── GET /api/lessons/template ─ this school's field config ─── */
router.get('/template', authMiddleware, PLAN, MODGATE, rbac('lessons', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const school = await _model('schools').findOne({ id: schoolId }, { lessonPlanTemplate: 1 }).lean();
    return ok(res, _mergeTemplate(school?.lessonPlanTemplate));
  } catch (err) { console.error('[lessons/template GET]', err); return E.serverError(res); }
});

/* ── PUT /api/lessons/template ─ configure fields for this school ─
   Gated by hasExplicitSubGrant (no coarse-grant fallback) — same
   mechanism as hr__workflow/report_cards__workflow: this configures what
   every teacher in the school sees on every future lesson plan, a
   materially more sensitive action than plain lessons:update, so holding
   ordinary "Edit Lesson Plan" must not silently imply it. admin/
   superadmin/principal/deputy_principal bypass unconditionally (same
   floor as isAdmin() elsewhere in this file). */
const TEMPLATE_FLOOR = new Set(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy', 'acting_deputy', 'head_of_school']);
router.put('/template', authMiddleware, PLAN, MODGATE, rbac('lessons', 'update'), async (req, res) => {
  try {
    const { schoolId, userId, role, roles = [] } = req.jwtUser;
    const effectiveRoles = new Set([role, ...roles]);
    const isFloor = [...effectiveRoles].some(r => TEMPLATE_FLOOR.has(r));
    if (!isFloor && !(await hasExplicitSubGrant(req, 'lessons', 'template', 'update'))) {
      return E.forbidden(res, 'You do not have permission to configure the Lesson Plan template.');
    }

    const { data, error } = _validate(TemplateSchema, req.body);
    if (error) return E.validation(res, error);

    // Builtins keep their real path/group/builtin flag regardless of what
    // the client sent for those — only label/enabled/required/order are
    // ever actually editable for a builtin. A key that isn't in
    // BUILTIN_FIELDS is treated as a new/existing custom field instead.
    const seenKeys = new Set();
    const fields = data.fields.map((f, i) => {
      if (seenKeys.has(f.key)) throw Object.assign(new Error(`Duplicate field key "${f.key}"`), { status: 422 });
      seenKeys.add(f.key);
      const builtin = BUILTIN_FIELDS.find(b => b.key === f.key);
      if (builtin) {
        return { key: builtin.key, path: builtin.path, group: builtin.group, builtin: true, label: f.label, enabled: f.enabled, required: f.required, order: f.order ?? i };
      }
      return { key: f.key, path: null, group: 'custom', builtin: false, label: f.label, enabled: f.enabled, required: f.required, order: f.order ?? i };
    });

    await _model('schools').updateOne({ id: schoolId }, { $set: { lessonPlanTemplate: { fields, updatedBy: userId, updatedAt: new Date().toISOString() } } });
    return ok(res, _mergeTemplate({ fields }));
  } catch (err) {
    if (err.status === 422) return E.validation(res, [{ field: 'fields', message: err.message }]);
    console.error('[lessons/template PUT]', err); return E.serverError(res);
  }
});

// Monday of the week containing `dateStr` — computed at read time from the
// lesson's own date rather than stored, so there's one source of truth
// instead of a separately-typed "Week" field that can drift from the date.
function _weekStartOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  return d.toISOString().slice(0, 10);
}

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ── Helper: get teacher's assignments ─────────────────────── */
async function _teacherAssignments(schoolId, teacherId) {
  return tenantModel('teaching_assignments', { schoolId })
    .find({ schoolId, teacherId })
    .select('classId className subjectId subjectName streamId streamName')
    .lean();
}

/* ── Helper: coverage identity filter for one class-subject-[stream] ──
   The exact same optional-field pattern subtopicId already uses below —
   a stream-scoped assignment's coverage never bleeds into a whole-class
   assignment's shared coverage (or another stream's), and vice versa. */
function _streamFilterPart(streamId) {
  return streamId ? { streamId } : { streamId: { $exists: false } };
}

/* ── Helper: build coverage map for a set of class-subjects ─── */
async function _coverageMap(schoolId, classId, subjectId, academicYear) {
  const filter = { schoolId, classId, subjectId };
  if (academicYear) filter.academicYear = academicYear;
  const records = await tenantModel('lesson_coverage', { schoolId }).find(filter).lean();
  // Map: topicId_subtopicId → record (or topicId → record for full topic)
  const map = {};
  records.forEach(r => {
    const key = r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId;
    map[key] = r;
  });
  return map;
}

/* ═══════════════════════════════════════════════════════════════
   TOPIC ROUTES
   ═══════════════════════════════════════════════════════════════ */

/* ── GET /api/lessons/topics ─ list topics for a subject ────── */
router.get('/topics', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: intentionally open to every authenticated user — curriculum reference data
  try {
    const { schoolId } = req.jwtUser;
    const { subjectId, academicYear } = req.query;
    if (!subjectId) return E.validation(res, [{ field: 'subjectId', message: 'subjectId is required' }]);

    const filter = { schoolId, subjectId };
    if (academicYear) filter.academicYear = academicYear;

    const topics = await tenantModel('syllabus_topics', tenantContext(req))
      .find(filter)
      .sort({ order: 1, createdAt: 1 })
      .lean();

    return ok(res, topics);
  } catch (err) { console.error('[lessons/topics GET]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/topics ─ create topic ────────────────── */
router.post('/topics', authMiddleware, PLAN, MODGATE, rbac('lessons', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(TopicSchema, req.body);
    if (error) return E.validation(res, error);

    // Resolve subject name if not provided
    let subjectName = data.subjectName;
    if (!subjectName) {
      const sub = await tenantModel('subjects', tenantContext(req)).findOne({ id: data.subjectId, schoolId }).select('name').lean();
      subjectName = sub?.name ?? '';
    }

    // Get academic year from school if not provided
    let academicYear = data.academicYear;
    if (!academicYear) {
      const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
      academicYear = school?.academicYear ?? String(new Date().getFullYear());
    }

    // Assign subtopic IDs if missing
    const subtopics = (data.subtopics || []).map((st, i) => ({
      id:    st.id || uuidv4(),
      title: st.title,
      order: st.order ?? i,
    }));

    const doc = await tenantModel('syllabus_topics', tenantContext(req)).create({
      id: uuidv4(),
      schoolId,
      subjectId:    data.subjectId,
      subjectName,
      academicYear,
      title:        data.title,
      description:  data.description || '',
      order:        data.order,
      subtopics,
      createdBy:    userId,
      updatedBy:    userId,
    });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[lessons/topics POST]', err); return E.serverError(res); }
});

/* ── PUT /api/lessons/topics/:id ─ update topic ─────────────── */
router.put('/topics/:id', authMiddleware, PLAN, MODGATE, rbac('lessons', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(TopicSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const update = { ...data, updatedBy: userId };
    // Ensure subtopic IDs
    if (update.subtopics) {
      update.subtopics = update.subtopics.map((st, i) => ({
        id:    st.id || uuidv4(),
        title: st.title,
        order: st.order ?? i,
      }));
    }

    const doc = await tenantModel('syllabus_topics', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      update,
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Topic not found');
    return ok(res, doc);
  } catch (err) { console.error('[lessons/topics PUT/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/topics/:id ─ delete topic ──────────── */
router.delete('/topics/:id', authMiddleware, PLAN, MODGATE, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('syllabus_topics', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Topic not found');
    // Also remove coverage records for this topic
    await tenantModel('lesson_coverage', tenantContext(req)).deleteMany({ schoolId, topicId: req.params.id });
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[lessons/topics DELETE/:id]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/topics/reorder ─ reorder topics ─────── */
router.post('/topics/reorder', authMiddleware, PLAN, MODGATE, rbac('lessons', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    // Body: { subjectId, academicYear, order: [{ id, order }] }
    const { subjectId, academicYear, order } = req.body;
    if (!subjectId || !Array.isArray(order)) return E.validation(res, [{ field: 'order', message: 'order array is required' }]);

    await Promise.all(order.map(({ id, order: o }) =>
      tenantModel('syllabus_topics', tenantContext(req)).updateOne({ id, schoolId, subjectId }, { order: o, updatedBy: userId })
    ));
    return ok(res, { reordered: order.length });
  } catch (err) { console.error('[lessons/topics/reorder POST]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/topics/copy-from ─ copy from colleague ─ */
/*
  Copy syllabus topics from another teacher's records for the
  same subject/academicYear. Used when a co-teacher has already
  populated the curriculum.
  Body: { fromTeacherId, subjectId, academicYear }
  Since topics are now SHARED (not per-teacher), this copies topics
  from another school's syllabus or another academic year.
*/
router.post('/topics/copy-from', authMiddleware, PLAN, MODGATE, rbac('lessons', 'create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { fromAcademicYear, toAcademicYear, subjectId } = req.body;
    if (!fromAcademicYear || !toAcademicYear || !subjectId) {
      return E.validation(res, [{ field: 'fromAcademicYear', message: 'fromAcademicYear, toAcademicYear, and subjectId are required' }]);
    }
    if (fromAcademicYear === toAcademicYear) {
      return E.validation(res, [{ field: 'fromAcademicYear', message: 'Cannot copy from same academic year' }]);
    }

    const sourceDocs = await tenantModel('syllabus_topics', tenantContext(req))
      .find({ schoolId, subjectId, academicYear: fromAcademicYear })
      .lean();

    if (!sourceDocs.length) return ok(res, { copied: 0, message: 'No topics found in source year' });

    // Check if target already has topics
    const existing = await tenantModel('syllabus_topics', tenantContext(req)).countDocuments({ schoolId, subjectId, academicYear: toAcademicYear });
    if (existing > 0) return E.conflict(res, `Target year already has ${existing} topic(s). Delete them first or choose a different year.`);

    const newDocs = sourceDocs.map(src => ({
      ...src,
      _id:          undefined,
      id:           uuidv4(),
      academicYear: toAcademicYear,
      subtopics:    (src.subtopics || []).map(st => ({ ...st, id: uuidv4() })),
      createdBy:    userId,
      updatedBy:    userId,
      createdAt:    new Date(),
      updatedAt:    new Date(),
    }));

    await tenantModel('syllabus_topics', tenantContext(req)).insertMany(newDocs);
    return ok(res, { copied: newDocs.length });
  } catch (err) { console.error('[lessons/topics/copy-from POST]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   COVERAGE ROUTES
   ═══════════════════════════════════════════════════════════════ */

/* ── GET /api/lessons/my-classes ─ teacher's class overview ─── */
/*
  Returns each of the teacher's assigned class-subject pairs
  enriched with coverage percentage for the current academic year.
*/
router.get('/my-classes', authMiddleware, PLAN, MODGATE, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;

    // Get academic year from school
    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = school?.academicYear ?? String(new Date().getFullYear());

    // Teacher's assignments
    const assignments = await _teacherAssignments(schoolId, userId);
    if (!assignments.length) return ok(res, []);

    // For each assignment, calculate coverage
    const results = await Promise.all(assignments.map(async (a) => {
      // Total subtopic items for this subject/year
      const topics = await tenantModel('syllabus_topics', tenantContext(req))
        .find({ schoolId, subjectId: a.subjectId, academicYear })
        .select('id subtopics')
        .lean();

      // Count coverable items (each subtopic counts separately; if no subtopics, topic itself counts)
      let totalItems = 0;
      topics.forEach(t => {
        totalItems += t.subtopics?.length ? t.subtopics.length : 1;
      });

      // Count covered items for this exact class-subject[-stream] — a
      // stream-scoped assignment's coverage never merges with a sibling
      // stream's or the whole-class total, matching how it's written
      // (see POST /coverage's identical identity filter).
      const coveredCount = await tenantModel('lesson_coverage', tenantContext(req)).countDocuments({
        schoolId, classId: a.classId, subjectId: a.subjectId, academicYear, ..._streamFilterPart(a.streamId),
      });

      const pct = totalItems > 0 ? Math.round((Math.min(coveredCount, totalItems) / totalItems) * 100) : 0;

      return {
        classId:     a.classId,
        className:   a.className,
        streamId:    a.streamId ?? null,
        streamName:  a.streamName ?? null,
        subjectId:   a.subjectId,
        subjectName: a.subjectName,
        totalTopics: topics.length,
        totalItems,
        coveredItems: Math.min(coveredCount, totalItems),
        pct,
        academicYear,
      };
    }));

    return ok(res, results);
  } catch (err) { console.error('[lessons/my-classes GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/coverage ─ detailed coverage for class ── */
/*
  Returns topics with coverage markers for a given classId + subjectId
  [+ streamId]. Used by the teacher drill-down view.
  Query: classId, subjectId, streamId (optional), academicYear (optional)
*/
router.get('/coverage', authMiddleware, PLAN, MODGATE, scopeMiddleware, async (req, res) => { // rbac: scopeMiddleware above + intentionally open — curriculum reference data
  try {
    const { schoolId } = req.jwtUser;
    const { classId, subjectId, streamId, academicYear } = req.query;
    if (!classId || !subjectId) {
      return E.validation(res, [{ field: 'classId', message: 'classId and subjectId are required' }]);
    }

    // Validate classId (and, if provided, streamId) is within teacher's
    // scope before doing work. `lessons` is streamAware, so a stream-only-
    // scoped teacher (no whole-class grant at all) is correctly allowed
    // through for their own stream — previously this denied them
    // outright regardless of streamId, since the module wasn't
    // streamAware yet.
    // Uses Lessons' own narrower floor (resolveLessonsScope), not the
    // generic req.scope scopeMiddleware just populated — see that
    // function's own comment for why (exams_officer/admissions_officer/
    // finance/hr/timetabler/discipline_committee are 'school'-level for
    // their own module but have no business seeing every class's lesson
    // plans/coverage just because of that). Restored right after, same
    // discipline as attendance.js's own equivalent override.
    const _originalScope = req.scope;
    req.scope = await ScopeEngine.resolveLessonsScope(req);
    const _inScope = ScopeEngine.isClassInScope(req, 'lessons', classId, streamId);
    req.scope = _originalScope;
    if (!_inScope) {
      return E.forbidden(res, 'This class is not in your teaching assignments.');
    }

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const year = academicYear || school?.academicYear || String(new Date().getFullYear());

    const [topics, coverageRecords] = await Promise.all([
      tenantModel('syllabus_topics', tenantContext(req))
        .find({ schoolId, subjectId, academicYear: year })
        .sort({ order: 1, createdAt: 1 })
        .lean(),
      tenantModel('lesson_coverage', tenantContext(req))
        .find({ schoolId, classId, subjectId, academicYear: year, ..._streamFilterPart(streamId) })
        .lean(),
    ]);

    // Build coverage lookup
    const covered = {};
    coverageRecords.forEach(r => {
      const key = r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId;
      covered[key] = { coveredAt: r.coveredAt, notes: r.notes, id: r.id, teacherName: r.teacherName };
    });

    // Enrich topics with coverage
    const enriched = topics.map(t => {
      const topicKey = t.id;
      const enrichedSubtopics = (t.subtopics || []).map(st => ({
        ...st,
        covered:   !!covered[`${t.id}__${st.id}`],
        coverage:  covered[`${t.id}__${st.id}`] || null,
      }));

      const hasSubs  = enrichedSubtopics.length > 0;
      const allDone  = hasSubs && enrichedSubtopics.every(s => s.covered);
      const someDone = hasSubs && enrichedSubtopics.some(s => s.covered);
      const topicCov = !hasSubs ? (covered[topicKey] || null) : null;

      return {
        ...t,
        subtopics:   enrichedSubtopics,
        covered:     hasSubs ? allDone : !!topicCov,
        partial:     hasSubs ? (someDone && !allDone) : false,
        coverage:    topicCov,
      };
    });

    return ok(res, { topics: enriched, academicYear: year });
  } catch (err) { console.error('[lessons/coverage GET]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/coverage ─ mark topic/subtopic covered ─ */
router.post('/coverage', authMiddleware, PLAN, MODGATE, rbac('lessons', 'create'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CoverageSchema, req.body);
    if (error) return E.validation(res, error);

    // Security Baseline Register — this route had NO class-ownership check
    // at all: any authenticated teacher could mark coverage for a class/
    // subject they don't teach (only *deleting* a record was ever
    // restricted to your own — see DELETE below). Admins retain the
    // existing "submit on behalf of another teacher" ability for any
    // class; a non-admin teacher must actually hold the assignment for
    // this exact class[-stream] they're submitting for.
    // Lessons' own narrower floor (resolveLessonsScope) — see GET
    // /coverage's identical comment above for why the generic req.scope
    // isn't trusted here.
    if (!isAdmin(req)) {
      const _originalScope = req.scope;
      req.scope = await ScopeEngine.resolveLessonsScope(req);
      const _inScope = ScopeEngine.isClassInScope(req, 'lessons', data.classId, data.streamId);
      req.scope = _originalScope;
      if (!_inScope) return E.forbidden(res, 'This class is not in your teaching assignments.');
    }

    // Teachers can only submit for themselves unless admin
    const effectiveTeacherId = (isAdmin(req) && data.teacherId) ? data.teacherId : userId;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = school?.academicYear ?? String(new Date().getFullYear());

    // Validate topic exists
    const topic = await tenantModel('syllabus_topics', tenantContext(req)).findOne({ id: data.topicId, schoolId }).lean();
    if (!topic) return E.notFound(res, 'Topic not found');

    // If subtopicId provided, validate it belongs to the topic
    if (data.subtopicId) {
      const stExists = (topic.subtopics || []).some(st => st.id === data.subtopicId);
      if (!stExists) return E.notFound(res, 'Subtopic not found on this topic');
    }

    // Get teacher name
    let teacherName = req.jwtUser.name ?? '';
    if (effectiveTeacherId !== userId) {
      const t = await tenantModel('users', tenantContext(req)).findOne({ id: effectiveTeacherId, schoolId }).select('name').lean();
      teacherName = t?.name ?? teacherName;
    }

    // Upsert — prevent duplicate coverage records for same class-subject-
    // [stream-]topic-subtopic. streamId is part of the identity now, same
    // as subtopicId already was: a stream-scoped assignment's coverage
    // never merges with a sibling stream's or a whole-class total.
    const filter = {
      schoolId,
      classId:    data.classId,
      subjectId:  data.subjectId,
      topicId:    data.topicId,
      academicYear,
      ...(data.subtopicId ? { subtopicId: data.subtopicId } : { subtopicId: { $exists: false } }),
      ..._streamFilterPart(data.streamId),
    };

    const update = {
      $setOnInsert: { id: uuidv4(), createdBy: userId, ...(data.streamId ? { streamId: data.streamId } : {}) },
      $set: {
        teacherId:   effectiveTeacherId,
        teacherName,
        className:   data.classId,   // will be enriched below
        subjectName: topic.subjectName || '',
        topicTitle:  topic.title,
        coveredAt:   data.coveredAt || new Date().toISOString(),
        notes:       data.notes || '',
        updatedBy:   userId,
      },
    };

    // Enrich with className
    const cls = await tenantModel('classes', tenantContext(req)).findOne({ id: data.classId, schoolId }).select('name').lean();
    if (cls) update.$set.className = cls.name;

    const doc = await tenantModel('lesson_coverage', tenantContext(req)).findOneAndUpdate(filter, update, { new: true, upsert: true, runValidators: false }).lean();
    return ok(res, doc);
  } catch (err) { console.error('[lessons/coverage POST]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/coverage/:id ─ unmark coverage ─────── */
router.delete('/coverage/:id', authMiddleware, PLAN, MODGATE, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const filter = { id: req.params.id, schoolId };
    // Teachers can only delete their own records
    if (!isAdmin(req)) filter.teacherId = userId;

    const doc = await tenantModel('lesson_coverage', tenantContext(req)).findOneAndDelete(filter);
    if (!doc) return E.notFound(res, 'Coverage record not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[lessons/coverage DELETE/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/coverage (bulk unmark for class-subject-[stream-]topic) */
router.delete('/coverage', authMiddleware, PLAN, MODGATE, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, streamId, topicId, subtopicId } = req.query;
    if (!classId || !subjectId || !topicId) {
      return E.validation(res, [{ field: 'classId', message: 'classId, subjectId, and topicId are required' }]);
    }

    const filter = { schoolId, classId, subjectId, topicId, ..._streamFilterPart(streamId) };
    if (subtopicId) filter.subtopicId = subtopicId;
    if (!isAdmin(req)) filter.teacherId = userId;

    const result = await tenantModel('lesson_coverage', tenantContext(req)).deleteMany(filter);
    return ok(res, { deleted: result.deletedCount });
  } catch (err) { console.error('[lessons/coverage DELETE bulk]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   LESSON PLAN ROUTES  (Trinitas + Trinity, 2026-09)
   One lesson plan document per lesson (class[-stream]-subject-date).
   A teacher plans several in one sitting for a whole week, but each
   saves as its own record — there is no separate "week" entity.
   ═══════════════════════════════════════════════════════════════ */

/* Term/year display label for a resolved {academicYearId, termId} pair —
   term NUMBER is derived from array position, same convention
   academic-config.js's _resolveCurrentPeriod already uses (terms have no
   stored name, just start/end dates in order). */
async function _periodLabel(schoolId, ctx, academicYearId, termId) {
  if (!academicYearId) return '';
  const year = await tenantModel('academic_years', ctx).findOne({ schoolId, id: academicYearId }).select('name terms').lean();
  if (!year) return '';
  const terms = Array.isArray(year.terms) ? year.terms : [];
  const idx = terms.findIndex(t => t.id === termId);
  return idx >= 0 ? `Term ${idx + 1}, ${year.name || ''}`.trim() : (year.name || '');
}

function _enrichPlan(doc, periodLabel) {
  return { ...doc, weekStart: _weekStartOf(doc.date), termYearLabel: periodLabel ?? '' };
}

/* ── GET /api/lessons/plans ─ list (own by default; admin/HOD can filter by teacher) */
router.get('/plans', authMiddleware, PLAN, MODGATE, rbac('lessons', 'read'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { classId, subjectId, streamId, teacherId, dateFrom, dateTo, topicId } = req.query;

    const filter = { schoolId };
    if (classId)    filter.classId    = classId;
    if (subjectId)  filter.subjectId  = subjectId;
    if (topicId)    filter.topicId    = topicId;
    if (streamId !== undefined) Object.assign(filter, _streamFilterPart(streamId || undefined));
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = dateFrom;
      if (dateTo)   filter.date.$lte = dateTo;
    }

    // Non-admin/HOD: always their own, regardless of what teacherId was
    // asked for — this is a personal planning record, not shared reference
    // data like syllabus topics, so it doesn't get the "intentionally open"
    // treatment those routes use.
    if (!isHodOrAdmin(req)) {
      filter.teacherId = userId;
    } else if (teacherId) {
      filter.teacherId = teacherId;
    }

    const docs = await tenantModel('lesson_plans', tenantContext(req)).find(filter).sort({ date: -1, createdAt: -1 }).lean();

    const yearIds = [...new Set(docs.map(d => d.academicYearId).filter(Boolean))];
    const labels = {};
    await Promise.all(yearIds.map(async yid => {
      const sample = docs.find(d => d.academicYearId === yid);
      labels[yid + '__' + (sample.termId || '')] = await _periodLabel(schoolId, tenantContext(req), yid, sample.termId);
    }));

    const enriched = docs.map(d => _enrichPlan(d, labels[(d.academicYearId || '') + '__' + (d.termId || '')]));
    return ok(res, enriched);
  } catch (err) { console.error('[lessons/plans GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/plans/:id ─ single record ─────────────── */
router.get('/plans/:id', authMiddleware, PLAN, MODGATE, rbac('lessons', 'read'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await tenantModel('lesson_plans', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Lesson plan not found');
    if (!isHodOrAdmin(req) && doc.teacherId !== userId) return E.forbidden(res, 'This is not your lesson plan.');

    const periodLabel = await _periodLabel(schoolId, tenantContext(req), doc.academicYearId, doc.termId);
    return ok(res, _enrichPlan(doc, periodLabel));
  } catch (err) { console.error('[lessons/plans GET/:id]', err); return E.serverError(res); }
});

/* ── POST /api/lessons/plans ─ create ───────────────────────── */
router.post('/plans', authMiddleware, PLAN, MODGATE, rbac('lessons', 'create'), scopeMiddleware, async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(LessonPlanSchema, req.body);
    if (error) return E.validation(res, error);

    // Same ownership rule as POST /coverage: a non-admin can only plan for
    // a class[-stream] they actually teach; admin retains submit-on-behalf.
    // Lessons' own narrower floor (resolveLessonsScope) — see GET
    // /coverage's comment for why the generic req.scope isn't trusted here.
    if (!isAdmin(req)) {
      const _originalScope = req.scope;
      req.scope = await ScopeEngine.resolveLessonsScope(req);
      const _inScope = ScopeEngine.isClassInScope(req, 'lessons', data.classId, data.streamId);
      req.scope = _originalScope;
      if (!_inScope) return E.forbidden(res, 'This class is not in your teaching assignments.');
    }
    const effectiveTeacherId = (isAdmin(req) && data.teacherId) ? data.teacherId : userId;

    // The precondition Trinitas/Trinity asked for — "topics must be
    // updated first" — isn't a separate check, it falls out of topicId
    // being required and validated here: a subject with zero topics has
    // nothing a client picker could have sent.
    const topic = await tenantModel('syllabus_topics', tenantContext(req)).findOne({ id: data.topicId, schoolId, subjectId: data.subjectId }).lean();
    if (!topic) return E.notFound(res, 'Topic not found for this subject — add topics under Lessons → Topics first.');
    if (data.subtopicId && !(topic.subtopics || []).some(st => st.id === data.subtopicId)) {
      return E.notFound(res, 'Subtopic not found on this topic');
    }

    const period = await resolveAcademicPeriod(schoolId, tenantContext(req), { academicYearId: data.academicYearId, termId: data.termId });
    if (period.error) return E.badRequest(res, period.error);

    const [cls, subject, stream] = await Promise.all([
      tenantModel('classes', tenantContext(req)).findOne({ id: data.classId, schoolId }).select('name').lean(),
      tenantModel('subjects', tenantContext(req)).findOne({ id: data.subjectId, schoolId }).select('name').lean(),
      data.streamId ? tenantModel('streams', tenantContext(req)).findOne({ id: data.streamId, schoolId }).select('name').lean() : null,
    ]);

    let teacherName = req.jwtUser.name ?? '';
    if (effectiveTeacherId !== userId) {
      const t = await tenantModel('users', tenantContext(req)).findOne({ id: effectiveTeacherId, schoolId }).select('name').lean();
      teacherName = t?.name ?? teacherName;
    }

    // Snapshot the EFFECTIVE label for every builtin field at creation time
    // — a school renaming "Remarks" to "Notes" next term must never rewrite
    // what this specific plan displays as, the same "retrievable for later
    // reference" guarantee customFields' own {key,label,value} shape gives
    // custom fields. The PDF/detail view read fieldLabels, never the live
    // template, for exactly this record.
    const schoolDoc = await _model('schools').findOne({ id: schoolId }, { lessonPlanTemplate: 1 }).lean();
    const template = _mergeTemplate(schoolDoc?.lessonPlanTemplate);
    const fieldLabels = Object.fromEntries(template.fields.filter(f => f.builtin).map(f => [f.key, f.label]));

    const missing = _missingRequiredFields(data, template);
    if (missing.length) return E.validation(res, missing.map(label => ({ field: label, message: `"${label}" is required` })));

    const doc = await tenantModel('lesson_plans', tenantContext(req)).create({
      id: uuidv4(),
      schoolId,
      teacherId:   effectiveTeacherId,
      teacherName,
      classId:     data.classId,
      className:   cls?.name ?? '',
      ...(data.streamId ? { streamId: data.streamId, streamName: stream?.name ?? '' } : {}),
      subjectId:   data.subjectId,
      subjectName: subject?.name ?? '',
      date:        data.date,
      academicYearId: period.academicYearId,
      termId:         period.termId,
      topicId:     data.topicId,
      topicTitle:  topic.title,
      ...(data.subtopicId ? { subtopicId: data.subtopicId, subtopicTitle: (topic.subtopics || []).find(st => st.id === data.subtopicId)?.title ?? '' } : {}),
      objectives:  data.objectives,
      activities:  data.activities,
      resources:   data.resources,
      remarks:     data.remarks,
      differentiation: data.differentiation,
      assessment:  data.assessment,
      homework:    data.homework,
      reflection:  data.reflection,
      customFields: data.customFields,
      fieldLabels,
      createdBy:   userId,
      updatedBy:   userId,
    });

    const plain = doc.toObject ? doc.toObject() : doc;
    const periodLabel = await _periodLabel(schoolId, tenantContext(req), plain.academicYearId, plain.termId);
    return created(res, _enrichPlan(plain, periodLabel));
  } catch (err) { console.error('[lessons/plans POST]', err); return E.serverError(res); }
});

/* ── PUT /api/lessons/plans/:id ─ update (incl. Reflection) ─── */
router.put('/plans/:id', authMiddleware, PLAN, MODGATE, rbac('lessons', 'update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(LessonPlanUpdateSchema, req.body);
    if (error) return E.validation(res, error);

    const existing = await tenantModel('lesson_plans', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Lesson plan not found');
    // Reflection is the subject teacher's own — no HOD/admin edit carve-out,
    // matching "Reflection = its the subject teacher" exactly. Admin keeps
    // the same override every other lessons.js write route already has.
    if (!isAdmin(req) && existing.teacherId !== userId) return E.forbidden(res, 'This is not your lesson plan.');

    const update = { ...data, updatedBy: userId };
    if (data.differentiation) update.differentiation = { ...existing.differentiation, ...data.differentiation };
    if (data.reflection)      update.reflection      = { ...existing.reflection,      ...data.reflection };

    // Check the RESULTING merged state, not just the incoming diff — a
    // partial edit (e.g. only filling in Reflection weeks later) must never
    // appear to un-satisfy a required field that was already filled in at
    // creation, but it also must never be usable to sneak past a required
    // field this school added to the template after this plan was created.
    const schoolDocForReq = await _model('schools').findOne({ id: schoolId }, { lessonPlanTemplate: 1 }).lean();
    const templateForReq = _mergeTemplate(schoolDocForReq?.lessonPlanTemplate);
    const missing = _missingRequiredFields({ ...existing, ...update }, templateForReq);
    if (missing.length) return E.validation(res, missing.map(label => ({ field: label, message: `"${label}" is required` })));

    // Re-validate topic/subtopic only if the caller actually changed them —
    // avoids a redundant lookup on the common case (editing Reflection
    // weeks later, topicId untouched).
    if (data.topicId && data.topicId !== existing.topicId) {
      const topic = await tenantModel('syllabus_topics', tenantContext(req)).findOne({ id: data.topicId, schoolId }).lean();
      if (!topic) return E.notFound(res, 'Topic not found');
      update.topicTitle = topic.title;
      if (data.subtopicId) {
        const st = (topic.subtopics || []).find(s => s.id === data.subtopicId);
        if (!st) return E.notFound(res, 'Subtopic not found on this topic');
        update.subtopicTitle = st.title;
      }
    }

    const doc = await tenantModel('lesson_plans', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId }, update, { new: true, runValidators: false }
    ).lean();

    const periodLabel = await _periodLabel(schoolId, tenantContext(req), doc.academicYearId, doc.termId);
    return ok(res, _enrichPlan(doc, periodLabel));
  } catch (err) { console.error('[lessons/plans PUT/:id]', err); return E.serverError(res); }
});

/* ── DELETE /api/lessons/plans/:id ──────────────────────────── */
router.delete('/plans/:id', authMiddleware, PLAN, MODGATE, rbac('lessons', 'delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const filter = { id: req.params.id, schoolId };
    if (!isAdmin(req)) filter.teacherId = userId; // same "own records only" rule as DELETE /coverage/:id

    const doc = await tenantModel('lesson_plans', tenantContext(req)).findOneAndDelete(filter);
    if (!doc) return E.notFound(res, 'Lesson plan not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[lessons/plans DELETE/:id]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/plans/:id/pdf ─ printable/exportable copy ─
   "Should be something like the template, but picked from the system's
   own school settings" — the school's own name/logo (Settings → School),
   not Trinitas's literal letterhead, so this renders correctly for every
   school that turns the feature on, not just the two that asked for it. */
router.get('/plans/:id/pdf', authMiddleware, PLAN, MODGATE, rbac('lessons', 'read'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const plan = await tenantModel('lesson_plans', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!plan) return E.notFound(res, 'Lesson plan not found');
    if (!isHodOrAdmin(req) && plan.teacherId !== userId) return E.forbidden(res, 'This is not your lesson plan.');

    const [school, periodLabel] = await Promise.all([
      _model('schools').findOne({ id: schoolId }, { name: 1, logoUrl: 1 }).lean(),
      _periodLabel(schoolId, tenantContext(req), plan.academicYearId, plan.termId),
    ]);

    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch { return res.status(501).json({ error: 'pdfkit not installed. Run: npm install pdfkit' }); }

    const { fetchImageBuf, _buildLessonPlanPDF } = require('../utils/lesson-plan-pdf');
    const schoolLogo = await fetchImageBuf(school?.logoUrl).catch(() => null);

    const pdfDoc  = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers = [];
    pdfDoc.on('data', chunk => buffers.push(chunk));
    pdfDoc.on('end', () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="lesson-plan-${plan.id}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    });

    _buildLessonPlanPDF(pdfDoc, _enrichPlan(plan, periodLabel), school, { schoolLogo });
    pdfDoc.end();
  } catch (err) { console.error('[lessons/plans/:id/pdf GET]', err); return E.serverError(res); }
});

/* ═══════════════════════════════════════════════════════════════
   ADMIN / HOD / PORTAL SUMMARY ROUTES
   ═══════════════════════════════════════════════════════════════ */

/* ── GET /api/lessons/summary ─ school-wide overview (admin/HOD) */
/*
  Returns all teaching assignments enriched with coverage %.
  Used by admin/HOD overview grid.
*/
router.get('/summary', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: isHodOrAdmin() below — real custom guard
  try {
    // Fix: this route was documented "admin/HOD" (see comment above) but had
    // no actual enforcement — any authenticated user, including students,
    // could pull the full school-wide teacher coverage overview. Reuses the
    // same isHodOrAdmin() guard /pending-teachers already uses below.
    if (!isHodOrAdmin(req)) return E.forbidden(res, 'HOD or admin access required');

    const { schoolId } = req.jwtUser;
    const { academicYear: yearQ, subjectId, classId, departmentId } = req.query;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = yearQ || school?.academicYear || String(new Date().getFullYear());

    let assignFilter = { schoolId };
    if (subjectId)    assignFilter.subjectId   = subjectId;
    if (classId)      assignFilter.classId      = classId;
    if (departmentId) assignFilter.departmentId = departmentId;

    const assignments = await tenantModel('teaching_assignments', tenantContext(req)).find(assignFilter).lean();

    // Aggregate topics count per subject
    const topicCounts = {};
    const uniqueSubjects = [...new Set(assignments.map(a => a.subjectId))];
    await Promise.all(uniqueSubjects.map(async sid => {
      const topics = await tenantModel('syllabus_topics', tenantContext(req)).find({ schoolId, subjectId: sid, academicYear }).select('id subtopics').lean();
      let total = 0;
      topics.forEach(t => { total += t.subtopics?.length ? t.subtopics.length : 1; });
      topicCounts[sid] = total;
    }));

    // Coverage per class-subject[-stream] — a stream-scoped assignment's
    // row must never be credited with a sibling stream's (or the whole
    // class's) coverage, matching how it's written (see POST /coverage).
    const coverageCounts = {};
    await Promise.all(assignments.map(async a => {
      const key = `${a.classId}__${a.subjectId}__${a.streamId ?? ''}`;
      const count = await tenantModel('lesson_coverage', tenantContext(req)).countDocuments({
        schoolId, classId: a.classId, subjectId: a.subjectId, academicYear, ..._streamFilterPart(a.streamId),
      });
      coverageCounts[key] = count;
    }));

    const rows = assignments.map(a => {
      const totalItems   = topicCounts[a.subjectId] || 0;
      const covered      = coverageCounts[`${a.classId}__${a.subjectId}__${a.streamId ?? ''}`] || 0;
      const pct          = totalItems > 0 ? Math.round((Math.min(covered, totalItems) / totalItems) * 100) : 0;
      return {
        teacherId:   a.teacherId,
        teacherName: a.teacherName,
        classId:     a.classId,
        className:   a.className,
        streamId:    a.streamId ?? null,
        streamName:  a.streamName ?? null,
        subjectId:   a.subjectId,
        subjectName: a.subjectName,
        totalItems,
        coveredItems: Math.min(covered, totalItems),
        pct,
        academicYear,
      };
    });

    return ok(res, rows);
  } catch (err) { console.error('[lessons/summary GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/class-summary/:classId ─ student/parent portal */
/*
  Returns per-subject coverage for a class.
  Used in student and parent dashboards.
*/
router.get('/class-summary/:classId', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: intentionally open — used by student/parent dashboards, see comment above
  try {
    const { schoolId } = req.jwtUser;
    const { classId } = req.params;
    const { academicYear: yearQ } = req.query;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = yearQ || school?.academicYear || String(new Date().getFullYear());

    // Get subjects taught in this class via teaching assignments
    const assignments = await tenantModel('teaching_assignments', tenantContext(req))
      .find({ schoolId, classId })
      .select('subjectId subjectName teacherName')
      .lean();

    const uniqueBySubject = Object.values(
      assignments.reduce((acc, a) => { acc[a.subjectId] = a; return acc; }, {})
    );

    const rows = await Promise.all(uniqueBySubject.map(async (a) => {
      const topics = await tenantModel('syllabus_topics', tenantContext(req))
        .find({ schoolId, subjectId: a.subjectId, academicYear })
        .select('id title subtopics order')
        .sort({ order: 1 })
        .lean();

      let totalItems = 0;
      topics.forEach(t => { totalItems += t.subtopics?.length ? t.subtopics.length : 1; });

      const coverageRecords = await tenantModel('lesson_coverage', tenantContext(req))
        .find({ schoolId, classId, subjectId: a.subjectId, academicYear })
        .lean();

      const coveredKeys = new Set(coverageRecords.map(r =>
        r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId
      ));

      // Enrich topics for the portal view
      const enrichedTopics = topics.map(t => {
        if (t.subtopics?.length) {
          const coveredSubs = t.subtopics.filter(st => coveredKeys.has(`${t.id}__${st.id}`)).length;
          return {
            title:    t.title,
            total:    t.subtopics.length,
            covered:  coveredSubs,
            pct:      Math.round((coveredSubs / t.subtopics.length) * 100),
          };
        }
        return {
          title:   t.title,
          total:   1,
          covered: coveredKeys.has(t.id) ? 1 : 0,
          pct:     coveredKeys.has(t.id) ? 100 : 0,
        };
      });

      const pct = totalItems > 0
        ? Math.round((Math.min(coveredKeys.size, totalItems) / totalItems) * 100)
        : 0;

      return {
        subjectId:   a.subjectId,
        subjectName: a.subjectName,
        teacherName: a.teacherName,
        totalItems,
        coveredItems: Math.min(coveredKeys.size, totalItems),
        pct,
        topics:      enrichedTopics,
        academicYear,
      };
    }));

    return ok(res, rows);
  } catch (err) { console.error('[lessons/class-summary GET]', err); return E.serverError(res); }
});

/* ── GET /api/lessons/pending-teachers ─ HOD: who hasn't updated */
/*
  Returns teachers who have uncovered topics for the current week.
  Used by HOD escalation view and reminder system.
*/
router.get('/pending-teachers', authMiddleware, PLAN, MODGATE, async (req, res) => { // rbac: isHodOrAdmin() below — real custom guard
  try {
    if (!isHodOrAdmin(req)) return E.forbidden(res, 'HOD or admin access required');
    const { schoolId } = req.jwtUser;
    const { academicYear: yearQ, subjectId, departmentId } = req.query;

    const school = await _model('schools').findOne({ id: schoolId }, { academicYear: 1 }).lean();
    const academicYear = yearQ || school?.academicYear || String(new Date().getFullYear());

    let assignFilter = { schoolId };
    if (subjectId)    assignFilter.subjectId    = subjectId;
    if (departmentId) assignFilter.departmentId = departmentId;

    const assignments = await tenantModel('teaching_assignments', tenantContext(req)).find(assignFilter).lean();

    // Group by teacher
    const byTeacher = {};
    assignments.forEach(a => {
      if (!byTeacher[a.teacherId]) {
        byTeacher[a.teacherId] = { teacherId: a.teacherId, teacherName: a.teacherName, classes: [] };
      }
      byTeacher[a.teacherId].classes.push({ classId: a.classId, className: a.className, streamId: a.streamId ?? null, streamName: a.streamName ?? null, subjectId: a.subjectId, subjectName: a.subjectName });
    });

    // Check coverage completeness per teacher. Each class-subject-[stream]
    // entry counts its OWN coverage — a teacher 100% done on one stream
    // and 0% on a sibling stream must still show as pending overall, not
    // be averaged/masked by a shared count that was never split per
    // stream to begin with.
    const results = await Promise.all(Object.values(byTeacher).map(async (t) => {
      let totalItems = 0, coveredItems = 0;
      await Promise.all(t.classes.map(async (c) => {
        const topics = await tenantModel('syllabus_topics', tenantContext(req))
          .find({ schoolId, subjectId: c.subjectId, academicYear })
          .select('id subtopics').lean();
        topics.forEach(tp => { totalItems += tp.subtopics?.length ? tp.subtopics.length : 1; });

        const cov = await tenantModel('lesson_coverage', tenantContext(req)).countDocuments({
          schoolId, classId: c.classId, subjectId: c.subjectId, academicYear, ..._streamFilterPart(c.streamId),
        });
        coveredItems += cov;
      }));

      const pct = totalItems > 0 ? Math.round((Math.min(coveredItems, totalItems) / totalItems) * 100) : 100;
      return { ...t, totalItems, coveredItems: Math.min(coveredItems, totalItems), pct, hasPending: pct < 100 };
    }));

    return ok(res, results.filter(t => t.hasPending));
  } catch (err) { console.error('[lessons/pending-teachers GET]', err); return E.serverError(res); }
});

module.exports = router;
// test-only access — Role Architecture Audit 2026-08.
module.exports.isHodOrAdmin = isHodOrAdmin;
module.exports.isAdmin = isAdmin;
module.exports.isTeacher = isTeacher;
