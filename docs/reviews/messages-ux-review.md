# Messages UX Review — Live Demo, Four Roles

Audited 2026-11-17 on `demo.msingi.io` with the deployed bundle.
Accounts exercised: Demo Admin, Demo Teacher, Demo Parent (Demo Parent / Amara Osei), Student (Amara Osei).
Evidence: browser snapshots and screenshots at desktop and 390 px mobile; network capture of `/api/messages` and `/api/student-portal`; server tests.

Severity: **Blocker** means a core task cannot be completed or the server state is wrong; **Major** means a user is misled or hits high friction; **Nit** means polish.

## What was broken

### 1. A read action required an edit permission (P0)

`PATCH /api/messages/:id/read` and `/read-all` required `messages:update`. The module's sub-permission keys are `messages__view`, `messages__send`, `messages__delete` and `messages__moderate`; the API action for View is `read`. No role can hold `messages:update`, so a parent or student with View but not Send got:

> 403 — Your role does not have 'update' permission on 'messages'

The UI had already marked the row read locally and decremented the parent's unread count, but the server never recorded it. The bell kept the old count. Observed live: inbox showed **4 unread**, bell showed **5**.

Fixed: both routes now require `messages:read`. Marking a message you can read is part of reading it, not editing it.

### 2. Students had no inbox (P0)

The student sidebar's **Messages** item and the bell's **View all messages** both scrolled to the **Announcements** panel. The backend already exposed `/api/student-portal/inbox` and `/threads/:id`, but no UI used them. A teacher's reply existed in the database and nowhere on the student's web screen. The student could send a message and then had no way to read the answer.

Fixed: the student Messages section now has Inbox and Announcements tabs, unread rows, a thread modal and a reply box using the existing routes. Opening the section or the bell lands on Inbox.

### 3. The unread cache caused cross-instance stale badges (P0)

A 20-second in-process cache was added to `/api/messages/unread-count`. Render runs multiple instances; a read handled by instance A could not invalidate instance B's cache. The bell stayed stale for the whole TTL after a message was read. Verified live: the database already had `isRead.<user> = true` while the endpoint returned `cached: true` with the old count.

Fixed in `4e10906`: cache removed. The count query uses the `messages_recipients_date` index and a single `$in` inbox query; no in-process count cache remains.

### 4. Parent optimistic read diverged from the server (P1, fixed)

Parent reading was optimistic and swallowed the 403. Local count went down, server count did not. It now rolls both the row and the family count back if the write fails.

### 5. Sent detail said “Your inbox, minus the noise” (P2, fixed)

The Sent tab reused the inbox empty-state copy. It now distinguishes “Nothing sent yet” from “Pick a sent message.”

### 6. Compose Send button was covered by the floating help bubble (P2, fixed)

At 1536 × 730 the fixed help FAB overlapped the right side of **Send message**. The footer now reserves bottom space.

## Remaining UX findings

### Inbox noise and duplication (P1)

- Parent inbox for Amara contained roughly 15 “Form 1A … has changed” timetable notifications in a row, plus duplicate “Marks submitted for review” for the same subject and duplicate daily attendance summaries. “Your inbox, minus the noise” is not true.
- The parent header shows one selected child, but the inbox includes messages about siblings Brian and Faith. Either filter to the selected child or label the inbox as family-wide and show the child on each row.
- Opening the admin inbox shows two identical “Kiswahili — Form 1A: MT marks…” rows and two identical “Daily Attendance Summary — 2026-09-21” rows.

Recommendation: group system notifications by type and day, or give them a separate System tab and keep the default inbox human-to-human. Deduplicate by `(type, subject, studentId/classId, date)` at write time.

### Compose ambiguity (P1)

- In Direct mode the audience chips **Everyone / Staff / Parents / Students** sit above a name search. They look like broadcast audiences but are filters. In Announcement mode the same words become real audiences. This is a mode-dependent meaning for identical controls.
- Searching “Demo Teacher” worked after a debounce, but the empty field initially showed all 30 people with no grouping. The same person appears twice as “Collins Ndolo — Teacher” and “Collins Ndolo — Principal” (two accounts or a duplicated projection). A sender cannot tell whether this sends twice.
- Admin Compose has Direct / Announcement / Saved group. Teacher Compose also has **Class & staff**. The option set changes silently by role.
- The staff Compose drawer is 650 px wide with a large header and a footer pushed up by the help FAB; on mobile it is usable but dense.

