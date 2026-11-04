/* ============================================================
   Msingi — the ride a student is on, for the portal readers.

   ONE read join, two faces: the parent portal asks it about one child, the
   student portal about the account's own record. Writing it twice is how the
   two screens end up disagreeing about the same child, so both call this.

   The assignment supplies the stop, the direction and the fare the family is
   billed; the route supplies the vehicle, the driver and the times. Two
   things it deliberately does not pretend:
     • it cannot locate the bus — neither collection tracks a vehicle in
       time, and a parent/student reading "where is it" would be misled;
     • a deleted route leaves `route: null`, which is the only signal the
       client has that the times it is about to hide were never fetched.
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');

/**
 * @param {object} req        request carrying the tenant + jwtUser
 * @param {string} studentId  the student record's id (never the caller's user id)
 * @returns {Promise<{ student: {id,name,className}, assignments: object[] }>}
 */
async function transportRidesFor(req, studentId) {
  const ctx = tenantContext(req);
  const { schoolId } = req.jwtUser;

  const Assignments = tenantModel('transport_assignments', ctx);
  const Routes      = tenantModel('transport_routes', ctx);
  const Students    = tenantModel('students', ctx);

  // One read for every route this student has ever been on, so a family with a
  // current run and a last-term one is still a single round trip.
  const [rows, student] = await Promise.all([
    Assignments.find({ schoolId, studentId }).sort({ startDate: -1 }).select('-__v').lean(),
    Students.findOne({ id: studentId, schoolId })
      .select('id firstName lastName className admissionNumber').lean(),
  ]);

  const routeIds = [...new Set(rows.map((r) => r.routeId).filter(Boolean))];
  const routeDocs = routeIds.length
    ? await Routes.find({ schoolId, id: { $in: routeIds } }).select('-__v').lean()
    : [];
  const routeById = new Map(routeDocs.map((r) => [r.id, r]));

  return {
    student: student ? {
      id: student.id,
      name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
      className: student.className || null,
    } : { id: studentId, name: null, className: null },
    assignments: rows.map((a) => ({
      id:         a.id,
      routeId:    a.routeId,
      routeName:  a.routeName || routeById.get(a.routeId)?.name || '',
      pickupStop: a.pickupStop || '',
      direction:  a.direction,
      fareType:   a.fareType,
      startDate:  a.startDate ?? null,
      endDate:    a.endDate ?? null,
      notes:      a.notes || '',
      status:     a.status === 'inactive' ? 'inactive' : 'active',
      route:      routeById.get(a.routeId) ?? null,
    })),
  };
}

module.exports = { transportRidesFor };
