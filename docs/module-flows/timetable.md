# Timetable

The full workflow is in the [Timetabler Guide](../TIMETABLER_GUIDE.md). In brief:

1. Confirm classes, subjects, teachers, rooms, and bell schedules exist.
2. Choose the class grid and add/edit slots with subject, teacher, room, day, and period.
3. Review teacher/room/class conflicts and resolve them before publishing.
4. Use the room, teacher, and institution views to inspect coverage; record cover/substitution separately so the base timetable remains intact.
5. Publish the timetable when ready. Draft changes after publishing may not appear in student, parent, or teacher views until republished.


## Setup, updates, and verification

### Build, revise, and publish the timetable

Before editing, confirm academic period, bell schedule, rooms, subjects, class/stream structure, and teaching assignments. Add slots in draft and inspect conflicts by class, teacher, and room. Resolve conflicts or document approved exceptions before publishing. After a published change, publish again and verify using a teacher/student view; a draft edit may not be visible to portal users. Maintain room and bell schedule reference data through their own authorized controls.

**Access:** Timetable permissions apply; editing the whole-school schedule uses a more restricted manage grant. Room, bell schedule, assignment, import, and export actions may have distinct permission rows.

**Sources:** `client/src/pages/timetable/`; `server/routes/timetable.js`, `bell-schedule.js`, `rooms.js`, `teaching-assignments.js`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.118.0 and v5.120.0–v5.123.0 for room records, permission boundaries, and teacher assignment scope.
