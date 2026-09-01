# Role Architecture Audit — 2026-08-31

Requested after a live report: an admin set a teacher's HR "Staff Type" to
Deputy Principal, then edited Deputy Principal's permissions under Settings →
Roles & Permissions, and the teacher's actual access didn't change. This
audit traces every field in the codebase that looks like "role" to a school
administrator, answers the 14 questions asked, verifies the answers against
the real running code (not just by reading it), and proposes — but does not
implement — naming fixes.

**No application code was changed to produce this document.** Every claim
below was either read directly from the source (cited by file:line) or
proven by executing the real, unmodified `rbac.js` / `settings.js` functions
against fake data in an isolated script — see "Verification" at the end.

---

## 1. The field inventory

Seven distinct fields carry some notion of "role." They are not aliases of
each other — each is a separate value, in a separate collection, read by
separate code, for a separate purpose.

| # | Field | Collection | Who edits it, where | What it actually governs |
|---|---|---|---|---|
| 1 | `staffType` | `teachers` | HR → Add/Edit Staff Member, "Staff Type / Job Title" | **Nothing enforced.** HR record label only. |
| 2 | `role` / `roles[]` | `users` | Settings → Users → Role dropdown | **The only field RBAC reads.** Determines which `role_permissions` document applies. |
| 3 | `role_permissions.permissions` (keyed by `roleKey`) | `role_permissions` | Settings → Roles & Permissions → **Global (By Role)** | The V/E/D grant set for everyone whose `users.role` equals that `roleKey`. |
| 4 | `role_permissions.permissions` (keyed by `userId`) | `role_permissions` | Settings → Roles & Permissions → **Per User** | A per-person override merged on top of #3. |
| 5 | `custom_roles` | `custom_roles` | Settings → Roles & Permissions → "+ New Role" | Defines an additional selectable value for field #2, with its own #3 document. |
| 6 | `extraRoles[]` | `teachers` | HR → Add/Edit Staff Member, "Roles & Responsibilities" checkboxes | A narrow, separate authorization channel — see §5. Does **not** touch `role_permissions` at all. |
| 7 | `sectionAssigned` | `users` | Classes → Sections → assign a Section Head | Which section's data a `section_head`-role user can see. Independent of both `role` and `staffType`. |

None of these is "just UI text" duplicating another — each is read by different code for a different decision. That's the honest answer to the meta-question: **the system has seven ids, not one role wearing different labels.**

---

## 2. Full trace: creation, change, display, resolution, enforcement

### 2a. `teachers.staffType` — HR job title

- **Created/changed:** [StaffFormModal.jsx:223](client/src/pages/hr/StaffFormModal.jsx:223) (HR form) → `PUT/POST /api/teachers`.
- **Displayed:** HR staff list/cards, via `roleLabelMap` built in [HRPage.jsx:759-760](client/src/pages/hr/HRPage.jsx:759).
- **Resolved/enforced:** nowhere. Confirmed by direct search — `rbac.js` contains zero references to `teachers` or `staffType` (verified below, not just asserted).
- **One-directional sync exists:** changing `users.role` via Settings → Users **writes back** into `teachers.staffType` as a "courtesy label" — [settings.js:813-817](server/routes/settings.js:813). The reverse never happens. This was a **deliberate fix**, not an oversight — see the code's own account:

  > *"an HR edit here used to silently grant system access too, which was a real privilege-escalation risk (see `staff-role-separation.test.js`) and was fixed."* — [StaffFormModal.jsx:230-233](client/src/pages/hr/StaffFormModal.jsx:230)

  The disclaimer sits right under the dropdown in the product today: *"This is their job title for HR records — it does not change what they can access."* It's correct and it's already there — it's just a 10px gray caption, not a warning that fires after the fact.

### 2b. `users.role` / `roles[]` — the actual RBAC identity

- **Created:** on invite/login-creation. Validated against one shared allowlist, `role-validation.js`'s `SYSTEM_ROLES` — this file exists specifically because three separate routes used to each maintain their own drifting copy of this list ([role-validation.js:1-23](server/utils/role-validation.js:1)).
- **Changed:** [settings.js:754](server/routes/settings.js:754) `PUT /users/:id`. On change it also: revokes the user's tokens immediately (forces re-login with the new role), invalidates their scope cache, cascades the courtesy label to `teachers.staffType`, and writes an audit log entry.
- **Displayed:** Settings → Users table "Role" column; role badges/pills throughout.
- **Resolved/enforced:** this is the field `rbac.js` reads. `req.jwtUser.role` comes from the signed JWT, set once at login by `_buildTokenPayload()` — [auth.js:93-102](server/routes/auth.js:93) — and does **not** update mid-session; that's why the token-revocation-on-role-change matters (§2b above forces a fresh JWT immediately rather than waiting up to 8h for natural expiry).

