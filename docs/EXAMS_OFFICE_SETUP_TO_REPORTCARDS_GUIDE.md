# Msingi — Exam Office: Setup → Marks/Band Entry → Report Cards

**Audience:** Exam office staff running a term's assessment cycle end to end. This is a step-by-step walkthrough of the full pipeline, from configuring the term before any mark can be entered, through to publishing report cards. For a shorter reference on day-to-day Markbook/Review questions, see `EXAMS_OFFICER_GUIDE.md`. For the Kindergarten teacher's own entry steps in detail, see `KG_MARKLIST_GUIDE.md`.

Screen access depends on your role's permissions — some actions below may be admin-only at your school.

## The pipeline, in order

1. **Setup** — assessment types/weights, grading scale, the term's assessment schedule, and (if your school has Kindergarten) its competency templates. Nothing below this can happen correctly until setup is right for the current academic year and term.
2. **Marks / band entry** — teachers enter numeric marks (ordinary classes) or competency bands (Kindergarten) in the Markbook, per class/subject.
3. **Review** — optional moderation queue where submitted marks are approved, rejected, or locked before publish.
4. **Report Cards** — generate a preview, check it, then publish the whole class/term batch.

## Phase 1 — Setup (do this before the term's entry opens)

All of Phase 1 lives under **Exams → Configuration**.

### 1.1 Confirm the academic year and term

Before touching anything else, confirm which academic year is marked current and which term you're configuring. Every screen below is scoped by year/term — setting something up under the wrong one is the single most common cause of "my marks disappeared" reports later.

### 1.2 Assessment Types and weights

1. Open **Configuration → Assessment Types**.
2. For each type (CA, HW, Mid-Term, End-Term, or any custom type your school uses): set its **label**, its **weight %** toward the final score, how many **instances** it runs per term (e.g. 2 CATs), and a colour for the Markbook grid.
3. Weights across all active types should account for the full mark — check this before the term starts, not after marks are already in.

Changing a weight mid-term does not rewrite marks already entered; it changes how future calculations read them, so change weights between terms where possible, not mid-cycle.

### 1.3 Grading Scales

1. Open **Configuration → Grading Scales**.
2. Create or edit a named scale (e.g. "Standard KCSE", "Primary School", "Grade 6–8") with its grade boundaries: each row is a **Min %**, a **Grade** label (e.g. A+, A, B), and an optional description (e.g. "Excellent").
3. Confirm the right scale is the one actually assigned to each class/section — a class on the wrong scale will show correct marks with the wrong letter grade.

This scale is what ordinary (non-Kindergarten) subjects use to turn a percentage into a grade on the report card.

### 1.4 Assessment Schedule — opening the Markbook window

Teachers cannot enter marks for an assessment type/instance until a schedule entry exists for it. This is what "opens" that row in the Markbook for every relevant teacher at once.

1. Open **Configuration → Assessment Schedule**.
2. Add an entry: **Term**, **Type** (from 1.2), **Instance** (1st CAT, 2nd CAT, etc.), and a **From/To** date window.
3. Leave **Ask for comments** on unless this type never takes a subject comment.
4. Save, then confirm the entry appears with the right dates and an **Open** (not Locked) status.

A schedule entry with no window, or the wrong year/term, is the other common cause of "the Markbook shows nothing for this assessment" — check this screen first whenever that's reported, before assuming marks were lost.

### 1.5 Kindergarten Templates (schools with a KG/Early Years section only)

This lives under **Exams → Kindergarten Templates**, not Report Cards or Settings.

