# Report Card Comment Lifecycle — Final Review

**Date:** 2026-07-21
**Status:** Architecture only. No code changed.
**Depends on:** [REPORT_CARD_PLATFORM_FUNCTIONAL_ARCHITECTURE.md](REPORT_CARD_PLATFORM_FUNCTIONAL_ARCHITECTURE.md) §6-§8 (module ownership, Template vs Configuration boundary). This document narrows to one question left open there: the complete lifecycle of every comment type, and whether Comment Banks should be a shared service.
**Amended 2026-07-21 (see end of document):** the Functional Architecture document was subsequently revised to model comment participants as school-configurable, not fixed roles (its §11-§12). The four-row table below remains accurate as an evidence-tracing exercise — it documents what exists in the schema and UI today, Head of Section correctly identified as not existing at all — but should be read through that later capability lens, not as a proposal for four hardcoded fields. See the amendment at the end of this document for the reconciled model.

---

## The one finding that determines everything else in this document

Before mapping who creates/edits/approves each comment type, one fact has to be stated first, because it changes what "consumes" means for all four types: **there is currently no automatic path from a draft comment to a published comment.**

Traced precisely, in `report-cards.js`'s `POST /publish`:

```
comments: prev?.comments || { subjectComments: {}, classTeacherRemark: '', principalRemark: '' }
```

The new snapshot's `comments` field is populated **only from the previous published snapshot** — never from `report_card_draft_comments`, the collection every comment-writing UI (Mark Entry's inline field, `StudentReportCard.jsx`'s Comments tab) actually writes to. On a student's **first-ever** publish for a term, there is no `prev` — every comment field on the new snapshot starts **completely blank**, regardless of how much a subject teacher, class teacher, or principal typed beforehand. The only way draft content ever reaches a published document is a **second, separate, manual action**: `PUT /:id/comments`, called *after* publish, editing the snapshot directly.

This means the real current lifecycle for every comment type today is: **write to draft → publish (comments arrive empty on first publish) → someone has to remember to go back and call the post-publish comments endpoint to actually put the words on the document.** That's not a workflow — it's a gap that happens to be survivable only because most schools republish a term multiple times, so by the second-or-later publish, `prev.comments` carries something forward. First-term-ever, first-publish-ever is where this breaks visibly. This single fact is why "who consumes it, in what order" needs its own row in every table below, not just "who creates/edits/approves."

---

## Per-comment-type lifecycle

Each row states plainly what exists today vs. what's proposed — per your own instruction elsewhere in this review not to let "we should build X" read as "X already works this way."

### 1. Subject Teacher Comment

| Stage | Today | Proposed |
|---|---|---|
| Creates | Two independent UI surfaces: `MarkEntryTab.jsx` (inline, during mark entry) and `StudentReportCard.jsx`'s Comments tab (during report review) — both write `report_card_draft_comments.subjectComments.{subjectId}` | Same, but only the Mark Entry surface remains a *writer*; the Report Cards surface becomes read-only display (removes the race condition documented in the prior review) |
| Edits | Either surface, no distinction between create/edit — last write per key wins | Assessment → Comments owns the write path exclusively |
| Approves | **Nothing exists.** No status field, no review step, no lock. | New — see "Approval Workflow" below |
| Consumes | Nothing automatically — see the finding above. Only reaches a published document via the manual post-publish PUT. | Should flow into publish directly, not require a second manual step (see Recommendation 1) |
| Owns | `report-cards.js` (route file), `report_card_draft_comments` (collection) | **Assessment → Comments**, per your split — agreed, evaluated in the prior review |

### 2. Class Teacher Comment

| Stage | Today | Proposed |
|---|---|---|
| Creates | `report_card_draft_comments.classTeacherRemark` (pre-publish) or directly via `PUT /:id/comments` (post-publish, any authenticated role that has `grades:update`) | Same surfaces; formalized as "written after all subjects are complete" per your framing |
| Edits | Same as create — no distinct edit step, no lock once written | Could gain a "locked once submitted for review" state if the approval chain below is built |
| Approves | **Nothing exists.** Whoever has permission can write it directly onto the published snapshot with no review step. | New — first step in your proposed chain |
| Consumes | Same manual-carry-forward gap as Subject Teacher comments | Same fix as Recommendation 1 |
| Owns | `report-cards.js` / `report_card_draft_comments` (same document as Subject Teacher and Principal comments today — see the schema-bundling finding in the prior review) | **Report Cards** — agreed, this is genuinely publication-process content, not assessment evidence |

### 3. Head of Section Comment