### 2c. `role_permissions` (role-keyed) — Global (By Role)

- **Edited:** [SettingsPage.jsx:3639](client/src/pages/settings/SettingsPage.jsx:3639) `RolesTab`, mode `'role'`. Saved via `PUT /settings/school` with the whole `modulePermissions` object.
- **Synced server-side:** [settings.js:302-329](server/routes/settings.js:302) — for every role key present in the saved `byRole` map, translates the V/E/D grid into `{module: [actions]}` via `_deriveApiPerms()` and upserts a `role_permissions` document `{schoolId, roleKey}`. Then busts `rbac.js`'s 5-minute cache (`invalidatePermCache`).
- **This part is correctly wired.** Editing "Deputy Principal" here genuinely does update the one document every `deputy_principal`-role user's permissions are read from, immediately (after cache bust).

### 2d. `role_permissions` (user-keyed) — Per User — **critical bug found**

- **Edited:** same `RolesTab`, mode `'user'`. `toggle()` at [SettingsPage.jsx:3770-3793](client/src/pages/settings/SettingsPage.jsx:3770) only ever writes the **one specific `module__sub` key that was clicked** into `perms.byUser[selUser]` — it never back-fills the rest of that person's modules.
- **Synced server-side:** [settings.js:333-354](server/routes/settings.js:333) runs that same sparse object through the identical `_deriveApiPerms()` used for whole-role definitions.
- **The bug:** `_deriveApiPerms()` is correct and *intentionally* strict for whole-role definitions — its own test suite pins this: *"every registered module key is always present, even with no cells at all (empty array, not missing)"* ([derive-api-perms.test.js:39-43](server/__tests__/derive-api-perms.test.js:39)). That's the right behavior for a role, which is meant to be a complete definition. It is the **wrong** behavior for a per-user override, which is meant to be a *delta*. Since the same function is reused unmodified for both, the per-user document that gets written contains an explicit empty `[]` for every module the admin didn't touch in that session.
- **At merge time**, `rbac.js` does a shallow per-module replace — `{...rolePerms, ...userPerms}` ([rbac.js:124](server/middleware/rbac.js:124)) — so those explicit empty arrays **overwrite**, not supplement, the role's grants.
- **Net effect, proven below:** the instant an admin sets *any* single Per-User override for someone, that person silently loses their role-inherited access to *every other module* — not a permissions tweak, a near-total lockout. This has nothing to do with the Deputy Principal report specifically (no per-user override was involved there), but it's the most severe thing this audit turned up and it directly bears on "does Per User actually work as a targeted override" (it does not, currently).
- There is no existing test exercising the per-user sync path end-to-end — the gap shipped invisibly because the only test file covering `_deriveApiPerms()` only checks the role-level semantics it correctly pins.

### 2e. `custom_roles` — "+ New Role"

- **Created:** [settings.js:1280](server/routes/settings.js:1280) `POST /settings/custom-roles`. Derives a snake_case `key` from the label, rejects it if `BUILT_IN_ROLE_KEYS` already claims it, copies a base role's starting permissions, and creates both a `custom_roles` doc and a fresh `role_permissions` doc for the new key.
- **Gap found:** `BUILT_IN_ROLE_KEYS` ([settings.js:1260-1268](server/routes/settings.js:1260)) is missing `front_office` and `principal` — both of which *are* real, reserved concepts elsewhere in the client (`BUILT_IN_STAFF_ROLES` in [HRPage.jsx:26-38](client/src/pages/hr/HRPage.jsx:26) includes `front_office`; `principal` is a real `SYSTEM_ROLES` entry in both `role-validation.js` and the client). A custom role can currently be created with either key, producing exactly the duplicate "Front Office" dropdown entry from the earlier screenshot — and, worse, a custom role literally keyed `principal` would collide with the real system role's `role_permissions` document. This is the mechanism behind the duplicate; per your instruction it is **not fixed here**.

### 2f. `extraRoles[]` — "Roles & Responsibilities"

