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

`teacher@demo.msingi.io` (Mr. Demo Teacher, Mathematics in Form 1A and
Standard 4A, no form class) is the general one — the account to use when you
want a teacher home with classes, today's lessons, a routine and a marks
sheet. The others show the difference between a class teacher and a subject
teacher:

| Login                  | Teacher             | Form class | Subjects                    |
| ---------------------- | ------------------- | ---------- | --------------------------- |
| `aotieno@demo.msingi.io` | Ms. Agnes Otieno  | Form 1A    | English, CRE                |
| `cwaweru@demo.msingi.io` | Mr. Collins Waweru | Form 2A    | Kiswahili, Social Studies   |
| `jnjoroge@demo.msingi.io`| Ms. Judith Njoroge | Form 3A    | Physics, Chemistry          |
| `fochieng@demo.msingi.io`| Mr. Francis Ochieng| Standard 6A| Biology, Science            |
| `smaina@demo.msingi.io`  | Mr. Samuel Maina   | Form 6A    | Business, CRE, Economics    |
| `pkamau@demo.msingi.io`  | Mr. Peter Kamau    | —          | Mathematics in 5A, 6A, F3A, F4A (+ A-Level maths) |
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
running API on the demo school. Nine of the ten are now fixed; one (report
cards for the demo persona students) is open and is not authorised work.

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

7. **Invoice and payment lists paged over a partial sort, so pages repeated and
   dropped rows.** Both lists *did* have a `.sort()` — the defect sheet first
   blamed a missing one — but `GET /invoices` sorted on `createdAt` alone and
   `GET /payments` on `paidAt` alone. `createdAt` ties to the millisecond for
   anything written in one batch (a bulk fee-structure generate, a re-seed), and
   MongoDB gives no order between tied documents across separate skip/limit
   queries, so page 2 re-served page 1's rows and skipped others.
   `finance.js:128` and `finance.js:363` now append `_id: -1`, making the order
   total.
   Read back after the fix on a school with 26 invoices in four tied `createdAt`
   buckets: pages of 20/6/0 return 26 documents, 26 unique ids, 0 repeats, 0
   unreachable against a `limit=200` ground-truth read; before it, only 22 of 26
   were reachable at all.
8. **Two receipts could be filed under one number.** The sequence is atomic
   (`utils/counters.js` `$inc`), so the bug was not a race — the counter simply
   doesn't know about numbers that arrived any other way. Seed, CSV import and a
   bursar hand-numbering a paper receipt all write `receiptNumber` without
   touching `receipt_<schoolId>_<year>`, so the counter sits behind the data and
   the next `$inc` replays a number the ledger already holds. `payments` had no
   index at all, so nothing rejected it. `nextReceiptNumber(schoolId, isTaken)`
   now walks forward past any number this school already holds, exactly like
   `reserveFreeAdmissionNumbers`; every write path (`finance.js:439`, and both
   the STK and C2B branches of `mpesa.js`) passes an `Payments.exists()` probe.
   Added a non-unique `pay_school_receipt` `{ schoolId, receiptNumber }` index in
   `utils/indexes.js` for the lookups — deliberately **not** unique, because a
   school whose history already contains a repeat would fail the index build and
   then refuse legitimate receipts.
   Read back after the fix: with the seeded run holding `000001`–`000026` minus
   two gaps and the counter parked at 2, two live `POST /api/finance/payments`
   calls took the free `000003`, then walked ten taken numbers (`000004`…`000013`)
   to the free `000014`. Unfixed, the second would have filed a duplicate
   `000004`. Both payments were then reverted; the counter stays at 14 on purpose
   — a gapped sequence is correct, a reused receipt number is not.
9. **Seeded receipts had no `paidAt`, so the payment list sorted and filtered on
   nothing.** `scripts/seed-demo-data.js:1382` wrote `date` only. Every read path
   uses `paidAt`, so demo receipts came back in arbitrary order with a blank
   date column. The seed now stamps both fields, and
   `utils/payment-paid-at-backfill.js`, run from `index.js` at startup on the
   same self-healing pattern as `finance-permission-backfill`, heals rows where
   `paidAt` is missing or null from `date`, falling back to `createdAt`. It
   writes a **string**, because `finance.js` does `effectivePaidAt.slice(0, 10)`.
   Read back after the fix: 77/77 payment documents across the demo tenants
   healed, and the `sch_demo` ledger returns 23 receipts, all with a `paidAt`,
   strictly newest-first (`2026-10-16` → `2026-09-19`).
