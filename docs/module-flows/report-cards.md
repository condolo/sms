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

Report cards read an exam's approved results, not its sitting date/time — scheduling or announcing an exam with a start/end time (see [exams.md](exams.md)) has no effect on grading, ranking, or generation. What still matters here is exam **status** (see [exams.md](exams.md)'s lifecycle) — but the moderation requirement only applies at **Publish**, not at Preview/Generate: a preview can show numbers from an exam that's merely `completed`, not yet moderated/approved, and now says so with a "Provisional" banner when that's the case. Treat a provisional preview as exactly that — the numbers can still move before Publish will accept them.

If a school has turned on **Class Teacher Observation Ratings** (Settings → Report Cards → General — off by default), the class teacher fills in an Excellent/Good/Improve rating per configured category for each student before publishing; it's saved alongside their written remark and carried into the published card the same way. If your school's report card is meant to show a **Principal's signature or school stamp**, upload it once in that same settings screen — it renders on every card generated afterward.

**Access:** Report-card settings, draft comments, workflow configuration, publication, and grade generation can have distinct permissions. Publishing is a sensitive action.

**Sources:** `client/src/pages/reportcards/`, `client/src/pages/grades/components/ReportCardsTab.jsx`; `server/routes/report-cards.js`, `rc-templates.js`, `report-card-templates.js`; [User Guide](../USER_GUIDE.md#9a-report-cards-new-in-v46).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.106.0–v5.107.0 and the report-card architecture reviews in `docs/audits/`; v5.148.0 for the attendance-summary fix (it previously always showed 0) and the PDF/HTML/bulk-download class-scope fix; and v5.149.0 for the signature/stamp upload UI, the Preview "Provisional" indicator, and Class Teacher Observation Ratings.