1. Choose **New Template**. Give it a name (e.g. "KG Competency Report") and optional description.
2. Assign it either to specific **classes**, or toggle it as the **section default** so it applies to every class in that section automatically.
3. Under **Performance Bands**, define the bands the whole template uses by default (label, e.g. "Excellent"; grade letter, e.g. "A"; a score value). If this template should use **band-only scoring** (teacher picks a band only — no separate number typed), turn that on here; it can also be overridden per subject below.
4. Under **Subjects**, add every subject in the assigned classes' curriculum (there's a one-click "add every subject" action once classes are assigned). A subject can override the template's performance bands or band-only setting individually if it needs to work differently from the rest of the template.
5. Save. The subject teacher will add the actual indicator wording themselves, per class/subject/term, directly in the Markbook — that part is not configured here (see `KG_MARKLIST_GUIDE.md`, section 3).

Double-check the right template is actually resolving for each KG class before the term starts — an unassigned class with no section default falls back to the ordinary numeric Markbook, which is the wrong entry mode for Kindergarten.

## Phase 2 — Marks and band entry (during the term)

### 2.1 Ordinary classes — numeric Markbook

Teachers use **Exams → Markbook**, selecting Year → Term → Class → Stream (if applicable) → Subject → Assessment type/instance, and enter a mark per student. They use the explicit **Absent / Missing / Exempt / Incomplete** states rather than a 0 where one of those actually applies — a 0 changes the average differently than an excused absence does, so check this if a class average looks wrong.

### 2.2 Kindergarten classes — competency-band entry

Same **Markbook** tab, same selectors — the screen automatically switches to band entry for a class/subject using a KG template. The teacher first lists this term's indicators, then opens each student individually to pick a band per indicator. Full walkthrough: `KG_MARKLIST_GUIDE.md`.

### 2.3 Review — the moderation queue

**Exams → Review** lists submitted marks awaiting approval, for classes/subjects where your role has visibility. Use it to approve, reject (with a reason, which reopens the grid for that teacher), or lock a submission. This queue does not store marks itself — it moderates what's already in the Markbook — so rejecting a submission never deletes anything, it only sends it back for correction.

### 2.4 When a teacher reports a missing mark or comment

Before telling them to re-enter anything:
1. Get their exact Year, Term, Class, Stream, Subject, Assessment type, and Instance.
2. Reopen that exact selection yourself and check the roster, whether a save actually went through, and whether it's locked.
3. Check the student is enrolled in that subject for that class/stream — the roster only shows active, enrolled students.
4. Check Phase 1.4 — an unconfigured or wrong-year schedule entry is a common root cause, not a lost mark.

## Phase 3 — Report Cards: preview, then publish

1. Open **Report Cards**, and select Year → Term → Class (and Stream, if your class has streams).
2. Review the on-screen preview for each student — this reads live from the Markbook, so re-check it if marks changed recently. Resolve any validation warnings shown (missing marks, unresolved moderation, etc.) before publishing.
3. Choose **Publish Report Cards**. Read the confirmation dialog carefully: publishing **locks every mark in the Markbook for the whole class and term** (not just the stream currently shown — it covers every stream in that class) and makes the report cards immediately visible to students and parents.
4. Confirm. The publish creates a dated snapshot; publishing again later for the same class/term creates a new version rather than editing the old one.

### Post-publish corrections

Once published, marks are locked. A correction requires the authorized unlock workflow (a reason is required) rather than re-entering a mark elsewhere or changing an exam's status — status changes on an `Exams` sitting never affect published report cards or locked marks. After unlocking, re-check both the Markbook and the report card before re-locking.

## Access and permissions

Exams, Markbook, Configuration, Review, Kindergarten Templates, Report Cards, and post-publication corrections can each carry separate permissions. If a step above isn't available to you, ask an administrator to check **Settings → Roles & Permissions** rather than working around it outside these screens.

**Sources:** `client/src/pages/grades/components/ConfigTab.jsx`, `client/src/pages/exams/components/RCTemplatesSection.jsx`, `client/src/pages/exams/components/IndicatorMarkbook.jsx`, `client/src/pages/grades/components/ReportCardsTab.jsx`, `server/routes/academic-config.js`, `assessment.js`, `mark-submissions.js`, `rc-templates.js`, `indicator-marks.js`, `report-cards.js`.
