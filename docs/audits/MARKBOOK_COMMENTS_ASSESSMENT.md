# Markbook Comments — Assessment

**Date:** 2026-10-05
**Status:** Assessment only as of 2026-10-05. Several of the findings below have since been fixed in code — see the 2026-10-11 update note immediately below before reading §2/§4 as current.
**Reference:** `Nour Ahmed Mohamed Ali 8A T3 REPORT.pdf` (Light International School, Term 3 report, Academic Year 2024-2025)
**Related:** `docs/audits/REPORT_CARD_COMMENT_LIFECYCLE_REVIEW.md` (2026-07-21). Its "Mark Entry inline comment field" premise no longer matches the code (see §2.1). Its draft→published carry-forward gap is closed in code (see §2.5).

---

## Update — 2026-10-11

Re-checked against the current code. Four of the items below are now fixed; the rest of the assessment (notably §5's Markbook-grid UI and the §6 decisions) is still accurate and unstarted.

- **§2.1 / §4.3 — no longer true.** A real writer for subject comments now exists: `StudentReportCard.jsx`'s Comments tab renders a `SubjectCommentField` per subject ("Subject Teacher Comments", ~line 414-428), wired through `onSaveSubjectComment` → `ReportCardsTab.jsx`'s `saveSubjectComment` mutation → `reportCardsApi.draftComments.saveSubject` → the previously-dead `PUT /draft-comments/:studentId/subject/:subjectId` route. The route is no longer dead. **Caveat:** this writer lives in the Report Cards module's student editor, not in the Markbook grid itself — §5's proposed grid-embedded comment field (with per-cell ticks/crosses) is still not built.
- **§2.2 / §4.1 — fixed.** `StudentReportCard.jsx`'s `handleSave` now explicitly destructures `subjectComments` out of the payload before calling `onSaveComment` (`const { subjectComments: _subjectComments, ...rest } = comment;`), with a comment explaining why: each subject comment saves on its own via `saveSubjectComment` so the server checks it against the caller's own subject. The latent 403-on-partial-assignment bug no longer applies.
- **§2.3 / §4.2 — fixed.** The class-teacher remark write path (`report-cards.js` ~line 2322) now calls `canWriteClassRemark(req, placement.streamId)` before allowing the write. A teacher who is not that stream's form tutor is refused (covered by `server/__tests__/routes/report-card-comment-rights.test.js`).
- **§4.4 — fixed.** The stale `StudentReportCard.jsx` comment referencing the retired `MarkEntryTab` is gone.
- **§4.5 — still open.** The `streams.formTeacherId` vs `classes.formTeacherId` split has not been reconciled; `report-cards.js` still resolves the class teacher from `streams.formTeacherId` only (~line 500-519).
- **§3.3 — answered by subsequent, unrelated work, not by this assessment.** A later session (2026-10-11) removed the mark-submission/schedule lock on comments entirely, per explicit instruction ("nothing should block comments") — this matches option (a) in §3.3 ("keep comments unlocked until publish, as now"), not option (b).
- **§5 / §6 — still accurate.** The Markbook-grid UI (per-cell save ticks, red-X for missing marks, growing comment textarea in the grid) was never built. None of the six §6 decisions have been answered.

---

## 1. What the target report shows

From the PDF text layer:

- **One teacher comment per subject per term.** Each subject line names its teacher ("BIOLOGY 8 Mrs. Marzhan Suleimenova"), followed by a paragraph of 2–5 sentences.
- **Per term columns.** Term 1, Term 2, Term 3 and Year. The comment shown is for Term 3 in this report.
- **Behaviour** (`Score 355, Outstanding`) and **Attendance** (per term, total) blocks.
- **No class teacher overall remark is visible** in this sample. The only paragraphs are per subject. Whether the template also carries a class-teacher or principal remark is not visible here and needs confirming against the school's layout (§6, question 5).

So the report's comment model is: **subject teacher → one comment per student, per subject, per term.** That is the existing `subjectComments` model, not a per-assessment one.

---

## 2. What the code does today

### 2.1 Subject teacher comments: no writer exists in the UI

- Storage: `report_card_draft_comments.subjectComments.{subjectId}`, keyed by `{schoolId, studentId, termNumber}`.
- Write routes: `PUT /report-cards/draft-comments/:studentId/subject/:subjectId` and `PUT /report-cards/draft-comments/:studentId` (`server/routes/report-cards.js` ~2043, ~2121). Both are gated by `rbac('report_cards','update')` and by `canWriteSubject` / `unassignedPairs` (`server/utils/subject-scope.js`), which matches a `teaching_assignments` row on `{classId, subjectId, streamId}`.
- **No client code calls the `saveSubject` endpoint.** `client/src/api/client.js:1040` defines it, nothing uses it.
- The Markbook (`MarkbookTab`, `client/src/pages/exams/ExamsPage.jsx:539`) has **no comment field**. The old `MarkEntryTab.jsx` the review refers to no longer exists. `StudentReportCard.jsx:370` still says "set in MarkEntryTab" — a stale comment.
- The report card's Comments section (`StudentReportCard.jsx` ~365–400) shows subject comments **read-only**. Its editable fields are only the class teacher name/remark, principal name/remark, sports & talent, closing date, next term begins, and observation ratings.

**Consequence:** in the current product, no user can enter a subject teacher comment through the UI. The only way one appears on a report is via the API or seed data.

### 2.2 Latent save bug in the report card editor

`StudentReportCard.jsx`'s `handleSave` sends the full `comment` object, including every `subjectComments` key it loaded. `PUT /draft-comments/:studentId` then runs `unassignedPairs` over **all** those keys. So a class teacher who teaches only some of the subjects would get `403 You are not assigned to teach: …` on any save, as soon as one subject in that class has a comment. This is read from the code, not reproduced in a running environment. It stays latent until subject comments can be written, which is exactly when it would start to bite.

### 2.3 Class teacher remark

- Written by the same `PUT /draft-comments/:studentId` route, gated only by `report_cards:update`. **No check that the caller is the class's form teacher.** Any user with that module permission can write any class's remark.
- The **class teacher** is resolved from `streams.formTeacherId` (`report-cards.js:425-456`). A second source, `classes.formTeacherId`, is used as a fallback in `teacher-portal.js:238` and `parent-portal.js` / `student-portal.js`. The two sources are not reconciled anywhere. The report uses only the stream one.
- A form teacher who does **not** teach the class has no `teaching_assignments` row. They therefore have no Markbook access to that class (`scopeEngine` / `assessmentScope`), so they cannot see the marks their remark should refer to. The only exception is `resolveHomeroomStreamIds` (`scopeEngine.js:336`), which is folded in for Attendance and Lessons pickers only.
- A teacher who teaches **only a few subjects** in their form class is not covered by any rule that makes them write for the whole class, or that tells the form teacher which subjects they should wait for.

### 2.4 Mark entry rights (for comparison)

- `POST /assessment/marks` and `/marks/bulk`: `rbac('grades','create')` + `canWriteSubject` per `{classId, subjectId, streamId}`.
- Locks: schedule lock (`assessment_schedule` `isLocked`), per-mark `isLocked`, and `mark_submissions` status (`submitted`/`approved` blocks edits, per the consolidation plan's Phase 3 — partly implemented).

### 2.5 Report comments: lifecycle

- Draft comments live in `report_card_draft_comments` until publish.
- **Publish now carries drafts forward** (`report-cards.js` ~652–803, `_resolveSnapComments(prev, draft)`). The review's "Recommendation 1" gap is closed in code, even though its document still says otherwise.
- After publish, comments live on `report_card_snapshots.comments`. `PUT /:id/comments` (~1351) edits them with `grades:update`, and the subject-scope check applies. Principal remarks are admin-only. Edits are blocked only if the snapshot is `superseded`.
- The RC8 remark approval chain (`report_comment_approval`, `PATCH /draft-comments/:studentId/advance`) is an optional, school-configured sequence of remark steps. It is independent of marks.

### 2.6 Where the comment on/off switch lives

- `assessment_config.subjectTeacherCommentsEnabled`, edited in **Report Cards → Settings → Comments** (`client/src/pages/reportcards/components/SettingsPanel.jsx:372-420`). It was moved there from Exams → Configuration (RC7). The same panel also holds the comment bank.
- So "turning comments on" already exists in a configuration screen. It is in the Report Cards module, not Exams/Markbook.

### 2.7 Markbook grid: what exists versus what you described

| You described | Exists today |
|---|---|
| Filter by class and stream to enter marks | **Yes.** Class and stream picker, scope-aware (`ExamsPage.jsx` `MarkbookTab`, `classesApi.list({assignedOnly:true})`). |
| Missing marks shown with a red X | **No.** Empty cells are plain white. `MIS` is a mark state in a dropdown, not a per-cell marker. |
| Updated marks shown with a green tick | **No.** Cells are coloured by score (green ≥50, red <50), not by save state. |
| Text field that grows with the text | **No.** No comment field exists in the grid. Existing textareas are fixed-height (`ExamsPage.jsx` ~1493, ~1858). |
| Grid and report card connected | **Partly.** Marks feed the report via `assessment_marks`; comments are separate and not reachable from the grid. |

---

## 3. Answers to your points

### 3.1 Who can write comments: same rights as marks

Proposed rule: **a subject comment can be written by exactly the users who can enter marks for that `{class, subject, stream}`.** That means `grades:create` (or a new `comments` sub-permission, see §6) **and** the `canWriteSubject` check. Management roles keep their existing bypass (`MANAGEMENT_ROLES` in `subject-scope.js`). This matches what the code already enforces for the server write routes. The UI just needs to expose it.

### 3.2 Per assessment or per report: which?

- The PDF and the current model are **per subject, per term**. One comment per student, per subject, per term.
- "Per assessment" (for example a comment on a single CA) would be new. It needs a comment keyed by `assessmentType`/`instance` as well. The report would then have to decide which assessment's comment to show, which the current report template cannot do.
- **Recommendation:** make the stored and printed comment per subject per term, as the report already does. Allow a teacher to optionally tag it to an assessment instance for their own reference, shown in the grid but not printed. This needs your decision (§6, question 2).

### 3.3 What locks, and when

- Today there is **no lock on draft subject comments**. They stay editable until publish. Once published, the snapshot is editable until superseded.
- Marks lock through three mechanisms: schedule lock, mark lock, and `mark_submissions` status.
- "Keep it that way" can mean two things, and they differ. (a) Keep comments unlocked until publish, as now. (b) Lock each subject comment together with that subject's mark submission (submitted/approved/locked). (b) would be new. §6, question 3.

### 3.4 Turning comments on

Already exists in Report Cards → Settings → Comments. Moving it under Exams → Configuration means moving the toggle and the comment bank UI. The stored field stays `assessment_config.subjectTeacherCommentsEnabled`, so no data migration is needed.

### 3.5 The grid with ticks, crosses and growing comment field

Entirely new. Needs:
- Per-cell save state: a `saved` tick after a successful `/marks/bulk` response, a red X on any unentered `present` cell in a filtered class/stream, and a clear state for `ABS`/`EXM`/`INC`.
- A comment column or expandable row per student/subject, with a textarea that grows to fit its content (`rows` plus auto-resize on input).
- Writes go to the same subject-comment endpoint as §3.1.

This is UI work on top of the Markbook consolidation plan (`~/.claude/plans/curious-bouncing-emerson.md`, Phase 1 and 3). It should not be built as a parallel grid.

### 3.6 Class teachers who do not teach the class, or only teach a few subjects

Current facts, §2.3. Options for the class remark, which need a decision (§6, question 4):

- **A. Form teacher only** (`streams.formTeacherId`, one person per stream). Clean, matches "class teacher". Needs a fix so a form teacher who does not teach the class can still **read** a summary of marks and comments for that stream, without gaining mark-entry rights.
- **B. Form teacher plus the subject teachers' comments as input.** The class teacher reads every subject's comment (read-only), then writes the overall remark. Same read-access requirement as A.
- In either option, the **`classes.formTeacherId` vs `streams.formTeacherId`** conflict must be resolved first. Otherwise the report's class teacher and the portal's class teacher can disagree.

---

## 4. Defects to fix regardless of the design

1. **§2.2 latent 403** on draft save for a class teacher with partial subject assignments. Send only the changed key, not the full map.
2. **§2.3 class-teacher remark has no ownership check.** Any `report_cards:update` holder can write it.
3. **§2.1 dead route and client API.** `draft-comments/:studentId/subject/:subjectId` and `draftComments.saveSubject` have no caller. Either wire them into the new grid or remove them.
4. **§2.1 stale comment** in `StudentReportCard.jsx:370` referencing `MarkEntryTab`.
5. **Two form-teacher sources** (§2.3) resolved in one place.
6. **Review document drift:** `REPORT_CARD_COMMENT_LIFECYCLE_REVIEW.md` still describes the carry-forward gap as open. It is closed in `POST /publish`.

---

## 5. Proposed shape (not started)

1. **Data:** keep `report_card_draft_comments.subjectComments`. Add optional `subjectCommentMeta.{subjectId}` = `{by, at, assessmentInstance?}` for audit and the optional tag. No new collection unless §6 question 2 says per-assessment.
2. **Write path:** one endpoint, `PUT /assessment/comments` (or keep the existing draft route with the single-key fix), gated by the same `canWriteSubject` rule as marks.
3. **Markbook UI:** filter by class/stream as today; add per-cell save ticks and red X for missing; add a comment textarea per student per subject that auto-grows.
4. **Read-only summary for form teachers** (option A or B), scoped to the stream only.
5. **Settings:** move the comment toggle and comment bank panel into Exams → Configuration; leave the report card module with read-only display of comments and the publish/approval controls.
6. **Tests:** ownership check on subject and class-teacher writes; form-teacher read-only access; the single-key save; grid state transitions.

---

## 6. Decisions needed before building

1. **Who may write a subject comment?** Confirm "same rights as marks" means `grades:create` + `canWriteSubject`, or a new `comments` sub-permission in the Exams module.
2. **Per subject per term, or per assessment?** The PDF shows per subject per term. Is a per-assessment comment also wanted, and if so, does it print?
3. **Lock behaviour for comments:** (a) unlocked until publish, as now; (b) locked when that subject's mark submission is submitted/approved/locked. Which one is "keep it that way"?
4. **Class teacher remark:** (A) form teacher only, with read-only summary access, or (B) form teacher writes after reading all subject comments. And which form-teacher field is authoritative: `streams.formTeacherId` or `classes.formTeacherId`?
5. **Does the report template carry a class teacher or principal overall remark?** The sample shows only subject comments. If it does, where does it sit?
6. **Where does the comment toggle live?** Move it to Exams → Configuration (your request) and leave Report Cards → Settings → Comments removed, or keep both?

Once these are answered I will: fix the §4 defects first (they are independent of the design), then build §5 in the order the Markbook consolidation plan allows.
