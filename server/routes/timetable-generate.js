/* ============================================================
   Msingi — /api/timetable/generate  (automatic timetable, v5.269.0)

   The generator fills one section (or chosen classes) from the
   teaching assignments, following the hard rules (no clashes, teacher
   availability, room types, doubles) and the school's timetable rules.
   It works on the DRAFT only: nothing reaches teachers, students or
   parents until the timetabler publishes as usual.

   Routes (mounted before /api/timetable so they win over its /:id):
     POST /precheck            { scope }            what can't fit, before generating
     POST /                    { scope }            generate; stores a run, returns its summary
     GET  /runs                                     recent runs (newest first)
     GET  /runs/:id                                 one run, with its lessons and unplaced list
     POST /runs/:id/apply                           replace the scope's unlocked draft lessons
     POST /runs/:id/undo                            put back what an apply replaced

   scope = { sectionKey } or { classIds: [...] }.

   Who: scheduling admins (TIMETABLE_FLOOR_ROLES) or a role given the strict
   "Generate Timetable" permission (timetable__generate, no coarse fallback).
   Plan: FEATURE_PLAN.timetable_generator.
   Runs: `timetable_generation_runs` — { id, schoolId, scope, scopeLabel,
   academicYearId, termId, status, stats, precheck, lessons, unplaced,
   createdBy, createdAt, appliedAt, appliedBy, backup, undoneAt, undoneBy }.
   ============================================================ */
'use strict';

const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate } = require('../middleware/module-gate');
const { hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate } = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, fail, E } = require('../utils/response');
const ScopeEngine = require('../utils/scopeEngine');
const { markTimetableChanged } = require('../utils/timetable-publish');
const { checkConflicts } = require('../utils/timetable-conflicts');
const { buildProblem } = require('../utils/timetable-generator/prepare');
const { runSolver } = require('../utils/timetable-generator/worker');

const router = express.Router();
const MODGATE = moduleGate('timetable');

function generateAccess() {
  return async (req, res, next) => {
    const { role } = req.jwtUser || {};
    if (ScopeEngine.TIMETABLE_FLOOR_ROLES.has(role)) return next();
    if (await hasExplicitSubGrant(req, 'timetable', 'generate', 'update')) return next();
    return E.forbidden(res, 'Only scheduling administrators, or a role given "Generate Timetable", can use the timetable generator.');
  };
}

const ScopeSchema = z.object({
  scope: z.union([
    z.object({ sectionKey: z.string().min(1).max(50) }).strict(),
    z.object({ classIds: z.array(z.string().min(1).max(100)).min(1).max(200) }).strict(),
  ]),
  budgetSeconds: z.number().int().min(2).max(30).optional(),
});

function parseScope(req, res) {
  const r = ScopeSchema.safeParse(req.body || {});
  if (!r.success) { E.validation(res, r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }))); return null; }
  return r.data;
}

const Runs = req => tenantModel('timetable_generation_runs', tenantContext(req));

/* Turn solver placements into draft lesson documents (one per period). */
function lessonsFrom(result, meta, problem) {
  const unitById = new Map(problem.units.map(u => [u.id, u]));
  const out = [];
  for (const pl of result.placements) {
    const u = unitById.get(pl.unitId);
    const info = meta.unitInfo[pl.unitId];
    const cls = meta.classInfo[u.classId] || {};
    const doubleId = pl.segments.length > 1 ? uuidv4() : null;
    for (const seg of pl.segments) {
      out.push({
        classId: u.classId, streamId: u.streamId || null,
        day: pl.day, period: seg.periodKey, startTime: seg.start, endTime: seg.end,
        subject: info.subject, subjectId: info.subjectId,
        teacherId: info.teacherId, teacherName: info.teacherName,
        room: pl.roomName || undefined, roomId: pl.roomId || undefined,
        section: cls.section || 'all', bellScheduleId: cls.bellScheduleId ?? null,
        type: 'lesson', isActive: true,
        ...(doubleId ? { doubleId } : {}),
      });
    }
  }
  return out;
}

function unplacedFrom(result, meta) {
  return result.unplaced.map(x => ({ ...(meta.unitInfo[x.unitId] || {}), reason: x.reason }));
}

/* ── POST /precheck ─────────────────────────────────────────── */
router.post('/precheck', authMiddleware, planGate('timetable_generator'), MODGATE, generateAccess(), async (req, res) => {
  try {
    const body = parseScope(req, res);
    if (!body) return;
    const { meta, precheck } = await buildProblem(req.jwtUser.schoolId, tenantContext(req), body.scope);
    return ok(res, {
      precheck,
      lessonsNeeded: meta?.lessonsNeeded ?? 0,
      classes: meta ? Object.values(meta.classInfo).map(c => c.name) : [],
      replaceable: meta?.replaceableCount ?? 0,
      kept: meta?.keptInScope ?? 0,
    });
  } catch (err) { console.error('[timetable-generate POST /precheck]', err); return E.serverError(res); }
});

