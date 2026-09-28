# Classes & Streams

This guide covers the common class and stream tasks in the current application. A stream is a teaching group inside a class (for example, Class 5A's Blue and Green groups). A section, where enabled, belongs to the class and is inherited by its streams.

## Add a stream

### Before you start

- Create the class first. Streams cannot be created without a parent class.
- Your account needs **Classes: Create** access, and the school's plan must include the Classes module. If **Add Stream** is not available, ask a school administrator to check your role's Classes permission and plan access.
- If the school uses sections, confirm the correct section was selected on the class. A stream inherits that class's section; you do not select a section on the stream form.

### Steps

1. Open **Classes**.
2. Find the class that should contain the new stream and choose **Manage streams** on its card. This opens that class's detail page.
3. Choose **Add Stream**.
4. Enter a **Stream Name** (required), such as `A`, `B`, `East`, or `Red`. The name must be unique within that class.
5. Optionally choose a **Form Teacher**, enter a **Room**, and set **Capacity** (a whole number from 1 to 500). Choose **Status**; new streams default to **Active**.
6. Choose **Create Stream**. The form closes and the new stream should appear in the class detail list. Confirm its name and details there.

## Assign students to a stream

1. From **Classes**, open the class with **Manage streams**.
2. On the stream card, open **Students** (or its student-management action).
3. Search for the student by name or admission number, select the right student, and assign them to the stream.
4. Confirm the student appears in that stream's list.

Students must already belong to the parent class to appear in the stream assignment picker. Assigning a student to a stream changes their stream placement; it does not add them to or remove them from the class. Removing a student from a stream only clears their stream placement.

## Edit or remove a stream

- **Edit:** Open the class's stream list, choose the edit action on the stream, update its name, form teacher, room, capacity, or status, then save.
- **Delete:** Use the stream's delete action and confirm. A stream with assigned students cannot be deleted; first reassign those students to another stream or remove their stream placement. Removing a stream does not replace the separate process for managing class membership.

## Create a class first

1. Open **Classes** and choose **Add Class**.
2. Enter the class details required by the form, including its name and (if used by the school) section.
3. Save the class, then return to its card and choose **Manage streams** to create streams as described above.

Class setup fields may vary with school configuration. Check the form's required-field markers before saving.

## Setup, updates, and verification

### Maintain classes and year setup

Set the school's sections and academic year/terms in Settings before creating the year's class structure. Create each class with the intended section, then add streams and confirm form teachers/rooms. Place students using the student/class workflow, then verify both the class roster and each stream roster. Before changing or removing a class/stream, check student membership and dependent academic/timetable records; reassign through their owning workflows first.

## Access and related tasks

**Access:** The interface shows stream-management controls to users with class-management access, while the server checks the specific Classes create permission for creation. Student enrollment and class membership are managed through the relevant student/class workflows. Section setup is separate from stream setup.

Avoid deleting a class while it has students, marks, or timetable assignments. Resolve dependent records in their owning modules first.

**Sources:** `client/src/pages/classes/ClassList.jsx`, `ClassDetail.jsx`; `server/routes/classes.js`, `streams.js`, `sections.js`; [School Administrator Guide](../SCHOOL_ADMIN_GUIDE.md#4-sections--classes); [CHANGELOG.md](../../CHANGELOG.md) (v5.127.0 class/form-teacher roster access).
