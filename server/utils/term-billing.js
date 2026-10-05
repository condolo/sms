'use strict';

/* Term billing — which charges a student's term invoice carries.

   Pure functions only (no database). finance.js loads the records and writes
   the invoices; this module decides, for each student, what is billed and
   what is skipped and why.

   Rules (each one is deliberate, not a default):
   • Transport: an ACTIVE assignment that overlaps the term is billed at the
     route's fare for the fare type the assignment was given (one_way or
     two_way). No fare type, or a route with no fare for it, is never billed
     silently: it is reported as a warning.
   • Extra-curricular: an ACTIVE enrolment that overlaps the term is billed at
     the activity's amount, as long as the activity itself is active.
   • Dates are ISO 'YYYY-MM-DD' strings. An enrolment with no end date runs
     open-ended. An overlap with the term's start..end counts.
   • One line per assignment or enrolment. Nothing is combined or rounded here.
*/

const FARE_TYPES = ['one_way', 'two_way'];
const FARE_LABEL = { one_way: 'one-way', two_way: 'two-way' };

function _overlapsTerm(startDate, endDate, term) {
  if (!startDate) return false;                     // no start date: never billed
  if (startDate > term.endDate) return false;       // starts after the term ends
  if (endDate && endDate < term.startDate) return false; // ended before it starts
  return true;
}

/**
 * @param {object} input
 * @param {{startDate:string,endDate:string}} input.term
 * @param {Array} input.assignments   transport_assignments docs
 * @param {Array} input.routes        transport_routes docs (with fares[])
 * @param {Array} input.enrolments    activity_enrolments docs
 * @param {Array} input.activities    activities docs
 * @returns {Map<string, {lines: Array, warnings: string[]}>} keyed by studentId
 */
function buildTermLines({ term, assignments = [], routes = [], enrolments = [], activities = [] }) {
  const routeById    = new Map(routes.map(r => [r.id, r]));
  const activityById = new Map(activities.map(a => [a.id, a]));
  const byStudent    = new Map();

  const slot = (studentId) => {
    if (!byStudent.has(studentId)) byStudent.set(studentId, { lines: [], warnings: [] });
    return byStudent.get(studentId);
  };

  for (const a of assignments) {
    if (a.status !== 'active' || !_overlapsTerm(a.startDate, a.endDate, term)) continue;
    const s = slot(a.studentId);
    const route = routeById.get(a.routeId);
    if (!route) { s.warnings.push(`Transport: the route for this assignment no longer exists`); continue; }
    if (!FARE_TYPES.includes(a.fareType)) {
      s.warnings.push(`Transport (${route.name}): no one-way or two-way fare was chosen for this assignment`);
      continue;
    }
    const fare = (route.fares || []).find(f => f.fareType === a.fareType);
    if (!fare) {
      s.warnings.push(`Transport (${route.name}): no ${FARE_LABEL[a.fareType]} fare is set on this route`);
      continue;
    }
    s.lines.push({
      description: `Transport — ${route.name} (${FARE_LABEL[a.fareType]})`,
      quantity:    1,
      unitPrice:   fare.amount,
      feeType:     'transport',
    });
  }

  for (const e of enrolments) {
    if (e.status !== 'active' || !_overlapsTerm(e.startDate, e.endDate, term)) continue;
    const s = slot(e.studentId);
    const act = activityById.get(e.activityId);
    if (!act || act.status !== 'active') {
      s.warnings.push(`Extra-curricular (${e.activityName || e.activityId}): the activity is not active`);
      continue;
    }
    s.lines.push({
      description: `Extra-Curricular — ${act.name}`,
      quantity:    1,
      unitPrice:   act.amount,
      feeType:     'extracurricular',
    });
  }

  return byStudent;
}

module.exports = { buildTermLines, FARE_TYPES, FARE_LABEL };