10. **Two invoices could be filed under one number — the same drift, on the
    invoice side.** Fixed 2026-11-01, one day after the receipt half, because the
    receipt fix proved the mechanism rather than the symptom. `nextInvoiceNumber`
    drew from `invoice_<schoolId>_<year>` without looking at the ledger, and every
    path that numbers invoices by any other route (the demo seed, the students
    importer's opening balances, the finance historical-balance importer, a bursar
    hand-numbering paper history) leaves that counter behind. `invoices` has no
    unique index on `invoiceNumber`, so nothing downstream objected.
    `nextInvoiceNumber(schoolId, isTaken)` now shares `_nextFreeNumber` with the
    receipt generator — one walk, two labels, so the pair cannot drift apart in
    the code either — and `reserveFreeInvoiceNumbers(schoolId, count, isTaken)` is
    its bulk twin. All six write paths pass a probe: `finance.js:179`
    (`POST /invoices`), `:1114` (term billing), `:1340` (fee-structure generate),
    `utils/admission-billing.js:74` (enrollment drafts) and both importers at
    `routes/import-export.js:880` and `:1799`, which pre-load the school's whole
    number set the way the student rows already do for admission numbers. Added a
    non-unique `inv_school_number` `{ schoolId, invoiceNumber }` index for the
    lookups, for the same reason the receipt index is not unique.
    *Correction to what this section first claimed:* the defect sheet said "three
    call sites in finance.js". It is four invoice generators across two files,
    plus two bulk reservation sites — leaving any of them unchecked would have
    kept the drift alive on the exact paths that produce the most invoices.
    Read back after the fix, on a demo school holding `INV-2026-000001`–`000026`
    with **no `invoice_sch_demo_2026` counter document at all**: two live
    `POST /api/finance/invoices` calls came back `000027` then `000028`. Unfixed,
    both drew from a fresh counter and filed `000001`, then `000002` — a duplicate
    of two live seeded invoices. Reverted afterwards (both documents, their two
    `audit_logs` rows, and the counter, which only existed because of them); the
    ledger is back to 26 invoices, 0 duplicates, 23 payments.

Pinned so none of these can silently come back:
`server/__tests__/routes/portal-behaviour-and-inbox.test.js` asserts the
collection name in all three portals and that no `_inboxQuery` call site hands
it a bare `req`; `server/__tests__/routes/finance-list-paging.test.js` rotates
tied rows the way Mongo does and fails if any document is unreachable or served
twice; `server/__tests__/receipt-number-collision.test.js` and
`server/__tests__/routes/finance-record-payment-receipt.test.js` cover the walk
and prove the route passes the tenant-scoped probe;
`server/__tests__/payment-paid-at-backfill.test.js` covers the heal, its
idempotence, and the string-not-Date contract;
`server/__tests__/invoice-number-collision.test.js` covers both the single and
the batch invoice walk, including that the batch never repeats a number across
rounds, and `server/__tests__/routes/finance-create-invoice-number.test.js`
proves `POST /invoices` asks. The four bulk paths were each mocked to a faithful
walk, so a write path that stops probing now fails its own suite:
`admission-billing.test.js`, `finance-term-billing.test.js`,
`finance-academic-period.test.js` (`/fee-structures/:id/generate`),
`import-export-finance-audit.test.js` and `import-students-fields.test.js`.

### Still open

