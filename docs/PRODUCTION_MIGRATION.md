# Production migration runbook — messaging, report cards, demo lifecycle

**Scope:** the `feature/messaging-reportcards-demo-platform` PR (report cards,
messaging groups, demo tenants, subscription expiry, support tickets).

The short version: **there is no schema migration.** MongoDB is schemaless and
this PR is purely additive. What production needs is (1) new env vars, (2) index
creation for four new collections, and (3) a one-shot backfill so schools that
existed before the PR can generate report cards at all.

---

## 1. What actually changes in the database

### New collections (created on first write — no action needed)

| Collection | Written by | Notes |
| --- | --- | --- |
| `message_groups` | Messages → saved groups | Tenant-owned (`schoolId`) |
| `tickets` | Any signed-in school user → Support | Tenant-owned; the platform console reads it across schools |
| `demo_requests` | Public demo-request page | Platform-level registry |
| `platform_operators` | Platform console login | Named operator accounts |

Collections that already existed and are **not** re-shaped:
`messages` (new optional fields only: `groupId`, `groupName`, `isGroup`,
`recipientUsers`), `grade_boundaries`, `report_card_templates`,
`report_card_snapshots` (immutable/versioned — never rewritten),
`assessment_marks` (publish sets `isLocked`; that is a flag, not a shape change),
`report_card_draft_comments`.

### Existing documents

Nothing is rewritten, re-shaped or deleted by this PR. The only writes to
pre-existing data are:

- `assessment_marks.isLocked = true` for a class/term **when an admin publishes**
  report cards (that is the intended workflow, not a migration).
- `role_permissions` documents, refreshed on startup by the existing
  `repairPermissions` pass when a module's permission shape changes.

### Indexes (four new collections)

Added to `server/utils/indexes.js`, so they are created automatically on the next
server start. On a large production database, create them **before** the deploy
so the first boot after it is not doing index work on a live collection:

```js
// in mongosh, for each of the four collections
db.message_groups.createIndex({ schoolId: 1, createdAt: -1 }, { name: 'msggroups_school_date' });
db.message_groups.createIndex({ id: 1 }, { name: 'msggroups_id', unique: true, sparse: true });
db.tickets.createIndex({ schoolId: 1, requesterUserId: 1, updatedAt: -1 }, { name: 'tickets_requester' });
db.tickets.createIndex({ schoolId: 1, updatedAt: -1 }, { name: 'tickets_school_date' });
db.tickets.createIndex({ status: 1, updatedAt: -1 }, { name: 'tickets_status_date' });
db.tickets.createIndex({ id: 1 }, { name: 'tickets_id', unique: true, sparse: true });
db.demo_requests.createIndex({ status: 1, createdAt: -1 }, { name: 'demoreq_status_date' });
db.demo_requests.createIndex({ id: 1 }, { name: 'demoreq_id', unique: true, sparse: true });
db.platform_operators.createIndex({ email: 1 }, { name: 'platform_ops_email', unique: true, sparse: true });
db.platform_operators.createIndex({ id: 1 }, { name: 'platform_ops_id', unique: true, sparse: true });
```

(`ensureIndexes()` runs on every start and treats an existing index as
"confirmed" — creating them twice is harmless.)

---

## 2. The one real backfill: report-card defaults

A school created **before** this PR has no `grade_boundaries` document and no
`report_card_templates` document. Without the first, report-card generation
fails outright:

> `POST /api/report-cards/generate` → 400 *"No grade scale is set for this
> class's section"*

Without the second, the school falls back to the frozen `legacy_tabular`
renderer, whose **HTML** (what a card prints) and **PDF** (what a class batch
downloads) are two different documents — the printed card and the downloaded
card would never match.

The backfill fills exactly those two gaps, per school, and touches nothing else:

```bash
# 1. dry run first — reports only, writes nothing
node server/scripts/backfill-report-card-defaults.js

# 2. apply
node server/scripts/backfill-report-card-defaults.js --apply

# optional: one school only
node server/scripts/backfill-report-card-defaults.js --schoolId=sch_xxx [--apply]
```

What it does per school:

