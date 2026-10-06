/* ============================================================
   Msingi — the published timetable.

   Two copies of the timetable exist:
     • the DRAFT, collection `timetable`. The timetabler edits it. Only
       editors (admin, superadmin, deputy, timetabler) read it.
     • the PUBLISHED copy, collection `timetable_published`, one full
       copy per published version. Teachers, students and parents read
       only this, so an edit to the draft changes nothing for them until
       it is published.

   School state, in schools.timetableStatus:
     published            is a version live right now?
     publishedVersionId   the version everyone reads
     draftRevision        bumped by every change to the draft
     publishedRevision    the draftRevision that was published
   The draft has unpublished changes when the two revisions differ.
   ============================================================ */
'use strict';

const { _model } = require('./model');
const { tenantModel } = require('./tenant-model');

async function getPublishState(schoolId) {
  const school = await _model('schools').findOne({ id: schoolId }).lean();
  const t = school?.timetableStatus ?? {};
  const draftRevision = t.draftRevision ?? 0;
  const publishedRevision = t.publishedRevision ?? null;
  const hasChanges = draftRevision !== publishedRevision;
  return {
    published:          !!t.published,
    publishedVersionId: t.publishedVersionId ?? null,
    publishedAt:        t.publishedAt ?? null,
    publishedBy:        t.publishedBy ?? null,
    termLabel:          t.termLabel ?? '',
    draftRevision,
    publishedRevision,
    hasChanges,
    // Publishing is offered when nothing is live yet, or when the draft has changed since the last publish.
    canPublish: !t.published || hasChanges,
  };
}

/** Records that the draft changed. Called by every write to the draft timetable. */
async function markTimetableChanged(schoolId) {
  await _model('schools').updateOne({ id: schoolId }, { $inc: { 'timetableStatus.draftRevision': 1 } });
}

async function isTimetablePublished(schoolId) {
  return (await getPublishState(schoolId)).published;
}

/* A reader that finds nothing. Used while nothing is published. */
function emptyReader() {
  const chain = (result) => {
    const c = { sort: () => c, select: () => c, limit: () => c, skip: () => c, lean: () => Promise.resolve(result) };
    return c;
  };
  return {
    find: () => chain([]),
    findOne: () => chain(null),
    countDocuments: () => Promise.resolve(0),
  };
}

/* The published copy, with every query limited to the live version. */
function scopedReader(model, versionId) {
  return {
    find: (filter, ...rest) => model.find({ ...filter, versionId }, ...rest),
    findOne: (filter, ...rest) => model.findOne({ ...filter, versionId }, ...rest),
    countDocuments: (filter) => model.countDocuments({ ...filter, versionId }),
  };
}

/**
 * The timetable a non-editor reads: the live published version, or nothing
 * while no version is live. `ctx` is a tenant context ({ schoolId }).
 */
async function publishedReader(schoolId, ctx) {
  const st = await getPublishState(schoolId);
  if (!st.published || !st.publishedVersionId) return emptyReader();
  return scopedReader(tenantModel('timetable_published', ctx), st.publishedVersionId);
}

// The roles that edit the timetable. Only they read the draft.
const EDITOR_ROLES = new Set(['superadmin', 'admin', 'deputy', 'timetabler']);

function isTimetableEditor(req) {
  const { role, roles = [] } = req.jwtUser || {};
  return EDITOR_ROLES.has(role) || roles.some(r => EDITOR_ROLES.has(r));
}

/** The draft for editors, the published version for everyone else. */
async function timetableReaderFor(req) {
  const ctx = { schoolId: req.jwtUser.schoolId };
  return isTimetableEditor(req) ? tenantModel('timetable', ctx) : publishedReader(ctx.schoolId, ctx);
}

module.exports = {
  getPublishState, markTimetableChanged, isTimetablePublished, publishedReader,
  isTimetableEditor, timetableReaderFor,
};
