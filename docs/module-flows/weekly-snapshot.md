# Weekly Student Snapshot

## Review a weekly snapshot

1. Open **Weekly Snapshot** and choose the week or student/class view available to your role.
2. Review the compiled sections (such as attendance, learning, behaviour, or other configured school indicators).
3. Open a student's detail for the supporting information and follow up through the owning module rather than editing a derived snapshot.
4. Use management settings only if authorized; verify which source modules are enabled and which audiences can see each section.

Snapshots summarize underlying records. If something is wrong, correct the source attendance/grade/behaviour record, then allow the snapshot process to refresh or regenerate as designed.


## Setup, updates, and verification

### Configure and verify snapshot content

An administrator should verify the source modules, audience visibility, and schedule before relying on a weekly snapshot. When changing settings, check the result using a staff view and an appropriate student/parent view. If a value is wrong or stale, correct the underlying attendance, grade, behaviour, or other source record and allow the snapshot refresh/regeneration process to run. Treat the snapshot as a derived summary, not an editable source record.

**Access:** Weekly Snapshot view and settings are distinct permissions. Visibility may be narrowed by role and student/parent relationship; medical content can depend on medical-module configuration.

**Sources:** `client/src/pages/weekly-snapshot/`; `server/routes/weekly-snapshots.js`; snapshot logic in `server/services/`.

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.55.0 for the weekly snapshot generation and delivery behavior.
