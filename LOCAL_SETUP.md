# Local Development Setup (Windows)

This project is already set up on this machine. Everything below is what was
installed/configured, so you can reproduce it or run it again.

## Prerequisites

- Node.js >= 18 (tested with v22)
- No system MongoDB, SMTP server, or cloud account is required. The two local
  dev services below are plain Node scripts that use packages already in the
  repo.

## Run it

Terminal 1 — local MongoDB (port 27017, data persisted in `.local-mongo/`):

```powershell
npm run db:local
```

Terminal 2 — local SMTP sink (port 1025, mail written to `.mail/`):

```powershell
npm run mail:dev
```

Terminal 3 — API + built React app (port 3005):

```powershell
npm start
```

Open http://localhost:3005

For React hot-reload instead of the built bundle:

```powershell
npm run dev          # API on :3005
npm run dev:react    # Vite on :5173 (proxies /api to :3005)
```

Rebuild the client after pulling changes:

```powershell
npm run build:react  # or: cd client && npm run build
```

## Demo logins (school code: `demo`)

| Role              | Login                      |
| ----------------- | -------------------------- |
| Administrator     | admin@demo.msingi.io       |
| Deputy Principal  | principal@demo.msingi.io   |
| Teacher           | teacher@demo.msingi.io     |
| Finance Officer   | finance@demo.msingi.io     |
| Parent            | parent@demo.msingi.io      |
| Student           | demo-student               |

Password for all: `Demo2025!`. The demo school and users are re-seeded on every
server start (note: this also resets any password you changed on a demo user).

Those six are the role entry points. **[DEMO-SCENARIOS.md](DEMO-SCENARIOS.md)**
is the persona sheet: nine student logins and nine parent logins — a parent with
two children in different classes, one with no child linked, profiles walking
attendance, fees, sections and coverage, plus the teacher accounts — each one
there to prove a state the screens branch on. `npm run seed:scenarios` builds the
whole thing, and that file's last section lists the read-path defects found while
verifying it.

## Platform console (`/platform`)

A named owner-tier operator is provisioned in MongoDB:

- username: `platform@local`
- password: **not stored here** — it lives in your untracked `.env` as
  `PLATFORM_OPERATOR_PASSWORD`. Never paste a real password into a
  tracked file (this repository is public).

Once an operator exists, the legacy `PLATFORM_ADMIN_USER` /
`PLATFORM_ADMIN_PASS_HASH` env credential is no longer accepted. Create more
operators or rotate the password with:

```powershell
node scripts/create-platform-operator.js --name "Someone" --email someone@msingi.io --tier owner
node scripts/create-platform-operator.js --email platform@local --reset-password
```

## Email

`server/utils/email.js` talks to any plain SMTP server. For local development
`.env` points at `scripts/dev-mail.js`:

```
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_USER=dev@msingi.local
SMTP_PASS=dev-password
PLATFORM_EMAIL=dev@msingi.local
```

Every message the app sends (invites, password resets, receipts, contact-form
enquiries) is accepted and written to `.mail/*.eml`. Open the files in any mail
client, or read the subject/recipient lines in the `npm run mail:dev` output.

To use a real provider instead, replace those five values with e.g. Gmail
(`smtp.gmail.com`, port 587, an App Password — not the account password) and
restart the server.

## Captcha (contact form)

The marketing contact form uses Cloudflare Turnstile. Local dev uses
Cloudflare's official always-pass test keys:

```
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA          # server
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA                  # client/.env, build-time
```

Replace both with real Turnstile keys before deploying; the client must be
rebuilt for a new site key to take effect.

## Backups

Nightly encrypted backups run to local disk (`backups/`) in development —
verified working. For production, set `BACKUP_S3_BUCKET`,
`BACKUP_S3_REGION` plus `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (and
`BACKUP_S3_ENDPOINT` for R2/B2/Spaces). `BACKUP_ENCRYPTION_KEY` is already
generated in `.env` — never change it once backups exist.

## Not configured (needs real credentials)

These integrations degrade gracefully (feature hidden or request rejected)
until real values are added to `.env`:

| Integration            | Env vars                                                        |
| ---------------------- | --------------------------------------------------------------- |
| Google sign-in         | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                      |
| Microsoft sign-in      | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                |
| M-Pesa STK push        | `MSINGI_MPESA_CONSUMER_KEY`, `MSINGI_MPESA_CONSUMER_SECRET`, `MSINGI_MPESA_PASSKEY`, `MSINGI_MPESA_SHORTCODE`, `MSINGI_MPESA_ENV` |
| Zoom meetings          | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET` |
| Error reporting        | `SENTRY_DSN`                                                    |
| Ops alerts             | `ALERT_WEBHOOK_URL`                                             |

Optional toggles: `ALLOW_IMPERSONATION=true` enables platform impersonation
locally (off by default, and disabled in production regardless).

## Environment file

`.env` (git-ignored, generated from `.env.example`) contains:

- `MONGODB_URI=mongodb://127.0.0.1:27017/innolearn`
- generated `JWT_SECRET`, `PLATFORM_JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`
- local SMTP + Turnstile test keys as above

## Checks

```powershell
npm test                                       # full Jest suite (DB mocked)
Invoke-WebRequest http://localhost:3005/api/health
```

## Demo requests, expiry and tickets

Anyone can request a demo at `/demo`. The flow is:

1. form + Turnstile (rate limits: 3 per IP/day, 1 per email/24 h)
2. 6-digit email OTP (10-min TTL) — no tenant exists before this
3. auto-provision: a new school is cloned from the template tenant, given
   unique logins, and emailed to the requester
