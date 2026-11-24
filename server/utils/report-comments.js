/* ============================================================
   Report comments — which stored comment applies (v5.280.0)

   Decided 2026-11-24 with the school that reported it:
     - The Markbook keeps ONE comment box per student, subject and term.
     - A published report keeps its own comments (the snapshot is frozen).
     - The box is empty again in a new academic year.

   Comments live in report_card_draft_comments. The Markbook box is the
   row with cycle: null. A comment typed in Report Cards with a Report
   Cycle picked (MT, ET…) is a separate row with that cycle.

   What this file answers, in one place, for every reader and writer:

   1. Which YEAR a row belongs to. Rows saved before v5.280.0 carry no
      academicYearId. They are never migrated in bulk; a row is matched to
      a year by when it was last saved, and is stamped the next time it is
      saved. The rule only hides a row from a year when there is positive
      evidence it is not that year's (saved before that year started, or
      saved after the current year started while looking at an earlier
      year). Overlapping or undated years therefore never make a live
      comment disappear.

   2. Which comment a CYCLE report prints. Its own row first, per subject;
      otherwise the Markbook box. Before this, a cycle report read only its
      own row, so every comment typed in the Markbook printed blank.

   3. What a RE-PUBLISHED cycle report prints once the box has moved on to
      a later report: the comments it was published with. "Moved on" is
      read from the assessment schedule — the box was edited on or after
      the first assessment scheduled after that report's cut-off. Until
      then a late comment still reaches the report on re-publish.

   4. When the box REOPENS after a Whole Term report was published: once a
      later assessment in that term's schedule has started. With nothing
      scheduled later it stays locked, as before (admin unlock unchanged).
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');
const { yearIdOf } = require('./class-history');

const COLLECTION = 'report_card_draft_comments';

const _day = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const _start = (y) => (y?.startDate ? String(y.startDate).slice(0, 10) : null);
const _today = () => new Date().toISOString().slice(0, 10);

/* A year can be named by its id or by its database id; both mean the same year. */
function _findYear(years, id) {
  if (!id) return null;
  const want = String(id);
  return (years || []).find(y => y.id === want || String(y._id) === want) || null;
}

/* The year a comment request is for: the one asked for, else the school's
   current year (an older browser tab sends none, and a schedule can still
   name a year that no longer exists). Returns the years too, so callers do
   not read them again. */
async function commentYear(ctx, schoolId, requestedYearId, resolveCurrentPeriod) {
  const years = (await tenantModel('academic_years', ctx).find({ schoolId }).lean()) || [];
  const current = resolveCurrentPeriod(years).year || null;
  const yearId = yearIdOf(_findYear(years, requestedYearId)) || yearIdOf(current);
  return { yearId: yearId || null, years, currentYearId: yearIdOf(current) };
}

/* Does a record belong to this year? By its own year when the school has that
   year, otherwise by when it was last touched. */
function inYear(rowYearId, when, scope) {
  if (!scope.yearId) return true;
  const named = _findYear(scope.years, rowYearId);
  return named ? yearIdOf(named) === scope.yearId : untaggedBelongsTo(when, scope);
}

/* Does a record without a year, last touched on `when`, belong to this year? */
function untaggedBelongsTo(when, { yearId, years, currentYearId }) {
  if (!yearId) return true;
  const day = _day(when);
  if (!day) return yearId === currentYearId || !currentYearId;
  const year = (years || []).find(y => yearIdOf(y) === yearId);
  const start = _start(year);
  if (start && day < start) return false;                       // saved before this year began
  if (currentYearId && currentYearId !== yearId) {
    const curStart = _start((years || []).find(y => yearIdOf(y) === currentYearId));
    if (start && curStart && curStart > start && day >= curStart) return false;  // it is the current year's
  }
  return true;
}

function _pick(rows, scope) {
  const exact = rows.find(r => scope.yearId && r.academicYearId === scope.yearId);
  if (exact) return exact;
  return rows.find(r => !r.academicYearId && untaggedBelongsTo(r.updatedAt || r.createdAt, scope)) || null;
}

/* { studentId: row } for one cycle. */
async function draftsByStudent(ctx, schoolId, { studentIds, termNumber, cycle }, scope) {
  if (!studentIds?.length || termNumber == null) return {};
  const filter = { schoolId, studentId: { $in: studentIds }, termNumber: Number(termNumber), cycle: cycle || null };
  const rows = await tenantModel(COLLECTION, ctx).find(filter).lean();
  const grouped = {};
  for (const r of rows || []) (grouped[r.studentId] ||= []).push(r);
  const out = {};
  for (const [sid, list] of Object.entries(grouped)) {
    const row = _pick(list, scope);
    if (row) out[sid] = row;
  }
  return out;
}

