# Msingi — Hostel Manager Guide

**Audience:** Boarding staff managing hostels, rooms, student room assignments, and discharges.

## 1. Access and setup planning

Hostel permissions separate viewing, hostel/room management, student assignment, and deletion. Confirm your role has the action required and the module is available on your school's plan. Standard staff roles commonly receive read-only Hostel access; assignment and configuration actions need explicit grants.

Before setup, confirm hostel names, student gender/boarding rules, capacity, wardens, room identifiers/capacity, bed identifiers if used, term dates, and any approved hostel fees. The hostel screen tracks accommodation and occupancy; it is not a substitute for finance billing or safeguarding procedures.

## 2. Create a hostel

1. Open **Hostel → Hostels** and check whether the hostel already exists.
2. Choose **New Hostel**.
3. Enter the hostel name; set gender (male/female/mixed), type (boarding/day/both), capacity, warden, contact phone, location, fee per term, and notes as applicable.
4. Save and reopen the hostel to verify the values.

Use a consistent naming convention so staff can select the right building. Confirm hostel gender/type and any fee details with school leadership/Finance before activating assignments.

## 3. Add rooms

1. Open **Rooms** and choose **Add Room**.
2. Select the parent hostel and enter room number/name, capacity, and any available details.
3. Save and check that the room appears under the correct hostel with the expected capacity and occupancy.
4. Repeat for each usable room; do not add temporary/non-residential spaces as student rooms unless school policy permits it.

Keep room identifiers unique within the hostel. Before editing capacity or deleting a room, review current residents and physically confirm the new capacity/availability. Resolve assignments through the assignment workflow first.

## 4. Assign a student to a room

1. Choose **Assign Student**.
2. Search and confirm the exact active student, hostel, and room.
3. Enter the bed number if used, start date, end date if known, and relevant notes.
4. Review the student and room details and save once.
5. Reopen **Assignments** and verify the correct student, room, bed, dates, and active status. Check room occupancy and the hostel summary.

The server blocks a second active hostel assignment for the same student and blocks a room at capacity. If a student is already assigned elsewhere, discharge the former assignment first only after confirming the move and the effective date. Do not retry the create action until checking whether it succeeded.

## 5. Move a student

1. Confirm the new room has space and is suitable under school boarding rules.
2. Locate the current active assignment.
3. Discharge the current assignment with the effective date and appropriate note.
4. Verify its status changed and the former room occupancy decreased.
5. Create the new assignment and verify the new room occupancy increased.

The application allows one active assignment per student, so a move is a discharge followed by a new assignment. Coordinate timing to avoid leaving the student with an incorrect active placement.

## 6. Discharge a student

1. Find the active assignment and verify student/room/bed.
2. Choose the assignment's **Discharge** action.
3. Add a note where useful (for example, transfer, end of boarding, or school departure) and confirm.
4. Reopen the assignment and confirm it is discharged with an end date; check that room occupancy decreased.

Do not delete a student/room assignment to represent an ordinary departure. Preserve history under the school's retention policy.

## 7. Routine occupancy checks

- Compare the hostel/room totals with current residents and real capacity.
- Investigate over-capacity rooms and duplicate or stale active assignments.
- Confirm a discharge changes the room count; do not edit occupancy counters manually.
- Review student transfers/leavers and reconcile their accommodation status promptly.
- Coordinate any fees with Finance. A room/hostel fee field does not itself confirm a bill was issued or paid.

## Troubleshooting

| Issue | Check |
|---|---|
| Add Room/Assign Student is unavailable | Confirm Hostel Manage/Assign permissions and plan/module access. |
| Student cannot be assigned | Search for an existing active assignment; verify student, hostel, room, and room capacity. |
| Room says full but appears empty | Compare active assignments with physical occupancy; ask an administrator to review before any manual correction. |
| Summary occupancy looks wrong | Reopen each assignment and check create/discharge history; do not change counters directly. |
| Cannot delete room/hostel | Resolve active resident assignments and dependent records through their proper workflows first. |

**Sources checked:** `client/src/pages/hostel/HostelPage.jsx`, `server/routes/hostel.js`, `server/config/moduleRegistry.js`, role defaults, `docs/module-flows/hostel.md`, `docs/USER_GUIDE.md`, and `CHANGELOG.md` through v5.194.0. Checked 2026-10-18. Available actions and fee policy vary by school permissions/configuration.
