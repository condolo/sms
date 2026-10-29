/* ============================================================
   Msingi — What a teacher may see of a report card.

   • Management sees every report in full.
   • Anyone explicitly granted school-wide assessment visibility
     (reports__mark_list_school_wide — assessment.js's MarkList feature)
     also sees every report in full. Reported directly: an exams_officer
     with that exact grant (full oversight of the assessment/report-card
     pipeline is the whole point of the role) still got the stripped-
     down "subjects I personally teach" view on every report outside
     their own teaching assignments, or an outright 403 on the rest —
     because isManagement()'s role list (subject-scope.js) was never
     meant to answer "who manages report cards," only "who bypasses
     subject-teacher scoping for marks/comments entry," and exams_officer
     was never on it. Reusing the SAME grant MarkList already uses
     rather than inventing a second "can see all report cards" key —
     a school that already trusted this person with whole-school
     assessment data has already made this exact call.
   • A stream's form tutor, or its assistant/co-homeroom teacher (same
     rights, 2026-10-29), sees that stream's reports in full (form tutor =
     streams.formTeacherId/assistantFormTeacherId for the caller's own
     streams).
   • Any other teacher sees only the subjects they teach in that class:
     their marks and subject comments. Class remark, principal remark,
     ratings, totals, averages, GPA and rankings are not shown, since
     they are built from subjects the teacher does not teach.
   ============================================================ */
'use strict';

const ScopeEngine = require('./scopeEngine');
const { isManagement } = require('./subject-scope');
const { taughtPairs } = require('./teaching-scope');
const { hasExplicitSubGrant } = require('../middleware/rbac');

// Parents, guardians and students see their own child's report through their own ownership
// checks (report-cards.js), never through this teaching rule.
const FAMILY_ROLES = ['parent', 'guardian', 'student'];

/** Management, the form tutor of this exact stream, or anyone explicitly
 *  granted school-wide assessment visibility, may see a report in full. */
async function canViewFullReport(req, streamId) {
  if (isManagement(req) || FAMILY_ROLES.includes(req.jwtUser?.role)) return true;
  if (await hasExplicitSubGrant(req, 'reports', 'mark_list_school_wide', 'read')) return true;
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
