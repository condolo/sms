# Msingi — Changelog

All notable changes to Msingi (formerly InnoLearn) are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [v4.90.0] — 2026-07-20 — fix(billing): platform admin is now the sole authority over a school's plan tier

Follow-up to v4.89.0's finding: `POST /api/mpesa/subscription` let a school admin pick any tier in Settings and pay for it, silently overwriting whatever plan platform admin had set — a second, uncoordinated writer to `schools.plan`. Asked directly which model was intended; the answer: platform admin should be the sole authority. Implemented that decision.

### Changed

- `server/routes/mpesa.js`'s `POST /subscription` no longer reads a tier from the request body at all. The tier being charged for is now derived server-side from the school's own current `plan` field — a client can only ever pay for the tier platform admin already set, never select a different one. A school on Enterprise (no self-service rate) or with no plan set gets a clear 400 pointing at platform admin/sales instead of a fabricated charge.
- `client/src/pages/settings/SettingsPage.jsx`'s `SubscriptionTab` — the "Choose a Portal Tier" clickable picker is now a read-only comparison (the school's current tier is labeled "Your Plan"; the copy tells the admin to contact platform admin to change tier). The M-Pesa payment section pays for the current tier only and is hidden entirely for Enterprise schools, which have no self-service rate.

### Tests

- `server/__tests__/routes/mpesa-subscription-plan-authority.test.js` (new) — a client-supplied `tier`/legacy `plan` is ignored in favor of the school's real stored plan (both the charged amount and the transaction record reflect the real plan); Enterprise and no-plan-set both reject cleanly. Mutation-tested: reverting the server fix fails all 4 tests.
- Full suite: 46/46 suites, 500/500 tests. `node scripts/security-scan.js` and the tenant-isolation ratchet (held at 34) both clean.
- Client bundle verified to compile cleanly (Vite dev transform of the edited file returns 200). Full click-through wasn't possible in this sandbox (no live MongoDB).

---

## [v4.89.0] — 2026-07-20 — feat(platform): rename school/organization (name only) + fix stale plan display in school Settings

### Added — school/organization rename

Platform admin previously had no way to correct a school or organization name once set (e.g. a typo like "SChool" instead of "School"). The URL slug is intentionally never editable — it's fixed at provisioning time and used for tenant resolution.

- `server/routes/platform.js` — `PATCH /schools/:id` now also accepts `name`; new `PATCH /organizations/:id` accepts `name` only. Both silently ignore any `slug` in the request body.
- `platform.html` — "Rename" action added next to each school and organization row.

### Fixed — Settings → Subscription tab showing a stale plan

A school admin viewing Settings could see a plan that didn't match what platform admin had actually set — `session.school.plan` is a snapshot cached at login time and was never refreshed while the session stayed open, so a plan change made from platform admin was invisible to an already-logged-in admin until they logged out and back in.

- `client/src/pages/settings/SettingsPage.jsx`'s `SubscriptionTab` now fetches the live school record (`GET /api/settings/school`, already existed) on mount and patches the session if `plan`/`planExpiresAt` differ from the cached value — same live-refresh problem class as the impersonation session bug fixed in v4.88.0, this time affecting every school-admin session, not just impersonation.

### Note — self-service plan changes are a separate, real write path (not touched here)

Confirmed while investigating the above: `POST /api/mpesa/subscription`'s payment callback (`server/routes/mpesa.js`) writes `schools.plan` directly from whatever tier the school admin selected in this same Settings tab — a second, independent path to the same field platform admin's "Change Plan" action writes, with no reconciliation between the two. This is a real design question (should self-service payment be able to override a platform-set plan at all?), not a bug fix — flagged for a decision, not resolved in this release.

### Tests

- `server/__tests__/routes/platform-rename.test.js` (new) — 8 tests: both routes update `name`, both silently ignore an attempted `slug` change, 400 on empty/missing name, 404 for an unknown id.
- Full suite: 45/45 suites, 496/496 tests. `node scripts/security-scan.js` and the tenant-isolation ratchet (held at 34) both clean.
- Client bundle verified to compile cleanly (Vite dev transform of the edited file returns 200, no parse/transform errors) — full click-through of the Subscription tab wasn't possible in this sandbox (no live MongoDB).

---

## [v4.88.0] — 2026-07-20 — fix(security,platform): HSTS preload eligibility + impersonation session missing school data

Two independent fixes triggered by real usage: an external security scan (UpGuard) of msingi.io, and a platform admin actually using impersonation for the first time and noticing the plan badge showed a plan the school isn't on.

### Fixed — HSTS not meeting preload-list threshold

`helmet()`'s own default `hsts` config (180 days, no `preload` directive) was below what hstspreload.org requires (1 year minimum, `includeSubDomains`, `preload`) — external scanners flag this as "HSTS not enforced" even though the header was already present.

- `server/index.js` — `helmet()`'s `hsts` option set explicitly: `maxAge: 31536000` (1 year), `includeSubDomains: true`, `preload: true`.
- Everything else the scan flagged (DMARC, SPF, DNSSEC, TLS 1.2 cipher suites, HSTS preload-list submission) is DNS/edge configuration outside this codebase — not addressed here, needs to be done directly on the DNS provider / Cloudflare dashboard.

### Fixed — impersonation session missing the school object entirely

`POST /api/platform/schools/:id/impersonate`'s response only ever included `{ token, user }` — never `school`, unlike `/api/auth/login`'s `{ user, school: req.school, ... }`. `platform.html`'s `doImpersonate()` then wrote a hardcoded `school: {}` into the `localStorage` session it hands the client SPA. Every session field the client reads off `session.school` (plan, logoUrl, primaryColor, moduleConfig) came back `undefined` for the entire impersonated session.

The visible symptom: `TopBar.jsx`'s plan badge reads `session?.school?.plan ?? session?.user?.plan ?? 'core'` — with `school` empty and `user` (a `users` doc) carrying no `plan` field of its own, it fell through both checks straight to the literal `'core'` fallback — the oldest legacy tier name — regardless of the school's real, currently-registered plan (confirmed correct in platform admin's own Change Plan dropdown).

- `server/routes/platform.js` — impersonate route now returns the already-fetched `school` doc in its response, mirroring `/login`'s shape.
- `platform.html` — `doImpersonate()` now stores `data.school` instead of a hardcoded `{}`.

### Tests

- `server/__tests__/routes/platform-impersonate.test.js` (new, first coverage for this route) — response includes the full school doc with the correct plan; production gate (`ALLOW_IMPERSONATION`) still enforced. Mutation-tested: reverting the fix fails the new test, confirming it actually catches the regression.
- Full suite: 44/44 suites, 488/488 tests. `node scripts/security-scan.js` and the tenant-isolation ratchet (held at 34) both clean.
- Live-confirmed the HSTS header value directly against a locally running instance (`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`). The impersonation flow itself could not be exercised end-to-end in this sandbox (no live MongoDB, no platform-admin credentials configured) — verified via the mutation-tested unit test and direct comparison against `/login`'s already-correct response shape instead.

---

## [v4.87.0] — 2026-07-20 — feat(platform): direct logo/favicon upload for platform branding

Platform admin's Settings panel previously took a plain "Logo URL" / "Favicon URL" text field. A pasted Google Drive "file" share link looked plausible but is an HTML viewer page, not raw image bytes — it silently rendered nothing on the public site. Replaced with direct upload, mirroring the already-shipped per-school logo pattern (`PUT /api/settings/school/logo`) exactly, and wired the public landing/marketing pages to actually consume the result — the second half of the original feature that was built but never connected.

### Added — server

- `server/routes/platform.js` — `PUT/DELETE /api/platform/settings/logo` (500KB cap) and `.../favicon` (100KB cap). Both validate the payload is a genuine base64 image data URL (`_validateBase64Image`), store it directly on the `platform_settings` doc, and return the binary-serving asset URL. DELETE clears both the stored bytes and the URL field.
- `server/routes/public.js` — `GET /api/public/platform-asset/:type` (`logo`/`favicon`), serving the stored bytes with mime-sniffed `Content-Type` and a `public` cache header — the platform-wide counterpart to the existing per-school `GET /api/public/school-asset/:type`.

### Changed — client

- `platform.html` — Logo/Favicon URL text inputs replaced with upload UI (preview box, Choose File / Remove), reading the file client-side via `FileReader` and PUTting the base64 payload directly.
- `client/src/components/landing/PublicNav.jsx`, `PublicFooter.jsx` — now fetch `getPlatformSettings()` and render the uploaded logo/platform name/brand colour in the site-wide wordmark, falling back to the default "M" mark and "Msingi" name when nothing has been uploaded (or the request fails) — the fetch is cached, no extra cost across the two components. `PublicNav`'s favicon-reset effect also applies a custom favicon once loaded, without disturbing its existing defensive-reset-on-mount behavior.
- `client/src/pages/Landing.jsx` — removed a dead, never-called `getPlatformSettings` import left over from before this wiring existed.

### Tests

- `server/__tests__/routes/platform-branding-asset.test.js` (new) — 10 tests: missing-field / invalid-image / oversized 400s for both asset types, successful upload writes the correct doc fields and returns the correct URL, delete clears both fields.
- `server/__tests__/routes/public-platform-asset.test.js` (new) — 5 tests: invalid type 400, no-asset 404 (including no-doc-at-all), correct `Content-Type`/`Cache-Control` on serve, logo/favicon stored and served independently.
- Full suite: 43/43 suites, 486/486 tests. `node scripts/security-scan.js` and the tenant-isolation ratchet (held at 34) both clean.
- Browser-verified end-to-end with a mocked `/api/platform/settings` response: uploaded logo/name/colour render correctly in both `PublicNav` and `PublicFooter` on a client-side (React Router) navigation, and the no-custom-branding fallback (real endpoint unreachable in this sandbox — no live backend) correctly renders the default "M" mark and "Msingi" name with no broken image or console error.

---

## [v4.86.0] — 2026-07-20 — feat(auth): collapse org-slug login to a single gate + search resolves to organizations

Triggered by a real screenshot: searching "tis" on the landing page showed two schools under one organization ("Trinitas International SChool" / "Trinity International SChool") as separate, confusingly-similar results. Working through it surfaced two decisions, both implemented here.

### Changed — `organizations.orgSlugLoginEnabled` removed; `multiSchoolEnabled` alone gates org-slug login

C13 originally shipped with two independent flags — `multiSchoolEnabled` (switching) and `orgSlugLoginEnabled` (the public org-login surface), deliberately kept separate so enabling one could never silently expose the other. Real usage showed that split added a manual activation step without adding real safety: `multiSchoolEnabled` is already a rare, platform-admin-only action, and the single-eligible-school fast path already means a person whose org has 2+ schools but only one account of their own never sees a picker or learns the others exist — the "expose a new public endpoint" risk doesn't scale with the org's size, only with how many schools *that identity* can reach.

- `server/routes/public.js` (`resolve-portal`), `server/routes/auth.js` (`org-login`) — condition drops to `multiSchoolEnabled` alone (`IDENTITY_CUTOVER_ENABLED` unaffected, still required).
- `server/routes/platform.js` — `enable/disable-org-slug-login` routes removed outright. `enable-multi-school`'s response now carries the identity-migration cutover-readiness info that route used to surface. `disable-multi-school` no longer cascades a second flag — nothing left to cascade.
- `server/utils/provision-organizations.js`, `POST /organizations` — drop the now-removed field's default. Existing orgs keep a stray `orgSlugLoginEnabled` field in the DB — harmless, never read again; not worth a migration for a boolean nobody will look at.
- `platform.html` — Organizations panel collapses to one toggle; portal-URL indicator no longer depends on a second flag.
- `docs/adr/ADR-0007-org-slug-login.md` — amended in place (correction 6, dated), not rewritten — the original two-flag decision stays as historical record with a pointer to the amendment, matching this document's existing "corrections found during implementation" convention.

### Added — school search resolves to organizations, not individual schools

Every school already belongs to exactly one organization (a 1:1-genesis org for the common single-school case). `GET /api/public/schools/search` now groups matches accordingly instead of returning a flat school list:

- **1:1-genesis org** — unchanged: a plain school result.
- **Real multi-school org, `multiSchoolEnabled` on** — one result for the whole org; picking it goes straight to the shared portal (`resolve-portal` already resolves the org's slug correctly).
- **Real multi-school org, `multiSchoolEnabled` still off** — one grouped result (avoiding exactly the Trinity/Trinitas confusion) that expands in place, client-side, to the individual matching schools — no promise of a portal that isn't live yet.

`client/src/pages/Login.jsx`'s `SchoolFinderPage` renders all three shapes; the existing `pickSchool()` function is reused unchanged for every leaf click (school, organization, or a group's child school) — `resolve-portal` already resolves either a school or org slug correctly, so no new navigation logic was needed.

### Tests

- `server/__tests__/routes/platform-organizations-slug.test.js`, `auth-org-login.test.js` — dead tests for the removed routes/flag deleted, not left disabled; remaining fixtures updated to the single-gate shape.
- `server/__tests__/routes/public-school-search.test.js` — rewritten for the grouped-`results` shape, including the exact Trinity/Trinitas scenario (multi-school org, flag off → grouped; flag on → single portal entry) as a dedicated test.
- Full suite: 41/41 suites, 472/472 tests. Mutation-tested the gate-collapse condition (`auth.js`/`public.js`) and the search classification branch — both confirmed to fail the relevant tests when reverted. `node scripts/security-scan.js` and the tenant-isolation ratchet (held at 34) both clean.
- Browser-verified `SchoolFinderPage` end-to-end with a mocked `/api/public/schools/search` response covering all three result types (no live MongoDB in this sandbox): the organization-group row expands in place with zero network calls, and picking a child school correctly navigates via the existing `pickSchool()` path.

---

## [v4.85.1] — 2026-07-20 — fix(security): three bugs found by real-database production validation of C13

Requested production-readiness validation of C13 (org-first login) explicitly demanded a real database, not mocked responses. `mongodb-memory-server` was already a devDependency, unused until now — spun up a genuine ephemeral MongoDB, booted the real `server/index.js` against it, and drove every check over real HTTP: two organizations, three schools, six role journeys, a real identity merge across two independently-created accounts, cross-org isolation attempts, password reset, MFA (OTP recovered by reading the sha256 hash straight from Mongo and brute-forcing the 900,000-value keyspace — no SMTP provider in this sandbox), session revocation, disabled-school and disabled-org behavior, and a switch-school regression check. First pass: 44 pass, 6 fail. Three of the six failures were real bugs the mocked test suite had never been in a position to catch; the other three were this validation script's own wrong assumptions about response shapes, corrected in place. Re-run after fixes: 50/50 (44 pass, 6 info, 0 fail).

### Fixed

- **`_resolveIdentitySchools` never checked `schools.isActive`.** A school an operator had disabled (`PATCH .../schools/:id {isActive:false}`) still appeared in the org-login picker and was still redeemable via `complete-org-login`, even though direct login at that school's own subdomain was already correctly blocked by `tenantMiddleware`. Caught live: disabled School A2 mid-run, and it stayed in Tina's picker response. Fixed — the resolver's `schools.find()` now filters `isActive:{$ne:false}`, same standard it already applied to the user doc. `switch-school` inherits the fix automatically (same shared resolver).
- **`_buildTokenPayload`'s `orgId` enrichment depended on a `memberships` doc existing for the current school — which nothing creates inline at invite time, only a one-time boot backfill.** Caught live: freshly invited Tina, logged in fresh at A1, got `availableSchools: []` even though she genuinely has a second account at A2 — because her A1 account predates the boot backfill and no membership doc for her at A1 exists. This silently broke the School Switcher UI for any user invited after server boot, indefinitely, even though `_resolveIdentitySchools` independently proved they have real access. Fixed — `orgId` is now set directly from `school.organizationId` once `multiSchoolEnabled` is true, never gated on a membership lookup; `membershipId` stays best-effort (it's only ever consumed as an optional audit-query filter, `server/routes/audit.js` — nothing authorization-relevant depended on it).
- **`provisionIdentityForUser` coerced `mfaEnabled` to `false` via `!!user.mfaEnabled` instead of preserving "never set."** Every MFA check in `auth.js` reads `mfaEnabled !== false` — intentionally "on unless explicitly opted out." Coercing an unset value to an explicit `false` silently opted every identity-linked MFA_ROLES account (`superadmin`/`admin`/`deputy`/`principal`/`finance`) OUT of MFA the moment their identity resolved — which happens on every `org-login` call, and would happen on every `/login` call the moment `IDENTITY_CUTOVER_ENABLED` is genuinely flipped platform-wide. Caught live: Fiona (finance, MFA_ROLES) got a direct successful login through `org-login` with no OTP challenge at all. Fixed — new `_mfaTriState(user)` helper preserves `true`/`false`/`null` instead of collapsing to boolean; `null` (never set) now correctly still triggers MFA for an eligible role.

### Confirmed correct, no fix needed

Tenant isolation held under every adversarial attempt: cross-org identity lookup (401, generic), the `complete-org-login` allowlist rejecting an out-of-set school (403), cross-org `switch-school` (404/409), and the response-shape identity check between "foreign org" and "wrong password" (byte-identical, no enumeration side-channel).

### Gaps found, not fixed (reported, not silently built)

- No dedicated `DELETE`/revoke route exists for the `memberships` collection at all — `POST /api/platform/memberships` only grants. Not a blocker for this feature (the resolver never consults `memberships` for authorization), but a real gap if "revoke a Membership" is ever expected as a standalone admin action. Practical, currently-functioning revocation lever today: deactivate the target school's own `users` doc.
- No way to fully "disable an organization" as a single operation. `disable-org-slug-login` closes the shared-portal entry point, but each member school's own direct login keeps working — correctly, since schools aren't disabled by that toggle, but there's no single lever that suspends everything at once.

### Tests

- `server/__tests__/routes/auth-session.test.js` — the stale test asserting `orgId` stays absent without a membership doc rewritten to assert the fixed behavior; new test proving a disabled school is excluded from `availableSchools` even with a real active account there (the `schools.find()` mock now genuinely filters on `isActive`, not just returning canned docs regardless of the query).
- `server/__tests__/provision-identities.test.js` — new tri-state test: never-set stays `null`, explicit `true`/`false` preserved exactly.
- Full suite: 41/41 suites, 475/475 tests. Tenant-isolation ratchet: held at 34, no new unprotected `_model()` sites (both fixes stayed inside `auth.js`/`provision-identities.js`, no new tenant-collection access added).

---

## [v4.85.0] — 2026-07-19 — feat(auth): Organization-first login (C13, ADR-0007 accepted) + fix(security): switch-school never worked for real two-school accounts

You clarified the intended model directly: the Organization is a first-class entity, authentication is identity-first, not school-first — visit the org's one URL, authenticate once, land in your one school or pick from several, and switching later reuses the exact same resolution. You were explicit this is not new architecture (it's completing behavior the Organization/Identity/Membership layer already committed to, `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §15) and asked for an implementation plan, not a new ADR — `docs/adr/ADR-0007-org-slug-login.md` (drafted last session, still unaccepted) already had the researched design, so this plan absorbed its decisions directly rather than re-deriving them or running a second acceptance round.

### Fixed — a real, previously-shipped bug in C9's school switching (standalone, no dependency on the rest of this release)

Re-validating the current auth flow (not assuming it worked) found `POST /api/auth/switch-school` could never have succeeded for any real two-school account: it validated the target account via `TargetUsers.findOne({id: userId, ...})` — matching the CURRENT session's `userId` against the TARGET school's `users.id`. Every user-creation path mints an independent id per school (checked across every creation route) — none of them ever copy an existing linked identity's id onto a new school's record. `server/__tests__/routes/auth-switch-school.test.js`'s own mocks encoded this exact assumption in every test fixture, which is why it was never caught.

- New shared resolver, `_resolveIdentitySchools(identityId, orgId)` (`server/routes/auth.js`) — the single source of truth for "which schools can this identity actually log into," keyed on `identityId` (unconditionally present on every JWT since ADR-0003 Phase 1, no cutover dependency) via a real `users` doc, never via a `memberships` grant alone (a Membership records authorization intent, not login capability — confirmed the Link Identity flow creates a membership without a target-school `users` doc).
- `switch-school` and `_availableSchools` (the School Switcher's data source) both fixed to use it. `_availableSchools` had the identical bug from the other direction: it listed any `memberships` grant as "available" without confirming a login-capable account existed — meaning a school could appear in the switcher dropdown and then 404 when picked.
- New compound `{identityId, schoolId}` index on `users` (`server/utils/indexes.js`) — the first reverse-direction query on that field; previously only looked up FROM a resolved identity, never TO one.
- `auth-switch-school.test.js` rewritten, not patched — every mock needed `identityId` added throughout. `auth-session.test.js` extended with 6 new `_availableSchools` tests, including one proving cross-organization accounts are never listed even when a real account exists there.

### Added — organization-first login (ADR-0007, C13 Phase 2)

- **`GET /api/public/resolve-portal`** — resolves a slug to a school (unchanged behavior — a 1:1-genesis org's slug still resolves as its one school) or, only for an opted-in 2+-school organization, to `type: 'organization'`. Byte-identical 404 shape whether nothing matches or a real org exists there unopted-in — no existence leakage.
- **`POST /api/auth/org-login`** — three independent gates: `organizations.multiSchoolEnabled` + `organizations.orgSlugLoginEnabled` (both shipped last session) + the platform-global `IDENTITY_CUTOVER_ENABLED` env var. The third is a deliberate conservative choice, not a strict requirement — ADR-0003's dual-write already keeps `identities.passwordHash` correct regardless of cutover; requiring it anyway means this new public credential-check endpoint can't go live anywhere until an operator makes that platform-wide call explicitly. Checks `identities` by `{orgId, email, status:'active'}` (excludes `collision_pending` by construction — "not found," "collision_pending," and "wrong password" all produce the byte-identical response, closing an enumeration side-channel), then the shared resolver: 0 eligible → 403; exactly 1 → mints the session directly; 2+ → issues a picker code.
- **`POST /api/auth/complete-org-login`** — redeems a picker code from a new, separate `_orgPickCodes` Map (deliberately never `_exchangeCodes` — a partially-verified "identity confirmed, no school chosen" code must be structurally incapable of redeeming a real session through the wrong door). Two mutation-tested security checks: the `schoolId` must be literally present in the code's server-locked allowlist (proven load-bearing via an adversarial test where a real, active account happens to exist under the right userId at the wrong school — only the allowlist check, not the downstream re-fetch, catches that), and a TOCTOU re-check that the target school hasn't been re-parented to a different organization in the window since the code was minted.
- **Simplification found during implementation**: `org-login`/`complete-org-login` don't reuse the OAuth-style exchange-code mechanism at all, unlike the original draft assumed. They're first-time credential entry over a plain POST — the same shape as `/login` and `/verify-otp`, both of which already mint the token and set the cookie directly in the same response. Following that existing, simpler, proven pattern instead removed a whole layer of indirection from the design.
- MFA reuses `/verify-otp` completely unchanged — `org-login`/`complete-org-login` just write `mfaOtp`/`mfaExpiry` the same way `/login` does. **Found and fixed during browser verification, not assumed correct**: the first pass primed `verify-otp`'s required `X-School-Slug` header purely via the existing `storeSchoolSlug()` localStorage key — which browser-testing the actual MFA flow showed does NOT work, because `detectSchool()`'s priority order puts subdomain/`?school=` detection ABOVE localStorage, and on the org's real shared subdomain that resolves to the ORGANIZATION's own slug, silently overriding the primed value. Fixed with a small, explicit override: `client.js`'s `_req()` gained an optional `opts.schoolSlug` that wins over auto-detection outright, threaded through `auth.verifyOtp(data, opts)`; `Login.jsx` passes it once the target school is known. Verified in-browser end-to-end (mocked fetch, no live MongoDB): the header now correctly carries the target school's slug, not the org's.
- Client: `Login.jsx`'s existing state machine gained an `isOrgPortal` branch (routes to `org-login` instead of `/login`) and a new `PICKER` mode — reusing the existing form, OTP, error, and loading UI rather than a separate page component.

### Tests

`server/__tests__/routes/auth-org-login.test.js` (new, 23 tests) plus the switch-school/availableSchools rewrite above — 40 new/rewritten tests total. Both load-bearing security checks (allowlist, TOCTOU) mutation-tested — genuinely fail when disabled, including the adversarial allowlist case. Full suite: 41/41 suites, 473/473 tests, zero regressions. Tenant-isolation ratchet unchanged at 34 (all new collection access is either already-platform-exempt or correctly tenant-scoped). `docs/adr/ADR-0007-org-slug-login.md` updated to Accepted, documenting three corrections found during implementation (no exchange-code reuse, the TOCTOU check, the switch-school bug fix) that weren't in the original draft.

---

## [v4.84.0] — 2026-07-19 — feat(platform): Organization shared URL slug — Phase 0/Phase 1 (C13, ADR-0007 drafted)

Requested: organizations should be able to use one shared URL slug for all their schools, reflected in platform admin, with the intended design (confirmed by the user) being one shared org login portal with a post-authentication school picker for multi-membership users, built on the already-shipped C9 switcher. Research (direct code reads plus a Plan-agent pressure-test) found **no existing mechanism anywhere authenticates a user before a single school is resolved** — `tenantMiddleware` hard-400s without one, every credential check is school-scoped, and C9's `switch-school` requires an already-valid session. A genuinely new login mechanism is required, and it independently hits both of the Constitution's explicit ADR-trigger categories (Authentication, Multi-tenancy/school-context resolution) — so this ships in two parts: an additive, inert Phase 0/1 now, and `ADR-0007` drafted (not yet accepted) for the actual credential-check flow.

### Fixed — slug-collision hazard (Phase 0)

Research surfaced a real, pre-existing bug, not just a gap: `organizations.slug` and `schools.slug` are two separate uniqueness namespaces that never cross-checked each other. A new school's slug could collide with an unrelated organization's slug, at which point `provisionOrganizationForSchool`'s upsert throws a duplicate-key error that gets silently swallowed (`platform.js`'s existing catch block) — permanently orphaning the school (`organizationId: null` forever; the boot backfill retries and fails on the same slug every restart). Also, `schools.slug` had no DB-level unique index at all, only an app-level check — a real TOCTOU race between two concurrent creates.

- `indexes.js`: added a unique sparse index on `schools.slug` (mirrors the existing `org_slug` index).
- `platform.js`: `POST /schools` (both the 1:1-auto-org and org-attached paths) and `POST /organizations` now cross-check the *other* collection before allowing a slug, 409ing on a genuine collision. Explicitly does **not** flag `org.slug === school.slug` for a 1:1-genesis org — that's the deliberate, by-design steady state (`provision-organizations.js:61`); only a collision against an *unrelated* school/org is rejected.
- `qa-health.js`: new read-only diagnostic (`_checkOrgSchoolSlugCollisions`) flags any pre-existing collision in real data, correctly excluding the by-design genesis case.

### Added — platform-admin visibility + activation toggles (Phase 1)

Two new, independent, per-organization flags — deliberately not folded into one switch:

- **`multiSchoolEnabled`** (existing flag, previously hardcoded `false` everywhere with no route to ever set it) gets its first-ever admin-settable routes: `POST /organizations/:id/enable-multi-school` / `disable-multi-school`. Activates JWT `orgId`/`membershipId` enrichment and the C9 school switcher for an org's already-authenticated staff — nothing more.
- **`orgSlugLoginEnabled`** (new field, default `false`) — a *separate* switch for the org's slug becoming a public, unauthenticated login surface. Hard-requires `multiSchoolEnabled` already `true` (409 otherwise) — flipping switching on for an org's staff must never silently also open a new public credential-check endpoint. `disable-multi-school` cascades this off too, so the invariant can never be left stale.
- Both toggle routes are audit-logged and, for `enable-org-slug-login`, surface `qa-health.js`'s existing identity-migration readiness (informational only — the platform-wide `IDENTITY_CUTOVER_ENABLED` env var is entirely outside these routes' authority, and the response says so explicitly).
- `platform.html` Organizations panel: new "Shared Portal URL" column, and a "Multi-School" settings modal per organization showing both switches, their precondition relationship, and the cutover-readiness dependency this dashboard can't verify or flip.

### Drafted, not accepted — `docs/adr/ADR-0007-org-slug-login.md`

Covers the actual credential flow this feature needs: a new public `resolve-portal` endpoint, `POST /auth/org-login`/`complete-org-login`, a separate `_orgPickCodes` mechanism (deliberately not reusing C9's `_exchangeCodes` — a partially-verified "identity confirmed, no school chosen" code must be structurally incapable of redeeming a real session), a new `{identityId,schoolId}` index on `users` (the first reverse-direction identity lookup in the codebase), MFA placement, and client changes. Ships no code — per the same separate-acceptance-gate discipline as ADR-0001/0003/0004, implementation begins only after explicit sign-off on the document's contents, distinct from approval of the plan that produced it.

### Tests

`platform-organizations-slug.test.js` (new, 12 tests) — collision 409s, toggle-route preconditions/cascade/audit-log/response shape. `qa-health.test.js` extended (4 tests) for the new diagnostic, including the load-bearing case that a 1:1-genesis org's `slug === school.slug` is never flagged. Mutation-tested both the collision check and the `multiSchoolEnabled` precondition guard — both genuinely fail their tests when disabled. Full suite: 40/40 suites, 447/447 tests, zero regressions. Verified end-to-end in-browser (mocked API — no live MongoDB in this sandbox): toggles flip correctly, the precondition button disables correctly, cutover-readiness text renders, and the table row refreshes on modal close.

---

## [v4.83.0] — 2026-07-19 — fix(security): tenant-isolation ratchet repair + mark-entry version conflicts (BUG-003/BUG-004)

### Fixed — tenant-isolation CI ratchet (24 → 47 → 34)

Requested a real audit of what's actually implemented and whether the system is stable/secure — not what the docs claim. Running the tenant-isolation ratchet directly (`scripts/verify-tenant-coverage.js`) found it would fail CI right now: direct `_model()` usage on tenant collections had grown from a baseline of 24 to 47 as `identities`/`memberships`/`entitlements` work landed across recent sessions without the `PLATFORM_COLLECTIONS` exemption list keeping pace. Traced every one of the 18 new sites individually — not a new security hole:

- `identities` added to `PLATFORM_COLLECTIONS` — every real call site filters by `{id: identityId}`, never `schoolId`; the collection is org/credential-scoped by design (ADR-0003), so `tenantModel()` cannot meaningfully apply to it.
- `auth.js`'s two genuinely single-tenant `memberships` lookups (`_buildTokenPayload`, `POST /switch-school`) migrated to `tenantModel('memberships', {schoolId})` — a real hardening, not just a ratchet workaround.
- The remaining 34 sites documented in `ADR-0001` as reviewed platform-admin/cross-school exceptions, matching the existing carve-out for `platform.js`/`qa-health.js`. Baseline re-set to 34, the new honest, reviewed count.

### Fixed — BUG-003 and BUG-004: concurrent mark-entry silently overwrote grades

Asked to also close BUG-003's remaining client-side gap. Fixing it surfaced something bigger: `ExamResultsTab.jsx` (the component BUG-003 named) is not rendered by any route — `ExamsPage.jsx`'s own header comment says its unified Markbook *"replaces Results + CA Marks."* The fix there is correct but reaches no real user. Checking the endpoint the *live* Markbook actually calls (`POST /api/assessment/marks/bulk`) found the identical, previously-undocumented defect (**BUG-004**): a plain `bulkWrite` with no version check at all.

- **BUG-003**: `ExamResultsTab.jsx` now reads/sends `_v` and surfaces `conflicts` in a banner — complete, correct, but dead code. Left in place (harmless) rather than reverted.
- **BUG-004**: `assessment.js`'s `MarkSchema` gained the same optional `_v` field; existing marks pre-fetched by composite key (`studentId+subjectId+termNumber+assessmentType+instance+academicYearId`, since uniqueness here isn't a bare `studentId`), a stale version excluded from the write and reported in `conflicts`, mirroring `exam_results`' proven pattern exactly. Client: `ExamsPage.jsx`'s `MarkbookTab` — the actual, reachable Markbook — now tracks `_v` per cell, sends it on save, and surfaces conflicts in a banner plus a red-flagged cell, without ever silently clearing the teacher's unsaved entry.
- Verified end-to-end in-browser (mocked API responses — no live MongoDB in this sandbox): edited a mark, saved, got a real conflict response back, confirmed the banner, the red cell, and the retained typed value all render correctly together.
- 3 new server tests (`assessment-mark-conflict.test.js`, mutation-tested — 2 of 3 genuinely fail when the conflict check is broken).

### Governance

`ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s BUG-003 entry corrected to explain the dead-code finding; new BUG-004 entry added. `ADR-0001` gained the `identities`/`memberships`/`entitlements` exception documentation this fix required. Full suite: 39/39 suites, 431/431 tests, zero regressions.

---

## [v4.82.0] — 2026-07-18 — feat(platform): Job queue infrastructure — Phase 1 of C11 (Integration Framework, ADR-0006)

### Added

- **`server/utils/job-queue.js`** (new) — a MongoDB-collection-based retry queue (no Redis/BullMQ — nothing here justifies a new external infra dependency). `enqueueJob({type, payload, maxAttempts})` writes a `queue_jobs` doc; `registerHandler(type, fn)` maps a job type to an async handler; `processQueueOnce()` atomically claims due jobs (`findOneAndUpdate({status:'pending'},...,{new:true})`, mirroring the proven-correct claim idiom already in `mpesa.js`'s callbacks) and runs the handler, with exponential backoff on failure (1min → 2min → 4min ... capped at 30min) and a `dead_letter` terminal state once `maxAttempts` (default 5) is exceeded; `startQueueWorker()` schedules it every minute via `node-cron`, with an overlap guard (a new requirement — every existing cron file in this codebase runs daily/weekly and never needed one).
- **One real integration**: `server/services/audit.js`'s security-alert webhook (previously fire-and-forget, silently dropping failures) now enqueues instead of firing inline. The webhook-POST logic is split into `_postSecurityAlertWebhook()`, which returns a real Promise that rejects on a non-2xx response or a request error — the previous version swallowed both, which is exactly why it could never be retried.
- `queue_jobs` added to `tenant-model.js`'s `PLATFORM_COLLECTIONS` — not every job is school-scoped (e.g. platform-operator security alerts), and this makes the platform-level decision structurally enforced (`tenantModel('queue_jobs', ...)` now throws immediately) rather than just conventional.
- 13 new tests (9 in `job-queue.test.js` — first-ever coverage, reusing `mpesa-idempotency.test.js`'s exact stateful-mock idiom for the atomic-claim cases; 4 extending `audit.test.js`), mutation-tested (temporarily zeroed the backoff formula, confirmed the corresponding test fails, restored).

### Governance — scoped deliberately, contradiction-checked before starting

C11 was the last item still marked "deferred" on the dependency graph. The user clarified only C6 (Organization services) was a deliberate pause — C11's deferral was a technical-prerequisite gap (no queue infrastructure existed), not a standing decision — and asked to proceed unless it contradicted something. It didn't: the one governance objection on record (`ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` row R4) partly cited a "Non-Decisions register" entry that, checked directly, **doesn't exist** — that citation is corrected, not obeyed. The other half of R4 (no queue infra) was real and is what this phase builds — scoped narrowly, not the full Integration Domain (`ADR-0006`, Major not Kernel, proposed-and-accepted in one pass like ADR-0002/0005). Connector Registry, OAuth Framework, Webhook Engine, API Gateway, Sync Engine, Monitoring, and Rate Limiting all remain deferred — no concrete integration justifies them yet.

Two stale governance-doc claims, found while grounding this exact work, corrected alongside it: `PLATFORM_CONCURRENCY_MODEL.md` §4 still described M-Pesa's webhook idempotency gap (`BUG-002`) as unfixed, present tense — it's already fixed and tested; `monitoring.js`'s crash-path webhook sender was deliberately left un-queued (queue-ifying an alert that fires immediately before `process.exit(1)` would make it less reliable, not more, since the next worker tick may not run before the process dies).

Verification: full jest suite, 38/38 suites, 428/428 tests, zero regressions.

---

## [v4.81.0] — 2026-07-18 — docs(governance): Billing ratification — subscription belongs to the School (C12/ADR-0005)

### Changed

- **`docs/ARCHITECTURE_CONSTITUTION.md` §12 rewritten.** Previously described an Organization-owned subscription model that was never built, flagged `⚠ SUPERSEDED PENDING BILLING ADR` since 2026-07-16. Replaced with the model every billing code path already implements: the subscription belongs to the **School** — `server/routes/billing.js`'s `billing_snapshots` (tenant-scoped, no `organizationId` field), `server/routes/mpesa.js`'s subscription STK-push flow, and `server/middleware/plan.js`'s `plan`/`planExpiry` fields on the `schools` collection were all already correct. This ADR closes a documentation gap, not a code gap.
- **`docs/adr/ADR-0005-billing-ratification.md`** (new) — ratifies the School-owned model, explicitly fences off a future central "Organization Billing Account" (named as aspirational in `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §16) as unbuilt, out-of-scope future work rather than something this ADR designs or commits to.
- `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s §12 status row and Decision Register row R2 marked resolved. Dependency graph's C12 row corrected — its original "org billing account, central invoicing" framing was itself inaccurate; marked done as a ratification, not a build.

### Governance

Unlike ADR-0004/C10 (Kernel-tier, required a separate explicit acceptance gate), this ADR resolves Governance Review row R2, which carries no such qualifier — proposed and accepted in the same pass, matching ADR-0002's (C7) lighter precedent. **No code changed.** This closes C12; C11 (Integration framework) remains explicitly deferred — confirmed still blocked on queue infrastructure that doesn't exist anywhere in the codebase (`node-cron` only, no Redis/BullMQ, no retry-queue semantics), matching the governance corpus's own recommendation to keep it deferred until a concrete integration justifies the investment.

Verification: docs-only phase, no jest run needed — confirmed no executable code was touched. Read-through of the ADR and rewritten §12 for internal consistency against `billing.js`/`plan.js`'s actual behavior.

---

## [v4.80.0] — 2026-07-18 — feat(platform): Audit extensions — correlation ID + membership/org fields (C5/MR-002)

### Added

- **`server/utils/correlation-id.js`** (new) — assigns every incoming request a correlation ID (`req.correlationId`), reusing an incoming `x-request-id`/`x-correlation-id` header when present and shape-safe, otherwise generating a fresh `crypto.randomUUID()`. Wired in as the very first middleware in `server/index.js`, right after `trust proxy`. No response header is echoed back — this is a write-side/internal-tracing concern (Security Invariant 12 is a requirement on audit records, not the client-facing response contract), stated as a deliberate scope boundary, not silently decided.
- **`AuditService.log()` now writes `correlationId` and `orgId`/`membershipId`** on every entry — zero changes needed at any of the 20 existing call sites across 6 route files, since both are derived internally from params every call site already passes (`req.correlationId`, plus a `{userId,schoolId}` lookup against `memberships`). The membership lookup is non-fatal (a failure degrades to `null`, never blocks the write) and skipped entirely when there's no `schoolId`/`actor.userId` to look up against (covers `platform.js`'s operator-actor calls without a wasted query).
- **`AuditService.query()` and `GET /api/audit`** gain optional `correlationId`/`orgId`/`membershipId` filters, same passthrough pattern as the existing `schoolId`/`action`/`severity` filters. No change to the existing admin/superadmin school-scoping guard.
- **`audit_logs` index block** (`server/utils/indexes.js`) gains `al_correlation` and `al_org_date` entries.
- 24 new tests: `correlation-id.test.js` (8, pure-function coverage of the ID resolution logic including log-injection/oversized-header defense), `audit.test.js` (11, first-ever direct coverage of `AuditService` — correlation ID, membership enrichment, non-fatal degradation, query filters), `routes/audit.test.js` (5, first-ever coverage of the read route — new filter passthrough plus the pre-existing scoping guard, confirmed unaffected).

### Governance

C5 was the lightest-risk item remaining on the dependency graph (`Additive, reversible, not user-visible`) and MR-002 itself is rated Low/Low in the Migration Risk Register — no ADR required, matching C3/C7/C9's bundled treatment rather than C10's. Its listed blocker ("membership/org fields need C7") is satisfied now that Membership is a live collection. Dependency graph's C5 row updated to done.

Verification: mutation-tested the membership-lookup-skip guard (temporarily forced the lookup to always run, confirmed 3 tests fail, restored) to prove the new coverage isn't decorative — same discipline applied to C10's `plan.test.js`. Full suite: 37/37 suites, 415/415 tests, zero regressions.

---

## [v4.79.0] — 2026-07-18 — feat(platform): Entitlement activation (C10/ADR-0004)

### Added

- **`planGate()` (`server/middleware/plan.js`) now consults the C3 entitlement registry as a dual-read override.** If a school's plan tier alone already grants a feature, behavior is byte-for-byte unchanged — `hasEntitlement()` isn't even called. Only on the plan-would-deny path is an explicit, active entitlement for that feature key checked; if present, it grants access the plan alone wouldn't. **Strictly additive, never subtractive** — an entitlement can never take away access a plan already provides, on the first request or any request after.
- **Entitlement-lookup failures resolve to the pre-existing 403**, not a new 500 — a local try/catch around `hasEntitlement()` ensures a transient DB error degrades to exactly today's plan-derived denial, preserving the dual-read guarantee even under failure.
- The platform-admin entitlement grant/revoke UI (built under C3, previously inert) is now functionally live — `POST .../entitlements`'s response note updated accordingly.
- 8 new tests in `server/__tests__/plan.test.js` — first-ever direct test coverage of `planGate()`'s internals (every existing route test file stubs the whole module). Covers: plan-grants-no-lookup (verified with a mutation test — see Verification), plan-denies+no-entitlement, plan-denies+active-entitlement, entitlement-lookup-throws→403-not-500, unknown-feature-key fail-closed with zero lookups, missing-auth 401, and plan-cache pinning.

### Governance — the Kernel-tier ADR gate this time, not the bundled treatment

Unlike C3/C7/C9, this shipped through the heavier process ADR-0001/ADR-0003 required: `docs/adr/ADR-0004-entitlement-activation.md` was drafted as its own deliverable — no code — and required your explicit acceptance, separate from approving the plan that produced it, before any implementation began. The dependency graph and `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` both independently classify C10 as Kernel-tier despite a blast-radius finding that every one of the 21 feature keys actually reaching `planGate()` today resolves to `'core'` tier — meaning the deny branch has never fired in production for any real route, and this activation was near-zero-risk in practice. Low practical risk didn't exempt it from the governance gate; the ADR states that distinction explicitly rather than using the risk finding as an excuse to skip the process.

Verification: mutation-tested the plan-grants fast path (temporarily disabled the early-return, confirmed the corresponding tests fail, then restored) to prove the new coverage isn't decorative. Full jest suite: 34/34 suites, 391/391 tests, zero regressions.

---

## [v4.78.0] — 2026-07-18 — feat(auth): School switching (C9/D-004)

### Added

- **`POST /api/auth/switch-school`** (`server/routes/auth.js`) — `authMiddleware`-protected; body `{schoolId}`. Validates the caller has an active `memberships` doc for the target school, that it's within the same organization as their current context (409 on cross-org, mirroring `POST /memberships`'s existing convention), and that a per-school `users` doc actually exists there (404 otherwise — a Membership grant does not by itself guarantee login capability, since ADR-0002's Link Identity flow can create the former without the latter). Mints a fresh, correctly-scoped token and hands back an opaque exchange code via the **existing, unmodified** `_issueExchangeCode`/`POST /exchange` mechanism — no new token-consumption endpoint, no client-side token handling.
- **`_buildTokenPayload` gains `orgId`/`membershipId`** — added only when the target school's organization has `multiSchoolEnabled: true`. Every organization has this hardcoded `false` today (Stage 3 activation is a separate, later, per-organization operator decision — no code path flips it), so this is a no-op in every current deployment; that's the specific regression this release's own tests pin.
- **`availableSchools` (optional array)** added to the JSON body of `/login`, `/verify-otp`, `/force-change`, and `/exchange` — the other schools a user can switch to without re-authenticating. Absent unless `orgId` is present on the token (i.e. never, today).
- **Minimal "Switch School" menu** in `TopBar.jsx` — renders only when `availableSchools` is non-empty; calls `switch-school` then the existing `exchange`, then hard-reloads so every school-scoped cache/component state resets cleanly rather than requiring an audit of every query's cache key.
- 13 new tests (9 route-level in `auth-switch-school.test.js`, 4 JWT-field in `auth-session.test.js`'s existing C9 describe block) plus 4 new `availableSchools`-specific tests.

### Governance — shipped ahead of its stated dependency, deliberately

Per the dependency graph, C9 depends on "C8 authoritative" (`IDENTITY_CUTOVER_ENABLED=true` in a real deployment with the `identity` gate green) — not satisfied here, and cannot be in this sandbox (no live MongoDB to safely flip that switch against). Built anyway, at explicit operator instruction, **self-gated on `organizations.multiSchoolEnabled`** instead of on C8's own activation flag — a genuinely unreachable condition today, verified by search to be hardcoded `false` at every provisioning site. This mirrors every prior phase's disabled-by-default posture; the dependency-graph deviation itself is recorded inline in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` §1, not silently worked around.

Also corrected alongside the code: `docs/ARCHITECTURE_CONSTITUTION.md` §7/§8/§10 Stage 4 described a "sessionStorage holds the JWT per tab" session model that is architecturally impossible against this codebase's actual security design — the JWT is delivered exclusively via an HttpOnly cookie (`_setAuthCookie`), and the client's own `store/auth.js` explicitly hardcodes `get token() { return null; }` because JS was deliberately never meant to read it. Cookies also aren't tab-scoped, so "one JWT per tab" isn't representable via cookie auth regardless. Replaced with the actual, already-existing exchange-code mechanism this release reuses.

Verification: full jest suite, 33/33 suites, 383/383 tests. Client build (`vite build`) verified clean; UI verified in-browser via injected mock session data (no live MongoDB in this sandbox to exercise a real `multiSchoolEnabled` organization) — dropdown renders correctly, lists the mocked schools, and fails gracefully (toast, no crash, buttons re-enable) when the switch call 500s against the unconfigured backend.

---

## [v4.77.0] — 2026-07-18 — feat(auth): Identity separation Phase 3 — Cutover (C8/MR-001)

### Added

- **`server/utils/identity-cutover.js`** — `isIdentityCutoverEnabled()`, an opt-in kill switch (`process.env.IDENTITY_CUTOVER_ENABLED === 'true'`, exact-string match only, no truthy leniency) gating whether the credential check reads `identities` at all. **Disabled by default** — merging this release changes nothing in any running deployment.
- **`/login`, `/change-password`, `PUT /api/settings` now read `identities.passwordHash`/`mfaEnabled`** when a user has an `identityId` and the switch is on. `/login` fetches the identity once and reuses it for both the password check and the `mfaEnabled` read (Decision 4's Open Question 3 — now a deliberate, tested decision). A dangling `identityId` or unusable `passwordHash` fails closed to a credential mismatch — never a silent fallback to `users.password`, which would mask exactly the divergence the Phase 2 `identity` gate exists to catch before cutover is ever turned on.
- **`GET /api/qa/health`'s `identityMigration` field gains `cutoverEnabled`** — operator visibility into whether the switch is currently live, alongside the existing backfill-completeness gate.
- 17 new jest tests (63 total across Phases 1-3) — cutover on/off at all three check sites, identity-hash match/mismatch, dangling-FK fail-closed, and `mfaEnabled` source-switching, verified at the full HTTP-route level (real signed JWTs, real bcrypt).

### Fixed

Two real bugs, both caught by this phase's own tests, not manual review:
- **The cutover read logic's first draft used one nullable variable for two different facts** — "identity lookup wasn't attempted" and "identity lookup found nothing" were indistinguishable, so a dangling `identityId` silently fell back to `users.password` instead of failing closed, the exact behavior the design explicitly ruled out. Fixed by tracking `identityLookupAttempted` as its own boolean at all three cutover sites.
- **A pre-existing bug in `auth-session.test.js`**, unrelated to this feature until now: one test (`returns 403 for inactive user`) permanently replaced the shared `_model` mock's implementation via `.mockImplementation()`, which `jest.clearAllMocks()` does not undo — every test running afterward in that file silently inherited the override, masking the mock's `identities` branch. Latent for as long as no later test needed that branch; Phase 3's new tests did. Fixed by switching that one test to `.mockImplementationOnce()`, which self-expires after the two calls it's actually meant to cover.

### Not done (deliberately — this ships the mechanism, not the activation)

**Code-complete is not the same as live.** The actual behavioral cutover — `identities.passwordHash` genuinely becoming authoritative for a real login — only happens once an operator explicitly sets `IDENTITY_CUTOVER_ENABLED=true` in a real deployment, and that decision belongs outside this codebase change: it should wait for `GET /api/qa/health`'s `identity` gate to report `status: 'complete'` against real production data. Rolling back at that point is unsetting the env var — instant, no code revert, no redeploy, stronger than the rollback story ADR-0003's own text originally described.

### Governance

ADR-0003's Status/Implementation lines, Consequences (both bugs documented), and Adoption Gate (explicit "code-complete ≠ live" language) updated. Dependency graph's C8 row marked code-complete across all 4 phases; C9's gate clarified to require `IDENTITY_CUTOVER_ENABLED=true` with a green gate, not merely this code being merged. `docs/PLATFORM_ADMIN_GUIDE.md` gained an "Optional environment variables" subsection documenting the switch and the pre-flip check.

### Also fixed (test infrastructure)

Raised jest's global `testTimeout` from the 5000ms default to 15000ms (`package.json`). This session's growing set of password-path test suites do several sequential bcrypt cost-12 operations per test (hash + compare, sometimes twice for dual-write assertions) — deliberately slow by bcrypt's own design — and were occasionally timing out under sustained CPU load from repeated full-suite runs, unrelated to any product bug.

Verification: full jest suite, 32 test suites, 366/366 passed (confirmed clean across multiple runs, including after the timeout fix).

---

## [v4.76.0] — 2026-07-18 — feat(platform): Identity separation Phase 2 — Verify (C8/MR-001)

### Added

- **`identity` gate** in `GET /api/qa/health` (`server/routes/qa-health.js`) — `_identityMigrationStatus()`, mirroring the existing `_migrationStatus()`'s `{fieldName: N, status}` shape. Reports `identityBackfillPending` (email-bearing users not yet processed at all) and `collisionPending` (informational only — a nonzero count is expected and does not fail the gate) separately. **Deliberately excludes `collision_pending` users from the "pending" count** — a user counts as processed once their id appears in any `identities.sourceUserIds` array, active or collision-flagged. Without this distinction the gate could never reach `'complete'` in any organization with an unresolved collision, contradicting ADR-0003's own framing of `collision_pending` as a permanent, safe fallback rather than an unfinished migration step.
- **Two new integrity checks**, wired into the existing `_integrityChecks()`/`check()` pattern: `_checkDanglingIdentityFK` (a `users.identityId` pointing at a nonexistent `identities` doc) and `_checkPasswordHashMismatch` (divergence between `users.password` and the linked identity's `passwordHash` — should always be 0 given Phase 1's dual-write; both sides null-normalized so OAuth users, who legitimately have neither field set, never false-positive).
- Both new checks and the new status function defined as standalone, individually-exported functions (attached on the router: `router._checkDanglingIdentityFK` etc.) rather than inline closures — `module.exports = router` is unchanged, but this makes them directly unit-testable without mocking the route's unrelated dependencies (RBAC scan, release-cert file reads, test-directory scan).
- `server/__tests__/routes/qa-health.test.js` — first test coverage this route has ever had. 12 tests, including a load-bearing one proving the `identity` gate reaches `'complete'` even with an active, unresolved collision.

### Not done (deliberately — this is Phase 2 of 4)

Still nothing reads `identities` to authenticate anyone — `auth.js`'s credential check is unchanged. This phase only adds visibility into whether the dual-write from Phase 1 is landing cleanly, ahead of Phase 3 (Cutover), which per ADR-0003's adoption gate may not begin while this gate is red.

### Governance

ADR-0003's Status/Implementation lines and the dependency graph's C8 row updated to reflect Phases 0-2 shipped.

Verification: full jest suite, 31 test suites, 349/349 passed.

---

## [v4.75.0] — 2026-07-18 — feat(auth): Identity separation Phase 1 — Dual-write (C8/MR-001)

### Added

- **Two-tier token revocation** (`server/utils/token-version.js`): new `getIdentityTokenVersion(identityId)`/`revokeIdentityTokens(identityId)`, an exact mirror of the existing `users.tokenVersion` pair but scoped to the shared `identities` credential — revoking it invalidates every token across every school sharing that credential. The existing `users.tokenVersion` pair is untouched (still correctly school-scoped for role-change/deactivation).
- **`authMiddleware` gained an additive `itv` check** (`server/middleware/auth.js`) — same "missing claim passes through" convention as the existing `tv` check, so every pre-migration token keeps working unmodified.
- **`_buildTokenPayload` gains `identityId`/`itv`** (`server/routes/auth.js`) — became `async` (one cached DB read), all 5 call sites (login, verify-otp, force-change, Google/Microsoft OAuth) updated to `await` it. Additive only — tokens for users without an `identityId` are unaffected.
- **All 4 password-write paths now dual-write and revoke**, closing a real pre-existing gap where **none of them ever revoked a session**, not even at the same school:
  - `POST /api/auth/change-password`, `POST /api/auth/force-change`, `PUT /api/settings` (self-service), `POST /api/settings/users/:id/reset-password` (admin reset) — each now writes the identical bcrypt hash (hashed once, never re-hashed — bcrypt is salted per call) to `identities.passwordHash` when the user has one, then calls `revokeUserTokens` (always) and `revokeIdentityTokens` (when `identityId` is set). Admin reset correctly revokes the **target**, not the admin performing the reset.
  - `/force-change` issues a fresh session token in the same request as the revocation — a staleness bug had to be designed around explicitly: the newly-issued token's `tv` is patched to the post-revocation value locally (since the `user` object was fetched before revocation), while `itv` needs no such patch (it's resolved via a fresh, cache-invalidated DB read inside `_buildTokenPayload`).
- 34 new jest tests across 4 files — the first coverage any of these 4 routes, `authMiddleware`'s `tv` check, or `token-version.js` itself has ever had: `token-version.test.js` (11), `middleware/auth-token-version.test.js` (10), `routes/auth-password-paths.test.js` (5), `routes/settings-password-paths.test.js` (5), plus 3 more folded into existing suites.

### Not done (deliberately — this is Phase 1 of 4)

`auth.js`'s credential **check** at login is unchanged — it still reads `users.password` exclusively. Only the **write** path dual-writes now. `rbac.js`/`scopeMiddleware.js` remain untouched. Phase 2 (Verify — extending `qa-health.js`'s gate pattern) and Phase 3 (Cutover) have not started.

### Governance

Two real bugs were caught and fixed by the new tests during development, not found by manual review: (1) a mock-fidelity issue where `.lean()` returned a live mutable reference instead of a snapshot, which was masking the intended `/force-change` `tv`-staleness fix — fixing the mock to snapshot-copy, as real Mongoose does, proved the actual fix works correctly; (2) an identity-cache test that mutated mock data directly instead of going through `revokeIdentityTokens()`, which bypassed the real cache-invalidation path and would have given a false pass. ADR-0003's Status/Implementation lines and the dependency graph's C8 row updated to reflect Phases 0-1 shipped.

Verification: full jest suite, 30 test suites, 337/337 passed.

---

## [v4.74.0] — 2026-07-18 — feat(auth): Identity separation Phase 0 — Shadow (C8/MR-001)

### Added

- **`identities` collection** — new, additive, `{orgId,email}`-scoped credential registry per ADR-0003 (Accepted 2026-07-18). Owns `passwordHash`, `mfaEnabled`, `tokenVersion`, `status` (`active`/`collision_pending`/`merged`/`archived`). `users` is **structurally unchanged** — same collection, same `{schoolId,email}` index, only a new `identityId` FK added.
- **`server/utils/provision-identities.js`** — `provisionIdentityForUser()`/`provisionIdentities()`, mirroring `provision-memberships.js`'s idempotent, self-healing pattern. Implements the never-auto-merge collision policy: two users sharing an email within the same organization only merge into one Identity when an existing Membership grant (the shipped Link Identity flow) already vouches they're the same person; otherwise both are flagged `collision_pending` and keep authenticating exactly as today, permanently, until a human resolves it. Chained into boot after `provisionMemberships()`.
- **13 AST-verified `users`-creation sites got a one-line provisioning hook** (11 production: `onboard.js` superadmin registration, `auth.js` Google/Microsoft OAuth auto-provision, `settings.js` invite + bulk-invite, `students.js` portal-account + bulk-portal-accounts + parent-account, `users.js` invite + bulk-invite, `import-export.js` teacher CSV `insertMany`; 2 demo seed scripts deliberately left to the batch backfill's self-heal instead). The original governance-doc "10-file blast radius" list was re-verified via a dedicated AST/semantic pass first (a hard prerequisite ADR-0003 itself named) — 4 of those 10 files turned out to be false positives (query/update `users` by `schoolId`, never create), and 3 real creation sites (`students.js`, `users.js`, `import-export.js` were on the list but under-counted) plus 2 demo scripts weren't on it at all.
- 12 new jest tests: `provision-identities.test.js` — fresh-identity creation, no-collision path, self-heal of missing `organizationId`, the merge-when-vouched-for path, the never-auto-merge collision_pending path, org-scoping (different orgs never collide), idempotency, malformed docs, batch backfill.

### Not done (deliberately — this is Phase 0 of 4)

**Nothing reads the `identities` collection anywhere.** `auth.js` still authenticates against `users.password` exclusively; `rbac.js` and `scopeMiddleware.js` are completely unchanged (confirmed, not assumed). Phases 1-3 (Dual-write — touches `/change-password`; Verify — extends `qa-health.js`'s gate pattern; Cutover — `auth.js`'s credential check) have not started. Per ADR-0003's own adoption gate, each remaining phase is independently verified before the next begins.

### Governance

D-003 (Identity ownership) ratified via ADR-0003 — ADR-0003 was drafted, presented for review, and explicitly approved before any code was written (the ADR's own adoption gate: "no implementation may begin until this ADR is explicitly approved, separately from any plan-mode approval that produced the document"). `docs/adr/ADR-0003-identity-separation-index-migration.md`'s Status/Implementation lines and the dependency graph's C8 row updated to reflect Phase 0 shipped.

Verification: full jest suite, 26 test suites, 306/306 passed.

---

## [v4.73.0] — 2026-07-18 — feat(platform): Capability/Entitlement registry (C3)

### Added

- **`entitlements` collection** — additive registry recording that a school holds a specific capability (e.g. `ai_reports`, `payroll`, `quickbooks_integration`) independent of its plan tier (`PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §8: "plans and features must never be coupled"). One doc per `{schoolId, key}` — granting an already-revoked key re-activates the same doc rather than duplicating it, preserving the grant history.
- **`server/utils/entitlements.js`** — `hasEntitlement(schoolId, key)`: pure, dependency-injectable read helper (active + non-expired). Not called from anywhere yet — exists as a tested primitive for the future gate-activation phase (dependency graph C10) to call instead of writing raw queries under a Kernel-tier change.
- **`GET/POST/DELETE /api/platform/schools/:id/entitlements[/:key]`** — list, grant (`{key, notes?, expiresAt?}`, 400 on an invalid key), and soft-revoke (status flips to `revoked`, the doc is never deleted). Grant responses include a `note` field stating the entitlement is recorded only and not yet consulted by any feature gate.
- **"Entitlements" action** on the Schools list (`_schoolRow()`) — a modal listing current grants with per-row Revoke, plus a small grant form (key / notes / optional expiry). The success toast echoes the API's `note` verbatim, same transparency convention as Membership Phase 1's Link Identity.
- `docs/PLATFORM_ADMIN_GUIDE.md` §6 gained "Link Identity" and "Entitlements" subsections (the former was missing from the guide since Membership Phase 1 shipped last version — added now alongside; also corrected a stale line claiming D-001 "remains unratified," which this session's earlier work already resolved).
- 19 new jest tests: `entitlements.test.js` (7 — active/expired/revoked/missing/DI'd) and `routes/platform-entitlements.test.js` (12 — list, grant, re-activation-not-duplication, soft-revoke, 404s, 400 on invalid key, and an explicit pinning test that granting/revoking never touches the `schools` collection or the plan cache).

### Governance

Confirmed via research: no entitlement/capability code existed anywhere in the repo before this — a clean, additive build, same risk class as Membership Phase 1. Per `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`'s own component matrix, C3 is "additive as a table... reversible... not user-visible until activated" — it does not meet ADR-0001's Kernel-tier bar (no query-layer or auth-layer behavior change), so no new ADR was required; `server/middleware/plan.js`'s `FEATURE_PLAN`/`planGate()` are completely untouched. Fixed the dependency graph's §5 status table: C3 marked done (registry only), C7 promoted from "in progress" to "done" (Phase 1 scope), C6 (Organization services) explicitly marked paused per direct instruction — schools remain operationally independent except for shared identity (C7) — and added a C10 row noting its dual-read design requirement.

Verification: full jest suite, 25 test suites, 294/294 passed.

---

## [v4.72.0] — 2026-07-18 — feat(platform): Membership model Phase 1 (shadow collection, platform-admin identity linking)

### Added

- **`memberships` collection** — additive, non-authoritative shadow of who has access to which school(s) (Constitution §10 Stage 2 / `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` C7). Indexed on unique `{id}`, unique `{userId, schoolId}`, plus `{schoolId}`/`{orgId}`/`{userId}` lookups. **Nothing reads this collection for login yet** — `auth.js`, `sessionService.js`, `rbac.js`, and `scopeMiddleware.js` are all unchanged; access continues to be governed solely by `users.schoolId`.
- **`server/utils/provision-memberships.js`** — `provisionMembershipForUser()` (dependency-injectable, idempotent upsert on `{userId, schoolId}`, self-heals a missing `school.organizationId` via the existing `provisionOrganizationForSchool()`) and `provisionMemberships()` (batch backfill, one Membership per existing user, chained after `provisionOrganizations()` at boot). Same crash-safe, non-fatal, interruption-safe pattern as the Organizations backfill.
- **`GET /api/platform/users/search?email=`** — cross-school identity search (something `/api/users` can't do, since it's always school-scoped by design). Strips password/MFA/token-version fields.
- **`POST /api/platform/memberships`** (`{userId, schoolId, role?}`) — grants an existing person access to a second school **under the same organization only**: 409 if the target school belongs to a different organization (Constitution §6's boundary, enforced in code, not just on paper), 409 on a duplicate membership. Logs via `AuditService`. Response includes an explicit `note` field stating the grant is record-only and does not yet enable login.
- **"Link Identity" action** in the platform dashboard's Organizations panel (per school, inside `viewOrgSchools()`) — search-by-email, pick a result, grant. The success toast echoes the API's `note` verbatim.
- **`docs/adr/ADR-0002-membership-model-phase1.md`** — scoped ownership section for Identity/Membership/Organization/School, explicit non-goals (no auth/JWT/RBAC changes, no School Switcher, no self-service org management, no cross-org linking).
- 23 new jest tests: `provision-memberships.test.js` (11 — backfill, self-heal, idempotency, malformed docs, DI'd single-user path) and `routes/platform-memberships.test.js` (12 — search + field stripping, 404s, the cross-org 409, the duplicate 409, and an explicit assertion that granting a membership never writes to the `users` collection).

### Governance

D-001 (multi-membership identity model) ratified in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` as **Organization-Scoped Identity**, resolving D-004 with it. Per the dependency graph's own Freeze Rule, D-001 gates C8 (making identity authoritative), not C7 (this shadow collection) — C7 depends only on C1+C4, both already done, so this phase was not blocked on ratification, though ratifying it first removed any ambiguity before writing the organization-boundary check into `POST /memberships`. Fixed the dependency graph's stale §5 build-status table (C4 was still marked "in progress... baseline 822" — corrected to Done at ratchet 24; added C7's in-progress status).

Verification: full jest suite, 23 test suites, 275/275 passed.

---

## [v4.71.0] — 2026-07-18 — test: fix jest running a stale worktree's tests; fix stale login-response assertion

### Fixed

- **`package.json`'s jest `testMatch` had no exclusion for `.claude/worktrees/`** — a leftover git worktree checked out on a completely different branch (a report-cards feature, different commit) has its own copy of `server/__tests__/**/*.test.js`. Every `npm test` silently ran that stale codebase's tests too, alongside the real ones, and identical-looking failures from the two unrelated checkouts read as one duplicated fact rather than two separate ones — several commits this session carried a "same 7 pre-existing failures" caveat that was actually conflating a real, single failing test on `main` with six failures from the unrelated worktree. Added `testPathIgnorePatterns` for `.claude/worktrees/`. The worktree itself is untouched.
- **The one real failure, root-caused**: `server/__tests__/routes/auth-session.test.js`'s `'response includes token and user'` asserted `res.body.token`, but `auth.js`'s `/login` deliberately puts the JWT in an HttpOnly, `SameSite=Strict` cookie only (`_setAuthCookie`) and never returns it in the JSON body — intentional XSS hardening. Confirmed the frontend (`client/src/pages/Login.jsx`) already only reads `res.user`/`res.school`, never `res.token` — the app was correct, the test was stale (written for an older API contract). Rewrote the assertion to check for the HttpOnly cookie instead of a body field that was deliberately removed by design.

Verification: full jest suite, 20 test suites, 245/245 passed, zero failures — the first fully clean run this session.

---

## [v4.70.0] — 2026-07-18 — feat(platform): create organizations and add multiple schools to one

### Added

- **`POST /api/platform/organizations`** — create an organization explicitly (`{ name, slug? }`, slug auto-derived from name if omitted). `multiSchoolEnabled` is hardcoded `false` and never accepted from the request body — see Governance note below.
- **`POST /api/platform/schools` accepts an optional `organizationId`** — adds the new school to that existing organization instead of the default (a brand-new 1:1 organization for it). When targeting an existing org, the school's slug is auto-namespaced under the organization's slug (`_deriveSlugForOrg` in `server/routes/platform.js`) — e.g. organization `green-valley` + campus slug `eldoret` → school slug `green-valley-eldoret` — so schools sharing an org are recognizable by URL, and idempotent (won't double-prefix a slug the admin already typed correctly).
- **`provisionOrganizationForSchool(school)`** (`server/utils/provision-organizations.js`) — the get-or-create-org-and-link logic extracted out of the batch backfill loop into a standalone, directly-callable function (dependency-injectable `{Schools, Orgs}` for testing). Both `platform.js`'s `POST /schools` and `onboard.js`'s public self-registration now call it **synchronously, immediately at provisioning time** — a school's organization no longer waits for the next server restart's backfill job to exist. The batch job (`provisionOrganizations()`) is unchanged in behavior and stays as the self-healing safety net for anything that predates this fix.
- **Platform dashboard**: "Create Organization" button on the Organizations panel (name + slug form in a modal). Provision School form gained an "Organization" dropdown (default: create a new one; or pick an existing organization), with a live hint showing the final namespaced slug as you type.
- 12 new jest tests: `_deriveSlugForOrg` (prefixing, idempotency, sanitization, length cap), `provisionOrganizationForSchool` (dependency-injected, same call shapes as the already-tested batch path), and `POST /api/platform/organizations` (creation, slug derivation, uniqueness, and — explicitly — that `multiSchoolEnabled: true` cannot be set via the request body).

### Fixed

- **`_sanitiseSlug` (in `platform.js`) stripped spaces instead of converting them to hyphens** — `"St Mary's Academy"` sanitised to `"stmarysacademy"` (one unreadable blob) instead of `"st-marys-academy"`. Found by a test written for the new slug-derivation logic, not observed in production. `onboard.js`'s equivalent (`slugFromName` calling `sanitiseSlug`) already handled this correctly via a separate whitespace-to-hyphen pass; fixed by folding that same step into `_sanitiseSlug` itself so every call site benefits, not just the ones that remember to pre-process.

### Governance

Checked against `docs/ARCHITECTURE_CONSTITUTION.md` and the governance corpus before writing any code, per direct request. The finding that shaped the design: `multiSchoolEnabled` is not a free-standing "does this org have >1 school" flag — Constitution §10 Stage 3 defines it as meaning specifically *"auth begins reading Memberships"*, a capability that doesn't exist yet (Memberships aren't authoritative, gated behind the still-unratified D-001). Grouping schools under one organization is safe and already schema-legal today (`schools.organizationId` → `organizations` is a plain, non-unique FK, "one org may own many schools" per its own index comment) — but flipping `multiSchoolEnabled` true before Stages 2–4 are built would claim a capability the code doesn't have. This feature therefore never sets that flag, touches no identity/session/JWT/login code, and only groups schools for admin visibility and reporting. Multi-school **login** (a school switcher, one admin account managing several campuses) remains a separate, larger, unbuilt capability gated behind D-001 — unaffected by this work. Public self-service registration (`onboard.js`) got the same immediate-provisioning fix but deliberately **not** an existing-organization picker: Constitution §6 requires an ADR and consent from both organization admins before any cross-org linking, and there's no sensible way for an anonymous registrant to be shown a list of organizations to join.

Verification: full jest suite, 393 passed (+12 from this round), same 7 pre-existing unrelated `auth-session.test.js` failures.

---

## [v4.69.0] — 2026-07-18 — feat(platform): Organizations dashboard panel; fix(boot): dev server no longer hangs without MongoDB

### Added

- **`GET /api/platform/organizations`** (`server/routes/platform.js`) — lists every organization with its member schools (grouped by `school.organizationId`, the FK `provision-organizations.js` backfills) and rolled-up plan/status stats (`schoolCount`, `activeCount`, `byPlan`). Surfaces `unlinkedSchools` — any school missing its `organizationId` FK, which shouldn't happen post-backfill but is worth knowing about if it does.
- **"Organizations" nav panel in `platform.html`** — new stat cards (total orgs, multi-school orgs, unlinked schools) and a table of organizations; a "View Schools" action opens a modal (via the dashboard's existing `showModal()` helper) listing each member school's plan and active status. Follows the file's established `render<Section>()` + `_<x>Row()` + `api()` pattern exactly — `platform.html` is a standalone static page (not part of `client/src`, not React), served by a special-cased Express route with a relaxed CSP.
- **`server/__tests__/routes/platform-organizations.test.js`** — 4 tests covering grouping, plan/status rollup, unlinked-school counting, and empty states. Had to mock `mongoose.model()` directly rather than `utils/model`, since `platform.js`'s routes call their own local `_model(col)` shadow (a lazy schema-less Mongoose factory), not the shared one — same pattern already used throughout that file for `schools`/`users`.
- **`.claude/launch.json`** — added a `server` launch config (`node server/index.js`, port 3005) alongside the existing `client` (Vite, port 5173) one.

### Fixed

- **`server/utils/indexes.js`'s `ensureIndexes()` had no guard for a missing MongoDB connection**, unlike `server/config/db.js`'s `connect()` (which already no-ops cleanly when `MONGODB_URI` is unset). Without a DB, every one of the ~150 `createIndex()` calls across every collection buffered against a connection that was never established and only gave up after Mongoose's default 10-second buffering timeout — sequentially, since they're not run in parallel. In practice this meant the server did eventually reach `app.listen()` in a no-DB dev environment, just after roughly 20 minutes of nothing but timeout logs, which made local verification of any change effectively impractical. Added the same `MONGODB_URI` guard `connect()` already uses (via a new `isConnected()` export from `server/config/db.js`) — `ensureIndexes()` now returns immediately, logging that it skipped, when there's no DB connection. No change to production behavior (a real `MONGODB_URI` still runs indexing exactly as before).

### Product context

Built in place of continuing the D-001 multi-school identity-scope decision (see `docs/governance/ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s Decision Register) — this is deliberately read-mostly visibility on data that already existed (the `organizations` collection, 1:1-backfilled per school since the Phase A/C1-C2 work), with no identity or login implications, so it didn't need D-001 resolved first. D-001 remains unratified. Every organization is currently 1:1 with exactly one school; this panel is the visibility layer built ahead of the capability to add a second school to an existing org, not a sign that capability exists yet.

Verification: 4 new jest tests passing; full suite at 381 passed, same 7 pre-existing unrelated `auth-session.test.js` failures. Live browser verification was not possible for most of this work — this sandbox has no MongoDB, and the `ensureIndexes()` hang above (found *while* trying to verify) blocked it entirely until fixed. After the fix, verified live: server boots in seconds instead of ~20 minutes without a DB.

---

## [v4.68.0] — 2026-07-16 → 2026-07-18 — feat(security): structural tenant isolation complete (ADR-0001 / C4)

### Added

- **`tenantModel(collection, ctx)`** (`server/utils/tenant-model.js`) — a wrapper around the bare `_model(collection)` accessor that force-scopes every query to `ctx.schoolId`, injecting it into filters, update payloads, aggregation `$match` stages, and bulk-write ops, and **throwing** if the caller supplies a conflicting `schoolId` or no tenant context at all. Where `_model()` would run any filter handed to it, `tenantModel()` structurally cannot return another school's data through its normal query surface. Full design and honest scope (what it does *not* cover — `.populate()`, raw driver access, transactions) in `docs/adr/ADR-0001-tenant-context-enforcement.md`.
- **`scripts/verify-tenant-coverage.js`** + **`scripts/_tenant-scan.js`** — a CI ratchet enforcing ADR-0001 §6: the count of direct `_model()` call sites on tenant-owned collections in `server/routes/` may only ever *decrease*. `scripts/.tenant-baseline` holds the ceiling; `--update-baseline` locks in a drop after a migration. Blocks any PR that adds new unprotected tenant access.
- **Cross-tenant regression suite** (`server/__tests__/routes/*-tenant-isolation.test.js`, plus `mechanical-routes-tenant-isolation.test.js` for the lower-risk routes) — seeds two schools' data and asserts School B's data never appears in a response authenticated as School A, for every migrated route. The required backstop per ADR-0001 §5 for the parts of the query surface the wrapper structurally can't reach.

### Changed — every route in `server/routes/` migrated (except two, see below)

Migrated incrementally, highest-risk first, exactly as ADR-0001 §6 prescribes — each route independently tested and revertible, no big-bang rewrite, no route's external behavior changed. In order: `attendance` → `finance` → `exams` → `students` → `report-cards` (the top-tier, highest-risk routes) → four batches of mechanical CRUD routes (~50 files) → the individually-careful ones with non-`req` helper functions or pre-auth flows (`timetable`, `lessons`, `academic-config`, `assessment`, `mpesa`, `import-export`, `auth`, `billing`, `bell-schedule`, `birthdays`) → three files with local `_model()` shadows (`events`, `messages`, `onboard`) → the 21 sites the ratchet scanner couldn't classify statically (`growth-records`, `backup`, `sync`, `collections`) → `platform.js`.

**Patterns established along the way** (see `docs/adr/ADR-0001-tenant-context-enforcement.md` §4 for the full, updated list):
- Helper functions that take `schoolId` as a parameter rather than `req` use `tenantModel(coll, { schoolId })` — `tenantContext(req)` isn't required, `{schoolId}` alone satisfies the contract.
- Unauthenticated bootstrap flows (Safaricom M-Pesa webhooks, `auth.js` login/OTP/OAuth before `req.jwtUser` exists) leave the query that *discovers* the tenant on raw `_model()`, documented inline as a reviewed exception — every query after the tenant is resolved uses `tenantModel()`.
- Fixed collection lists that mix platform-exempt names (`schools`) with tenant-owned ones (`backup.js`, `sync.js`) route through a small per-collection accessor checking `PLATFORM_COLLECTIONS.has(col)` first.
- **New structural gap found and documented**: filters using `$or` for dual-ID-forms (`{$or:[{schoolId:X},{schoolId:legacyObjectIdStr}]}`) or admin-recovery-by-email (`{$or:[{schoolId:X},{email:Y}]}`) — `tenantModel()`'s scoped-filter only recognizes a *top-level* `schoolId` key; wrapping these silently AND-injects one and makes the non-matching `$or` branch unreachable. Left on `_model()` in `platform.js`'s `/approve`, `/impersonate`, and both `DELETE /schools` routes, each with an inline comment.
- This migration repeatedly **closed latent gaps for free** — filters that previously had no `schoolId` at all (relying on `_id`/`id` uniqueness alone) now get it injected automatically by the wrapper. Called out per-commit rather than fixed silently elsewhere.

**`PLATFORM_COLLECTIONS`** (the exempt set) grew from 4 to 7: `platform_settings` and `landing_content` (singleton `id:'global'` config/CMS docs) and `system_announcements` (platform-wide, shown on every school's dashboard) were mis-classified as tenant data before — none carry a `schoolId` at all.

### Deliberately not migrated

- **`qa-health.js`** (11 sites) — every query (global collection counts, orphan/duplicate detection scanning all schools, migration-backfill tracking) is structurally required to be cross-school; the feature cannot work any other way. Confirmed by full read, not deferred.
- **`platform.js`** (8 sites) — genuinely platform-wide superadmin views (`/stats`, `/billing/all`, `/orphans`) plus the `$or`-fallback routes above. Not a gap — `IDENTITY_DOMAIN_MODEL_v1.md` explicitly places platform-admin (`platformSession`-protected, not school-JWT) outside this model entirely.
- **`mpesa.js`** (2 sites), **`billing.js`** (1), **`onboard.js`** (1), **`report-cards.js`** (1) — single documented bootstrap or platform-wide exceptions within otherwise fully-migrated files.

### Verification

Every migrated file: module-load check (no `ReferenceError`), then full jest suite. Held at **376–381 passed, 7 pre-existing unrelated `auth-session.test.js` failures** (confirmed pre-existing before this work started, identical error signatures throughout — not a regression) across every commit in the sequence. Ratchet: **722 → 24** direct-usage sites (101 platform-exempt, 9 dynamic sites remaining for manual review, both fully accounted for as reviewed exceptions).

This closes Governance Review finding **D1** (`PLATFORM_OPERATING_MODEL.md` P2 — "`schoolId` scoping is enforced at the data layer, not assumed at the route layer" — previously aspirational, now substantially true) and unblocks C4 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md`, the highest-fan-out root the multi-school evolution depends on. D-001 (identity scope) remains a separate, unratified decision — this work is explicitly decision-independent of it per ADR-0001's adoption gate.

---

## [v4.67.0] — 2026-07-12 — fix(seo): retire /faq into /knowledge; fix thin-content accordion bug on both

### Fixed

- **`/faq` and `/knowledge` were genuine duplicate content** — both rendered the same `FAQ_CATEGORIES` data through independently copy-pasted `FaqItem` components; `/knowledge` was the strict superset (guides + resources + the full FAQ), `/faq` was the FAQ alone with zero internal links pointing to it anywhere on the site. Retired `/faq`:
  - **`server/index.js`** — added a real HTTP 301 (`/faq` → `/knowledge`), placed before the static/wildcard handlers so it fires for every client, crawlers included — a client-side-only redirect would be invisible to any non-JS crawler that had already indexed `/faq`, the exact class of bug this session spent considerable effort fixing elsewhere.
  - **`client/src/App.jsx`** — matching `<Navigate to="/knowledge" replace />` route for in-app SPA navigation; removed the `FAQ` import.
  - **`client/src/pages/FAQ.jsx`** deleted.
  - Ported the `FAQPage` JSON-LD schema (Google's rich-snippet FAQ eligibility) from the deleted page into `KnowledgeCentre.jsx`'s `<Helmet>` — a naive delete-and-redirect would have silently lost this.
  - Updated `sitemap.xml` and `robots.txt`: removed `/faq`, added `/knowledge` (which, independent of this bug, had never been listed in either file since it launched).
  - Removed `/faq` from `client/scripts/prerender.mjs`'s `ROUTES` array (24 routes now, was 25).

- **Thin-content bug, found via a Bing Webmaster Tools word-count flag, confirmed by measuring actual rendered word counts across every marketing page rather than reacting to the generic tip at face value.** `/knowledge`'s and the (now-deleted) `/faq`'s FAQ accordion used `<AnimatePresence>{open && <motion.div>...}</AnimatePresence>` — this fully unmounts the answer text from the DOM when collapsed, not just visually hides it. A prerender pass that never clicks anything (this one doesn't) therefore captured 12 question headlines and **zero** answer text — confirmed directly: `/faq` measured 255 words prerendered, with 0 of the 12 answer paragraphs present in the rendered HTML. Fixed in both `FAQ.jsx` (before deletion) and `KnowledgeCentre.jsx` by keeping the answer `<p>` permanently in the DOM and animating `height`/`opacity` directly instead of mount/unmount — same visual interaction, but the text is always crawlable. `/knowledge`'s prerendered word count went from 485 to 1,157 as a direct result — real content depth, not padding.

Verified against real prerendered output, not assumption: ran `build:ssg` (24/24 routes succeeded), confirmed all 12 FAQ answers present in `dist/knowledge/index.html`, confirmed the `FAQPage` schema is intact, and verified the 301 via an isolated Express harness against the real `dist/` output (`/faq` → 301 → `Location: /knowledge` → 200 with the schema present).

---

## [v4.66.0] — 2026-07-09 — fix(seo): eliminate trailing-slash redirect on prerendered routes; harden prerender against partial failure

### Fixed

- **Root cause of a live outage traced this session**: Render's dashboard had its own Build Command setting (plain `npm run build`) silently overriding `render.yaml`'s `build:ssg` — a git push to `render.yaml` alone never took effect, since this service wasn't in Blueprint sync mode. Every marketing route except `/platform` (a stale leftover from an earlier successful deploy) was serving the raw unhydrated SPA shell to every crawler for an unknown period. Fixed on Render's dashboard directly (Build Command corrected); confirmed via build log showing the prerender script's own completion line.
- **`server/index.js`** — `express.static(REACT_DIST, { index: false, ... })` was missing `redirect: false`. `serve-static`'s default `redirect: true` issued a 301 to the trailing-slash form on every directory-matching request (`/why` → 301 → `/why/`) before the wildcard route's prerendered-file lookup ever ran. Final content was correct, but the served URL disagreed with `sitemap.xml` and every page's canonical tag (neither uses a trailing slash) — real SEO hygiene issue. Added `redirect: false`; routes now serve their prerendered file directly as 200.
- **`client/scripts/prerender.mjs`** — the per-route render loop had no error handling; one throwing/timing-out route could silently crash the whole script mid-build with no clear signal (Render's log just showed "Build successful" from the preceding plain `vite build`, no indication the prerender pass never ran or completed). Wrapped each route in try/catch so one failure can't take down the other 24; failures are logged loudly and summarized. Exit code is only set non-zero on **total** failure (0 routes) — a partial failure does not block deploying an otherwise-good build, since real users are unaffected regardless (the SPA shell fallback still serves those specific routes correctly).

Verified against live production, not just local: full route sweep confirmed 200 direct responses (no redirects) with correct content sizes across every marketing page after the fix deployed.

---

## [v4.65.0] — 2026-07-07 — feat(email): migrate platform SMTP from Gmail to Zoho (`support@msingi.io`)

### Changed

- **Platform sending address changed from `innolearnnetwork@gmail.com` to `support@msingi.io`**, hosted on Zoho Mail. This is the address used for all platform-level emails (registration, approvals, OTP) and as the fallback sender for any school without its own custom SMTP configured.
- **`server/utils/email.js`** — the platform transporter's `host` was hardcoded to `smtp.gmail.com`; made configurable via a new `SMTP_HOST` env var (default preserved as `smtp.gmail.com` so this code change alone, before Render env vars are updated, has zero behavior change). Added `SMTP_PORT` similarly (defaults to `587`, unchanged). This is the same host/port configurability pattern already used for per-school custom SMTP (`school.smtpHost`/`school.smtpPort`), now extended to the platform's own transporter.
- **`server/utils/billing-cron.js`** — updated the hardcoded email footer text from the old Gmail address to `support@msingi.io`.
- **`client/src/pages/settings/SettingsPage.jsx`** — updated the SMTP card copy shown to school admins describing the platform's default sending address.
- Updated all references across `docs/DEVELOPER_GUIDE.md`, `docs/DEPENDENCY_MAP.md`, `docs/PLATFORM_ADMIN_GUIDE.md`, `docs/SCHOOL_ADMIN_GUIDE.md`, `docs/USER_GUIDE.md` — the "must not be changed via Settings UI" governance rule for the platform's SMTP identity (`docs/DEPENDENCY_MAP.md` §20) is preserved unchanged; only the address behind it changed.

### Operational (Render dashboard, not code)

Deploying this code change alone does **not** switch providers — `SMTP_HOST` defaults to Gmail's host until explicitly overridden. To complete the migration, these env vars must be set together in Render → Environment:
- `SMTP_HOST=smtp.zoho.com`
- `SMTP_USER=support@msingi.io`
- `SMTP_PASS=<Zoho app-specific password>`
- `PLATFORM_EMAIL=support@msingi.io`

**Deliverability requirement:** SPF/DKIM/DMARC DNS records authorizing Zoho for `msingi.io` must be added in Cloudflare (Zoho's admin console provides the exact records) — without these, mail sent via the new SMTP host risks being flagged as spam or rejected by strict recipient servers, independent of whether the SMTP send itself succeeds.

---

## [v4.64.0] — 2026-07-07 — feat(monitoring): activate Sentry error tracking

### Added

- **`@sentry/node@^7`** installed as a production dependency, activating a Sentry integration that already existed in `server/utils/monitoring.js` but had never had the package installed — `_trySentry()` always hit its catch block and silently no-op'd. Pinned to v7 specifically (not latest) because `monitoring.js` calls the v7 `Sentry.Handlers.requestHandler()`/`Handlers.errorHandler()` API, which Sentry v8 removed.
- **`render.yaml`** — added `SENTRY_DSN` as a documented, optional (`sync: false`) env var, same pattern as `SMTP_USER`/`PLATFORM_EMAIL`. Unset by default; the server behaves identically to before until a real DSN is configured.
- Verified end-to-end in production: a temporary route intentionally throwing an error was added, triggered once, confirmed captured in the Sentry dashboard (tagged with route/method as designed via the existing `captureException()` context), then removed immediately — no permanent debug scaffolding left in the codebase.

No source files required changes beyond the dependency addition — `monitoring.js`'s `init()`/`requestHandler()`/`errorHandler()`/`captureException()` call sites in `server/index.js` were already correctly placed per Sentry's documented middleware ordering requirements.

---

## [v4.63.0] — 2026-07-07 — fix(seo,branding): activate prerender pipeline for crawlers; stop marketing-widget/favicon leaks onto real school pages

### Fixed

- **Public site was invisible to every non-JS crawler (Googlebot's sitemap fetcher, GPTBot, PerplexityBot, ClaudeBot, link-preview bots).** An SSG pre-render script (`client/scripts/prerender.mjs`, introduced v4.42.0) already rendered all public marketing routes to static HTML, but it was never actually wired into production:
  - `render.yaml` `buildCommand` ran `npm run build` (plain Vite build). Changed to `npm run build:ssg` (build + Puppeteer pre-render pass).
  - Even with pre-rendering run, `server/index.js`'s SPA wildcard route unconditionally served the root `dist/index.html` for every path — it never checked whether a pre-rendered `dist/<route>/index.html` existed on disk. Added a check: if a pre-rendered file exists for the request path (path-traversal guarded via `path.normalize` + `startsWith`), serve it; otherwise fall back to the SPA shell as before. Authenticated app routes (e.g. `/students`) have no pre-rendered file and are unaffected.
  - Verified locally: `npm run build:ssg` renders all 25 routes with real text content (confirmed via direct file inspection), and the exact path-resolution logic used in the Express fix was verified against the actual `dist/` output before deploying.
  - Note: the `<div id="pre-react-error" style="display:none;">` crash-fallback banner in `index.html` is invisible to real users and to any crawler that executes JS — it is not the cause of any "empty page" symptom; naive fetch-only tools that ignore CSS can misreport its text as visible page content.

- **Sitemap route coverage was stale in docs, not in the app.** `client/public/sitemap.xml` and `client/scripts/prerender.mjs`'s `ROUTES` array already list all 24 public marketing routes (not the 6 documented back in v4.42.0) — `docs/DEVELOPER_GUIDE.md` §36 updated to match current reality.

- **`FloatingWidgets.jsx` (global WhatsApp + scroll-to-top widget, mounted once in `main.jsx`) showed on every real school's `/login` page.** It only checked `isAuthenticated`, so a real school's login page — pre-authentication by definition — always showed the marketing widget. Now imports `detectSchool()` and hides whenever `isSchool` is true **unless** `slug === 'demo'` (demo is a live sales-demo surface, every other school is not), regardless of login state. This is a different component from the per-page `FloatingActions.jsx` used on Landing/FAQ/Contact/Plans/legal pages (v4.42.0/v4.9.6) — the two are not currently consolidated; see note in `docs/DEVELOPER_GUIDE.md` §36.

- **Favicon leaked between schools/landing page in the same browser tab.** `AppShell.jsx` mutates the single shared `<link rel="icon">` DOM node to the active school's uploaded favicon on mount, but had no cleanup — since SPA route changes don't reload the page, once a school's dashboard set the tab's favicon it stayed there even after navigating back to the landing page or into a different school in the same tab (reproduced via `?school=demo`, the documented dev/testing path in `schoolDetect.js`). Added an unmount cleanup that restores the default favicon (`/favicon.svg`) and page title (`Msingi`).

### Known issue (flagged, not fixed this release)

- **`/favicon.svg` referenced in `client/index.html` does not exist anywhere in the repo** (never committed). The "default" tab icon has been 404ing since before this fix — the favicon-leak fix above restores the *path*, not a working icon. Needs an actual SVG file added at `client/public/favicon.svg`.

---

## [v4.62.0] — 2026-07-03 — fix(students): root-cause fix for dual-identifier bugs (deactivate/reactivate/portal-account 500s, empty filtered lists) + bulk credentials CSV

### Fixed — the dual-identifier bug class

Student, class, and stream documents reference each other by whichever identifier form was current when they were written: the custom UUID `id` field (routes generate this) or the MongoDB `_id` string (pre-migration and imported records — the UUID migration never back-filled `id` onto old docs or rewrote denormalised references). Exact-string lookups/filters on one form silently miss documents written under the other. This one root cause produced a chain of distinct-looking symptoms, all fixed this release:

- **`PATCH /:id/deactivate` and `/:id/reactivate`** (`server/routes/students.js`) — added `_id` fallback lookup (matching the pattern already in `GET /:id`); `updateOne` now targets `{ _id: doc._id }` (always present) instead of `{ id: req.params.id }` (may be undefined on old records). Root-caused: "I only managed to activate one" / 500 on deactivate for imported students.
- **`POST /:id/portal-account` and `/:id/parent-account`** — same `_id` fallback added to the student lookup.
- **The actual 500 on portal-account creation** was a MongoDB index defect, not a lookup bug (see below) — the lookup fallback alone did not fix it; both were required.
- **`GET /students` list filters (classId, streamId, section)** and **`GET /classes/:id/students`, `GET /streams/:id/students`** — filters compared the raw URL param against `classId`/`streamId` as an exact string, missing students whose class/stream reference was stored in the other identifier form. New `_entityIdForms(col, schoolId, value)` helper in `students.js` resolves every identifier form an entity is known by; filters now `$in`-match all of them. The section-filter branch also no longer drops classes lacking a UUID `id` (previous `.map(d => d.id).filter(Boolean)` silently excluded them from the section entirely). **This is why a filtered Students list (and filtered Export, which uses the same endpoint) could return "No students found" for a student who was visibly enrolled in that exact class/stream.**
- **`PUT /:id` (student update)** — same `_id` fallback added before `applyOptimisticLock`, so pre-migration records can be edited (e.g. unassigning a stream) without a false "Student not found".
- **`StudentUpdateSchema` (Zod) rejected `null` on `streamId`/`classId`/`sectionId`/`houseId`/`keyStageId`.** `z.string().optional()` accepts `string | undefined`, not `null` — the stream-unassign action sends `{ streamId: null, streamName: null }` to clear the field, which Zod rejected before the route even ran, surfacing as "Validation failed" in the UI. Changed all association fields to `.nullish()`. `streamName` was also missing from the schema entirely (silently stripped, leaving stale denormalised data after an unassign) — added.
- **Client**: `StudentProfile.jsx` (`_call`, deactivate handler, reactivate button) and `StudentList.jsx`/`ClassDetail.jsx` (`unassign` mutation) now use `student.id ?? student._id` consistently. Reactivate button's empty `catch {}` replaced with real error surfacing via `setError()`.

### Fixed — root cause of the portal-account 500 (database index defect)

- **`users_school_email` and `users_school_username`** (`server/utils/indexes.js`) were **unique + sparse compound indexes** on `(schoolId, email)` / `(schoolId, username)`. Sparse compound indexes still index a document if it has *any* one of the keys — every user has `schoolId`, so every user (including email-less student accounts and username-less parent accounts) was indexed, as `(schoolId, null)`. The unique constraint then permitted only **one** email-less user per school — the first "Create Student Account" succeeded and took that slot; every subsequent one threw `E11000` → opaque 500. (`teachers_school_email` had the identical defect.) Replaced all three with **partial indexes** (`partialFilterExpression: { field: { $type: 'string' } }`) — uniqueness enforced only on real string values.
- `ensureIndexes()` now drops the three superseded indexes at startup (`DROP_INDEXES` list) before recreating them — MongoDB rejects redefining an index under the same key pattern with different options (error 85), so this migration step is required, not optional. Safe to run repeatedly (`IndexNotFound` on later startups is ignored).
- Account-creation routes (`portal-account`, `bulk-portal-accounts`) now **omit** the `email` field entirely when a student has no school email, instead of storing `email: null`.
- `POST /:id/portal-account` catch block now returns a `409` naming the conflicting field on `E11000` instead of a blind `500`, and its E11000 handler gained a username-conflict branch (finds and resets the conflicting account instead of throwing) alongside the existing email-conflict branch.

### Added

- **Bulk portal account activation now returns one-time credentials, downloadable as CSV.** `POST /api/students/bulk-portal-accounts` previously generated and hashed a random password per student but never returned it — bulk-created accounts had no way to reach the student without a manual per-student reset. Now returns `credentials: [{ name, admissionNumber, username, tempPassword, action }]`. Client (`StudentList.jsx`) chunks any selection size into batches of 200 (the server's per-request cap) sent sequentially, so 500+ imported students activate in one click; credentials auto-download as a UTF-8 CSV (name, admission number, temp password) and remain re-downloadable from the result banner until dismissed — passwords are never stored in plaintext and are unrecoverable after that. All accounts still force a password change at first login. The route also gained the same `_id` fallback and existing-account-by-username matching as the single-student route, plus a clear per-student error when an admission number is missing (previously an unhandled `TypeError`).

---

## [v4.61.0] — 2026-07-02/03 — fix(platform): admin console hardening + feat(login): floating-card redesign with per-school background image

### Fixed

- **Platform admin billing overview threw `SyntaxError: Unexpected token '<'`.** `renderBillingOverview` in `platform.html` used a raw `fetch` + `res.json()` with no handling for non-JSON responses (401 redirects, error pages). Replaced with the shared `api()` helper, which already handles session expiry and surfaces the real HTTP status.
- **`GET /api/platform/billing/all`** — fixed a route-level bug returning raw `res.json()` without the `ok`/`E` response envelope helpers, which were not imported in `platform.js`.
- **Platform admin login page** — hardened error display; fixed empty catch blocks that silently swallowed login failures.
- **`/platform` route CSP** — set a permissive, route-scoped Content-Security-Policy (`'unsafe-inline'` for script/style) to unblock the page's inline JS and Font Awesome CDN reliance; the React SPA keeps its strict global policy. Scoped to this one operator-only, cookie-session-gated route.
- **`PLATFORM_ADMIN_KEY` missing env var** — was a fatal startup guard; changed to a warning-only check so the server still starts (platform admin login is simply unavailable until the key is set), rather than crashing the whole deployment.
- **Analytics leadership dashboard (Attendance Risk, Behaviour Heatmap, Academic Health widgets)** showed raw MongoDB ObjectIds instead of class names. `classMap` was built only from classes' UUID `id` field, but older attendance/behaviour/grade records stored the MongoDB ObjectId as `classId`. Fixed by including both `c.id` and `String(c._id)` in the map.

### Changed

- **Login page redesign** — full-screen background image (per-school, configurable in Settings → Branding, falls back to an animated gradient) with a floating centered card, responsive across mobile/tablet/desktop. New `PUT`/`DELETE /api/settings/school/login-bg` endpoints; `loginBgUrl` added to `SCHOOL_UPDATABLE` and the public `school-info` response; `/api/public/school-asset/login-bg` endpoint added alongside the existing logo/favicon asset routes.
- **Login page icons** — replaced emoji (📬 🔑 🙈 👁 ⚠) with `lucide-react` icons (`Mail`, `KeyRound`, `Eye`, `EyeOff`, `AlertTriangle`) throughout all login modes (password, OTP, force-change) and the demo panel.
- **WhatsApp contact number and plan pricing** made dynamic — sourced from Platform Admin → Branding settings instead of being hardcoded, with corrected plan cache invalidation on change.
- Student & parent portal UI and dashboard header rebuilt; platform billing/plan labels corrected to match actual plan names.

---

## [v4.60.0] — 2026-07-02 — feat(rbac): Settings as control centre — MODULE_REGISTRY, principal role, per-user permission enforcement

### Added

- **`server/config/moduleRegistry.js`** — single authoritative list of all 22 platform modules. Exports `MODULE_REGISTRY` (full spec with keys, labels, sections, sub-permissions) and `MODULE_KEYS` (string array). All consumers — `onboard.js`, `repairPermissions.js`, `settings.js _deriveApiPerms`, and the Settings UI — now derive from this one file. Adding a module here automatically propagates to the R&P permission matrix, the Modules toggle tab, and the RBAC enforcement layer.

- **`principal` system role** — new built-in role above `deputy_principal`. Same default permissions as `deputy_principal`; admin can adjust from Settings → Roles & Permissions at any time. Added to: `SYSTEM_ROLES`, `SYSTEM_ROLE_LABELS`, `SYSTEM_ROLE_COLORS`, `_makeDefaultPerms`, `onboard.js` role seeding, `repairPermissions.js` defaults, and `BUILTIN_INVITE_ROLES`.

- **Per-user permission overrides — now fully enforced** at every layer of the stack. Previously, the "Per User" tab in Settings → Roles & Permissions stored overrides in `school.modulePermissions.byUser` (UI display only) but they were never translated to actual RBAC enforcement. Now:
  - `PUT /api/settings/school`: when `modulePermissions.byUser` is saved, server derives action arrays from each user's V/E/D cell map and writes a `role_permissions` document keyed by `userId` (not `roleKey`) for each user.
  - **RBAC middleware** (`server/middleware/rbac.js`): `_loadUserPerms(schoolId, userId)` loads the user-specific doc (5-minute cache) and merges it on top of role permissions. User overrides win per module.
  - **`_loadMergedPermissions`** (`server/routes/auth.js`): accepts `userId` param; applies user-specific doc overrides at login and on every `GET /api/auth/permissions` call, so the JWT session and sidebar filtering honour user-level overrides immediately.

### Changed

- **`admin` role removed from RBAC bypass** (`server/middleware/rbac.js`). `SUPERROLES` now contains only `superadmin`. Admin reads from its `role_permissions` document just like every other role. Out of the box, admin still has RCUD for all modules (seeded at onboarding), so behaviour is unchanged for existing schools — but superadmin can now restrict admin access to specific modules from Settings → Roles & Permissions.

- **`server/routes/auth.js`** — `GET /api/auth/permissions` no longer short-circuits for admin with `null` (full access). Admin receives its real permission map from the database. `_loadMergedPermissions` signature extended to `(schoolId, roles, userId)`.

- **`client/src/store/auth.js`** — `can(feature)` no longer hardcodes `role === 'admin'` as full access. Only `role === 'superadmin'` or `permissions === null` returns true unconditionally. Admin's sidebar and `can()` calls now reflect its actual `role_permissions` document, which superadmin can edit.

- **ModulesTab** (`SettingsPage.jsx`) — hardcoded `MODULES_MASTER` list removed. Tab now fetches from `GET /api/settings/modules` (MODULE_REGISTRY). Any module added to the server registry auto-appears in the toggle list without a client deploy.

- **Settings R&P tab** — removed the silent background auto-sync that fired `settingsApi.school.update()` every time the tab was opened. Replaced with an amber "New modules detected" banner that appears only when the registry has modules not yet saved in the school's permission matrix, prompting the admin to click "Apply & Save" explicitly.

- **`server/routes/settings.js` school save handler** — `SKIP_ROLES` reduced from `['superadmin', 'admin']` to `['superadmin']` so admin's V/E/D matrix is now written to `role_permissions` when saved.

- **`server/utils/repairPermissions.js`** — `principal` added to `ROLE_DEFAULTS`; `repairPermissions()` will seed/patch the `principal` doc for all existing schools on next server restart.

### Architecture

This release makes **Settings the single control centre** for the entire permission model:

| Layer | Before | After |
| :---- | :------ | :----- |
| RBAC middleware | superadmin + admin bypass | superadmin only bypasses |
| Per-user overrides | stored in school doc (UI only) | enforced at RBAC + login |
| Module list | 4–5 separate hardcoded lists | one `moduleRegistry.js` |
| ModulesTab | hardcoded 18-module list | live from MODULE_REGISTRY |
| Settings auto-sync | fired silently on tab open | explicit Save with banner |

**Permission enforcement chain (complete):**

```
Admin saves Settings → PUT /settings/school
  → byRole cells → _deriveApiPerms → role_permissions (per roleKey)
  → byUser cells  → _deriveApiPerms → role_permissions (per userId)
  → invalidatePermCache(schoolId)

User requests any API → RBAC middleware
  → superadmin? bypass
  → load role_permissions[roleKey] + role_permissions[userId]
  → merge (user overrides win per module)
  → check module+action → 403 or next()

User login / window focus → _loadMergedPermissions(schoolId, roles, userId)
  → union of all role docs → merge user-specific doc on top
  → attach to user.permissions in JWT / GET /permissions response
  → AppShell refreshes sidebar computeNav()
```

Custom roles and per-user overrides are both first-class citizens at every layer.

---

## [v4.59.0] — 2026-07-01 — feat(governance): AuditService — Governance subsystem foundation

### Added

- **`server/services/audit.js`** — `AuditService` with two public methods:
  - `log({ action, actor, schoolId, target, details, severity, req })` — append-only, non-fatal (exceptions are caught and printed; a broken audit log never blocks a school workflow).
  - `query({ schoolId, action, actorId, severity, from, to, page, limit })` — paginated, filterable. School admins are scoped to their own school; superadmin queries platform-wide.
  - `ACTIONS` catalogue — 16 named action types with default severities: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`, `auth.mfa_verified`, `user.role_changed`, `user.created`, `user.deactivated`, `student.deleted`, `student.deactivated`, `student.promoted`, `report_card.publish`, `report_card.unpublish`, `report_card.moderation_bypassed`, `platform.impersonate`, `platform.school_deleted`, `platform.backup_restored`.

- **`server/routes/audit.js`** — `/api/audit` endpoints, admin + superadmin only:
  - `GET /api/audit` — paginated audit log list with filters: `action`, `severity`, `actorId`, `from`, `to`, `page`, `limit`. School admins see only their school; superadmin can pass `?schoolId=` or omit for platform-wide.
  - `GET /api/audit/actions` — returns the ACTIONS catalogue for filter dropdown population.

- **`server/utils/indexes.js`** — `audit_logs` collection indexes: `al_school_date` (`schoolId + createdAt -1`), `al_action_date` (`action + createdAt -1`), `al_actor` (`actor.userId`), `al_severity_date` (`severity + createdAt -1`), `al_date_desc` (`createdAt -1`).

- **Settings → Audit Log tab** (`SettingsPage.jsx`) — admin-only tab with:
  - Filter bar: action dropdown (populated from `/api/audit/actions`), severity dropdown, from/to date pickers, Clear button.
  - Paginated table: time, action (monospace), severity badge, actor email, target label.
  - Severity badge colours: info → sky, warn → amber, critical → red.

- **Platform Console → Recent Critical Events section** (`PlatformConsole.jsx`) — superadmin-only section showing the last 20 critical events platform-wide in a compact table.

### Changed

- **`server/routes/auth.js`** — `POST /api/auth/login` logs `auth.login` after the `lastLogin` update (successful password login path only).
- **`server/routes/students.js`** — `DELETE /:id` logs `student.deleted`; `PATCH /:id/deactivate` logs `student.deactivated` with `{ status, reason }` in details.
- **`server/routes/report-cards.js`** — `POST /publish` logs `report_card.publish` with `{ batchId, termId, studentCount, status }` after batch completion.
- **`server/routes/platform.js`** — `POST /schools/:id/impersonate` replaces the ad-hoc `platform_audit_log` collection write with `AuditService.log('platform.impersonate', ...)`. The `platform_audit_log` collection is deprecated — reads still work but no new writes go there.
- **`server/routes/users.js`** — `POST /:id/role-change` logs `user.role_changed` with `{ oldRole, newRole, note }` after the role-change email is sent successfully.
- **`server/index.js`** — registers `app.use('/api/audit', require('./routes/audit'))`.

### Architecture

AuditService is the foundation of the **Governance subsystem** (Platform Kernel §2.7). The collection is append-only by convention — no `updateOne` or `deleteOne` calls are permitted against `audit_logs`. Instrumentation follows the "high-impact first" principle: publish, delete, deactivate, impersonate, role change are the actions that matter most for accountability and regulatory compliance.

**Subsystem state after this release:**

| Subsystem | State |
| :-------- | :---- |
| Identity | Instrumented — `auth.login`, `user.role_changed` now in audit log |
| Governance | **Active** — `audit_logs` collection live, AuditService deployed |
| Compliance | Next: `audit_log_completeness` check in compliance engine |

**Not yet instrumented** (Phase 1 continuation):
- `auth.login_failed` (failed login path in auth.js)
- `auth.password_changed` (change-password route)
- Finance mutations (invoice create, receipt, fee-structure change)
- Bulk import/export
- Permission matrix changes (`PUT /api/settings/roles`)

---

## [v4.58.0] — 2026-06-19 — feat(scope): DataScope engine — third authorization layer

### Added

- **`server/middleware/scopeMiddleware.js`** — Async middleware that sits after RBAC and determines *which records within a permitted module* the current user can see. Injects `req.scope` with `{ level, classIds, subjectIds, houseIds, departmentIds, unrestrictedModules }` based on the user's teaching assignments. School-level roles (admin, deputy principal, finance, HR, etc.) get `req.scope = null` — no record restrictions. Role→scope level mapping: `teacher → assigned`, `section_head → section`, `admin/deputy_principal/etc → school`. Custom roles fall back to their `baseRole`'s scope level, then to `assigned` (strict deny). 5-minute cache keyed on `userId::schoolId`, matching the RBAC permission cache pattern.

- **`server/utils/scopeEngine.js`** — `ScopeEngine.applyToFilter(req, module, filter)` — single call that enforces scope on any MongoDB filter object. Handles three cases: no existing field (adds `$in`), string field (validates against scope, replaces with `__no_match__` if out of scope), existing `$in` (intersects with scope). Also exports `hasNoAssignments(req, module)` for returning structured "no assignments" responses, and `isUnrestricted(req, module)` for module-level bypass checks. Supports modules: `students`, `classes`, `class-subjects`, `attendance`, `grades`, `assessment`, `report_cards`, `growth_records`, `lessons`, `exams`, `timetable`.

### Changed

- **`server/routes/students.js`** — `GET /` applies `scopeMiddleware` + `ScopeEngine.applyToFilter`. Teachers see only students in their assigned classes. Returns `meta.noAssignments: true` when a teacher has no assignments configured, instead of a silent empty array.
- **`server/routes/attendance.js`** — `GET /` and `GET /summary` apply scope. Teachers mark and view attendance only for their assigned classes.
- **`server/routes/grades.js`** — `GET /` applies scope. Teachers read and enter grades only for their assigned classes.
- **`server/routes/lessons.js`** — `GET /coverage` applies scope. Teachers can only request coverage data for classes they are assigned to; returns 403 with a clear message if they request an out-of-scope class.
- **`server/routes/teaching-assignments.js`** — POST/PUT/DELETE now call `invalidateScopeCache(teacherId, schoolId)` after successful mutations, so the teacher's scope cache reflects assignment changes immediately (not after the 5-minute TTL expires).

### Architecture

Three authorization layers now operate in sequence on every request:

```
Authentication  →  Who are you?
RBAC            →  Can you access this module?         (rbac() middleware)
DataScope       →  Which records in this module?       (scopeMiddleware + ScopeEngine)
```

**Strict mode enforced:** A teacher with zero teaching assignments sees zero students/classes/grades. The frontend receives `meta.noAssignments: true` and should show "No teaching assignments have been configured. Contact your administrator."

**Behaviour module is unrestricted for teachers** by design — teachers can reward or record incidents for any student across the school. This is encoded in `SCOPE_EXEMPT = ['behaviour', 'events', 'messages', 'announcements']`.

**`teaching_assignments` is the single source of truth** — scope derives entirely from that collection. Nothing is duplicated elsewhere.

**Scope cache invalidates automatically** when assignments are created, updated, or deleted. The 5-minute TTL is the worst-case staleness window only if the server restarts between the assignment write and the cache bust.

### Remaining scope integration (Phase 2 — same pattern)
Apply `scopeMiddleware` + `ScopeEngine.applyToFilter` to: `assessment.js`, `report-cards.js`, `exams.js`, `growth-records.js`, `classes.js`, `timetable.js`. The engine is built; wiring is per-route.

---

## [v4.57.0] — 2026-06-19 — feat(rbac): settings.js fully governed — 22 endpoints converted, coverage 80.18%

### Changed

- **`server/routes/settings.js`** — Converted all 22 admin-gated endpoints from scattered inline `_isAdmin()` guards to governed `rbac('settings', action)` middleware. This moves the settings module from "hidden inline checks" into the formal RBAC system where access is driven by `role_permissions`, tracked by the CI gate, and visible in the Platform Architecture Manifest.

  **Permission mapping applied:**

  | Action | Endpoints |
  | :----- | :-------- |
  | `settings.read` | GET /school/users, GET /notifications, GET /custom-roles, GET /admission-counter |
  | `settings.update` | PUT /school, PUT+DELETE /school/logo, PUT+DELETE /school/favicon, POST+DELETE /school/smtp, POST /school/smtp/test, PUT /users/:id, POST /users/:id/reset-password, PUT /notifications, PUT /custom-roles/:key, PUT /admission-counter |
  | `settings.create` | POST /users/invite, POST /users/bulk-invite, POST /custom-roles |
  | `settings.delete` | DELETE /users/:id, DELETE /custom-roles/:key |

  **Intentionally left auth-only (no RBAC):**
  - `GET /` — own account info (every role reads their own profile)
  - `PUT /` — own password/name change (own-account pattern)
  - `GET /school` — school name/logo/timezone readable by all authenticated users (teachers, students etc. need this for display)

  **Inner superadmin-only guards preserved** (these enforce finer-grained constraints within the admin tier and are not replaceable by RBAC):
  - `POST /users/invite` — only superadmin can invite other admins
  - `PUT /users/:id` — only superadmin can assign admin role
  - `POST /users/:id/reset-password` — only superadmin can reset another admin/superadmin's password

  **Removed:** `_isAdmin()` helper function (no longer called anywhere — all callers replaced by `rbac()` middleware).

  **`settings` module already in `ALL_MODULES`** in `repairPermissions.js` and `onboard.js` — non-admin roles have `settings: []` by default, so RBAC middleware correctly blocks them with 403, identical to the old inline guard behaviour. No data migration needed.

### Platform Impact

| Metric       | Before  | After   | Delta   |
| :----------- | ------: | ------: | ------: |
| RBAC         | 73.48%  | 80.18%  | +6.70%  |
| Audit        | 0%      | 0%      | ±0%     |
| Rate-limited | 0%      | 0%      | ±0%     |
| Governed endpoints | 241 | 263 | +22 |

*This release closes the last batch of scattered inline admin guards. All remaining MISSING endpoints are Phase 2 targets (rooms, sections, academic-config, elearning, etc.).*

---

## [v4.56.0] — 2026-06-19 — fix: School tab hidden from non-admin users in Settings

### Fixed

- **`client/src/pages/settings/SettingsPage.jsx`** — `school` tab was visible to teachers and other non-admin roles. Root cause: `adminOnly` flag was `false` on the School tab entry in the `TABS` array. Changed to `true` so it is filtered out by the existing `visibleTabs` logic for all non-admin roles. Also moved `useAuthStore` above `useState` and changed the initial tab to `isAdmin ? 'school' : 'account'` — previously non-admin users would open Settings with `'school'` as the active tab (an invisible tab), causing a broken initial render. Non-admins now land on Account.

### Security note

The School tab gives access to school profile, branding, and logo — school identity changes. Only `admin` and `superadmin` roles should have access. This was a frontend visibility gap (backend endpoints already require admin-level RBAC); the fix closes the UI surface.

---

## [v4.55.0] — 2026-06-19 — Risk Classification + Eight Gates + Trust & Compliance Sprint Plan

### Added

- **`scripts/_risk-classify.js`** — Internal module that assigns a risk level (`critical | high | medium | low`) to every HTTP endpoint based on file, HTTP method, and path patterns. Critical escalations: `/purge`, `/bulk`, `/smtp`, `/mpesa`, `/payment`, `/reset-password`, `/otp`, `/invite`, `/role-change`, `/custom-roles`, `/permissions`, `/lock`, `/unlock`. DELETE methods escalate one level above file base. Used by the manifest generator to power the risk breakdown and critical gap list.
- **`PLATFORM_ROADMAP.md — Eight Production-Readiness Gates`** — Formal production checklist replacing informal "looks good" standard. Gates: functional correctness, authentication, RBAC, tenant isolation, audit logging, rate limiting, regression tests, platform health. Risk-gate mapping defines which gates are required per risk level (critical → all 8; low → 2 gates).
- **`PLATFORM_ROADMAP.md — Release Metric Trends table`** — Tracks RBAC %, audit %, rate-limit %, and health score per release. Seeded with v4.52 and v4.54 baselines. Sprint targets populated through Phase 4.
- **`PLATFORM_ROADMAP.md — Platform Impact format`** — Standard block for CHANGELOG entries that affect platform metrics. Forces every developer to measure quality impact alongside functionality.

### Changed

- **`PLATFORM_ROADMAP.md`** — Phase 1 renamed from "Accountability" to **"Trust & Compliance Sprint"** (accountability + traceability + compliance + operational trust). Rate limiting moved from Phase 4 into Phase 1 as a non-deferrable priority — `0/450` rate-limited endpoints is unacceptable for critical attack surfaces (login, OTP, import/export, payment callbacks). Priority order documented.
- **`scripts/generate-endpoint-inventory.js`** — Now imports `_risk-classify.js` and adds a `risk` field to every endpoint entry. Output now includes risk breakdown (`critical: 107, high: 92, medium: 155, low: 96`) and a `criticalMissingGates` list in the `gaps` section — highest-priority Sprint 1 work. Console output shows the list of critical endpoints missing RBAC or audit with `[missing: RBAC, Audit]` annotation.

### Platform Impact

| Metric       | Before  | After   | Delta   |
| :----------- | ------: | ------: | ------: |
| RBAC         | 73.48%  | 73.48%  | ±0.00%  |
| Audit        | 0%      | 0%      | ±0%     |
| Rate-limited | 0%      | 0%      | ±0%     |
| Critical gaps identified | — | 62 | new visibility |

*No regressions. This release adds measurement, not changes to existing gates.*

---

## [v4.54.0] — 2026-06-19 — Pre-Sprint 1: Platform Maturity Roadmap + Tooling Improvements

### Added

- **`PLATFORM_ROADMAP.md`** — Permanent engineering document defining 6 platform maturity phases (Sprint 0–5): Security Foundation → Accountability → Authorization Completion → Governance → Observability → Enterprise Readiness. Includes exit criteria per phase, per-sprint metric targets, platform integrity scores, and a decision log. Primary Sprint 1 objective: Audit Framework (`Audit-logged: 0/450` → 100% of high/critical actions). See file for full detail.
- **`scripts/.rbac-history`** — Persisted coverage history log. Each `--update-baseline` call appends a line (`date  version  coverage  protected/total`). Gives management visibility into engineering quality improving over time. Seeded with Sprint 0 baseline entry: `2026-06-19  v4.52.0  73.48%  (241/328)`.
- **`scripts/platform-health.js`** — Unified platform health check (`npm run platform:health`). Aggregates: RBAC coverage (live scan, consistent with CI gate), coverage history, audit infrastructure status, rate limiting, tenant isolation, identity health (from repair report), and security manifest freshness. Exits 1 if any critical check fails. Currently reports 1 critical failure: `Audit coverage: 0/450` — accurate, Sprint 1 objective.
- **`scripts/_rbac-scan.js`** — Shared internal module containing the route-scanning logic (allowlists, own-account patterns, regex). Both `verify-rbac-coverage.js` and `platform-health.js` import it, ensuring both scripts report identical numbers.

### Changed

- **`scripts/verify-rbac-coverage.js`** — Upgraded to decimal precision (`73.48%` not `73%`) so micro-regressions are caught. Now reads baseline as `parseFloat`. On `--update-baseline`, also appends to `scripts/.rbac-history` with date + package version. Internals refactored to use shared `_rbac-scan.js` module.
- **`scripts/.rbac-baseline`** — Updated from integer `73` to decimal `73.48` (the exact Sprint 0 floor).
- **`scripts/generate-endpoint-inventory.js`** — Renamed from "Platform Security Manifest" to **"Platform Architecture Manifest"** (schema v2). Added `rateLimit` column (detects rate-limiting middleware per route). Added `gaps` section to output JSON with pre-computed lists: `noRbac`, `noAudit`, `noRate`. Console output now shows `Rate-limited: N/total` alongside audit and tenant stats, making all four security dimensions visible in one run. Refactored to use shared `_rbac-scan.js` allowlist constants.
- **`package.json`** — Added three platform scripts:
  - `npm run platform:health` → `node scripts/platform-health.js`
  - `npm run platform:manifest` → `node scripts/generate-endpoint-inventory.js`
  - `npm run platform:coverage` → `node scripts/verify-rbac-coverage.js`

### Technical Notes

- `Rate-limited: 0/450` is accurate: `express-rate-limit` is applied globally in `server/index.js` (invisible to static route analysis). Route-level rate limiting is the Sprint 4 target. The `0` is not a false negative — it reflects the absence of per-route limiter middleware.
- `platform:health` exits 0 (warnings) or 1 (critical failures). Audit being `0/450` is currently flagged as critical — once `AuditService` is built in Sprint 1, this resolves automatically as routes are instrumented.
- The shared `_rbac-scan.js` prefixed with `_` signals it is an internal module — not a runnable script, not part of public API.

---

## [v4.53.0] — 2026-06-19 — Sprint 0 Sign-off: Non-Regression Gate + Security Manifest + Identity Framework

### Changed

- **`scripts/verify-rbac-coverage.js`** — Replaced fixed 73% threshold with a **non-regression ratchet**. Coverage is now compared against a committed baseline (`scripts/.rbac-baseline`). Pipeline blocks if coverage drops below the baseline; passes if it holds or improves. Run `--update-baseline` after improving coverage to lock in the new floor. Output now renders a progress bar, baseline delta, and count of remaining endpoints. Sprint milestones: 73% (Sprint 0) → 85% (Sprint 1) → 100% (final).
- **`scripts/generate-endpoint-inventory.js`** — Promoted from one-time report to **permanent Platform Security Manifest** (schema v2). Every endpoint entry now includes: `rbacModule` + `rbacAction` (extracted from `rbac()` call arguments), `tenantScoped` (schoolId referenced in handler context), `auditLogged` (audit log call present), `hasPlan` (planGate applied). Output also includes a `moduleCoverage` section listing all rbac-protected modules and the actions they cover. Current: 22 modules, 407/450 endpoints tenant-scoped, 0/450 audit-logged (audit logging is a Sprint 1 item).
- **`scripts/repair-identity.js`** — Generalised from teachers-only to a **multi-entity identity repair framework**. Introduces `ENTITY_CONFIGS` array: add one entry per user-linked entity to extend coverage. Currently configured for `teachers` (match by email) and `students` (match by email, narrowed to `role: student` accounts). Supports `--entity <teachers|students>` flag to scope repair to one type. Parent identity check (a different pattern — parents are users, not entity→user links) and staff are noted for Sprint 1. Permission patch logic (hr/analytics back-fill) unchanged.

### Added

- **`scripts/.rbac-baseline`** — Committed baseline file. Contains `73` (the Sprint 0 floor). CI reads this; developers ratchet it upward as coverage improves. Never decremented.

### Technical Notes

- `Audit-logged: 0/450` in the manifest is accurate — the platform has no audit log infrastructure yet. This becomes the primary Sprint 1 observability item alongside the Permission Trace feature.
- The generate script's `auditLogged` field uses a static grep over handler context (`auditLog(`, `_audit(`, etc.). Once audit infrastructure is built, the grep pattern will match automatically with no script changes needed.
- The inventory script's business coverage (68%) differs from the CI gate (73%) intentionally: the gate applies allowlists and own-account patterns; the manifest shows the raw unfiltered picture for visibility.

---

## [v4.52.0] — 2026-06-19 — Security Integrity Audit Sprint 0: RBAC Hardening

### Security

- **`server/routes/finance.js`** — Fixed wrong permission action on `PUT /fee-structures/:id`: was `rbac('finance', 'create')`, now correctly `rbac('finance', 'update')`. Fee structure edits were being blocked for roles with only update permission.
- **`server/routes/hr.js`** — Replaced inline `HR_ROLES` Set checks on all HR management endpoints (`PATCH /leave/:id/resolve`, `GET|POST|PATCH|POST|DELETE /payroll*`, `POST|PUT|DELETE /documents*`, `GET /summary`) with `rbac('hr', read|create|update|delete)` middleware. Own-account routes (`GET /leave`, `POST /leave`, `GET /documents`) kept as auth-only. Fine-grained state checks (`paid` status gate, `confirmed/paid` delete gate) preserved alongside rbac.
- **`server/routes/assessment.js`** — Replaced inline `LOCK_ROLES` Set on `POST /schedule/:id/lock` and `POST /schedule/:id/unlock` with `rbac('assessment', 'update')`.
- **`server/routes/timetable.js`** — Replaced inline `_canEdit()` checks with `rbac('timetable', ...)` on substitution and publish routes. Added missing `PLAN` middleware to `/status`, `/publish`, `/unpublish`, `/versions`. Full set: `GET /status`, `POST /publish`, `POST /unpublish`, `GET|POST|PUT|DELETE /substitutions*`, `GET /versions`, `GET /available-teachers`.
- **`server/routes/analytics.js`** — Replaced inline `LEADERSHIP_ROLES` Set on `GET /leadership` with `rbac('analytics', 'read')`.
- **`server/routes/report-cards.js`** — Added `rbac('report_cards', 'read')` to `GET /draft-comments` and `rbac('report_cards', 'update')` to `PUT /draft-comments/:studentId`. These endpoints were previously auth-only.
- **`server/routes/students.js`** — Replaced inline `ADMIN_ROLES` array on `DELETE /purge` with `rbac('students', 'delete')` and inline `allowed` array on `POST /promote` with `rbac('students', 'update')`.
- **`server/routes/import-export.js`** — Added dynamic RBAC gate to `POST /:type` (checks `tpl.rbacRes` + `create`) and `GET /export/:type` (checks `EXPORT_MODULE[type]` + `read`). Previously any authenticated user could bulk-import or export all school data. Also fixed `_importTeachers` to write `userId` back to the `teachers` collection for all successfully imported teachers (matched by email via a post-insert `emailToUserId` Map).

### Changed

- **`server/routes/settings.js`** — Permissions sync (`PUT /roles`) now uses per-field `$set` (`permissions.moduleKey`) instead of full-object replacement (`{ $set: { permissions: derived } }`). Prevents non-MODS modules (library, hostel, transport) from being wiped when an admin saves the Roles tab.
- **`server/routes/onboard.js`** — Added `'hr'` and `'analytics'` to `ALL_MODULES` so new schools are seeded with these permissions from day one. Added `hr: RCUD` to `hr` role default, `analytics: R` to `deputy_principal` and `section_head` defaults, `hr: RCUD, analytics: RCUD` to `admin` default.
- **`server/routes/settings.js`** (MODS array) — Added `'analytics'` to the 17-module MODS array that is synced from the Settings V/E/D matrix to `role_permissions` on every save.
- **`client/src/pages/settings/SettingsPage.jsx`** — Added `analytics` entry to `PERM_MODULES` (label: "Analytics Dashboard", sub: "View Leadership Analytics"). Added `analytics → V` defaults in `_makeDefaultPerms` for `deputy_principal` and `section_head`.

### Added

- **`scripts/repair-identity.js`** — One-time migration script. (1) Links `teachers.userId` for all teachers with a null/missing userId by matching on email against the `users` collection. (2) Patches `role_permissions` to add `hr` and `analytics` permission arrays for schools onboarded before those modules were added. Supports `--dry-run` and `--school <schoolId>` flags. Writes `scripts/repair-identity-report.json`.
- **`scripts/generate-endpoint-inventory.js`** — Scans all `server/routes/*.js` files and classifies every HTTP endpoint as `rbac`, `auth-only`, or `public`. Writes `scripts/endpoint-inventory.json` with per-endpoint metadata and a business-coverage summary. Run with `node scripts/generate-endpoint-inventory.js`.
- **`scripts/verify-rbac-coverage.js`** — CI security gate. Fails with exit code 1 if business-route RBAC coverage drops below `MIN_COVERAGE` (Sprint 0 target: 73%; configurable via `RBAC_MIN_COVERAGE` env var). Accurately excludes portal files (`parent-portal.js`, `student-portal.js`), own-account patterns (`/me`, `/me/*`, `/my-classes`), and routes with dynamic inline RBAC markers (`// rbac: dynamic`). Current coverage: **241/328 = 73%**.

### Technical Notes

- `HR_ROLES` and `ADMIN_ROLES` Sets retained in `hr.js` — still used for data scoping in own-account GET routes and for fine-grained payroll state checks (a role permission issue, not a module access issue).
- Library, hostel, and transport routes deliberately NOT converted in Sprint 0 — they require `PERM_MODULES` / `MODS` / `onboard.js` extension before `rbac()` can safely replace inline `MANAGE_ROLES` checks. Tracked for Sprint 1.
- `growth-records.js /verify` kept as intentional design: teachers can verify at staff level while admins can fully verify — CAN_VERIFY logic is domain-specific, not Settings-configurable.
- 87 remaining auth-only business endpoints catalogued in `scripts/endpoint-inventory.json`. Largest clusters: `settings.js` (26, inline `MANAGE_ROLES`), `elearning.js` (10, teacher self-service), configuration modules (`academic-config`, `bell-schedule`, `rooms`, `sections`) — all Sprint 1.

---

## [v4.51.0] — 2026-06-16 — Bulk Student Portal Access + Demo Connectivity Fix

### Added

- **`server/scripts/seed-demo-data.js`** — Seeds 4 additional student login accounts (`u_demo_s2–s5`) and 4 parent login accounts (`u_demo_p2–p5`) using `$setOnInsert` (idempotent). Username = lowercased admission number. Also sets `hasPortalAccount: true` and `hasParentAccount: true` on the linked student records. Fixes the disconnect where 20 demo students existed but only 1 student and 1 parent user were visible in Settings → Users.
- **`server/routes/students.js`** — New `POST /api/students/bulk-portal-accounts` endpoint. Accepts `{ studentIds: [] }` (max 200). Skips withdrawn/graduated students and those already with a portal account. Returns `{ created, skipped, errors }`. Gated to admin/principal/deputy_principal and requires `students.update` permission. Uses bcrypt cost 10 for batch hashing.
- **`client/src/api/client.js`** — Added `students.bulkPortalAccounts(ids)` method.
- **`client/src/pages/students/StudentList.jsx`** — Added `KeyRound` icon badge on student rows that have `hasPortalAccount: true`. Added "Grant Portal Access" button to the bulk action bar (admin/principal only), showing a result banner with created/skipped/error counts after completion.

### Technical Notes

- The bulk endpoint is positioned before the `/:id` parameterized routes in Express so it is not matched as an ID.
- Student usernames are always the lowercased admission number, matching the single-student endpoint behaviour.
- The demo seed now provides 5 student logins (including the pre-existing `demo-student`) and 5 parent logins covering students 1–5 out of 20, giving a realistic picture of the portal account workflow.

---

## [v4.50.0] — 2026-06-16 — Configurable Staff Roles & Responsibilities

### Added

- **`server/routes/settings.js`** — Added `staffResponsibilities` to `SCHOOL_UPDATABLE`. Schools can now save a custom `[{value, label}]` array via `PUT /api/settings/school`. Existing `PUT /api/settings/school` route handles it with no new endpoint needed.
- **`client/src/pages/settings/SettingsPage.jsx`** — New `StaffResponsibilitiesPanel` component in the School tab (after Curriculum Sections). Shows the current responsibility list with delete buttons and an inline add form. Auto-generates a stable `value` slug from the entered label. Ships with the same 6 defaults if no custom list is saved.
- **`client/src/pages/hr/HRPage.jsx`** — Fetches school settings (`queryKey: ['school-settings-hr']`) and resolves the `responsibilities` list (custom or default). Passes it to `StaffFormModal` and `StaffDetailPanel`. Staff card inline label map is now built dynamically from this list.
- **`client/src/pages/hr/StaffFormModal.jsx`** — Accepts `responsibilities` prop. Renders the Roles & Responsibilities checkboxes from the prop instead of a hardcoded constant.
- **`client/src/pages/hr/StaffDetailPanel.jsx`** — Accepts `responsibilities` prop. Builds `extraRolesMap` at render time. Falls back to `LEGACY_EXTRA_ROLES_LABELS` if no custom list is passed, preserving display for existing teacher records.

### Technical Notes

- The `value` slugs stored in `teachers.extraRoles[]` are stable strings. Old values (e.g. `hod`, `class_teacher`) continue to display correctly via the legacy fallback map even if a school removes those options from their list.
- `DEFAULT_RESPONSIBILITIES` is defined locally in each consumer (HRPage, StaffFormModal) so the fallback works even without a network call.
- The `StaffResponsibilitiesPanel` shares the `['settings', 'school']` React Query cache with `SchoolTab` — no extra network request in the common case.
- School admin can add curriculum-specific roles: KS1/KS2/KS3/KS4/KS5 Coordinators, Section Head, Deputy Head Primary/Secondary, Pastoral Lead, etc.

---

## [v4.49.0] — 2026-06-16 — Enforce Unique Email per School on Teachers Collection

### Added

- **`server/utils/indexes.js`** — Added `teachers_school_email` compound unique index `{ schoolId, email }` (sparse) on the `teachers` collection. This backs the existing app-level duplicate checks in `POST /api/teachers` and `PUT /api/teachers/:id`, ensuring email uniqueness is enforced at the database level and cannot be bypassed by race conditions or direct DB writes.

### Technical Notes

- Index is `sparse: true` so teachers with no email field are not affected.
- The teachers CRUD routes already return HTTP 409 for duplicate emails; the new index causes MongoDB to throw error code 11000 on any path that skips the app-level check, which the existing catch blocks already handle.
- The `users` collection already had an equivalent `{ schoolId, email }` unique index; this brings `teachers` into parity.

---

## [v4.48.0] — 2026-06-16 — Teacher Import: Auto-create Login Accounts + Welcome Email

### Added

- **`server/routes/import-export.js`** — After a successful teacher CSV import, a `users` entry is automatically created for each imported teacher who does not already have a login account. A CSPRNG password is generated (bcrypt cost 10, appropriate for batch operations), and a welcome email is sent via `enqueueBatch` (non-fatal — teacher records are preserved even if email delivery fails). The response now includes `usersCreated` count alongside `created`/`skipped`/`errors`.
- **`client/src/components/import/BulkImportSlideOver.jsx`** — Done-state summary now shows "N login accounts created · welcome emails sent" when `usersCreated > 0`.

### Technical Notes

- `_genTempPassword()` and `_uid()` duplicated from `settings.js` into `import-export.js` using the same CSPRNG (`crypto.randomInt` / `crypto.randomBytes`) — no `Math.random()` anywhere.
- bcrypt cost 10 used for batch import (vs 12 for single invites) to keep HTTP response time acceptable for large teacher batches.
- User creation is non-fatal: if `Users.insertMany` fails, the teacher records are already committed and the error is logged. The admin can invite the teacher manually from Settings → Users.
- Welcome emails are batched via `enqueueBatch` and fired asynchronously — the HTTP response returns before emails are delivered.

---

## [v4.47.0] — 2026-06-16 — Students: Rich Filters + Filtered Export

### Added

- **`server/routes/students.js`** — Two new server-side filter params:
  - `sectionKey` — resolves the section to the set of matching `classIds` via a sub-query on `classes`, then filters students by those classIds. Intersects with `classId` if both are supplied.
  - `enrollmentYear` — ISO date range filter (`{year}-01-01` → `{year}-12-31`) on `enrollmentDate`.
- **`server/routes/import-export.js`** — `GET /export/students` now accepts all student filter params (`classId`, `streamId`, `sectionKey`, `gender`, `status`, `enrollmentYear`, `search`). Applies the same filter logic as the list endpoint. Export filename now encodes active filters (e.g. `msingi_students_secondary_Year8_A_2026.csv`). Added `section` and `streamName` columns to the exported CSV.
- **`client/src/api/client.js`** — `importExport.exportCSV(type, params)` now accepts an optional params object passed as query-string to the export endpoint. Filename is taken from the server's `Content-Disposition` header when available.
- **`client/src/pages/students/StudentList.jsx`** — New filter controls: **Section** dropdown (clears class/stream on change), **Enrolment Year** dropdown (current year − 10 years). Class dropdown is pre-filtered to the selected section. All six filters (section, class, stream, gender, status, enrolment year) are passed to `handleExport` so the CSV matches exactly what is on screen. Active filters shown as dismissible chips in the page header.

### Technical Notes

- Section filter is backend-only; the `students` collection has no `sectionKey` field — the join happens at query time via `classes`.
- Enrolment year uses lexicographic ISO range (`$gte`/`$lte`) — safe because `enrollmentDate` is always stored as `YYYY-MM-DD`.
- "Export" button tooltip changes to "Export filtered students" when any filter is active.

---

## [v4.46.0] — 2026-06-16 — Classes/Streams Two-Level Architecture

### Added

- **`server/routes/streams.js`** (new) — Full CRUD for `streams` collection. Streams are teaching groups within a year-group class (e.g. Year 7 → A, B, East). On creation, `sectionKey` and `className` are inherited (denormalized) from the parent class. `GET /` enriches with teacher names and active student counts. `DELETE /:id` is blocked if active students exist. Plan gate: `classes`.
- **`server/index.js`** — `app.use('/api/streams', ...)` registered.
- **`client/src/api/client.js`** — `streams` export added: `list`, `get`, `create`, `update`, `remove`, `students`.
- **`client/src/pages/classes/ClassDetail.jsx`** (new) — Class detail page showing streams grid. Header includes class name, section badge, year, description, and total stream/student counts. Each stream card shows teacher, room, capacity fill bar, and a "View students" link. Inline `AddStreamSlideOver` for adding streams to the class.
- **`client/src/App.jsx`** — `classes/:classId` route added (lazy `ClassDetail`).

### Changed

- **`server/routes/classes.js`** — `ClassSchema` simplified: removed `keyStageId`, `teacherId`, `houseId`, `capacity`, `academicYearId`, `room` (these now live on streams). `GET /` list now enriches each class with `streamCount` and `studentCount` from aggregation. `DELETE /:id` blocked if class has active streams. Duplicate check no longer scoped to academicYearId.
- **`server/routes/students.js`** — `streamId` added to `StudentCreateSchema` and `GET /` filter list.
- **`server/routes/import-export.js`** — `streamName` column added to student CSV template. Resolved via `classId + streamName` key into the `streams` collection. Import now stores `streamId` on the created student record.
- **`client/src/pages/classes/ClassList.jsx`** — Rewritten: class cards now represent year groups (not individual teaching groups). Cards link to `ClassDetail` (`/classes/:classId`). Show `streamCount` + `studentCount`. `AddClassSlideOver` simplified to `name, sectionKey, year, description, status`. `window.confirm` replaced with proper `DeleteClassModal`.
- **`client/src/pages/students/StudentList.jsx`** — `AddStudentSlideOver` now has class → stream cascade: selecting a class loads its streams; selecting a stream pre-assigns `streamId`. Filter panel has a Stream dropdown (shown when a class filter is active). `?streamId=` URL param supported (from "View students" on stream cards).

### Technical Notes

- Stream section (`sectionKey`) is always inherited from parent class at creation — no override.
- `className` is denormalized on stream documents for fast display without joins.
- Phase 2 (timetable, attendance, grades, marks, exams, report cards, eLearning) still uses `classId` — `streamId` integration deferred until classes/streams are populated.

---

## [v4.45.0] — 2026-06-16 — Students: Bulk Select, Deactivate & Permanent Delete

### Added

- **`server/routes/students.js`** — `DELETE /api/students/purge` — hard-deletes a batch of student records (admin/superadmin only). Cascades to `invoices` and `payments` collections. Tenant-isolated: verifies all IDs belong to the calling school before deletion. Accepts up to 200 IDs per request. Route is placed before `DELETE /:id` so "purge" is never treated as a student ID.
- **`client/src/api/client.js`** — `students.purge(ids)` API method sends `DELETE /students/purge` with body `{ ids }`.
- **`client/src/pages/students/StudentList.jsx`** — Bulk selection system:
  - Checkbox column added to table header (select-all for current page) and each row (individual toggle).
  - Selected rows highlighted with a light violet tint.
  - Bulk action bar (animated, dark) appears at the top of the table when any rows are selected, showing count + Clear + Deactivate + Permanently Delete.
  - **Deactivate** (users with delete permission): sets all selected students to `inactive` via parallel `remove()` calls.
  - **Permanently Delete** (admin/superadmin only): opens a confirmation modal showing what will be deleted (student records + invoices + payments), requiring a deliberate second click to proceed.
  - Per-row action: Trash icon changed to `UserMinus` with amber hover to visually distinguish deactivate from delete.

### Security / Access Control

- Hard delete gated to `role: admin | superadmin` on both server and client.
- Deactivate gated to `canDelete` (existing RBAC permission `students.delete`).
- View (Eye icon) visible to all users with read permission.
- Edit remains gated by existing `students.update` RBAC.

---

## [v4.44.0] — 2026-06-16 — Import: Opening Balances for Students & Finance

### Added

- **`server/routes/import-export.js` — student import** — 4 optional columns added to the student CSV template: `openingFeeTitle`, `openingFeeAmount`, `openingFeePaid`, `openingFeeDueDate`. When `openingFeeAmount` is provided, an invoice and (if `openingFeePaid > 0`) a matching `payments` record are created for each successfully inserted student. Invoice numbers are reserved only after students are confirmed inserted; failed student rows produce no invoice.
- **`server/routes/import-export.js` — finance import** — `amountPaid` column added to the finance CSV template. When provided, invoice `status`, `balance`, and `amountPaid` fields reflect the partial payment, and a `payments` record with method `other` is created so `_calcBalance` remains consistent on future payment entries.
- **`client/src/components/import/BulkImportSlideOver.jsx`** — done-state summary now shows "N opening fee invoices created" and "N opening balance payments recorded" lines when the server returns those counts.

### Technical Notes

- `amountPaid`/`balance` on invoices are denormalized and recomputed from the `payments` collection by `_calcBalance` on every payment. Opening balance imports MUST create a matching `payments` record or the balance is overwritten on the next real payment. Payment method is `other` (renders as "Other" in PaymentsTab via CSS capitalize).
- `insertMany({ ordered: false })` partial failures are tracked via `err.writeErrors[].index` so invoices are only created for successfully inserted students.
- Finance import payment creation is non-fatal: if `payments.insertMany` fails, the invoice balance is still correct until the next real payment is recorded (error is logged, request still succeeds).

---

## [v4.43.0] — 2026-06-15 — Landing: Full 21-Module Ecosystem Grid

### Changed

- **`client/src/data/landingData.js`** — `ECOSYSTEM_NODES` overhauled: removed erroneous Sport module; added 7 real system modules missing from the grid (Teachers, Exams, Subjects, Messages, Events, HR & Staff, eLearning); reordered so Transport and Hostel are last after Analytics. Total grid: 21 modules.
- **`MODULE_PREVIEWS`** — Sport preview panel removed. New click-panel entries added for all 7 new modules (Teachers, Exams, Subjects, Messages, Events, HR & Staff, eLearning) with tagline, outcomes, results, badge, connectedModules, demoPath, and mockup data.
- Lucide imports updated to match new module set: Trophy removed; BookMarked, CalendarDays, FileCheck2, MonitorPlay, UserCog, UserCheck added.

### Why

Landing page ecosystem grid showed 14 modules and included Sport (which does not exist in the system). Source of truth is `CONFIGURABLE_MODULES` in Sidebar.jsx (20 modules). Grid now reflects all 20 system modules plus eLearning, which was recently added.

---

## [v4.42.0] — 2026-06-14 — Public Site: SEO, SSG Pre-render, WhatsApp FAB, Mobile Nav, African Branding

### Added

- **`client/public/robots.txt`** — Allows 6 public routes; disallows all 20+ authenticated app routes; points to sitemap.
- **`client/public/sitemap.xml`** — 6 URLs with priority weights (/ = 1.0, /plans = 0.9, /faq = 0.8, /contact = 0.7, legal = 0.3).
- **`react-helmet-async`** — Per-page `<title>`, `<meta description>`, canonical, OG, Twitter Card tags on all 6 public pages.
- **JSON-LD structured data** — `SoftwareApplication` + `Organization` on Landing; `FAQPage` on /faq; `PriceSpecification` on /plans.
- **`client/scripts/prerender.mjs`** — Puppeteer SSG post-build script: renders all 6 public routes with headless Chromium and writes pre-rendered HTML to `dist/` so AI bots (GPTBot, PerplexityBot, ClaudeBot) see real content without JS.
- **`build:ssg` script** in `client/package.json` — runs `vite build && node scripts/prerender.mjs`.
- **WhatsApp FAB** (`FloatingActions` component) added to FAQ, Plans, Contact, PrivacyPolicy, TermsOfService (Landing already had it).
- **Mobile hamburger menu** on Landing navbar — animated `AnimatePresence` dropdown with all nav links, Login, Book Demo, and Platform Live status. Closes on scroll.

### Changed

- All public-facing "Kenyan schools / administrators / leaders" copy updated to "African" across Landing.jsx, FAQ.jsx, and index.html. Legal references ("Kenyan law", "Kenyan Shilling") left unchanged.
- `index.html` base `<title>` and `<meta description>` updated to serve as non-JS fallbacks for crawlers.
- PrivacyPolicy and TermsOfService duplicate scroll-to-top logic removed; replaced with `FloatingActions`.

---

## [v4.41.0] — Landing Refactor + FAQ Page

### Added

- **`/faq` route** — Full FAQ page with categorized accordion UI, desktop sticky category nav, `FAQPage` JSON-LD schema, WhatsApp CTA, and footer.
- **FAQ teaser section** on Landing page between Trust section and Final CTA.
- **FAQ link** added to footer Company column.

### Changed

- **Landing.jsx** split from a 2100-line monolith into modular components (`client/src/components/landing/`) and data files (`client/src/data/landingData.js`, `faqData.js`). All imports and routes preserved.

---

## [v4.40.0] — Configurable Admission Numbers

### Added

- **Admission number prefix, padding, and counter** configurable per school via Settings → Admissions.
- Admission numbers auto-generated on student creation using `{prefix}/{year}/{padded-counter}` format.
- `schoolEmail` field added to student records.

### Changed

- Bulk import/export updated to include `admissionNumber` and `schoolEmail` columns.
- Import tests updated to cover the new fields.

---

## [v4.39.0] — Student Portal Features + RBAC Wiring

### Added

- **`hideFeeFromStudents`** school setting — fee balance hidden from student dashboard when enabled.
- **`studentCanViewReportCards`** school setting — report card access gated in student portal.
- **School email field** (`schoolEmail`) on student profiles.
- **Profile photo upload** on student profiles; photo rendered on report card PDFs.

### Fixed

- RBAC role permissions wired to sidebar — staff only see menu items their role grants access to.
- Portal role bleed fixed — student/parent portal roles no longer inherit staff permissions.
- Demo-student login alias (`demo-student`) preserved — no longer overwritten by admission number on seed.

---

## [v4.38.0] — Cloud Backup, Security, Legal Pages, Pricing Update

### Added

- **Cloud S3 backup** with AES-256-GCM encryption at rest (KDPA Section 41 compliance). Nightly cron via `backup-cron.js`.
- **Privacy Policy** at `/privacy` and **Terms of Service** at `/terms` — full legal pages with sticky nav and mobile layout.

### Changed

- Pricing updated: Base = KES 150/student/term, Student portal = KES 200, Family portal = KES 250. Setup fee minimum KES 45,000.
- All ERP modules enabled on all plan tiers (no module gating below enterprise).

### Fixed

- CSP headers enabled; `.git` directory access blocked.
- Backup cron collection list synced with `backup.js`.
- Demo school exempted from 2FA (demo accounts have no real email inboxes).
- Student login fixed; plans-page tier labels corrected.

---

## [v4.37.0] — Comment Banks, Grid Mark Entry, Exam Series, Approval Workflow, Mark Locking, Signatures/Stamp

### Added

#### 1. Comment Banks (`/api/comment-banks`)
- New `comment_banks` collection — pre-written remark templates for class teachers and principals.
- Full CRUD: `GET` (with `category` / `q` filters), `POST`, `PUT /:id`, `DELETE /:id`.
- Categories: `academic`, `behaviour`, `general`, `subject`.
- Plan-gated under `grades` (core). RBAC: `grades:{read,create,update,delete}`.
- **ConfigTab** gets a new "Comment Bank" section at the bottom: search, filter by category, add/delete entries.

#### 2. Spreadsheet/Grid Mark Entry (`MarkEntryTab.jsx`)
- Replaced the one-subject-at-a-time list with an **Excel-like grid**.
- Rows = students; columns = all assessment types × instances (e.g. CA 1, CA 2, HW 1, HW 2, MT, ET) for the selected class/subject/term.
- All existing marks loaded in a single query across all types.
- **Keyboard navigation**: Tab moves right, Enter/Arrow-Down moves down, Arrow-Up moves up, Arrow-Left/Right move horizontally.
- **Clipboard paste**: paste TSV from Excel or Google Sheets starting from the focused cell.
- **Column stats footer**: per-column average, entry count, and pass rate.
- **Submit for review**: one-click "Submit for review" button sends all types to the approval workflow simultaneously.
- Locked columns (post-approval) shown in amber with a Lock icon — inputs disabled.

#### 3. Exam Series (`/api/exam-series`)
- New `exam_series` collection grouping formal exams for a named exam period.
- Status machine: `draft → open → moderation → closed`.
- CRUD: list, get, create, update, delete (draft only).
- Sub-routes: `POST /:id/exams` (add exam to series), `DELETE /:id/exams/:examId` (remove).
- Plan-gated under `exam_series` (standard). RBAC: `exams:{read,create,update,delete}`.

#### 4. Approval Workflow (`/api/mark-submissions`)
- New `mark_submissions` collection — one document per class/subject/term/type/instance combination.
- **Teacher** calls `POST /` to submit marks for review; a snapshot of current marks is stored for audit.
- **Teacher** can `POST /:id/recall` while status is `submitted`.
- **Admin / section head / principal** calls `POST /:id/review` with `action: approve | reject`.
- Rejection returns to `draft` with a `rejectionReason`.
- `POST /:id/lock` / `POST /:id/unlock` (admin only) handle post-publish locking.
- Plan-gated under `mark_submissions` (standard). RBAC: `grades:{read,create,update}`.

#### 5. Mark Locking (guard on `POST /api/assessment/marks/bulk`)
- Before processing any bulk mark upsert, the endpoint now checks if any targeted `assessment_marks` records have `isLocked: true`.
- If locked marks are detected, the whole batch is rejected with HTTP 403 and a message directing the teacher to submit an unlock request.
- Unlock via `POST /api/mark-submissions/:id/unlock` (admin only, requires `reason`).
- When a submission is locked (`POST /api/mark-submissions/:id/lock`), all corresponding `assessment_marks` documents get `isLocked: true`.
- Unlocking clears `isLocked` on the underlying marks.

#### 6. Signatures and School Stamp on PDFs
- `principalSignatureUrl` and `schoolStampUrl` added to `SCHOOL_PROFILE_FIELDS` in `academic-config.js` — admins can store these via `PATCH /api/academic-config/school-profile`.
- At publish time, both URLs are snapshotted into every `report_card_snapshots` document alongside other school fields.
- At PDF generation time, `_fetchSignatureImages()` fetches both URLs as `Buffer`s (supports `https://`, `http://`, and `data:` URIs; 5 s timeout per image, non-fatal on failure).
- Signature image renders above the principal's signature line at 28 pt height.
- School stamp renders at top-right of the signature section at 36 pt height.
- Both the single-student PDF (`GET /:id/pdf`) and bulk-class PDF (`GET /bulk-pdf`) benefit from this change.

---

## [v4.36.1] — Fix portal fee collection names

### Fixed
- **`server/routes/student-portal.js`** — Fee balance query was reading `fee_invoices` (a collection that does not exist). Changed to `invoices` (the canonical collection written by `finance.js`). Field selector updated from `totalAmount paidAmount` → `balance status`; balance now reads `inv.balance` directly instead of recomputing from component fields. Unused `FeePayments` model reference removed.
- **`server/routes/parent-portal.js`** — Same `fee_invoices` → `invoices` fix for the balance query; same `fee_payments` → `payments` fix for the recent-payments query. Field selector updated: `totalAmount paidAmount dueDate termNumber` → `balance status dueDate termId` (invoices schema stores `termId`, not `termNumber`).

Both portals previously returned `feeBalance: 0` for all students because no documents existed in the non-existent collections. They now correctly read from the finance module's actual collections.

---

## [v4.36.0] — Unified Assessment Pipeline (single source of truth)

### What was fixed

Two parallel assessment systems existed and never talked to each other:

| System | Input | Config | Publisher |
|--------|-------|--------|-----------|
| **Old** | `grades` collection | `academic_config.assessmentWeights` + `.gradingSchema` | `academic-calc.js` → `report_card_snapshots` |
| **New** | `assessment_marks` collection | `assessment_config.customTypes` + `grade_boundaries` | (preview only — never published) |

Published report cards therefore showed old `grades` data, not the marks entered via MarkEntryTab. Portals could not see any published report cards at all (wrong collection name).

### Fixes

#### 1. `server/utils/academic-calc.js` — new `aggregateAssessmentMarks()`
- Reads from `assessment_marks` (published only), produces the same `{ [studentId]: { [subjectId]: { [assessmentType]: avgPct } } }` shape as `aggregateGrades()`.
- `rawScore` is already a percentage — no conversion needed.
- Multiple instances of the same type are averaged (e.g. HW1 + HW2 = avg HW).
- Exported alongside the other aggregators.
- `computeFinalScores` validator updated: now accepts both `{ minScore }` (academic_config) and `{ min }` (grade_boundaries) band format — no more throw for the new format.

#### 2. `server/routes/academic-config.js` — `resolveGrade()` dual-format support
- Now accepts **both** band formats in the same call.
- Old format `{ minScore, maxScore }`: range check (unchanged).
- New format `{ min }` (grade_boundaries): threshold check — find the highest band whose `min` ≤ score. `descriptor` / `remarks` fall back to `label`.
- Both formats return identical `{ grade, points, descriptor, remarks }` output.

#### 3. `server/routes/report-cards.js` — unified data pipeline
- New `termNumber` field added to both `GenerateSchema` and `PublishSchema` (optional `int 1–3`). Passed to `aggregateAssessmentMarks` so the right term's CA marks are included.
- New helper `_loadCaConfig(schoolId)` — loads `assessment_config.customTypes` + `grade_boundaries` default scale in parallel.
- New helper `_convertCustomTypesToWeights(customTypes)` — converts `[{ key, weight }]` → `[{ assessmentType, weight }]`.
- New helper `_mergeGradeData(gradesData, caData)` — merges old `grades` data with new `assessment_marks` data; CA marks win on per-type conflict within the same student + subject.
- **Priority rule** (both generate and publish):
  - Weights: `assessment_config.customTypes` → fall back to `academic_config.assessmentWeights`.
  - Grade schema: `grade_boundaries` default scale → fall back to `academic_config.gradingSchema`.
- Published snapshots now include `termNumber` and use `activeWeights` / `activeSchema` (not the old `config.*` fields).

#### 4. `server/routes/student-portal.js` — portal collection fix
- Changed `_model('report_cards')` → `_model('report_card_snapshots')`.
- Query now filters `superseded: { $ne: true }` and sorts by `publishedAt` (snapshots have no `termNumber` sort field).
- `.select()` updated to real snapshot fields: `academicYear termName termNumber totalScore averageScore gpa rankings status publishedAt version termId academicYearId`.

#### 5. `server/routes/parent-portal.js` — same portal fix
- Same changes as student-portal above.

#### 6. `server/routes/report-cards.js` — dynamic PDF columns
- The PDF report card table previously had hardcoded column headers ("Classwork (%)", "Mid-Term (%)", "End-Term (%)") mapping to hardcoded assessment type groupings.
- Now derives one column per entry in `snap.assessmentWeights` using the type's `label` field. A school that configures HW / CA / MT / ET will see exactly those four columns in the PDF, labelled from their own configuration.
- Column widths are computed dynamically: Subject + Score + Grade + Remarks take fixed widths; the remaining horizontal space is divided equally among the type columns (minimum 36pt each).

#### 7. `server/routes/report-cards.js` — `financialBlock` wired to fee balance
- `financialBlock` was hardcoded `false` on every published snapshot.
- **At publish time**: a single batch query (`invoices.distinct('studentId', { balance: { $gt: 0 } })`) now marks each student with an outstanding invoice balance as `financialBlock: true`. Best-effort — if the finance module is not in use, the query returns an empty set and all flags remain `false`.
- **At PDF download time**: the flag is re-verified in real-time against `invoices.exists({ studentId, balance: { $gt: 0 } })`. This means a student who pays their fees after the report card was published can download immediately — no re-publish required. Falls back to `snap.financialBlock` on DB error.
- Admin role and `?force=1` query param continue to bypass the block (unchanged).

### Net effect
Marks entered via MarkEntryTab → published via report-cards.js → visible in student and parent portals. PDF matches the school's custom assessment types. Financial block is live, not stale. One unified path, no forks.

---

## [v4.35.0] — Grade Boundaries + ExamsPage routing (Option B)

### Added
- **Grading Scales — full CRUD** (`grade_boundaries` collection, `/api/assessment/grade-scales`):
  - Each school can define one or more named grading scales (e.g. "Standard KCSE", "Primary", "Cambridge").
  - Each scale has an array of **bands**: `{ min%, grade, points, label }` — e.g. `{ min: 80, grade: 'A', points: 12, label: 'Excellent' }`.
  - **Per-section scoping**: a scale can be scoped to a specific `sectionId`, allowing different grading scales for different school divisions (CBC lower primary vs. secondary, etc.).
  - Exactly one scale per scope is `isDefault`; the default is attached to every report card response automatically.
  - **Validation guards**: duplicate grade letters rejected, duplicate min% rejected, at least one band must start at 0% (covers all scores), cannot delete the last scale, cannot delete the default without re-assigning first.
  - New API methods in `api/client.js`: `getGradeScales`, `createGradeScale`, `updateGradeScale`, `deleteGradeScale`.
- **Grade letter column on Report Cards** — `StudentReportCard` now shows a "Grade" column (e.g. A, B+, C) next to the "Final grade %" column, computed from the school's default grading scale. Falls back to a built-in Kenya 8-4-4 reference scale when no custom scale is configured.
- **`GradeScalesSection`** — new section in ConfigTab (Continuous Assessment → Configuration tab):
  - Lists all scales with band preview pills (A ≥80%, B ≥70%, …)
  - Inline band editor: expand any scale to edit all bands in a table (min%, grade, points, label)
  - "Set as default" button for non-default scales
  - "New scale" form with auto-seeded bands from the built-in reference
- **`DEFAULT_GRADE_SCALE`** constant added to `grades/constants.js` — 12-band Kenya reference scale.
- **`_gradeFromScale(score, bands)`** pure helper added to `grades/constants.js`.
- **`GET /api/assessment/config`** — now includes `gradeScale: { id, name, bands }` for the school's default scale (null if none configured).
- **`GET /api/assessment/report`** — now includes `config.gradeScale` so report cards receive the active scale in a single request.

### Changed (Option B — ExamsPage routing)
- **`/exams` route** — now mounts `ExamsPage.jsx` (formal exam scheduling, results, grade reports) instead of redirecting to `/grades`. ExamsPage was built in v4.33.0 but was orphaned until now.
- **`/grades` route** — now exclusively serves the Continuous Assessment module (Mark Entry, Report Cards, Configuration, Reminders). The old "Exams" and "Results" tabs have been removed from `GradesPage`.
- **Sidebar** — "Exams" entry added (FileText icon, `/exams`). "Exams & Assessment" renamed to "Assessment" (`/grades`).
- **Breadcrumbs** (TopBar) — `/exams` → "Exams", `/grades` → "Assessment".
- `GradesPage.jsx` — default tab changed from `'exams'` to `'entry'`; `ExamsListTab` and `ExamResultsTab` imports removed.
- `grades/constants.js` TABS array — `exams` and `results` entries removed; unused `BookOpen` and `ClipboardList` imports removed.

---

## [v4.34.0] — Assessment Types full CRUD (deep DB)

### Added
- **Assessment Types are now fully configurable per school** — examiners can add, rename, reweight, and delete the assessment components (previously hardcoded to CA/HW/MT/ET).
- **New DB endpoints** in `/api/assessment/types`:
  - `GET    /types` — returns the school's configured type definitions
  - `POST   /types` — adds a new type (key, label, weight%, instances/term, color)
  - `PUT    /types` — bulk-replaces the full array (for label/weight/color edits)
  - `DELETE /types/:key` — removes a type; **guarded by mark count** — returns HTTP 409 if marks exist for that type, protecting data integrity
- **`assessment_config.customTypes`** — new array field on the config document. Each entry: `{ key, label, weight, instances, color }`. Auto-migrated from legacy `weights`/`instances` fields for existing schools.
- **Legacy field sync** — after any type change, `weights` and `instances` maps are re-synced from `customTypes` for backward compat with the report engine.
- **`VALID_COLORS`** — 12 named pill colors (violet, purple, amber, red, blue, emerald, sky, orange, rose, teal, indigo, cyan) available for each type.

### Changed
- `MarkSchema.assessmentType` — changed from `z.enum(['CA','HW','MT','ET'])` to `z.string()` with runtime validation against the school's configured types. Custom types are now accepted.
- `ScheduleEntrySchema.assessmentType` — same change; schedule entries can use custom types.
- `_label()` helper — now uses instance number threshold (`instance <= 1 ? key : key + instance`) instead of hardcoded MT/ET check.
- `GET /report` — derives `weights` map from `customTypes` (falling back to legacy `weights` field).
- **ConfigTab** (`grades/components/ConfigTab.jsx`) — complete overhaul:
  - Replaces the fixed 4-input grid with a full CRUD table (key chip | label | weight% | /term instances | color picker | delete)
  - "Add new assessment type" inline form at the bottom
  - Merge of the old "Instances per Term" card into the type rows
  - Delete is immediate (goes to DB); add is immediate; label/weight/color changes batch-saved with "Save configuration"
  - Schedule type dropdown now reads from the school's configured types, not hardcoded constants
- **`TypePill`** (`GradesPrimitives.jsx`) — accepts optional `color` prop (color name → Tailwind classes) for dynamic types; falls back to static TYPE_PILL map for legacy CA/HW/MT/ET.
- **`constants.js`** — added `DEFAULT_CUSTOM_TYPES`, `VALID_TYPE_COLORS`, `COLOR_PILL` exports.
- **`api/client.js`** — added `assessment.addType`, `assessment.saveTypes`, `assessment.deleteType` methods.

---

## [v4.33.1] — Assessment Config relocated into Exams module

### Changed
- **Assessment Types & Weightings editor moved** from Settings → Academic tab into a new **"Configuration" tab** inside the Exams & Assessment page. Admin-only tab; hidden from teachers. This removes the friction of leaving the Exams module to configure exam types.
- Removed the Settings → Academic tab entirely (wrong home for exam-specific config).
- Removed the "Assessment Config" shortcut link from the Exams page header (the Configuration tab is now the direct path).
- `ExamPage.jsx` now has 4 tabs: Exams · Results · Grade Report · Configuration.

---

## [v4.33.0] — Exam & Assessment Module Overhaul

### Added
- **Assessment type dropdown** in Create Exam slide-over — types come from the academic-config `assessmentWeights` (configurable per school). Stores both `assessmentType` key and `assessmentLabel` display name on each exam.
- **Academic Year → Term cascade** in Create Exam and in all exam filters. Year selection auto-populates the current term based on today's date.
- **Subject dropdown** (connected to the Subjects module FK) replaces the broken free-text subject field. Subject name is denormalized onto the exam for fast list display. Old free-text `subject` field was silently stripped by Zod — now fixed.
- **Weight % auto-fill** — selecting an assessment type auto-fills the `weightPercent` field from the configured weight.
- **Title auto-suggest** — "{Assessment Type} — {Subject}" suggested when both are selected, with a one-click apply button.
- **Cascading filter panel** in Exams tab — Year → Term → Assessment Type → Search text. "Clear all" resets all filters.
- **ResultsTab enhanced** — Year + Term dropdowns narrow the exam selector; exam picker uses `<optgroup>` when multiple assessment types are present.
- **Grade Report tab** — Subject filter now uses the Subjects dropdown (FK) instead of free-text.
- **Warm gradient header** on Exams page (blue-indigo-violet, matching timetable design language). Includes "Assessment Config" shortcut link to Settings.
- **Academic tab in Settings** — new "Academic" tab with an Assessment Types & Weightings editor. Admins can add, rename, reorder and set weights for each assessment type. Sum-to-100% validation with visual indicator. Saves to `academic-config` via `PUT /api/academic-config`.
- **`assessmentType`, `assessmentLabel`, `termLabel`, `subjectName`** added to `ExamSchema` in `server/routes/exams.js` (all optional, backward-compatible).
- **Exam list enrichment** — `GET /api/exams` now resolves `subjectName` (from subjects collection) and `className` (from classes collection) via FK lookup before returning docs.
- **`assessmentType` + `termLabel` query filters** added to `GET /api/exams` for server-side filtering.
- **`academicConfig.get()` and `academicConfig.update()`** added to `client/src/api/client.js` for the main academic-config endpoint.
- **Academic years now readable by all authenticated users** — removed admin-only role check from `GET /api/academic-config/years`. Write endpoints remain admin-only. This allows teachers to see year/term options when entering results.

### Changed
- `ExamsPage.jsx` fully overhauled — all components rewritten for connectivity and consistency.
- Status badge config expanded to include all statuses in the state machine (`in_progress`, `moderated`, `approved`, `locked`, `published`, `archived`).

### Fixed
- **Subject field data loss** — the previous free-text `subject` field in Create Exam was stripped by Zod before saving (the `ExamSchema` never had a `subject` field). Exam list was always showing "—" for subject. Now properly uses `subjectId` FK.

---

## [Upcoming] — Dashboard Widget Customisation (drag-and-drop)

> **Status:** Planned — not yet implemented. Design agreed; implementation queued.

### Planned — `client/src/pages/Dashboard.jsx` + new `dashboard/` sub-folder

Full per-user drag-and-drop dashboard customisation for admin and teacher roles.

#### Widget catalogue

| Widget ID | Label | Roles |
|---|---|---|
| `kpi_students` | Student count KPI cards | All |
| `kpi_finance` | Fee collection KPI | Admin, Finance |
| `kpi_admissions` | Admissions pipeline KPI | Admin |
| `kpi_attendance` | Attendance rate KPI | All |
| `chart_finance` | Fees collected/outstanding bar chart | Admin, Finance |
| `chart_admissions` | Admissions funnel | Admin |
| `chart_gender` | Gender breakdown pie | Admin |
| `birthdays` | Today's & upcoming birthdays | All |
| `events` | Upcoming events | All |
| `recent_students` | Recently enrolled students | Admin |
| `announcements` | System announcements banner | All |
| `leadership_analytics` | Attendance risk, fee exposure, behaviour heatmap, academic health | Admin, Deputy |
| `quick_actions` | Quick action buttons | Teacher |
| `setup_checklist` | New-school setup checklist (not draggable, always first) | Admin |

#### New files
- `client/src/pages/dashboard/WidgetRegistry.js` — widget catalogue; role/plan visibility rules
- `client/src/pages/dashboard/useDashboardLayout.js` — layout state; localStorage read/write; DB sync for school-wide defaults
- `client/src/pages/dashboard/DragGrid.jsx` — `@dnd-kit/sortable` wrapper
- `client/src/pages/dashboard/DashboardEditBar.jsx` — edit-mode toolbar (pen icon, Save / Reset / Cancel)
- `client/src/pages/dashboard/widgets/*.jsx` — one file per widget (extracted from Dashboard.jsx)

#### Changes to existing files
- `client/src/pages/Dashboard.jsx` — refactored: each block extracted into a named widget component; `DragGrid` + `DashboardEditBar` wired in
- `server/routes/settings.js` — new `GET /api/settings/dashboard-layout` + `POST /api/settings/dashboard-layout` (admin sets school-wide default layout; stored in `schools` collection under `defaultDashboardLayout`)
- `client/src/api/client.js` — `settingsApi.dashboardLayout.get()` / `.save(layout)`
- `client/package.json` — add `@dnd-kit/core` + `@dnd-kit/sortable`

#### UX behaviour
- All authenticated users see a **pen (✏) icon** top-right of the dashboard to enter edit mode
- Edit mode shows drag handles (⠿) on each widget and an eye toggle (show/hide)
- **Admin only** — "Set as school default for all staff" checkbox on Save; saves layout to DB
- **Teachers** — personal layout persists in `localStorage`; "Reset to default" reverts to the school admin's saved default (or built-in default if none set)
- `setup_checklist` widget is always pinned at top and cannot be reordered or hidden

---

## [4.32.4] — 2026-06-11  Section Tab "all highlighted" Bug Fix

### Fixed — `server/routes/sections.js` + `client/src/hooks/useSections.js`

**Root cause:** Schools whose sections were auto-seeded by an older version of the route (before `key`/`color` were added to `DEFAULT_SECTIONS`) had section documents in the DB without a `key` field.  
`useSections` mapped `id: s.key` → `id: undefined` for every tab.  
Clicking any tab called `setSection(undefined)`, after which `undefined === undefined` is `true` for all tabs simultaneously → every section tab appeared "active" at once.

**Server fix (`server/routes/sections.js`):**
- Added `_inferKey(name)` helper that maps a section's display name to a `key` string using regex patterns (kg, primary, secondary, alevel) with a slugify fallback
- `GET /api/sections` now detects sections with missing `key` or `color`, patches them via `$set`, and reloads before responding — a silent one-time migration that runs on the next page load

**Client fix (`client/src/hooks/useSections.js`):**
- `sectionTabs` now filters out sections without a `key` before mapping (`.filter(s => s.key)`) so a missing-key section can never enter the tabs array
- Added `color` fallback: `s.color || '#6366f1'` so even unpatched data shows distinct fallback colour

---

## [4.32.3] — 2026-06-11  Timetable Dashboard Visual Redesign

### Changed — `client/src/pages/timetable/TimetablePage.jsx`

**Timetable page header redesigned — warmer, more engaging UI:**

- Replaced the flat `bg-white border-b` header with a rich `bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700` banner matching Msingi brand palette
- Added subtle decorative circles (white/5 opacity) for visual depth
- Calendar icon now lives in a frosted-glass tile (`bg-white/15 border border-white/20`)
- Title promoted from `text-base font-semibold text-slate-900` to `text-lg font-bold text-white`
- Added a pill chip showing live class count (`{classList.length} classes`) when classes are loaded
- View tabs redesigned: active tab = `bg-white text-indigo-700` (bridges into the white content below), inactive tabs = `text-white/65` on the gradient
- All action buttons (Bell, Import, Workload, Conflict badge) restyled to `bg-white/10 text-white border-white/25` on gradient; "Add slot" CTA = `bg-white text-indigo-700` for strong contrast
- Conflict badge on gradient: red variant = `bg-red-400/25 text-red-100`, green = `bg-emerald-400/20 text-emerald-100`
- "Workload" toggle active state: `bg-white text-indigo-700 shadow-sm` (clear visual distinction)

**Empty state panels warmed up:**
- "Select a class" placeholder: replaced flat icon with `bg-indigo-50` rounded tile + icon + two-line copy
- "Select a teacher" placeholder: replaced flat icon with `bg-violet-50` rounded tile + icon + two-line copy

---

## [4.32.2] — 2026-06-11  Monitoring, Nightly Backup Cron, Email Batching, Exchange Rate-Limit

### Added — Error monitoring utility (`server/utils/monitoring.js`)

Lightweight, zero-new-dependency error tracking with three optional channels:

| Channel | Activation |
|---|---|
| **Disk log** | Always active. Writes rotating `logs/errors-YYYY-MM-DD.log` JSON files. |
| **Sentry** | Active when `SENTRY_DSN` env var is set **and** `@sentry/node` is installed (`npm install @sentry/node`). |
| **Alert webhook** | Active when `ALERT_WEBHOOK_URL` env var is set. Sends a POST to any webhook endpoint (Discord, Slack, custom). |

Global `uncaughtException` and `unhandledRejection` handlers registered at startup. `captureException(err, ctx)` called from the Express error handler with `route`, `method`, `userId`, `schoolId` context.

**`server/index.js`** wired at three points:
- `monitoring.init()` — before any middleware
- `app.use(monitoring.requestHandler())` — after CORS (Sentry request context)
- `app.use(monitoring.errorHandler())` — before the final error handler (Sentry error context)

### Added — Nightly backup cron (`server/utils/backup-cron.js`)

Auto-exports a full JSON backup for every active school once per day and saves it to disk.

- Schedule: `BACKUP_CRON_EXPR` env var, default `"0 23 * * *"` (02:00 Kenya / 23:00 UTC)
- Storage: `BACKUP_DIR` env var, default `<project_root>/backups/`
- Retention: `BACKUP_KEEP_DAYS` env var, default `7` — older files auto-pruned per school
- Same credential-stripping rules as the manual export (`password`, `passwordHash`, `twoFactorSecret`, `mfaOtp`, `mfaExpiry` from users; `smtpPassEnc`, `mpesa` from schools)
- Writes a `backup_logs` row per school with `source: 'cron'` (distinguishable from manual exports in the Backup History UI)
- Registered in `server/index.js` `app.listen` callback alongside existing crons

### Fixed — School-wide announcements batch emails to avoid SMTP rate limits

`server/routes/messages.js` previously fired all notification emails concurrently via `Promise.allSettled`, risking hitting Gmail's sending limits on large schools.

**New:** `server/utils/email-queue.js` — `enqueueBatch(thunks)` sends in batches of `EMAIL_BATCH_SIZE` (default 20) with `EMAIL_BATCH_DELAY_MS` (default 1 500 ms) between batches. Email jobs are stored as **thunks** (lazy functions) to prevent SMTP calls from starting before batching can control them.

### Fixed — Rate-limit `POST /api/auth/exchange` (B from security audit)

`server/routes/auth.js` — added `exchangeLimiter`: 10 requests / 5 min per IP. Prevents brute-forcing exchange codes even though each code is single-use and expires in 30 seconds.

---

## [4.32.0] — 2026-06-11  OAuth Exchange-Code Flow + JWT Token-Version Revocation

### Security — OAuth token no longer exposed in redirect URL (F4)

The Google and Microsoft OAuth callbacks previously embedded the full JWT in the redirect URL (`?token=...`), leaking it into browser history, server access logs, and third-party `Referer` headers.

**New flow:**
1. OAuth callback generates a 30-second single-use **exchange code** (`crypto.randomBytes(32)` — 64-char hex) and stores `{ token, expiresAt }` in an in-process Map.
2. Redirect URL carries `?code=<hex>` only — no JWT.
3. New **`POST /api/auth/exchange`** endpoint: validates code (deletes on first read), re-reads `user + photo + school` from DB, returns `{ token, user, school }` identical in shape to the login endpoint.
4. `client/src/pages/Login.jsx` updated: reads `?code=` instead of `?token=`, calls `/api/auth/exchange` via POST, eliminates the secondary `/api/auth/me` call.

**Files changed:** `server/routes/auth.js`, `client/src/pages/Login.jsx`

### Security — JWT revocation via per-user token version (F11)

Previously, a role change (e.g. demoting an admin) took up to 24 hours to take effect because existing JWTs were stateless.

**New mechanism:**
- `server/utils/token-version.js` — new utility: `getTokenVersion(userId)` with 5-minute in-process cache; `revokeUserTokens(userId)` increments `tokenVersion` in DB and busts the cache entry.
- Every JWT payload now includes `tv: user.tokenVersion ?? 0`.
- `authMiddleware` is now async; after signature verification it checks `payload.tv` against the cached DB version — a lower version returns 401 immediately.
- `server/routes/settings.js` — `PUT /users/:id` calls `revokeUserTokens()` when a role change is applied; takes effect on the user's next request.
- **Backward compat:** tokens issued before this version carry no `tv` claim and pass through unchanged until they expire naturally (max 24 h).

**Files changed:** `server/utils/token-version.js` *(new)*, `server/middleware/auth.js`, `server/routes/auth.js`, `server/routes/settings.js`

---

## [4.31.3] — 2026-06-11  Multi-Tenant Security Hardening (Findings F1–F10)

Full audit of all 47 backend routes, middleware, and utilities against an 11-area security checklist. Ten findings fixed; one informational note closed.

### Fixed — Missing `schoolId` scope on user queries (F1, F6, F7)

| File | Location | Fix |
|---|---|---|
| `server/routes/auth.js` | `change-password` `findOne` + `updateOne` | Added `schoolId: req.jwtUser.schoolId` |
| `server/routes/users.js` | `PUT /me` post-update `findOne` | Added `schoolId: req.jwtUser.schoolId` |
| `server/routes/settings.js` | `GET /` and `PUT /` `findOne` | Added `schoolId: req.jwtUser.schoolId` |

### Fixed — `verify-otp` client-controlled `schoolId` stripped (F3)

`server/routes/auth.js` — `schoolId` removed from body destructure; all three DB calls (`findOne`, two `updateOne`) now use the server-resolved `req.school.id` exclusively.

### Fixed — Photo endpoint: unauthenticated cross-tenant access blocked (F2)

`GET /api/users/:id/photo` now requires a `?schoolId=` query parameter and filters `user_photos` by `schoolId`. Returns 400 if the parameter is absent.

All server-side `photoUrl` response fields updated to include `?schoolId=encodeURIComponent(...)`. Frontend updated in three locations (`TopBar.jsx`, `ProfilePage.jsx` ×2, `client.js` helper).

### Fixed — M-Pesa STK callback scoped to transaction's school (F5)

`server/routes/mpesa.js` — both `updateOne` calls and the invoice `findOne` inside the STK callback now include `schoolId: txn.schoolId` (available from the already-found transaction document).

### Added — `mpesa_transactions` DB indexes (F10)

`server/utils/indexes.js` — new collection entry with four indexes: unique on `checkoutRequestId`, compound `schoolId + status + createdAt`, `schoolId + invoiceId`, and unique on `id`.

### Fixed — Backup export strips credential fields (F8)

`server/routes/backup.js` — users collection export strips `password`, `passwordHash`, `twoFactorSecret`, `mfaOtp`, `mfaExpiry` before serialisation; schools collection strips `smtpPassEnc` and `mpesa` (API keys).

### Fixed — School-wide message broadcast restricted to staff (F9)

`server/routes/messages.js` — `POST /` now enforces a `BROADCAST_ROLES` set (`superadmin`, `admin`, `deputy_principal`, `deputy`, `section_head`, `teacher`, `hr`). Students and parents receive 403 when attempting `recipients: 'all'`.

### Confirmed secure (no change needed)

Login rate limiting (10/15 min), bcrypt hash guard, OTP CSPRNG + timing-safe comparison, platform admin key, finance route isolation, server-side financial totals, parent/student portal ownership checks, analytics role gate, report-card publish admin-only gate, public endpoint field whitelist.

---

## [4.31.2] — 2026-06-11  Centralise Auth Token Reads

### Refactored — Token access pattern (8 files)

All client-side pages that were reading `JSON.parse(localStorage.getItem('msingi_session'))?.token` directly have been migrated to the proper centrally-managed patterns. This means a future key-name or schema change needs updating in exactly one place (`auth.js`/`client.js`), not scattered across the codebase.

#### Changes per file

| File | Was | Now |
|---|---|---|
| `StudentDashboard.jsx` | `_token()` read localStorage | `useAuthStore.getState().session?.token` |
| `ParentDashboard.jsx` | `_token()` read localStorage | `useAuthStore.getState().session?.token` |
| `LibraryPage.jsx` | `useRole()` read localStorage for role | `useAuthStore(s => s.session?.user?.role)` selector |
| `TransportPage.jsx` | `useRole()` read localStorage for role | `useAuthStore(s => s.session?.user?.role)` selector |
| `HostelPage.jsx` | `useRole()` read localStorage for role | `useAuthStore(s => s.session?.user?.role)` selector |
| `ProfilePage.jsx` | Raw `fetch('/api/users/me')` with manual token | `profileApi.update()` from `client.js` |
| `SettingsPage.jsx` | Raw fetches for 4 billing/mpesa endpoints | New `billingApi.*` / `mpesaApi.*` from `client.js` |
| `ELearningPage.jsx` | `apiFetch` + 4 raw `useQuery` fetches | `useAuthStore.getState()` in `apiFetch`; client helpers for subjects/classes/students/teacher |

#### Added — `client/src/api/client.js`

```js
export const billing = {
  current:  () => _get('/billing/current'),
  generate: (data) => _post('/billing/generate', data),
  history:  () => _get('/billing/history'),
};

export const mpesa = {
  subscription: (data) => _post('/mpesa/subscription', data),
};
```

Both are also included in the default `api` export object.

---

## [4.31.0] — 2026-06-11  eLearning Redesign — PMI Sessions, Calendar Integration, Emergency Online Mode, Student Portal Join Buttons

### Added — eLearning module (8 phases)

#### Phase 1 — Google Classroom moved to "Upcoming"
- Sidebar item `Google Classroom` is now shown as a non-clickable chip with a "Soon" badge.
- All existing Classroom OAuth and course-listing code is preserved behind the route guard; it is hidden, not deleted.
- Default redirect `/elearning` now goes to `/elearning/sessions`.

#### Phase 2 — No more Zoom / Meet API calls
- Removed `/elearning/zoom` and `/elearning/meet` route cases.
- All meeting links are now plain URLs stored by teachers on their own profiles — no OAuth sign-in, no API call to Zoom or Google.

#### Phase 3 — Teacher profile: Online Meeting Links section
- **`client/src/pages/profile/ProfilePage.jsx`** — new "Online Meeting Links" card for staff only.
  - Fields: Zoom PMI URL, Zoom Passcode, Google Meet URL.
  - URL validation (`https://` required), separate save button, external preview links.
- **`server/routes/teachers.js`** — `SELF_EDITABLE` array extended with `zoomPMILink`, `zoomPasscode`, `meetLink` so teachers can save their own links via `PUT /api/teachers/me`.

#### Phase 4 — Schedule Online Class / Session
- **`server/routes/elearning.js`** — new `POST /api/elearning/sessions` endpoint.
  - Plan-gated: `planGate('elearning')` — requires standard plan.
  - Validates audience type (`class` / `student` / `parent`) and audience ID.
  - Resolves the teacher's stored Zoom PMI or Meet link; returns `{ missingLink: true }` if none saved.
  - Creates `elearning_sessions` document (no external API call).
  - Creates `events` document simultaneously with `category: 'online_class'`, `meetingLink`, `sessionId` reference.
  - Returns `{ session, event }`.
- **`server/middleware/plan.js`** — `elearning: 'standard'` added to `FEATURE_PLAN` map.

#### Phase 5 — Online Sessions tab (replaces Zoom / Meet tabs)
- **`client/src/pages/elearning/ELearningPage.jsx`** — major rework.
  - `NewScheduleModal`: audience picker (class / student / parent), platform toggle (Zoom / Meet), link preview, date/time/duration, agenda.
  - `OnlineSessionsTab`: fetches teacher's own link status, lists upcoming and past sessions, shows `SessionCard` per session with Join / Cancel buttons.
  - Missing-link warning banner with link to Profile page.
  - React Query invalidates `['elearning-sessions-all']` and `['events']` after scheduling.

#### Phase 6 — Calendar: Online Class events show Join button
- **`client/src/pages/events/EventsPage.jsx`** — `online_class` added to `CATEGORIES`.
  - Event form shows platform/link/passcode fields when category is `online_class`.
  - View mode shows a "Join Meeting" button and passcode when `event.meetingLink` is set.
- **`server/routes/events.js`** — POST/PUT handlers accept and store `meetingLink`, `meetingPasscode`, `platform`.

#### Phase 7 — Emergency Online Learning Mode
- **`client/src/pages/settings/SettingsPage.jsx`** — new toggle under School Settings.
  - Sky-blue UI indicator, amber warning reminding admins to ensure teachers have links saved.
  - `patchSchool()` called on save so timetable reacts immediately without refresh.
- **`client/src/store/auth.js`** — `_slimSchool()` persists `emergencyOnlineMode` to localStorage.
- **`client/src/pages/timetable/TimetablePage.jsx`** — emergency banner above grid; fetches teacher meeting links when mode is ON; passes `emergencyMode` and `teacherMap` to `TimetableGrid`.
- **`client/src/pages/timetable/components/TimetableGrid.jsx`** — `SlotCard` shows per-slot "Join Zoom / Meet" button in emergency mode.

#### Phase 8 — Student Portal: per-lesson Join buttons
- **`server/routes/student-portal.js`** — `GET /api/student-portal/dashboard`:
  - Selects `teacherId` on timetable slots.
  - Reads `emergencyOnlineMode` from school document.
  - When mode is ON, queries `teachers` collection for `zoomPMILink`, `zoomPasscode`, `meetLink` and attaches `meetingLink`, `meetingPasscode`, `platform` to each slot.
  - Includes `emergencyOnlineMode` in the `school` key of the response.
- **`client/src/pages/student-portal/StudentDashboard.jsx`** — "Today" widget:
  - Sky-blue "Emergency Online Learning" banner when `school.emergencyOnlineMode`.
  - Each lesson row now shows `startTime / endTime` (already present) plus a sky-blue "Join" button when `slot.meetingLink` is set.
  - Passcode row displayed below each slot when `slot.meetingPasscode` is present.

### Changed — eLearning sidebar
- `ELEARNING_ITEMS` now has 2 items only: `Online Sessions` (active) and `Google Classroom` (upcoming / non-clickable).

---

## [4.31.1] — 2026-06-11  Help Centre — Role-Based Section Filtering + Content Expansion

### Added — Help Centre (`client/src/pages/help/HelpPage.jsx`)

- **Role-based section filtering** — the Help Centre now shows only the sections that match the modules a user has access to.
  - Each FAQ section has a `moduleKey` property that maps to the same module permission keys used by the sidebar (`classes`, `students`, `admissions`, `attendance`, `timetable`, `elearning`, `finance`, `behaviour`, `grades`, `lessons`, `events`, `hr`, `messages`).
  - Sections with `moduleKey: null` (Getting Started, Settings, Roles & Permissions, Data & Import/Export) are always visible to every role.
  - Filtering uses `useAuthStore`'s `can(moduleKey)` method — the same gate that controls sidebar visibility. `superadmin` and `admin` bypass the check and see all sections.
  - Both the sidebar navigation list and the article panel grid respect the filtered set; the search query also runs only over the visible sections.

- **Content expansion** — 18 sections, 80+ articles covering every module:
  - New sections added: Classes & Subjects, Admissions, Timetable, eLearning & Online Sessions, Exams, Report Cards, Lessons & Coverage, HR & Staff, Events & Calendar.
  - All hardcoded `violet-*` colour references replaced with `useSchoolTheme` primary/accent colours.

---

## [4.30.1] — 2026-06-09  Security & Bug Fixes

### Fixed — Security hardening

- **`server/routes/settings.js` `PUT /`** — self-service password change was missing `passwordChangedAt` update, meaning the 90-day rotation clock was never reset after a manual change. Clock now resets correctly. Also raised bcrypt cost 10→12 and minimum password length 6→8 to match the rest of the codebase.
- **`server/routes/settings.js` `/users/invite`** — bcrypt cost raised 10→12 (consistent with `users.js` invite route).
- **`server/routes/students.js`** — student portal account and parent portal account creation both used bcrypt cost 10. Raised to 12.
- **`server/routes/platform.js`** — new-school superadmin password was hashed at cost 10. Raised to 12.

### Fixed — `_mapSchoolDoc()` missing fields (`server/middleware/tenant.js`)

- `moduleConfig` and `faviconUrl` were not included in the object returned by `_mapSchoolDoc()`. On every fresh login these fields were `undefined` in `session.school`, causing the sidebar to ignore saved module visibility configuration and the browser tab to show no custom favicon. Both fields are now forwarded.

### Fixed — Invoice currency defaulting to GBP (`server/routes/finance.js`)

- Zod schema had `currency: z.string().length(3).default('GBP')`. Since the frontend `CreateInvoiceSlideOver` never sends a `currency` field, every invoice was silently stored with `GBP`. The default is removed. The POST `/invoices` route now reads the school's own `currency` field as the fallback, with `'KES'` as the hard-coded last resort.

### Fixed — Dead code: `mustChangePassword: true` in user invite (`server/routes/users.js`)

- `POST /invite` and `POST /bulk-invite` both set `mustChangePassword: true` on new user documents. `auth.js` no longer reads or acts on this flag (it was replaced by the `passwordChangedAt` 90-day rotation mechanism). The dead field is removed from both code paths to avoid confusion.

---

## [4.30.0] — 2026-06-09  Academic Year Lifecycle Management

### New — Academic Year CRUD + Transition (`server/routes/academic-config.js`)

Full year lifecycle — draft → active → locked — replacing the old free-text academic year label.

- **`GET /api/academic-config/years`** — list all academic years for the school, enriched with computed `status` (`draft` | `active` | `locked`). Status is derived at query time from `isCurrent` + `archivedAcademicYears` array — no duplicate state stored.
- **`POST /api/academic-config/years`** — create a draft year with `name`, `startDate`, `endDate`, and optional `terms[]`. Validates uniqueness of name per school.
- **`PUT /api/academic-config/years/:id`** — update name, dates, or term dates on any non-locked year. Returns 403 on locked years.
- **`DELETE /api/academic-config/years/:id`** — delete draft years only. Active and locked years cannot be deleted.
- **`POST /api/academic-config/transition-year`** — atomic, irreversible transition:
  1. Runs the same cascade as `/archive-year` on the currently active year (freeze exams, lock report card snapshots, mark grades `yearArchived`, activate write-blocking gate via `archivedAcademicYears`)
  2. Sets `isCurrent: true` on the target draft year
  3. Syncs `school.academicYear` label and `school.termDates` for backward compatibility with attendance, billing, and display
  4. Writes audit log entries for both the archive and activation
- `_yearStatus(year, archivedIds)` helper — single source of truth for derived status
- `uuidv4` used for new year `id` fields; `v4` imported at route level

### New — Assessment Year-Lock Guard (`server/routes/assessment.js`)

- **`POST /api/assessment/marks`** — now checks `isYearArchived(schoolId, d.academicYearId)` before the upsert. Returns `403 "This academic year is locked"` if archived.
- **`POST /api/assessment/marks/bulk`** — checks `firstArchivedYear(schoolId, yearIds)` across all distinct `academicYearId` values in the payload. Returns `403` naming the locked year if any is found.
- Both checks use the existing `server/utils/archival.js` helpers — no new logic introduced.
- **Scope**: assessment marks (`assessment_marks` collection) are now fully protected. Attendance (`attendance_records`) and Lessons are not protected — attendance records carry no `academicYearId` field and lessons reference year by string label rather than ID; this is documented as a known limitation.

### New — `academicConfig` API client (`client/src/api/client.js`)

```js
export const academicConfig = {
  years: {
    list:      ()           => _get('/academic-config/years'),
    create:    (data)       => _post('/academic-config/years', data),
    update:    (id, data)   => _put(`/academic-config/years/${id}`, data),
    remove:    (id)         => _delete(`/academic-config/years/${id}`),
  },
  transition:  (data)       => _post('/academic-config/transition-year', data),
  archiveYear: (data)       => _post('/academic-config/archive-year', data),
};
```

### New — `AcademicYearsSection` component (`client/src/pages/settings/SettingsPage.jsx`)

Replaces the old free-text "Academic year label" input + manual term dates table in the School settings tab.

- Year list with status badges (`Active` pulse dot, `Locked` padlock icon, `Draft` muted)
- Years sorted: active first, drafts next, locked last
- **Create form** — inline animated form for creating draft years with name, start/end dates, and term count
- **Inline term editor** — per-year edit mode with date pickers for each term's start/end date; save/cancel controls
- **Delete** — trash icon on draft rows only; confirmation via `window.confirm`
- **Activate button** — "Start this academic year" button on each draft row
- **Transition dialog** — full confirmation modal with:
  - Summary of what will be locked (current active year name + cascade effects)
  - Summary of what will be activated (target year name)
  - Optional reason field
  - Amber "Lock current & activate new year" CTA
  - Error display on failure
- Old free-text `academicYear` input and manual `termDates` rows removed
- `academicYearStartMonth` and `termsPerYear` fields retained (control billing roll-over, not year lifecycle)

### New — Startup migration: `_migrateAcademicYears` (`server/index.js`)

Non-blocking post-startup migration:
- Assigns `uuidv4` `id` field to any `academic_years` document missing it (legacy docs from before this version)
- Sets `isCurrent: false` on any document with the field absent
- Idempotent — safe to run on every startup; becomes a no-op once all docs are migrated

---

## [4.29.0] — 2026-06-08  Staff Profile Self-Edit · Admin Password Reset · CSPRNG Sweep

### New — Staff self-edit profile page (`client/src/pages/profile/ProfilePage.jsx`, `server/routes/teachers.js`)

- **`/profile` route** accessible from the top-nav avatar dropdown — every authenticated user can view and edit their own profile without admin involvement
- **Photo upload / remove** — base64 resize + crop before upload; MIME + 10 MB size validation; immediate preview
- **Password change** — current password verified server-side, new password bcrypt-hashed; show/hide toggles on all fields
- **Staff details card** — conditionally rendered only when a `teachers` record exists for the logged-in email:
  - Self-editable: address (textarea), date of birth, qualifications, specialization
  - Next of kin: name, phone, relationship (3-column grid)
  - Read-only note: HR-managed fields (department, contract, employment status) can only be changed by HR team
- **Backend — `GET /api/teachers/me`** — finds staff record by matching `user.email` → `teacher.email`; strips sensitive fields (`nationalId`, `nssfNo`, `shaNo`, `kraPinNo`) via `_stripSensitive()` before responding; returns `{ data: null }` when no record exists (admin-only users)
- **Backend — `PUT /api/teachers/me`** — updates only the `SELF_EDITABLE` allowlist: `['phone', 'address', 'qualifications', 'specialization', 'dateOfBirth', 'nextOfKin']`; no RBAC gate, no plan gate — available to all authenticated staff
- Both `/me` routes placed **before** `GET /:id` in `teachers.js` to prevent Express treating the literal string "me" as a dynamic ID parameter
- **API client** — `profile.staffRecord()` → `GET /teachers/me`; `profile.updateStaffRecord(data)` → `PUT /teachers/me`

### New — Admin temporary password reset (`server/routes/settings.js`, `client/src/pages/settings/SettingsPage.jsx`)

- **`POST /api/settings/users/:id/reset-password`** — admin/superadmin only
  - Non-superadmin blocked from resetting another `admin` or `superadmin`'s password
  - Generates a new temp password via `_genTempPassword()` (CSPRNG, 11 chars: alpha + 2 digits + `!`, shuffled)
  - Stores bcrypt hash, sets `mustChangePwd: true` → user forced to change on next login
  - Attempts `sendWelcomeCredentials` email — non-fatal; `emailSent: false` returned when it fails
  - Response: `{ tempPassword, name, email, emailSent }`
- **`ResetPasswordModal`** — two-state modal rendered in `UsersTab` (Settings → Users):
  - **Confirmation state** — explains temp password flow, names target user and email; Cancel + "Set Password" button
  - **Result state** — temp password in large violet monospace + one-click copy button; green/amber banner showing email delivery status; "This password will not be shown again" note; Done button
  - Overlay click dismissed only in confirmation state (result must be explicitly closed — prevents accidental dismissal before copying)
- **User row action cell** upgraded — KeyRound icon button (amber hover) + Trash2 icon button (red hover) in a flex container; both reveal on row hover
- **API client** — `settingsApi.users.resetPassword(id)` → `POST /settings/users/:id/reset-password`

### Fixed — Welcome email not sent on user invite (`server/routes/settings.js`)

- Invite route called `emailUtil.sendWelcome(...)` which does not exist — the correct export is `sendWelcomeCredentials`
- All argument keys corrected: `to:` → `email:`, field names aligned with the email template's parameter signature
- Effect: newly invited users now receive their welcome email with login URL and temporary password

### Fixed — ProfilePage photo actions on wrong API namespace (`client/src/pages/profile/ProfilePage.jsx`)

- `authApi.uploadPhoto` / `authApi.removePhoto` do not exist on the `auth` export — methods live on `profile`
- Fixed import: `import { auth as authApi, profile as profileApi }` — both call sites updated to `profileApi.*`

### Security — Global `Math.random()` elimination

All production server code now uses Node.js built-in `crypto` (CSPRNG). `Math.random()` is fully banned:

| File | What changed |
|---|---|
| `server/routes/users.js` | `_genTempPassword()` → `crypto.randomInt` + Fisher-Yates; `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/students.js` | `_genTempPassword()` → `crypto.randomInt` + Fisher-Yates |
| `server/routes/admissions.js` | Application ref → `crypto.randomBytes(3).toString('hex').toUpperCase()` |
| `server/routes/backup.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/bell-schedule.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/billing.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/collections.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/elearning.js` | Session ID → `crypto.randomBytes(3).toString('hex')` |
| `server/routes/mpesa.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/platform.js` | `_annId()` → `crypto.randomBytes(4).toString('hex')` |
| `server/scripts/seed-demo-data.js` | Fake payment dates → `crypto.randomInt(1, 31)` |

### Removed — `three.js` unused dependency (`client/package.json`)

- `"three": "^0.184.0"` removed from client dependencies — the package was never imported anywhere in the source tree (~900 KB bundle bloat)

---

## [4.28.0] — 2026-06-08  Security Hardening — 2FA, OTP Hashing, JWT Expiry, CSPRNG, Slim Session

### Security — Authentication (`server/routes/auth.js`)

- **2FA scope expanded** — `MFA_ROLES` set extended from `['superadmin']` to `['superadmin', 'admin', 'deputy', 'finance']`; all privileged roles now require OTP on login
- **OTP hashed at rest** — `_hashOTP(otp)` computes SHA-256 before storing in `mfaOtp` field; `_verifyOTP(input, hash)` uses `crypto.timingSafeEqual` to prevent timing-side-channel attacks; plain-text OTP never written to database
- **CSPRNG for OTP generation** — replaced `Math.random()` with `crypto.randomInt(0, 9)` inside `_genOTP()`; Fisher-Yates shuffle in `_genTempPassword()` also uses `crypto.randomInt`
- **Demo school 2FA exemption** — `const isDemo = req.school?.slug === 'demo'`; demo accounts are exempt from 2FA requirement so demo quick-login works without real email delivery
- **Login rate limit tightened** — `loginLimiter` reduced from 20 → 10 attempts per 15-minute window

### Security — JWT (`server/utils/jwt.js`)

- **Token lifetime reduced** — `EXPIRES` default changed from `'7d'` → `'24h'` (`JWT_EXPIRES_IN` env var override still honoured); stolen-token attack window halved

### Security — Platform Key (`server/middleware/auth.js`)

- `X-Platform-Key` header now compared via `crypto.timingSafeEqual` — prevents timing attacks on the operator key

### Security — Settings CSPRNG (`server/routes/settings.js`)

- `_uid()` — switched from `Math.random().toString(36)` to `crypto.randomBytes(4).toString('hex')`
- `_genTempPassword()` — Fisher-Yates shuffle now uses `crypto.randomInt` (same as auth.js)

### Security — Client localStorage Slim-Session (`client/src/store/auth.js`)

- `_slimUser(user)` strips `email`, `permissions` before localStorage persist; keeps `id, name, role, schoolId, studentId, guardianOf`
- `_slimSchool(school)` strips `address`, `mpesa*`, `tagline`; keeps `id, name, slug, plan, logoUrl, faviconUrl, primaryColor, moduleConfig`
- XSS can still steal the JWT but cannot read email / permissions from `localStorage`

---

## [4.27.0] — 2026-06-08  Reliability Fixes — Stale Chunk Crash + Login Session Error

### Fixed — Stale-chunk auto-reload (`client/src/main.jsx`, `client/src/components/guards/ErrorBoundary.jsx`, `server/index.js`)

- **`window.unhandledrejection` listener** in `main.jsx` — catches dynamic-import `TypeError: Failed to fetch dynamically imported module` and calls `window.location.reload()` automatically; users land on a fresh build instead of a blank error screen
- **`ErrorBoundary.getDerivedStateFromError`** — detects `"Failed to fetch dynamically imported module"` (Vite's `vite:preloadError` string), sets `needsReload = true`, renders a "Loading update…" screen and reloads after 300 ms
- **`index.html Cache-Control: no-cache, no-store, must-revalidate`** — `server/index.js` serves the SPA shell with no caching; browsers always fetch a fresh HTML document referencing the latest hashed JS chunks after a deploy

### Fixed — Login shows "Session expired" for wrong-password error (`client/src/api/client.js`)

- **Root cause**: all 401 responses were treated as session expiry, dispatching `api:unauthorized` and clearing the session — including 401s from wrong-password attempts before any token existed
- **Fix**: 401 only triggers `api:unauthorized` if the request had a `Bearer` token; unauthenticated requests pass the actual server error message through to the UI; supports both `{ error: string }` and `{ error: { code, message } }` response shapes

### Fixed — Demo admin 2FA blocked (`server/routes/auth.js`)

- Security hardening in v4.28 extended 2FA to the `admin` role, but demo admin accounts have no real email for OTP delivery
- Added `isDemo` guard: `const isDemo = req.school?.slug === 'demo'; if (!isDemo && MFA_ROLES.has(userRole) && user.mfaEnabled !== false)`

---

## [4.26.0] — 2026-06-08  eLearning Module — Google Classroom + Google Meet + Zoom

### New — `server/routes/elearning.js` (~900 lines)

**Google OAuth (per teacher)**
- `GET  /api/elearning/auth/connect` — generates OAuth URL with `classroom.*`, `drive.file`, `calendar.events` scopes
- `GET  /api/elearning/auth/callback` — exchanges code, stores encrypted tokens per `(schoolId, userId)`
- `GET  /api/elearning/auth/status` — returns `{ connected, email }` for the current user
- `DELETE /api/elearning/auth/disconnect` — revokes and removes stored tokens

**Google Classroom — Courses & Coursework**
- `GET  /api/elearning/courses` — lists linked Classroom courses with local metadata
- `POST /api/elearning/courses/link` — links a Google Classroom course to a Msingi class
- `DELETE /api/elearning/courses/:id` — unlinks course
- `GET/POST/DELETE /api/elearning/courses/:id/coursework` — create assignments (title, description, due date, PDF attachment via Drive); Google Drive stores the file — Msingi only stores the `fileId` reference

**Google Drive Upload**
- `POST /api/elearning/drive/upload` — base64 payload → multipart upload to teacher's Google Drive → returns `fileId`; file is never stored in Msingi's database

**Grade Auto-Sync (Google Pub/Sub webhook)**
- `POST /api/elearning/gc-webhook` — validates Pub/Sub push signature; resolves student by `googleId`; writes returned grade to Grades module

**Zoom Live Sessions (Server-to-Server OAuth)**
- `_getZoomToken()` — cached Server-to-Server OAuth token (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`)
- `_zoomFetch()` — thin wrapper with token injection and error normalisation
- Zoom webhook: `POST /api/elearning/zoom-webhook` — handles `participant_joined`, `participant_left`, `meeting.ended`, `recording.completed`; marks attendance in Attendance module; HMAC-SHA256 challenge response for setup

**Google Meet Live Sessions (Calendar API)**
- `_createMeetSession()` — creates a Google Calendar event with `conferenceDataVersion: 1`; returns `hangoutLink`
- `_deleteMeetSession()` — removes the calendar event when session is cancelled
- `POST /api/elearning/sessions/:sessionId/attend` — records a student's Meet join-click as an attendance record (Meet doesn't fire webhooks; join-click is the proxy signal)

**Sessions API (Zoom + Meet unified)**
- `GET  /api/elearning/sessions?platform=zoom|meet` — lists sessions for a course
- `POST /api/elearning/courses/:id/sessions` — schedule session (platform: `zoom` | `meet`); title, date/time, duration; creates Zoom meeting or Google Calendar event accordingly
- `PATCH /api/elearning/sessions/:id` — update title / scheduled time
- `DELETE /api/elearning/sessions/:id` — cancel and delete upstream meeting

### New — `server/index.js`

- `app.use('/api/elearning', require('./routes/elearning'))` mounted

### New — `client/src/pages/elearning/ELearningPage.jsx` (~1600 lines)

- **Route dispatcher** — `/elearning/classroom` → `ClassroomView`; `/elearning/meet` → `SessionsView({ platform: 'meet' })`; `/elearning/zoom` → `SessionsView({ platform: 'zoom' })`; Zoom path skips Google auth check entirely
- **`ConnectCard`** — shown when teacher has not connected Google account; distinct icon/text for Classroom vs. Meet
- **`ClassroomView`** — course sidebar + **Classwork / People / Grades** tabs (green Google Classroom accent); course picker; create coursework slide-over with title, instructions, due date, PDF upload
- **`SessionsView`** — Meet or Zoom session list; **Schedule Session** modal: course picker, title, date, duration; Join link rendered for upcoming sessions
- **`ScheduleSessionModalFull`** — full-featured scheduling modal used from both Meet and Zoom views

### New — `client/src/components/layout/Sidebar.jsx` — eLearning section

- `ELEARNING_ITEMS` — Google Classroom, Google Meet, Zoom sub-links with inline SVG brand icons
- Accordion with `eLearningOpen` state; auto-opens when on any `/elearning/*` path
- Regular `NavLink` for all other module links; accordion only for eLearning

---

## [4.25.0] — 2026-06-08  Profile Photo — Auth Fix, Error Handling, Size Validation

### Fixed — `GET /api/users/:id/photo` no longer requires auth (`server/routes/users.js`)

- **Root cause**: `authMiddleware` was required on the photo endpoint, but browser `<img src="...">` tags cannot send `Authorization: Bearer` headers — photos always returned 401 for all users
- **Fix**: `authMiddleware` removed from `GET /:id/photo`; school tenant header still resolved from `X-School-Slug` for multi-tenancy

### Fixed — Profile photo upload silent failure (`client/src/pages/profile/ProfilePage.jsx`)

- `resizeImageToBase64` — `img.onerror` was passing the raw DOM `Event` object to `reject()` instead of an `Error`; unhandled rejection was swallowed silently; now wraps in `new Error('Image failed to load: ' + src)`
- Uses `authApi.uploadPhoto()` / `authApi.removePhoto()` from the API client (handles multi-tenant slug) instead of raw `fetch()`

### Changed — Pre-upload validation + UX

- MIME type check before resize: only `image/jpeg`, `image/png`, `image/webp`, `image/gif` accepted; others rejected with an inline error message
- File size limit: 10 MB max enforced on the client before any upload attempt
- `fmtBytes(bytes)` helper — converts raw bytes to human-readable string (e.g. `3.2 MB`)
- Success banner shows original file size (e.g. "Photo updated · 1.4 MB")

---

## [4.24.0] — 2026-06-08  School Logo in Sidebar + Dynamic Favicon

### Changed — `client/src/components/layout/Sidebar.jsx`

- **School logo in sidebar header** — if `school.logoUrl` is set in session, renders `<img src={logoUrl} alt={schoolName} />` (40×40 rounded, object-cover); falls back to a `<div>` with two-letter initials and `primaryColor` background when no logo is uploaded
- Logo and initials transition smoothly via shared CSS class; no layout shift

### Changed — `client/src/components/layout/AppShell.jsx`

- **Dynamic favicon** — `useEffect` watches `session.school.faviconUrl` + `session.school.name`; on change, updates `<link rel="icon" href=...>` in `document.head`; falls back to the platform default favicon when `faviconUrl` is absent
- **Dynamic page title** — `document.title` set to `"Msingi — <School Name>"` when school name is available

---

## [4.23.0] — 2026-06-08  Settings: School Logo + Favicon Upload

### New — `PUT/DELETE /api/settings/school/logo` and `PUT/DELETE /api/settings/school/favicon` (`server/routes/settings.js`)

- `PUT /school/logo` — accepts base64 data URI; validates MIME (`image/*`); stores in `schools.logoUrl`; returns updated URL
- `DELETE /school/logo` — clears `logoUrl` from school document
- `PUT /school/favicon` — same flow; stores in `schools.faviconUrl`
- `DELETE /school/favicon` — clears `faviconUrl`
- RBAC: admin or superadmin only; `_uid()` uses `crypto.randomBytes` (see v4.28.0)

### New — `AssetUploader` component (`client/src/pages/settings/SettingsPage.jsx`)

- File picker with image preview (drag-and-drop not required — standard `<input type="file">`)
- Shows current asset if already uploaded; **Replace** and **Remove** actions
- Instant save on selection — no separate submit needed; toast on success/error
- `useRef` imported and used for the hidden file input

### New — `BrandingCard` in SettingsPage School tab

- Two side-by-side `AssetUploader` instances: **School Logo** (appears in sidebar, login page) and **Favicon** (browser tab icon)
- Recommended sizes displayed as helper text (logo: 200×200 px, favicon: 32×32 px)
- On save, dispatches `patchSchool({ logoUrl, faviconUrl })` to update Zustand session so sidebar and favicon refresh instantly without re-login

---

## [4.22.0] — 2026-06-08  School Finder — Public School Search + Generic Login Guard

### New — `GET /api/public/schools/search?q=` (`server/routes/public.js`)

- Case-insensitive regex search against both `name` and `slug` fields; returns up to 10 matching schools
- Response shape: `[{ slug, name, shortName, logoUrl }]` — minimal branding info for the autocomplete list
- No authentication required (public endpoint); rate-limited by global limiter

### New — `GET /api/public/school-asset/:type?slug=` (`server/routes/public.js`)

- `type` ∈ `logo | favicon`; looks up school by `slug` query param; streams the stored data URI as binary with correct `Content-Type` header
- Allows the login page and School Finder to render school branding without any auth token

### Changed — `GET /api/public/school-info` (`server/routes/public.js`)

- Response now includes `faviconUrl` alongside the existing branding fields

### New — `SchoolFinderPage.jsx` (`client/src/pages/SchoolFinderPage.jsx`)

- Shown on the main domain (no school context) before the login form
- Search input with 300 ms debounce → `GET /api/public/schools/search?q=` → autocomplete dropdown
- Each result shows school logo (or initials), name, and slug
- Clicking a result stores the slug in `localStorage` (`ms_school_slug`) and navigates to `/login?school=<slug>`
- Empty state with friendly "Start typing a school name…" hint; no results state with "School not found? Contact your administrator."

### Changed — `client/src/pages/Login.jsx`

- **Generic domain guard**: `if (!isSchool) return <SchoolFinderPage />;` inserted before the `loadingBranding` check — users who land on `msingi.io/login` without a school context see the finder instead of a broken login form

---

## [4.21.0] — 2026-05-26  Sections as a Managed School Resource

### New — `/api/sections` resource

- Sections (Kindergarten, Primary, Secondary, A-Level) are no longer hardcoded in frontend constants
- New `server/routes/sections.js` — full CRUD per school: `GET`, `POST`, `PUT /:id`, `DELETE /:id`
- Auto-seeds the 4 standard sections on first GET per school — no migration script needed
- `DELETE` is blocked if active classes are assigned to the section (referential integrity)
- **Key is immutable** after creation (it's the foreign key used by classes and bell schedule); name and colour can always be changed
- Route registered at `app.use('/api/sections', ...)` in `server/index.js`

### Changed — Classes route

- `sectionKey` validation relaxed from `z.enum(['kg','primary','secondary','alevel'])` to `z.string().max(50)` so any admin-created section key is accepted

### New — Settings → School → Sections panel

- `SectionsPanel` component added to SchoolTab between Houses and M-Pesa
- Lists all school sections with colour dot, display name, and immutable key badge
- Inline edit row: change name and colour without leaving the page
- Add Section form with auto-derived key from name (editable), colour palette + custom picker, live badge preview
- Delete with confirmation dialog; blocked server-side if classes are in use

### New — `client/src/hooks/useSections.js`

- `useSections()` hook — fetches from `/api/sections` with React Query, `staleTime: 10m`
- Returns `{ sections, sectionMap, sectionTabs, isLoading }` where:
  - `sectionMap[key]` → `{ name, color, id }`
  - `sectionTabs` → `[{ id:'all', label:'All Sections' }, ...]` ready for filter tabs

### Changed — Classes page (`ClassList.jsx`)

- Removed hardcoded `SECTION_LABELS` and `SECTION_BADGE` constants
- Section filter tabs now built from `sectionTabs` — show school's actual configured sections
- Active filter tab colour matches the section's configured colour (inline style)
- Section badge on each class card uses inline hex colour (background tint + border), no Tailwind purge risk
- **Add Class form** Section dropdown now populated dynamically from `sectionTabs`

### Changed — Timetable page (`TimetablePage.jsx`)

- Removed `SECTIONS` import from constants; replaced with `useSections()` hook
- Section filter tabs (All Sections | Primary | Secondary …) now reflect school's configured sections
- Active tab styled with section colour
- `filteredClasses` now prefers `c.sectionKey` (stored field) over `inferSection(c.name)` (name inference)
- Bell schedule section lookup also upgraded to use stored `sectionKey` first

### New — `client/src/api/client.js`

- Added `sections` export with `list`, `create`, `update`, `remove` methods

---

## [4.20.0] — 2026-05-26  Settings RBAC Matrix Expansion + Landing Page Refresh

### Changed — Roles & Permissions sub-module matrix expanded

- **Students**: added `Import Students (CSV)` permission sub
- **Teachers**: added `Import Teachers (CSV)` permission sub
- **Classes**: added `Export Classes (CSV)`, `Import Classes (CSV)`, and `Manage Sections & Streams` subs
- **Timetable**: expanded from 2 subs to 7 — added `Manage Rooms`, `Configure Bell Schedule`, `Manage Teaching Assignments`, `Import Timetable (CSV)`, `Export Timetable (CSV)`
- **Finance**: added `Manage Fee Structures`, `Import Finance Data (CSV)`, and `Configure M-Pesa Integration` subs

### Changed — Default role permission rules updated

- `deputy`: can manage fee structures (edit); blocked from M-Pesa config (sensitive)
- `teacher`: blocked from all `import` actions across every module; blocked from `classes.section`, `classes.delete`; timetable admin subs (rooms, bell schedule, assignments) granted as view-only
- `parent`: can view invoices and payments; explicitly denied fee structure management, M-Pesa config, import, and invoice creation/voiding

### Changed — System tab version corrected

- Hardcoded version string updated from `v4.9.13` → `v4.19.0`

### Changed — Landing page updated to reflect current feature set

- `PLAN_FEATURES` expanded from 14 → 17 features:
  - Added **Subjects & Curriculum Management** (Core tier)
  - Added **Class Sections & Streams** (Core tier)
  - Added **CSV Bulk Import / Export** (Standard tier)
- Plan `included` arrays updated to match — Core now covers 8 features (up from 6)
- Dashboard mockup sidebar updated: added Timetable and Subjects nav items
- Ecosystem flow chain updated: **Classes** node inserted between Student Record and Timetable to reflect sections & streams milestone in student journey

---

## [4.19.0] — 2026-05-26  Collapsible Sidebar + Class Sections & Streams

### New — Collapsible sidebar (desktop)

- Sidebar spring-animates between 256 px (expanded) and 64 px (collapsed) via Framer Motion
- Collapse state persisted to `localStorage` — survives page refresh and navigation
- **Collapsed mode**: icons only, perfectly centred in 64 px; native `title` tooltip on hover for every nav item
- Text labels fade out (0.1 s) before the sidebar width contracts; fade in after a 0.14 s delay on expansion so the width spring leads and text follows
- Section group labels animate `maxHeight + opacity + margin` to zero simultaneously when collapsing
- Collapse/expand toggle button lives at the bottom of the nav (above user footer): `ChevronLeft` when expanded, `ChevronRight` when collapsed
- Footer: stacked avatar + logout icon when collapsed; full name/role/logout row when expanded
- Mobile overlay drawer is completely unaffected (no `collapsed` prop passed)
- `AppShell` uses `motion.aside` with `initial={false}` — no animation flash on first load

### New — Class sections & streams

- `sectionKey` field added to `ClassSchema` (Zod validation on POST and PUT): `kg | primary | secondary | alevel`
- **Add Class form** restructured: Section + Year/Level side-by-side (row 1), Room + Capacity (row 2), Status standalone, then Form Tutor and Description
- **ClassList** now groups classes by `year` field — classes sharing the same `year` are streams (e.g. Year 7A, 7B, 7C appear under a "Year 7 · 3 streams" header)
- **Section filter tabs** above the grid: All | Kindergarten | Primary | Secondary | A-Level — tabs only render for sections that have at least one class; counts shown inline
- **Section colour badge** on each card: blue = Primary, violet = Secondary, amber = A-Level, emerald = Kindergarten
- Empty-section state when filtering: friendly message + "Show all sections" link instead of blank grid
- All filtering is client-side (no extra network round-trips — 200 classes already loaded)

---

## [4.18.0] — 2026-05-26  Import/Export Dissolution — Bulk import embedded in each module

### Changed — Removed standalone Import & Export page

The `/import-export` route, sidebar link, and `ImportExportPage.jsx` have been dissolved.
Import and export functionality now lives directly inside each relevant module.

### New — Bulk import in Students module

- Import button added to the Students list toolbar
- Opens `BulkImportSlideOver` with `type="students"`, template download, and export
- Server handler `_importStudents` already existed; wired to the new slide-over

### New — Bulk import in Teachers (HR) module

- Import button added to the Teachers list toolbar alongside the existing Export button
- Opens `BulkImportSlideOver` with `type="teachers"`, template download, and export

### New — Import + Export in Classes module

- Import and Export buttons added to the Classes header toolbar
- `_importClasses`: inserts new classes; skips duplicates by name silently
- CSV fields: `name`, `sectionKey`, `year`, `capacity`
- Export added to `/api/import-export/export/classes`

### New — Timetable CSV import

- Import button added to the Timetable page toolbar (admin/timetabler only)
- `_importTimetable`: upsert by `schoolId + classId + day + period` — existing slots updated, new slots created
- Resolves `className → classId` and `teacherName → teacherId` automatically
- Export added to `/api/import-export/export/timetable`

### New — Finance bulk invoice import

- Import button added to the Invoices tab toolbar (finance admins only)
- `_importFinance`: one CSV row → one invoice with one line item
- Resolves `admissionNumber → studentId` automatically
- Each invoice generated with a sequential `invoiceNumber`
- Export added to `/api/import-export/export/finance`

### New — Shared `BulkImportSlideOver` component

`client/src/components/import/BulkImportSlideOver.jsx`

- Motion slide-over panel (backdrop + right-panel)
- Drag-and-drop upload zone + file picker; parses and previews row count
- Template download + optional Export button
- Import result summary: created count, skip count, per-row error table
- Type-specific tips section (timetable upsert note, classes skip note, finance note)

### Backend additions (`server/routes/import-export.js`)

- `_buildTeacherMap(schoolId)` — name → `{ teacherId, teacherName }` lookup
- `_importClasses`, `_importTimetable`, `_importFinance` handler functions
- POST dispatcher extended to route all 5 types
- Export handler extended for `timetable` and `finance`

### Navigation cleanup

- Sidebar: removed `Import & Export` link
- TopBar breadcrumb map: removed `/import-export` entry
- App.jsx: removed lazy import and route for `ImportExportPage`
- SettingsPage: updated import/export note to point users to respective modules
- HelpPage: updated 3 answers to reflect new locations

---

## [4.17.0] — 2026-05-26  Rooms Registry + Teaching Assignments + Timetable Auto-fill

### New — Room Registry (`/api/rooms`)

- `GET /` — list registered rooms for the school
- `GET /:id` — single room detail
- `POST /` — create room (name, code, type, capacity, notes); duplicate name guard per school
- `PUT /:id` — update room details
- `DELETE /:id` — soft-delete (`isActive: false`); timetable slots that reference the room are NOT deleted
- Room types: `classroom`, `lab`, `hall`, `sports`, `library`, `other`
- RBAC: admin / superadmin / deputy / principal / timetabler may write; all authenticated users may read
- Double-booking: allowed (timetable warns but never blocks)

### New — Teaching Assignments (`/api/teaching-assignments`)

One record = "Teacher X delivers Subject Y to Class Z in preferred Room R"

- `GET /` — filterable by `teacherId`, `classId`, `subjectId`, `roomId` — teachers see only own assignments
- `POST /` — creates assignment; denormalises `teacherName`, `subjectName`, `className`, `preferredRoomName` at write time
- `PUT /:id` — update `preferredRoomId` and/or `periodsPerWeek` only
- `DELETE /:id` — hard delete
- RBAC: admin / principal / deputy — any subject/class; HOD — only subjects in their `departmentId`; timetabler — read-only; teacher — own assignments only
- Duplicate guard: same `teacherId + subjectId + classId` → 409 Conflict

### New — Teacher Module: Assignments Tab

- Teacher detail slide-over now has two tabs: **Profile** and **Assignments**
- Assignments tab lists all `teaching_assignments` for the selected teacher
- Shows: Subject · Class · Preferred Room · Periods/week
- Add assignment form: class picker → subject picker (filtered from class curriculum) → room picker (from registry) → optional periods/week
- Subjects are populated from the class's curriculum (`/api/class-subjects?classId=X`) — only subjects already assigned to that class appear
- Admin / principal / HOD can add/remove assignments; teachers see read-only

### New — Timetable: Rooms Tab

- New **Rooms** view in the Timetable page (admin/timetabler only)
- Left panel: Room Registry CRUD (via `RoomsTab` component)
- Right panel: Room occupancy grid — shows Subject · Teacher · Class per cell for the selected room across the full week
- Double-bookings highlighted in red with conflict count badge
- Handles unregistered rooms (free-text rooms stored in old slots)

### Enhanced — Slot Editor Auto-fill

- **Subject field**: now a dropdown populated from the class's curriculum; falls back to free text if no curriculum is configured
- **Room field**: now a dropdown populated from the registered rooms registry; falls back to free text if no rooms registered; shows "unregistered" hint for legacy free-text room values
- **Auto-fill**: selecting a subject triggers a lookup against `teaching_assignments` for that class+subject combination; if found, teacher and preferred room are automatically populated
- Status banner: green "Auto-filled" confirmation, amber "No assignment found — fill manually" hint, or loading spinner while lookup is in progress
- All auto-fill is non-blocking — user can override any field after auto-fill

### Architecture

- `server/routes/rooms.js` — new route module
- `server/routes/teaching-assignments.js` — new route module
- `client/src/pages/timetable/components/RoomsTab.jsx` — new component
- `client/src/pages/timetable/components/RoomView.jsx` — new component
- `client/src/api/client.js` — `rooms` and `teachingAssignments` API objects added

---

## [4.11.5] — 2026-05-25  Phase 3 — Subject Enrollment Warnings Engine

### New — `GET /api/class-subjects/enrollment-warnings`

Rule resolution per class (most specific wins):
- **classPattern** match: regex tested against `classId` — e.g. `f[34]` catches Form 3A and Form 4A before the general secondary rule fires
- **section** match: fallback using `class.sectionKey` (primary / secondary / alevel)
- **No rule**: student rows get `status: 'no_rule'`; class excluded from school-wide warning list

Modes:
- `?classId=X` — full per-student breakdown for one class
- *(no params)* — school-wide: only classes with ≥1 `below_min` or `above_max` student are returned, keeping the timetabler dashboard noise-free

Per-student fields: `id`, `firstName`, `lastName`, `admissionNumber`, `subjectCount`, `status`  
Per-class summary: `ok`, `belowMin`, `aboveMax`, `noRule`, `total`

---

## [4.11.4] — 2026-05-25  Phase 2 — Class Curriculum & Subject Rules APIs

### New — `/api/class-subjects`

- `GET ?classId=X` — full curriculum for a class with subject + department details
- `GET ?subjectId=X` — all classes that offer a given subject
- `GET /counts` — `{ classId: subjectCount }` for class cards
- `POST /` — assign a single subject to a class (validates both entities exist)
- `POST /bulk` — assign multiple subjects at once; idempotent, skips already-assigned
- `PUT /:id` — toggle `isCompulsoryForClass` flag
- `DELETE /:id` — guarded: blocked if students are still enrolled in the subject for that class

### New — `/api/subject-rules`

Full CRUD for min/max subject count rules.  
Gated to `timetable:update` (same permission as bell schedule editing).

### Updated — `GET /api/subjects`

New `?withClassCurriculum=classId` param: attaches `inCurriculum`, `isCompulsoryForClass`, `classSubjectId` to each subject row — one request powers the entire curriculum editor list.

---

## [4.11.3] — 2026-05-25  Phase 1 Seed Foundation — A-Level Classes, Subject Curriculum & Enrollment

### New — A-Level support

- Added Form 5A and Form 6A classes with `sectionKey: 'alevel'` and their own section record (`sec_alevel_sch_demo`).
- Added 4 new A-Level-only subjects: **Pure Mathematics** (PMATH), **Mechanics** (MECH), **Statistics & Probability** (STAT), **Economics** (ECO) — all under their respective departments (Mathematics / TBS).
- Subjects that span secondary and A-Level (Physics, Chemistry, Biology, History, Geography, Business Studies) now have `sections: ['secondary', 'alevel']`; always patched on re-seed.

### New — Class curriculum assignments (`class_subjects` collection)

- 96 class-subject links seeded across all 9 classes:
  - Primary (Std 4A–6A): 7 compulsory subjects + ICT elective.
  - Form 1A–2A: 8 compulsory core + 4 electives.
  - Form 3A–4A: 3 compulsory + 9 electives (KCSE model).
  - Form 5A–6A: 12 all-elective A-Level subjects.

### New — Student subject enrollments (`student_subjects` collection)

- 163 individual enrollment records generated from ENROLLMENTS groups for all 20 demo students.
- Enrollment reflects realistic curriculum choices: science track, humanities track, KCSE subjects, full primary curriculum.

### New — Subject enrollment rules (`subject_rules` collection)

- 4 rules seeded (min/max subjects per section, like bell schedule settings):
  - Primary: min 6, max 8.
  - Secondary Form 1-2: min 7, max 10.
  - KCSE Form 3-4: min 7, max 9 (pattern `f[34]`).
  - A-Level: min 3, max 4.

### New — Teacher profiles enriched

- All 10 teacher profiles now include `staffType: 'teacher'`, `departmentId`, `subjects[]`, `extraRoles[]`, and `formClassId` where applicable.
- Extra academic roles seeded: `hod` (6 teachers), `class_teacher` (1), `exam_officer` (1), `timetabler` (1).

### Fixed — Department HOD foreign-key links

- Departments now store `hodId` (teacher profile ID) and `hodUserId` (user ID) alongside `hodName`.
  Patched on every re-seed via `$set` so legacy docs are upgraded automatically.

---

## [4.11.2] — 2026-05-25  Timetable Seed Fix + Substitution Engine Bug Fixes

### Fixed — Seed data collection mismatch (Critical)

- `seed-demo-data.js` was writing timetable slots to the wrong MongoDB collection (`timetable_slots`) while all API routes read from `timetable`.  
  All 60 seeded timetable slots were completely invisible to the API — this caused "No lessons found" on every mark-absent request and empty class grids.  
  Fixed: seed now writes to the correct `timetable` collection.

### Fixed — Teacher ID format mismatch in substitution engine

- `POST /substitutions/absent`: Teacher profile IDs (`tch_demo_2`) and user IDs (`u_demo_t2`) are two different formats stored across collections.  
  The frontend sends the teacher profile's `id` field, but timetable slots store `teacherId` as user IDs.  
  Fixed: route now resolves the teacher profile via `$or: [{ id }, { userId }]`, builds a `slotIds` array with both formats, and queries timetable slots using `$in`.  
  `originalTeacherId` is now stored as the canonical `userId` so exclusions match slot format downstream.

- `GET /available-teachers`: `busyIds`, `absentIds`, `coveredIds` sets are built from user IDs (`u_demo_t2`) in timetable slot data.  
  The teacher filter was comparing against teacher profile IDs (`tch_demo_2`) — no teacher was ever excluded.  
  Fixed: now checks both `t.userId` and `t.id` against each exclusion set; weekly load uses `userId` as the primary key.

- `POST /substitutions/auto-assign`: Same dual-ID fix applied; load calculation and exclusion filter both use `userId` as the canonical identifier.

### New — Full timetable seed for all 7 classes

- Added weekly timetable data for the 5 previously empty classes:  
  Standard 5A (25 slots), Standard 6A (25 slots), Form 2A (30 slots), Form 3A (30 slots), Form 4A (30 slots).  
  Total seeded slots increased from 60 to **205** (all 7 classes, full week, Mon–Fri).
- All timetable slots now include `subject` (display string) and `className` fields so substitution records show meaningful data in the Cover Sheet.

---

## [4.11.1] — 2026-05-24  Timetable: Smart Cover Sheet & Substitution Engine

### New — Available-teachers API (`server/routes/timetable.js`)

- `GET /api/timetable/available-teachers?date=YYYY-MM-DD&period=5&subject=MAT`  
  Returns active teachers who are **free** at the given period on the date's weekday.  
  Excludes: teachers with a lesson at that period (master timetable), teachers already marked absent today, substitutes already covering another lesson at the same period.  
  Sorted: **same-department first** (matched on subject prefix), then **fewest weekly lessons** (most available teacher rises to top).  
  First result flagged `suggested: true`.

### New — Auto-assign endpoint (`server/routes/timetable.js`)

- `POST /api/timetable/substitutions/auto-assign` — body: `{ date }`  
  For every uncovered substitution record on a given date, finds the best available teacher and assigns them in one call.  
  Processes records in period order; tracks assignments made within the call so no teacher is double-booked at the same period.  
  Returns `{ assigned, total }`.

### Changed — Substitution update accepts `type` field

- `PUT /api/timetable/substitutions/:id` now accepts `type: 'supervision' | 'cover' | 'teaching'` (independent of substitute assignment — can be updated separately).

### New — `SubstituteCell` component (`TimetablePage.jsx`)

Per-row React component that fires its own `useQuery(['tt-avail', date, period, subject])` to fetch the available-teacher list for that specific period. React Query deduplicates — two absent teachers with lessons at the same period share one HTTP request.

- Dropdown shows: `⭐ Ms. Sylvia (dept) · 12 lessons` (top suggestion), then other available teachers ranked by load.
- Teachers who are busy, absent, or already covering at that period are excluded automatically.
- Print mode: dropdown hidden, assigned name shown inline.

### Changed — Cover / Subs tab complete redesign (`TimetablePage.jsx`)

Cover sheet now matches the **aSc Substitutions** format exactly:

| Absent | Lesson | Reason | Subject | Class | Type | Substitutes | Signature |
|--------|--------|--------|---------|-------|------|-------------|-----------|

- **Absent teacher column** uses `rowSpan` across all their lessons — same visual grouping as aSc output.
- **Type column** — per-row dropdown: Supervision / Cover / Teaching (screen only; hidden in print).
- **Substitutes column** — `SubstituteCell` with smart ranked picker per period.
- **Signature column** — shown only in print view.
- **Summary header** — `"Unfortunately, the following teachers will not teach today: Mr. Godfrey (5, 7) and Ms. Beatrice (2)"` — generated dynamically from the day's absent records.
- **Auto-assign all** button — fills every uncovered row in one click using the best available teacher; shows result count in toast.
- **Print footer** — timestamp and page marker matching aSc style.

### Changed — Client API (`client/src/api/client.js`)

```js
timetable.availableTeachers(params)           // GET /timetable/available-teachers
timetable.substitutions.autoAssign(data)      // POST /timetable/substitutions/auto-assign
```

---

## [4.11.0] — 2026-05-24  Events Birthdays · HR Document Links · Settings Users Filter

### New — Birthdays view in Events (`server/routes/events.js`, `EventsPage.jsx`)

- `GET /api/events/birthdays?month=5&year=2026`  
  Queries both `students` and `teachers` collections using a regex on the `dateOfBirth` field (format `YYYY-MM-DD`).  
  Returns sorted list of birthdays for the selected month with `{ id, name, type, day, dateOfBirth, meta, photoUrl }`.  
  Route placed **before** `GET /:id` to prevent Express matching "birthdays" as an ID param.

- **Events page** (`EventsPage.jsx`) — three-view toggle: **Month** (calendar grid) | **List** (upcoming events) | **Birthdays** (🎂 cake icon).
  - `BirthdayCard` — avatar with initials fallback, Student / Staff badge, class or "Teacher" meta, date display.
  - Calendar cells show birthday count overlay; clicking switches to the birthdays view for that month.
  - Stats row in birthdays view: total / students / staff counts.
  - Today's birthday banner in month and list views (rose/pink highlight).
  - Month navigator shared across all three views.
  - `birthday` added to `CATEGORIES` constant with rose colour.

### Changed — HR Documents — document link field (`HRPage.jsx`)

- Added `fileUrl` field to the document creation form.
- URL input with placeholder `https://drive.google.com/… or OneDrive / Dropbox link` and helper text explaining external storage.
- Document cards: **View Document** external link appears when `fileUrl` is set (opens in new tab).
- No server-side file storage required — links to Google Drive / OneDrive / Dropbox are stored as a URL string.

### Changed — Settings Users — role filter + search (`SettingsPage.jsx`)

- Added `roleFilter` state and `search` state to the `UsersTab` component.
- **Filter bar**: text search (name or email) + role dropdown covering all 13 system roles.
- **Clear** button resets both filters.
- Counter shows `X of Y users` when a filter is active.
- All filtering is client-side on the already-fetched user list — no additional API calls.

---

## [4.10.1] — 2026-05-24  Global Cleanup — Dead Legacy App Removed

### Removed — Legacy vanilla-JS application (29,000+ lines deleted)

The original vanilla-JS frontend that predated the React SPA has been fully deleted. It had no active users — the React build at `client/dist/` is the only served frontend — but its presence created version-switching risk.

**Deleted files:**
- `index.html` — legacy app shell
- `css/styles.css` — legacy stylesheet
- `js/api.js`, `js/app.js`, `js/cache.js`, `js/data.js`, `js/tests.js`, `js/validators.js`
- `js/modules/` — 21 module files (academics, admissions, attendance, auth, behaviour, birthday, changelog, classes, communication, dashboard, events, exams, finance, help, hr, plans, reports, settings, students, subjects, timetable)
- `server/utils/seedSchool.js` — superseded by `scripts/seed-demo.js`

**`server/index.js`**
- Legacy catch-all that served the deleted `index.html` replaced with a `503` response instructing developers to run the React build. Prevents silent fallback to a non-existent file.

### Fixed — Stale InnoLearn / legacy references

**`onboard.html`**
- Demo login link: `/?demo=innolearn` → `/login?school=demo` (correct school slug).
- "Go to My Portal" button: `href="index.html"` → `href="/login"`.

**`server/routes/onboard.js`**
- `loginUrl` in welcome email: `/index.html` → `/login`.

**`platform.html`**
- Demo school label: `slug: innolearn` → `slug: demo`.
- Subscription pricing corrected: Core KES 5,000 · Standard KES 12,000 · Premium KES 25,000 (was 15K / 35K / 65K).

**`server/routes/auth.js`**
- Internal comment example header updated: `X-School-Slug: InnoLearn` → `X-School-Slug: demo`.

### Fixed — Database name safety (`server/config/db.js`)
- Added prominent warning comment: `dbName: 'innolearn'` is the **live Atlas database name** — changing this fallback without a migration would silently point to an empty database.
- `MONGODB_DB_NAME` env var now the override path.

### Fixed — Scripts use env var for DB name
- `scripts/fix-provisioned-users.js`, `fix-school-ids.js`, `list-users.js`, `seed-role-permissions.js` — all now read `process.env.MONGODB_DB_NAME || 'innolearn'` instead of the hardcoded string.
- `scripts/list-users.js` — removed hardcoded `schoolId: 'sch_innolearn_001'` filter (was silently returning 0 results for all other schools).

---

## [4.10.0] — 2026-05-24  Security Hardening + Google/Microsoft OAuth + M-Pesa Subscription

### Security — Critical fixes

**`server/routes/auth.js`**
- Removed plain-text password fallback (`password === user.password`). All accounts must have a bcrypt hash — legacy plaintext accounts can no longer sign in.
- Replaced `Math.random()` OTP generation with `crypto.randomInt` (Node.js CSPRNG).

**`server/middleware/auth.js`**
- Platform admin key now compared using `crypto.timingSafeEqual` — prevents timing-side-channel attacks on the `X-Platform-Key` header.

**`server/routes/mpesa.js`**
- All Safaricom callback endpoints now enforce an IP allowlist (`SAFARICOM_IPS`) in production. Requests from unknown IPs receive `403 Forbidden` — blocks fake payment injection attacks.
- Set `MPESA_SKIP_IP_CHECK=true` in sandbox/dev environments to bypass.

### New — Google OAuth 2.0 (`server/routes/auth.js`)
- `GET /api/auth/google?slug=<school>` — redirects to Google OAuth consent screen.
- `GET /api/auth/google/callback` — exchanges code, fetches profile, finds or creates user, issues JWT. New users provisioned as `teacher` role; admin upgrades role.
- State parameter carries school slug for tenant resolution.
- Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL`.

### New — Microsoft OAuth 2.0 (`server/routes/auth.js`)
- `GET /api/auth/microsoft?slug=<school>` — redirects to Microsoft identity platform.
- `GET /api/auth/microsoft/callback` — same flow as Google.
- Required env vars: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `PUBLIC_URL`.

### New — Social login buttons (`client/src/pages/Login.jsx`)
- Google and Microsoft sign-in buttons below the password form.
- OAuth token read-back on redirect return — reads `?token=` from URL, calls `/api/auth/me`, sets session.
- Error handling for all failure cases (denied, not configured, school not found, account inactive).

### New — M-Pesa subscription payments (`server/routes/mpesa.js`)
- `POST /api/mpesa/subscription` — admin/principal only; initiates STK Push to pay Msingi platform subscription. Uses platform Daraja credentials (`MSINGI_MPESA_*` env vars), not school's own credentials.
- `POST /api/mpesa/subscription/callback` — Safaricom callback; activates school plan for 30 days on successful payment.
- `GET /api/mpesa/subscription/plans` — public pricing endpoint.
- Subscription prices: Core KES 5,000 · Standard KES 12,000 · Premium KES 25,000.

### New — Subscription tab (`client/src/pages/settings/SettingsPage.jsx`)
- New **Subscription** tab in Settings (admin-only) between School and Users.
- Shows current plan + expiry, plan selector grid, STK Push payment form.
- Enterprise plan routes to `sales@msingi.io`.

### Changed — Plan tier alignment
**`server/middleware/plan.js`**
- `finance`: `premium` → `standard` (fee management is a core East African school need; aligns with landing page).
- `report_cards`: `premium` → `standard` (aligns with landing page promise).
- `hr`: new entry at `premium`.

**`client/src/pages/Landing.jsx`**
- Plans feature matrix updated to match backend — Finance & Fee Ledger now shown starting at Standard (not Core); all 14 features correctly gated per tier.
- Finance moved after core communication features in the table order.

---

## [4.9.19] — 2026-05-20  Subjects & Departments Registry

### New — `server/routes/departments.js`

Full CRUD API for the school's **department registry**.

- `GET /api/departments` — lists all active departments with embedded subject count per department.
- `GET /api/departments/:id` — single department.
- `POST /api/departments` — create; validates unique code within school.
- `PUT /api/departments/:id` — update; code uniqueness check excludes self.
- `DELETE /api/departments/:id` — soft-delete (`isActive: false`); **blocked** if active subjects still exist in that department.
- Schema: `{name, code, color (#hex), hodName, description, order, isActive}`.
- RBAC: write routes gated by `rbac('departments', 'create'|'update'|'delete')`.

### New — `server/routes/subjects.js`

Full CRUD API for the school's **subject registry**.

- `GET /api/subjects` — list active subjects; filterable by `departmentId`, `section`, `isCompulsory`.
- `GET /api/subjects/:id` — single subject.
- `POST /api/subjects` — create; validates `departmentId` belongs to this school; enforces code uniqueness.
- `PUT /api/subjects/:id` — update with same guards.
- `DELETE /api/subjects/:id` — soft-delete only.
- Schema: `{name, code, shortName, departmentId, sections['kg'|'primary'|'secondary'|'alevel'|'all'], isCompulsory, color, order, description}`.
- RBAC: write routes gated by `rbac('subjects', 'create'|'update'|'delete')`.

### New — `client/src/pages/subjects/SubjectsPage.jsx`

Premium **Subjects & Departments** page accessible at `/subjects`.

- **Department cards** — each department rendered as a collapsible card showing name, code, HoD name, subject count, and colour badge. Expand/collapse the subject list per department.
- **Subject rows** — within each card, subjects listed with colour dot, code, short name, compulsory badge, and section pills (KG / Primary / Secondary / A-Level / All).
- **Add/Edit Department slide-over** — full form: name, code, sort order, colour picker (10 presets + custom), HoD name field, description.
- **Add/Edit Subject slide-over** — full form: name, code, short name, department selector, section multi-toggle buttons, compulsory toggle, colour picker, sort order, description.
- **Deactivate dialogs** — confirm before soft-deleting; department deletion warns about active subjects first.
- **Search** — filters both department names/codes and subject names/codes simultaneously.
- **Stats strip** — Departments / Subjects / Compulsory counts at a glance.
- **RBAC guard** — edit controls (add/edit/delete buttons) shown only to `admin`, `deputy`, `superadmin`.
- Toasts for save success / errors.

### Updated — Demo seed (`server/utils/seedSchool.js`)

- **9 departments** seeded with HoD names, colours, descriptions:  
  Mathematics, English Language & Literature, Sciences, Humanities & Social Sciences, Modern Foreign Languages, ICT & Computing, Creatives, Physical Education, Religious Studies.
- **24 subjects** seeded across all departments with correct `departmentId`, `sections`, `isCompulsory`, `color`:  
  Maths, Pure Maths, Statistics, Mechanics — English Language, English Literature — Science (general), Biology, Chemistry, Physics — Social Studies, History, Geography, Economics — Kiswahili, French, Spanish — ICT, Computer Science — Art & Design, Music, Drama — PE — CRE.
- Original 6 subject IDs preserved (grades, exams, timetable references unbroken).

### Updated — Route mounting, API client, Sidebar, Router, Indexes

- `server/index.js` — mounts `/api/departments` and `/api/subjects`.
- `client/src/api/client.js` — exports `departments` and `subjects` API modules.
- `client/src/components/layout/Sidebar.jsx` — **Subjects** link (Library icon) added under Academic section.
- `client/src/App.jsx` — lazy route `/subjects → SubjectsPage`.
- `server/utils/indexes.js` — compound indexes for `departments` (`schoolId+code` unique, `schoolId+order`) and `subjects` (`schoolId+code` unique, `schoolId+departmentId+order`, `schoolId+sections`).

---

## [4.9.18] — 2026-05-20  Role-Contextual Help Guide

### New — `client/src/components/RoleGuide.jsx`

A collapsible **"What can I see?"** help panel that appears at the bottom of every portal page. It reads the current user's role from the auth store and displays role-specific guidance — teachers, parents, section heads, admins, timetablers, and students each get a distinct card explaining exactly what they can access and do.

- **Role detection** — inspects `role` + `roles[]` from JWT; priority order: parent/guardian → section_head → teacher → timetabler → deputy → admin → student.
- **Collapsed by default** — a thin strip ("What can I see? [Role badge]") with a chevron toggle; expands with a smooth animation.
- **Per-role content**:
  - *Teacher* — weekly schedule, period times, class assignments, print instructions.
  - *Parent/Guardian* — child-switcher tabs, each child's subjects/teacher/room, per-child PDF print, linking help.
  - *Section Head* — section-wide overview, class filter, teacher/room visibility, print options.
  - *Admin/Deputy/Timetabler* — full build/edit access, bell schedule config, conflict detection, publish/unpublish workflow.
  - *Student* — guidance that parent/guardian holds their view; how to request a printed copy.
- **Print-hidden** — the guide is excluded from timetable print output via `print:hidden`.
- **Footer nudge** — "Seeing something unexpected? Contact your school administrator to review your account role."
- Reusable across all portal pages; add `<RoleGuide />` to any page.

### Updated — `client/src/pages/timetable/TimetablePortal.jsx`

`<RoleGuide />` added at the bottom of every portal view (teacher, parent, section head).

---

## [4.9.17] — 2026-05-20  Timetable Publishing Portal — Per-Role Views, Print Support

### Feature — Publish/Unpublish Workflow

Admins and timetablers now control timetable visibility with a **Draft → Published** workflow. Until published, portal users (teachers, parents, section heads) see a "not yet published" message.

- **`POST /api/timetable/publish`** — marks the school's timetable as published; accepts optional `termLabel` (e.g. "Term 1, 2026") shown on the portal and print headers.
- **`POST /api/timetable/unpublish`** — reverts to draft.
- **`GET /api/timetable/status`** — returns `{ published, publishedAt, publishedBy, termLabel }`.
- Publish state stored on the `schools` document under `timetableStatus` — no new collection required.
- Admin/timetabler/deputy bypass the published gate; all other roles only see data when published.

### Feature — Per-Role Timetable Portal

**`GET /api/timetable/my`** (teacher / section head):
- Teacher → resolves teacher record by email match, returns their assigned slots.
- Section head → reads `sectionAssigned` from user document; returns all slots in that section (or all sections if not set).

**`GET /api/timetable/my-children`** (parent / guardian):
- Reads `guardianOf: [studentId...]` from JWT; fetches each linked student and their class timetable.
- Returns `{ children: [{ student, slots }], termLabel }`.

### New — `client/src/pages/timetable/TimetablePortal.jsx`

Role-dispatched read-only portal:
- **Teacher view** — weekly grid of their lessons; per-day lesson count chips; linked teacher name header.
- **Parent view** — child-switcher tabs (one per `guardianOf` child); each child's class timetable with class name shown. Seamlessly switch between children from the same account.
- **Section head view** — class filter tabs + summary stats (classes, lessons, teachers, rooms); full grid of all slots in their section.
- All views: deterministic subject colour palette, `startTime`/`endTime` shown on each period row.
- **Print button** — calls `window.print()`. Print-safe layout: nav/sidebar hidden, grid rendered cleanly in A4 landscape.
- "Not yet published" lock screen shown when timetable is still draft.

### Updated — `client/src/pages/timetable/TimetablePage.jsx`

- **Role gate at top** — non-admin roles (`teacher`, `parent`, `guardian`, `section_head`, `student`) are immediately redirected to `<TimetablePortal />`.
- **Publish banner** — amber strip (Draft) or green strip (Published) below the page header; "Publish Timetable" opens a modal to enter a term label; "Unpublish" button with confirm dialog.
- `timetabler` role added to `canEdit` set.

### Updated — `server/routes/settings.js` — User Management

- `PUT /api/settings/users/:id` now accepts:
  - `sectionAssigned` — which section (`kg|primary|secondary|alevel|all`) a section head oversees.
  - `guardianOf` — array of student IDs for parent/guardian accounts.
  - `timetabler` and `section_head` added to the allowed roles list.

### Updated — `client/src/api/client.js`

Added to `timetable`: `status()`, `publish(data)`, `unpublish()`, `my()`, `myChildren()`.

### Updated — `client/src/index.css`

Print stylesheet (`@media print`): hides shell chrome (nav, sidebar, buttons with `print:hidden`), sets A4 landscape page, enables colour printing for timetable cells.

---

## [4.9.16] — 2026-05-20  Per-Section Bell Schedules + Cross-Section Conflict Detection

### Architecture — Multi-Section Bell Schedule Support

Schools running KG through A-Level on the same system now maintain **independent bell schedules per section** while remaining fully connected for teacher assignments and conflict detection.

**Problem solved:** Period key "1" in KG (07:30–08:00) and Period "1" in Secondary (08:00–09:20) are entirely different time windows. A teacher assigned to both would not be caught by naive `day + period` key matching. Msingi now stores and compares actual clock times, so a double-booking across sections is caught regardless of period numbering.

### New — `server/routes/bell-schedule.js` (rewritten)

- **Per-section documents:** one `bell_schedules` record per `(schoolId, section)` where section ∈ `all | kg | primary | secondary | alevel`.
- **Fallback chain:** section-specific → school `all` default → hardcoded `DEFAULT_BELL` constant. Never breaks a school that hasn't configured anything.
- **New endpoint `GET /api/bell-schedule/sections`** — returns all VALID_SECTIONS with `configured` flag, `periodCount`, and `lessonCount` for the admin overview tab badges.
- **`DELETE /api/bell-schedule?section=`** — reverts a section-specific schedule back to the school default (cannot delete `all`).
- **Named exports:** `router.resolveBellSchedule` and `router.DEFAULT_BELL` — used by `server/routes/timetable.js` to resolve times during slot creation.

### Updated — `server/routes/timetable.js`

**Time denormalisation at write time:**
- New helper `_inferSection(className)` — infers `kg | primary | secondary | alevel | all` from class name (regex patterns mirror frontend `inferSection()`).
- New helper `_resolveSlotTimes(schoolId, section, periodKey)` — fetches the correct bell schedule for the class's section and returns `{ startTime, endTime }` in HH:MM.
- On `POST /timetable` and `PUT /timetable/:id`: `section` and `startTime`/`endTime` are resolved and stored on every slot. Explicit caller-supplied times are honoured (future API flexibility).

**Time-overlap conflict detection:**
- New helper `_timesOverlap(start1, end1, start2, end2)` — HH:MM string comparison (no Date parsing needed). Returns true when two intervals overlap by any amount.
- `_checkConflicts` upgraded: teacher double-booking and room double-booking now use time-overlap when both slots have `startTime`, falling back to period-key equality for legacy slots without times.
- `GET /timetable/conflicts` upgraded to pairwise time-overlap within `teacherId|day` and `room|day` groups — catches cross-section double-bookings.

### Updated — `server/utils/indexes.js`

- `bell_schedules`: changed `bs_school_default` index to `bs_school_section` with `unique: true` — one schedule per `(schoolId, section)`.
- `timetable`: replaced period-based teacher/room indexes (`tt_teacher_day_period`, `tt_room_day_period`) with time-based ones (`tt_teacher_day_time`, `tt_room_day_time`). Added `tt_school_section` sparse index for section-filtered queries.

### Updated — `client/src/api/client.js`

- `bellSchedule` extended: `sections()` → `GET /bell-schedule/sections`; `remove(section)` → `DELETE /bell-schedule?section=`.

### Updated — `client/src/pages/timetable/TimetablePage.jsx`

**Section-aware bell fetch:**
- Bell schedule query is now keyed by the selected class's inferred section (`classSection`), not a static `'all'` key. When the class changes, the grid automatically re-renders with the correct period rows and times.
- `lessonPeriods` derived from the active bell and passed into `AddSlotSlideOver` — period dropdown reflects real section times.

**`BellScheduleSlideOver` — full rewrite:**
- Five section tabs: School Default | KG | Primary | Secondary | A-Level.
- Active tab fetches its own schedule (`GET /api/bell-schedule?section=`); amber banner shown when a section inherits from school default.
- Green dot badge on tabs that have a custom schedule configured (`GET /api/bell-schedule/sections`).
- `dirty` flag: Save button only enabled after the user edits something.
- "Revert to default" button: appears only when the active section has a custom schedule; calls `DELETE` to remove it.
- No longer receives `periods` or `onSaved` props — component is self-contained.

---

## [4.9.15] — 2026-05-20  Settings API + Bell Schedule Configuration + Platform Audit Fixes

### New — `server/routes/settings.js`

**School Settings (`GET/PUT /api/settings/school`):**
- Returns and updates school profile: name, tagline, email, phone, address, website, country, currency, timezone, academicYear, termsPerYear, houses, logoUrl, primaryColor.
- RBAC: admin or superadmin role required for PUT.
- Allowlist of updatable fields prevents accidental overwrite of system fields (plan, slug, isActive, etc.).

**User Management (`GET/POST/PUT/DELETE /api/settings/users`):**
- `GET /api/settings/users` — lists all active users for the school (admin-only; strips passwordHash).
- `POST /api/settings/users/invite` — creates user with temp password, sends welcome email (non-fatal if email fails). Returns `{ user, tempPassword }` shown once to admin.
- `PUT /api/settings/users/:id` — updates name or role; superadmin guard on admin role assignment.
- `DELETE /api/settings/users/:id` — soft-delete (sets `isActive: false`); blocks self-deletion.

**Account Settings (`GET/PUT /api/settings`):**
- `GET /api/settings` — returns current user's profile (no passwordHash).
- `PUT /api/settings` — handles two distinct operations: name update or password change (requires currentPassword verification via bcrypt).

### New — `server/routes/bell-schedule.js`

- `GET /api/bell-schedule` — returns school's bell schedule; seeds the default 8-period schedule (07:30–17:00) on first access.
- `PUT /api/bell-schedule` — saves custom bell schedule; validated with Zod (period key, HH:MM times, label, isBreak).
- Plan gate: `bell_schedule` → `standard` plan or higher.
- Admin check on PUT.
- Default schedule: P1–P3, Short Break, P4–P5, Lunch, P6–P8 (10 rows, 8 lessons + 2 breaks).

### Updated — `server/index.js`
- Mounted `/api/settings` and `/api/bell-schedule` routes.

### Updated — `client/src/api/client.js`
- Added `bellSchedule` export: `get()` and `update(data)`.

### Updated — `client/src/pages/timetable/TimetablePage.jsx`
- **Bell schedule now served from DB** — `DEFAULT_BELL` constant is the fallback; on mount the page fetches `/api/bell-schedule` and uses the saved schedule instead.
- `TimetableGrid` accepts a `bell` prop (defaults to `DEFAULT_BELL`) — the live schedule is passed through.
- `AddSlotSlideOver` accepts `lessonPeriods` prop — period dropdown reflects the actual configured schedule.
- **Bell Schedule slide-over** — admins can open it via the new "Bell" button in the header; inline editor to set start time, end time, label for each row; add lesson or break rows; remove rows; save back to DB.

### Fixed — Platform Audit items (applied in v4.9.14, documented here)
- `package.json` version bumped from `4.2.0` to `4.9.14`.
- `server/middleware/auth.js` — standardised to `{ success: false, error: { code, message } }` envelope (was inconsistent bare `{ error: '...' }`).
- `server/utils/indexes.js` — fixed timetable indexes from nonexistent `dayOfWeek` field to correct `day` field; added bell_schedules indexes.
- `server/middleware/plan.js` — registered `bell_schedule`, `rooms`, `assessment` features; fail-closed gate for unknown feature keys (was fail-open, silent privilege escalation risk).
- `server/index.js` — health check version now reads from `package.json` (was hardcoded); SPA fallback replaced explicit 15-route allowlist with universal wildcard.

---

## [4.9.14] — 2026-05-20  Institutional Scheduling Engine — Timetable Phase 1

### Rebuilt — `server/routes/timetable.js`

**Global Conflict Detection Engine (institution-wide, not per-class):**
- **Teacher double-booking prevention** — POST and PUT now reject any slot where the assigned `teacherId` is already scheduled in another class at the same `day + period`. Cross-class enforcement, not just same-class.
- **Room double-booking prevention** — POST and PUT reject any slot where `room` is already occupied (case-insensitive match) at the same `day + period`.
- **Class collision check** preserved — same class + day + period still blocked as before.
- Conflict check extracted into `_checkConflicts(schoolId, data, excludeId)` helper — `excludeId` ensures PUT doesn't block updating a slot against itself.

**New endpoint — `GET /api/timetable/workload`:**
- Returns teacher workload summary: `teacherId`, `teacherName`, `total` lessons/week, `byDay` breakdown, `classCount`.
- Filtered by `academicYearId` / `termId` when provided. Capped at 10,000 slot scan. Sorted by total descending.

**New endpoint — `GET /api/timetable/conflicts`:**
- Scans all active slots institution-wide for teacher double-bookings and room double-bookings.
- Returns `{ conflicts: [...], count }` — each conflict includes type, affected resource, day, period, and slotIds.

**New endpoint — `GET /api/timetable/overview`:**
- Returns per-class lesson counts grouped by day for the master grid.
- Returns `{ classes: [{ classId, total, byDay }], totalSlots }`.

**Bug fixes:**
- `GET /class/:classId` and `GET /teacher/:teacherId` now return a plain slots array (was returning `{ slots, byDay }` object — caused frontend `forEach` TypeError).
- Route ordering fixed: `/workload`, `/conflicts`, `/overview` placed before `/:id` wildcard to prevent mis-routing.
- Added `teacherName` to `SlotSchema` (denormalised display string stored alongside `teacherId`).
- `subject` field added to schema as optional string (previously only `subjectId` existed).

### Rebuilt — `client/src/pages/timetable/TimetablePage.jsx`

**Three views replacing the single class grid:**
- **Class Grid** (default) — true period-row × day-column layout with a 88px time label column, period times (`P1 07:30–08:30`), break rows, and 5 day columns.
- **Teacher Schedule** — same grid filtered to a selected teacher's assignments; shows weekly lesson count + per-day distribution in the toolbar.
- **Institution Overview** — compact table: all classes as rows, Mon–Fri + Total as columns; shows lesson count per day per class.

**True timetable grid (Class Grid + Teacher View):**
- Period times hardcoded from default bell schedule (P1–P8 + Short Break + Lunch).
- Each cell shows subject, teacher name, and room; hover reveals Trash2 delete (admin/deputy only).
- Empty cells show a dashed Add button on hover (RBAC-gated) — pre-fills the slide-over with that day + period.

**Teacher Workload Panel:**
- Collapsible right sidebar (framer-motion slide-in) triggered by `Workload` button in header.
- Bar chart per teacher: green (normal 11–29), amber (light ≤10), red (heavy ≥30).
- Legend at panel footer; skeleton loaders while fetching.

**Global Conflicts Badge:**
- Always-on badge in header: green "No conflicts" or red "N conflicts".
- Clicking the red badge opens a conflicts panel listing each issue (type, teacher/room, day, period).
- Resolves automatically as slots are fixed.

**Add Slot Slide-over (upgraded):**
- Teacher field is now a **dropdown** populated from the real teachers list (sends `teacherId` + `teacherName` to API — enables conflict detection).
- Day/period pre-filled when clicking an empty cell.
- Server-side conflict errors (409) surfaced inline with `AlertTriangle`.
- Slot type selector (lesson / assembly / registration / free period).

**Section filtering:**
- Section pills in toolbar (All Sections / Kindergarten / Primary / Secondary / A-Level / Other).
- Class names inferred into sections via `inferSection()` regex — no DB change needed.
- Selecting a section filters the class picker; switching section resets class selection.

**Bug fixes:**
- Frontend now sends lowercase day values (`'monday'`) matching the backend `z.enum` — Add Slot was broken in v4.9.13.
- Slot data accessed as `data?.data` array (fixed the object/array mismatch from `byClass` response change above).
- `teachers as teachersApi` import added for dropdown.

### Updated — `client/src/api/client.js`
- Added `byTeacher(id, params)`, `workload(params)`, `conflicts(params)`, `overview(params)` to the `timetable` export.

---

## [4.9.13] — 2026-05-19  Premium UI Overhaul: Settings + Timetable

### Rebuilt — `client/src/pages/settings/SettingsPage.jsx`
- **Tabs** — replaced plain text with lucide icons (Building2 / Users / User); RBAC hides Users tab for non-admin roles
- **Removed old dependencies** — PageSpinner, Spinner, ErrorState, clsx, card/btn-primary/form-input/form-label/data-table classes
- **School tab additions** — currency dropdown (10 currencies), timezone selector (10 zones), academic year label, terms per year, tagline field, country field; all saved to `PUT /settings/school`
- **Houses section** — built into School tab: add houses with name + colour picker (8 swatches + `<input type="color">`), remove with X; saves to `school.houses` array (same key used by Behaviour leaderboard and Student Profile dropdown — completes the full houses data flow)
- **Users tab** — role pills per user (colour-coded by role), invite slide-over (name/email/role, `POST /settings/users/invite`), RBAC-gated Trash2 remove with hover-reveal, skeleton loaders
- **Account tab** — `alert()` removed → inline password mismatch/length error; show/hide password toggle (Eye/EyeOff); save button disabled when name is unchanged; toast on all mutation outcomes

### Rebuilt — `client/src/pages/timetable/TimetablePage.jsx`
- **Removed old dependencies** — PageSpinner, EmptyState, ErrorState, emoji `🗓`, card/form-select/bg-brand-* classes
- **Premium 5-day grid** — deterministic subject colour coding (8 colour pairs), period number + room in each slot card, teacher name truncated
- **Add Slot slide-over** — day/period/subject/teacher/room fields, `POST /timetable` on submit; RBAC-gated (admin/deputy/can('timetable'))
- **Inline remove** — Trash2 button hover-reveals on each slot (admin/deputy only); `DELETE /timetable/:id`
- **Quick-add button** — dashed "Add" row at the bottom of each day column
- **Page header** — shows lesson count + active days when class is selected
- **framer-motion** slot entry animations, toast feedback on add/remove errors

---

## [4.9.12] — 2026-05-19  Premium UI Overhaul: Grades & Assessment

### Rebuilt — `client/src/pages/grades/GradesPage.jsx`
- **Replaced emoji tabs** with lucide-react icons (PenLine / FileText / Settings2 / Bell)
- **Removed all old dependencies** — PageSpinner, Spinner, EmptyState, ErrorState, Badge, clsx all eliminated; inline Tailwind patterns throughout
- **React Query v5 compatibility fixes**:
  - `onSuccess` callback in `useQuery` (deprecated v5) → `useEffect` with data dependency
  - `isLoading` on `useMutation` → `isPending`
  - `qc.invalidateQueries(['key'])` array form → `{ queryKey: ['key'] }` object form
- **Mark Entry tab** — live class stats bar (avg / pass rate / highest / lowest), animated toast replaces `alert()`; marks only submitted for students with entered scores
- **Report Cards tab** — student names resolved from `studentsList` (no longer shows raw MongoDB IDs); weight legend as inline TypePill chips; half-term toggle preserved
- **Configuration tab** — lucide icons in template selector cards; schedule rows use Trash2 icon; animated toast on save/error
- **Reminders tab** — lucide status icons per reminder type (AlertTriangle / CheckCircle2 / Calendar), overdue/open/upcoming summary counts in header
- **All tabs** — framer-motion AnimatePresence tab transitions, skeleton loaders instead of spinners
- **Tab visibility guard** — `useEffect` resets active tab when user's role loses access to it

---

## [4.9.11] — 2026-05-19  Premium UI Overhaul: Behaviour BPS + Student Profile

### Added — Behaviour Point System (`client/src/pages/behaviour/BehaviourPage.jsx`, `bpsConstants.js`)
- **BPS matrix** — 8 categories, 80+ behaviour items with locked point values; staff cannot override points
- **4-step award wizard** — Student search → Merit/Demerit toggle → Category + item select → Confirm
- **Serious infraction enforcement** — mandatory note (min 10 chars) when |pts| ≥ 5
- **Stage preview** — shows intervention stage trigger before submission
- **Milestone preview** — shows merit milestone unlock before submission
- **Intervention stages** — 5 thresholds (5/10/20/35/50 demerit pts, 90-day rolling window): Monitor → Caution → Intervention → Formal Support → Senior Review
- **Merit milestones** — Bronze(25) → Silver(50) → Gold(100) → Principal's Award(200) → Platinum(300), all-time cumulative
- **Appeals tab** — list pending appeals, resolve with outcome and note; admin-only
- **Houses tab** — settings-based house configuration (name + color picker), house leaderboard computed from student incident data (merits, demerits, net, member count), medal ranking

### Added — `bpsConstants.js`
- `MATRIX`, `STAGES`, `MILESTONES` constants (locked, school-agnostic)
- Helpers: `meritTotal`, `demeritTotal`, `studentStage`, `studentMilestone`, `isSerious`
- Exported for reuse in StudentProfile and future report cards

### Rebuilt — Student Profile (`client/src/pages/students/StudentProfile.jsx`)
- **Replaced emoji tabs** with lucide-react icons (User/CalendarCheck/Receipt/Scale/GraduationCap)
- **Removed old dependencies** — PageSpinner, ErrorState, Badge, clsx all removed; inline patterns
- **Attendance tab** — rate progress bar with colour coding, per-status count cards, threshold warning (<75% pastoral flag)
- **Finance tab** — outstanding/total-billed/total-paid summary strip; currency from `session.school.currency` (not hardcoded)
- **Behaviour tab** — full BPS integration: demerit stage card, merit milestone card, progress bars to next stage/milestone, full incident log with type icons
- **Grades tab** — overall average card with progress bar, subject table with % colours
- **Overview edit mode** — house dropdown populated from school settings houses array (completes houses end-to-end: configure in Behaviour → assign in Student Profile → leaderboard in Behaviour Houses tab)
- No `alert()`, no hardcoded currency, RBAC-gated Edit button, framer-motion tab transitions

---

## [4.9.10] — 2026-05-19  Stability Hardening: Login Plan Bug, Query Limits, Session Fix

### Fixed — Critical: Plan badge always showing "core" in UI (`client/src/pages/Login.jsx`, `store/auth.js`, `components/layout/TopBar.jsx`)
- Root cause: all four login paths (`handleLogin`, `handleQuickLogin`, `handleOtp`, `handleChangePassword`) called `setSession({ token, user })` without including `school: res.school`. The `auth.js` store getter read `session?.user?.plan` — plan is on the school doc, not the user doc, so it always returned `undefined` and fell back to `'core'`
- Fix: all four `setSession` calls now pass `school: res.school`
- Fix: `auth.js` plan getter now reads `session?.school?.plan ?? session?.user?.plan ?? 'core'` (school first)
- Fix: `TopBar.jsx` plan display updated with same dual-source pattern

### Fixed — UI: Login page left panel too wide
- Changed from `lg:w-1/2 xl:w-3/5` (up to 60% at xl) to `lg:w-5/12` (41.7% fixed)
- Also reduced padding from `p-12` to `p-10` to give the form panel more breathing room

### Fixed — Stability: Unbounded database queries (memory safety)
- **`server/routes/platform.js`** — `School.find({})` for dashboard list now uses field projection (only loads slug, name, plan, status, etc. — not logoUrl, email templates, branding blobs). `School.find({})` for stats now projects only `plan, isActive`. Announcements list capped at 200.
- **`server/routes/assessment.js`** — All `assessment_marks.find()` queries capped (5,000 for marks list, 10,000 for report generation). `assessment_schedule.find()` capped at 200. `users.find({ role: 'teacher' })` capped at 200.
- **`server/routes/behaviour.js`** — `behaviour_categories.find()` capped at 200.
- **`server/routes/timetable.js`** — Class timetable and teacher timetable views capped at 200 slots (5 days × 10 periods = 50 slots max in practice).
- **Context**: `parsePagination()` in `server/utils/response.js` already enforced `Math.min(200, ...)` on all main list endpoints (students, teachers, finance, attendance, etc.). These fixes close the remaining unbounded paths in lookup and aggregation routes.

### Fixed — Visibility: Unhandled Promise rejections in startup (v4.9.9 carry-forward)
- `repairPermissions()` and `seedDemo()` in `server/index.js` now have `.catch(err => console.error(...))` — previously silent failures were invisible in Render logs

---

## [4.9.9] — 2026-05-19  Demo School Enterprise Plan + Realistic Seed Data

### Changed — Demo School Always Forced to Enterprise Plan (`server/scripts/seed-demo.js`)
- Demo school plan field set via `$set` (not `$setOnInsert`) — guarantees `plan: 'enterprise'` is applied on every server restart, even if the school document pre-existed with a lower plan
- `invalidatePlanCache(schoolId)` called immediately after upsert to clear the 5-minute TTL in-memory cache, so the enterprise plan takes effect the moment the server starts
- Wrapped in `try/catch` — `plan` middleware may not be loaded yet on very first boot; harmless

### Added — Student Role in Demo User Set (`server/scripts/seed-demo.js`)
- Added `u_demo_student` user (`student@demo.msingi.io` / `Demo2025!`, role: `student`)
- Student permissions seeded in `role_permissions`: read-only access to students, classes, attendance, finance, behaviour, exams, grades, timetable, assessment, report_cards; messaging with read+create+update

### Added — Comprehensive Realistic Demo Seed Data (`server/scripts/seed-demo-data.js`)
- New script called by `seed-demo.js` after core provisioning
- **Isolation guarantee**: all records hardcoded to `schoolId: 'sch_demo'` — no other school is ever touched
- **Idempotent pattern**: every record uses `$setOnInsert` — safe to run on every server restart, never overwrites manually edited demo data
- Data seeded:
  - **7 classes**: Grade 1–4 (Primary), Form 1–3 (Secondary)
  - **14 subjects**: Mathematics, English, Science, Kiswahili, Social Studies, CRE, Art, PE (Primary); additional secondary subjects
  - **9 additional teachers** with realistic Kenyan names, profiles, and subject assignments
  - **20 students** with full profiles: names, DOB, gender, guardian contacts, class assignments, enrolment dates, medical notes
  - **25 behaviour incidents**: mix of minor/moderate/serious with statuses (open, resolved, closed), school-appropriate descriptions
  - **60 timetable slots**: complete weekly grid across all 7 classes, Mon–Fri, periods 1–8
  - **20 invoices + 14 payments**: tuition/activity/transport fees, mix of paid/partial/pending/overdue
  - **8 admissions records**: spread across enquiry → applied → shortlisted → offered → enrolled stages

### Changed — `server/index.js`
- Version bumped to `4.9.9`
- `seedDemo()` fires non-blocking after HTTP server starts listening (fire-and-forget)

### Added — Developer Tooling: Pre-Implementation Documentation Skill
- `.claude/commands/check-docs.md` — Claude Code slash command (`/check-docs`) that mandates a 6-step protocol before any implementation: read CHANGELOG, read DEVELOPER_GUIDE, read relevant user docs, declare what exists vs. what's missing, implement with zero regression, update all docs after changes
- Includes collection name reference table for all 20+ known collections

---

## [4.9.8] — 2026-05-19  Plans Comparison Page + Contact Pre-Fill

### Added — Plans Comparison Page (`client/src/pages/Plans.jsx`)
- New public-facing `/plans` route — no authentication required
- Fixed navbar (same pattern as Landing/Contact) with Plans link highlighted
- **4 plan cards**: Core, Standard, Premium (highlighted as "Most popular"), Enterprise
- **Full feature comparison table** with 5 feature groups sourced directly from `server/middleware/plan.js` FEATURE_PLAN map:
  - Core Features (attendance, students, classes, timetable, messages)
  - Academic (exams, grades/assessment, report cards)
  - Admissions & HR (admissions pipeline, teacher management)
  - Finance (invoicing, payments, reports)
  - Enterprise (analytics, API access, custom branding, priority support)
- `Cell` component renders check (✓) or dash (–) per plan
- CTA buttons at bottom of each plan column: `navigate('/contact?plan=<planKey>')`
- "Not sure?" bottom section with contact link

### Changed — Contact Page (`client/src/pages/Contact.jsx`)
- `useSearchParams` reads `?plan=` query parameter from URL
- `PLAN_INQUIRY_MAP` maps `core/standard/premium/enterprise` → inquiry type string
- Form pre-fills `inquiry` dropdown and `message` field when plan is specified in URL
- Enables one-click plan selection from the Plans page directly into the contact form

### Changed — `client/src/App.jsx`
- Added `import Plans from '@/pages/Plans.jsx'`
- Added route `{ path: '/plans', element: <Plans /> }`

### Changed — Landing.jsx + Contact.jsx navbars
- Added `Plans` link in fixed navbar on both Landing and Contact pages

---

## [4.9.7] — 2026-05-19  Demo School URL + Quick Login Panel

### Changed — "Explore the Platform" CTA targets `demo.msingi.io` (`client/src/pages/Landing.jsx`)
- Hero CTA and final section CTA both now call `goToSchool('demo')` — previously pointed to `innolearn` slug
- Demo school is the canonical hands-on trial environment for all visitors

### Added — Quick Login Panel on Demo Login Page (`client/src/pages/Login.jsx`)
- `DEMO_ACCOUNTS` array defines all 6 roles with email, display color, background color, and badge text
- `DemoPanel` component renders colored role cards — one per role (Admin, Deputy Principal, Teacher, Finance Officer, Parent, Student)
- Click any card calls `handleQuickLogin(email, password)` which auto-fills credentials and submits the login form
- Panel only renders when `slug === 'demo'`
- Left panel of login page shows role list for demo slug instead of generic tagline
- All demo credentials: `Demo2025!` password, `isActive: true`, `mustChangePassword: false`

---

## [4.9.6] — 2026-05-19  Public Page UI Polish (Fixed Navbar, WhatsApp FAB, Hash Fix)

### Fixed — Navbar scrolls away on Landing and Contact pages
- Root cause: `overflow-x-hidden` on parent element breaks `position: sticky` in Chrome/Safari
- Fix: both navbars changed from `sticky top-0` to `fixed top-0 left-0 right-0 w-full z-50`
- `<div className="h-16" />` spacer added immediately after each navbar to compensate for the fixed position removing the element from document flow

### Fixed — WhatsApp FAB shape and persistence
- Previously: expanding pill on hover (`rounded-full` with hover-expand text label)
- Now: permanent `w-12 h-12 rounded-full bg-[#25D366]` circle with phone icon — never changes shape
- FAB is fixed at `bottom-6 right-6` on every public page scroll position — never disappears

### Fixed — `#modules` hash appearing in URL bar when clicking Modules nav link
- Root cause: `<a href="#modules">` adds the hash to the URL on click
- Fix: replaced with `<button onClick={() => document.getElementById('modules')?.scrollIntoView({ behavior: 'smooth' })}>`  — smooth scrolls without touching URL

### Changed — Contact page (`client/src/pages/Contact.jsx`)
- Removed "Direct Contact" card section (Email us / WhatsApp us cards)
- Removed "Or chat on WhatsApp" inline link from form submission row
- Added scroll-to-top button (appears after scrolling 200px) alongside WhatsApp FAB
- Both FABs rendered in a `fixed bottom-6 right-6 flex flex-col gap-3` container

---

## [4.9.5] — 2026-05-19  Social Icons + Landing Navbar Cleanup

### Added — Social Icons in Public Page Footers
- Inline SVG components added to `Landing.jsx` and `Contact.jsx`: `XIcon`, `LinkedInIcon`, `FacebookIcon`, `InstagramIcon`, `YouTubeIcon`
- `SocialLinks` component renders only links the platform admin has configured (filters empty/null URLs)
- `getPlatformSettings()` API call in `useEffect` populates `socialLinks` state on both pages
- `<SocialLinks links={socialLinks} />` rendered in footer of both Landing and Contact pages

### Removed — "Sign In" button from Landing page navbar
- Button removed from `Landing.jsx` navbar entirely — schools sign in via their dedicated `{slug}.msingi.io` URL
- Prevents confusion between marketing site navigation and school portal authentication

---

## [4.9.1] — 2026-05-19  Critical Security & Integrity Fixes (Platform Audit)

### Fixed — Critical: RBAC Permission Format Mismatch (`server/routes/onboard.js`)
- `_defaultPerms()` was seeding the legacy object format `{ view: true, edit: true }` but `middleware/rbac.js` expects the array format `{ students: ['read', 'create', 'update'] }`. This caused **100% of non-admin role users on every onboarded school to get 403 on every route**.
- All role permission maps rewritten to array format matching the RBAC middleware contract
- `superadmin` permissions now use `ALL_MODULES` array instead of `{ _all: { view: true } }`
- Added `scripts/repair-permissions.js` — run once to fix all existing schools: `node scripts/repair-permissions.js`

### Fixed — Critical: PDF Endpoint `ReferenceError: userId is not defined` (`server/routes/report-cards.js`)
- `GET /:id/pdf` destructured `{ schoolId, role, guardianOf }` from `req.jwtUser` but used `userId` in the guardian audit log write — `ReferenceError` on every PDF request from a parent/guardian
- Added `userId` to destructured fields

### Fixed — Critical: `sync.js` Security Hardening
- `GET /api/sync` restricted to `superadmin`/`admin` roles only (previously open to any authenticated role — teachers, students, parents could download the full school DB including password hashes)
- Sensitive fields (`password`, `mfaOtp`, `mfaExpiry`, `tempPassword`) stripped from all sync output
- `users` and `audit_log` collections excluded from export
- `POST /api/sync` disabled (returns `HTTP 410 Gone`) — the write path accepted arbitrary unvalidated data to any collection including `users`, enabling role escalation
- Now redirects to `/api/import-export` for structured validated imports

### Added — High: 9 Missing Database Indexes (`server/utils/indexes.js`)
- `users(schoolId, email)` — **critical**: login hot path queried on every authentication
- `teachers(schoolId, status)`
- `messages(schoolId, recipientId, createdAt)`, `messages(schoolId, senderId, createdAt)`
- `behaviour_incidents(schoolId, studentId, date)`
- `admissions(schoolId, stage, createdAt)`
- `timetable(schoolId, classId, dayOfWeek, period)`
- `invoices(schoolId, studentId, status)`, `invoices(schoolId, status, dueDate)`
- `payments(schoolId, invoiceId)`

### Fixed — Medium: Behaviour Appeal Outcome Logic (`server/routes/behaviour.js`)
- Both `'overturned'` and `'upheld'` outcomes mapped to `'resolved'` (dead ternary — both branches returned the same value)
- Now correctly: `'overturned'` → incident status `'overturned'`; `'upheld'` → `'closed'`
- Also writes `appealOutcome` field to incident for full audit trail

---

## [4.9.0] — 2026-05-19  Plan Gating Fix + Bulk Import/Export

### Fixed — Plan Gating (`server/middleware/plan.js`)
- **`admissions` moved from `premium` → `core`**: Every school on any plan can now use the full Admissions pipeline (enquiry → interview → offer → enrolled). Previously core/standard schools were locked out, preventing basic student intake.
- Comment header updated: InnoLearn → Msingi

### Added — Bulk Import & Export (`server/routes/import-export.js`)
- New route mounted at `/api/import-export` (no new npm packages — zero-dependency CSV parser)
- `GET /api/import-export/template/:type` — Download a demo CSV template with example rows and column instructions (opens directly in Excel/Google Sheets)
- `POST /api/import-export/:type` — Import from CSV (`Content-Type: text/csv`) or JSON (`{ rows: [...] }`). Row-level validation with per-row error reporting. Class names resolved to IDs automatically. Max 500 rows per batch.
- `GET /api/import-export/export/:type` — Export all school records as a timestamped downloadable CSV

**Supported types:**
- `students` — firstName, lastName, dateOfBirth, gender, className (resolved), parentName/Email/Phone, address, enrollmentDate, status, medicalNotes
- `teachers` — firstName, lastName, email, phone, dateOfBirth, gender, title, qualifications, joinDate, contractType, status
- `classes` — export only (name, section, keyStage, capacity, status)

**Import features:**
- Admission/staff numbers auto-generated (not required in CSV)
- Comment rows starting with `#` skipped
- Class name → classId resolution with clear error if class not found
- Duplicate email detection for teachers (within-batch and against existing records)
- Partial success (HTTP 207) with row/field-level error table
- BOM prefix on all CSV output for Excel compatibility

### Added — Import/Export UI (`client/src/pages/import-export/ImportExportPage.jsx`)
- New `/import-export` route in App.jsx
- Sidebar: `🔄 Import & Export` link added under System section
- Per-entity card with: download template button, export button, drag-and-drop CSV upload zone, row preview, import button, results summary with error table
- Classes export-only card (class creation is done in-app, but list can be exported for reference in student CSV)
- `client/src/api/client.js` — `importExport` module added: `importCSV()`, `exportCSV()`, `downloadTemplate()`

### Fixed — `server/index.js`
- `/api/import-export` route registered

---

## [4.8.2] — 2026-05-18  Hotfix: DB name regression + onboard.html rebrand

---

## [4.7.0] — 2026-05-18  Platform Rebrand + Dedicated School URLs + Full Assessment System

### Platform Rebrand — InnoLearn → Msingi
- Platform renamed to **Msingi** with domain **msingi.io**
- Updated all frontend branding: logo initials `MS`, nav header, footer copyright
- `schoolDetect.js` MAIN_HOSTS updated to `msingi.io`, `www.msingi.io`, `app.msingi.io`
- Landing page URL example updated: `your-school.msingi.io`
- Demo school slug buttons updated to `.msingi.io`

### Dedicated School URLs — `{slug}.msingi.io`
- Each school gets its own branded subdomain (e.g. `greenwood.msingi.io`)
- **`client/src/utils/schoolDetect.js`** (new) — Priority chain: subdomain → `?school=` param → localStorage → main domain. Exports `detectSchool()`, `schoolPortalUrl()`, `storeSchoolSlug()`, `clearStoredSchoolSlug()`
- **`client/src/pages/Landing.jsx`** (new) — Marketing page shown on main domain: hero, "Find your school" search, features grid, demo role cards, URL example
- **`client/src/pages/Login.jsx`** — Complete rewrite: dynamically branded with school logo, colours and name fetched from public API. Three modes: LOGIN → OTP → CHANGE_PASSWORD
- **`server/routes/public.js`** (new) — No-auth `GET /api/public/school-info` returns school branding for login page; `GET /api/public/ping` health check
- **`server/middleware/tenant.js`** — `_findSchool()` now returns `name`, `shortName`, `logoUrl`, `primaryColor`, `accentColor`, `systemEmail`
- `server/index.js` — Mounts `/api/public` before auth middleware
- Approval welcome email now includes the school's dedicated URL with bookmark callout
- Cloudflare DNS: `A @→216.24.57.1`, `CNAME www→render`, `CNAME *→render` (all DNS only)
- Render custom domains: `msingi.io`, `www.msingi.io`, `*.msingi.io` for wildcard SSL

### Per-School System Email
- Platform SMTP: `innolearnnetwork@gmail.com` (fixed, single account)
- Each school configures `systemEmail` — used as `Reply-To` on all school-level emails
- School emails sent as `"SchoolName via Msingi" <innolearnnetwork@gmail.com>`
- Platform emails sent as `"Msingi Platform" <innolearnnetwork@gmail.com>`
- **`server/utils/email.js`** refactored: `_send()`, `_sendAsSchool()`, `_wrap(schoolName)` helpers
- All school-level functions now accept `schoolEmail` param: `sendLoginOTP`, `sendWelcomeCredentials`, `sendPasswordExpirySoon`, `sendPasswordChanged`, `sendRoleChanged`, `sendMessageNotification`
- New: `sendAssessmentReminder()` — email + in-app notification for upcoming/open/overdue assessments
- `PATCH /api/academic-config/school-profile` — admin can set `systemEmail`, `primaryColor`, `accentColor`, `logoUrl` etc.

### RBAC & Messages Bug Fixes
- **`server/routes/messages.js`** — Fixed `req.user` → `req.jwtUser` in 4 places (was crashing with 500)
- **`server/middleware/rbac.js`** — Fixed field name mismatch: `{ schoolId, role }` → `{ schoolId, roleKey: role }` (was returning 403 for all non-admin roles)
- **`scripts/seed-role-permissions.js`** (new) — One-off migration seeds default permissions for all 11 roles across all existing schools
- `server/routes/platform.js` — `_seedBaseData` expanded to seed all 11 roles with `upsert: true` for new schools

### Assessment & Grading System (CA / HW / MT / ET)
#### Backend
- **`server/utils/grade-calc.js`** (new) — Single source of truth for all assessment calculations:
  - `validateWeights(weights)` — enforces sum = 100%
  - `aggregateMarks(marks)` — averages multiple instances (CA1+CA2→avg)
  - `computeTermTotal(typeAvgs, weights)` — weighted total; normalises to present types
  - `computeHalfTermTotal(typeAvgs, weights)` — CA+HW+MT only, re-scaled to 100%
  - `computeTerm1Grade()`, `computeTerm2Grade()`, `computeTerm3Grade()` — term final grades with ET running average blending
  - `computeSummaryAverage()` — Template B equal-thirds annual average
  - `buildSubjectReport()` — full multi-term report for one student/subject
- **`server/routes/assessment.js`** (new) — Full REST API:
  - `GET/PATCH /api/assessment/config` — weights (validated ≠ 100% blocked), template, instances
  - `GET/PUT/DELETE /api/assessment/schedule` — date ranges per assessment per term
  - `GET /api/assessment/marks` — list marks with filters
  - `POST /api/assessment/marks` — enter/upsert single mark (teacher permission check for MT/ET)
  - `POST /api/assessment/marks/bulk` — class-wide bulk entry
  - `DELETE /api/assessment/marks/:id`
  - `GET /api/assessment/marks/summary` — class completion grid
  - `GET /api/assessment/report` — full computed report card (single student or whole class)
  - `GET /api/assessment/reminders` — upcoming/open/overdue assessments (14-day window)
  - `POST /api/assessment/reminders/notify` — trigger email + in-app notifications to all teachers

#### Assessment Logic
- Default weights: CA=20%, HW=10%, MT=30%, ET=40% (must total 100%)
- All marks entered out of 100 — system handles weighting entirely in background
- Multiple CA/HW instances averaged before weight applied (CA1+CA2÷2 → ×20%)
- **Half-term report**: CA+HW+MT re-scaled to 100% (CA→33.3%, HW→16.7%, MT→50%)
- **Term 1 Final** = weighted total (CA×20 + HW×10 + MT×30 + ET×40)
- **Term 2 Final** = (Term2Total + avg(ET1,ET2)) / 2
- **Term 3 Final** = (Term3Total + avg(ET1,ET2,ET3)) / 2
- Teachers restricted from entering MT/ET unless admin enables `teacherExamEntry` on config
- Two report templates: **A (Detailed)** per-term with ET reference columns; **B (Summary)** equal-weight term averages

#### Frontend
- **`client/src/pages/grades/GradesPage.jsx`** (new) — 4-tab interface:
  - **Mark Entry** — filter by class/subject/term/type/instance → student grid with score inputs → bulk save with live class stats (avg, pass rate, high/low)
  - **Report Cards** — Template A (detailed) or B (summary), half-term toggle, colour-coded scores
  - **Configuration** — weight inputs with live 100% validator, instance count, template selector, assessment schedule date ranges
  - **Reminders** — colour-coded overdue/open/upcoming cards; "Notify Teachers" button
- `client/src/api/client.js` — `assessment` module added (12 methods)
- `client/src/App.jsx` — `/grades` and `/grades/:tab` routes added
- `client/src/components/layout/Sidebar.jsx` — `📊 Grades & Assessment` nav item added
- `server/index.js` — `/platform-audit` added to SPA fallback

---

## [4.6.2] — 2026-05-17  Academic Reporting Engine — cross-cutting issue fixes

### Fixed — Shared utility: `server/utils/archival.js` (new)
- Extracted `_isYearArchived` into a shared utility, eliminating the DRY violation where identical code existed in both `grades.js` and `exams.js`
- `isYearArchived(schoolId, academicYearId)` — returns false on null/missing inputs without a DB call; queries with projection so only the `archivedAcademicYears` field is loaded
- `firstArchivedYear(schoolId, yearIds[])` — deduplicates and filters nulls before checking; short-circuits on first match; used by bulk endpoints

### Fixed — `server/routes/auth.js`: guardian link broken in JWT (critical)
- All parent and guardian users were receiving HTTP 403 on every report card access because `guardianOf` was never included in the JWT payload
- Introduced `_buildTokenPayload(user, schoolId)` — a single source of truth for JWT construction used by all three token issuance paths (password login, OTP verify, force-change)
- For `parent` and `guardian` roles, `guardianOf: user.guardianOf || []` is now included in the payload; absent for all other roles to keep tokens lean
- Non-array `guardianOf` values on the user document are safely coerced to `[]`
- `server/middleware/auth.js` comment updated to document the new field

### Fixed — `server/routes/academic-config.js`: `archivedAcademicYears` not visible to frontend
- `_mergeConfig()` now includes `archivedAcademicYears: []` in its output — `GET /api/academic-config` returns the full list of archived year IDs
- Frontend can now disable year-scoped UI controls (grade entry, exam results, new publish) for closed years without needing a separate API call
- `ConfigSchema` (Zod) explicitly excludes `archivedAcademicYears` from PUT body — the field is read-only via PUT; only `POST /archive-year` can write it

### Fixed — `server/routes/report-cards.js`: publish not blocked for archived years
- `POST /api/report-cards/publish` now checks `isYearArchived()` immediately after creating the batch anchor (Step 1b)
- If the year is archived, batch is marked `failed` with a descriptive reason and HTTP 400 is returned — no further work is done
- Closes the gap where `skipModerationCheck: true` could still publish new snapshots into a closed year

### Fixed — `server/routes/academic-config.js`: archive-year cascade atomicity
- The config write-blocking gate (`$addToSet: { archivedAcademicYears }`) is now sequenced **after** the three data cascade ops (exams, snapshots, grades) rather than running in parallel with them
- Guarantees the gate is never active without the underlying data being archived first
- Gate write failure is caught and surfaced separately — `writeBlockActive: false` + `writeBlockError` in both the response and the audit log entry, plus `console.error` — cascade data is preserved even if the gate fails
- Year label resolved from `academic_years` collection (best-effort, non-blocking) and embedded in the audit entry as `academicYearLabel` for human-readable audit trails

### Fixed — Audit trail gaps
- `WRITE_BLOCKED_ARCHIVED_YEAR` entries now written to `mark_audit_log` whenever a grade write (`POST /api/grades`, `POST /api/grades/bulk`) or exam result write (`POST /api/exams/:id/results`) is rejected due to an archived year — captures `route`, `attemptedBy`, `payload` summary, `timestamp`
- `GUARDIAN_ACCESS_DENIED` entries now written to `mark_audit_log` whenever a parent/guardian is denied access to `GET /api/report-cards/:id` or `GET /:id/pdf` — captures `requestedBy`, `requestedRole`, `targetStudentId`, `snapshotId`, `route` for GDPR/POPIA compliance

### Tests — `server/__tests__/` (30 new tests, 93 total)
- **`archival.test.js`** (18 tests) — covers `isYearArchived` and `firstArchivedYear`:
  - Early returns on null/empty schoolId or academicYearId (no DB call made)
  - Config doc absent, field missing, empty array, yearId not in list, yearId present
  - Case sensitivity, projection correctness
  - `firstArchivedYear`: empty array, all-null array, no match, first match found, deduplication, null filtering
- **`auth-token.test.js`** (12 tests) — covers `_buildTokenPayload` logic:
  - Parent/guardian with linked students, empty list, missing field, non-array field
  - Guardian role, `primaryRole` takes precedence over `role`
  - All non-guardian roles (`admin`, `superadmin`, `teacher`, `student`, `accountant`) — `guardianOf` absent
  - Core fields always present, `roles` array vs fallback

---

## [4.6.1] — 2026-05-17  Academic Reporting Engine — production hardening (Phase 3)

### Security & Data Integrity

#### Archival write-blocking (prevents data corruption after year-end close)
- `POST /api/academic-config/archive-year` now also writes `$addToSet: { archivedAcademicYears }` on the school's `academic_config` document. This creates a cheap, permanent server-side gate other routes can check without extra queries.
- **`POST /api/grades`** — rejects any grade entry whose `academicYearId` is in `archivedAcademicYears` with HTTP 400.
- **`POST /api/grades/bulk`** — checks all distinct `academicYearId` values in the payload; rejects if any is archived.
- **`POST /api/exams/:id/results`** — checks `exam.academicYearId` against `archivedAcademicYears` before accepting results; archived years are permanently read-only regardless of exam status.
- Both routes use a shared `_isYearArchived(schoolId, academicYearId)` helper that hits a single indexed document.

#### MongoDB session transactions on publish
- `POST /api/report-cards/publish` now wraps both bulkWrites (insert new snapshots + mark old snapshots superseded) inside `session.withTransaction()`.
- **Graceful fallback**: if MongoDB error code 20 (`IllegalOperation — transactions only available on replica set`) is thrown, the server logs a warning and falls back to non-transactional writes automatically. No configuration required — development on standalone MongoDB works unchanged; replica sets in production get full atomicity.

#### Guardian ownership enforcement on report card access
- `GET /api/report-cards/:id` and `GET /api/report-cards/:id/pdf` now verify that users with role `parent` or `guardian` are linked to the requested student via `req.jwtUser.guardianOf[]` (an array of studentIds stored on the user's JWT).
- Unauthorised access returns HTTP 403. This closes the cross-family data-leak vector where any authenticated parent could access any student's report card by guessing a snapshot ID.

### Reliability

#### Runtime type validation in `computeFinalScores`
- `server/utils/academic-calc.js → computeFinalScores()` now validates inputs at runtime before computation:
  - `assessmentWeights` must be a non-empty array with numeric `weight` values — throws `TypeError` with a descriptive message if not.
  - `gradingSchema` must be a non-empty array with numeric `minScore`/`maxScore` — throws `TypeError`.
  - `gradesData` / `examData` are coerced to `{}` if null/undefined/array rather than throwing.
  - Individual score averages are coerced with `Number()` — non-numeric values (e.g. stale string from DB) are skipped with a `console.warn` rather than silently NaN-poisoning the final score.

### Test Coverage

#### New test suite — `server/__tests__/` (63 tests, all passing)
- **`academic-calc.test.js`** (42 tests) — covers `computeFinalScores` and `attachDeviations`:
  - Full three-component weighted score accuracy
  - Partial weight normalisation (only a subset of types present)
  - Single-subject averageScore and subjectCount
  - Multi-student independence
  - Unknown/unweighted assessment types are ignored
  - Tied scores handled correctly
  - Grade boundary table (`score 100 → A` through `score 0 → E`) via `test.each`
  - Non-numeric score skipped with `console.warn` still computes remaining types
  - GPA accumulation
  - `attachDeviations`: class average per subject, deviation sign, single-student (zero deviation), null finalScore, multiple subjects independently, mutation in-place
  - Input validation: empty weights throws, empty schema throws, non-numeric weight throws, null inputs coerced safely
- **`ranking.test.js`** (14 tests) — covers `rankStudents`, `computeRankingScore`, `mergeRankings`, `bestPerSubject`:
  - Standard vs dense tie-breaking (1,2,2,4 vs 1,2,2,3)
  - All-tied cohort: all rank 1
  - Two consecutive tied groups (1,1,3,3,5 standard)
  - KCSE best-7-of-8 real-world scenario: correct subject exclusion
  - `compulsory_only` with empty list falls back to `all`
  - `mergeRankings` omits scopes where student is absent
  - `bestPerSubject` skips null scores, handles single student
- **`resolve-grade.test.js`** (7 tests) — covers `resolveGrade` from `academic-config.js`:
  - Exact upper and lower boundaries for every grade band
  - Decimal scores, custom schemas, default schema fallback
- **Infrastructure**: Jest added as `devDependency`; `npm test` script added to `package.json`; test pattern `server/__tests__/**/*.test.js`; `_model()` and `resolveGrade` mocked in calc tests to keep tests fully offline (no MongoDB connection required).

---

## [4.6.0] — 2026-05-17  Academic Reporting Engine — complete backend

### New — `server/routes/academic-config.js` (school-level academic configuration)
- `GET  /api/academic-config` — returns saved config merged with system defaults (no null fields)
- `PUT  /api/academic-config` — saves config with two hard validations: grade bands must not overlap; assessment weights must sum to 100 (±0.01 tolerance)
- `POST /api/academic-config/reset` — wipes saved config and reverts to system defaults (requires `settings:delete`)
- `GET  /api/academic-config/grade?score=N` — resolves any numeric score to its grade band; useful for frontend previews and server-side grade assignment
- Configurable grading schema: up to 20 grade bands with `minScore/maxScore/points/descriptor/remarks`
- Configurable assessment weights: `classwork / homework / project / test / midterm / final / coursework / oral / practical / other`
- Ranking settings: `enabled`, `scope` (class/stream/overall), `method` (standard 1,2,2,4 or dense 1,2,2,3), `showBestPerSubject`
- **Ranking subject strategy** (v4.6.0): `rankingSubjectStrategy: 'all' | 'best_n' | 'compulsory_only'` + `rankingN` + `compulsorySubjects[]` — supports KCSE best-7-of-8 and compulsory-only models
- Report card settings: `templateId`, `showAttendanceSummary`, `showGPA`, `showDeviation`, `showClassAverage`, signature labels, `footerNote`
- Flag: `subjectAssignmentEnforced` — if true, only the assigned subject teacher can enter marks (gradual rollout)
- Flag: `absentCountsAsZero` — default false; correct behaviour preserves absent marks out of averaging
- Exports `resolveGrade()`, `DEFAULT_GRADING_SCHEMA`, `mergeConfig()` — shared by exams, report-cards routes
- Default schema: A (80–100, 4.0pts) → E (0–39, 0.0pts), 8 bands

### New — `server/utils/ranking.js`
- `rankStudents(students, method)` — pure function, standard (1,2,2,4) or dense (1,2,2,3) ranking, input `[{studentId, totalScore}]`
- `mergeRankings(studentId, scopeRanks)` — builds `{ class: {rank, outOf}, overall: {rank, outOf} }` from multiple ranked arrays
- `bestPerSubject(studentReports)` — returns `{ [subjectId]: winnerStudentId }` across a class
- `computeRankingScore(subjects, strategy, n, compulsorySubjects)` — filters subjects by ranking strategy before computing the score used for ranking; returns `{ rankingScore, subjectsUsed[] }`

### New — `server/routes/report-cards.js` (full academic report card engine)
- `POST /generate` — live preview: aggregates published grades + approved exam results through configured assessment weights → finalScore per subject → resolveGrade() → provisional class rankings. Not persisted.
- `POST /publish` — admin-only batch publish with data integrity guarantees (see below)
- `GET  /` — paginated list of current (non-superseded) snapshots; `?history=1` includes superseded
- `GET  /publish-batches` — paginated audit trail of every publish run
- `GET  /:id` — full snapshot detail (includes embedded grading schema, weights at publish time)
- `PUT  /:id/comments` — role-gated comments: subject teacher → `subjectComments`, class teacher → `classTeacherRemark`, admin → `principalRemark`. Blocked on superseded snapshots.
- `GET  /:id/pdf` — single-student A4 PDFKit report card. Checks financial block (admin bypass `?force=1`). DRAFT watermark on non-published snapshots.
- `GET  /bulk-pdf` — class-wide merged PDF. Chunked in batches of 10 to limit memory use. Financial block filtering. Streamed as `Content-Disposition: attachment`.

#### Data integrity guarantees (v4.6.0)
- **Immutable version chain**: every publish creates a new snapshot with `version++`; old snapshot is marked `superseded:true, supersededAt, supersededBy`. Old versions are never deleted — they remain queryable via `?history=1`.
- **Interrupt-safe batch**: a `publish_batches` document is created with `status: running` before any work begins. Updated to `completed` on success, `failed` on error (with `failureReason`). `batchId` is embedded in every snapshot for traceability.
- **Moderation guard**: publish rejects if any exam for the class/term is not in `approved/locked/published/archived` state. Returns a list of the specific unmoderated exams. Admin can override with `skipModerationCheck: true`.
- **Config snapshot in every record**: `gradingSchema`, `assessmentWeights`, `passMark`, `rankingSubjectStrategy` are copied into each snapshot at publish time. Config changes after publishing never corrupt historical records.
- **DRAFT watermark**: diagonal 45° text on PDF if `status !== 'published'` or `superseded: true`. Shows "DRAFT" or "SUPERSEDED" at 6% opacity.
- **Version badge + batchId in PDF footer**: every printed report card shows its version number and batch ID for audit trail purposes.
- **Comments preserved across republish**: comments from the current version are carried forward to the new version; not reset on republish.

### Extended — `server/routes/exams.js` (exam state machine + mark states + audit trail)
- **State machine**: `scheduled → in_progress → completed → moderated → approved → locked → published → archived` — server enforces transition order; clients cannot skip states
- **Role-gated transitions**: teachers can only drive `in_progress` / `completed`; admin-only for `moderated` / `approved` / `locked` / `published` / `archived`
- **Mark states**: `present / ABS / MIS / EXM / INC` replace the old `absent: boolean`. Backward-compatible — `absent: true` still accepted and maps to `ABS`
  - `ABS` = absent (excluded from averages unless `absentCountsAsZero: true`)
  - `MIS` = mark not entered yet (flags for teacher action)
  - `EXM` = exempted from averaging entirely
  - `INC` = incomplete — warnings surfaced in response; intended to block approval
- `POST /:id/lock` — admin only; enforces approved→locked transition; writes to `statusHistory`
- `POST /:id/unlock` — admin only; requires mandatory `reason`; writes to `mark_audit_log`; locked→approved transition
- `GET  /:id/status-history` — full audit trail of every status change (who, when, why)
- Results `POST /:id/results`: blocked on `locked/published/archived`; teacher-ownership check against `exam.ownerId`; resolves mark states; writes `RESULT_UPDATED` audit entries to `mark_audit_log`; warns on `INC/MIS` marks; auto-advances exam to `completed` on first result entry

### Extended — `server/routes/grades.js` (audit trail on score edits)
- `PUT /:id` now fetches the existing record before update, writes a `GRADE_UPDATED` entry to `mark_audit_log` whenever `score` changes — captures `previousValue`, `newValue`, `editedBy`, `actingAs`, `reason`

### Infrastructure
- `server/index.js`: registered `/api/academic-config` and `/api/report-cards` routes; bumped health version to `4.5.8`; added `/reports` and `/report-cards` to SPA fallback whitelist
- `package.json`: added `pdfkit` dependency (A4 PDF generation without Puppeteer)

---

## [4.5.7] — 2026-05-05  Fix — deleted schools still "remembered" email address

### Fixed — `server/routes/platform.js` + `platform.html`
- **Root cause**: Wipe-All and Delete-School routes matched tenant data by `school.id` (the custom string field), but Mongoose's built-in `id` virtual can shadow the stored field, leaving `schoolIds` empty. User documents were never deleted → the admin email remained "in use" in the database.
- **Three-strategy tenant deletion**: Both delete routes now match using `school.id` (custom FK), `school._id.toString()` (MongoDB ObjectId as string), AND `school.adminEmail` directly on the users collection. All three run simultaneously via `Promise.all` — at least one will always hit.
- **New `DELETE /api/platform/orphans` endpoint**: Scans for `superadmin` user documents whose email or `schoolId` no longer matches any school in the database, and deletes them. Fixes any emails already stuck from previous wipes.
- **"Purge Orphaned Users" button** added to the Diagnostics tab — one click clears all stuck email addresses and shows which ones were removed.

---

## [4.5.6] — 2026-05-05  Diagnostic — full email + impersonate + branding root-cause fix

### Fixed — `server/utils/email.js` + `server/routes/platform.js` + `platform.html` + `render.yaml`
- **Root cause of no emails**: `SMTP_USER`, `SMTP_PASS`, and `PLATFORM_EMAIL` were not declared in `render.yaml` at all — Render had zero email credentials. Added all three as `sync: false` keys (must be set manually in Render dashboard → Environment). Added a clear `[EMAIL] ⚠️ SMTP_USER / SMTP_PASS not set` warning to server logs on startup.
- **Approval email linked to wrong URL**: `sendApprovalWelcome` was building `APP_URL?school=slug` which goes to the server root (`index.html`, the legacy app). Changed to `APP_URL/login` (the React SPA).
- **`APP_URL` was wrong in `render.yaml`**: Was `innolearn-ecosystem.onrender.com`, corrected to `school-management-ecosystem.onrender.com`.
- **Impersonate missing `schoolName` in JWT + response**: The sidebar's `user.schoolName` was `undefined` after impersonation because the impersonate endpoint never included it. Now `schoolName: school.name` is in both the JWT payload and the returned user object.
- **Legacy localStorage not cleared on impersonate**: Old InnoLearn demo keys lingered and contaminated new school sessions. `doImpersonate` now wipes all legacy app keys before storing the new React SPA session.
- **`_send()` no longer throws when SMTP not configured**: Added early-return guard so unconfigured email never causes approval/registration to fail.
- **Diagnostics view added** to platform admin: "🩺 Diagnostics" tab with one-click email test (shows SMTP config state + sends a test email to `PLATFORM_EMAIL`), DB connection check, and a table of all required Render environment variables with setup instructions.

---

## [4.5.5] — 2026-05-05  Fix — new schools see correct branding & clean dashboard (no demo data)

### Fixed — `platform.html` + `client/src/components/layout/Sidebar.jsx`
- **Impersonate now redirects to React SPA** (`/login`) instead of the legacy vanilla-JS app (`/index.html`). Previously, clicking "Log In as Admin" sent the operator into the old InnoLearn demo app which seeds fake data (20 students, 8 staff, 29 classes, InnoLearn branding) into `localStorage` regardless of the school. The React SPA is fully tenant-scoped and shows empty/correct data for new schools.
- **Session correctly written for React SPA** — `doImpersonate` now stores `{ token, user, school }` under the `innolearn_session` key that the React auth store reads, so the operator lands on the SPA already authenticated.
- **Sidebar shows school name, not "InnoLearn"** — replaced the hardcoded `"InnoLearn"` platform title and `"IL"` badge with dynamic values derived from `user.schoolName` in the JWT session. The two-letter initials badge is also computed from the school name.
- **Sidebar subtext shows user role** — the secondary line under the school name now shows the user's role (e.g. "Superadmin") instead of the static school name fallback.

---

## [4.5.4] — 2026-05-04  Platform — delete school, wipe all, no more browser confirm() dialogs

### Platform Admin (`platform.html` + `server/routes/platform.js`)
- **Removed all `confirm()` calls** — the Suspend / Reinstate confirmation now uses the platform's existing `showModal()` system with proper action buttons
- **Delete School button** added to every row in the All Schools table (red trash icon) — triggers a modal with a permanent-warning banner before deleting
- **Wipe All button** added to the Schools table header — purges every non-demo school and all their tenant data (users, students, classes, attendance, finance, behaviour, timetable, messages, academic years, sections, role permissions, subjects, events, HR records) in one operation; the InnoLearn demo school (`slug: innolearn`) is always preserved
- **`DELETE /api/platform/schools/:id`** — new server route; deletes the school document and all data in every tenant collection that shares the same `schoolId`
- **`DELETE /api/platform/schools/all`** — new server route; bulk-deletes all non-`innolearn` schools and their tenant data; returns `{ deleted: N }`
- Route order: `/schools/all` registered before `/schools/:id` so Express matches the literal path correctly

---

## [4.5.3] — 2026-05-04  UX — inline form validation on onboarding form (no more browser popups)

### Changed — `onboard.html` + `css/onboard.css`
- Removed all seven `alert()` calls from the `validate()` function — browser native popups were jarring and blocked the UI
- Added `.ob-step-error` inline error banner below the panel heading on each step — appears with a slide-in animation, styled red with a left accent border
- Red field highlights (`.ob-field-invalid`) appear on individual empty/invalid inputs and selects when Continue is clicked — border turns red with a soft red glow
- Error banner auto-dismisses as soon as the user starts editing any highlighted field (`input` / `change` listeners on all required fields)
- Step 1 errors now individually identify which field caused the issue (empty required fields vs. bad slug format vs. no curriculum vs. no sections)
- Step 2 errors distinguish "missing name/email" from "invalid email format" with field-specific highlighting
- Step 3 shows a friendly "select a plan" prompt directly on the plan grid instead of an alert
- Added `apiFetch()` helper in `platform.html` — announcement management was calling it but it was undefined

---

## [4.5.2] — 2026-05-04  Hotfix — platform approve/impersonate always returned "School not found"

### Fix — `server/routes/platform.js` + `platform.html`
- **Root cause**: Mongoose has a built-in `id` virtual (an alias for `_id.toString()`) which conflicts with the custom `id` field stored on school documents. When `School.find({}).lean()` is called, the serialised JSON may not carry the custom `id` field, so `s.id` in the frontend evaluates to `undefined`. Every Approve / Reject / Impersonate / Plan-change action then called e.g. `POST /api/platform/schools/undefined/approve`, and the server-side `findOneAndUpdate({ id: 'undefined' })` query found nothing → 404 "School not found".
- **Frontend fix** (`platform.html`): all platform action buttons now use `s._id` (MongoDB's native ObjectId string, always present in `.lean()` output) instead of `s.id`. Same fix applied to announcement action buttons (`ann._id`).
- **Backend fix** (`platform.js`): all school lookup queries changed from `findOneAndUpdate({ id: ... })` to `findByIdAndUpdate(id, ...)` — Mongoose auto-casts the string to ObjectId. Announcement patch/delete routes updated identically.
- **Impersonate robustness**: route now first fetches the school by `_id`, then locates the superadmin user via `{ schoolId: school.id }` with an email-address fallback (`{ email: school.adminEmail }`) for any school where the custom `id` field was not stored. JWT `schoolId` is taken from the found user document rather than the URL param.
- **Missing `apiFetch` helper defined**: announcement management functions called `apiFetch()` which was never defined; added a thin wrapper that mirrors the platform key header behaviour of the existing `api()` helper.

---

## [4.5.1] — 2026-05-04  Hotfix — school registration 500 error (stale `adminPassword` reference)

### Fix — `server/routes/onboard.js`
- **Root cause of three reported platform bugs**: a stale `if (adminPassword.length < 8)` validation line was left in `_provisionInDB` after the password field was removed from the registration form in v4.4.0. `adminPassword` was never declared, so every `POST /api/onboard` call threw a `ReferenceError` and crashed with a 500 response — the school and user documents were never written to MongoDB.
- **Consequence**: (1) no "pending" email sent to the registrant, (2) Approve → "School not found" (school never existed in DB), (3) Impersonate → "School has no super admin" (user never existed in DB).
- **Fix**: removed the three stale lines; the rest of the provisioning flow (slug generation, DB writes, email dispatch) was already correct.
- No other logic changed; the fix is a pure removal of dead code.

---

## [4.5.0] — 2026-05-03  Security hardening — rate limiting + Render deploy fix

### Security — Global Rate Limiting (`server/index.js`) · commit `503e51f`
- Added two limiters at the server level — `express-rate-limit` was already a dependency (used in route files) but never applied globally
- **General limiter**: 300 req / 15 min / IP across all `/api/*` — skipped in development so local workflows are unaffected
- **Auth limiter**: 20 req / 15 min / IP on `/api/auth` — stacked on top of the general limiter, always enforced including in dev
- Standard `RateLimit-*` headers returned on every response so API clients can back off gracefully before hitting the wall

### Fix — Render Deployment (`render.yaml` + `client/.npmrc`) · commit `16f725c`
- `buildCommand` was `npm install` only — React `client/dist/` was never compiled; `fs.existsSync` returned `false`; Express fell back to the legacy `index.html` on every Render deploy
- Fixed: `npm install && cd client && npm install --include=dev && npm run build`
- `--include=dev` required because `vite` and `tailwindcss` live in `devDependencies`; Render strips them by default in production
- Added `client/.npmrc` with `include=dev` as a second-line safety net for any CI environment that ignores the CLI flag

---

## [4.4.0] — 2026-05-03  Persistent messaging, auto-credential registration, dedicated school URLs

### School Registration — Password Removed, System-Generated Credentials
- Removed password fields from the onboarding form — schools no longer set their own password during registration
- Server generates a cryptographically secure 12-character temp password using `crypto.randomBytes` (no ambiguous characters)
- Temp password stored alongside the hashed version in the user document; cleared from DB once the approval email is sent
- `mustChangePassword: true` set on all newly registered school admins — forced password change on first login
- Offline (localStorage) mode also generates a local temp password and displays it in the success screen with a prominent "save this now" warning

### School Approval — Full Credentials Email
- Approval email now includes the school's **dedicated login URL** (`APP_URL?school={slug}`), their email, and the auto-generated temp password
- Email styled with a highlighted monospace password block and a security warning about first-login password change
- Temp password cleared from DB after the approval email is dispatched
- `sendApprovalWelcome` updated to accept `tempPassword` parameter

### Dedicated School Login URL (`?school=slug`)
- `js/app.js` reads `?school=` query param on page load and stores it in `localStorage` as `ss_school_slug`
- URL is cleaned with `history.replaceState` after storing — slug does not remain visible in browser history
- Enables school-specific links like `https://app.innolearn.edu.ke?school=greenhill` to route users to their tenant automatically

### Communication Hub — MongoDB-Persistent Messages
- Messages and announcements now stored in MongoDB via `POST /api/messages`; no longer ephemeral in localStorage
- Messages load from server on every tab open; fall back to localStorage DB when offline
- Loading skeleton shown while fetching from server
- `GET /api/messages?tab=inbox|sent` — scoped to the user's school; inbox shows `all`, role-group, and direct messages
- `PATCH /api/messages/:id/read` — persists read status per user
- `DELETE /api/messages/:id` — sender, admin, and deputy principal can delete

### Email Notifications for In-App Messages
- Every sent message and announcement triggers real email delivery to all recipients (`sendMessageNotification`)
- Direct messages: personal notification email to the recipient with subject preview
- Announcements (`all` / `teachers` / `parents` / `students` / `staff`): notification email sent to every matching active user in the school
- Group emails sent in parallel (non-blocking `Promise.allSettled`) — failed sends logged, do not block the response
- New email template: `sendMessageNotification` — branded InnoLearn header, sender name, subject, 160-char preview, "Open InnoLearn" CTA

### New Server Route — `server/routes/messages.js`
- `GET /` — list messages (inbox/sent) with pagination; role-group filtering
- `POST /` — create message, resolve recipients, send notification emails
- `PATCH /:id/read` — mark as read
- `DELETE /:id` — delete with role check
- Registered in `server/index.js` at `/api/messages`

### Frontend API Client — `js/api.js`
- Added `API.messages` namespace: `list()`, `send()`, `markRead()`, `remove()`

---

## [4.3.0] — 2026-05-03  Phase 4 — React SPA (Vite + React 18 + TanStack Query + Tailwind CSS)

### Architecture — Modern React SPA

Phase 4 introduces a production-ready React front-end (`client/`) that runs alongside the legacy vanilla-JS app. **Zero breaking changes** — the legacy app continues to be served untouched. Once `npm run build:react` is run, the compiled SPA is served automatically by the Express server at all SPA routes.

### New — `client/` React App

**Configuration**
- `client/package.json` — React 18, React Router v6, TanStack Query v5, Zustand, clsx, date-fns, Tailwind CSS 3, Vite 5
- `client/vite.config.js` — dev server on port 5173, proxy `/api` → Express port 3005, code-split chunks (react, router, query)
- `client/tailwind.config.js` — InnoLearn brand palette (sidebar indigo, `brand-*` spectrum), card shadows, fade/slide animations
- `client/postcss.config.js`, `client/index.html` — Inter font, `h-full` body

**Entry & Routing**
- `client/src/main.jsx` — `QueryClient` (staleTime 2 min matching server TTL), `RouterProvider`, React Query Devtools in dev
- `client/src/App.jsx` — `createBrowserRouter` with all 12 module routes; lazy-loaded pages wrapped in `<Suspense>`; `ProtectedRoute` guard

**API Client** (`client/src/api/client.js`)
- Full port of `js/api.js` — same modules (students, teachers, classes, attendance, finance, behaviour, exams, grades, admissions, timetable, auth, settings)
- `APIError` class with `code`, `message`, `status`
- Dispatches `api:unauthorized` event on 401; `useAuthStore` listens and auto-logs out

**Auth Store** (`client/src/store/auth.js`)
- Zustand store persisting `innolearn_session` to localStorage
- `setSession`, `logout`, `patchUser`, `can(feature)` helpers
- Listens to `api:unauthorized` window event for server-side session expiry

**Layout**
- `AppShell.jsx` — desktop sidebar always visible (lg+), mobile drawer with backdrop overlay, auto-close on navigation
- `Sidebar.jsx` — section-grouped nav, active link highlight, user footer with logout
- `TopBar.jsx` — breadcrumb derived from current route, plan badge, user avatar

**Guards & UI Primitives**
- `ProtectedRoute.jsx` — redirects to `/login` if no session token; preserves `from` location for post-login redirect
- `Spinner.jsx` — `Spinner` (5 sizes) + `PageSpinner` (centred loading block)
- `Badge.jsx` — 7 variants, dot indicator; `studentStatusBadge`, `invoiceStatusBadge`, `admissionStageBadge` helpers
- `EmptyState.jsx` — `EmptyState` (icon + CTA) and `ErrorState` (message + retry)
- `Pagination.jsx` — smart page window (first, last, ±1 around current with ellipsis)

**Pages**
- `Login.jsx` — split-panel layout (brand left, form right), handles `passwordExpired` server flag with inline change-password flow
- `Dashboard.jsx` — 4 stat cards (students, attendance, finance, admissions) + recent-students list + quick-action links; all data from TanStack Query
- `StudentList.jsx` — debounced search (400 ms), class/status/gender filters, paginated table with avatar initials, soft-delete confirm
- `StudentProfile.jsx` — tabbed detail (Overview, Attendance, Finance, Behaviour, Grades); inline edit mode with controlled form; each tab lazy-fetches its data on first activation
- `TeacherList.jsx`, `ClassList.jsx`, `AttendancePage.jsx`, `FinancePage.jsx`, `BehaviourPage.jsx`, `ExamsPage.jsx`, `AdmissionsPage.jsx`, `TimetablePage.jsx`, `SettingsPage.jsx` — fully functional with TanStack Query, pagination, and table/card UIs
- `NotFound.jsx` — friendly 404 page

### Upgraded — Server (`server/index.js`)
- Serves `client/dist` as a primary static directory when `NODE_ENV=production` and the React build exists
- Long-lived cache headers (`immutable`) on hashed asset filenames
- React SPA routes (`/dashboard`, `/students`, `/login`, etc.) served React's `index.html`; legacy routes fall back to legacy `index.html`
- `/onboard` and `/platform` continue to serve their dedicated HTML pages
- Version bumped to `4.2.0` in health endpoint

### Upgraded — Root `package.json`
- Version bumped to `4.2.0`
- `dev:react` — run Vite dev server (`cd client && npm run dev`)
- `build:react` — install client deps + Vite build
- `build` — alias for `build:react`

### How to run

```bash
# Start API (existing)
npm run dev

# Start React dev server (in a second terminal — proxies /api to port 3005)
npm run dev:react

# Build React for production
npm run build:react

# After build, npm start serves the React app automatically
npm start
```

---

## [4.2.0] — 2026-05-03  Phase 3 — API-First Data Layer · Cache · Production Writes · Module Hydration

### Architecture — localStorage → API-First

Phase 3 replaces the localStorage-as-primary-database pattern with a server-first data layer. All writes now go to the production API first; localStorage acts as a fast synchronous cache between server fetches. **Zero breaking changes** — all existing modules continue to work.

### New — In-Memory TTL Cache (`js/cache.js`)
- `Cache.set(key, data, ttl)` — store with TTL (default 2 minutes)
- `Cache.get(key)` — returns null if missing or expired
- `Cache.has(key)` — live check without returning data
- `Cache.invalidate(key?)` — bust one key or clear everything
- `Cache.invalidatePrefix('behaviour_')` — bust all keys matching a prefix
- `Cache.debug()` — log all live keys with TTL remaining to console

### Upgraded — DB Module (`js/data.js`)
- **`PRODUCTION_ROUTES` map** — 13 collections mapped to their resource API routes (students, teachers, classes, attendance, invoices, payments, behaviour_*, grades, admissions, timetable)
- **`_push()` upgraded** — for collections in PRODUCTION_ROUTES, writes now route to the correct REST endpoint (`PUT /api/students/:id`, `DELETE /api/teachers/:id`, etc.) instead of the legacy `/api/collections/:col` generic route. The backend RBAC middleware now validates all writes.
- **`DB.hydrate(col, params)`** — new async function; fetches all pages from the production API (up to 1000 records), stores in localStorage, marks in 2-minute cache. Concurrent hydration of the same collection is deduplicated.
- **`DB.invalidateHydration(col)`** — busts the hydration cache so the next `render()` fetches fresh data from the server
- Both `hydrate` and `invalidateHydration` exported from the DB module

### New — App Loading & Pagination Helpers (`js/app.js`)
- `App.loadingHtml(message, subtext)` — returns a full-page loading spinner HTML
- `App.renderLoading(message, subtext)` — calls `renderPage()` with the loading spinner
- `App.renderError(message, retryFn?)` — renders a full-page error state with optional retry button
- `App.pagerHtml(page, totalPages, callbackFn, totalRecords?)` — returns pagination control HTML for any table

### Upgraded — Students Module (`js/modules/students.js`)
- `render()` is now `async` — shows loading spinner on first visit (no cached data), then hydrates from `/api/students` and re-renders
- Subsequent navigation reuses 2-minute cache — no spinner on repeat visits
- `save()` calls `DB.invalidateHydration('students')` after update — next render gets fresh server data
- `deleteStudent()` calls `DB.invalidateHydration('students')` and triggers a clean re-render

### Upgraded — Attendance Module (`js/modules/attendance.js`)
- `render()` is now `async` — hydrates attendance records (filtered to current class + date) and students before rendering
- `submit()` — fires `API.attendance.bulkMark()` to the production endpoint for the whole class in one atomic request, alongside the localStorage write. Cache invalidated on success.

### Upgraded — Finance Module (`js/modules/finance.js`)
- `render()` is now `async` — hydrates invoices and payments from production API before rendering
- `savePayment()` is now `async` — calls `API.finance.payments.record()` first; server recalculates balance and status; localStorage updated to match. Graceful fallback to localStorage-only if plan doesn't include the finance API.
- `doGenerateInvoices()` is now `async` — calls `API.finance.invoices.create()` for each student; server assigns `INV-{year}-{000001}` format invoice numbers. Graceful fallback to legacy client-side numbering on lower plans.

### Upgraded — Behaviour Module (`js/modules/behaviour.js`)
- `render()` is now `async` — hydrates incidents, appeals, and categories in parallel before rendering
- `DB.invalidateHydration('behaviour_incidents')` called after every incident log

### Script Load Order (`index.html`)
```
data.js → cache.js → api.js → validators.js → modules → app.js
```

---

## [4.1.0] — 2026-05-03  Phase 2 — Remaining Resource Routes · Frontend API Client

### New — Resource Route: Behaviour (`server/routes/behaviour.js`)
- `GET /api/behaviour/incidents` — paginated log with student/class/type/severity/category/date-range filters
- `GET /api/behaviour/incidents/summary` — MongoDB aggregation: merits, demerits, points total per student
- Full CRUD for incidents with soft-delete (sets `status: resolved`)
- `GET /api/behaviour/appeals` — paginated; `POST` creates appeal and marks incident as `appealed`; `PUT` records outcome and auto-resolves incident
- Full CRUD for `GET/POST/PUT/DELETE /api/behaviour/categories` — school-defined category definitions

### New — Resource Route: Exams (`server/routes/exams.js`)
- Full CRUD for exam schedules (test, mock, terminal, internal, external, coursework)
- `GET /api/exams/:id/results` — paginated; includes server-computed class stats (highest, lowest, average, pass count)
- `POST /api/exams/:id/results` — bulk upsert results for all students; validates scores ≤ maxScore; computes grade letter from school grading scale; auto-marks exam as `completed`
- `GET /api/exams/results/all` — cross-exam results query with student/class/subject filters

### New — Resource Route: Grades (`server/routes/grades.js`)
- Full CRUD for gradebook entries (classwork, homework, project, test, midterm, final, coursework)
- Percentage auto-calculated server-side; client values ignored
- Score > maxScore rejected at API layer
- `POST /api/grades/bulk` — bulk upsert via MongoDB `bulkWrite`; validates all scores before insert
- `GET /api/grades/report` — weighted average per student per subject using MongoDB aggregation (accounts for assessment weight field)

### New — Resource Route: Admissions (`server/routes/admissions.js`)
- Full pipeline CRUD from enquiry → enrolled/withdrawn
- Auto-generated `applicationRef` (`APP-{year}-{6char}`)
- `stageHistory` array appended on every stage change — full audit trail
- `GET /api/admissions/stats` — aggregated pipeline counts per stage, ordered by funnel position
- `PATCH /api/admissions/:id/stage` — quick stage-change endpoint with optional notes

### New — Resource Route: Timetable (`server/routes/timetable.js`)
- Full CRUD for timetable slots (class + day + period + subject + teacher + room)
- Slot collision detection: duplicate class + day + period rejected with 409
- `GET /api/timetable/class/:classId` — full class timetable grouped by day for easy rendering
- `GET /api/timetable/teacher/:teacherId` — teacher's full schedule grouped by day
- `POST /api/timetable/bulk` — populate whole timetable at once; optional `replaceClass` / `replaceDay` to clear and rebuild

### New — Frontend API Client (`js/api.js`)
- Centralised fetch wrapper: attaches JWT, handles the `{ success, data, pagination }` envelope, throws `APIError` on failure
- Dispatches `api:unauthorized` event on 401 — auto-redirects to login when session expires
- Module namespaces: `API.students`, `API.teachers`, `API.classes`, `API.attendance`, `API.finance.invoices`, `API.finance.payments`, `API.behaviour.incidents`, `API.behaviour.appeals`, `API.behaviour.categories`, `API.exams`, `API.exams.results`, `API.grades`, `API.admissions`, `API.timetable`, `API.auth`, `API.announcements`, `API.backup`
- `API.collections.*` — legacy wrapper for `/api/collections/:col` (kept for backward compat. during migration)
- Loaded in `index.html` before all feature modules

### New API Endpoints (v4.1.0)
| Method | Route | Auth | Plan | Description |
|---|---|---|---|---|
| `GET` | `/api/behaviour/incidents` | JWT | standard | Paginated incident log |
| `POST` | `/api/behaviour/incidents` | JWT | standard | Log incident |
| `GET` | `/api/behaviour/incidents/summary` | JWT | standard | Per-student merit/demerit totals |
| `PUT` | `/api/behaviour/incidents/:id` | JWT | standard | Update incident |
| `DELETE` | `/api/behaviour/incidents/:id` | JWT | standard | Soft-close incident |
| `GET/POST/PUT` | `/api/behaviour/appeals` | JWT | standard | Appeal lifecycle |
| `GET/POST/PUT/DELETE` | `/api/behaviour/categories` | JWT | standard | Category management |
| `GET` | `/api/exams` | JWT | standard | Paginated exams |
| `POST` | `/api/exams` | JWT | standard | Schedule exam |
| `GET` | `/api/exams/:id/results` | JWT | standard | Results + class stats |
| `POST` | `/api/exams/:id/results` | JWT | standard | Bulk enter results |
| `GET` | `/api/exams/results/all` | JWT | standard | Cross-exam results query |
| `GET` | `/api/grades` | JWT | core | Paginated gradebook |
| `POST` | `/api/grades` | JWT | core | Create grade entry |
| `POST` | `/api/grades/bulk` | JWT | core | Bulk upsert grades |
| `GET` | `/api/grades/report` | JWT | core | Weighted average report |
| `GET` | `/api/admissions` | JWT | premium | Paginated pipeline |
| `POST` | `/api/admissions` | JWT | premium | Create application |
| `GET` | `/api/admissions/stats` | JWT | premium | Pipeline funnel stats |
| `PATCH` | `/api/admissions/:id/stage` | JWT | premium | Quick stage change |
| `GET` | `/api/timetable` | JWT | standard | Filtered timetable slots |
| `GET` | `/api/timetable/class/:classId` | JWT | standard | Class timetable (grouped by day) |
| `GET` | `/api/timetable/teacher/:teacherId` | JWT | standard | Teacher schedule |
| `POST` | `/api/timetable` | JWT | standard | Create slot (collision check) |
| `POST` | `/api/timetable/bulk` | JWT | standard | Bulk populate/replace timetable |

---

## [4.0.0] — 2026-05-01  Phase 1 Architecture — Server-Side RBAC · Plan Gating · Paginated Resource APIs · Atomic IDs

### Architecture — Zero-Trust Backend Security (Phase 1)
This release begins the production architecture migration. All changes are **backward-compatible** — the existing `/api/collections/*` route is untouched. New resource routes co-exist alongside the legacy route allowing a gradual frontend migration.

### New — Server-Side RBAC Middleware (`server/middleware/rbac.js`)
- `rbac(module, action)` — Express middleware factory; checks the requesting user's role permissions before any handler runs
- Permissions loaded from the `role_permissions` MongoDB collection, scoped per `schoolId + role`
- **5-minute in-memory cache** per `schoolId::role` pair — avoids a DB round-trip on every request
- `invalidatePermCache(schoolId)` — exported for cache-busting when permissions change
- `superadmin` and `admin` roles bypass all permission checks automatically
- Standardised 403 response: `{ success: false, error: { code: 'FORBIDDEN', message: '...' } }`

### New — Plan Tier Gating Middleware (`server/middleware/plan.js`)
- `planGate(feature)` — Express middleware factory; gates access by the school's subscription plan
- Cumulative plan hierarchy: **core ⊂ standard ⊂ premium ⊂ enterprise**
- Feature → minimum plan map:
  - **Core**: students, attendance, classes, teachers, grades, subjects, events, messaging
  - **Standard**: behaviour, timetable, exams, key stages, houses, sections
  - **Premium**: finance, admissions, reports, report cards, custom roles
  - **Enterprise**: API access, SSO, advanced analytics, multi-campus, white-label
- School plan cached per schoolId (5-min TTL, `invalidatePlanCache(schoolId)` exported)
- Standardised 403 response includes `currentPlan` and `requiredPlan` fields

### New — Atomic Counter Utility (`server/utils/counters.js`)
- `nextId(name)` — race-safe atomic increment using MongoDB `$inc + upsert` on `counters` collection
- `nextAdmissionNumber(schoolId)` → `ADM-{year}-{00001}` (5-digit zero-padded)
- `nextStaffId(schoolId)` → `STF-{year}-{00001}`
- `nextInvoiceNumber(schoolId)` → `INV-{year}-{000001}` (6-digit)
- `nextReceiptNumber(schoolId)` → `RCP-{year}-{000001}`
- All counters are per-school, per-year — reset naturally each academic year

### New — Standardised Response Helpers (`server/utils/response.js`)
- `ok(res, data, pagination?)` — `{ success: true, data, pagination }`
- `created(res, data)` — 201 Created with same envelope
- `fail(res, code, message, status?, extra?)` — `{ success: false, error: { code, message } }`
- `paginate(page, limit, total)` — builds `{ page, limit, total, pages }` meta object
- `parsePagination(query)` — parses `?page=1&limit=50` with safe defaults (max 200/page)
- `E.*` — shortcut error helpers: `E.notFound`, `E.forbidden`, `E.validation`, `E.conflict`, etc.

### New — Resource Route: Students (`server/routes/students.js`)
- Full CRUD + bulk import for student records
- **Zod validation** on all inputs; unknown fields and type coercion handled safely
- Admission numbers generated **server-side** via atomic counter — never accepted from client
- Soft delete: sets `status: 'inactive'` with `deletedAt` + `deletedBy` (record preserved)
- Filters: `status`, `classId`, `houseId`, `keyStageId`, `gender`, free-text `search`
- `POST /api/students/bulk` — up to 500 students, per-row validation errors, 207 Multi-Status on partial success

### New — Resource Route: Teachers (`server/routes/teachers.js`)
- Full CRUD for teaching/staff records
- Staff IDs generated **server-side** (`STF-{year}-{00001}`)
- Email uniqueness enforced per school at API layer
- Soft delete with audit trail

### New — Resource Route: Classes (`server/routes/classes.js`)
- Full CRUD for class management
- `GET /api/classes/:id/students` — paginated list of students enrolled in a class (requires `students:read` permission)
- Duplicate class name check within same school + academic year

### New — Resource Route: Attendance (`server/routes/attendance.js`)
- `GET /api/attendance` — paginated with date, dateFrom/dateTo range, classId, studentId, period, status filters
- `GET /api/attendance/summary` — server-side MongoDB aggregation of attendance rates per student
- `POST /api/attendance/bulk` — mark all students in a class in one request using MongoDB `bulkWrite` upserts
- Upsert behaviour: same student + date + period combination is updated, not duplicated
- Attendance statuses: `present`, `absent`, `late`, `authorised_absence`, `excluded`, `holiday`

### New — Resource Route: Finance (`server/routes/finance.js`)
- **All financial totals calculated server-side** — client-supplied totals are ignored
- Invoice creation: `subtotal`, `discountAmount`, `taxAmount`, `total` derived from line items
- Payment recording: validates against outstanding balance, rejects overpayments
- Invoice status auto-updated on every payment: `unpaid` → `partial` → `paid`
- `GET /api/finance/summary` — aggregate overview: total invoiced, collected, outstanding, breakdown by payment method
- Void protection: paid invoices cannot be edited or voided
- `INV-{year}-{000001}` invoice numbers and `RCP-{year}-{000001}` receipt numbers, server-generated

### New API Endpoints (v4.0.0)
| Method | Route | Auth | RBAC | Plan | Description |
|---|---|---|---|---|---|
| `GET` | `/api/students` | JWT | `students:read` | core | Paginated student list |
| `POST` | `/api/students` | JWT | `students:create` | core | Create student (server admission no.) |
| `POST` | `/api/students/bulk` | JWT | `students:create` | core | Bulk import up to 500 |
| `GET` | `/api/students/:id` | JWT | `students:read` | core | Single student |
| `PUT` | `/api/students/:id` | JWT | `students:update` | core | Update student |
| `DELETE` | `/api/students/:id` | JWT | `students:delete` | core | Soft-delete student |
| `GET` | `/api/teachers` | JWT | `teachers:read` | core | Paginated teacher list |
| `POST` | `/api/teachers` | JWT | `teachers:create` | core | Create teacher (server staff ID) |
| `GET` | `/api/teachers/:id` | JWT | `teachers:read` | core | Single teacher |
| `PUT` | `/api/teachers/:id` | JWT | `teachers:update` | core | Update teacher |
| `DELETE` | `/api/teachers/:id` | JWT | `teachers:delete` | core | Soft-delete teacher |
| `GET` | `/api/classes` | JWT | `classes:read` | core | Paginated class list |
| `POST` | `/api/classes` | JWT | `classes:create` | core | Create class |
| `GET` | `/api/classes/:id` | JWT | `classes:read` | core | Single class |
| `GET` | `/api/classes/:id/students` | JWT | `students:read` | core | Students in class |
| `PUT` | `/api/classes/:id` | JWT | `classes:update` | core | Update class |
| `DELETE` | `/api/classes/:id` | JWT | `classes:delete` | core | Soft-delete class |
| `GET` | `/api/attendance` | JWT | `attendance:read` | core | Paginated attendance |
| `POST` | `/api/attendance` | JWT | `attendance:create` | core | Single attendance record (upsert) |
| `POST` | `/api/attendance/bulk` | JWT | `attendance:create` | core | Bulk-mark whole class |
| `GET` | `/api/attendance/summary` | JWT | `attendance:read` | core | Aggregated rates per student |
| `PUT` | `/api/attendance/:id` | JWT | `attendance:update` | core | Update record |
| `DELETE` | `/api/attendance/:id` | JWT | `attendance:delete` | core | Delete record |
| `GET` | `/api/finance/invoices` | JWT | `finance:read` | premium | Paginated invoices |
| `POST` | `/api/finance/invoices` | JWT | `finance:create` | premium | Create invoice (server totals) |
| `PUT` | `/api/finance/invoices/:id` | JWT | `finance:update` | premium | Update invoice + recalc |
| `DELETE` | `/api/finance/invoices/:id` | JWT | `finance:delete` | premium | Void invoice |
| `GET` | `/api/finance/payments` | JWT | `finance:read` | premium | Paginated payments |
| `POST` | `/api/finance/payments` | JWT | `finance:create` | premium | Record payment + auto-update invoice |
| `GET` | `/api/finance/summary` | JWT | `finance:read` | premium | Financial summary/overview |

### Dependencies Added
- `zod@^3.23.8` — runtime schema validation and input parsing
- `uuid@^9.0.1` — RFC-4122 UUID generation for document IDs

### Notes
- All new routes coexist with `/api/collections/*` — **zero breaking changes** to the current frontend
- The legacy route remains available during frontend migration (Phase 2–3)
- `uuid` was already used in some prior code but was not listed in `package.json`

---

## [3.5.0] — 2026-05-03  Global Update Announcements · Data Backup & Export · Zero-Interruption Updates

### New — System Announcement Platform (Platform Admin)
- Platform admin has a new **"Announcements"** tab in the Platform dashboard
- Create notices with four types: **🔧 Scheduled Maintenance**, **🚀 Platform Update**, **🔒 Security Notice**, **ℹ️ General Info**
- Each announcement has a title, description, scheduled date/time, and optional expiry timestamp
- **"Notify all schools"** checkbox — instantly emails every active school admin with a branded notice, including a direct "Back Up My Data Now" call-to-action for maintenance and security notices
- Cancel, reactivate, or delete announcements at any time
- Dashboard shows notified school count and how many schools have dismissed the notice

### New — Announcement Banners on Every School Dashboard
- When a system announcement is active, a **colour-coded banner** appears at the top of every user's dashboard:
  - 🔧 Maintenance / 🔒 Security → amber/red banner with inline **"Back Up My Data Now"** button
  - 🚀 Update / ℹ️ Info → blue/purple banner with Dismiss link
- Banners load asynchronously on login — do not block or delay the dashboard
- Each school can dismiss a banner independently (stored server-side per school)
- Dismissed banners never reappear; expired banners (past `expiresAt`) are hidden automatically

### New — Data Backup & Export (Superadmin)
- Superadmin dashboard now shows a **"Data Backup & Export"** card and a **"Backup Data"** quick-action tile
- One click exports **all school data** across every collection (students, staff, classes, finance, attendance, behaviour, reports, and more) as a single structured **JSON file**
- File is downloaded directly to the browser — nothing is stored on InnoLearn servers
- Backup is version-stamped, timestamped, and labelled with the school name
- **Backup history log** — every export is logged with date, who triggered it, record count, and version; viewable via "View backup history" expander on the dashboard
- `GET /api/backup/preview` — shows record counts per collection before committing to a download
- Rate-limited: maximum 10 exports per hour per school

### New — Update Safety Protocol
- Before any major platform update, platform admin creates an announcement with `notifyAll: true`
- All school superadmins receive an email **and** a dashboard banner — both prompt them to back up their data first
- The update proceeds only after schools have had time to export — no school data is touched by the update process
- The backup file is a complete, self-contained JSON snapshot that can be used to verify data integrity after any change

### New API Endpoints
| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/announcements` | JWT | Active notices for this school |
| `POST` | `/api/announcements/:id/dismiss` | JWT | Per-school dismiss |
| `GET` | `/api/platform/announcements` | Platform Key | List all announcements |
| `POST` | `/api/platform/announcements` | Platform Key | Create + optionally email all schools |
| `PATCH` | `/api/platform/announcements/:id` | Platform Key | Update status/content |
| `DELETE` | `/api/platform/announcements/:id` | Platform Key | Remove announcement |
| `POST` | `/api/backup/export` | JWT (superadmin) | Full JSON export download |
| `GET` | `/api/backup/history` | JWT (superadmin) | List backup log entries |
| `GET` | `/api/backup/preview` | JWT (superadmin) | Record counts per collection |

### Email
- `sendSystemUpdateNotice` — branded maintenance/update email with urgency block; links directly to dashboard for backup action

---

## [3.4.0] — 2026-05-01  Password Rotation · User Invites · Role Notifications · Security Hardening

### Security — Critical Fixes
- `GET /api/collections/users` no longer returns password hashes or MFA fields — all bcrypt and OTP data is stripped from every response
- Any authenticated user (teacher, parent, student) could previously write to the `users` collection — now only `admin` and `superadmin` roles can create, update, or delete users and role permissions
- Non-superadmin users can no longer assign the `superadmin` role or modify their own role
- Password field cannot be overwritten via the generic PUT endpoint — role updates never touch credentials
- Added **`helmet`** HTTP security headers: X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy, and more
- CORS now restricted to known origins in production (Render URL + localhost); unknown origins are blocked and logged
- Server warns at startup if `JWT_SECRET` environment variable is not set
- bcrypt cost factor raised from 10 → 12 for all new password hashing

### New — 60-Day Password Rotation Policy
- All user passwords expire after **60 days** — enforced server-side at login
- If expired: server returns `passwordExpired: true` (no JWT issued) → frontend shows a "Password expired" force-change screen
- If `mustChangePassword` flag set: shows "Set your password" screen for first-login users
- Password change screen includes real-time hints (length ✓, match ✓) and blocks submission until both pass
- After successful forced change: JWT is issued, session starts normally
- Security email sent after every password change
- **Dashboard banner** visible to all users when password expires in ≤ 7 days (blue → amber → red urgency)
- Email reminders at 7 / 3 / 1 / 0 days before expiry (deduplicated — one per milestone per day)

### New — User Invite System (Bulk & Individual)
- `POST /api/users/invite` — admin/superadmin creates a single user with a system-generated temp password
  - User is created in MongoDB immediately; `mustChangePassword: true` is set
  - Welcome email sent with branded credentials and login link
  - Returns `{ user, tempPassword }` — password shown once to the admin
- `POST /api/users/bulk-invite` — accepts up to 200 users as a JSON array
  - Processes each independently: per-user welcome email, skips existing emails, records errors
  - Returns `{ created: [], skipped: [], errors: [] }` summary
- Users who are invited must set their own password on first login — their temp password never persists

### New — Email Notifications for All User Events
- **Welcome email** — sent to every new user with their temporary credentials and role
- **Password changed** — security confirmation email after any password update (forced or voluntary)
- **Password expiry reminder** — urgency-coded email at 7, 3, 1 days before and on expiry day
- **Role change notification** — automatic email to user whenever their role is updated via the dashboard; triggered by any PUT to the users collection that changes the `role` field
- All emails use the branded InnoLearn HTML template with action CTAs

### New API Endpoints
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/users/invite` | JWT (admin+) | Create user + send welcome email |
| `POST` | `/api/users/bulk-invite` | JWT (admin+) | Bulk create users, individual emails |
| `POST` | `/api/users/:id/role-change` | JWT (admin+) | Manual role-change notification |
| `POST` | `/api/auth/force-change` | Rate limited | Change expired/temp password → issues JWT |

---

## [3.3.0] — 2026-05-01  Security · Real-time Slug Check · 2FA · Trial Reminders

### New — Real-time URL Slug Availability Check
- As the admin types their school URL slug during registration, a **live availability indicator** appears instantly (500 ms debounce)
- **Green tick** = available; **Red warning** = already taken or reserved word
- Spinner shows while the check is in flight; indicator clears gracefully when offline
- Reserved words (`admin`, `api`, `platform`, `innolearn`, `www`, etc.) are blocked immediately without a server round-trip
- Slug also auto-checked when it is filled in automatically from the school name
- Server endpoint: `GET /api/onboard/check-slug` with a 60-request/minute rate limiter

### New — Auto-Logout After 10 Minutes of Inactivity
- Any authenticated session is silently **signed out after 10 minutes** of no keyboard, mouse, scroll, or touch activity
- At **9 minutes** an amber persistent toast appears with a "Stay signed in" button — clicking it resets the timer
- At **10 minutes** the session is destroyed and a "Signed out for security" toast is shown before returning to the login screen
- Idle timer resets on any of: `mousemove`, `mousedown`, `keydown`, `touchstart`, `scroll`, `click`
- Timer is checked every 30 seconds via `setInterval` (low CPU cost)

### New — Two-Factor Authentication (2FA) for Super Admin via Email
- When a **superadmin** signs in with a valid password, login is paused and a **6-digit OTP** is sent to their email address
- OTP is valid for **5 minutes**; a separate rate limiter (10 attempts / 5 min) prevents brute-force
- The login form is replaced by an OTP entry screen; a "Back to login" link cancels the attempt
- Expired OTP is cleared automatically; user is prompted to restart login to get a fresh code
- OTP stored as `mfaOtp` + `mfaExpiry` on the user document; cleared immediately on successful verify
- Future per-user opt-out supported via `mfaEnabled: false` flag on user record (superadmin only for now)

### New — Trial Expiry Reminders (Dashboard + Email)
- All school plans include a **30-day free trial** tracked by `school.trialEnds`
- **Dashboard banner** appears for superadmin and school admin when the trial has ≤ 7 days left:
  - 7 days left → blue info banner ℹ️
  - 2–3 days left → amber warning banner ⏰
  - 1 day left → red warning banner ⚠️
  - Expiry day → red critical banner 🚨
  - Banner disappears automatically once the trial period has passed
- **Email reminders** sent automatically at 7, 3, 1 days before and on the expiry day itself
- Deduplication: each milestone email is sent **at most once per day** using a date-keyed flag on the school record (`trialReminderSent_N`)
- Reminders triggered on login — no background job required

### Security
- `GET /api/onboard/check-slug` protected with rate limiter (60 req/min per IP)
- `POST /api/auth/verify-otp` protected with OTP-specific rate limiter (10 req / 5 min)
- Login now returns `mfaRequired: true` (no JWT issued) for superadmin until OTP is verified — token is never exposed before 2FA completion
- Auto-logout ensures sessions are never left open on shared or unattended devices

---

## [3.2.0] — 2026-05-01  School Approval Workflow · Email Notifications · Setup Wizard

### New — School Approval Workflow
- New schools registered via `/onboard` are created with **`status: 'pending'`** and **`isActive: false`** — they are **not** automatically activated
- Platform admin must **approve or reject** each registration from the Platform dashboard
- On approval: school + superadmin user are activated, welcome email sent to school admin, confirmation alert sent to platform owner
- On rejection: optional reason captured, rejection email sent to school admin
- Schools remain fully registered in the database during the pending period; no data is lost if rejected and re-applied

### New — Email Notifications (`server/utils/email.js`)
- Gmail SMTP transactional email via **nodemailer** (`innolearnnetwork@gmail.com`)
- **Registration received** → school admin gets "under review" confirmation with 24-hour timeline
- **New registration alert** → platform owner gets full school details + link to Platform dashboard
- **Approval welcome** → school admin gets login URL, credentials reminder, plan info
- **Rejection notice** → school admin gets reason (if provided) + re-application instructions
- **Approval self-alert** → platform owner copy of every approval action
- All emails use a branded HTML template with InnoLearn colours, responsive layout, and status badges

### New — Platform Dashboard: Pending Approvals Tab
- New **"Pending"** sidebar item with a **live red badge count** showing pending school registrations
- Each pending school displays: name, slug, admin name + email, city, country, curriculum, sections, plan, registration timestamp
- **Approve** button — one click activates the school and triggers welcome emails
- **Reject** button — opens a modal for optional rejection reason before sending notification
- Badge auto-updates after each action; "All clear" empty state when queue is empty
- Badge count loads automatically on platform admin login

### New — Login: Demo Role Selector Panel
- Replaced flat pill buttons with a **role card grid** (6 cards: Super Admin, Teacher, Parent, Finance, Student, Deputy)
- Each card shows role icon, name, and a one-line description of that role's scope
- Clicking a card fills credentials, highlights the card, and shows a green confirmation strip
- Panel is visible on `localhost`, `?demo=1`, and `?demo=innolearn` (case-insensitive)
- Super Admin role pre-selected when landing via `?demo=innolearn`

### New — Setup Wizard for New Schools
- Super Admin dashboard shows a **setup checklist card** on first login
- 7 steps with live **% completion progress bar**: Complete school profile · Set academic year & terms · Create classes · Add teaching staff · Enroll students · Configure fee structures · Set up report templates
- Each incomplete step is clickable and navigates directly to the relevant module
- Completed steps show a green tick and strikethrough label
- "Hide for now" link dismisses the wizard (stored per school in `localStorage`); reappears if reopened
- Wizard disappears automatically when all 7 steps are complete

### Changed — Curriculum Options
- Registration wizard curriculum chips updated to **Kenya-focused list**: CBE (Competency Based Education), IB, British (Cambridge / Edexcel), American Curriculum
- Chips redesigned from inline pills to **card layout** with bold name + subtitle description
- `CURRICULUM_META` resource links updated to match: KICD (CBE), IBO (IB), Cambridge International (British), College Board AP Central (American)

### Changed — T&C Checkbox → Launch Button Gate
- **Launch My School** button starts **disabled** with 50% opacity and a hint label
- Ticking the Terms of Service checkbox **enables** the button with smooth transition
- Cannot submit the registration form without explicitly agreeing — removes the old `alert()` fallback

### Changed — Registration Success Screen
- Two distinct states after submitting registration:
  - **Server mode (normal)**: shows amber "Application Submitted ⏳" with pending review message and email confirmation note
  - **Offline/fallback mode**: shows green "You're all set! 🎉" with portal link (unchanged behaviour)

### Changed — Pending School Login Block
- When a pending school admin tries to log in, the server returns `403 { error: 'pending_approval' }`
- Frontend replaces the login form with a friendly **"Application Under Review"** screen (amber icon, clear message, check-your-email prompt)
- Rejected schools see a toast with support email contact

### Security
- `server/routes/auth.js`: login now looks up user first **without** `isActive` filter, then checks school status before returning the appropriate error — gives specific feedback for pending vs rejected vs inactive accounts rather than a generic "wrong password" message

---

## [3.1.5] — 2026-04-30  Brand Rename: SchoolSync → InnoLearn

### Changed
- **Platform rebranded from SchoolSync to InnoLearn** across all 46 source files
- Demo school renamed from "Meridian International School" to **InnoLearn International School**
- All email domains updated: `@meridian.ac.ke` / `@schoolsync.edu.ke` → `@innolearn.edu.ke`
- All slugs, DB names, package names, and internal identifiers updated to lowercase `innolearn`
- `package.json` version bumped to `3.1.5`, name set to `innolearn`
- `render.yaml` service name and APP_URL updated to `innolearn-ecosystem`
- `.env.example`, seed utility, and all documentation updated to reflect new brand

---

## [3.1.4] — 2026-04-30  Platform Admin Dashboard & Demo Pill Security

### Added
- **`/platform` — Private Platform Admin SPA** (`platform.html` + `css/platform.css`)
  - Key-based lock screen — platform owner enters their `PLATFORM_ADMIN_KEY`; key verified against `/api/platform/stats`; stored in `sessionStorage` (clears on browser close)
  - Offline mode — accepts key ≥ 8 chars when server is unreachable; shows live data when connected
  - **Overview** — 4 stat cards (Total Schools, Total Students, KES MRR, ARR); plan breakdown grid
  - **Schools table** — name, slug, plan pill, status dot, student count, staff count, trial end date
  - **Actions per school**: Log In (impersonate → injects JWT → redirects to main app), Change Plan (dropdown modal), Suspend / Reinstate
  - **Provision School** form — create a new school directly from the platform dashboard
  - All API calls carry `X-Platform-Key` header; no cookies, no JWT for platform admin layer
- **Explicit `/platform` route** in `server/index.js` — serves `platform.html` cleanly (not just via `express.static`)
- Server health version bumped to `3.1.4`

### Changed
- **Demo pills hidden from production** — `id="demo-section"` div is `display:none` by default; only revealed on `localhost`, `127.0.0.1`, or when `?demo=1` is in the URL
- `js/app.js` boot logic updated: checks hostname + URL param before showing demo section; auto-fills InnoLearn credentials if `?demo=InnoLearn`

---

## [3.1.3] — 2026-04-30  School Registration Entry Points on Login Page

### Added
- **"New to InnoLearn? Get Started" CTA** on the login page — purple/indigo gradient card between the Sign In button and the demo pills; links directly to `onboard.html`
- **"Register your school →"** link in the login page left panel footer — subtle secondary entry point for schools that land on the main page
- Both entry points ensure any school visiting the login URL has a clear, unmissable path to self-register without needing to know the `/onboard` URL directly

---

## [3.1.2] — 2026-04-30  Curriculum & Section Selection in Onboarding

### New — Curriculum Selection
- Multi-select chip UI in Step 1: Cambridge, IB, CBC (Kenya), KCSE/KCPE, CAPS (S. Africa), WAEC/NECO, Uganda (UCE/UACE), Montessori, Custom/Mixed
- **Quick resource links** appear dynamically for each selected curriculum — direct links to Cambridge International, IBO, KICD, KNEC, DBE, WAEC, UNEB, AMI
- Curriculum stored on the school record (`curriculum[]`) and shown in the Review step and Success screen
- At least one curriculum required before advancing

### New — School Sections Picker
- 4 section cards in Step 1: **KG/Pre-Primary**, **Primary**, **Secondary**, **Sixth Form/A-Level**
- Each card shows the applicable levels (e.g. "Form 1–4 · Grade 7–12 · Year 7–11")
- At least one section required — clear inline error message if skipped
- Sections stored on the school record (`sections[]`)
- Shown in Review step summary

### System Integration — Section-aware Seeding
- `server/routes/onboard.js` — `_seedBaseData(schoolId, selectedSections)` now seeds **only the sections the school selected** (not all 4 by default)
- Each seeded section stores a `sectionKey` for reliable lookups
- App's Classes, Students, Timetable, Attendance modules naturally filter to the school's sections because every class references a `sectionId` — no further changes needed downstream
- A KG-only school sees only KG in dropdowns; a Secondary-only school sees no KG or Primary

---

## [3.1.1] — 2026-04-30  Onboarding Security Hardening & Documentation Expansion

### Changed
- **School Type dropdown**: removed "Charter", added "Tuition Centre"
- **"Try the InnoLearn demo →"** link added to the onboarding page left panel

### Security — Anti-bot Measures (onboarding)
- **Honeypot field**: hidden `ob-trap` field — if filled by a bot, registration is silently rejected server-side
- **Timing check**: server rejects submissions that arrive in under 4 seconds (bots fill forms instantly)
- **Institutional email warning**: UI advisory shown if user enters a free personal email (gmail, yahoo, hotmail, etc.) — not a block, just a nudge
- **Disposable email blocklist**: 25+ known disposable/temporary email domains blocked server-side at registration
- **Rate limiting** (pre-existing): 5 registrations per IP per hour — unchanged

### Deferred (documented, not yet built)
- **reCAPTCHA v3** — invisible challenge for onboarding form
- **2FA / TOTP** — authenticator app support for Super Admin accounts
- **Email OTP verification** — verify email ownership before school is provisioned (requires SMTP config)

### Documentation — New & Updated
- **`docs/PLATFORM_ADMIN_GUIDE.md`** (NEW) — Full guide for the InnoLearn platform owner: architecture, environment setup, Render deployment, provisioning schools via API, plan management, impersonation, MRR monitoring, security hardening checklist, backup/recovery, troubleshooting
- **`docs/SCHOOL_ADMIN_GUIDE.md`** (NEW) — Full guide for each school's Super Admin / IT admin: first-time setup checklist, academic years & terms, sections, classes, subjects, staff & roles, enrollment, permissions, billing, branding, data export, demo school access
- **`docs/USER_GUIDE.md`** updated to v3.1 with cross-links to both new admin guides

---

## [3.1.0] — 2026-04-30  School Onboarding / Self-registration Flow

### New — Onboarding Wizard (`onboard.html`)
- 4-step wizard: **School Details → Admin Account → Choose Plan → Review & Launch**
- Auto-generates URL slug from school name; user can edit; real-time sanitisation
- Password strength meter (very weak → strong)
- Auto-fills short name from school name initials
- Plan selector with 4 cards (Core / Standard / Popular-badged Standard / Premium / Enterprise); pre-selects Standard
- Review page summarises all entered data with a plan badge before submission
- Terms of Service checkbox gate before launch
- Animated step progress bar + left-panel step indicator with checkmarks
- Success screen shows school name, admin email, plan, and trial end date with auto-login link
- Fully responsive — left panel collapses on mobile

### New — Server Route (`server/routes/onboard.js`)
- `POST /api/onboard` — public, rate-limited (5 registrations/IP/hour)
- Validates required fields, email format, password length (≥ 8 chars)
- Checks slug uniqueness and email uniqueness in MongoDB
- Auto-generates slug from school name if not provided
- Creates school record with country-aware currency, currency symbol, and timezone
- Creates Super Admin user with bcrypt-hashed password (12 rounds)
- Seeds base data: academic year + 3 terms, 4 default sections (KG/Primary/Secondary/A-Level), full role_permissions for all 13 roles
- Issues JWT on success; also returns a `session` payload for localStorage-mode
- **Offline mode**: if MongoDB not connected, provisions offline (localStorage-only) — no JWT issued, plain-text password (demo environments only)
- `server/index.js` updated: mounts `/api/onboard`; SPA fallback serves `onboard.html` for `/onboard` route

### New — Styles (`css/onboard.css`)
- Fully custom styles for the onboarding wizard
- Left gradient panel with active/done step indicators and connecting lines
- Plan selection cards with hover, selected, and "Most Popular" badge states
- Password strength bar with colour transitions
- Slug preview with prefix label inside the input border

---

## [3.0.0] — 2026-04-28  SaaS Backend · Multi-tenancy · Subscription Plans

### New — Node.js/Express Backend API
- `server/index.js` — Express server; serves both the API (`/api/*`) and the static frontend from a single Render web service
- `server/config/db.js` — MongoDB Atlas connection via Mongoose; graceful no-op when `MONGODB_URI` is not set (localStorage-only mode)
- `render.yaml` updated — `buildCommand: npm install`, `startCommand: node server/index.js`, health check at `/api/health`
- `package.json` — added `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `cors`, `express-rate-limit`

### New — Authentication (JWT)
- `POST /api/auth/login` — school-aware login with rate limiting (20 attempts/15 min); supports bcrypt hashed passwords with plain-text fallback during migration
- `GET /api/auth/me` — verify token and return current user
- `POST /api/auth/change-password` — bcrypt password update
- Frontend `Auth.login()` now tries server login first, falls back to localStorage if server unreachable
- JWT token stored in `localStorage`/`sessionStorage` via `DB.setToken()`/`DB.clearToken()`

### New — Multi-tenancy
- `server/middleware/tenant.js` — resolves school from JWT `schoolId`, `X-School-Slug` header, subdomain (`InnoLearn.InnoLearn.com`), or custom domain (`portal.theirschool.com`)
- Every API route auto-scopes data to the authenticated school's `schoolId`
- `server/middleware/auth.js` — JWT verification middleware + platform admin key middleware

### New — Generic CRUD API
- `server/routes/collections.js` — single router handles all collections: `GET/POST /api/collections/:col`, `PUT/DELETE /api/collections/:col/:id`, `POST /api/collections/:col/bulk`
- 25+ collections supported; all auto-filtered by `schoolId`

### New — Data Sync (Hybrid localStorage + Server)
- `GET /api/sync` — downloads all school data in one request; called on login to populate localStorage
- `POST /api/sync` — pushes entire localStorage to MongoDB (data migration tool)
- `data.js` updated: all writes mirror to server async (`_push()`); `syncFromServer()` and `pushToServer()` public API added
- Zero changes to any module — all DB calls remain synchronous via localStorage

### New — Platform Admin API
- `server/routes/platform.js` — protected by `X-Platform-Key` header
- `GET /api/platform/schools` — list all schools with student/staff counts
- `POST /api/platform/schools` — provision new school + superadmin account + base seed data
- `PATCH /api/platform/schools/:id` — change plan, addOns, status, expiry
- `POST /api/platform/schools/:id/impersonate` — get JWT for any school's superadmin (support tool)
- `GET /api/platform/stats` — MRR by plan, total schools, total students

### New — Subscription Plans & Feature Gating
- `js/modules/plans.js` — `Plans.can(module)` checks school plan against module access map
- **Core** (KES 15K/month): dashboard, students, admissions, classes, subjects, attendance, academics, exams, communication, events, reports, settings, help
- **Standard** (KES 35K/month): + timetable, behaviour
- **Premium** (KES 65K/month): + finance, hr
- **Enterprise** (custom): + lms, mobile, white-label
- Sidebar shows locked modules with 🔒 icon for non-subscribed features
- Navigating to a locked module renders a full **Upgrade Wall** with plan comparison and "Contact Sales" CTA
- Plan badge shown at the bottom of the sidebar (Core / Standard / Premium / Enterprise)
- `ROUTE_PLAN_GATE` map in `app.js` intercepts navigation to gated routes

---

## [2.7.1] — 2026-04-28  Birthday Calendar Popup

### Improved — Clickable Birthday Dots on Calendar
- **🎂 dot is now clickable** — clicking a birthday emoji on any calendar day opens a modal listing everyone who has a birthday on that date
- Modal shows: date header, each person's avatar (initials), name, role/class, and age; "Turns N! 🎉" gradient badge for today's birthdays; "Age N" for other dates
- Summary line at the bottom: "X celebrates their birthday on this day" (1 person) or "X people share this birthday" (multiple)
- Dot animates on hover (scales up) to hint interactivity; uses `event.stopPropagation()` so the day cell click does not interfere
- `Events.viewBirthdays(year, month, day)` — new public function; called inline from the calendar cell

---

## [2.7.0] — 2026-04-28  Birthday System

### New — Birthday Detection & Greetings
- **`js/modules/birthday.js`** — new `Birthday` IIFE module; automatically detects birthdays for all active students and staff
- **Own birthday modal** — when the logged-in user's birthday is today, a celebratory full-screen modal appears ~1 second after login (name, turning age with ordinal, gradient button)
- **Staff toast notifications** — admin, teacher, deputy, discipline, section_sec, and hr roles receive a toast for each other person whose birthday is today
- **Notification bell injection** — today's birthdays are prepended to the notification dropdown with a pink left-border and 🎂 icon; badge count increments
- **Dashboard birthday card** — a `Birthdays` card appears on the admin dashboard (between stats and charts) showing:
  - Today's celebrants: pink gradient avatar, name, "Turns N!" badge, role/class
  - Upcoming birthdays (next 7 days): grey avatar, countdown in days, formatted date
  - Card is hidden entirely if no birthdays today or within 7 days
- **Calendar birthday indicators** — every day cell in the Events calendar that has a birthday shows a 🎂 emoji next to the date number; hovering reveals all names

### Technical
- `Birthday.todaysBirthdays()` — returns all people whose MM-DD matches today
- `Birthday.upcomingBirthdays(days=7)` — returns people with birthdays in the next N days, sorted ascending
- `Birthday.birthdaysOnDate(year, month, day)` — used by the calendar for per-cell birthday lookup
- `Birthday.dashboardCard()` — returns full HTML string or `''` if nothing to show
- Birthday comparison uses `MM-DD` only (annual recurrence; birth year ignored)
- `_daysUntil()` handles year rollover correctly
- `Birthday.init()` called from `App._showApp()` after `_buildNotifications()`
- `SEED_VERSION` bumped to `'18'`; demo DOBs updated: Emily Johnson + Grace Kamau → Apr 27 (today); Brian Omondi → Apr 29; James Ochieng → May 1

---

## [2.6.0] — 2026-04-27  Dynamic Branding · Login Page Personalization · Immersive Login Layout

### New — Dynamic Branding (Settings → Branding, Super Admin only)
- **Logo upload** — upload PNG/SVG/JPG (max 2 MB); logo replaces the graduation-cap icon in the sidebar header; stored as base64 in `localStorage`
- **Favicon upload** — upload square image (max 512 KB); updates the browser tab icon live; stored as base64
- **App Name** — rename "InnoLearn" everywhere: sidebar header, browser title, login page brand
- **6 Quick Preset Themes** — Ocean Blue, Emerald, Violet, Rose, Amber, Cyan; one click applies primary + sidebar color pair
- **Custom Color Pickers** — independent hex + native color-picker for Primary accent and Sidebar background; live mini-preview sidebar updates in real time
- `App.applyBranding()` — called on every login; injects `<style id="ss-theme">` with derived CSS variable overrides (`--primary`, `--primary-dark`, `--primary-darker`, `--primary-light`, `--primary-glass`, `--sidebar-bg`, `--sidebar-active`)
- Color derivation: `_shadeColor(hex, amt)`, `_mixWithWhite(hex, ratio)`, `_hexToRgb(hex)` helpers in `app.js`
- Branding stored in `schools[0]`: `{ logo, favicon, appName, theme: { primary, sidebarBg } }`
- `BRANDING_UPDATED` and `BRANDING_RESET` audit entries

### New — Login Page Personalization (Settings → Branding, Super Admin only)
- **5 Canvas Animation Effects** — `Particles`, `Aurora`, `Water`, `Clouds`, `Fire`; select via visual picker; effect + color saved and applied on login screen show
- **Effect Color Picker** — custom color applied to particles / aurora waves / water layers
- **Editable Login Content**:
  - Welcome title and subtitle (right panel form header)
  - Tagline under the logo (left panel)
  - Footer copyright text (left panel)
  - All 4 feature highlight cards — title and description editable
- **Social Media Links** — Facebook, X/Twitter, Instagram, LinkedIn, WhatsApp, YouTube; blank = hidden; rendered as circular icon buttons on the left panel
- `LoginFX` IIFE (`app.js`) — canvas animation engine with `start(effect, color)` / `stop()` API; 5 independent animation loops using `requestAnimationFrame`; auto-resizes canvas on window resize
- `_applyLoginPage(school)` — called from `_showLogin()`; reads `schools[0].loginPage`; updates all DOM elements and starts `LoginFX`
- `LoginFX.stop()` called from `_showApp()` to clean up animation on login
- Stored in `schools[0].loginPage`: `{ effect, effectColor, welcomeTitle, welcomeSub, tagline, footerText, features[], social{} }`
- `LOGIN_PAGE_UPDATED` and `LOGIN_PAGE_RESET` audit entries

### Changed — Immersive Login Layout (Option B)
- **Canvas is now full-screen** — animation covers the entire login screen (both left and right halves), not just the left panel
- **Left panel is a transparent overlay** — branding content floats above the canvas; old decorative pseudo-element orbs removed
- **Sign-in form is a floating card** — white `rgba(255,255,255,0.97)` card with 22px border-radius, deep shadow, and `loginCardFloat` keyframe animation (12px vertical travel, shadow deepens as card rises to simulate real light physics)
- **Dot-grid texture** (`login-grid`) moved to full-screen direct child of `login-screen`
- Mobile (≤1024px): float animation disabled, card fills screen normally

---

## [2.5.0] — 2026-04-27  Data Integrity II · Events Bug Fix · Delete Guards · Permission Guards

### Fixed — Events Calendar
- **Events do not appear on calendar after save/update** — after saving or updating an event, the calendar now navigates to the event's month automatically (parses `startDate` string to avoid UTC timezone shift)
- **Seed events invisible** — all 10 seed event dates shifted from 2025 to 2026 to match the current academic year; `SEED_VERSION` bumped to `17`
- **Empty calendar months** — calendar view now shows a "No events in [Month]" message when a month has no events

### New — Validators: Subject & User Delete Guards
- **`Validators.canDeleteSubject(id)`** — blocks if subject is referenced in timetable slots, class–subject assignments, or grade records
- **`Validators.canDeleteUser(id)`** — blocks if user is a homeroom teacher, assigned to timetable slots, or has a linked student record; also prevents self-deletion

### New — Room Conflict Check (Timetable)
- **`Validators.timetableSlot()`** now checks room conflicts: same room, same day, same period across all classes is blocked with the name of the conflicting class

### Changed — Subject Catalogue
- **Delete subject** — admins can now delete subjects directly from the catalogue; `canDeleteSubject` guard applied; `SUBJECT_DELETED` audited
- **Hardcoded `ay2025`** in `saveAssignments()` replaced with `SchoolContext.currentAcYearId()`

### Changed — Settings: User Management
- **Delete user** — admins can delete user accounts; `canDeleteUser` guard blocks destructive deletes; self-deletion prevented; `USER_DELETED` audited

### Changed — Admissions Enrollment (Validate-First)
- `enrollStudent()` now runs three pre-flight checks **before** any DB write: class still exists, email unique, admission number unique
- `STUDENT_ENROLLED` audit entry added (applicationId, studentId, userId, admissionNo, classId)

### Changed — Permission Guards (Remaining Write Operations)
- `exams.js saveExam()` — `exams.create` permission required; hardcoded `ay2025` replaced with `SchoolContext.currentAcYearId()`; `EXAM_CREATED` / `EXAM_UPDATED` audited
- `exams.js deleteExam()` — `exams.delete` permission required; uses `confirmAction()` instead of native confirm; `EXAM_DELETED` audited
- `classes.js save()` — `isAdmin()` check enforced in logic; `CLASS_CREATED` / `CLASS_UPDATED` audited; null guard on optional homeroomTeacherId

---

## [2.4.0] — 2026-04-27  Data Integrity — Validators · ENUMS · Guards · Timetable Integrity

### New — ENUMS Constant (`data.js`)
- `ENUMS` object (frozen) defines the canonical value set for every status/type field in the system
- Covers: `studentStatus`, `incidentType`, `appealStatus`, `invoiceStatus`, `attendanceStatus`, `applicationStatus`, `gender`, `paymentMethod`, `userRole`, `examStatus`, `leaveStatus`, `payrollStatus`
- Single source of truth — no more inline string literals for statuses

### New — Central Validators (`js/validators.js`)
- New file loaded immediately after `data.js`, before all modules
- Every validator returns `null` (valid) or a human-readable error string (invalid) — never throws
- **`Validators.student(data, id)`** — required fields, status enum, classId FK, unique admissionNo
- **`Validators.user(data, id)`** — required fields, role enum, unique email
- **`Validators.cls(data, id)`** — required fields, sectionId FK, homeroomTeacherId FK, unique class name per section
- **`Validators.timetableSlot(slot, ttId, editDay, editPeriod)`** — subjectId FK, teacherId FK, teacher double-booking (BLOCKS, not just warns)
- **`Validators.payment(amount, invoice)`** — amount positive, invoice exists, invoice not already fully paid
- **`Validators.incident(data)`** — studentId FK, type enum
- **`Validators.canDeleteStudent(id)`** — blocks if open appeals or unpaid invoices
- **`Validators.canDeleteClass(classId)`** — blocks if students enrolled or timetable entries exist
- **`Validators.canDeleteYear(id)`** — blocks if current year or classes linked to it
- **`Validators.canDeleteSection(sectionId)`** — blocks if classes exist in section

### Changed — Write Sites (Referential Integrity + Validation)
- `students.js save()` — now calls `Validators.student()` before DB write; replaces old ad-hoc checks
- `students.js deleteStudent()` — now calls `Validators.canDeleteStudent()`: blocks on open appeals **and** unpaid invoices
- `settings.js saveUser()` — now calls `Validators.user()` before DB write; catches duplicate emails
- `settings.js saveGradeClass()` — now calls `Validators.cls()` before DB write; catches duplicate class names per section
- `settings.js deleteYear()` — now calls `Validators.canDeleteYear()`: also blocks if classes are linked
- `settings.js deleteSection()` — now calls `Validators.canDeleteSection()`
- `settings.js deleteClass()` — now calls `Validators.canDeleteClass()`: also blocks if timetable entries exist; cascades timetable cleanup on confirmed delete
- `finance.js savePayment()` — now calls `Validators.payment()` before DB write; blocks recording on already-paid invoices
- `behaviour.js saveIncidentNew()` — now calls `Validators.incident()` to verify student exists before logging
- `timetable.js saveSlot()` — teacher double-booking now **blocks** save (previously only warned); subject and teacher FK integrity verified; uses `SchoolContext` for new timetable records

### Changed — Permission Enforcement on Writes
- `finance.js savePayment()` — permission check: `finance.create` required
- `behaviour.js saveIncidentNew()` — permission check: `behaviour.create` required
- `settings.js setCurrentYear()` — restricted to admin/superadmin roles in logic (not just UI)

### Changed — Audit Before/After
- `PAYMENT_RECORDED` now includes `before: { paidAmount, balance, status }` and `after: { paidAmount, balance, status }`
- `APPEAL_RESOLVED` now includes `before: { appealStatus, incidentStatus }` and `after: { appealStatus, incidentStatus }`

### Changed — Test Layer (8 new suites)
- `_testENUMS()` — verifies ENUMS exists, is frozen, and contains expected values
- `_testValidators()` — 20+ checks: rejection of invalid data, acceptance of valid data, FK checks, duplicate detection, delete guard checks

---

## [2.3.0] — 2026-04-27  Architecture Phase B · Audit Log · Guards · Tests

### New — Audit Log System
- Global `_audit(action, details)` function added to `app.js`
- Writes immutable entries to the `audit_log` localStorage collection
- **Never blocks** the primary action — errors are swallowed with a `console.warn`
- Five critical operations now produce audit entries:
  - `STUDENT_UPDATED` — student profile edit (includes changed field diff for classId, status, houseId)
  - `STUDENT_DELETED` — student removal (preserves name, admissionNo, classId)
  - `PAYMENT_RECORDED` — finance payment (amount, method, reference, new balance, new status)
  - `APPEAL_RESOLVED` — behaviour appeal accepted/rejected/escalated (includes student name, outcome, resolution note)
  - `ACADEMIC_YEAR_CHANGED` — when admin sets the current academic year
  - `ACADEMIC_YEAR_DELETED` — when an academic year is deleted
  - `PERMISSION_CHANGED` — each individual role permission checkbox toggle

### New — Critical Operation Guards
- **Delete Student**: now blocked if the student has any open appeals (pending or escalated) — must resolve appeals first
- **Delete Academic Year**: already guarded (cannot delete current year) — unchanged; audit log now also fires on deletion
- **Delete Class**: already guarded (cannot delete if students enrolled) — unchanged

### New — Browser Test Layer (`js/tests.js`)
- `InnoLearnTests.run()` — callable from browser console at any time
- Auto-activates when the URL includes `?tests=1`
- Six test suites: DB Layer · SchoolContext · Global Utilities · Seed Data Integrity · Audit Log · Behaviour Module
- Uses `console.assert` — failures print to console without crashing the app
- Summary toast at the end: `✓ N passed` or `✗ N failed — see console`
- Test file loaded after `app.js` in `index.html`

---

## [2.2.0] — 2026-04-27  Architecture Phase A · Core Utilities

### New — SchoolContext Helper (`data.js`)
- `SchoolContext` IIFE added immediately after DB initialisation
- API: `school()` · `currentTermId()` · `currentAcYearId()` · `currentTerm()` · `currentAcYear()`
- Single source of truth for the live school record, active term, and active academic year
- Replaces all hardcoded `|| 'term2'` and `|| 'ay2025'` fallbacks across every module

### New — Global Utility Functions (`app.js`)
- **`assert(condition, message)`** — throws a descriptive `Error` if `condition` is falsy; logs to console. Use before `DB.insert` / `DB.update` to surface bad data immediately.
- **`safe(fn, label)`** — wraps any UI action handler; catches unexpected errors and shows a user-friendly toast instead of silent failures or crashes.
- **`isOverlapping(aStart, aEnd, bStart, bEnd)`** — returns `true` when two HH:MM time ranges overlap (exclusive boundary: ranges that touch but don't overlap return `false`). Used for clash detection in timetable and scheduling logic.

### Changed — Dynamic Export (`settings.js`)
- `exportData()` no longer maintains a hardcoded list of collection names
- Now dynamically scans localStorage for all `ss_` prefixed keys and exports every collection automatically — new collections added in future versions are included without requiring a code change

### Removed — Dead Code
- `js/modules/teachers.js` deleted — this file was never loaded (`teachers` route was already redirected to `HR.render()` in `app.js`); `Teachers` object was unused

### Fixed — Hardcoded Fallbacks
- All `Auth.currentSchool?.currentTermId || 'term2'` and `Auth.currentSchool?.currentAcademicYearId || 'ay2025'` fallbacks replaced with `SchoolContext.currentTermId()` / `SchoolContext.currentAcYearId()` in:
  - `behaviour.js` — `_dashboardView`, `_registerView`, `_appealsView`, `saveIncident`, `saveIncidentNew`, `generateReport`
  - `academics.js` — state initialisation (`_selectedTerm`, `_selectedAcYear`, `_lpTerm`, `_lpYear`, `_rptTerm`, `_rptYear`)
  - `classes.js` — `saveClass`
  - `settings.js` — `saveGradeClass`

---

## [2.1.1] — 2026-04-27  Log Modal Class Filter

### Changed — Log Incident Modal
- Added **Filter by Class** dropdown above the Student field in the log modal
- Student list automatically narrows to only students in the selected class; selecting a different class resets the student selection
- A live count label shows how many students are in the selected class (e.g. "12 students in Grade 9B")
- Choosing "All Classes" restores the full role-scoped student list
- Class and date selections are both preserved across type/category/behaviour changes in the same modal session

### Confirmed — House Points Flow
- Logging any incident automatically updates the House Cup: merit incidents add `+pts` to the student's house total; demerit incidents subtract `−pts`
- The `housePoints` field is saved per incident and summed by `_housePts()` across all students in each house for the selected period
- House Cup standings on the dashboard reflect the change immediately on the next render

---

## [2.1.0] — 2026-04-27  Behaviour Category System · Guided Log Modal

### New — Pre-seeded Default Behaviour Categories
- Eight SAA BPS v2 matrix groups are now pre-seeded as **default categories** in `behaviour_settings.categories` (SEED_VERSION 15 → 16):
  - Classroom & Academic · Corridors & Common Areas · Sports, PE & Extracurricular
  - Interpersonal Relationships · School Rules, Safety & Property · Dining Hall & Shared Spaces
  - Digital Citizenship & Technology · Leadership & Community Service
- Each category carries an `icon`, `color`, `matCat` (links to matrix items), and `isDefault` flag
- Admin can **rename, recolour, or delete** any category from **Settings → Behaviour → Categories**
- Admin can **add custom categories** with a fixed point value (applied as +pts for merit / −pts for demerit)

### Changed — Log Incident Modal (Guided 3-Step Flow)
- **Removed**: Source toggle (Standard Matrix / Custom Category) — category selection now replaces it
- **New flow**: `Step 1 — Type (Merit / Demerit)` → `Step 2 — Category` → `Step 3 — Behaviour`
- Step 2 shows all categories as a visual 2-column grid with icons, colours, and live item counts for the selected type
- Step 3 automatically shows **only the behaviours matching the selected type** within the chosen category
  - Matrix-backed categories: scrollable item list with search, locked point values, selected item preview card
  - Custom categories: fixed point value display only (no item list needed)
- Selecting a different type (Step 1) or category (Step 2) resets the behaviour selection without losing the student/date
- `Leadership & Community Service` shows "No demerit behaviours" when Demerit is selected (correct — matrix has no demerits for this group)

### Changed — Settings → Categories Panel
- Categories panel redesigned: single unified table (no longer split into Merit / Demerit columns)
- Columns: Category (icon + name + default badge) · Linked To (Standard Matrix or Custom) · Merits (item count or fixed pts) · Demerits (item count or fixed pts) · Actions
- Edit modal for matrix-backed categories shows an informational note and excludes the "fixed points" field (points are set per item in the matrix)
- Edit modal for custom categories includes a "Fixed Points" field

### Technical
- `_logState` simplified: `source`, `matCat`, `customCatId` removed; replaced by single `catId` field
- New public function `Behaviour._logSetCat(catId)` — replaces `_logSetSource` and `_logSetGroup`
- `_logSetSource`, `_logSetGroup`, `_logSetCustomCat` converted to legacy no-ops for backward compat
- `saveIncidentNew()` path detection now uses `selCat.matCat` (matrix) vs `selCat.customPoints` (custom)
- Fixed: matrix item `pts` field now correctly read as `item.pts || item.points` throughout modal

---

## [2.0.0] — 2026-04-26  Behaviour System v2 · Extended Roles · House Overhaul

### New — Roles
- Added `deputy_principal` role with full behaviour oversight and appeal escalation rights
- Added `discipline_committee` role for disciplinary panel membership
- Added demo login pills for both new roles on the login screen

### New — House System Overhaul
- Four official houses: **Impala** (Yellow), **Simba** (Red), **Twiga** (Green), **Chui** (Blue)
- House IDs changed from `h1–h4` to semantic IDs (`yellow`, `red`, `green`, `blue`)
- Houses carry `bg`, `border`, and `badge` fields for consistent UI theming
- House assignment added to the **Admissions approval** workflow
- House shield badge, avatar tint, and info panel added to **Student profiles**
- House column added to **Students list** table
- House dropdown added to **Student edit modal**

### New — Behaviour Module v2 (Phase 1: Foundation)
- Period filter pills on Dashboard and Register: **Weekly / Monthly / Termly / All Time**
- **Register** tab replaces old "Incidents" tab; legacy `#incidents` hash redirects automatically
- **Appeals** tab added (placeholder with live pending-count badge in tab header)
- Incident `status` field introduced: `active` | `appealing` | `overturned`
- Status column added to Register table with filter (All / Active / Under Appeal / Overturned)
- All incident display updated to use `note` field (with `description` fallback for legacy data)
- `saveIncident()` now saves `status: 'active'` and `createdAt` timestamp

### New — Behaviour Module v2 (Phase 2: Log Modal)
- Old simple dropdown log modal replaced with dual-source modal
- **Standard Matrix** source: browse 120+ locked SAA BPS v2 behaviours across 8 categories
  - Categories: Classroom & Academic, Corridors & Common Areas, Sports/PE/ECA, Interpersonal, School Rules, Dining Hall, Digital Citizenship, Leadership & Community Service
  - Group tabs on left, scrollable item list on right, live search across all categories
  - Points auto-fill and lock on selection; preview card shows selected behaviour
- **Custom Category** source: admin-created categories with free-point entry (unchanged)
- **Serious Incident Note**: any incident with `|points| ≥ seriousIncidentThreshold` (default 5) blocks submission until a detailed note is typed
- Modal state persists across inner refreshes (student/date selections survive type/source/group changes)

### New — Behaviour Module v2 (Phase 3: Appeals System)
- Full 3-layer appeals workflow:
  1. **Student** submits appeal against any active demerit (one appeal per incident)
  2. **Staff** (teacher / section_head / deputy / discipline) reviews and accepts, rejects, or escalates
  3. **Parent** can add a supporting note to any pending appeal for their child
- Incident status lifecycle: `active` → `appealing` (on submit) → `overturned` / `active` (on resolution)
- `behaviour_appeals` DB collection stores full audit trail (reason, parent note, resolution, resolved-by, timestamp)
- Escalation restricted to `deputy_principal`, `discipline_committee`, `admin`, `superadmin`
- Student view: "My Appeals" table + "Eligible to Appeal" list with Appeal buttons on each active demerit
- Parent view: child's appeals with Add/Edit Note buttons + resolved appeals history

### New — Behaviour Module v2 (Phase 4: Dashboard Enhancements)
- **Stage Alerts panel**: all students currently at a demerit stage (half-term window), sorted by stage descending
- **Persistent Behaviour Patterns panel**: same `behaviourId` logged ≥ 2 times in the selected period; shows student, behaviour label, count badge, last date
- `_getCurrentStage()` updated to respect `cfg.demeritWindow`: uses rolling half-term window (`halfTermWeeks`, default 7) when set to `'halfterm'`
- At-risk student list on dashboard now uses half-term demerit window (consistent with stage thresholds)

### New — Behaviour Module v2 (Phase 5: PDF Report + Settings)
- **Generate Report** button in page header (visible to staff with `_canSeeAll()` permission)
- Printable PDF report opens in new window; auto-triggers `window.print()`. Sections:
  - Summary stats (5 KPI boxes)
  - House Cup standings with colour bars
  - Stage Alerts table
  - Persistent Patterns table (up to 20 rows)
  - Full Student Behaviour Summary (new print page)
  - Staff Activity log
- **Settings → Behaviour Matrix** tab: read-only browser of all 120 standard items, grouped by category, with live type filter + search. Locked items cannot be edited or deleted.

### Updated — Seed Data (SEED_VERSION 14 → 15)
- `behaviour_settings` completely replaced:
  - `demeritWindow: 'halfterm'`
  - `seriousIncidentThreshold: 5`
  - `matrix`: 120+ items with locked SAA BPS v2 point values
  - Milestones: Bronze (25), Silver (50), Gold (100), Principal's Award (200), Platinum KS5-only (300)
  - Stages: 5 levels at 5 / 10 / 20 / 35 / 50 cumulative demerit pts
  - Houses: Impala / Simba / Twiga / Chui with semantic colour IDs
- `behaviour_incidents` seed updated: uses `behaviourId`, `note`, `status: 'active'`
- `behaviour_appeals` collection added (empty seed)
- Student house assignments applied via `_houseMap` post-seed

---

## [1.8.0] — Behaviour Module v1

### New
- **Behaviour & Pastoral** module added to sidebar
- Merit and demerit incident logging with admin-configurable categories
- **House Cup**: school houses compete for points; standings shown on dashboard
- **Merit Milestones**: threshold-based achievement badges awarded automatically on logging
- **Demerit Intervention Stages**: escalating response levels triggered by cumulative points
- **Detention scheduling**: create, track, complete, and cancel detention sessions
- Automated parent notifications on milestone achievement and stage crossing
- At-risk students panel and top merit earners leaderboard on dashboard
- Settings sub-tabs: Categories, Merit Milestones, Demerit Stages, Houses, Key Stages, Detention Types

---

## [1.7.0] — Settings & Permissions

### New
- **Settings** module with school-wide configuration
- Granular role-based permission system (`role_permissions` DB table)
  - Per-module, per-action controls (view / create / edit / delete)
  - Sub-module granularity (e.g. `behaviour.appeals`, `finance.invoices`)
- Multi-section school support: KG, Primary, Secondary, A-Level sections configurable
- Academic Year and Term management (dates, current term pointer)
- Key Stages configuration (grade groupings for analytics)
- Role management and user permission overrides

---

## [1.6.0] — HR & Staff Management

### New
- **HR & Staff** module replacing the earlier standalone Teachers page
- Staff profiles: personal details, employment type, subject assignments, homeroom class
- Contract and employment date tracking
- Department and role assignment
- Teachers route (`#teachers`) redirected to HR module for backward compatibility

---

## [1.5.0] — Communication & Events

### New
- **Communication Hub**: internal messaging between staff, parents, and students
- Role-scoped message visibility (teachers see class-related messages; parents see their children's)
- Notification system wired to topbar bell icon with unread badge
- **Events & Calendar** module: school-wide and class-specific events
- Calendar grid view with event creation and detail modals

---

## [1.4.0] — Financial Management

### New
- **Finance** module: fee structures, invoice generation, payment recording
- Per-student invoice tracking (paid / partial / overdue status)
- Payment history and receipt generation
- Financial dashboard: outstanding balances, collection rate, recent transactions
- Overdue alerts with automated notification hooks

---

## [1.3.0] — Admissions Pipeline

### New
- **Admissions** module: application intake, stage-based pipeline management
- **Public application form** accessible at `#apply/<token>` without login — shareable URL
- Admissions stages: Inquiry → Application → Review → Interview → Decision → Enrolled
- Approval workflow: approve application → auto-create student record with class and year group
- Application detail view with document checklist and status history

---

## [1.2.0] — Academic Progress & Assessment

### New
- **Academics / Gradebook**: marks entry per subject per student, weighted grade computation
- Cambridge and IB grade boundary support alongside custom percentage grading
- **Exams** module: exam creation, scheduling, invigilator assignment, result recording
- **Reports & Analytics**: term report generation, class performance breakdowns, subject analysis

---

## [1.1.0] — Academic Infrastructure

### New
- **Subjects & Curriculum**: subject creation with Cambridge/IB/custom curriculum tagging
- Subject assignment to classes and key stages
- **Timetable**: period-based weekly schedule builder
  - Drag-and-drop slot assignment (subject, teacher, room)
  - Clash detection across teachers and rooms
- **Attendance**: daily class registers
  - Present / Absent / Late / Excused status per student
  - Attendance percentage calculation and trend tracking
  - Bulk mark-present functionality

---

## [1.0.0] — Foundation Release

### New
- **App shell**: responsive sidebar, collapsible on mobile, topbar with search and notifications
- **Authentication**: email/password login, remember-me, demo credential pills (8 roles)
  - Roles: superadmin, admin, teacher, parent, student, finance, section_head
  - JWT-style session stored in localStorage
- **Hash-based routing**: `#route/param` pattern; back-button aware
- **Modal system**: stacked modals with overlay, size variants (sm / md / lg)
- **Toast notifications**: success / warning / error / info with auto-dismiss
- **Dashboard**: school KPI cards, recent activity feeds, quick-action buttons
- **Students**: full student profiles (personal, academic, guardian, medical), enrollment management, admission number generation
- **Classes & Sections**: class creation, section grouping (KG / Primary / Secondary / A-Level), homeroom teacher assignment
- Seeded demo data: 20 students, 6 teachers, 4 sections, sample academic year and terms
- Global search (students by name or admission number)
- Role-filtered sidebar navigation (modules visible based on permissions)
