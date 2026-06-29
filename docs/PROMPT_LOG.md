# Msingi — Prompt Log

A concise record of every development session: what was asked and what was delivered.  
The CHANGELOG documents *what* was built. This log documents *why* — the human intent behind each session.

**Update rule:** append a new entry at the bottom after every session before committing.

---

## Session 1 — Timetable Engine & Core Scheduling (v4.9.x)

**Asked:** Build a full institutional scheduling engine — timetable slots, bell schedules, per-section conflict detection, and a publishing portal with per-role views and print output.

**Done:** Phase 1 timetable engine; per-section bell schedule config in Settings; time-overlap conflict detection; publishing flow with class/teacher/student views; print-ready output. Added rooms registry and teaching assignments later in the same arc.

---

## Session 2 — Subjects, Departments & Seed Data (v4.9.x)

**Asked:** Subjects and departments need to be a managed registry (not hardcoded). Seed realistic demo data across all modules.

**Done:** Full subjects/departments registry (9 depts, 24 subjects). Cross-module demo data seed — students, classes, teachers, finance, attendance all inter-linked.

---

## Session 3 — Rebrand InnoLearn → Msingi (v4.7.x)

**Asked:** Rename the entire platform from InnoLearn to Msingi everywhere — UI, emails, docs, code.

**Done:** Global find-and-replace across all platform files. School-facing URLs changed. Legacy JS/HTML dead code removed.

---

## Session 4 — Security Hardening + Google/Microsoft OAuth (v4.10.0)

**Asked:** Harden authentication, add Google and Microsoft SSO, and integrate M-Pesa subscription billing.

**Done:** Auth hardened (JWT refresh, token revocation). Google OAuth + Microsoft OAuth added. M-Pesa Daraja API integrated — STK Push + C2B auto-reconciliation. `.git` directory blocked, CSP headers enabled.

---

## Session 5 — HR Module (v4.11.x, 6 phases)

**Asked:** Build a full HR module — staff profiles, subjects frontend, class-subject assignments, enrollment warnings, payroll monthly management, and staff detail panel with document storage.

**Done:** Six-phase delivery: seed foundation → class-subjects & subject-rules APIs → enrollment warnings engine → Subjects frontend (4 tabs) → Payroll monthly UI → HR staff tab with detail panel and add-staff flow.

---

## Session 6 — Messaging, Profile, eLearning (v4.42–v4.45)

**Asked:** Full messaging system between school users; user profile page; eLearning integrations with Google Classroom, Zoom, Google Meet, and PMI sessions; emergency online mode.

**Done:** Messaging API + full UI (threads, mark-all-read). User profile page (photo upload, bio, password change). Google Classroom integration → Zoom live sessions → Google Meet live sessions → PMI-based sessions with calendar integration. Emergency online mode with student Join buttons.

---

## Session 7 — Module Decomposition (large-file refactors)

**Asked:** Several pages had grown past 1,000–1,800 lines and were hard to maintain. Break them up.

**Done:** GradesPage (1432 → 11 files), TimetablePage (1883 → 11 files), FinancePage (1355 → 77 lines), BehaviourPage (1268 → 71 lines), AdmissionsPage (1115 → 8 files). Each split into focused sub-components with shared data files.

---

## Session 8 — Sections, RBAC Expansion, Sidebar (v4.19–v4.21)

**Asked:** Add class sections/streams as a managed resource. Expandable/collapsible sidebar. Full RBAC permission matrix across all modules.

**Done:** Sections as a first-class resource with their own API. Collapsible sidebar with persistent state. RBAC matrix expanded with per-module read/create/update/delete controls across all 14 modules.

---

## Session 9 — Analytics & Growth Profile (v4.22–v4.26)

**Asked:** Leadership analytics dashboard. Notifications configuration. Growth Profile module for learner development portfolios.

**Done:** Leadership analytics dashboard with KPI tiles. Notifications configuration matrix (per-role, per-event). Growth Profile module — verified portfolio tracking. Dynamic school-branded KPI cards across all modules.

---

## Session 10 — Library, Transport & Hostel (v4.29)

**Asked:** Three new modules: Library (book lending), Transport (routes + students), Hostel (boarding management). Include demo seed data.

**Done:** Full implementation of all three modules — CRUD, role-based views, and seed data integrated with the demo school.

---

## Session 11 — Security Deep Audit (v4.29–v4.32)

**Asked:** Run a comprehensive security audit and fix all findings: 2FA, CSPRNG, JWT vulnerabilities, BOLA, M-Pesa IP spoofing, NoSQL injection, OAuth exchange hardening.

**Done:** 2FA email OTP added. `Math.random()` replaced with `crypto.randomInt()` everywhere. `crypto.timingSafeEqual` for secret comparison. BOLA fixed across 10 audit findings. M-Pesa IP allowlist. NoSQL injection sanitisation. OAuth exchange-code flow + JWT token-version revocation.

---

## Session 12 — School Branding & Finder (v4.39–v4.41)