| Stage | Today | Proposed |
|---|---|---|
| Creates | **Does not exist.** No field for this on `report_card_draft_comments`, `report_card_snapshots`, or anywhere else. Checked the full schema of both — not present. | New field, new UI |
| Edits / Approves / Consumes | N/A — nothing to edit | New, same shape as Class Teacher/Principal once built |
| Owns | N/A | **Report Cards**, per your reasoning (publication, not assessment) — agreed in principle; flagging that this is 100% greenfield, not a rename of an existing field, so it should be sized as new work in whatever comes after this review |

One relevant existing fact worth connecting: `sections.js` already has a real `sectionHeadId` field on each section (`DEFAULT_SECTIONS`, `SectionSchema`). A "Head of Section" role already has a well-defined *person* attached to each section today — this new comment type would be the first thing that actually *uses* that existing assignment for something beyond organizational display. Worth confirming whether the intent is "whoever is currently `sectionHeadId` for this student's section signs this comment" (dynamic, resolved at generation/publish time) or a role-based assignment independent of that field — the two have different edge-case behavior if a section head changes mid-term.

### 4. Principal's Comment

| Stage | Today | Proposed |
|---|---|---|
| Creates | `report_card_draft_comments.principalRemark` (pre-publish, any role) or `PUT /:id/comments` (post-publish, **role-gated**: `if (!['admin','superadmin'].includes(role)) return E.forbidden(...)` — the one comment field with any access control today) | Same gating, formalized as the final step of the approval chain |
| Edits | Same as create | Same, but as the terminal approval action rather than an unrestricted edit |
| Approves | The principal's own write action is, in effect, the only "approval" any comment type has today | Becomes the explicit terminal step — "Principal Approval" and "principal writes their comment" may be the same UI action or two separate ones; worth deciding, not assumed |
| Consumes | Same manual-carry-forward gap | Same fix |
| Owns | `report-cards.js` | **Report Cards** — no disagreement anywhere in this review chain |

---

## Approval Workflow — a concrete recommendation, not a new mechanism

Your proposed chain (Subject Teacher submits → Class Teacher reviews → Head of Section approves → Principal publishes) asks where this lives. Before answering "which module," there's a more useful answer: **this codebase already has a generic, reusable, multi-step approval-chain primitive, built this session for HR Leave and already reused for a second, unrelated workflow (marks-unlock requests).**

`server/utils/workflow-config.js` — `getWorkflowConfig`/`saveWorkflowConfig`/`validateSteps`/`_resolveAssignee` — is keyed by an arbitrary `workflowKey` string, not hardcoded to leave approval. Steps are `{assigneeType: 'role'|'user', assigneeValue, fallback?}`, resolved live against current role-holders (not frozen names, avoiding exactly the staleness problem a copied display name would cause if a Head of Section changes). It's already proven across two independent domains (`leave_approval`, `marks_unlock`) with different step-count minimums per domain (`minSteps` parameter).

**Recommendation**: the comment-approval chain should register as a third `workflowKey` (e.g. `report_comment_approval`) on this existing mechanism, not a bespoke chain built inside Report Cards. This is a direct application of "prefer shared services, never duplicate business logic" — the exact principle this whole review has been implicitly enforcing against `rc_templates`, `academic_config`'s dead settings, and comment banks. Building a second approval-chain engine for report cards when one already exists and is already proven reusable would be the same category of mistake in reverse — creating duplication instead of finding it.

**This resolves your "where does the workflow live" question directly**: the *workflow engine* lives in shared utilities (already does). The *report-card-specific configuration* of which steps a school wants, and the *state* of where a given student's report sits in that chain, belongs to **Report Cards** — it owns the publication process, and the approval chain is part of that process, not a separate concern.

---

## Recommendation 1: close the draft→published gap directly

Named above at every "Consumes" row, worth stating once as its own fix rather than four times: `POST /publish` should read `report_card_draft_comments` for students with no prior snapshot (first-ever publish), not only fall back to `prev.comments`. This is independent of the ownership questions in this document and independent of the approval-workflow question — it's a real, currently-live gap regardless of which module ends up owning subject vs. report-level comments.

---

## Comment Banks — should it be a shared service?

**Yes, and there's already a structural precedent for exactly this in the codebase, not just a good idea in the abstract.** `server/utils/` already functions as this platform's shared-services layer: `academic-calc.js` and `ranking.js` are consumed exclusively by Report Cards but live as standalone utilities rather than inline in `report-cards.js`; `notify-dispatch.js`/`notif-settings.js` are consumed by every module that fires a notification (Behaviour, Report Cards, Finance, Attendance) and correctly live outside all of them. "Comment Banks becomes a shared utility, not owned by Assessment or Report Cards" is the same pattern applied to a fifth thing, not a new organizational concept this document has to invent.

Concretely: `comment_banks`' existing `category` enum (`academic/behaviour/general/subject`) already gestures at exactly the cross-module reuse you're describing — it was seemingly designed for this from the start and simply never got a second consumer. Moving it to Shared Academic Services doesn't require a schema change, just relocating the route file and letting Assessment (subject comments), Report Cards (class teacher/principal/head-of-section remarks), and eventually Behaviour all call the same picklist API instead of one module claiming exclusive ownership.

