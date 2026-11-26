# EGM Implementation Readiness Report — Platform Outreach

Date: 2026-11-26
Target: `docs/reviews/platform-outreach-implementation-target.md`
Mode: EGM Stage 9 (implementation preset)
Branch: `feat/platform-outreach`

## Reviewer status

| Reviewer | Initial | Re-audit | Status |
|---|---|---|---|
| `egm-implementation-readiness` | completed | completed after one retry | completed |
| `egm-codebase-details` | completed | completed after one retry | completed |
| `egm-style` | completed | completed after one retry | completed |

Two re-audit rounds were rate-limited by the harness. Each reviewer was retried once as required, then completed.

## Initial blocker findings and resolution

| Finding | Resolution |
|---|---|
| `outreach.send` could expose lead PII through a lead-specific test send | Test-send schema is strict and accepts only `to`; the service always renders sample data. A send-only negative route test was added. |
| Crashed send claims and queue jobs were never recovered | Queue jobs have a stale-processing reaper; outreach sends have a lease that moves stale claims to `needs_review`. Both run on every queue tick, including when the queue is empty, via a registered recovery hook. |
| Campaign launch was non-atomic and could duplicate or strand sends | Launch atomically claims `draft → launching`, reserves recipients with a unique email index, uses deduped queue jobs, stores expected send/lead counts, and rolls back sends, jobs and reservations on failure. Stale launches are reconciled or rolled back based on expected counts. |
| Cancellation/resume could be overwritten by a concurrent launch | Pause, resume and cancel use conditional status updates; `launching` is non-sendable and can be cancelled. |
| Recipient reservations were not concurrency-safe | `outreach_reservations` uses a unique email index. Conflicts are explicit skips. |
| Final failed send completed a campaign and could not be retried | Campaigns with unresolved failed/review/held sends enter `attention`; retry resumes them atomically. |
| Queue dedupe returned terminal jobs and stranded deferred sends | Dedupe only reuses active `pending`/`processing` jobs. Terminal jobs are replaced. Cap deferral and reconciliation use `enqueueSend()`. |
| Email edits left reservations and retryable sends on the old address | Email changes are rejected during an active reservation; queued, held, failed and review-required send snapshots move together. |
| RBAC scanner omitted or misreported the outreach router | Scanner now recognizes file-wide `platformSession + requirePlatformCapability`; coverage reports 100% (688/688). |

## Major findings addressed

- CTA destination now matches the promised action: `/contact`.
- Follow-up subjects no longer use a false `Re:` prefix.
- Absolute or unverified claims were softened; trust/pricing copy is configurable.
- Email footer includes a reason for contact, privacy link, configurable legal name and postal address.
- Outlook fixed-width wrapper, button VML, plain-text alternative and one-click unsubscribe headers are present.
- Unsubscribe confirmation is branded green/gold and returns HTML for browser form posts.
- Distinct recipient count and paginated, filterable send history were added.
- Times are labelled and interpreted as EAT/Africa/Nairobi.
- Modal dialog semantics, focus management and tab roles were added.
- Lead creation is an exact-email endpoint that cannot overwrite an existing lead.
- Suppression list/add/correction UI and API exist with audited reasons.
- Placeholder names and CTA protocols are validated before save/launch.
- Per-send replied/bounced/unsubscribed outcomes can be recorded from the campaign detail view.
- Demo-request IDs are validated server-side.
- SMTP connection, greeting and socket timeouts were added.
- Default templates are versioned and updated without overwriting operator-edited templates.
- RBAC release metric includes and protects every outreach endpoint.

## Independent PR review

A separate diff review against `main` found three high-severity issues. They were fixed before merge:

1. Mixed-case `/API/PLATFORM/...` URLs could bypass outreach read policy. Prefix normalization is now case-insensitive, with a viewer-role regression test.
2. Leads Open could show cached PII after a 401/403. Fallback is now limited to network/5xx failures, stale forms are read-only, and cache/modals are cleared on logout or session expiry.
3. A database failure after SMTP acceptance could downgrade a delivered send to retryable `failed`. Accepted sends now remain `sent` or become `needs_review`; they are never automatically marked retryable after acceptance.

The same review also led to fixes for cancellation reservations during in-flight SMTP, stale lead-email snapshots, held-send job churn, successor requeue after retry, and campaign completion after recovery/resume. A final recheck caught two remaining issues—401 errors lacking a status code and reservations being released after every successful send—which are now fixed. Reservations are retained for all active campaign states and released only after terminal campaigns have no in-flight sends.

## Residual findings accepted for this branch

These are not blockers for the controlled pilot, but they are tracked work:

1. No MongoDB integration tests with real unique indexes for concurrent launches, crash injection and partial enqueue failure. Current tests use stateful mocks and cover the main guards.
2. No operator-facing dead-letter queue or alerting beyond per-campaign `needs_review`/failed visibility.
3. Mobile preview uses a resized shadow root, not a true 375 px browser viewport; real-client checks remain manual.
4. Form labels are not all programmatically associated; complete ARIA tab keyboard navigation is not implemented.
5. Campaign targeting still uses pasted lead IDs copied from lead details.
6. Postal address and legal name are configurable but must be supplied in deployment configuration before sending.

## Verdict

No known blocker remains. The branch is ready for a staged pilot provided the deployment preflight is completed: configure a valid monitored Reply-To, public `APP_URL`, reachable logo, verified legal sender/postal details, SPF/DKIM/DMARC, and perform the Gmail/Outlook/mobile rendering check.

Verification evidence: focused Jest suite passed (76 tests), security scan passed, tenant ratchet passed, RBAC coverage 100% (688/688), release gate passed, desktop and mobile browser previews inspected. The Leads Open interaction was also tested with a populated detail response and with a missing detail response; the cached-row fallback keeps the form populated.