4. lifecycle emails at 3 days, 2 days and 1 day left, then expiry
5. after expiry the tenant is read-locked for 30 days, then purged

Demo tenants are normal `schools` rows with `isDemo: true` and an
`expiresAt`. Expiry is enforced in `tenantMiddleware` (login) and
`authMiddleware` (every request) plus an hourly sweep, so it is never a
UI-only lockout. Demo tenants also cannot send outbound email to third
parties (`_sendAsSchool` suppresses it).

Settings (`.env`):

```
DEMO_TEMPLATE_SCHOOL_ID=sch_demo   # tenant cloned for each demo
DEMO_TRIAL_DAYS=7
DEMO_EXTENSION_DAYS=7
DEMO_MAX_EXTENSIONS=2
DEMO_PURGE_AFTER_DAYS=30
DEMO_REQUIRE_REVIEW=false          # true = manual approval queue
```

Operations live in the platform console (`/platform`, owner tier):

- **Demo Requests** — pipeline, approve/reject, extend +7 days, open tenant
- **Support Tickets** — one ticket is auto-created per demo request; reply,
  add internal notes, change status. To notify requesters, reply from your
  normal mailbox — ticket messages are console-internal by design.

> The template tenant must exist in the database you point at. In production
> the demo seeder is skipped, so provision/seed the template once and set
> `DEMO_TEMPLATE_SCHOOL_ID` before enabling `/demo` publicly.

## Support tickets (any user)

Any authenticated school user — admin, teacher, finance, parent or student —
can open and follow a ticket at **`/support`**:

- Staff: Help Centre → “Contact support”, or the URL directly.
- Parents and students: the life-buoy icon in their portal sidebar.

Each user sees only their own tickets. Operator replies are visible and
emailed; **internal notes are filtered out server-side** and never reach the
requester. A requester reply reopens a resolved/waiting ticket; closed tickets
are read-only. Limits: 5 new tickets/day and 30 replies/hour per user.

On the platform side, `/platform → Support Tickets` shows every ticket with
requester role and school, and is where replies/status changes happen. A
public operator reply moves an open ticket to “awaiting reply” and emails the
requester (skipped for demo tenants).

## Subscription expiry

Billing is per active student per term (Base 250 / Student 300 / Family 350
KES). An invoice is snapshotted at term start and never rewritten by a later
plan change.

Expiry is enforced separately from the billed tier:

```
ENFORCE_PLAN_EXPIRY=true   # opt-in; default off
PLAN_GRACE_DAYS=7          # grace after planExpiresAt before restriction
PLAN_REMINDER_CRON=0 5 * * *   # daily reminder sweep
```

When enforcement is on and a school is past `planExpiresAt` (or `trialEnds`
when no plan date was ever set) plus the grace period:

- every staff/ERP feature keeps working;
- student and parent portal logins return `403 PLAN_EXPIRED`;
- the billed plan is **not** changed — downgrading is a platform-console
  decision, not an expiry side effect;
- Settings → Subscription and the staff shell show "Subscription expired —
  renew"; admin/teacher logins stay open so the school can pay.

The daily sweep emails 30/14/7/1/0-day notices (once per threshold) and one
expiry notice, and audit-logs the expiry/restriction. Clearing
`planExpiresAt` (blank in Change Plan) means "no expiry" and does not fall
back to an old trial date.

## Production switch (when the prod DB credentials arrive)

No schema migration is needed. On boot the server connects, creates/confirms
every index (`ensureIndexes`), and self-heals role permissions and org/
membership/identity backfills. Switching consists of changing env values:

1. **Database**
   ```
   MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/...
   MONGODB_DB_NAME=innolearn          # leave as-is unless intentionally migrating
   ```
2. **Mode / URLs**
   ```
   NODE_ENV=production
   APP_URL=https://<your-domain>
   ALLOWED_ORIGINS=https://<your-domain>     # optional; msingi.io origins are built in
   ```
3. **Secrets** — keep `BACKUP_ENCRYPTION_KEY` stable once the first backup
   exists; changing it makes every existing backup unreadable. `JWT_SECRET`,
   `PLATFORM_JWT_SECRET` and `PLATFORM_ADMIN_PASS_HASH` must be fresh values,
   not the local ones.
4. **Platform access** — either set `PLATFORM_ADMIN_USER` /
   `PLATFORM_ADMIN_PASS_HASH` / `PLATFORM_JWT_SECRET`, or create a named
   operator in the production DB:
   ```
   node scripts/create-platform-operator.js --email you@example.com --tier owner
   ```
5. **Real services**
   - SMTP: replace the local sink values with the provider's host/port/user/pass.
   - Turnstile: real site + secret keys, then rebuild the client.
   - Backups: `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `AWS_ACCESS_KEY_ID`,
     `AWS_SECRET_ACCESS_KEY` (+ `BACKUP_S3_ENDPOINT` for R2/B2/Spaces).
6. **Leave unset:** `ALLOW_DEMO_SEED` (demo seeding is skipped automatically in
   production) and `ALLOW_IMPERSONATION`.
7. **Billing enforcement:** once invoices are live, set
   `ENFORCE_PLAN_EXPIRY=true` (and tune `PLAN_GRACE_DAYS`). Until then the
   expiry date is informative only — portal tiers are still gated, but an
   expired date does not restrict access.

Then rebuild and start:

```powershell
npm run build:react
npm start
```

Smoke-test after the switch: `/api/health` must report `"db":"connected"`,
`/platform` login must work, and one school login must load its dashboard.