/* ── POST / — generate ─────────────────────────────────────── */
router.post('/', authMiddleware, planGate('timetable_generator'), MODGATE, generateAccess(), async (req, res) => {
  try {
    const body = parseScope(req, res);
    if (!body) return;
    const { schoolId, userId } = req.jwtUser;
    const { problem, meta, precheck } = await buildProblem(schoolId, tenantContext(req), body.scope);
    if (!problem || !problem.units.length) {
      return fail(res, 'NOTHING_TO_GENERATE', precheck.find(p => p.level === 'error')?.message || 'Nothing to place.', 400, { precheck });
    }
    const result = await runSolver(problem, { budgetMs: (body.budgetSeconds ?? 10) * 1000 });
    const lessons = lessonsFrom(result, meta, problem);
    const unplaced = unplacedFrom(result, meta);
    const run = {
      id: uuidv4(), schoolId, scope: body.scope, scopeLabel: meta.scopeLabel, scopeClassKeys: meta.scopeClassKeys,
      scopeIdForms: meta.scopeIdForms,
      replaceIds: meta.replaceIds,
      academicYearId: meta.academicYearId, termId: meta.termId,
      status: 'generated',
      stats: {
        lessonsNeeded: meta.lessonsNeeded, lessonsPlaced: lessons.length,
        unitsUnplaced: unplaced.length, lessonsUnplaced: result.unplaced.reduce((s, x) => s + (problem.units.find(u => u.id === x.unitId)?.length || 1), 0),
        violations: result.violations, score: result.score, runs: result.runs, durationMs: result.durationMs,
        replaces: meta.replaceableCount,
      },
      precheck, lessons, unplaced,
      createdBy: userId, createdAt: new Date().toISOString(),
    };
    await Runs(req).create(run);
    const { lessons: _l, ...summary } = run;
    return created(res, summary);
  } catch (err) { console.error('[timetable-generate POST /]', err); return E.serverError(res); }
});

/* ── GET /runs ──────────────────────────────────────────────── */
router.get('/runs', authMiddleware, planGate('timetable_generator'), MODGATE, generateAccess(), async (req, res) => {
  try {
    const runs = await Runs(req).find({ schoolId: req.jwtUser.schoolId })
      .sort({ createdAt: -1 }).limit(20)
      .select('id scope scopeLabel status stats createdBy createdAt appliedAt undoneAt').lean();
    return ok(res, runs.map(({ _id, ...r }) => r));
  } catch (err) { console.error('[timetable-generate GET /runs]', err); return E.serverError(res); }
});

/* ── GET /runs/:id ──────────────────────────────────────────── */
router.get('/runs/:id', authMiddleware, planGate('timetable_generator'), MODGATE, generateAccess(), async (req, res) => {
  try {
    const run = await Runs(req).findOne({ schoolId: req.jwtUser.schoolId, id: req.params.id }).select('-backup -replaceIds').lean();
    if (!run) return E.notFound(res, 'Run not found');
    const { _id, ...out } = run;
    return ok(res, out);
  } catch (err) { console.error('[timetable-generate GET /runs/:id]', err); return E.serverError(res); }
});

/* ── POST /runs/:id/apply ───────────────────────────────────────
   Replaces the scope's unlocked draft lessons (this academic year) OF THE
   SUBJECTS THE RUN PLACED (run.replaceIds, from prepare.js) with the
   generated ones. Lessons of subjects with no periods-per-week target stay.
   A copy of what's replaced is kept on the run for undo.
   Refused if anything outside the scope changed since generating in a way
   that now clashes — generate again in that case. */
