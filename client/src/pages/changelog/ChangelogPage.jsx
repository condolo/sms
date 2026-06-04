/* ============================================================
   Changelog — Version history for Msingi platform
   ============================================================ */
import { motion } from 'framer-motion';
import { Tag, Zap, Bug, Shield, Sparkles } from 'lucide-react';

const RELEASES = [
  {
    version: '4.38.0',
    date: '2026-05-30',
    label: 'Student & Parent Portal Logins',
    changes: [
      { type: 'new', text: 'Student portal login: students log in with their admission number (username) + password — no email required' },
      { type: 'new', text: 'POST /api/students/:id/portal-account — create or reset a student login account; returns username + temp password shown once to admin; plan-gated (Student or Family tier)' },
      { type: 'new', text: 'DELETE /api/students/:id/portal-account — deactivate a student login account without touching their academic records' },
      { type: 'new', text: 'POST /api/students/:id/parent-account — create or reset parent login linked to student.parentEmail; if same email is already a parent, their child list is updated; sends welcome email with credentials; plan-gated (Family tier)' },
      { type: 'new', text: 'Student Dashboard (/student-dashboard): welcome card, attendance ring + summary, fee balance, curriculum coverage bars per subject, today\'s timetable, published report cards' },
      { type: 'new', text: 'Parent Dashboard (/parent-dashboard): child selector (multi-child families), child overview, attendance summary + last 5 records, fee balance + recent payments, curriculum coverage, report cards' },
      { type: 'new', text: 'GET /api/student-portal/dashboard — single-request aggregation: student record, attendance, fee balance, lesson coverage per subject, today\'s timetable, report cards' },
      { type: 'new', text: 'GET /api/parent-portal/children — list of children linked to the parent account' },
      { type: 'new', text: 'GET /api/parent-portal/dashboard/:childId — full child dashboard (parent must be linked to that child)' },
      { type: 'new', text: 'Login flow: role-aware redirect after login — students go to /student-dashboard, parents to /parent-dashboard, staff to /dashboard' },
      { type: 'new', text: 'Login input: "Email or admission number" — backend accepts identifier field, looks up by email OR username in one $or query' },
      { type: 'new', text: 'JWT payload: studentId added for student role; studentIds + guardianOf added for parent role' },
      { type: 'new', text: 'StudentProfile → Portal tab (new 7th tab): create/reset student account (shows temp credentials), create/reset parent account, deactivate student, reactivate student — all from one panel' },
      { type: 'new', text: 'StudentList status options updated: Active (default), Inactive, Withdrawn, Graduated, All students — backend already excludes withdrawn/graduated by default' },
      { type: 'new', text: 'users collection: username index (schoolId + username unique sparse) + studentId index added' },
      { type: 'new', text: 'Demo seed: demo student user linked to first student record via studentId + username; demo parent linked via studentIds/guardianOf; student record flagged hasPortalAccount + hasParentAccount' },
      { type: 'new', text: 'Bootstrap: enterprise plan grants all portal tiers; Student tier enables student login; Family tier additionally enables parent login' },
    ],
  },
  {
    version: '4.37.0',
    date: '2026-05-30',
    label: 'Landing Page CMS — Edit Every Section from Platform Admin',
    changes: [
      { type: 'new', text: 'Landing Page CMS added to platform admin dashboard (/platform → Landing Page CMS nav item)' },
      { type: 'new', text: 'GET /api/platform/landing-content — public cached endpoint; Landing.jsx fetches CMS content on mount and deep-merges with hardcoded defaults (site never breaks if no DB content)' },
      { type: 'new', text: 'PUT /api/platform/landing-content — platform-key protected, partial merge by section: hero, conviction, ecosystem, trust, footer, seo' },
      { type: 'new', text: 'Hero editor: headline (with \\n line break), subheadline, italic tagline, pill badge text, CTA 1 and CTA 2 labels' },
      { type: 'new', text: 'Conviction pairs editor: add/remove/reorder before-after rows; changes saved independently' },
      { type: 'new', text: 'Ecosystem editor: section heading, sub-heading, and per-node toggle checkboxes (enable/disable any of the 14 modules from appearing on the landing page)' },
      { type: 'new', text: 'Trust band editor: school names (comma-separated), band tagline — both editable' },
      { type: 'new', text: 'Footer editor: tagline + contact email' },
      { type: 'new', text: 'SEO editor: page title, meta description, OG image URL for social sharing' },
      { type: 'new', text: 'Billing Overview added to platform admin: total invoiced / collected / outstanding stat cards + full invoice table across all schools with status badges' },
      { type: 'new', text: 'Each CMS section is collapsible and saves independently with toast confirmation' },
    ],
  },
  {
    version: '4.36.0',
    date: '2026-05-30',
    label: 'Term Dates, Student Active Status & Automated Billing',
    changes: [
      { type: 'new', text: 'Settings → School Profile: term dates section — start and end date pickers per term (dynamically sized to termsPerYear); dates drive billing automation cron' },
      { type: 'new', text: 'Student statuses: active, inactive, withdrawn, graduated — student list defaults to hiding withdrawn/graduated (?status=all shows everyone)' },
      { type: 'new', text: 'PATCH /api/students/:id/deactivate — marks student as withdrawn or graduated with reason, notes, and effective date; restricted to admin/principal/deputy; all academic records preserved' },
      { type: 'new', text: 'PATCH /api/students/:id/reactivate — restores a withdrawn/graduated student to active; clears deactivation fields' },
      { type: 'new', text: 'billing_snapshots collection: one invoice per school per academicYear + term (unique index); stores active student count, tier rate, total amount, status, and M-Pesa receipt' },
      { type: 'new', text: 'POST /api/billing/generate — manually create a term snapshot; counts only active students, calculates amount = activeCount x tier rate' },
      { type: 'new', text: 'GET /api/billing/current — returns latest pending invoice for the school (used by subscription tab)' },
      { type: 'new', text: 'GET /api/billing/history — all billing snapshots for the school with paid/pending/overdue status' },
      { type: 'new', text: 'GET /api/billing/all — superadmin platform-wide view of all invoices across all schools' },
      { type: 'new', text: 'Billing cron (daily 06:00 Kenya / 03:00 UTC): matches today against each school\'s termDates.startDate; auto-creates snapshot and emails school admin if term starts today' },
      { type: 'new', text: 'Invoice email: branded HTML email sent to all admin/principal users of the school on term start; shows invoice ref, active count, rate, and total with payment link' },
      { type: 'new', text: 'Settings → Subscription tab: shows live pending invoice fetched from /api/billing/current; if no invoice, shows student count input + "Generate invoice" button; billing history card below payment' },
      { type: 'fix', text: 'M-Pesa subscription callback: on successful payment, marks billing_snapshot as paid, records mpesaCode and paidAmount; planExpiresAt now uses term end date from termDates (90-day fallback)' },
      { type: 'new', text: '4 new billing_snapshots indexes: school+year+term (unique), school+status, status+date, id (unique)' },
    ],
  },
  {
    version: '4.35.0',
    date: '2026-05-30',
    label: 'Landing Page Marketing Update — All Modules & New Pricing',
    changes: [
      { type: 'new', text: 'Ecosystem nodes: 10 → 14 modules — Lessons (cyan), Library (lime), Transport (rose), Hostel (stone) added with BookCheck, BookOpen, Bus, Building2 icons' },
      { type: 'fix', text: 'Ecosystem section heading updated from hardcoded "Nine connected layers" to "One student. Every operational layer — connected." (count-agnostic)' },
      { type: 'new', text: 'Conviction pairs: 4 → 5 rows — added curriculum coverage pair: "tracked in a teacher\'s notebook" → "Syllabus tracker — every topic marked, every subject covered live"' },
      { type: 'new', text: 'Hero description: "curriculum" added to the feature list in the opening paragraph' },
      { type: 'new', text: 'Plans section: replaced old Core/Standard/Premium feature-gate cards (flat monthly KES 5k/12k/25k) with new portal-tier pricing model' },
      { type: 'new', text: 'Portal tier cards: Base (KSh 100/student/term), Student (KSh 120), Family (KSh 160) — each shows rate, portal access chips, and feature list' },
      { type: 'new', text: '"All modules in every tier" messaging: tier controls portal access only, not ERP features' },
      { type: 'new', text: 'Setup fee accordion on Plans section: KSh 30k-50k by student band (200 / 500 / 1k / unlimited)' },
      { type: 'new', text: 'Link to /plans for full interactive price estimator' },
    ],
  },
  {
    version: '4.34.0',
    date: '2026-05-30',
    label: 'Bootstrap Pricing Model & Portal Tier Subscription',
    changes: [
      { type: 'new', text: 'server/config/pricing.js: single source of truth for all commercial pricing — STUDENT_RATE (100/120/160), SETUP_FEE_BANDS, PORTAL_TIERS, calcTermAmount(), pricingSummary()' },
      { type: 'new', text: 'Bootstrap mode: all onboarding schools receive full enterprise access during launch phase; BOOTSTRAP_PLAN and TRIAL_DAYS env vars switch to paid model with no code changes' },
      { type: 'new', text: 'Plans.jsx: complete rewrite — 3 portal tier cards with interactive PriceEstimator (student count slider, tier selector, live term/annual/setup cost calculation); FAQ accordion; "all modules in every tier" panel' },
      { type: 'new', text: 'Settings → Subscription: replaced old Core/Standard/Premium plan selector with portal-tier cards (Base/Student/Family); plan badge fixed — enterprise without expiry now shows "Full access · Bootstrap trial" instead of false "No active subscription" warning' },
      { type: 'fix', text: 'M-Pesa subscription endpoint: replaced flat SUBSCRIPTION_PRICES with STUDENT_RATE from pricing.js; accepts { tier, studentCount } (new) and { plan } (legacy backward-compat); amount = rate x studentCount' },
      { type: 'fix', text: 'GET /api/mpesa/subscription/plans: now returns PORTAL_TIERS from pricing.js instead of old hardcoded flat prices' },
      { type: 'new', text: 'onboard.js: lessons module added to all default role permissions and ALL_MODULES; bootstrap plan default reads from BOOTSTRAP_PLAN env var' },
    ],
  },
  {
    version: '4.33.0',
    date: '2026-05-30',
    label: 'Lessons — Syllabus & Coverage Tracker',
    changes: [
      { type: 'new', text: 'Lessons module (standard plan): live curriculum coverage tracking for teachers, students, parents and admin — syllabus_topics + lesson_coverage collections' },
      { type: 'new', text: 'Topics are shared per subject: any teacher of Mathematics sees the same topic list; co-teachers of the same class share their coverage pool' },
      { type: 'new', text: 'Coverage is per class: teachers mark each topic/subtopic as covered with timestamps; admin and HOD see school-wide progress in one overview grid' },
      { type: 'new', text: 'Full topic management: create topics with subtopics, reorder with ↑/↓, edit descriptions, delete (with coverage cleanup)' },
      { type: 'new', text: 'Copy topics between academic years: copy curriculum structure from 2024/2025 → 2025/2026 in one click (coverage records are NOT copied)' },
      { type: 'new', text: 'Lesson reminder cron jobs: Friday 5pm (Kenya) — end-of-day email to teachers with uncovered topics; Saturday 12pm — second reminder; Saturday 4pm — HOD escalation email with pending-staff table' },
      { type: 'new', text: 'Student and parent API: GET /api/lessons/class-summary/:classId — per-subject coverage rings visible on student/parent dashboards' },
      { type: 'new', text: 'Role permissions: teachers and deputy_principal get full RCUD on lessons; section_head/HOD get RCU; parent and student get read-only' },
      { type: 'new', text: '4 new MongoDB indexes across syllabus_topics and lesson_coverage for efficient subject/year/class queries' },
      { type: 'new', text: 'Lessons nav entry (BookCheck icon) added to Academic section in sidebar and Modules settings' },
    ],
  },
  {
    version: '4.32.0',
    date: '2026-05-30',
    label: 'Academic Year as School-Configured Field',
    changes: [
      { type: 'new', text: 'School settings: academic year label, year-start month (Jan–Dec), and terms per year now in a 3-column grid — all saved to the school document' },
      { type: 'fix', text: 'FeeStructureSlideOver: reads academicYear and termsPerYear from session instead of hardcoding values; term dropdown dynamically sized to the school\'s term count' },
      { type: 'fix', text: 'Admissions reference numbers: APP-{year}-{code} now derives the year from school.academicYear ("2025/2026" → "2025") instead of the calendar year' },
      { type: 'new', text: 'patchSchool() auth store helper: settings changes propagate reactively to sidebar and all components reading school from session without page reload' },
    ],
  },
  {
    version: '4.31.0',
    date: '2026-05-30',
    label: 'Module Management & Sidebar Collapse',
    changes: [
      { type: 'new', text: 'Settings → Modules tab: admin can toggle any of the 17 configurable modules on/off and reorder them with ↑/↓ arrows; changes saved to school.moduleConfig' },
      { type: 'new', text: 'Sidebar collapse: X button in header collapses sidebar on desktop; hamburger in TopBar expands it — replaces the old fixed bottom arrow' },
      { type: 'new', text: 'Sidebar nav dynamically built from school.moduleConfig — disabled modules disappear instantly after admin saves without page reload' },
    ],
  },
  {
    version: '4.30.0',
    date: '2026-05-30',
    label: 'Demo Seed Data — Library, Transport & Hostel',
    changes: [
      { type: 'new', text: '12 library books seeded across Literature, Mathematics, Sciences, History, Languages, Business and Geography categories — all authored by East African / African authors or KCSE publishers' },
      { type: 'new', text: '8 library loans seeded: 3 active (due in 7–11 days), 2 overdue with KSh 100–150 fines, 3 returned — book available counts reflect outstanding loans' },
      { type: 'new', text: '3 transport routes seeded: Westlands Express (bus ×40), Eastlands Shuttle (bus ×33), Karen & Langata Runner (van ×14) with driver details and real Nairobi stop names' },
      { type: 'new', text: '8 transport assignments linking demo students to their respective routes with pickup stops' },
      { type: 'new', text: '2 hostels seeded: Boys\' Hostel (120-cap, male) and Girls\' Hostel (100-cap, female) with warden and contact details' },
      { type: 'new', text: '6 hostel rooms seeded: B101/B102/B103 (boys) and G201/G202/G203 (girls) — occupied counts match active resident assignments atomically' },
      { type: 'new', text: '6 active hostel resident assignments: 4 boys (B101 × 2, B102 × 2) and 2 girls (G201 × 2) linking real demo student IDs' },
      { type: 'fix', text: 'Seed file header updated to document the expanded data scope; console.log summary line extended to include the three new module counts' },
    ],
  },
  {
    version: '4.29.0',
    date: '2026-05-29',
    label: 'Library, Transport & Hostel — Full Module Suite',
    changes: [
      { type: 'new', text: 'Library module (standard plan): book catalogue with full CRUD, copy tracking, ISBN/category/shelf location, text search by title/author/ISBN' },
      { type: 'new', text: 'Library loans: issue books to students or staff, return with automatic fine calculation (KSh 10/overdue day, configurable), overdue sync endpoint to bulk-mark past-due active loans' },
      { type: 'new', text: 'Library summary dashboard: totalBooks, totalCopies, available, onLoan, activeLoans, overdueLoans, unpaidFines — aggregated in one query' },
      { type: 'new', text: 'Transport module (standard plan): route management with vehicle type/registration, driver details, departure/arrival times, configurable stops list, fee-per-term' },
      { type: 'new', text: 'Transport assignments: assign students to routes with pickup stop, direction (to_school / from_school / both), capacity enforcement, active-assignment guard on route deletion' },
      { type: 'new', text: 'Hostel module (premium plan): boarding house management — hostels, rooms, and resident assignments in three separate collections' },
      { type: 'new', text: 'Hostel rooms use the hostel_rooms collection (NOT rooms — which is owned by timetable); room occupancy counter maintained atomically on assign/discharge' },
      { type: 'new', text: 'Hostel discharge workflow: one-click discharge sets endDate, decrements room occupied count, marks assignment as discharged' },
      { type: 'new', text: '7 new MongoDB indexes across library_books, library_loans, transport_routes, transport_assignments, hostels, hostel_rooms, hostel_assignments' },
      { type: 'new', text: 'RBAC: librarian role manages library; transport_officer manages transport; hostel_master manages hostel — all gracefully degrade to read-only for non-managers' },
      { type: 'new', text: 'Sidebar: BookMarked (Library), Bus (Transport), BedDouble (Hostel) nav entries added to Operations section' },
    ],
  },
  {
    version: '4.28.0',
    date: '2026-05-29',
    label: 'Payroll Stabilisation — Lifecycle, Shared Model & Response Envelope',
    changes: [
      { type: 'fix', text: 'HR route fully rewritten to use shared _model, planGate("hr"), and ok()/E.* response helpers — previously used local model definitions and raw res.json()' },
      { type: 'new', text: 'Payroll lifecycle status: draft → confirmed (HR/Admin) → paid (Admin only); PATCH /hr/payroll/:id/status endpoint enforces the state machine' },
      { type: 'new', text: 'Payroll table gains Status column with colour-coded badges (draft/confirmed/paid), Confirm and Mark Paid action buttons, locked editing on non-draft records' },
      { type: 'new', text: 'DELETE /hr/payroll/:id: id-based deletion replaces fragile ?staffId=X&period=Y query-param pattern; only admins can delete confirmed/paid records' },
      { type: 'new', text: 'HR summary aggregation: staff counts, pending leaves, payroll totals (gross, net, headcount) computed in a single parallel Promise.all' },
      { type: 'fix', text: 'Client data access updated for response envelope: data falls back through ?.data ?? ?.records / ?.requests chains to handle cached responses during rollout' },
    ],
  },
  {
    version: '4.27.0',
    date: '2026-05-29',
    label: 'Mobile Optimisation — Responsive Grids, Drawer Animation & Hamburger Icon',
    changes: [
      { type: 'fix', text: 'Hamburger menu icon replaced: bare ☰ character swapped for proper Lucide <Menu size={20} /> at a 44 px touch target with hover/focus states' },
      { type: 'fix', text: 'Mobile drawer animation: replaced broken -8px slideIn with full translateX(-100%)→0 drawerOpen keyframe (0.25 s cubic-bezier); backdrop uses separate fadeInBg animation' },
      { type: 'fix', text: 'Events calendar: 7-column grid wrapped in overflow-x-auto + min-w-[420px] so it scrolls horizontally on small screens without breaking the grid structure' },
      { type: 'fix', text: 'Responsive grid fixes across 6 pages: EventsPage birthday stats, AcademicSection attendance stats, OverdueTab KPI strip, ExamsPage grade KPIs, StudentProfile finance summary, WarningsTab stats strip — all changed from fixed cols to grid-cols-1 sm:grid-cols-N' },
      { type: 'new', text: 'Tailwind config: two new animations (drawer-open, fade-in-bg) and updated keyframes registered for platform-wide use' },
    ],
  },
  {
    version: '4.26.0',
    date: '2026-05-29',
    label: 'Growth Profile — Stabilisation & Bug Fixes',
    changes: [
      { type: 'fix', text: '"deputy" role corrected to "deputy_principal" throughout all growth-profile server routes and GrowthProfilePage — deputy_principal users could not verify records or write recommendations' },
      { type: 'fix', text: 'section_head role added to CAN_VERIFY, CAN_WRITE, and canEdit/canVerify guards — section heads now have the same access as teachers; institution_verified still restricted to admin/deputy_principal' },
      { type: 'fix', text: 'Academic section was showing raw subjectId UUIDs instead of subject names — server now batch-resolves subject names/codes and includes subjectName + subjectCode in the /academic response' },
      { type: 'fix', text: 'RecommendationsSection delete button was shown to all staff for all recommendations (compared two server-side fields that were always equal) — fixed to compare against the current user\'s id' },
    ],
  },
  {
    version: '4.25.0',
    date: '2026-05-29',
    label: 'Leadership Analytics Dashboard',
    changes: [
      { type: 'new', text: 'Leadership analytics panel on Dashboard (premium plan): 4-panel 2×2 grid visible to admin, superadmin, deputy_principal, and section_head roles' },
      { type: 'new', text: 'Attendance Risk panel: per-class attendance rate bars — students below 80% flagged as at-risk, sorted worst-first' },
      { type: 'new', text: 'Fee Exposure panel: outstanding balance, overdue count/amount, and collection rate progress bar — links through to Finance module' },
      { type: 'new', text: 'Behaviour Heatmap: merit vs demerit bar chart per class, high-severity incident badge, links to Behaviour module' },
      { type: 'new', text: 'Academic Health panel: weighted average score per class (published grades only), school-wide average, worst-first sort — links to Grades module' },
      { type: 'new', text: 'Period selector: 7d / 30d / 90d with refresh button; all 4 aggregations run in parallel on the server for a single fast response' },
      { type: 'new', text: 'GET /api/analytics/leadership: single endpoint with 4 parallel MongoDB aggregations, enriches classIds with class names via batch lookup; gated to premium plan' },
    ],
  },
  {
    version: '4.24.0',
    date: '2026-05-29',
    label: 'Notifications Configuration Matrix',
    changes: [
      { type: 'new', text: 'Settings → Notifications tab: per-event / per-channel toggle matrix for 13 notification events across 5 groups (Academic, Finance, Behaviour, System, Messaging)' },
      { type: 'new', text: 'Always-on events (welcome_user, role_changed, password_expiry) are locked and cannot be disabled — displayed with a lock icon and explanatory tooltip' },
      { type: 'new', text: 'server/utils/notif-settings.js: canonical EVENT_REGISTRY, isEnabled() helper, DEFAULTS, ALWAYS_ON, GROUPS — single source of truth for notification configuration' },
      { type: 'new', text: 'GET/PUT /api/settings/notifications: admin-only endpoints; validates event keys and channel booleans; skips always-on events on update' },
      { type: 'fix', text: 'Messages route now checks isEnabled("new_message", "email") before sending notification emails — respects school-level notification preferences; fails open so DB errors never silently suppress notifications' },
    ],
  },
  {
    version: '4.23.0',
    date: '2026-05-29',
    label: 'Animated Login Gradient + Per-School Theme Presets',
    changes: [
      { type: 'new', text: 'Login page left panel: 4-stop CSS gradient with slow animated background-size shift (400% 400%); three floating semi-transparent blobs animate independently for visual depth' },
      { type: 'new', text: 'School logo centered with soft white glow ring; school tagline displayed when set; feature grid for school portals / role list for demo portal' },
      { type: 'new', text: 'Settings → School → Login Page Appearance: 8 animated theme presets (Violet, Ocean, Forest, Sunset, Midnight, Rose, Gold, Slate) — each swatch shows the live gradient animation' },
      { type: 'new', text: 'Custom primary + accent colour pickers with live mini-preview bar; selecting a preset auto-fills both colour fields; custom picker clears the preset ring' },
      { type: 'new', text: 'Server: accentColor + themePreset added to SCHOOL_UPDATABLE in settings.js; themePreset + tagline returned in public school-info response for login page rendering' },
    ],
  },
  {
    version: '4.22.0',
    date: '2026-05-28',
    label: 'Growth Profile — Verified Learner Development Portfolio',
    changes: [
      { type: 'new', text: 'Growth Profile module (standard plan): 8-section verified learner development portfolio accessible at /growth-profile/:studentId via the "Growth Profile" button on every StudentProfile header' },
      { type: 'new', text: 'Academic section: read-only aggregation of grades (weighted averages per subject + overall), attendance (present/absent/late/authorised + rate bar), and latest 3 published report card snapshots — never touches existing academic records' },
      { type: 'new', text: 'Leadership, Activities, Service, Awards: full CRUD + verification workflow with institution_verified / staff_verified / pending_verification / rejected status tiers; generic RecordSection component drives all four' },
      { type: 'new', text: 'Projects section: CRUD + verification with supervisor reference, status lifecycle (planning → in_progress → completed → published), up to 5 evidence URLs, teacher dropdown with denormalized supervisorName to survive soft-deletes' },
      { type: 'new', text: 'Recommendations: staff-write, student-read; confidential flag hides entries from student/parent roles at query level; author name denormalized at write time' },
      { type: 'new', text: 'Aspirations: student self-edit upsert pattern with career interests, university aspirations, intended courses, target countries, personal statement (4 000 chars), future goals; returns empty object (not 404) when unset' },
      { type: 'new', text: 'VerificationBadge: interactive dropdown for admins/teachers to verify/reject entries with optional notes; institution_verified restricted to admin/superadmin/deputy; non-interactive chip for read-only viewers' },
      { type: 'new', text: 'Completion strip: verification progress bar showing verified/total entries on the profile header' },
      { type: 'new', text: '4 new server routes: growth-profile (aggregate + academic read), growth-records (leadership/activities/service/awards), growth-projects, growth-recommendations (+aspirations); 7 new MongoDB collections all tenant-isolated by schoolId' },
      { type: 'new', text: 'RBAC: growth_profile module added to Settings permissions with 8 sub-actions; teacher, parent, and student default permission sets updated; plan gate registered at standard tier' },
    ],
  },
  {
    version: '4.16.0',
    date: '2026-05-26',
    label: 'Engineering — Phase 0 Dependency Blueprint + Phase A Audit Script',
    changes: [
      { type: 'new', text: 'docs/DEPENDENCY_MAP.md: comprehensive Phase 0 dependency blueprint mapping all 23 server modules — collections owned, cross-module FK contracts, shared utility dependencies, blast-radius analysis, and 12 identified audit gaps' },
      { type: 'new', text: 'server/scripts/audit.js: Phase A read-only integrity audit script — runs 11 data integrity checks (orphaned FKs across all modules, teacher userId format drift, timetable double-booking, role permission gaps, class/student enrollment consistency); exits 0=clean, 1=issues, 2=error; outputs full JSON report to stdout; run as: node server/scripts/audit.js [--schoolId=xxx] [--verbose]' },
    ],
  },
  {
    version: '4.15.2',
    date: '2026-05-25',
    label: 'Timetable — Edit Slots + Export + Class Grid Bug Fix',
    changes: [
      { type: 'fix', text: 'Class grid was always empty: class dropdown was storing MongoDB _id instead of the string id field (e.g. "cls_demo_4a"); GET /timetable/class/:classId therefore never matched any slots — fixed to use c.id ?? String(c._id)' },
      { type: 'new', text: 'Click any slot card on the class grid to edit it inline — pre-filled slide-over with subject, day, period, teacher, room, type; saves via PUT /api/timetable/:id' },
      { type: 'new', text: 'Export class timetable as CSV (Download button) or formatted print view (Print button) — appear in the toolbar once a class with lessons is selected' },
      { type: 'fix', text: 'AddSlotSlideOver teacher picker now stores userId (format used by timetable slots) instead of MongoDB ObjectId — fixes teacher display and conflict detection for newly created slots' },
    ],
  },
  {
    version: '4.15.1',
    date: '2026-05-25',
    label: 'Timetable — Conflict & Overview Display Fixes',
    changes: [
      { type: 'fix', text: 'ConflictsPanel now shows the teacher\'s real full name (resolved from teachers collection) instead of raw userId like "u_demo_t3"' },
      { type: 'fix', text: 'ConflictsPanel now shows the names of both clashing classes (e.g. "Form 1A vs Standard 4A") for each teacher/room conflict' },
      { type: 'fix', text: 'Institution Overview now correctly resolves class names (was keying classMap by MongoDB _id instead of the string id field, so all names fell back to raw classId)' },
    ],
  },
  {
    version: '4.15.0',
    date: '2026-05-25',
    label: 'Frontend Decomposition — AdmissionsPage',
    changes: [
      { type: 'new', text: 'AdmissionsPage.jsx (1115 lines) split into 8 focused files: constants.js (PIPELINE, TERMINAL, ALL_STAGES, PRIORITY_CONFIG, EMPTY_FORM, stageMeta, initials, formatDate, avatarColor, exportAdmissionsCSV), AdmissionsPrimitives.jsx (StatChip, Section, Field, inputCls, CardSkeleton, EmptyCol, DetailSection, DetailRow), KanbanBoard.jsx (KanbanBoard + KanbanColumn + ApplicantCard), ListView.jsx, AddSlideOver.jsx, StageModal.jsx, DetailPanel.jsx (with internal PrintLetterModal) — main shell reduced to ~120 lines' },
    ],
  },
  {
    version: '4.14.0',
    date: '2026-05-25',
    label: 'Frontend Decomposition — BehaviourPage',
    changes: [
      { type: 'new', text: 'BehaviourPage.jsx (1268 lines) split into 9 focused files: BehaviourPrimitives.jsx (StageBadge, MilestoneBadge, TypeBadge, StatCard, PaginationBar, EmptyMsg, ErrState, FField, iCls), OverviewTab, AwardTab (4-step wizard), IncidentsTab, AppealsTab, HousesTab, CategoriesTab — main shell reduced to 71 lines; bpsConstants.js retained as-is' },
    ],
  },
  {
    version: '4.13.0',
    date: '2026-05-25',
    label: 'Frontend Decomposition — FinancePage + StudentList bug fix',
    changes: [
      { type: 'new', text: 'FinancePage.jsx (1355 lines) split into 11 focused files: constants.js, FinancePrimitives.jsx, SummaryTab, OverdueTab, InvoicesTab, PaymentsTab, FeeStructureTab, CreateInvoiceSlideOver (+button), RecordPaymentSlideOver (+button), FeeStructureSlideOver (+button) — main shell reduced to 77 lines' },
      { type: 'fix', text: '"View Students" on class cards now correctly pre-filters the student list by class: StudentList.jsx reads ?classId= URL param via useSearchParams (lazy initialiser + useEffect sync), auto-opens filter panel, and shows a dismissible class pill in the header' },
    ],
  },
  {
    version: '4.12.0',
    date: '2026-05-25',
    label: 'Frontend Decomposition — GradesPage',
    changes: [
      { type: 'new', text: 'GradesPage.jsx (1432 lines) split into 11 focused files: constants.js, GradesPrimitives.jsx, ExamsListTab, ExamResultsTab, CreateExamSlideOver, MarkEntryTab, ReportCardsTab, StudentReportCard, ConfigTab, RemindersTab — main shell reduced to 72 lines' },
      { type: 'new', text: 'TimetablePage.jsx (1883 lines) previously split into 11 files — constants.js, TimetablePrimitives, TimetableGrid, WorkloadPanel, ConflictsPanel, AddSlotSlideOver, BellScheduleSlideOver, OverviewView, CoverTab, PublishModal — main shell at 487 lines' },
    ],
  },
  {
    version: '4.11.9',
    date: '2026-05-25',
    label: 'Phase 7 — Behaviour Module Bug Fixes',
    changes: [
      { type: 'fix', text: '"Validation failed" on Award Points confirm/submit: frontend was not sending the required `title` field — now maps item.label to title (required by IncidentSchema)' },
      { type: 'fix', text: 'Teacher notes on incidents were silently discarded: `note` field was stripped by Zod because it was absent from IncidentSchema — added note: z.string().max(1000).optional() to backend schema so notes are now persisted' },
    ],
  },
  {
    version: '4.11.8',
    date: '2026-05-25',
    label: 'Phase 6 — HR Staff Tab Rebuild',
    changes: [
      { type: 'new',  text: 'Staff cards rebuilt: staffType chip, status badge, department name, extra roles pills, chevron — click any card to open the detail panel' },
      { type: 'new',  text: 'StaffDetailPanel slide-over: 3 tabs — Profile (contact/personal), Employment (roles, subjects, contract), HR Records (national ID, NSSF, SHA, KRA PIN, next of kin)' },
      { type: 'new',  text: 'Add Staff button (HR/Admin only): opens StaffFormModal with 4 sections — Personal Details, Employment, Roles & Responsibilities, HR Records' },
      { type: 'new',  text: 'Edit Staff: HR Records tab in detail panel has an "Edit" button — opens pre-filled modal for updating any profile field including sensitive HR data' },
      { type: 'new',  text: 'Staff search bar: live filter by name, email, or staff ID — no server round-trip' },
      { type: 'new',  text: 'Teaching subjects multi-select in form (visible when staffType = teacher); subjects list fetched lazily only when form is open' },
      { type: 'new',  text: 'Backend: teachers Zod schema extended with staffType, departmentId, extraRoles, formClassId, specialization, nationalId, nssfNo, shaNo, kraPinNo, nextOfKin' },
    ],
  },
  {
    version: '4.11.7',
    date: '2026-05-25',
    label: 'Phase 5 — HR Payroll Monthly Management',
    changes: [
      { type: 'new',  text: 'Payroll tab: "Add Entry" button opens a modal with staff selector, pay period, basic salary, allowances, deductions, and a live gross/net summary panel' },
      { type: 'new',  text: 'Inline edit per row: hover reveals edit (pencil) and delete (trash) icons — edit pre-fills the modal with existing values, staff and period are locked in edit mode' },
      { type: 'new',  text: 'Copy from previous period: one-click button copies all payroll records from the previous month into the current period, skipping already-existing entries' },
      { type: 'new',  text: 'POST /api/hr/payroll now uses $set + $setOnInsert pattern — ensures a stable id is assigned on creation while still allowing salary updates via upsert' },
      { type: 'new',  text: 'POST /api/hr/payroll/copy: copy endpoint for period-to-period salary migration (HR/Admin only)' },
      { type: 'new',  text: 'DELETE /api/hr/payroll?staffId=X&period=YYYY-MM: removes a specific payroll record per staff per period' },
      { type: 'new',  text: 'Seed: May 2026 payroll added alongside April 2026 — UI shows 10 records on first load (no more empty state on current month)' },
      { type: 'fix',  text: 'Empty payroll state now shows a clear CTA ("Add Entry") with a hint about the copy feature instead of a bare "No records" message' },
    ],
  },
  {
    version: '4.11.6',
    date: '2026-05-25',
    label: 'Phase 4 — Subjects Page Rebuild (4 Tabs)',
    changes: [
      { type: 'new',  text: 'SubjectsPage rebuilt as a tabbed shell with 4 tabs: Catalog, Curriculum, Enrollment, Warnings — shared toast hoisted to parent' },
      { type: 'new',  text: 'Curriculum tab: two-column editor — left shows class curriculum with compulsory toggle and remove-with-enrollment-guard; right shows available subjects filtered by sectionKey compatibility' },
      { type: 'new',  text: 'Curriculum tab: section compatibility filter (subject.sections includes "all" or the class sectionKey) and department pill filters; "Add all compatible" bulk assign' },
      { type: 'new',  text: 'Enrollment tab: class + subject selectors (curriculum-aware), bulk "Enroll class" button, individual student search (min 2 chars), enrolled list with unenroll per student' },
      { type: 'new',  text: 'Warnings tab: expandable class cards with belowMin/aboveMax summary badges, expandable per-student breakdown; school-wide and per-class views; Refresh button + stats strip' },
      { type: 'new',  text: 'API client: classSubjects (counts, list, warnings, assign, bulk, update, remove) and subjectRules (list, get, create, update, remove) exported' },
    ],
  },
  {
    version: '4.11.5',
    date: '2026-05-25',
    label: 'Phase 3 — Subject Enrollment Warnings Engine',
    changes: [
      { type: 'new',  text: 'GET /api/class-subjects/enrollment-warnings: school-wide or per-class report — students flagged as below_min, above_max, or ok based on subject_rules' },
      { type: 'new',  text: 'Rule resolution: classPattern (regex) takes priority over section match — enables KCSE Form 3-4 overrides over the general secondary rule' },
      { type: 'new',  text: 'School-wide mode (no classId param): returns only classes that have at least one violation — zero-noise dashboard feed for the timetabler' },
      { type: 'new',  text: 'Per-student breakdown: subjectCount, status (ok/below_min/above_max/no_rule), and summary counts per class' },
    ],
  },
  {
    version: '4.11.4',
    date: '2026-05-25',
    label: 'Phase 2 — Class Curriculum & Subject Rules APIs',
    changes: [
      { type: 'new',  text: 'GET/POST/PUT/DELETE /api/class-subjects: assign subjects to a class, manage compulsory flag, remove with enrollment guard' },
      { type: 'new',  text: 'GET /api/class-subjects/counts: { classId: subjectCount } for class cards and dropdowns' },
      { type: 'new',  text: 'POST /api/class-subjects/bulk: assign multiple subjects to a class in one call (idempotent — skips already-assigned)' },
      { type: 'new',  text: 'GET/POST/PUT/DELETE /api/subject-rules: min/max subject count rules per section or classPattern (timetable:update gated)' },
      { type: 'new',  text: 'GET /api/subjects?withClassCurriculum=classId: attaches inCurriculum, isCompulsoryForClass, classSubjectId per subject for the curriculum editor' },
    ],
  },
  {
    version: '4.11.3',
    date: '2026-05-25',
    label: 'Phase 1 — A-Level Classes · Subject Curriculum · Enrollments',
    changes: [
      { type: 'new',  text: 'A-Level section: Form 5A and Form 6A classes added (sectionKey: alevel); 4 new subjects — Pure Mathematics, Mechanics, Statistics & Probability, Economics' },
      { type: 'new',  text: 'Class curriculum (class_subjects): 96 subject-to-class links seeded across all 9 classes — primary compulsory core, secondary KCSE model, A-Level all-elective' },
      { type: 'new',  text: 'Student subject enrollments (student_subjects): 163 individual records for all 20 demo students, reflecting science/humanities/primary curriculum tracks' },
      { type: 'new',  text: 'Subject enrollment rules (subject_rules): min/max subjects per section — Primary 6-8, Form 1-2: 7-10, KCSE Form 3-4: 7-9, A-Level: 3-4' },
      { type: 'new',  text: 'Teacher profiles enriched: staffType, departmentId, subjects[], extraRoles (hod/class_teacher/exam_officer/timetabler), formClassId — all 10 profiles updated' },
      { type: 'fix',  text: 'Departments now store hodId + hodUserId (teacher profile and user ID foreign keys) — patched via $set on every re-seed so legacy docs are upgraded' },
      { type: 'fix',  text: 'Subject sections always updated on re-seed — fixes docs seeded before A-Level section existed (e.g. Physics was [secondary], now [secondary, alevel])' },
    ],
  },
  {
    version: '4.11.2',
    date: '2026-05-25',
    label: 'Timetable Seed Fix + Substitution Engine Bug Fixes',
    changes: [
      { type: 'fix',  text: 'Critical: seed-demo-data.js was writing timetable slots to wrong MongoDB collection (timetable_slots instead of timetable) — all 60 slots were invisible to the API, causing empty class grids and "No lessons found" errors' },
      { type: 'fix',  text: 'Teacher ID mismatch in substitution engine: mark-absent now resolves teacher by both profile id and userId via $or lookup, queries slots with $in to match either format' },
      { type: 'fix',  text: 'Available-teachers and auto-assign now check both t.userId and t.id against busy/absent/covered sets so no teacher is silently excluded or shown as available when busy' },
      { type: 'new',  text: 'Full timetable seed for all 7 classes: Standard 5A, 6A, Form 2A, 3A, 4A added (25–30 slots each) — total 205 slots up from 60' },
      { type: 'new',  text: 'All timetable slots now include subject display string and className — substitution cover sheet shows meaningful names instead of IDs' },
    ],
  },
  {
    version: '4.11.1',
    date: '2026-05-24',
    label: 'Smart Cover Sheet & Substitution Engine',
    changes: [
      { type: 'new',  text: 'Substitution table matches aSc format: Absent | Lesson | Reason | Subject | Class | Type | Substitutes | Signature' },
      { type: 'new',  text: 'Smart substitute picker: free teachers ranked same-department first, then fewest weekly lessons; top pick flagged with ⭐' },
      { type: 'new',  text: 'Auto-assign all: fills every uncovered lesson in one click using best available teacher, period-by-period double-booking prevention' },
      { type: 'new',  text: 'Type selector per lesson row: Supervision / Cover / Teaching' },
      { type: 'new',  text: 'Summary header: "Mr. Godfrey (5, 7) and Ms. Beatrice (2)" generated from live absence data' },
      { type: 'new',  text: 'Print-ready cover sheet: signature column, timestamp footer, interactive elements hidden' },
    ],
  },
  {
    version: '4.11.0',
    date: '2026-05-24',
    label: 'Events Birthdays · HR Document Links · Users Filter',
    changes: [
      { type: 'new',  text: 'Events: Birthdays view — browse all student and staff birthdays by month with avatar cards, class/role meta, and today\'s birthday banner' },
      { type: 'new',  text: 'Events: calendar cells show birthday count overlay; clicking switches to birthdays view for that month' },
      { type: 'new',  text: 'HR Documents: document link field — paste a Google Drive / OneDrive / Dropbox URL; "View Document" link appears on the card' },
      { type: 'new',  text: 'Settings › Users: filter by role (13 roles) + name/email search with "X of Y users" count display' },
    ],
  },
  {
    version: '4.10.2',
    date: '2026-05-24',
    label: 'Timetable Cover / Subs Tab + Publish History',
    changes: [
      { type: 'new',  text: 'Cover / Subs tab: daily cover sheet for absent teachers — visible to admin, deputy, and timetabler roles only' },
      { type: 'new',  text: 'Mark teacher absent: auto-pulls all their lessons for that weekday from the master timetable' },
      { type: 'new',  text: 'Substitution records stored separately — master timetable is never modified' },
      { type: 'new',  text: 'Publish history: every timetable publish creates a version snapshot (term label, slot count, timestamp)' },
    ],
  },
  {
    version: '4.10.1',
    date: '2026-05-24',
    label: 'Legacy App Removal + Reference Fixes',
    changes: [
      { type: 'fix',  text: 'Deleted 29,000+ lines of legacy vanilla-JS frontend — React SPA is the only served app' },
      { type: 'fix',  text: 'Demo login links, onboarding URLs, and platform.html all updated to correct /login route and demo slug' },
      { type: 'sec',  text: 'DB name safety: added warning comment; MONGODB_DB_NAME env var is now the override path' },
    ],
  },
  {
    version: '4.10.0',
    date: '2026-05-24',
    label: 'Security Hardening + Google & Microsoft OAuth + M-Pesa',
    changes: [
      { type: 'sec',  text: 'Removed plain-text password fallback — all accounts must have a bcrypt hash' },
      { type: 'sec',  text: 'OTP generation upgraded to Node.js CSPRNG (crypto.randomInt); M-Pesa callbacks enforce Safaricom IP allowlist' },
      { type: 'new',  text: 'Google OAuth 2.0 sign-in: one-click login with Google account' },
      { type: 'new',  text: 'Microsoft OAuth 2.0 sign-in: one-click login with Microsoft / school account' },
      { type: 'new',  text: 'Settings › Subscription tab: M-Pesa STK Push for platform plan payments (Core / Standard / Premium)' },
    ],
  },
  {
    version: '4.9.19',
    date: '2026-05-20',
    label: 'Subjects & Departments Registry',
    changes: [
      { type: 'new',  text: 'Subjects & Departments page: department cards with collapsible subject lists, colour badges, and HoD names' },
      { type: 'new',  text: 'Full CRUD for departments (name, code, colour, HoD) and subjects (code, short name, sections, compulsory flag)' },
      { type: 'new',  text: 'HoD field auto-completes from the teacher roster' },
      { type: 'fix',  text: 'Department delete blocked when active subjects still exist' },
    ],
  },
  {
    version: '4.9.13',
    date: '2026-05-21',
    label: 'Settings & Timetable Rebuild',
    changes: [
      { type: 'new',  text: 'Settings: full multi-tab rebuild — School, Branding, Users, Academic, Integrations, Billing' },
      { type: 'new',  text: 'Timetable: full weekly grid with bell schedule, conflict detection, and publish/unpublish workflow' },
      { type: 'new',  text: 'Bell schedule editor per section (Primary / Secondary)' },
      { type: 'fix',  text: 'Subjects: enrollment counts now reflect live student-subject links' },
      { type: 'perf', text: 'Reduced bundle size for Settings module by 18%' },
    ],
  },
  {
    version: '4.9.12',
    date: '2026-05-14',
    label: 'Grades & Assessment Rebuild',
    changes: [
      { type: 'new',  text: 'Grades page: CA/HW/MT/ET assessment system with configurable weights' },
      { type: 'new',  text: 'Assessment schedule builder — define tasks per term and subject' },
      { type: 'new',  text: 'Markbook view: enter marks per student per assessment task' },
      { type: 'new',  text: 'Grade report with overall average, grade letter, and teacher remarks' },
      { type: 'fix',  text: 'Fixed rounding error in weighted average calculation for borderline grades' },
    ],
  },
  {
    version: '4.9.11',
    date: '2026-05-07',
    label: 'Behaviour & Student Profile',
    changes: [
      { type: 'new',  text: 'Behaviour: Behaviour Point System (BPS) — merit/demerit tracking with points ledger' },
      { type: 'new',  text: 'Behaviour: appeal workflow — students can submit appeals; staff resolve with notes' },
      { type: 'new',  text: 'Student profile: behaviour history, attendance timeline, fee status in one view' },
      { type: 'fix',  text: 'Behaviour summary counts now exclude withdrawn students' },
    ],
  },
  {
    version: '4.9.10',
    date: '2026-04-30',
    label: 'Finance Module',
    changes: [
      { type: 'new',  text: 'Finance: invoice management with void, partial payment, and balance tracking' },
      { type: 'new',  text: 'Finance: payment recording with receipt number and method (M-PESA, bank, cash, cheque)' },
      { type: 'new',  text: 'Finance dashboard: outstanding vs collected summary, top defaulters list' },
      { type: 'sec',  text: 'Finance routes now require explicit finance or admin role — teachers cannot access' },
    ],
  },
  {
    version: '4.9.9',
    date: '2026-04-21',
    label: 'Admissions Pipeline',
    changes: [
      { type: 'new',  text: 'Admissions: 9-stage Kanban pipeline — enquiry → enrolled' },
      { type: 'new',  text: 'Admissions: stage change history with timestamps and staff notes' },
      { type: 'new',  text: 'Admissions stats: conversion rate by stage, monthly applications chart' },
      { type: 'fix',  text: 'Admissions CSV import now correctly maps applyingForClass field' },
    ],
  },
  {
    version: '4.9.8',
    date: '2026-04-14',
    label: 'Attendance & Messages',
    changes: [
      { type: 'new',  text: 'Attendance: bulk mark (present/absent/late/excused) for the entire class in one click' },
      { type: 'new',  text: 'Attendance: summary view — monthly heatmap per student' },
      { type: 'new',  text: 'Messages: in-app messaging between staff, parents, and students' },
      { type: 'fix',  text: 'Attendance date picker now defaults to today and cannot be set in the future' },
    ],
  },
  {
    version: '4.9.7',
    date: '2026-04-07',
    label: 'Multi-Tenant SaaS Foundation',
    changes: [
      { type: 'new',  text: 'Multi-tenant architecture: each school gets an isolated DB namespace (schoolId scoping)' },
      { type: 'new',  text: 'Subdomain routing: demo.msingi.io, school-slug.msingi.io auto-detected and branded' },
      { type: 'new',  text: 'Onboarding flow: new schools can self-provision with guided setup wizard' },
      { type: 'sec',  text: 'JWT tokens now include schoolId — cross-tenant data access is impossible' },
      { type: 'perf', text: 'MongoDB indexes added on schoolId + role for all critical collections' },
    ],
  },
];

