# EGM Review — Messages UX

Target: `docs/reviews/messages-ux-review.md`
Date: 2026-11-17
Reviewers: `egm-design`, `egm-comprehension`, `egm-style`, `egm-implementation-readiness`

## Review status

| Reviewer | Status | Scope |
|---|---|---|
| egm-design | completed | Hostile design critique of the messaging UX and priorities. |
| egm-comprehension | completed | Naive-reader understanding of the review document. |
| egm-style | completed | Targeted clarity and precision edits. |
| egm-implementation-readiness | completed | Actionability, dependencies and migration risk of the proposed fixes. |

All four reviewers completed. The first dispatch failed because the target file was outside the reviewer sandbox. The review document was copied into the workspace and the reviewers were re-dispatched. Reviewer code references therefore come from the worktree mirror, not the authoritative checkout; findings that depended on the stale mirror were checked against the live deployment before inclusion here.

## Blocker findings

### B1 — No conversation/thread model

`POST /api/messages` creates a new message document per reply. There is no `threadId` or `inReplyTo`. The staff inbox shows each reply as a separate row; unread count grows per reply, not per conversation. The student inbox groups by counterpart in the UI, but the data model has no thread identity.

Action: decide the thread model before further thread UI. Add `threadId` or `inReplyTo` (and a migration/backfill) or explicitly document that messaging is message-based, not conversation-based.

### B2 — System notifications have no taxonomy or linkage

System notifications are written with `type: 'direct'`. There is no `kind: 'system'`, no `systemEventKey`, and no `studentId`/`classId` linkage. The proposed dedupe key `(type, subject, studentId/classId, date)` cannot be computed from current documents. Existing duplicates (timetable changes, marks submitted, attendance summaries) cannot be grouped or made unique without a schema decision and a backfill.

Action: define `kind`, event key and entity linkage; write a one-off dedupe/backfill for existing rows; only then add a unique index.

### B3 — Parent messages lose the child context

Compose resolves recipients against the active child, but the created message does not store `childId`, and the modal does not name the child. With multiple children, a reply from the bell is ambiguous and the teacher cannot tell which child is meant.

Action: store `childId` on parent-originated messages and show the child in the compose/reply UI and message detail.

## Major findings

### M1 — Audience groups omit roles and overlap

- `ROLE_GROUPS.teachers` excludes `deputy`; `staff` excludes `deputy` and custom staff roles.
- `['all', 'teachers']` resolves each audience independently in the email loop and can email the same teacher twice.
- `teacher` is in `BROADCAST_ROLES`, so any teacher can broadcast to every account with no per-sender cap.

Action: make audience membership exhaustive and mutually deduplicated; resolve to a unique user set before notifications; set a broadcast policy/cap by role.

### M2 — Portal-sender guard is enum-based

`PORTAL_ROLES.has(role)` misses custom roles built on a parent/student base, so a custom portal role can message another parent. Use one shared `isPortalUser()` predicate driven by the role base, not a literal enum.

### M3 — Staff pagination needs a read contract

The staff list requests 100 full messages; there is no single-message endpoint. Pagination alone leaves the full-body payload problem. Choose:

- `GET /api/messages/:id` with inbox-membership authorization and 404 for non-recipients, or
- an explicit `preview=1` list payload plus a detail call.

Specify preview length, whether Sent and quick reply still receive `body`, and page vs load-more.

### M4 — Recipient dedupe needs server canonicalization

`/messages/recipients` returns only `id`, `name`, `role`; email is deliberately excluded. The duplicate “Collins Ndolo — Teacher / Principal” rows cannot be safely merged in the client. Decide server-side canonicalization (opaque `personKey` or merged person projection) and the send semantics for duplicate account records.

### M5 — No cross-role E2E stack

The repository has Jest + Supertest, not Playwright. Adding cross-role E2E includes choosing the runner, fixtures, multi-role auth, seeded tenant and CI wiring.

### M6 — Document verification gaps

The initial review claimed six fixes without naming the verification step or commit. Revision adds commit references and live-E2E notes. The EGM reviewers could not verify the authoritative checkout, so the “fixed” claims are based on the live browser pass and the commits, not reviewer code inspection.

## What the first pass fixed

| Fix | Commit | Verified |
|---|---|---|
| Mark read/read-all now require `messages:read`, not `update` | `8337912` | Student and parent reads clear the badge live; 403 no longer reproduced. |
| Student inbox with threads and reply | `8337912` | Live: inbox rows, thread modal, reply, read, bell clears. |
| Remove cross-instance unread cache | `4e10906` | Live: `/unread-count` returns no `cached` flag; count is correct after read. |
| Parent optimistic rollback | `8337912` | Unit/logic; live read succeeded. |
| Sent empty state | `4e10906` | Live: “Nothing sent yet” / “Pick a sent message.” |
| Compose FAB overlap | `8337912` | Staff compose footer reserves space; retest after final deploy. |
| Student/parent compose labels | `3bf19f3` | Built; live accessibility tree retest pending final deploy. |
| Bell local delta sync | `3bf19f3` | Built; live retest pending final deploy. |

## Revised priority

1. Message taxonomy and schema: `kind`, event key, child/class linkage, thread decision, backfill.
2. Parent child context and system-noise grouping.
3. Staff pagination plus single-message/preview contract.
4. Shared Dialog and form accessibility.
5. Canonical navigation per role.
6. Recipient canonicalization.
7. Read/unread actions, forward and undo.
8. Cross-role E2E harness.

## EGM verdict

The first pass fixed the blocking user-facing defects and gave students a usable inbox. The product is not yet at the standard the UI claims: the data model cannot support conversation grouping, parent/child context, or system-notification deduplication. Those are schema decisions, not visual polish. The next pass must start there; otherwise the inbox will keep recreating noise and ambiguity at the UI layer.