Recommendation: remove the audience chips from Direct mode and replace them with a single “Filter people” segmented control. Group duplicate people by email/user id and show all roles on one row. Make the available modes explicit in the UI and keep the same tab set across roles where the underlying API allows it.

### Navigation inconsistency (P1)

| Role | Tabs shown |
|---|---|
| Admin | Inbox, Sent, Groups |
| Teacher | Inbox, Sent, Chats, Groups |
| Parent | Inbox, Sent, Chats |
| Student | Inbox, Announcements (new) |

Chats exists for teacher and parent but not admin; Groups exists for admin and teacher but not parent; student gets announcements instead of Chats. Some of this is justified by permissions, but nothing explains it. A user switching roles sees a different product.

Recommendation: define one canonical tab set and hide a tab only when the role truly cannot use it. Put the reason in the UI (“Groups are available to staff”) rather than silently changing the navigation.

### Scale and pagination (P1)

- Staff MessagesPage requests `limit: 100` and renders all rows in one list. There is no “Load older” and no virtualization. Parent has “Load older messages”; staff does not.
- The staff list returns full message bodies for 100 messages; a long announcement is downloaded even when the row only shows a preview.
- Students and parents cap at 20 with a load-older button; staff should behave the same.

Recommendation: page staff inbox at 30, add load-more or virtualization, and return a body preview for list rows. Load the full body only when a thread is opened.

### Empty, loading and failure states (P2)

- Staff detail pane does not auto-select the first unread conversation; desktop users see a large empty pane on arrival.
- Student thread modal has loading and error states, but no retry action.
- Mark-all-read has no confirmation and no undo. On a shared staff account an accidental click clears every badge.
- No “mark unread” action, no forward, no bulk selection.
- System messages expose internal IDs (`cls_demo_f1a`, `u_demo_t3`) instead of class/teacher names.

### Accessibility and interaction (P1)

- The parent/student compose modals have visual labels but no `htmlFor`/`id` association. In the accessibility tree the inputs are announced as “textbox”, not “Subject” or “Message”.
- The student compose dialog close button has no accessible name.
- The staff thread header uses two icon-only reply arrows with no visible labels or accessible names.
- New modals use `role="dialog"` and `aria-modal`, but there is no focus trap, no Escape-to-close, and focus is not returned to the opener.
- Small muted text (`text-slate-400` at 10–11 px) is below comfortable contrast on white; important metadata such as timestamps and unread counts is easy to miss.
- Buttons that open a thread are full-row `<button>` elements, which is good; nested interactive elements inside them must be avoided.

### State and deep links (P2)

- Selected thread, active tab and filters live only in component state. Refreshing loses the conversation; a link cannot be shared to a thread.
- The bell fetches a separate list of 8 and the Messages page fetches its own list; read state is reconciled by events, not by a shared cache. This is how the parent count and bell diverged.
- Announcements have no read state but are labelled “new” based on count.

## EGM reviewer findings (added after the live pass)

Reviewers: `egm-design`, `egm-comprehension`, `egm-style`, `egm-implementation-readiness`.
The reviewers read a workspace mirror of the code; the authoritative checkout was outside their sandbox. Their comments on the document and on the stale mirror are separated below from findings verified against the live deploy.

### Blocking gaps the first pass did not catch

- **There is no conversation/thread model.** `POST /api/messages` creates a new document per reply; there is no `threadId` or `inReplyTo`. Staff inbox therefore shows each reply as a separate row, and unread count grows per reply rather than per conversation. The student inbox groups by counterpart in the UI, but the underlying model still has no thread identity. Decide the model before adding thread polish.
- **Parent context is not stored on the message.** Compose resolves recipients against the active child, but the created document has no `childId` and the modal does not name the child. With multiple children, a reply sent from the bell is ambiguous.
- **System notifications are written as `type: 'direct'`.** There is no `kind: 'system'` discriminator, no student/class linkage and no dedupe key on the message document. The recommended grouping/backfill cannot be implemented without a schema decision and a migration. Existing duplicate rows must be cleaned before a unique index is possible.
- **Audience groups omit roles they claim.** `teachers` excludes `deputy`; `staff` excludes `deputy` and custom staff roles. Overlapping audiences (`['all','teachers']`) resolve independently in the email loop and can email the same person twice. `teacher` is in `BROADCAST_ROLES`, so any teacher can fan out to every account with no per-sender cap.
- **Portal-sender guard is enum-based.** A custom role built on the parent base is not in `PORTAL_ROLES`, so the “parents may only message staff” invariant does not hold for custom roles.
- **Staff pagination needs a contract.** There is no single-message read endpoint; the list currently carries full bodies. Choose either `GET /messages/:id` with inbox-membership authorization or an explicit `preview=1` payload, and keep mobile/portal consumers in mind.
- **Recipient dedupe cannot be solved in the client.** `/messages/recipients` projects only `id name role`; email is deliberately excluded. Server-side canonicalization (or an opaque `personKey`) is required before grouping duplicate people.
- **No E2E stack exists.** The repository has Jest + Supertest, not Playwright. “Add cross-role E2E” includes choosing the runner, fixtures, multi-role auth and CI wiring.

