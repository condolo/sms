# Demo personas — what each login is there to prove

`demo` / `demo` school, `sch_demo`. Password for **every** account below is `Demo2025!`.

The base seed (`server/scripts/seed-demo-data.js`) gives the school its records:
26 students, 10 teachers, a full term of marks, invoices, timetable, behaviour.
The scenario seed (`server/scripts/seed-demo-scenarios.js`) adds the **states the
phone screens branch on** — a two-child parent, a class with no teacher named, a
week the school has not summarised, a term behind on coverage — and it is what
this sheet documents.

```powershell
npm run seed:scenarios    # the whole demo school + every persona below
```

It runs last inside `seedDemo()`, so it also re-applies on every server start.
Re-runnable: each row is forced by a fixed id or natural key, so a second run
restores this sheet instead of drifting. (Note: `npm run seed` on its own prints
nothing and does nothing — `seed-demo.js` has no standalone bootstrap. Use
`seed:scenarios`.)

Weeks are computed at seed time: the **three most recently completed Mon–Fri
weeks** (the ones Saturday's snapshot cron would already have written). At the
time of writing that was `2026-10-05`, `2026-10-12`, `2026-10-19`.

Every figure quoted below was read back from the running API, not from the file.

## Students — log in with the admission number

| Login            | Student        | Class        | What it proves                                        |
| ---------------- | -------------- | ------------ | ----------------------------------------------------- |
| `demo-student`   | Amara Osei     | Form 1A      | baseline: 15/15 present, fees clear, 1 live library loan, 1 growth entry |
| `adm-2026-00002` | James Mwangi   | Form 1A      | half the fees paid, 2 demerits, parent has two children |
| `adm-2026-00003` | Fatima Al-Hassan | Form 1A    | nothing paid at all — balance the full term            |
| `adm-2025-00012` | David Mutai    | Form 2A      | boarder, on a bus route, fees clear                     |
| `adm-2025-00015` | Grace Waweru   | Form 2A      | fees clear, book already returned                       |
| `adm-2024-00011` | Aisha Mombasa  | Form 3A      | late five days in three weeks → 67 %                    |
| `adm-2026-00012` | Solomon Auma   | Standard 4A  | the worst profile (40 %, 6 absences, 1 authorised) **and the one class with no form teacher** |
| `adm-2024-00028` | Emmanuel Wekesa | Standard 6A | primary section, part-paid, **no growth entries** (the section should not render) |
| `adm-2024-00047` | Nasra Ali      | Form 6A      | A-Level — its own subjects (Economics/Mechanics/Pure Math/Statistics) and grade scale |

Faith Mwangi (`std_demo_13`, Standard 4A) gets records — attendance, snapshots,
a lost-library-book demerit — but **no login of her own**. She exists to be
opened from her father's child switcher.

Attendance profiles are 15 seeded school days per student: `perfect` 15 present;
`steady` 13/1/1; `late` 10 present + 5 late; `weak` 6 present + 6 absent + 2 late
+ 1 authorised absence.

## Parents — log in with the email

| Login                     | Children                        | What it proves                          |
| ------------------------- | ------------------------------- | --------------------------------------- |
| `parent@demo.msingi.io`   | Amara                           | one child, everything clear             |
| `john.mwangi@gmail.com`   | James (Form 1A) + Faith (Std 4A) | **the child switcher** — two children in different classes, both owing money |
| `hassan.omar@gmail.com`   | Fatima                          | child owing the whole term              |
| `kipchoge.mutai@yahoo.com`| David                           | boarder, fees clear                     |
| `peter.waweru@gmail.com`  | Grace                           | fees clear                              |
| `miriam.njoki@gmail.com`  | —                               | **account issued, no child linked**: `/children` is `[]`, family-summary is all zeros |
| `beatrice.auma@gmail.com` | Solomon                         | the absent-heavy child, nothing paid     |
| `daniel.wekesa@gmail.com` | Emmanuel                        | primary, part-paid                      |
| `hussein.ali@yahoo.com`   | Nasra                           | A-Level                                 |

`miriam.njoki` is deliberately not any seeded student's guardian — the other
eight are, so the web and the phone describe the same families.

## Teachers — unchanged by this file, named here for completeness

`teacher@demo.msingi.io` (Mr. Demo Teacher, Mathematics, no form class) is the
general one. The others show the difference between a class teacher and a
subject teacher:

| Login                  | Teacher             | Form class | Subjects                    |
| ---------------------- | ------------------- | ---------- | --------------------------- |
| `aotieno@demo.msingi.io` | Ms. Agnes Otieno  | Form 1A    | English, CRE                |
| `cwaweru@demo.msingi.io` | Mr. Collins Waweru | Form 2A    | Kiswahili, Social Studies   |
| `jnjoroge@demo.msingi.io`| Ms. Judith Njoroge | Form 3A    | Physics, Chemistry          |
| `fochieng@demo.msingi.io`| Mr. Francis Ochieng| Standard 6A| Biology, Science            |
| `smaina@demo.msingi.io`  | Mr. Samuel Maina   | Form 6A    | Business, CRE, Economics    |
| `pkamau@demo.msingi.io`  | Mr. Peter Kamau    | —          | Mathematics (+ A-Level maths) |
| `lwairimu@demo.msingi.io`| Ms. Lilian Wairimu | —          | ICT, Mathematics            |
| `jkipchoge@demo.msingi.io`| Mr. Joseph Kipchoge| —         | PE, Social Studies          |
| `dchebet@demo.msingi.io` | Ms. Dorothy Chebet | —          | **status `on_leave`** — History, Geography |

Standard 4A, Form 4A and Standard 5A have **no form teacher**, which is the row
that renders "Not assigned yet".

## What the seeded data should show

- **Curriculum coverage** — 4 topics per subject, and the *n*th subject of a
  class has *n* of them marked taught, so a student sees 25 / 50 / 75 / 100 %.
  Amara's `Form 1A`: ENG 3/4, KSW 1/4, MATH 2/4, PHY 4/4. Nasra's A-Level set is
  ECO 3/4, MECH 1/4, PMATH 4/4, STAT 2/4.
- **Weekly snapshot** — 3 weeks × 10 students, each with topics, two mark
  entries lifted from the real markbook, attendance counters, behaviour, library
  loans live that week, and one growth entry on Amara's newest week. `medical`
  is always empty for a student, by design (`_redactMedical`).
  All 27 login-owned weeks return 200 on both the JSON detail and the `/pdf`
  route, with all seven section keys present, and the parent route returns the
  same three weeks for both Mwangi children.
  The behaviour strip carries whichever incidents fall in that week: Amara's
  14 Oct merit, James's 11 Oct demerit, David's 16 Oct merit — the rest of the
  three weeks are genuinely empty because the term log has one entry a day, not
  one per student per week.
- **Messages** — 8 threads + 1 saved group (`Form 1A teaching team`):
  two whole-school/parents announcements, one teachers-only broadcast, a
  read teacher↔parent exchange about James, an **unread** follow-up about Faith,
  a class-teacher note to Amara's parent, and an attendance call-in for Solomon.
- **Announcements** — 3 live (exams, fees, sports day) and 1 **expired**
  (library stock-take) that must not appear on any board.

## Read-path defects found while verifying this seed

These are route behaviour, not seed data. Each was confirmed against the
running API on the demo school. Two of the six are now fixed; the rest are
open and none of them are authorised work.

### Fixed

1. **`behaviour` vs `behaviour_incidents`.** `routes/behaviour.js:515` stores
   every incident in `behaviour_incidents` (the demo school has 25). All three
   portal dashboards read a collection called `behaviour`, which no code ever
   writes — 0 documents in every database — so the behaviour tile, the BPS
   badge, the points total and behaviour-based at-risk detection read empty for
   every school, however much was logged. A read against a nonexistent
   collection returns `[]`, not an error, which is why it survived as long as it
   did. Now `student-portal.js:78`, `parent-portal.js:171` and
   `teacher-portal.js:65` read `behaviour_incidents`.
   Read back after the fix: Amara's dashboard reports 18 points and her
   14 Oct merit; `teacher@demo.msingi.io` flags James Mwangi with 2 negative
   incidents; Ms. Otieno's Form 1A tile reports 3 behaviour alerts.
   *Correction to what this section first claimed:* it said
   `weekly-snapshot-cron.js` never fills the behaviour section. It does — it
   delegates to `utils/weekly-snapshot-aggregate.js`, which has always read
   `behaviour_incidents` correctly (`:147`) and maps the section at `:226`. That
   mapping is the one the scenario seed copies. The dashboards were the only
   wrong readers.
2. **The parent inbox passed `req` where `_inboxQuery` wants `req.jwtUser`.**
   `messages.js:129` destructures `{ schoolId, userId, role }`, so `userId` came
   out `undefined`, the "addressed to me" half of the query matched nothing, and
   a parent's inbox listed only the messages they had *sent*. Both `parent-portal.js:965`
   (`/inbox`) and `:1041` (`/threads/:counterpartUserId`) now pass the triple.
   Read back after the fix: `john.mwangi@gmail.com` gets 5 threads with the
   unread teacher follow-up, where before he got his own sent reply alone.

Pinned so neither can silently come back:
`server/__tests__/routes/portal-behaviour-and-inbox.test.js` asserts the
collection name in all three portals and that no `_inboxQuery` call site hands
it a bare `req`.

### Still open

3. **`student-portal.js:293` selects announcements on `schoolId` + expiry only.**
   The parents-only fee notice appears on a student's board.
   `parent-portal.js:773` filters audience correctly.
4. **Portal attendance widgets filter on `academicYear`, which the write path
   never stores.** `attendance.js` rows carry a `date` and no year, so
   `student-portal.js:110` / `parent-portal.js:221` read 0 % for a school whose
   register is real — the teacher portal was fixed for exactly this
   (`teacher-portal.js:281`, counts by `date` instead). The scenario seed stamps
   `academicYear` on its own rows so the demo shows numbers; it cannot make a
   lesson-attendance marking from the app appear.
5. **No `report_card_snapshots` are seeded**, so "My marks" stays empty against a
   real server even though `assessment_marks` is full. Same for
   `teaching_assignments`, which has no seeder at all.
6. `teacher-portal.js` has no `/threads` route, so the teacher Messages tab can
   list threads but cannot open one.
