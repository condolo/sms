# Msingi — Behaviour and Pastoral Officer Guide

**Audience:** Discipline Committee / Behaviour Officer staff, school leaders, and authorized staff recording or reviewing student behaviour. Behaviour is sensitive student information; only handle cases within your school responsibility.

## 1. Access and role boundaries

The built-in **Discipline Committee** role has Behaviour access by default. Teachers do not automatically receive the Behaviour module grant in the current default role map, although schools can grant permissions. Students and parents have limited portal views and appeal participation. A school can assign a Behaviour Officer, but that assignment is not a substitute for the actual role permissions.

The school’s categories, individual behaviour items, merit/demerit values, officer assignment, and annual reset process affect the workflow. Category configuration and point resets are high-impact; do them only if explicitly authorized. Check your menu and ask the school administrator if tabs are missing.

## 2. Review the overview

1. Open **Behaviour** and review **Overview** for merits, demerits, intervention alerts, milestone achievers, and serious incidents.
2. Note the time window displayed on each panel. The module’s Overview totals are all-time, while the Dashboard Behaviour card may use a rolling 30-day window and class grouping; different numbers can be intentional (CHANGELOG v5.39.0).
3. Open the source incident or student record before acting on an alert. A summary is not the decision record.

## 3. Award merit points or record a demerit

1. Open **Award Points**.
2. Search by student name or admission number, then confirm the exact student and class.
3. Select **Merit** or **Demerit**.
4. Select the configured category and the specific behaviour item. Check its direction and point value; the value comes from the selected item.
5. Confirm the date and add a concise, factual description. Do not include assumptions, insults, or details unrelated to the incident.
6. For a serious/high-value event, enter the required detailed note (the form indicates when a longer note is required).
7. Review the confirmation view, especially student, type, item, and points, then submit once.
8. Confirm the success message and find the incident in **Incidents** or the student history.

Record observed facts promptly and consistently. Use the approved safeguarding or emergency process for immediate risk; the behaviour form is not an emergency reporting channel.

## 4. Review the incident register and correct a record

1. Open **Incidents** and search/filter by student, date, merit/demerit, or other available criteria.
2. Open the original record and compare the student, item/category, date, points, and note with the original evidence.
3. If the record is wrong, use the authorized edit/correction action on that record and preserve an explanation where required. Do not create a second record as a correction.
4. Use delete only when the record is genuinely erroneous and the school authorizes removal; deletion can affect the student’s current stage/milestone calculation.
5. Reopen the record and check the updated value/status.

## 5. Review and resolve an appeal

1. Open **Appeals** and filter the pending cases.
2. Read the student's reason and review the exact incident being appealed. Check any parent context and relevant evidence.
3. If needed, follow the school’s pastoral process or refer the matter to the authorized senior staff member before deciding.
4. Enter a concise decision note. Choose the supported outcome: **Accept — Remove Points** (resolve in the student’s favour) or **Reject — Keep Points**.
5. Confirm the outcome and verify the appeal appears as resolved. Where the application offers escalation for your role, use it for cases beyond your authority rather than deciding outside your remit.

The student/parent portal may show the appeal state and the staff resolution. Keep notes factual, respectful, and limited to the case.

## 6. Houses, milestones, stages, and resets

- Use **Houses** to review configured house information and the points window shown. House totals can reset with the behaviour cycle; the permanent incident history remains.
- Merit milestones and demerit intervention stages are calculated from incidents and school-defined thresholds. Confirm the applicable time window before interpreting a badge or stage.
- Do not manually delete incidents to simulate a new year. The academic-year transition/reset workflow handles the annual points reset; historical incident records are retained (CHANGELOG v5.31.0).
- Changes to categories/items, point values, thresholds, houses, detention types, or responsible staff should be approved and communicated before the school starts using the changed policy. Configuration changes do not rewrite old incidents.

## 7. Student and parent communication

Explain the decision through the school’s approved channel. Send only the information the recipient is authorized to receive. Parent messaging resolves a staff category on the server and is designed not to allow parents to message another parent (CHANGELOG v5.191.0); keep case communications inside approved school processes.

## 8. Good recordkeeping

- Confirm student identity before creating or resolving a record.
- Keep the original reason/evidence, incident date, and correction rationale together according to school policy.
- Avoid entering medical information in a behaviour note; record clinical details in Medical Centre.
- Restrict printed/exported reports to staff with a legitimate need and store them securely.
- Tell the administrator if a student, incident, appeal, or category is missing rather than entering data under a similar student.

## Troubleshooting

| Issue | What to check |
|---|---|
| Behaviour tab is missing | Confirm the account role and Behaviour grant, school plan/module access, and active officer assignment if applicable. |
| Student not found | Check the student’s exact name/admission number, school, and active status. Do not select a similar name. |
| Wrong point value or item | Check the selected category and child item; report a configuration issue to the administrator. |
| Appeal is absent | Confirm the student submitted an eligible appeal and the correct school/account is selected. |
| Dashboard and Overview totals differ | Compare the stated time windows and grouping before reporting a discrepancy. |

Report problems with the school, student ID/admission number, incident/appeal reference, date, screen, and observed result. Do not send passwords or unnecessary sensitive details.

**Sources checked:** `client/src/pages/behaviour/`, `server/routes/behaviour.js`, `server/utils/repairPermissions.js`, `docs/module-flows/behaviour.md`, `docs/USER_GUIDE.md`, and `CHANGELOG.md` through v5.194.0. Relevant behaviour changes: v5.31.0 (editable item-level categories, annual reset, officer role), v5.39.0 (overview/dashboard time-window difference), and v5.113.0 (class-scoped access hardening). Checked 2026-10-18. Exact tabs and actions depend on the role grants and school configuration.