- **Edited:** HR form checkboxes, validated against `school.staffResponsibilities` (customizable per school) union six built-in defaults — `_validateExtraRoles()` at [teachers.js:86](server/routes/teachers.js:86).
- **Reaches enforcement via a completely separate path than `role_permissions`:** copied onto the JWT at login only (not live-refreshed mid-session) — [auth.js:131-141](server/routes/auth.js:131) — matched to the teacher record by `userId` OR `email`.
- **Consumed in exactly three route files** — `teaching-assignments.js`, `lessons.js`, `weekly-snapshots.js` — each builds an "effective roles" set of `{role, ...roles, ...extraRoles}` and checks membership directly, e.g. [teaching-assignments.js:48-69](server/routes/teaching-assignments.js:48): an `hod` extraRole grants department-scoped assignment management; a `deputy`/`principal` extraRole grants unrestricted management **on that one route only**.
- **This does not touch the V/E/D permission grid at all.** A teacher with the "Deputy Principal" checkbox ticked under Roles & Responsibilities gets elevated access on three specific routes — not Finance, not HR, not Reports, not anything editable in Settings → Roles & Permissions. This is a third, narrower meaning of "Deputy Principal," legitimately different from both #1 (HR label) and #2/#3 (RBAC role).
- Notably, the "Deputy Principal" checkbox's internal `value` is literally `deputy` ([SettingsPage.jsx:801](client/src/pages/settings/SettingsPage.jsx:801), [HRPage.jsx:44](client/src/pages/hr/HRPage.jsx:44)) — the *legacy* key, not `deputy_principal`. Coincidentally consistent with how the three consumer routes check for it, but it means the extraRoles value and the RBAC role value for "the same" real-world title are two different strings by design.

### 2g. `users.sectionAssigned` — Section Head

- **Edited via cascade**, not directly: [sections.js:78](server/routes/sections.js:78) `_cascadeSectionHead()`, triggered when a section's `sectionHeadId` changes.
- **This is the one place in the codebase that already does what the Deputy Principal case needed and didn't get:** it actively warns the admin, in the response, the moment there's a mismatch —

  > *"This person's system role is 'X', not Section Head — they won't see section-scoped data until their role is changed in Settings → Users."* — [sections.js:112-113](server/routes/sections.js:112)

  This is the right pattern. It just isn't applied to the HR staffType flow, where the equivalent warning would have caught this exact report at the moment of the mistake.

---

## 3. Answers to your 14 questions

