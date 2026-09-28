# Report Card Settings and Publication

## Prepare and publish

1. Confirm marks and exam results for the class/term are complete and approved.
2. Review grading, ranking, template, comments, and publication-policy settings before generating cards.
3. Open the Report Cards workflow, select academic year, term, and class, then preview/validate the set.
4. Generate and publish using the authorized action. Check the result count and publication status.
5. Download individual or class PDFs from the report-card view. If a correction is needed, use the supported correction/republish flow; prior versions are retained as history.

Settings changes generally affect future generation, not already-published snapshots. Check holds and student/parent visibility before telling families the cards are available.


## Setup, updates, and verification

### Configure and update report cards

Before a reporting cycle, confirm templates, grading rules, ranking options, comments, publication policy, and holds. Generate a preview for a small/representative set and resolve validation issues before generating the full class. Verify card counts, student identity, term, and publication state before release. Use the supported correction/republish workflow so version history remains intact; settings changes should not be assumed to alter an already-published snapshot.

Report cards read an exam's approved results, not its sitting date/time — scheduling or announcing an exam with a start/end time (see [exams.md](exams.md)) has no effect on grading, ranking, or generation. What still matters here is exam **status**: results must be moderated and approved (see [exams.md](exams.md)'s lifecycle) before a report-card generation run will reflect them.

**Access:** Report-card settings, draft comments, workflow configuration, publication, and grade generation can have distinct permissions. Publishing is a sensitive action.

**Sources:** `client/src/pages/reportcards/`, `client/src/pages/grades/components/ReportCardsTab.jsx`; `server/routes/report-cards.js`, `rc-templates.js`, `report-card-templates.js`; [User Guide](../USER_GUIDE.md#9a-report-cards-new-in-v46).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.106.0–v5.107.0 and the report-card architecture reviews in `docs/audits/`.
