# Consolidated EGM Review Report — Platform Outreach

Date: 2026-11-26
Branch: `feat/platform-outreach`
Review target: `docs/reviews/platform-outreach-implementation-target.md`
Detailed report: `docs/reviews/implementation_readiness_report.md`

## Reviewer status

| Reviewer | Status |
|---|---|
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

All three reviewers completed an initial pass and one re-audit. The first re-audit attempt was rate-limited for all three; each was retried once and completed.

## Consolidated outcome

The first review round found blockers in permission separation, queue recovery, campaign atomicity, failed-send retry, unsubscribe UX, CTA intent, and operator-copy accuracy. All known blockers were fixed in the branch.

The second review round found remaining blockers in permanent queue dedupe keys, recovery scheduling, reservation migration on email edits, and partial launch recovery. These were also fixed:

- Dedupe only reuses active jobs and replaces terminal jobs.
- Recovery runs on every queue tick even with no due jobs.
- Active reservations block email changes, and all retryable send snapshots move together.
- Launch stores expected send/lead counts and rolls back or completes stale launches based on those counts.
- `attention` is a real retryable campaign state.
- Held sends are visible and recoverable when sending is re-enabled.

## Priority actions before production sending

1. In `/platform → Outreach → Outreach settings`, configure a valid monitored Reply-To and enable sending.
2. Confirm `APP_URL` is the public HTTPS origin so unsubscribe links work.
3. In Outreach settings, supply the verified legal sender name and postal address.
4. Confirm SPF, DKIM and DMARC for the SMTP sending domain.
5. Confirm the hosted logo and `/privacy` page load over HTTPS.
6. Run a test send and visually inspect Gmail web/Android, Outlook Windows and Apple Mail at 320/375/640 px.
7. Start with a 25-school pilot and the default daily limit of 25.

## Independent PR review

The final diff received an additional independent review. Its three high-severity findings—mixed-case authorization bypass, cached lead PII after session expiry, and post-SMTP duplicate-retry risk—were fixed and covered by targeted tests. Related cancellation, email-change, held-job and sequence-retry edge cases were also tightened. No known blocker remains after that pass.

## Accepted follow-up work

1. Add MongoDB integration tests for real unique-index concurrency and crash injection.
2. Add a dead-letter/review queue with operator alerts and bulk actions.
3. Complete the ARIA tab pattern and associate all form labels.
4. Replace pasted lead IDs with a searchable multi-select.
5. Render mobile preview in a real 375 px iframe viewport.

## Live brand reference

The email palette and logo were checked against the live site with the browser on 2026-11-26. Values sampled from `https://msingi.io`:

- Brand green from live logo: `#00e898`
- Dark navy: `#0f172a`
- Indigo accent: `#4f46e5`
- Slate body/background: `#1e293b`, `#f8fafc`, `#e2e8f0`
- Live logo: `https://msingi.io/api/public/platform-asset/logo`

The email renderer uses the matching live logo, navy structure, and brand green for accent borders and primary CTA.

## Final EGM verdict

No known blocker remains. This is suitable for a controlled, gated pilot after the production preflight above. It is not yet a fully automated cross-client or high-volume mailing system; the accepted follow-up work should be scheduled before scaling beyond the pilot.