**Asked:** Schools should have their own logo and favicon. A school finder page for users who land without a school slug. Module preview panels on the landing ecosystem section.

**Done:** Logo + favicon upload in Settings; dynamic favicon set on load. School finder autocomplete (search-as-you-type). Module preview panels with outcome copy, result boxes, connected-module links, and dual CTA. Maturity badges on all 14 module panels.

---

## Session 13 — Landing Page CMS (v4.34.x)

**Asked:** Platform admin should be able to edit every section of the landing page from the dashboard — hero copy, feature bullets, pricing, social links, etc.

**Done:** Full Landing Page CMS in the platform admin dashboard. Every landing section is editable and changes propagate to the live page in real time without a deploy.

---

## Session 14 — Academic Year Lifecycle (v4.30.x)

**Asked:** Academic years need full lifecycle management — draft, active, and locked states, with year transition flow, editable term names, and automated billing snapshots on term start.

**Done:** Academic year lifecycle (draft → active → locked). Term names editable. Year transition UI. Automated billing snapshot on term activation. Bug fix: academic year label persisted across refreshes.

---

## Session 15 — Grades & Assessment Overhaul (v4.33–v4.37)

**Asked (across multiple sessions):** Assessment and grades were two parallel systems that never talked. Unify them. Add full CRUD for assessment types. Add grade boundaries and grading scale. Add a spreadsheet-style mark entry grid. Add comment banks. Add exam series with a status machine. Add approval workflow for mark submission. Lock marks post-approval. Add principal signature and school stamp to report card PDFs.

**Done:**
- **v4.33:** Assessment module overhaul — config moved into Exams module.
- **v4.34:** Assessment types full CRUD.
- **v4.35:** Grade boundaries + ExamsPage routing.
- **v4.36:** Unified pipeline — `assessment_marks` feeds report cards end-to-end. Portal fee collection name bugs fixed.
- **v4.37:** Comment banks. Grid mark entry (Excel-like, keyboard nav, clipboard paste). Exam series (draft/open/moderation/closed). Approval workflow (submit → review → approve/reject). Mark locking. Signature + stamp on PDFs.

---

## Session 16 — Custom SMTP, Password System, Staff Permissions (v4.29.x)

**Asked:** Schools should be able to use their own SMTP server. Redesign the password system (real passwords, 90-day rotation). Add admin temp password reset. Unify roles across filter, invite form, and Roles & Permissions tab. Support custom roles.

**Done:** Per-school custom SMTP with AES-256-GCM key encryption. Real password hashing replacing temporary passwords. 90-day rotation. Admin temp reset UI. 13 system roles unified. Custom role creation with configurable permissions. Staff self-edit profile API. OAuth auto-provisioned users start inactive (require admin approval).

---

## Session 17 — Landing Redesign, Legal Pages, Pricing (post-v4.37)

**Asked:** Redesign the landing page (animated header, upgraded dashboard mockup, warm footer). Remove Three.js hero and reposition as Decision Intelligence Platform. Add Privacy Policy and Terms of Service pages. Update pricing to KES 150/200/250 per student per term. Fix student login and plans-page tier labels.

**Done:** Animated nav/hero with scroll effects. Dashboard mockup upgraded. Privacy Policy + Terms of Service at `/privacy` and `/terms`. Pricing updated. Demo school exempted from 2FA (no real email inboxes). All ERP modules enabled on all tiers.

---

## Session 18 — Cloud Backup & Encryption (post-v4.37)

**Asked:** Nightly backups should go to cloud storage (S3) with encryption at rest, per KDPA Section 41.

**Done:** S3 cloud backup with AES-256-GCM encryption. Nightly cron. Backup collection list synced across `backup.js` and `backup-cron.js`. CSP headers and `.git` blocking added.

---

## Session 19 — Student Features: Email, Photo, Fee Visibility (post-v4.37)

**Asked:** Students should have a school-issued email field. Profile photo upload (fix silent failure). Photo should appear on report card PDFs. Fee balance should be hideable from the student dashboard. School admins should control whether students can see their fee balance and access report cards.

**Done:** `schoolEmail` field added to students. Profile photo upload fixed. Photo in report card PDF. `hideFeeFromStudents` and `studentCanViewReportCards` settings added and enforced in student/parent portals. RBAC wired to sidebar — portal role bleed fixed.

---

## Session 20 — Configurable Admission Number (post-v4.37)

**Asked:** Schools should be able to configure their own admission number prefix (e.g. "SCH/"), zero-padding width, and starting counter. Bulk import/export should honour the new field plus `schoolEmail`.

**Done:** Admission number prefix, padding, and counter management in school settings. Admission numbers auto-generated on student creation. Import/export updated; tests updated.

---

## Session 21 — Landing Refactor + FAQ Page (post-v4.37)

**Asked:** Landing.jsx had grown to ~2100 lines. Split it into modular components. Add a dedicated /faq page with categorized accordion UI.

**Done:** Landing.jsx split into `components/landing/` and `data/landingData.js`. FAQ page at `/faq` with category sidebar (desktop), accordion items, JSON-LD `FAQPage` schema, and a teaser section on the landing page.

