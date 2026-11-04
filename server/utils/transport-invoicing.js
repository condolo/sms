/* ============================================================
   Msingi — Transport fare snapshot

   Transport is billed per term by Finance → Term Billing
   (utils/term-billing.js). Assigning a student to a route only records
   the ride and freezes the fare in force at that moment (`fareAmount`
   on the assignment), so a price raised next week cannot reprice a
   family already on the bus.

   There is deliberately no per-ride invoice helper here. An earlier
   draft carried one, plus an `invoicedTransportAssignmentIds` guard in
   the term-billing run; nothing ever created such an invoice, so the
   guard could only ever return an empty set while its comments claimed
   a double-charge was being prevented. Removed rather than left to
   mislead the next reader.
   ============================================================ */
'use strict';

/** The fare in force on the route for the assignment's own fare type. */
function fareAmountFor(route, fareType) {
  const fare = (route?.fares || []).find(f => f.fareType === fareType);
  return fare ? fare.amount : null;
}

module.exports = { fareAmountFor };