1. **Which field is authoritative for RBAC?** `users.role` (and `users.roles[]`), full stop. Nothing else — not `staffType`, not `extraRoles` — feeds `role_permissions` lookups.
2. **Which fields are purely HR/job-title?** `teachers.staffType`. `extraRoles[]` is *also* not RBAC-grid-relevant, but it isn't purely cosmetic either — see #4.
3. **Can staffType say Deputy Principal while role stays Teacher?** Yes, and this is exactly what happened in your report. Proven mechanically in §6.
4. **Can someone have multiple operational responsibilities without changing their primary role?** Yes, by design, via `extraRoles[]` — e.g. a `teacher` who is also `hod` for Science gets department-scoped assignment rights without becoming a different system role. It's real and legitimate, but it only reaches three specific routes, not the general permission grid.
5. **How do extraRoles, custom roles, and per-user overrides interact with `users.role`?** They don't interact with each other. `extraRoles` is checked directly against the JWT in three routes. Custom roles are just additional valid values `users.role` can hold, each with its own `role_permissions` doc. Per-user overrides layer on top of whatever `role_permissions` doc `users.role` currently points to (merge shown in §2d/§6) — but see the bug in §2d.
6. **What happens when a role is renamed?** There's no migration step. `deputy` → `deputy_principal` was renamed by adding the new key everywhere and keeping `deputy` alive only as a fallback (§7). Any account still literally holding the old key keeps working via that fallback — *unless* a stale `role_permissions` document for the old key still exists, in which case it silently wins over the fallback (proven in §6). No tooling exists to detect or migrate such stale documents.
7. **Are legacy aliases still actively resolved?** Yes — `rbac.js`'s `ROLE_ALIASES = { deputy: 'deputy_principal' }` ([rbac.js:56](server/middleware/rbac.js:56)) falls back live on every request that finds no `deputy`-keyed doc. It is not selectable anywhere in the current UI (`SYSTEM_ROLES` in [SettingsPage.jsx:1788](client/src/pages/settings/SettingsPage.jsx:1788) explicitly excludes it — *"does NOT appear in the UI"*), so the only way a live user holds it today is a pre-rename account, `role-validation.js` still technically accepting it as valid input, or manual data entry.
8. **Can a custom role reuse a reserved key?** Yes for `front_office` and `principal` specifically — confirmed gap in `BUILT_IN_ROLE_KEYS`, §2e.
9. **Settings → Users role change — what exactly happens?** In order: validates against the shared allowlist → writes `users.role`/`roles[]` → cascades `teachers.staffType` (courtesy label) → revokes all outstanding tokens for that user (forces immediate re-login with the new role) → invalidates their scope cache under every id form → audit-logs the change. Full trace: [settings.js:754-822](server/routes/settings.js:754).
10. **Global (By Role) change — who is affected?** Every user whose `users.role` literally equals that `roleKey`, the moment the 5-minute permission cache is busted (which the save does immediately — no waiting).
11. **Per User merge mechanics.** Intended design: role grant as the base, user's saved override replacing individual module keys on top. Actual behavior: because the saved override document always has every module populated (empty for untouched ones), it replaces the *entire* role grant, not just the touched keys. See §2d and §6, Claim E.
12. **Does staffType ever affect access anywhere? Every code path checked.** No. Grepped the entire `server/` tree for any RBAC/scope-relevant read of `staffType` — the only two writers are the HR form and the courtesy-cascade from #9; no route conditions any authorization decision on it.
13. **Does an RBAC role change update the HR representation, or are they independent?** One-directional: role → staffType, always, automatically, on every Settings → Users role save. staffType → role: deliberately never, since the security fix referenced in §2a.
14. **Every UI surface where "Role" appears, and whether it means the same thing:**

    | Surface | Field it actually edits/shows | Same as others? |
    |---|---|---|
    | HR → Add/Edit Staff, "Staff Type / Job Title" | `teachers.staffType` | No — cosmetic |
    | HR → "Roles & Responsibilities" checkboxes | `teachers.extraRoles[]` | No — narrow route-level grants |
    | HR → Staff detail panel, "Roles" badge row | `teachers.extraRoles[]` | Same as above |
    | Settings → Users, "Role" column/dropdown | `users.role` | **This is the real one** |
    | Settings → Roles & Permissions → Global (By Role) | `role_permissions` (roleKey) | Governs #3 above |
    | Settings → Roles & Permissions → Per User | `role_permissions` (userId) | Overrides the above — currently buggy, §2d |
    | Settings → Roles & Permissions → "+ New Role" | `custom_roles` + new `role_permissions` doc | New value for `users.role` |
    | Classes → Sections → head assignment | `users.sectionAssigned` | Independent field entirely |

    Five different fields, all reachable through a screen or label containing the word "Role."

---

## 4. The two scenarios

### Hiring John as Deputy Principal

Today's actually-correct sequence, and the one place each step lives:

1. **HR → Add Staff Member.** Fill in his profile. Set "Staff Type / Job Title" to Deputy Principal — this is for HR records and staff listings only; note it does nothing for access yet.
2. **HR → "Create Login Account"** (or Settings → Users → Invite, if not going through an existing staff record) to give him a login, if he needs portal access.
3. **Settings → Users → find John → Role → Deputy Principal.** This is the step that actually matters. It fires a token revocation (he'll need to log in again) and cascades his staffType label to match, so step 1 and this step end up in sync going forward.
4. **(Optional) HR → "Roles & Responsibilities"** — tick anything additional he genuinely holds (e.g. also Head of Department for a subject), if that's true for him. This is independent of step 3 and only affects the three routes in §2f.
5. **(Optional) If he's also overseeing a section** — Classes → Sections → set him as that section's head. This sets `sectionAssigned`, separately from his role.
6. **Settings → Roles & Permissions → Global (By Role) → Deputy Principal** — only if the *role's* default permissions need adjusting for everyone who holds it, not just John.

Step 3 is the one that actually makes him "Deputy Principal" in the sense that matters. Steps 1, 4, 5 are metadata/responsibility layers on top of it, not substitutes for it. Nothing in the product currently tells an admin that step 3 is the load-bearing one — the closest thing is the small gray caption in step 1's form.

### John stops being Deputy Principal, becomes a Teacher

1. **Settings → Users → John → Role → Teacher.** Immediately revokes his active session (forces re-login), busts his scope cache, and — as a side effect — overwrites his `teachers.staffType` to `teacher` too (the courtesy cascade runs both directions of a role change, not just promotions).
2. **His extraRoles are untouched by this** — if he was ticked as `hod` or held the Roles & Responsibilities "Deputy Principal" checkbox, those stay checked unless someone manually unchecks them in HR. He'd retain department-scoped or the three-route elevated access from §2f even after losing the Deputy Principal *role* and its full permission grid. This is worth being deliberate about — it's not automatically cleaned up.
3. **If he was a Section Head,** his `sectionAssigned` is *not* automatically cleared by a role change alone — [sections.js:92-99](server/routes/sections.js:92) only clears it when someone reassigns that section's head to someone else, not when John's own role changes elsewhere. He could, today, hold `sectionAssigned` pointing at a real section while his role says `teacher` — the same class of split-brain state as the original report, just for a different field.
4. **Historical records** — nothing in `role_permissions`, audit logs, or past-tense records (report cards he approved, assignments he made) is rewritten or affected. Only his *current, forward-looking* access changes.
5. **Any Per-User override previously set for him** ([role_permissions] keyed by his `userId`) survives the role change untouched, and per §2d's bug, if one exists it's already suppressing whatever his role would otherwise grant — worth checking explicitly during an offboarding/role-change, since nothing surfaces its existence anywhere in the UI today.

Neither direction is fully "finished" by the standard you set: the forward direction has no warning when someone configures the wrong field (§2a/§2g comparison), and the reverse direction leaves two fields (`extraRoles`, `sectionAssigned`) that can drift from a person's current role with nothing flagging it.

---

## 5. Recommended renames — identified only, not implemented

Pending your approval, in order of how much confusion each one caused here:

- **"Staff Type / Job Title"** already has the right disclaimer text; the gap is that it's a passive caption, not an active warning. Precedent for the fix already exists in this exact codebase — §2g's section-head cascade warning. The minimal version: after saving a staffType that matches a real system role name, but the person's `users.role` doesn't match it, return the same kind of warning sections.js already returns.
- **"Roles & Permissions"** as a section label doesn't distinguish that "Global (By Role)" and "Per User" write to fundamentally different, independently-resolved documents. Something like "Role Defaults" vs. "Person Overrides" would name the mechanism, not just the mode.
- **"Roles & Responsibilities"** (extraRoles) sharing the word "Roles" with the Settings module invites exactly the cross-reading that happened here. A label like "Additional Duties" or "Extra Responsibilities" (dropping "Roles" entirely) would cut the collision at the word level.
- **The "Deputy" legacy alias** could be retired outright rather than kept as a silent fallback — nothing in the current UI can create it, and its only live effect today is the stale-doc footgun in §6, Claim D.

---

## 6. Verification — proven against the real code, not asserted

Ran an isolated script that `require()`s the actual, unmodified `server/middleware/rbac.js` and `server/routes/settings.js` files, with only `_model('role_permissions')` faked. Nothing in the repo was touched.

```
Claim B — John: users.role='teacher', HR staffType='deputy_principal' → finance:read = false
Claim C — John after Settings→Users role change to deputy_principal        → finance:read = true

Claim D — role='deputy', no 'deputy' doc exists → falls back to deputy_principal → finance:read = true
Claim D — role='deputy', a STALE 'deputy' doc exists (finance:[])  → finance:read = false
          (editing deputy_principal has no effect on this account while that stale doc exists)

Claim E — Jane's role ('hr') grants students:read and attendance:read.
          Admin adds ONE per-user override: "View Payroll" under hr.
          After that single save → students:read = false, attendance:read = false
```

Every number above came from executing the production code, not from reading it.

---

## 7. One unambiguous mental model, in one paragraph

**`users.role` is the only field that decides what someone can do; everything else is either a label about them (`staffType`), a narrow extra grant on top (`extraRoles`, three routes only), a scope filter within an already-granted role (`sectionAssigned`), or a definition of what a `role` value is allowed to do (`role_permissions`, edited via Global by role or overridden via Per User).** Changing a person's access always means changing their `role` in Settings → Users — never their HR Staff Type, never their Roles & Responsibilities checkboxes. Those two are real and useful, but for job-title bookkeeping and narrow operational duties respectively, not for security.

No code changes were made. Awaiting your call on: (a) the Per-User override bug in §2d — I'd treat this as the highest-priority fix regardless of what else gets decided, since it's an active access-control defect, not a UX gap; (b) which renames from §5 to proceed with; (c) whether the Front Office duplicate (§2e) should now be unblocked now that its root cause is documented.

---

## 8. Post-fix update — 2026-08-31 (same day)

Audit accepted. Fix order given: (1) Per-User override bug, mutation-tested; (2) legacy `deputy` identify-and-migrate, not a blind delete; (3) reserved custom-role key collision, via the existing authoritative list. Renaming/UI work explicitly deferred until the model below was confirmed. All three are done.

### 8a. What changed

1. **Per-User override merge — fixed** ([rbac.js](server/middleware/rbac.js), [settings.js](server/routes/settings.js), commit `d1f0863`). A per-user override is now a genuine sparse delta: only the exact keys an admin touches are ever written, and the merge at read time recomputes each affected module's coarse gate as a union with the role's own grant — never narrower than the role alone. Mutation-tested: reverted to the old behavior, confirmed the exact reported symptom reproduces (two unrelated modules flip to denied, one touched key balloons into 29), restored, 3 test files / 25 tests.
2. **Legacy `deputy` — identify-and-migrate tooling shipped, alias NOT yet removed** (commit `f6f0d6c`). `audit.js` (already the established, read-only, production-safe integrity script) gained a check reporting any user still on the legacy key and any school where a stale `deputy` role_permissions document diverges from `deputy_principal`. A new `migrate-legacy-deputy-role.js` performs the safe migrations only (dry-run by default) and explicitly refuses to auto-resolve a divergent pair — that's flagged for a human, always. **This has not been run against production** — no live database in this environment — so `ROLE_ALIASES`, `SYSTEM_ROLES`'s `deputy` entry, and every other alias-aware code path are all still in place. Removing them is a distinct follow-up step, gated on actually running the audit/migration against real data first.
3. **Reserved custom-role key collision — fixed** (commit `f5ed2a0`). `BUILT_IN_ROLE_KEYS` in settings.js now derives from `role-validation.js`'s `SYSTEM_ROLES` (the authoritative list that file was built to be) instead of its own independently-drifted copy — closing the gap that let a custom role collide with the real `principal` system role. `front_office` deliberately stays unreserved and the dropdown duplicate stays unfixed, exactly as instructed.

### 8b. The corrected mental-model statement

§7's original sentence — *"`users.role` is the only field that decides what someone can do"* — is superseded by your own refinement, confirmed accurate against the code:

> `users.role` is the primary RBAC identity. Effective authorization is determined by the user's primary system role, explicit per-user permission overrides, and narrowly scoped operational assignments/responsibilities where those capabilities are intentionally supported. HR job title is not an authorization mechanism.

### 8c. The five-concept model

```
PERSON
│
├── Job Title (teachers.staffType)
│     HR information only. Zero effect on access, by design and by test
│     (staff-role-separation.test.js).
│
├── Primary System Role (users.role / users.roles[])
│     The base grant. Set at login into the JWT; a role change forces
│     token revocation so it takes effect immediately, not on next
│     natural expiry.
│
├── Individual Permission Overrides (role_permissions keyed by userId)
│     Explicit deltas on top of the role — now a true delta (fixed).
│     Set via Settings → Roles & Permissions → Per User.
│
├── Additional Responsibilities (teachers.extraRoles[] → JWT)
│     HOD / Coordinator / etc. Reaches exactly three routes
│     (teaching-assignments.js, lessons.js, weekly-snapshots.js) as a
│     narrow, route-specific grant — never touches role_permissions or
│     the general V/E/D grid.
│
└── Operational Assignments (users.sectionAssigned; extraRoles'
      departmentId for HOD scoping)
      Scope FILTERS within a role already granted, not grants on their
      own. sectionAssigned only does anything if the person's role is
      ALSO section_head — sections.js's own cascade already warns the
      admin explicitly when that combination doesn't hold; that's the
      pattern worth extending elsewhere, not inventing something new.
```

### 8d. Exact effective-permission resolution order, as implemented today

For every standard `rbac(module, action[, subKey])` check ([rbac.js:_isAllowed](server/middleware/rbac.js)):

1. **Resolve `role`** from `req.jwtUser.role` — the JWT, set once at login from `users.role`. Not re-read live mid-session; a role change only takes effect once the token is revoked (which the role-change route does automatically) and the person's next request re-authenticates.
2. **Superadmin short-circuit** — if `role` or anything in `roles[]` is `'superadmin'`, allow immediately. Nothing below runs.
3. **Load role permissions** — `role_permissions` doc for `{schoolId, roleKey: role}`. If none exists and `role === 'deputy'`, fall back to the `'deputy_principal'` doc — *but only if no `'deputy'` doc exists at all*. A stale `'deputy'` doc, if one exists, wins over this fallback silently (item 2's tooling exists to find and close these).
4. **Load per-user override** — `role_permissions` doc for `{schoolId, userId}`, if any exists for this person.
5. **Merge** (`_mergeUserOverrides`, item 1's fix), only if an override exists:
   - Every key the override explicitly set replaces the role's value for that one key.
   - Every module the override never touched is untouched — exactly what the role alone grants.
   - For any module with at least one touched sub-key, that module's own coarse gate is recomputed as the union of the role's original coarse grant, the role's other sub-key grants, and the override's sub-key grants — so a no-subKey check reflects the override too, and is never narrower than the role alone.
6. **Check the requested permission** — if the caller passed a `subKey` and `{module}__{subKey}` exists in the merged result, check only that array; otherwise check the module's coarse array.
7. **Result** — `true` iff the resolved array includes the requested action.

Two things run *outside* that pipeline entirely, on their own narrower rules:

8. **`extraRoles[]`**, on exactly three routes (`teaching-assignments.js`, `lessons.js`, `weekly-snapshots.js`): unioned into an ad hoc "effective roles" set alongside `role`/`roles[]` and checked directly for membership (e.g. `eff.has('hod')`) to grant department-scoped or full management rights on *those routes only*. Never reaches `role_permissions`.
9. **`sectionAssigned`**, via `scopeMiddleware.js`: narrows *which records* a `section_head`-role person can see within a module they already have role-level access to. A scope filter layered on top of an existing grant, not a grant of its own — inert unless the role is also `section_head`.

### 8e. Final verification matrix — before push (commit `d1714cb`)

25 tests against the real `rbac.js` / `scopeMiddleware.js` / three extraRoles-consuming routes, not a reimplementation: 10 scenario rows (normal role-only, sparse override, multiple overrides, legacy `deputy` both clean and stale-doc-wins, `deputy_principal`, custom role, `extraRoles` both narrow-grant and non-elevation, `section_head`+`sectionAssigned`, superadmin, cross-school) and the 7 specific proofs requested, each its own test. All 25 pass.

Full suite: 178/178 suites, 1682/1682 tests. Tenant Enforcement Ratchet: held at 35/35. RBAC Coverage Gate: 100.00%, no regression. Security scan: clean.

One thing worth recording: the matrix's first draft had 5 failures, all traced to a single cause — `rbac.js`'s and `scopeMiddleware.js`'s in-memory caches serving a stale entry across tests that reused the same `(schoolId, role)` or `(userId, schoolId)` pair. Fixed by calling `invalidatePermCache`/`invalidateScopeCache` between tests — the same discipline every real write path already follows. A live, small-scale demonstration of exactly the class of bug this whole audit has been about.

### 8f. Recorded, not yet acted on: `extraRoles`'s separate authorization path

`extraRoles[]` reaches exactly three routes (`teaching-assignments.js`, `lessons.js`, `weekly-snapshots.js`) through their own local `_effectiveRoles()`/`canManage()`/`isHodOrAdmin()` helpers — a second, narrower authorization mechanism that sits entirely outside `rbac.js` and `role_permissions`. §B3 above confirms it cannot leak into the general permission grid. That containment is good and verified, but the mechanism itself is still three independent, hand-copied implementations of "check membership in a small role set" rather than one shared one — the same shape of drift risk this audit already found and fixed twice elsewhere (`BUILT_IN_ROLE_KEYS` vs `SYSTEM_ROLES`, the two `VALID_SECTIONS` lists in bell-schedule.js and onboard.js). Nothing today stops a fourth route from being added with its own `if (extraRoles.includes('principal'))` and quietly becoming a fourth copy. Not fixed here — recorded so it doesn't disappear, per instruction.

### 8g. Still open, by your own instruction

- Legacy `deputy` alias removal — blocked on running `audit.js` / `migrate-legacy-deputy-role.js` against real production data, which this environment cannot do.
- UI renaming (§5's proposals) — not implemented; model is now confirmed, your call on which to proceed with.
- Front Office dropdown duplicate — still deliberately untouched.