---

## Session 22 — SEO & AI Bot Visibility (post-v4.37)

**Asked:** Is the landing page SEO friendly? Can it feature in AI chatbot results? Then: implement the combined SEO action plan (reviewer recommendations + own audit).

**Done (4 phases):**
- **Phase 1:** `robots.txt` (allows public routes, blocks all auth routes) + `sitemap.xml` (6 URLs with priority weights).
- **Phase 2:** `react-helmet-async` per-page — title, description, canonical, OG, Twitter Card for all 6 public pages.
- **Phase 3:** JSON-LD structured data — `SoftwareApplication` + `Organization` on Landing; `FAQPage` on /faq; `PriceSpecification` on /plans.
- **Phase 4:** Puppeteer SSG prerender (`scripts/prerender.mjs`) — headless Chromium visits all 6 public routes post-build and writes rendered HTML to `dist/`, so GPTBot/PerplexityBot/ClaudeBot see real content without executing JS. `build:ssg` script added to `package.json`.

---

## Session 23 — WhatsApp FAB on All Public Pages (post-v4.37)

**Asked:** Add the WhatsApp floating action button to FAQ, Plans, Contact, Privacy Policy, and Terms of Service pages (Landing already had it).

**Done:** `FloatingActions` component (WhatsApp FAB always visible + scroll-to-top after 400px) imported and rendered on all 5 remaining public pages. Duplicate scroll-to-top logic removed from Privacy Policy and Terms of Service.

---

## Session 24 — African Schools Branding + SEO Score Fix (post-v4.37)

**Asked:** "Msingi for African schools, not just Kenyan schools" — update all public-facing copy. Also, SEO test showed 60% score and 3 Critical errors — diagnose and fix.

**Done:** All "Kenyan schools/administrators/leaders" copy updated to "African" across Landing.jsx, FAQ.jsx, and index.html (legal references to "Kenyan law" and ISO "Kenyan Shilling" correctly left unchanged). SEO errors diagnosed as SPA shell being crawled without JS execution — fixed by updating `index.html` base `<title>` and `<meta description>` as non-JS fallbacks.

---

## Session 25 — Mobile Navigation Hamburger Menu (post-v4.37)

**Asked:** On mobile, the navbar only shows "Msingi" and "Book Demo" — all nav links disappear. Add a hamburger menu.

**Done:** `Menu`/`X` icons added to imports. `mobileMenuOpen` state added. Scroll listener closes menu on scroll. Hamburger button (`md:hidden`) added to navbar right group. Login link changed to `hidden md:block`. Animated `AnimatePresence` dropdown panel added inside `<motion.nav>` — contains all nav links, Login, Book Demo (full-width), and Platform Live status badge.

---

## Session 26 — Prompt Log Creation + Docs/Changelog Update (2026-06-14)

**Asked:** Create a document tracking all prompts from the beginning (shorter version), updated each session. Update other docs and changelog when done.

**Done:** This file (`docs/PROMPT_LOG.md`) created. CHANGELOG updated with v4.38–v4.42 entries. DEVELOPER_GUIDE updated with public site architecture section.

---

## Session 27 — Platform Security Hardening + SEO Title + Full Module Grid (2026-06-15)

**Asked (multi-topic session):**
1. Reviewer's pre-launch checklist: JWT_SECRET, SMTP_ENCRYPTION_KEY, MongoDB Atlas encryption, PUBLIC_URL — what's your opinion?
2. Reviewer flagged platform admin security risks: impersonation, backup, logical tenancy, remediation.
3. PageSpeed analysis: read desktop scores from screenshots.
4. SEO title: reviewer challenged title + recommended adding OG tags.
5. Module grid: confirm all 14 modules are present; put Transport and Hostel last after Analytics.
6. Correction: remove erroneous Sport module; add ALL 20 real system modules to the landing page.

**Done:**
- Clarified PUBLIC_URL vs APP_URL distinction (APP_URL drives email links; PUBLIC_URL drives OAuth/M-Pesa callbacks).
- Platform security: PLATFORM_ADMIN_KEY startup guard (exits in prod if < 32 chars), platform rate limiter (50/15 min on /api/platform), ALLOW_IMPERSONATION env gate, impersonation audit log to `platform_audit_log` collection. `.env.example` updated with notes.
- PageSpeed desktop scores: Landing 99, Plans 86, FAQ 96, Contact 100. Identified accessibility gaps (missing `<main>`, heading order, icon aria-labels, hero subtitle contrast).
- SEO: updated title to "Msingi | School Management System for Modern African Schools" (60 chars) in Landing.jsx Helmet and index.html. Added full OG + Twitter Card fallback block to index.html.
- Module grid: replaced `ECOSYSTEM_NODES` with all 21 modules (removed Sport, added Teachers, Exams, Subjects, Messages, Events, HR & Staff, eLearning; Transport and Hostel moved last). All 7 new modules given full `MODULE_PREVIEWS` panel entries.

*End of log — append new sessions below this line.*
