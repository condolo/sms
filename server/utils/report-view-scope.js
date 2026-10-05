/* ============================================================
   Msingi — What a teacher may see of a report card.

   • Management sees every report in full.
   • A stream's form tutor sees that stream's reports in full
     (form tutor = streams.formTeacherId for the caller's own streams).
   • Any other teacher sees only the subjects they teach in that class:
     their marks and subject comments. Class remark, principal remark,
     ratings, totals, averages, GPA and rankings are not shown, since
     they are built from subjects the teacher does not teach.
   ============================================================ */
'use strict';

const ScopeEngine = require('./scopeEngine');
const { isManagement } = require('./subject-scope');
const { taughtPairs } = require('./teaching-scope');

// Parents, guardians and students see their own child's report through their own ownership
// checks (report-cards.js), never through this teaching rule.
const FAMILY_ROLES = ['parent', 'guardian', 'student'];

/** Management, or the form tutor of this exact stream, may see a report in full. */
async function canViewFullReport(req, streamId) {
  if (isManagement(req) || FAMILY_ROLES.includes(req.jwtUser?.role)) return true;
  if (!streamId) return false;
  const formStreamIds = await ScopeEngine.resolveHomeroomStreamIds(req);
  return formStreamIds.includes(streamId);
}

/**
 * The version of a report this caller may see: the full report, a trimmed
 * one (taught subjects only), or null when they teach none of its subjects.
 */
async function viewReportFor(req, doc) {
  if (await canViewFullReport(req, doc.streamId)) return doc;
  const pairs = await taughtPairs(req);
  const taught = new Set((pairs || []).filter(p => p.classId === doc.classId).map(p => p.subjectId));
  if (taught.size === 0) return null;

  const subjects = Object.fromEntries(Object.entries(doc.subjects || {}).filter(([k]) => taught.has(k)));
  const subjectComments = Object.fromEntries(
    Object.entries(doc.comments?.subjectComments || {}).filter(([k]) => taught.has(k)),
  );
  return {
    ...doc,
    subjects,
    subjectCount: Object.keys(subjects).length,
    // Totals, averages, GPA and ranks are built across every subject, so they are withheld.
    totalScore: undefined, averageScore: undefined, gpa: undefined,
    rankingScore: undefined, rankingSubjectsUsed: undefined,
    rankings: {}, subjectBest: {},
    comments: { subjectComments },
  };
}

module.exports = { canViewFullReport, viewReportFor };
