/* ============================================================
   Msingi — timetable publish scope and restore points (v5.272.0)

   Raised in a school admin's review of the timetable guide (2026-11-15):
     1. "The term label doesn't limit what gets published." Publishing
        copied every active draft lesson for the school; the label was
        only a note. A draft can hold lessons from more than one academic
        year (moving to a new year doesn't retire last year's lessons).
     2. "Publishing history isn't a full restore point." Each publish
        deleted every older published copy, keeping only a history row.

   What this does:
     - draftScope(): what the draft holds, per academic year, so the
       Publish dialog says exactly what will be published. The admin can
       leave out lessons tagged with another academic year. Lessons are
       NOT split by term: a lesson keeps the term it was created in, and
       a timetable normally carries on from one term to the next, so
       publishing "Term 2 only" would silently drop lessons that are
       still taught. The term label stays a label, and says so.
     - Published copies of the last KEEP_COPIES versions are kept (the
       live one always), so any of them can be copied back into the draft.
     - restoreVersion(): replaces the draft with a kept version (only its
       academic year, for a "this year only" version; other years stay). The
       current draft is saved first as its own history entry ("Draft
       saved before restoring …"), so a restore can itself be restored.
       Nothing goes live until the admin publishes.

   Readers are unaffected by the extra copies: everyone who is not an
   editor reads timetable_published through publishedReader(), which is
   always scoped to the live versionId (utils/timetable-publish.js).
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { tenantModel } = require('./tenant-model');

const KEEP_COPIES = 10;

/** Lessons in the draft, per academic year. */
async function draftScope(ctx, schoolId, currentYearId) {
  const rows = await tenantModel('timetable', ctx)
    .find({ schoolId, isActive: true }).select('academicYearId').lean();
  const counts = new Map();
  for (const r of rows) {
    const y = r.academicYearId || null;
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  const yearIds = [...counts.keys()].filter(Boolean);
  const years = yearIds.length
    ? await tenantModel('academic_years', ctx).find({ schoolId, id: { $in: yearIds } }).select('id name').lean()
    : [];
  const nameOf = Object.fromEntries(years.map(y => [y.id, y.name]));
  const byYear = [...counts.entries()].map(([academicYearId, count]) => ({
    academicYearId,
    name: academicYearId ? (nameOf[academicYearId] || academicYearId) : null,
    count,
    isCurrent: !!currentYearId && academicYearId === currentYearId,
  })).sort((a, b) => (b.isCurrent - a.isCurrent) || (b.count - a.count));
  const total = rows.length;
  const currentYear = byYear.find(y => y.isCurrent)?.count || 0;
  const untagged = counts.get(null) || 0;
  // "This year" publishing keeps untagged lessons (saved before lessons
  // carried a year) — leaving them out could empty a school's timetable.
  const thisYearScope = currentYear + untagged;
  return { total, currentYearId: currentYearId || null, byYear, otherYears: total - thisYearScope, thisYearScope };
}

/** The filter for the lessons a publish copies. */
function publishFilter(schoolId, scope, currentYearId) {
  if (scope === 'current_year' && currentYearId) {
    return { schoolId, isActive: true, $or: [{ academicYearId: currentYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] };
  }
  return { schoolId, isActive: true };
}

/**
 * Keep the published copies of the newest KEEP_COPIES versions (and always
 * the live one); delete older copies and mark their history rows.
 */
async function pruneCopies(ctx, schoolId, liveVersionId) {
  const Versions = tenantModel('timetable_versions', ctx);
  const all = await Versions.find({ schoolId }).select('id publishedAt createdAt copyKept').lean();
  all.sort((a, b) => String(b.publishedAt || b.createdAt || '').localeCompare(String(a.publishedAt || a.createdAt || '')));
  const keep = new Set(all.slice(0, KEEP_COPIES).map(v => v.id));
  if (liveVersionId) keep.add(liveVersionId);
  const drop = all.filter(v => !keep.has(v.id) && v.copyKept !== false).map(v => v.id);
  // Copies under versionIds with no history row at all (left by older code) go too.
  const Published = tenantModel('timetable_published', ctx);
  await Published.deleteMany({ schoolId, versionId: { $nin: [...keep] } });
  if (drop.length) await Versions.updateMany({ schoolId, id: { $in: drop } }, { $set: { copyKept: false } });
  return { kept: keep.size, dropped: drop.length };
}

/**
 * Replace the draft with a kept version. Returns { restored, replaced,
 * backupVersionId } or { error, status }.
 */
async function restoreVersion(ctx, schoolId, versionId, userId) {
  const Versions = tenantModel('timetable_versions', ctx);
  const Published = tenantModel('timetable_published', ctx);
  const Timetable = tenantModel('timetable', ctx);

  const version = await Versions.findOne({ schoolId, id: versionId }).lean();
  if (!version) return { error: 'That version is not in this school\'s history.', status: 404 };
  if (version.copyKept === false) return { error: 'That version is too old: only the last ' + KEEP_COPIES + ' versions are kept in full.', status: 409 };
  const copies = await Published.find({ schoolId, versionId }).lean();
  if (!copies.length && (version.slotCount || 0) > 0) {
    return { error: 'The lessons of that version are no longer kept.', status: 409 };
  }

  const now = new Date().toISOString();
  // A version published "this year only" replaces only that scope in the draft
  // (its year + untagged lessons); other years' lessons stay as they are. Any
  // other version (whole draft, or a saved draft) replaces the whole draft.
  const yearOnly = version.scope === 'current_year' && version.academicYearId;
  const current = await Timetable.find(yearOnly
    ? publishFilter(schoolId, 'current_year', version.academicYearId)
    : { schoolId, isActive: true }).lean();
  const wholeDraft = yearOnly ? await Timetable.find({ schoolId, isActive: true }).lean() : current;

  // 1. Save the WHOLE current draft as its own history entry BEFORE touching it.
  const backupVersionId = uuidv4();
  const backupDocs = wholeDraft.map(({ _id, __v, ...l }) => ({ ...l, versionId: backupVersionId, schoolId }));
  if (backupDocs.length) await Published.insertMany(backupDocs, { ordered: false });
  await Versions.create({
    id: backupVersionId, schoolId, kind: 'draft_backup',
    termLabel: `Draft saved before restoring ${version.termLabel || 'a version'}`,
    publishedAt: now, createdAt: now, publishedBy: userId, slotCount: backupDocs.length,
    restoredFrom: versionId,
  });

  // 2. Replace. A copied lesson keeps its id unless an inactive draft row
  //    still uses it (ids are unique in the draft).
  const restoreDocs = copies.map(({ _id, __v, versionId: _v, ...l }) => ({
    ...l, schoolId, isActive: true, restoredFromVersionId: versionId, updatedBy: userId, updatedAt: now,
  }));
  let deleted = false;
  try {
    const ids = restoreDocs.map(d => d.id).filter(Boolean);
    const currentIds = new Set(current.map(l => l.id).filter(Boolean));
    const stillUsed = ids.length
      ? new Set((await Timetable.find({ schoolId, id: { $in: ids } }).select('id').lean()).map(r => r.id).filter(id => !currentIds.has(id)))
      : new Set();
    for (const d of restoreDocs) if (!d.id || stillUsed.has(d.id)) d.id = uuidv4();

    if (current.length) {
      const withId = current.filter(l => l.id).map(l => l.id);
      const noId = current.filter(l => !l.id).map(l => l._id);
      await Timetable.deleteMany({ schoolId, $or: [{ id: { $in: withId } }, { _id: { $in: noId } }] });
      deleted = true;
    }
    if (restoreDocs.length) await Timetable.insertMany(restoreDocs, { ordered: false });
  } catch (err) {
    console.error('[timetable restore] write failed, rolling back:', err.message);
    try {
      await Timetable.deleteMany({ schoolId, restoredFromVersionId: versionId, updatedAt: now });
      if (deleted && current.length) await Timetable.insertMany(current.map(({ _id, __v, ...l }) => l), { ordered: false });
    } catch (rbErr) {
      console.error('[timetable restore] ROLLBACK FAILED — the draft is saved as version', backupVersionId, rbErr.message);
      return { error: 'Restoring failed and the draft could not be put back automatically. It is saved in the history as "Draft saved before restoring"; restore that entry.', status: 500 };
    }
    return { error: 'Restoring failed, so nothing was changed. Try again.', status: 500 };
  }

  await Versions.updateOne({ schoolId, id: versionId }, { $set: { lastRestoredAt: now, lastRestoredBy: userId } });
  return { restored: restoreDocs.length, replaced: current.length, backupVersionId };
}

module.exports = { KEEP_COPIES, draftScope, publishFilter, pruneCopies, restoreVersion };