---

## Template vs. Configuration for remarks and signatures — your distinction holds, cross-checked against the existing test

The Functional Architecture document (§8) already established the test: *if changing it could change a number on the report, it's Configuration; if it only changes how already-decided content is displayed or arranged, it's Template.* Your "which remarks appear, in what order, which signature blocks show, with what designation label" passes this test cleanly as **Template** — none of that changes what a Principal wrote or what a subject teacher scored, only whether and how it's shown.

One precision worth adding, so this doesn't read as contradicting the ownership already assigned in the Functional Architecture document: **the signature image asset itself** (`schools.principalSignatureUrl`/`schoolStampUrl`) correctly stays owned by School Global Settings — it's a real file, potentially reusable beyond report cards, and Report Cards already correctly snapshots the URL rather than owning the image. What moves to Template Configuration is the **decision of which signature slots exist on a given layout, their order, and their designation labels** — the template says "show Principal then Deputy Principal, labeled thus," and at render time that decision resolves to whichever asset School Global Settings has on file for each. Asset storage and layout decision are two different things; your proposal is correctly scoped to the second one only.

---

## Consolidated ownership table for this document's scope

| Comment type / concern | Creates | Approves | Owns |
|---|---|---|---|
| Subject Teacher Comment | Subject teacher, during Mark Entry | New — first step of approval chain | **Assessment → Comments** |
| Class Teacher Comment | Class teacher, after subjects complete | New — second step | **Report Cards** |
| Head of Section Comment | Section head *(new field, new UI)* | New — third step | **Report Cards** |
| Principal's Comment | Principal (already role-gated today — the one exception) | Terminal step / self-approving | **Report Cards** |
| Approval chain configuration + state | School admin configures; Report Cards tracks state | N/A | **Report Cards**, engine reused from `workflow-config.js` |
| Comment Banks (picklist) | Any authorized admin | N/A | **Shared Academic Services** (`server/utils/`-equivalent layer), consumed by Assessment, Report Cards, future Behaviour |
| Which remarks appear / signature slots, order, labels | School admin, per template | N/A | **Template Configuration** |
| Signature/stamp image assets | School admin | N/A | **School Global Settings** (unchanged from the Functional Architecture document) |

This closes the comment-architecture question this review chain opened: four real types (three of which — Subject, Class Teacher, Principal — exist today in some form; Head of Section is entirely new), one real cross-cutting gap (draft-to-published carry-forward) that needs fixing regardless of ownership decisions, one existing mechanism (`workflow-config.js`) that should be reused rather than rebuilt, and one clean extension of the Template/Configuration test already established rather than a new rule.

---

## Amendment — reconciling the four-row table above with the configurable-capability model

The table above named four fixed comment types, including a specific new field for "Head of Section." That framing is superseded by a subsequent revision (Functional Architecture §11-§12): **no comment role should be hardcoded, including Head of Section** — different schools genuinely use different structures (Head of Department, Year Leader, Deputy Principal, or none of the above), and modeling one specific title as a first-class field would repeat, at the schema level, the exact "assume every school works the same way" mistake this whole review has been correcting elsewhere.

**What changes, precisely, without invalidating the evidence-tracing above:**

- **Subject Teacher Comment** — unchanged conclusion (Assessment → Comments), but reframed as a **capability toggle** (`Enable Subject Teacher Comments`), not a permanently-present field. If disabled, the field disappears from Mark Entry, Assessment stops expecting it, and Publication Policy's "require subject comments" rule (if configured) simply doesn't apply.
- **Class Teacher / Head of Section / Principal — collapse into one mechanism**: a school-configured, ordered list of report-level remark steps, each `{assigneeType, assigneeValue, label}`, executed by `workflow-config.js` under a new `workflowKey` (e.g. `report_comment_approval`), exactly as the "Approval Workflow" section above already recommended. A school with no Head of Section configures a two-step chain (Class Teacher → Principal); a school with Head of Department *and* Deputy Principal configures a four-step chain; nothing in Report Cards' code names any of these roles specifically. The "Approves" column in the table above ("New — third step," etc.) was describing a fixed three-step chain — read it instead as "however many steps this school configured, each both writing a remark and advancing the record."
- **The row-per-fixed-role table above stays useful as a worked example** (what it looks like *if* a school enables all three report-level steps) — not as the data model. The data model is one configurable list, not four named columns.

This does not change any other conclusion in this document — the draft-to-published gap, the `workflow-config.js` reuse recommendation, and the Comment-Banks-as-shared-service decision all hold exactly as stated above; only the assumption that comment *roles* are fixed is corrected.