router.post('/runs/:id/apply', authMiddleware, planGate('timetable_generator'), MODGATE, generateAccess(), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const run = await Runs(req).findOne({ schoolId, id: req.params.id }).lean();
    if (!run) return E.notFound(res, 'Run not found');
    if (run.appliedAt) return E.conflict(res, 'This run has already been applied.');
    if (!run.lessons?.length) return E.badRequest(res, 'This run placed no lessons.');

    const Timetable = tenantModel('timetable', tenantContext(req));
    // A lesson may store its class as `id` or String(_id): match every form.
    const scopeForms = run.scopeIdForms?.length ? run.scopeIdForms : run.scopeClassKeys;
    const current = await Timetable.find({ schoolId, isActive: true, academicYearId: run.academicYearId ?? null, classId: { $in: scopeForms } }).lean();
    // Only the lessons the run was built to replace (the subjects it placed),
    // and only if still unlocked. Everything else in the scope stays.
    const replaceSet = new Set(run.replaceIds || []);
    const toReplace = current.filter(l => !l.locked && replaceSet.has(l.id || String(l._id)));
    const replaceIds = toReplace.map(l => l.id || String(l._id));

    const now = new Date().toISOString();
    const docs = run.lessons.map(l => ({
      ...l, id: uuidv4(), schoolId,
      academicYearId: run.academicYearId ?? null, termId: run.termId ?? null,
      generationRunId: run.id, createdBy: userId, updatedBy: userId,
    }));
    // Re-check against what's there now (other sections may have changed since generating).
    for (const d of docs) {
      const clash = await checkConflicts(schoolId, d, replaceIds);
      if (clash) return fail(res, 'STALE_RUN', `The timetable changed since this was generated: ${clash} Generate again.`, 409);
    }

    // 1. Claim the run and save the backup BEFORE touching any lesson. The
    //    claim is atomic (only a run still 'generated' moves to 'applying'),
    //    so two admins can't apply the same run at once, and if anything
    //    below fails the replaced lessons are on record.
    const backup = toReplace.map(({ _id, ...l }) => l);
    const claim = await Runs(req).updateOne(
      { schoolId, id: run.id, status: 'generated', appliedAt: { $exists: false } },
      { $set: { status: 'applying', backup, applyStartedAt: now, applyStartedBy: userId } },
    );
    if (!claim || claim.modifiedCount === 0) return E.conflict(res, 'This run is already being applied, or has been.');

    // 2. Replace. If inserting fails part-way, take out what got in and put
    //    the replaced lessons back, so the draft ends as it started.
    let deleted = false;
    try {
      if (toReplace.length) {
        const withId = toReplace.filter(l => l.id).map(l => l.id);
        const noId = toReplace.filter(l => !l.id).map(l => l._id);
        await Timetable.deleteMany({ schoolId, $or: [{ id: { $in: withId } }, { _id: { $in: noId } }] });
        deleted = true;
      }
      await Timetable.insertMany(docs, { ordered: false });
    } catch (err) {
      console.error('[timetable-generate apply] write failed, rolling back:', err.message);
      try {
        await Timetable.deleteMany({ schoolId, generationRunId: run.id });
        if (deleted && backup.length) await Timetable.insertMany(backup, { ordered: false });
        await Runs(req).updateOne({ schoolId, id: run.id }, { $set: { status: 'generated', applyFailedAt: new Date().toISOString(), applyError: String(err.message).slice(0, 300) } });
      } catch (rbErr) {
        // Rollback itself failed: the backup is still saved on the run (status 'applying').
        console.error('[timetable-generate apply] ROLLBACK FAILED — backup kept on run', run.id, rbErr.message);
        return fail(res, 'APPLY_FAILED', 'Applying failed and the draft could not be put back automatically. The replaced lessons are saved on this run; contact support with the run id.', 500);
      }
      return fail(res, 'APPLY_FAILED', 'Applying failed, so nothing was changed. Try again.', 500);
    }

    // 3. Done.
    await Runs(req).updateOne({ schoolId, id: run.id }, { $set: { status: 'applied', appliedAt: now, appliedBy: userId } });
    await markTimetableChanged(schoolId);
    return ok(res, { applied: docs.length, replaced: toReplace.length });
  } catch (err) { console.error('[timetable-generate POST /runs/:id/apply]', err); return E.serverError(res); }
});

/* ── POST /runs/:id/undo ────────────────────────────────────────
   Removes the lessons this run added (only those still unchanged-by-id) and
   restores the lessons it replaced. Only the most recently applied run. */
router.post('/runs/:id/undo', authMiddleware, planGate('timetable_generator'), MODGATE, generateAccess(), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const run = await Runs(req).findOne({ schoolId, id: req.params.id }).lean();
    if (!run) return E.notFound(res, 'Run not found');
    if (!run.appliedAt || run.undoneAt) return E.conflict(res, 'This run is not applied.');
    const latest = await Runs(req).find({ schoolId, appliedAt: { $exists: true }, undoneAt: { $exists: false } })
      .sort({ appliedAt: -1 }).limit(1).select('id').lean();
    if (latest[0]?.id !== run.id) return E.conflict(res, 'Only the most recently applied run can be undone.');

    const Timetable = tenantModel('timetable', tenantContext(req));
    const removed = await Timetable.deleteMany({ schoolId, generationRunId: run.id });
    const backup = run.backup || [];
    if (backup.length) {
      // Restore under their original ids — but not on top of anything with the same id.
      const existing = await Timetable.find({ schoolId, id: { $in: backup.map(b => b.id).filter(Boolean) } }).select('id').lean();
      const taken = new Set(existing.map(e => e.id));
      const restore = backup.filter(b => !b.id || !taken.has(b.id));
      if (restore.length) await Timetable.insertMany(restore, { ordered: false });
    }
    const now = new Date().toISOString();
    await Runs(req).updateOne({ schoolId, id: run.id }, { $set: { status: 'undone', undoneAt: now, undoneBy: userId } });
    await markTimetableChanged(schoolId);
    return ok(res, { removed: removed?.deletedCount ?? null, restored: backup.length });
  } catch (err) { console.error('[timetable-generate POST /runs/:id/undo]', err); return E.serverError(res); }
});

module.exports = router;
