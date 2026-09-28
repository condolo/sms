# Hostel

## Manage accommodation

1. Create the hostel/building record.
2. Add rooms under the correct hostel, including capacity and room identifiers.
3. Assign a student to a room and confirm occupancy after saving.
4. When a student leaves, use the discharge workflow rather than deleting the historical assignment.
5. Review the hostel summary and room occupancy to find vacancies or capacity problems.

The application maintains room occupancy alongside assignments; resolve an assignment through the normal workflow rather than editing counters manually.


## Setup, updates, and verification

### Set up and change accommodation

Create buildings and rooms before assigning students; check each room's capacity and identifier. When moving a student, use the discharge/transfer and new assignment actions in order, then verify occupancy in both rooms. Do not edit occupancy totals manually. Before deactivating or deleting a room/building, resolve current assignments through the assignment workflow and retain historical records as required by school policy.

**Access:** Hostel permissions separate view, room/building management, student assignment, and delete actions. Plan entitlements may also apply.

**Sources:** `client/src/pages/hostel/HostelPage.jsx`; `server/routes/hostel.js`; module permissions in `server/config/moduleRegistry.js`.; [CHANGELOG.md](../../CHANGELOG.md)
