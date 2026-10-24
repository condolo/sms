# Report Card Settings and Publication

## Prepare and publish

1. Confirm the Markbook marks and comments for the exact class/term are saved and complete. If the school uses the mark-submission Review queue, check its status as a separate moderation record.
2. Review grading, ranking, template, comments, and publication-policy settings before generating cards.
3. Open the Report Cards workflow, select academic year, term, and class, then preview/validate the set.
4. Generate and publish using the authorized action. Check the result count and publication status.
5. Download individual or class PDFs from the report-card view. If a correction is needed, use the supported correction/republish flow; prior versions are retained as history.

Settings changes generally affect future generation, not already-published snapshots. Check holds and student/parent visibility before telling families the cards are available.


## Setup, updates, and verification

### Configure and update report cards

Before a reporting cycle, confirm templates, grading rules, ranking options, comments, publication policy, and holds. Generate a preview for a small/representative set and resolve validation issues before generating the full class. Verify card counts, student identity, term, and publication state before release. Use the supported correction/republish workflow so version history remains intact; settings changes should not be assumed to alter an already-published snapshot.

Report cards use the current Markbook records; an exam sitting's status or time is not the source of the marks. Teachers can enter and edit marks before report-card publication. A preview can show a **Provisional** banner where applicable; resolve validation and provisional warnings before publication. Publishing creates the report snapshot and locks the relevant marks. Review-queue submission/approval is a separate workflow and should not be confused with where marks are stored.

If a school has turned on **Class Teacher Observation Ratings** (Settings → Report Cards → General — off by default), the class teacher fills in an Excellent/Good/Improve rating per configured category for each student before publishing; it's saved alongside their written remark and carried into the published card the same way. If your school's report card is meant to show a **Principal's signature or school stamp**, upload it once in that same settings screen — it renders on every card generated afterward.

**Access:** Report-card settings, draft comments, workflow configuration, publication, and grade generation can have distinct permissions. Publishing is a sensitive action.

**Sources:** `client/src/pages/reportcards/`, `client/src/pages/grades/components/ReportCardsTab.jsx`; `server/routes/report-cards.js`, `rc-templates.js`, `rc-template-scale.js`, `report-card-templates.js`; [User Guide](../USER_GUIDE.md#9a-report-cards-new-in-v46).

**Recent change notes:** always check [CHANGELOG.md](../../CHANGELOG.md) for newer behavior. Relevant changes include v5.170.0–v5.170.2 (republish/comment integrity and comments remain editable before publication), v5.177.0 (mark entry is autonomous; publish is the automatic lock point), v5.178.0 (Kindergarten template curriculum and class-teacher-only comments), v5.181.0 (Kindergarten Templates moved to Exams), v5.185.0 (class-teacher remark save feedback), and v5.193.0 (protect against a save silently blanking a field the teacher did not see). Earlier rendering and preview changes include v5.148.0–v5.149.0; see also the report-card architecture reviews in `docs/audits/`.
