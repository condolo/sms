# Platform Outreach

`/platform → Outreach` is a small sales workspace for prospect schools. It is intentionally separate from the school application and from transactional email.

## What it does

- Import up to 2,000 prospect contacts at a time from CSV.
- De-duplicate by normalized email address and respect the suppression list.
- Prepare branded, responsive email templates with desktop/mobile previews.
- Run a three-touch sequence with a configurable daily limit.
- Pause, resume or cancel a campaign.
- Stop future sends when a lead is marked replied, unsubscribed, bounces, books a demo or is marked not interested.
- Link a lead to the existing Demo Requests pipeline.
- Record per-recipient send outcomes and retry failed sends manually.

## Enable sending

Outreach settings are stored in the database and edited by a platform owner:

1. Open `/platform → Outreach`.
2. Select **Outreach settings**.
3. Add a monitored Reply-To address, sender identity, logo, phone, daily limit and footer details.
4. Enable **Enable outreach sending** and save.

Sending remains disabled until the database setting is enabled and the Reply-To is valid. Due emails are held safely while sending is disabled.

### Configuration checks

| Setting | Required for sending | Validation |
|---|---|---|
| Database `enabled` | Yes | Enables campaign and test sends. |
| Database `replyTo` | Yes | Must be a valid, monitored human email address. |
| `SMTP_USER` / `SMTP_PASS` | Yes | Server-side SMTP credentials; connectivity is proven by a test send. |
| `APP_URL` | Yes for unsubscribe | Must be the public HTTPS origin of this deployment. |
| Database `logoUrl` | Recommended | Public HTTPS URL reachable by mail clients. |
| Database `phone` | Optional | International format; converted to a `wa.me` link. |
| Database `dailyLimit` | Optional | 1–100; default 25. |
| Database `legalName` / `postalAddress` | Recommended | Verified sender identity shown in the footer. |
| `OUTREACH_UNSUBSCRIBE_SECRET` | Optional | Server-side signing secret; falls back to `PLATFORM_JWT_SECRET`, then `JWT_SECRET`. |

Before enabling outreach, verify SPF, DKIM and DMARC for the sending domain, confirm the Reply-To inbox is monitored, confirm the logo and privacy page load over HTTPS, and send a test email to Gmail, Outlook and a phone mail client.

For a larger or sustained cold-email programme, use a dedicated outreach domain/mailbox with SPF, DKIM and DMARC rather than the transactional sender.

## CSV format

Required columns:

```csv
school_name,email
```

Optional columns:

```csv
contact_name,phone,role,city,country,school_size,curriculum,website,source,notes
```

The importer accepts quoted commas, escaped quotes and line breaks inside quoted fields. It reports invalid rows without losing valid ones. Re-importing an existing email updates the school/contact fields while preserving its workflow status and owner.

## Permissions

Three capabilities keep sales access narrow:

- `outreach.view` — read leads, templates and campaigns.
- `outreach.manage` — import/edit leads and manage templates/campaign drafts.
- `outreach.send` — send test emails, launch, pause, resume, cancel and retry.

The built-in **Sales / Outreach** template includes all three plus read-only onboarding and school access. Existing operator roles do not gain outreach access automatically. Only platform owners can change outreach settings.

## Sending behaviour

- Default sequence: initial email, value follow-up on day 4, close-the-loop email on day 9.
- Sends are spread across weekdays between 08:00 and 16:00 Africa/Nairobi.
- The worker re-checks campaign status, lead status, suppression and the daily cap immediately before every SMTP call.
- Leads with queued sends in another active campaign are excluded from a new launch.
- Launch reserves recipients atomically so two concurrent campaigns cannot email the same school.
- Stale send leases and queue jobs are moved to `needs_review` / dead-letter rather than silently resent.
- A paused or cancelled campaign prevents a send until immediately before SMTP; a call already started may complete.
- A failed final send puts the campaign in `attention`, where it can be retried.
- A send is atomically claimed before SMTP. Failed sends are not retried automatically, avoiding accidental duplicates after an ambiguous SMTP response; an operator can retry explicitly.
- Search, add and review suppressed addresses from the Suppressions tab. Bounces and unsubscribes are recorded there automatically; corrections are audited and do not resend skipped mail.
- Open tracking is deliberately not used. Success is measured by positive replies and demos booked.

## Recommended first campaign

1. Import and clean the school list.
2. Exclude existing customers, invalid addresses and previous unsubscribes.
3. Send a test to an internal inbox and inspect it in Gmail, Outlook and mobile mail.
4. Create the default three-touch campaign for 25–30 schools.
5. Use a daily limit of 25 while using the current SMTP account.
6. Review bounces, replies and complaints before expanding to the full list.

## API boundaries

Protected endpoints live under `/api/platform/outreach/*` and use the same platform session, CSRF and capability middleware as the rest of `/platform`.

Public unsubscribe endpoints live under `/api/outreach/unsubscribe*`. Links are HMAC-signed, expire after 60 days and never expose internal lead IDs.