3. ~~**`student-portal.js:293` selects announcements on `schoolId` + expiry only.**
   The parents-only fee notice appears on a student's board.
   `parent-portal.js:773` filters audience correctly.~~ **Fixed 2026-11-01:** the
   audience cut now lives in one shared helper, `utils/announcement-audience.js`,
   used by both portal reads (`student-portal.js:309`, `parent-portal.js:830`).
   It deliberately lives in the **query**, not a post-filter: both boards apply
   `.limit()` at the database, so filtering afterwards lets three parents-only
   posts occupy a student's whole board. Absent or `null` audience = whole
   school (legacy rows); an explicit `[]` addresses nobody and stays hidden,
   matching how the parent board already behaved. Matching is anchored,
   case-insensitive `$regex` over the key set (`parents` also accepts
   `guardians`/`family`; `students` also accepts `all`) so `'Parents'` and
   `['Students']` keep working — an `$in` clause would have silently hidden
   them. Read back on the live API: `demo-student` board =
   `["End of term examinations begin Monday", "Sports Day is the last Friday of
   term"]` with the parents-only fee notice absent, while
   `GET /parent-portal/notices` as `john.mwangi@gmail.com` still returns all
   three live posts including "Term 3 fees — clearance letters", and the expired
   library stock-take appears on neither. Pinned by
   `student-portal-dashboard.test.js` (4 new) and
   `parent-portal-mobile-screens.test.js` (3 new).
   *Gaps left deliberately open, for the next pass:* the parent **dashboard**
   (`parent-portal.js:417`) and teacher **dashboard** (`teacher-portal.js:884`)
   still read announcements with no audience clause — each is a one-line
   `audienceClause(...)` away. Separately, `GET /notices` sorts
   `{ priority: -1, createdAt: -1 }` (pre-existing, unrelated to this fix), and
   `priority` is a string: reverse-lexicographic order puts `normal` **above**
   `high`, so pinned notices sink. The live parent read-back above shows it —
   "Sports Day" (normal) came before "End of term examinations" (high).
4. ~~**Portal attendance widgets filter on `academicYear`, which the write path
   never stores.** `attendance.js` rows carry a `date` and no year, so
   `student-portal.js:110` / `parent-portal.js:221` read 0 % for a school whose
   register is real.~~ **Fixed 2026-10-27** (commit `8b80f8e` — it was still
   listed as open here because nobody had read it back since): all three portals
   resolve the current term with `_resolveCurrentPeriod` and filter `date`
   against that term's own `startDate`/`endDate`. Read back on the live API —
   Amara 34 present / 1 late of 35, Aisha 28 / 6 late of 35, Solomon 27 present /
   7 absent / 2 late / 3 authorised of 39 — matching the DB exactly, and
   including rows the old filter could never see: Amara's 60 base-seed rows carry
   no `academicYear` at all, and 20 of them fall inside Term 3. Pinned by
   `student-portal-dashboard.test.js`,
   `parent-portal-dashboard-attendance.test.js` and
   `teacher-portal-dashboard-attendance.test.js` (46 tests).
   *Correction to what this entry first claimed:* it said the demo "shows
   numbers" for attendance. The scenario rows do, but the widget was counting
   **only** those 15 rows per student — an undercount of the school's own
   register, not a 0 % in the demo specifically. A school that has never been
   seeded is the 0 % case.
5. **No `report_card_snapshots` for the demo persona students**, so "My marks"
   stays empty for Amara, James, Aisha and Solomon even though `assessment_marks`
   is full.
   *Correction to what this entry first claimed:* it said neither collection has
   a seeder. `teaching_assignments` does (`scripts/seed-demo-data.js:1236`, and
   the timetable-derived pass added in October), and `report_card_snapshots` is
   not empty either — the demo school holds 30 documents, 6 live for Standard 6A
   and Form 5A, published through the real route on 2026-10-20. What is missing
   is coverage: 6 of 26 active students have a live snapshot, and none of the
   four personas do. The grading inputs a publish needs are all present (CA/HW/
   MT/ET marks per class and term, `assessment_config` weights
   `{CA:20,HW:10,MT:30,ET:40}`, 4 grade boundaries), so the honest options are to
   drive the real `/publish` route for the persona classes on an earlier term —
   faithful, but it locks that term's markbook and notifies families — or to
   write snapshot docs by hand, which `_hashSnapshot` is not exported to support
   and which would drift from the renderer.
6. ~~`teacher-portal.js` has no `/threads` route, so the teacher Messages tab
   can list threads but cannot open one.~~ **Fixed 2026-10-29:** teacher-portal
   now has `GET` and `POST /threads/:counterpartUserId`; the Messages row opens
   the conversation and replies through the shared direct-message path.
   Pinned by `server/__tests__/routes/teacher-portal-threads.test.js`.