### EGM reviewer status

| Reviewer | Status | Note |
|---|---|---|
| egm-design | completed | Independent code critique; some findings reflect the pre-fix worktree mirror (student inbox, read-all, cache) and were checked against the live deploy before inclusion. |
| egm-comprehension | completed | Flagged undefined `messages:read` vs View naming, contradictory accessibility claims and unsupported performance/verification claims; addressed in this revision. |
| egm-style | completed | Targeted wording edits; the substantive ones are incorporated. |
| egm-implementation-readiness | completed | Confirmed the schema/thread/pagination/dedupe gaps above and the missing E2E stack. |

## Best-practice verdict

The new surfaces follow the existing visual language and cover the critical paths, but they are **not yet best practice end to end**.

Good:
- Consistent paper/white cards, violet primary actions and compact typography.
- Inbox rows expose sender, subject, preview, date and unread state.
- Empty, loading and error states exist for the new student inbox.
- New controls are semantic buttons; the new student thread modal has `role="dialog"`, `aria-modal`, an accessible close label and a labelled reply box. The older parent/student compose modals still lack field associations (see Accessibility).
- Mobile layout at 390 px keeps the inbox usable; the sidebar becomes a drawer.

Still below best practice:
- One-off modals instead of a shared Dialog primitive with focus trap, Escape, scroll lock and focus return.
- Data duplication and system-event noise are not solved at the source.
- Role-based navigation changes without explanation.
- No pagination/virtualization for staff and no URL-addressable thread state.
- Permission semantics are inferred from module names rather than modelled explicitly.
- No UI test suite covers cross-role messaging; this review found the read-permission and student-inbox gaps only by driving the live UI.

## Priority order for the next pass

1. **Message taxonomy and schema.** Add `kind: 'system' | 'human'`, `studentId`/`classId` linkage where applicable, and an explicit `inReplyTo`/`threadId` decision. Backfill or dedupe existing duplicate system rows before adding any unique index.
2. **Parent context and system-noise grouping.** Store/display the child on every parent message; group or separate automated timetable/attendance/marks events by event key and day.
3. **Staff pagination with a read contract.** Add a single-message endpoint or preview payload, page at 30, and load bodies only when a thread opens.
4. **Accessibility primitives.** One shared Dialog (focus trap, Escape, scroll lock, focus return), label associations for all compose fields, labelled icon-only actions, and measured WCAG 2.2 AA contrast.
5. **Canonical navigation.** One tab set, with explicitly unavailable states rather than silently different role menus.
6. **Recipient canonicalization.** Server-side merge by person with all roles shown, plus defined send semantics for duplicate account records.
7. **Read-state actions and undo.** Add `PATCH /:id/read {read:boolean}`, a batch read-all route, forward with the portal recipient policy, and an undo path for mark-all.
8. **Cross-role E2E.** Choose a runner (Playwright or the existing stack), seed a multi-role tenant, and cover send → receive → open → read → reply → badge sync in two browser contexts.

## Verification status

- Live E2E completed for admin → teacher (send, open) and student (inbox, thread, reply, read, bell count cleared).
- Parent read was verified against the server count after the cache removal; the bell delta event was added after the live pass and still needs a final deployed check.
- Server tests: `messages-unread-count.test.js` (3 tests), messages/portal suites, teacher overview regression, attendance probe, index migration safety.
- The EGM reviewers did not have access to the authoritative checkout; their code references are to the worktree mirror and are labelled as such.