/* The row a save should land on. `filter` + `set` go to findOneAndUpdate with
   upsert; an older row without a year is stamped in place, never copied. */
async function draftForWrite(ctx, schoolId, { studentId, termNumber, cycle }, scope) {
  const base = { schoolId, studentId, termNumber: Number(termNumber), cycle: cycle || null };
  const rows = (await tenantModel(COLLECTION, ctx).find(base).lean()) || [];
  const existing = _pick(rows, scope);
  if (!scope.yearId) {
    return { existing, filter: existing?._id ? { _id: existing._id, schoolId } : base, set: {} };
  }
  if (existing && !existing.academicYearId && existing._id) {
    return { existing, filter: { _id: existing._id, schoolId }, set: { academicYearId: scope.yearId } };
  }
  return { existing, filter: { ...base, academicYearId: scope.yearId }, set: { academicYearId: scope.yearId } };
}

/* This term's scheduled assessments. A window saved for this year wins over
   an older one saved without a year — same rule as report-coverage.js. */
async function termWindows(ctx, schoolId, termNumber, yearId) {
  const noYear = [{ academicYearId: null }, { academicYearId: { $exists: false } }];
  const rows = await tenantModel('assessment_schedule', ctx)
    .find({ schoolId, termNumber: Number(termNumber), $or: yearId ? [{ academicYearId: yearId }, ...noYear] : noYear })
    .select('assessmentType instance dateFrom dateTo academicYearId commentsEnabled').lean();
  const out = new Map();
  for (const r of rows || []) {
    if (!r.assessmentType || !r.dateFrom || !r.dateTo) continue;
    const k = `${r.assessmentType}|${r.instance || 1}`;
    const prev = out.get(k);
    if (!prev || (!prev.academicYearId && r.academicYearId)) out.set(k, r);
  }
  return [...out.values()];
}

/* First day of an assessment that takes comments and starts after `day`. */
function nextStageStart(windows, day) {
  if (!day) return null;
  const starts = (windows || [])
    .filter(w => w.commentsEnabled !== false && String(w.dateFrom).slice(0, 10) > day)
    .map(w => String(w.dateFrom).slice(0, 10))
    .sort();
  return starts[0] || null;
}

/* Has the Markbook box reopened since a Whole Term report was published? */
function boxReopened(windows, publishedAt, today = _today()) {
  const next = nextStageStart(windows, _day(publishedAt));
  return !!next && today >= next;
}

/* Subject comments a cycle report prints. `own` = the cycle's row, `box` =
   the Markbook box, `prev` = the live published report of that cycle. */
function cycleSubjectComments({ own, box, prev, windows }) {
  const ownMap = own?.subjectComments;
  let fallback = box?.subjectComments;
  if (prev && box) {
    // A report published before coverage was recorded: its publish day.
    const next = nextStageStart(windows, prev.coverage?.cutoff || _day(prev.publishedAt));
    const edited = _day(box.updatedAt);
    if (next && edited && edited >= next) fallback = prev.comments?.subjectComments || {};
  }
  if (!ownMap && !fallback) return undefined;
  // A blank in the cycle's own row is "not written", not "print nothing".
  const typed = Object.entries(ownMap || {}).filter(([, t]) => typeof t === 'string' && t.trim());
  return { ...(ownMap || {}), ...(fallback || {}), ...Object.fromEntries(typed) };
}

/* The draft each student's report should use, for any cycle. With no cycle
   this is the Markbook box itself, exactly as before. */
async function effectiveDrafts(ctx, schoolId, { studentIds, termNumber, cycle, prevByStudent = {} }, scope) {
  const own = await draftsByStudent(ctx, schoolId, { studentIds, termNumber, cycle }, scope);
  if (!cycle) return own;
  const box = await draftsByStudent(ctx, schoolId, { studentIds, termNumber, cycle: null }, scope);
  const windows = Object.keys(box).length && Object.keys(prevByStudent).length
    ? await termWindows(ctx, schoolId, termNumber, scope.yearId) : [];
  const out = {};
  for (const sid of new Set([...Object.keys(own), ...Object.keys(box)])) {
    const subjectComments = cycleSubjectComments({ own: own[sid], box: box[sid], prev: prevByStudent[sid], windows });
    const row = own[sid]
      ? { ...own[sid] }
      : { schoolId, studentId: sid, classId: box[sid].classId, termNumber: Number(termNumber), cycle };
    if (subjectComments) row.subjectComments = subjectComments;
    else if (!own[sid]) continue;
    out[sid] = row;
  }
  return out;
}

module.exports = {
  COLLECTION, commentYear, inYear, untaggedBelongsTo, draftsByStudent, draftForWrite,
  termWindows, nextStageStart, boxReopened, cycleSubjectComments, effectiveDrafts,
};
