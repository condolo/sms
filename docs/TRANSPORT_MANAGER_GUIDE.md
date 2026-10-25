# Msingi — Transport Manager Guide

**Audience:** School staff managing routes, vehicles, and student transport assignments.

## 1. Access and preparation

Transport permissions separate route viewing, route management, student assignment, and deletion. Confirm that your role has the needed actions and the Transport module is enabled. The standard Teacher, Admissions Officer, Finance, HR, Timetabler, Exams Officer, and Discipline Committee role defaults are generally read-only for Transport; student/parent portal views are self-scoped.

Before creating routes, agree route names, stops, vehicle/driver details, capacity, fares, and start dates with the school operations and accounts teams. Route records do not themselves notify families. Transport fare data may be used by the Finance term-billing workflow; coordinate fare changes with accounts before the billing cycle.

## 2. Create or update a route

1. Open **Transport → Routes** and search for an existing route to avoid duplicates.
2. Choose **New Route**.
3. Enter the route name, origin, destination, stops (comma-separated), departure and arrival times.
4. Select vehicle type and enter vehicle registration, driver name/phone, capacity, and notes if known.
5. Add the supported fare type(s): one-way and/or two-way. Confirm each amount and school currency with the accounts team.
6. Save, reopen the route, and check the route, stops, vehicle, capacity, fares, and times.

Use **Edit Route** to change current operational details. Before renaming, removing, or changing fares on a route already in use, check its active assignments and any Finance billing cycle. Keep a record of the approved effective date for a fare change.

## 3. Assign one student to a route

1. Open **Assignments** and choose **Assign Student**.
2. Select the correct route and search for the student. Confirm name, class, and admission information.
3. Select fare type, direction (to school, from school, or both), pickup stop, and assignment start date.
4. Add relevant notes, review, and save.
5. Confirm the student appears under the selected route with the right fare, pickup, direction, dates, and active status.

The route must already exist. The server verifies the route and an active student from the same school. A duplicate active assignment on the same route is rejected. Capacity is checked when configured; a full route is blocked. Check the student's existing assignment before retrying a failed save.

## 4. Bulk assign students

1. Choose the route and confirm that the route has the selected one-way/two-way fare configured.
2. Select the student group and inspect every student in the batch before submitting.
3. Set direction, pickup stop, start date, and shared notes. Bulk assignment accepts up to 200 students.
4. Submit once and review both the created and skipped counts. Duplicates/already-assigned students may be skipped and reported.
5. Open the route assignment list and spot-check the roster and each assignment's details.

The server validates all students and available route seats before writing the batch. Do not repeat the same bulk action before checking which records were created.

## 5. Change or end an assignment

1. Search **Assignments** by route/student/status and open the exact record.
2. For a routine stop/direction/notes change, edit the relevant fields and save.
3. For a route transfer, create and verify the replacement assignment first, then update the former assignment's status/end date according to school policy.
4. For a leaver, end/deactivate the assignment rather than deleting history unless deletion is explicitly required and authorized.
5. Reopen the route roster and confirm the student is in the correct active route only.

An assignment change does not automatically notify parents or update a billing record. Use the school's approved communication and Finance processes.

## 6. Review operations

Use **Routes** to search vehicle/driver/route data and **Assignments** to review current and historical student allocation. The summary cards show route and assignment counts/statuses. Compare route capacity with actual active assignments and follow up on inactive students, missing stops, or duplicate records.

## Troubleshooting

| Issue | Check |
|---|---|
| New Route button is missing | Confirm Transport manage/create permission and plan/module access. |
| Student cannot be assigned | Confirm the student is active in this school, route exists, selected fare is configured, and route has capacity. |
| Bulk assignment reports skipped students | Review the result reasons, existing route assignments, and duplicate IDs in the submitted group. |
| Parent/Finance view has not changed | Route changes do not automatically send notices or rewrite invoices; verify the relevant portal/billing process separately. |
| Counts differ from physical operations | Check active assignment statuses, dates, route capacity, and any prior route transfers before deleting or recreating data. |

**Sources checked:** `client/src/pages/transport/TransportPage.jsx`, `server/routes/transport.js`, `server/config/moduleRegistry.js`, role defaults, `docs/module-flows/transport.md`, `docs/FINANCE_GUIDE.md`, and `CHANGELOG.md` through v5.194.0. Transport billing connection references v5.169.0; role-specific navigation and access references v5.159.0 and the relevant role defaults. Checked 2026-10-18. Exact access and school fare/billing policy may vary.
