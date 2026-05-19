Before implementing, modifying, extending, or refactoring ANY feature in this platform, you MUST follow this mandatory pre-implementation protocol. No exceptions.

---

## MANDATORY PRE-IMPLEMENTATION CHECKLIST

### Step 1 — Read the Changelog

Read `CHANGELOG.md` at the project root.

- Identify which version introduced the feature area you are about to touch.
- Confirm whether the feature already exists. If it does, **do not regenerate it from scratch**.
- Note the last version number so your changes increment correctly.

### Step 2 — Read the Developer Guide

Read `docs/DEVELOPER_GUIDE.md`.

- Understand the existing architecture for the module you are touching.
- Check the data model, API contract, and collection names already in use.
- Never introduce a parallel collection, duplicate route, or shadow implementation of something already built.

### Step 3 — Read Relevant User-Facing Docs

Depending on what you are building, also read:

- `docs/USER_GUIDE.md` — for anything a school staff member, teacher, parent, or student would see
- `docs/SCHOOL_ADMIN_GUIDE.md` — for anything the school administrator configures
- `docs/PLATFORM_ADMIN_GUIDE.md` — for anything the SaaS platform operator controls

### Step 4 — Identify What Already Exists

Before writing a single line of code:

1. State explicitly: "This feature **already exists** / **does not yet exist**."
2. If it exists: describe what was built (collection names, route paths, UI location).
3. If it partially exists: describe what is built and what is missing.
4. Only then proceed to build **only** what is missing.

### Step 5 — Implement with Zero Regression

- Never rename existing collections, fields, or API routes without a migration plan.
- Never change an existing data contract without checking every consumer.
- Preserve all `$setOnInsert` / idempotent seed patterns for demo and seed data.
- Tenant isolation: every write must include `schoolId` scoping.
- Plan gating: every new feature must be added to `FEATURE_PLAN` in `server/middleware/plan.js`.

### Step 6 — Update Documentation After Every Change

After completing any change, you MUST update:

1. **`CHANGELOG.md`** — add an entry under the correct new version with what changed and why.
2. **`docs/DEVELOPER_GUIDE.md`** — update architecture notes, new collections, new routes.
3. **`docs/USER_GUIDE.md`** — update if the change affects any user-facing workflow.
4. **`docs/SCHOOL_ADMIN_GUIDE.md`** — update if the change affects admin configuration.
5. **`docs/PLATFORM_ADMIN_GUIDE.md`** — update if the change affects platform operator controls.

---

## HARD RULES

- **Never regenerate a system that already exists.** Read docs first.
- **Never skip the changelog check.** The changelog is the source of truth for what has been built.
- **Never touch another school's data.** All seed/demo data uses `schoolId: 'sch_demo'` with `$setOnInsert`.
- **Never change a version number without updating all relevant documentation.**
- **If in doubt, read before building.** The cost of reading is zero. The cost of rebuilding what exists is high.

---

## COLLECTION NAME REFERENCE (do not invent new ones without checking)

| Domain         | Collection(s)                                      |
|----------------|----------------------------------------------------|
| Schools        | `schools`                                          |
| Users          | `users`                                            |
| Academic years | `academic_years`                                   |
| Classes        | `classes`, `subjects`                              |
| Students       | `students`                                         |
| Teachers       | `teachers`                                         |
| Attendance     | `attendance_records`                               |
| Behaviour      | `behaviour_incidents`                              |
| Finance        | `invoices`, `payments`                             |
| Exams/Grades   | `exams`, `exam_results`, `grade_boundaries`        |
| Assessment     | `assessments`, `assessment_submissions`            |
| Report cards   | `report_cards`                                     |
| Admissions     | `admissions`                                       |
| Timetable      | `timetable_slots`                                  |
| Messages       | `messages`, `message_threads`                      |
| Permissions    | `role_permissions`                                 |
| Sections       | `sections`                                         |
| Announcements  | `system_announcements`                             |
| Backup         | `backups`                                          |
| Audit log      | `audit_logs`                                       |

---

This checklist must be run silently and completely before any implementation response is given. Show a brief confirmation ("✅ Docs checked — [feature] exists / does not exist") before proceeding.