const TYPE_CONFIG = {
  new:  { label: 'New',         Icon: Sparkles, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  fix:  { label: 'Fix',         Icon: Bug,       cls: 'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-300'    },
  perf: { label: 'Performance', Icon: Zap,       cls: 'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-300'  },
  sec:  { label: 'Security',    Icon: Shield,    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

export default function ChangelogPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Changelog</h1>
        <p className="text-slate-500 mt-1 text-sm">What's new in Msingi — release notes and updates.</p>
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-200" />
        <div className="space-y-8">
          {RELEASES.map((rel, i) => (
            <motion.div
              key={rel.version}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="relative pl-7"
            >
              {/* Dot */}
              <span className="absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 ring-4 ring-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </span>

              {/* Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                        <Tag size={10} /> v{rel.version}
                      </span>
                      <span className="text-xs text-slate-400">{rel.date}</span>
                    </div>
                    <h2 className="mt-1.5 font-semibold text-slate-900">{rel.label}</h2>
                  </div>
                </div>

                <ul className="space-y-2">
                  {rel.changes.map((c, j) => {
                    const cfg = TYPE_CONFIG[c.type] ?? TYPE_CONFIG.new;
                    const { Icon } = cfg;
                    return (
                      <li key={j} className="flex items-start gap-2.5 text-sm text-slate-700">
                        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold mt-0.5 ${cfg.cls}`}>
                          <Icon size={9} /> {cfg.label}
                        </span>
                        <span>{c.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