| School state | Action |
| --- | --- |
| No grade scale at all | Creates a school-wide default (KCSE A–E bands) |
| Exactly one school-wide scale, not marked default | Marks that scale as the default |
| Several school-wide scales, none default | **Nothing** — flagged for a human decision |
| No report-card template | Creates the default `subject_paired` template (print and download then match) |
| Already has templates | **Nothing** — the school's own templates are left alone |

It is idempotent: running it twice creates nothing the second time. It never
modifies published report-card snapshots — those keep the scores and the layout
they were published with. Only **future** publishes pick up the new defaults.

Exit codes: `0` = clean, `1` = one or more schools need a human decision,
`2` = script error.

---

## 3. Environment variables to set before the deploy

New in this PR (all optional except the platform ones, which the server warns
about at startup):

```bash
# Platform console (named operator) — required for /platform
PLATFORM_ADMIN_USER=platform@yourdomain.com
PLATFORM_ADMIN_PASS_HASH=$2a$10$...            # bcrypt hash, NOT the password
PLATFORM_JWT_SECRET=<64+ random hex chars>

# Demo tenant lifecycle
DEMO_TEMPLATE_SCHOOL_ID=sch_demo               # the template school to clone
DEMO_TRIAL_DAYS=7
DEMO_EXTENSION_DAYS=7
DEMO_MAX_EXTENSIONS=2
DEMO_PURGE_AFTER_DAYS=30
DEMO_SWEEP_CRON=17 * * * *                      # hourly lifecycle sweep

# Subscription expiry (opt-in — OFF by default)
ENFORCE_PLAN_EXPIRY=true                       # opt in deliberately
PLAN_GRACE_DAYS=7
PLAN_REMINDER_CRON=0 5 * * *

# Email (now provider-agnostic)
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
```

`ENFORCE_PLAN_EXPIRY` stays **off** until you want it: when on, a school past
expiry keeps every staff/ERP feature and loses only student/parent portal
access, and the **billed plan is never rewritten** by expiry.

Full list: `.env.example`.

---

## 4. Deploy order

1. **Back up the production database** (the app has a backup route; a mongodump
   is fine).
2. Run the **dry-run backfill** and read the report. Resolve any school it
   flags as needing a decision.
3. Create the **four new collections' indexes** (section 1) if the production
   database is large enough that you would rather not build them during a
   deploy.
4. Set the **env vars** (section 3) and restart the service once so the
   platform operator exists:
   ```bash
   node scripts/create-platform-operator.js --name "Owner" --email platform@yourdomain.com --tier owner
   ```
5. **Deploy the server** first. It is backwards compatible: every new route is
   additive, and no existing route changes shape. Old clients keep working.
6. **Deploy the client** second (it calls the new group/support/demo endpoints).
7. Run the **backfill with `--apply`** if you did not already.
8. Optionally seed the demo school so it is reviewable end to end:
   ```bash
   npm run seed:data        # demo school only (sch_demo), insert-only
   ```
   It is idempotent and never touches another school.

---

## 5. Post-deploy verification

```bash
curl -s https://<host>/api/health                      # 200
```

Then, as a school admin:

- **Report Cards** → pick a class and term → the cards generate (grades,
  ranking, class average) and the strip under the selectors reads either
  *Not published* or *Published · v1 · …*.
- **Publish Report Cards** → **Print Class** → one document, one page per
  student, each page identical to that student's own **Print**.
- **Messages** → create a group, send to it, reply.
- **Support** → raise a ticket as a parent (any signed-in user can).
- As platform operator: `/platform` → demo requests, support queue, tenants.

---

## 6. Rollback

- **Revert the deploy.** The new collections stay in the database but nothing
  reads them on the old code — they are inert.
- The backfill is reversible by hand: delete the documents it created
  (`grade_boundaries` with `createdBy: 'backfill-report-card-defaults'` and
  `report_card_templates` with the same marker). Schools that already had their
  own scale/template were never touched.
- Published report cards are versioned and never deleted, so a rollback does
  not lose any published result.
- If you enabled `ENFORCE_PLAN_EXPIRY`, turn it off first — it is the only
  behaviour in this PR that changes what an existing school can reach, and it
  is a single env flag.
