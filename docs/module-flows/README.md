# Msingi module workflow guides

These guides are practical operating references for setting up, using, updating, and checking the modules in the Msingi school application. They are based on the current UI, server routes, module registry, existing user/admin manuals, and relevant changelog entries. They are intended to help school administrators and staff follow supported UI workflows; they are not a substitute for deployment or code-change instructions in the Developer Guide.

The guides describe the normal UI path. Role permissions, plan entitlements, school configuration, and assigned-record scope can hide actions or narrow the records a user sees. No single user necessarily has access to every task. Never bypass a missing permission by editing the database or using generic data tools.

## How to use this folder

1. Open the guide for the module you are setting up or using.
2. Follow its prerequisites and normal workflow; use the setup/update notes to maintain configuration and verify changes.
3. Check its access section if a control is missing or an action is rejected. Ask an administrator to check the relevant role grant, module entitlement, and record scope.
4. Follow links to the longer role guides where a maintained manual has more detail.
5. For a software implementation or deployment change, use the [Developer Guide](../DEVELOPER_GUIDE.md) and the owning module's code and tests; these are user-facing workflow guides, not implementation specs.

The registry has 29 permission modules. Some are embedded in another screen: **Exams** and **Assessment Scheduling** are part of Grades/Exams; **Analytics** is presented through dashboard/report screens; **Settings** is an administration area rather than a normal sidebar module.

## Module index

| Module | Guide | Main screen / entry point |
|---|---|---|
| Students | [students.md](students.md) | Students |
| Teachers | [teachers.md](teachers.md) | Teachers; HR for employment records |
| Classes & Streams | [classes.md](classes.md) | Classes |
| Attendance | [attendance.md](attendance.md) | Attendance |
| Timetable | [timetable.md](timetable.md) | Timetable; see the [Timetabler Guide](../TIMETABLER_GUIDE.md) |
| Subjects | [subjects.md](subjects.md) | Subjects |
| Lessons | [lessons.md](lessons.md) | Lessons |
| Grades & Marks | [grades.md](grades.md) | Exams / Grades |
| Exams | [exams.md](exams.md) | Exams tab; see the [Exams Officer Guide](../EXAMS_OFFICER_GUIDE.md) |
| Assessment Scheduling | [assessment.md](assessment.md) | Exams → Configuration / Reminders |
| Report Card Settings | [report-cards.md](report-cards.md) | Report Cards |
| eLearning | [elearning.md](elearning.md) | eLearning |
| Admissions | [admissions.md](admissions.md) | Admissions; see the [Admissions Guide](../ADMISSIONS_GUIDE.md) |
| Behaviour | [behaviour.md](behaviour.md) | Behaviour |
| Finance | [finance.md](finance.md) | Finance; see the [Finance Guide](../FINANCE_GUIDE.md) |
| Messages | [messages.md](messages.md) | Messages |
| Events & Calendar | [events.md](events.md) | Events |
| HR & Payroll | [hr.md](hr.md) | HR; see the [HR Guide](../HR_GUIDE.md) |
| Resources | [resources.md](resources.md) | Resources |
| Library | [library.md](library.md) | Library |
| Transport | [transport.md](transport.md) | Transport |
| Hostel | [hostel.md](hostel.md) | Hostel |
| Medical Centre | [medical.md](medical.md) | Medical |
| Inventory | [inventory.md](inventory.md) | Inventory |
| Growth Profile | [growth-profile.md](growth-profile.md) | Growth Profile |
| Weekly Student Snapshot | [weekly-snapshot.md](weekly-snapshot.md) | Weekly Snapshot |
| Reports & Analytics | [reports.md](reports.md) | Reports |
| Analytics Dashboard | [analytics.md](analytics.md) | Dashboard / analytics views |
| Settings | [settings.md](settings.md) | Settings |

## Access and safety notes

- A module appearing in navigation does not guarantee every action is permitted. Server-side role permissions, explicit sensitive-action grants, plan gates, and module switches may also apply.
- Generic record access can be broader than a dedicated self-service flow. Use the dedicated HR, student, parent, or portal screen when the guide says the action is self-scoped.
- Before permanent deletion, year archival, publishing, or payment changes, review the relevant module guide and confirm the selected school, class, year, term, and record.

## Documentation scope and maintenance

Each module guide aims to answer: where to go; what must exist first; how to perform its main task; how to update or close the record safely; how to verify the result; and what to check when access or expected data is missing. The workflow depends on the current screen and school configuration, so follow field validation and confirmation messages shown in the application. If an operation is not documented or the UI differs, do not assume a destructive action; check the linked role guide or ask the system administrator.

The current permission catalog is `server/config/moduleRegistry.js`. Screen flows live in `client/src/pages/`; API behavior and authorization are implemented in `server/routes/` and `server/middleware/`. Each guide lists primary source files and relevant maintained manuals. The top of `CHANGELOG.md` contains the latest changes; entries there may supersede older instructions in long-form manuals. When a screen, permission, setting, or data lifecycle changes, update its module guide and this index in the same change. Recheck links and procedures against the application before publishing the docs.

**Reviewed:** 2026-09-28 against repository docs, module registry, current UI/routes, and recent changelog entries (through v5.145.0). This is a repository-based guide set, not a live production configuration audit.
