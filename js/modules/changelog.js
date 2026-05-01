/* ============================================================
   InnoLearn — Changelog Module
   In-app version history viewer (admin / superadmin only)
   ============================================================ */

const Changelog = (() => {

  /* ── Version data ─────────────────────────────────────── */
  const VERSIONS = [
    {
      version: '3.4.0',
      date: '2026-05-01',
      tag: 'security',
      title: 'Password Rotation · User Invites · Role Notifications · Security Hardening',
      sections: [
        {
          heading: 'Security — Critical Fixes',
          type: 'security',
          items: [
            'GET /api/collections/users no longer returns bcrypt password hashes or MFA fields to any client',
            'Role-based write guards: only admin/superadmin can create, update, or delete users and permissions',
            'Non-superadmin cannot assign superadmin role or modify their own role',
            'Password field cannot be overwritten via the generic PUT endpoint',
            'Added <code>helmet</code> HTTP security headers (X-Frame-Options, HSTS, Referrer-Policy, etc.)',
            'CORS restricted to known origins in production; unknown origins blocked and logged',
            'Server warns on startup if JWT_SECRET env var is not set',
            'bcrypt cost factor raised from 10 → 12 for stronger password hashing',
          ]
        },
        {
          heading: 'New — 60-Day Password Rotation',
          type: 'security',
          items: [
            'All passwords expire after 60 days — enforced at login; no JWT issued until changed',
            'Force-change screen with real-time hints (length ✓, match ✓) replaces login form',
            'First-login users (mustChangePassword) see a "Set your password" screen',
            'Security confirmation email sent after every password change',
            'Dashboard banner for all users when ≤ 7 days left (blue → amber → red)',
            'Email reminders at 7 / 3 / 1 / 0 days before expiry (deduplicated per day)',
          ]
        },
        {
          heading: 'New — User Invite System',
          type: 'new',
          items: [
            'POST /api/users/invite — create single user with temp password + send welcome email',
            'POST /api/users/bulk-invite — up to 200 users from JSON array, individual emails per user',
            'Invited users must set their own password on first login',
            'Bulk invite returns { created, skipped, errors } summary for admin review',
          ]
        },
        {
          heading: 'New — User Event Email Notifications',
          type: 'new',
          items: [
            'Welcome email with branded credentials sent to every new invited user',
            'Password changed: security confirmation after any update (forced or voluntary)',
            'Role change: automatic email when a user\'s role is updated via the dashboard',
            'Password expiry reminder emails at 7 / 3 / 1 / 0 days (deduplicated)',
          ]
        },
      ]
    },
    {
      version: '3.3.0',
      date: '2026-05-01',
      tag: 'security',
      title: 'Security · Real-time Slug Check · 2FA · Trial Reminders',
      sections: [
        {
          heading: 'New — Real-time Slug Availability Check',
          type: 'new',
          items: [
            'Live availability indicator as admin types school URL slug during registration (500 ms debounce)',
            'Green tick = available · Red warning = taken or reserved word · spinner during check',
            'Reserved words (admin, api, platform, www, innolearn…) blocked client-side immediately',
            'Slug auto-checked when auto-filled from school name',
            'Server: <code>GET /api/onboard/check-slug</code> with 60-request/min rate limiter',
          ]
        },
        {
          heading: 'New — Auto-Logout After 10 Minutes Inactivity',
          type: 'security',
          items: [
            'Authenticated sessions are signed out after 10 minutes of no user activity',
            'At 9 minutes an amber persistent toast warns the user with a "Stay signed in" button',
            'Any activity (mouse, keyboard, scroll, touch) resets the idle timer',
            'Timer polled every 30 seconds via setInterval — negligible CPU cost',
            'Protects shared and unattended devices from session hijacking',
          ]
        },
        {
          heading: 'New — Two-Factor Authentication for Super Admin (Email OTP)',
          type: 'security',
          items: [
            'After password verified, superadmin login is paused and a 6-digit OTP is emailed',
            'OTP valid for 5 minutes; separate rate limiter (10 attempts / 5 min) prevents brute-force',
            'Login form replaced by OTP entry screen with countdown guidance and "Back to login" link',
            'JWT is never issued until OTP is verified — no partial session exposure',
            'OTP cleared from DB immediately on success or expiry',
            'Future per-user opt-out supported via <code>mfaEnabled: false</code> flag',
          ]
        },
        {
          heading: 'New — Trial Expiry Reminders',
          type: 'new',
          items: [
            'Dashboard banner visible to school admin and superadmin when trial ≤ 7 days remaining',
            'Colour-coded urgency: blue (7 d) → amber (3 d) → red (1 d / expiry day)',
            'Email reminders sent automatically at 7, 3, 1 days and on expiry day',
            'Deduplication: each milestone reminder sent at most once per day per school',
            'Triggered on login — no background job or cron required',
          ]
        },
      ]
    },
    {
      version: '3.2.0',
      date: '2026-05-01',
      tag: 'new',
      title: 'School Approval Workflow · Email Notifications · Setup Wizard',
      sections: [
        {
          heading: 'New — School Approval Workflow',
          type: 'new',
          items: [
            'New schools registered via /onboard are created with <strong>status: pending</strong> — not activated automatically',
            'Platform admin must approve or reject each registration from the Platform dashboard',
            'On approval: school + superadmin activated, welcome email sent to school admin, confirmation sent to platform owner',
            'On rejection: optional reason captured; rejection email sent to the school admin',
          ]
        },
        {
          heading: 'New — Email Notifications',
          type: 'new',
          items: [
            'Gmail SMTP transactional email via nodemailer (<code>innolearnnetwork@gmail.com</code>)',
            'Registration received → school admin gets "under review" confirmation',
            'New registration alert → platform owner gets full school details + dashboard link',
            'Approval welcome → login URL, credentials reminder, plan info sent to school admin',
            'Rejection notice → reason + re-application instructions sent to school admin',
            'Approval self-alert → platform owner copy of every approval',
            'All emails use a branded HTML template with InnoLearn colours and status badges',
          ]
        },
        {
          heading: 'New — Platform Dashboard: Pending Approvals Tab',
          type: 'new',
          items: [
            'New "Pending" sidebar nav item with a live red badge showing pending school count',
            'Each pending card shows school name, admin details, location, curriculum, plan, and timestamp',
            'Approve button — one click activates school + triggers welcome emails',
            'Reject button — optional reason modal before sending notification',
            'Badge auto-refreshes after each action; badge loads on platform admin login',
          ]
        },
        {
          heading: 'New — Demo Role Selector Panel',
          type: 'new',
          items: [
            'Login page demo section redesigned as a 6-card role grid (Super Admin, Teacher, Parent, Finance, Student, Deputy)',
            'Each card shows role icon, name, and scope description',
            'Clicking a card fills credentials, highlights the card, and shows a green info strip',
            'Super Admin pre-selected when landing via <code>?demo=innolearn</code>',
          ]
        },
        {
          heading: 'New — Setup Wizard for New Schools',
          type: 'new',
          items: [
            'Super Admin dashboard shows a setup checklist on first login',
            '7 steps with live % completion bar: profile · academic year · classes · staff · students · fees · reports',
            'Each incomplete step is clickable — navigates directly to the relevant module',
            'Dismiss button stores preference per school in localStorage',
            'Wizard hides automatically when all 7 steps are complete',
          ]
        },
        {
          heading: 'Changed — Curriculum & T&C Gate',
          type: 'improved',
          items: [
            'Curriculum chips updated: CBE (Kenya), IB, British (Cambridge/Edexcel), American — card layout with subtitle',
            'Launch My School button disabled by default; ticking T&C checkbox enables it',
            'Registration success: pending state shows "Application Submitted ⏳"; offline fallback unchanged',
          ]
        },
        {
          heading: 'Security — Pending Login Block',
          type: 'security',
          items: [
            'Login returns 403 <code>pending_approval</code> for pending schools instead of generic "wrong password"',
            'Frontend replaces login form with a friendly "Application Under Review" screen',
            'Rejected schools see a toast with support email contact',
          ]
        },
      ]
    },
    {
      version: '3.1.5',
      date: '2026-04-30',
      tag: 'improved',
      title: 'Brand Rename — SchoolSync → InnoLearn',
      sections: [
        {
          heading: 'Rebranding',
          type: 'improved',
          items: [
            'Platform renamed from <strong>SchoolSync</strong> to <strong>InnoLearn</strong> across all 46 source files',
            'Demo school renamed from Meridian International School to <strong>InnoLearn International School</strong>',
            'All email domains, slugs, DB names, and identifiers updated to <code>innolearn</code>',
            'package.json, render.yaml, .env.example, seed utility, and all documentation updated',
          ]
        },
      ]
    },
    {
      version: '3.1.4',
      date: '2026-04-30',
      tag: 'new',
      title: 'Platform Admin Dashboard & Demo Pill Security',
      sections: [
        {
          heading: 'New — Platform Admin SPA (/platform)',
          type: 'new',
          items: [
            'Key-based lock screen — platform owner enters PLATFORM_ADMIN_KEY; stored in sessionStorage (auto-clears on browser close)',
            'Offline mode — works without MongoDB; shows live data when server is connected',
            'Overview: 4 stat cards (Total Schools, Total Students, MRR, ARR) + plan breakdown grid',
            'Schools table with name, slug, plan, status, student/staff counts, trial end date',
            'Actions: Impersonate (Log In as school), Change Plan, Suspend / Reinstate',
            'Provision School form — create a new school directly from the platform dashboard',
            'All calls carry X-Platform-Key header — no JWT, no cookies for the platform layer',
          ]
        },
        {
          heading: 'Changed — Demo Pills Hidden in Production',
          type: 'security',
          items: [
            'Demo credential pills are now hidden by default (display:none)',
            'Visible only on localhost / 127.0.0.1 or with ?demo=1 in the URL',
            '?demo=InnoLearn auto-fills InnoLearn International School superadmin credentials',
          ]
        },
        {
          heading: 'Infrastructure',
          type: 'improved',
          items: [
            'Explicit /platform route added to server/index.js — serves platform.html cleanly',
            'Server health endpoint version bumped to 3.1.4',
          ]
        },
      ]
    },
    {
      version: '3.1.2',
      date: '2026-04-30',
      tag: 'new',
      title: 'Curriculum & Section Selection in Onboarding',
      sections: [
        {
          heading: 'New — Curriculum Selection',
          type: 'new',
          items: [
            'Multi-select chips: Cambridge, IB, CBC, KCSE/KCPE, CAPS, WAEC, Uganda, Montessori, Custom/Mixed',
            'Quick resource links appear per selected curriculum — Cambridge International, IBO, KICD, KNEC, DBE, WAEC, UNEB, AMI',
            'Curriculum stored on school record and shown in Review + success screen',
          ]
        },
        {
          heading: 'New — School Sections Picker',
          type: 'new',
          items: [
            '4 section cards: KG/Pre-Primary, Primary, Secondary, Sixth Form/A-Level',
            'Each card shows applicable grade levels (e.g. "Form 1–4 · Grade 7–12 · Year 7–11")',
            'At least one section required — inline error message if skipped',
            'Sections stored on school record and used to drive seeding',
          ]
        },
        {
          heading: 'System Integration — Section-aware Seeding',
          type: 'improved',
          items: [
            '<code>_seedBaseData</code> now seeds only the sections the school selected',
            'A KG-only school sees only KG; a Secondary-only school sees no KG or Primary',
            'Classes, Students, Timetable, Attendance naturally filter by sectionId — no downstream changes needed',
          ]
        },
      ]
    },
    {
      version: '3.1.1',
      date: '2026-04-30',
      tag: 'security',
      title: 'Onboarding Security Hardening & Documentation Expansion',
      sections: [
        {
          heading: 'Security — Anti-bot (Onboarding)',
          type: 'improved',
          items: [
            'Honeypot field — hidden input; bots fill it, humans don\'t; silently rejected server-side',
            'Timing check — form submitted in under 4 seconds is rejected (bots are instant)',
            'Institutional email advisory — warns users entering personal email addresses (gmail, yahoo, etc.)',
            'Disposable email blocklist — 25+ known temporary email domains blocked at registration',
            'Rate limiting (pre-existing) — 5 registrations per IP per hour',
          ]
        },
        {
          heading: 'Deferred Security (Planned)',
          type: 'improved',
          items: [
            'reCAPTCHA v3 — invisible bot challenge (planned)',
            '2FA / TOTP — authenticator app for Super Admin (planned)',
            'Email OTP verification — verify email before provisioning (requires SMTP)',
          ]
        },
        {
          heading: 'Changes',
          type: 'improved',
          items: [
            'School Type: replaced "Charter" with "Tuition Centre"',
            '"Try the InnoLearn demo" link added to onboarding left panel',
          ]
        },
        {
          heading: 'New Documentation',
          type: 'new',
          items: [
            '<strong>Platform Admin Guide</strong> — architecture, env setup, provisioning API, MRR monitoring, security, backup',
            '<strong>School Admin Guide</strong> — first-time setup, staff roles, enrollment, billing, branding, demo school',
            '<strong>User Guide</strong> updated to v3.1 with cross-links to admin guides',
          ]
        },
      ]
    },
    {
      version: '3.1.0',
      date: '2026-04-30',
      tag: 'new',
      title: 'School Onboarding / Self-registration Flow',
      sections: [
        {
          heading: 'New — Onboarding Wizard',
          type: 'new',
          items: [
            '4-step self-service wizard at <code>/onboard</code>: School Details → Admin Account → Choose Plan → Review &amp; Launch',
            'Auto-generates URL slug from school name with live sanitisation and editable override',
            'Password strength meter, plan selector cards (Core / Standard / Premium / Enterprise)',
            'Pre-selects <em>Standard</em> plan with a "Most Popular" badge',
            'Review step summarises all entered data before submission',
            'Success screen shows school details, trial end date, and auto-login link',
            'Fully responsive — left step-indicator panel collapses on mobile',
          ]
        },
        {
          heading: 'New — Server Endpoint',
          type: 'new',
          items: [
            '<code>POST /api/onboard</code> — public, rate-limited (5 registrations/IP/hour)',
            'Validates slug &amp; email uniqueness; auto-generates slug if not provided',
            'Creates school with country-aware currency, timezone, and trial expiry (30 days)',
            'Creates Super Admin with bcrypt-hashed password (12 rounds)',
            'Seeds: academic year + 3 terms, 4 default sections, role permissions for all 13 roles',
            'Issues JWT on success; returns session payload for localStorage-mode fallback',
            'Offline mode (no MongoDB): provisions locally without JWT — suitable for demo environments',
          ]
        },
      ]
    },
    {
      version: '3.0.0',
      date: '2026-04-28',
      tag: 'major',
      title: 'SaaS Backend · Multi-tenancy · Subscription Plans',
      sections: [
        {
          heading: 'New — Node.js/Express Backend',
          type: 'new',
          items: [
            'Express API server — serves both <code>/api/*</code> and the static frontend from a single Render deployment',
            'MongoDB Atlas integration via Mongoose — graceful offline fallback when DB not configured',
            'Health check at <code>/api/health</code>; <code>render.yaml</code> updated for production deployment',
            'Hybrid data layer — localStorage stays the synchronous source of truth; all writes mirror to MongoDB async in the background',
            '<code>GET /api/sync</code> — downloads all school data on login; <code>POST /api/sync</code> — pushes localStorage to server (migration tool)',
          ]
        },
        {
          heading: 'New — JWT Authentication',
          type: 'new',
          items: [
            'Server login at <code>POST /api/auth/login</code> with rate limiting (20 attempts / 15 min)',
            'bcrypt password hashing; plain-text fallback during migration period',
            'Frontend falls back to localStorage login if server is unreachable — zero downtime transition',
            'JWT stored in <code>localStorage</code>/<code>sessionStorage</code>; cleared on logout',
          ]
        },
        {
          heading: 'New — Multi-tenancy',
          type: 'new',
          items: [
            'School resolved from JWT, <code>X-School-Slug</code> header, subdomain, or custom domain',
            'Every API route auto-scoped to <code>schoolId</code> — complete data isolation between schools',
            'Platform admin API (protected by <code>X-Platform-Key</code>): provision schools, change plans, impersonate, view MRR stats',
          ]
        },
        {
          heading: 'New — Subscription Plans & Feature Gating',
          type: 'new',
          items: [
            '<strong>Core</strong> KES 15K/month — all school operations (students, attendance, academics, comms, reports)',
            '<strong>Standard</strong> KES 35K/month — adds Timetable &amp; Behaviour modules',
            '<strong>Premium</strong> KES 65K/month — adds Finance &amp; HR modules',
            '<strong>Enterprise</strong> — custom pricing, all modules + mobile app + white-label',
            'Locked sidebar items show 🔒 icon; navigating to a locked module shows a full Upgrade Wall with pricing',
            'Plan badge shown in the sidebar footer',
          ]
        },
      ]
    },
    {
      version: '2.7.1',
      date: '2026-04-28',
      tag: 'patch',
      title: 'Birthday Calendar Popup',
      sections: [
        {
          heading: 'Improved — Clickable Birthday Dots',
          type: 'changed',
          items: [
            '🎂 calendar dot is now clickable — opens a modal with all people celebrating on that day',
            'Modal shows avatar, name, role/class, and a "Turns N! 🎉" badge for today or "Age N" for future dates',
            'Hover animation on the dot (scale-up) hints interactivity',
            '<code>Events.viewBirthdays(year, month, day)</code> — new public function added to the Events module',
          ]
        },
      ]
    },
    {
      version: '2.7.0',
      date: '2026-04-28',
      tag: 'minor',
      title: 'Birthday System',
      sections: [
        {
          heading: 'New — Birthday Detection & Greetings',
          type: 'new',
          items: [
            'New <code>Birthday</code> module (<code>js/modules/birthday.js</code>) — detects birthdays for all active students and staff using annual MM-DD matching',
            'Own birthday modal — logged-in user whose birthday is today sees a celebratory modal ~1 s after login, showing their name and turning age',
            'Staff toast notifications — admin, teacher, deputy, and pastoral staff receive a toast for every other person whose birthday is today',
            'Notification bell — today\'s birthdays are injected at the top of the dropdown with a 🎂 icon and pink accent; badge count incremented',
            'Dashboard birthday card — appears between the stats grid and charts on the admin dashboard; shows today\'s celebrants (pink avatar, age badge) and upcoming birthdays within 7 days (countdown + date)',
            'Calendar birthday indicators — 🎂 emoji shown next to day numbers in the Events calendar for any day with a birthday; tooltip lists all names',
          ]
        },
        {
          heading: 'Technical',
          type: 'changed',
          items: [
            '<code>Birthday.init()</code> called from <code>App._showApp()</code> after <code>_buildNotifications()</code>',
            'Public API: <code>todaysBirthdays()</code>, <code>upcomingBirthdays(days)</code>, <code>birthdaysOnDate(y,m,d)</code>, <code>dashboardCard()</code>',
            '<code>SEED_VERSION</code> bumped to <code>\'18\'</code>; demo DOBs updated near today for immediate demo visibility',
          ]
        },
      ]
    },
    {
      version: '2.6.0',
      date: '2026-04-27',
      tag: 'minor',
      title: 'Dynamic Branding · Login Personalization · Immersive Layout',
      sections: [
        {
          heading: 'New — Dynamic Branding',
          type: 'new',
          items: [
            'Upload school logo (PNG/SVG/JPG, max 2 MB) — displayed in sidebar header, replaces the default graduation-cap icon',
            'Upload favicon (max 512 KB) — updates the browser tab icon live on save',
            'App Name — rename "InnoLearn" everywhere in the UI and browser title',
            '6 quick preset themes: Ocean Blue, Emerald, Violet, Rose, Amber, Cyan',
            'Custom primary accent + sidebar background color pickers with live mini-preview',
            '<code>App.applyBranding()</code> — injects derived CSS variable overrides on every login; auto-derives <code>--primary-dark</code>, <code>--primary-light</code>, <code>--primary-glass</code>',
            'Branding saved to <code>schools[0]</code>: <code>logo · favicon · appName · theme{primary, sidebarBg}</code>',
          ]
        },
        {
          heading: 'New — Login Page Personalization',
          type: 'new',
          items: [
            '5 canvas animation effects for the login background: <strong>Particles · Aurora · Water · Clouds · Fire</strong>',
            'Effect color picker — color applied to animation (waves, dots, aurora bands)',
            'Editable login copy: welcome title, welcome subtitle, tagline, footer text, all 4 feature card titles &amp; descriptions',
            'Social media links bar — Facebook, X/Twitter, Instagram, LinkedIn, WhatsApp, YouTube (blank = hidden)',
            '<code>LoginFX</code> IIFE — canvas animation engine; <code>start(effect, color)</code> / <code>stop()</code> API; auto-resizes on window resize',
            '<code>_applyLoginPage(school)</code> in <code>app.js</code> — called from <code>_showLogin()</code>; updates all DOM elements and starts canvas effect',
            'Saved to <code>schools[0].loginPage</code>: <code>{ effect, effectColor, welcomeTitle, welcomeSub, tagline, footerText, features[], social{} }</code>',
          ]
        },
        {
          heading: 'Changed — Immersive Login Layout',
          type: 'changed',
          items: [
            'Canvas animation now spans the <strong>full login screen</strong> — behind both left branding panel and right form card',
            'Left panel is transparent — branding content overlays the canvas directly',
            'Sign-in form is now a <strong>floating card</strong> — white card with 22px radius, deep drop shadow, and gentle 7-second float animation',
            'Float animation deepens the card shadow as it rises (mimics real light physics)',
            'Mobile (≤1024px): float animation disabled; card fills screen as normal',
          ]
        },
      ]
    },
    {
      version: '2.5.0',
      date: '2026-04-27',
      tag: 'minor',
      title: 'Data Integrity II · Events Fix · Delete Guards',
      sections: [
        {
          heading: 'Fixed — Events Calendar',
          type: 'fix',
          items: [
            'Events now appear on the calendar immediately after saving or updating — calendar navigates to the event\'s month automatically',
            'All 10 seed events shifted to 2026 to match the current academic year',
            '"No events in [Month]" empty-state shown when a calendar month has no events',
          ]
        },
        {
          heading: 'New — Subject &amp; User Delete Guards',
          type: 'new',
          items: [
            '<code>Validators.canDeleteSubject(id)</code> — blocks if subject is in timetable, class assignments, or grade records',
            '<code>Validators.canDeleteUser(id)</code> — blocks if user is a homeroom teacher, in timetable, or linked to a student record; prevents self-deletion',
            'Delete button added to Subject Catalogue (admin only)',
            'Delete button added to Users table in Settings (admin only)',
          ]
        },
        {
          heading: 'New — Room Conflict Check',
          type: 'new',
          items: [
            'Timetable slot validation now blocks room double-booking: same room, same day, same period across all classes',
          ]
        },
        {
          heading: 'Changed — Validate-First in Admissions',
          type: 'changed',
          items: [
            'Enrollment pre-flight: class existence, email uniqueness, and admission number uniqueness checked before any DB write',
            '<code>STUDENT_ENROLLED</code> audit entry added on successful enrollment',
          ]
        },
        {
          heading: 'Changed — Permission Guards',
          type: 'changed',
          items: [
            'Exams save/delete: <code>exams.create</code> and <code>exams.delete</code> permissions enforced in logic; audited',
            'Classes save: <code>isAdmin()</code> enforced in logic; audited',
            'Subjects: hardcoded academic year removed — uses <code>SchoolContext</code>',
          ]
        },
      ]
    },
    {
      version: '2.4.0',
      date: '2026-04-27',
      tag: 'minor',
      title: 'Data Integrity — Validators · ENUMS · Guards',
      sections: [
        {
          heading: 'New — ENUMS Constant',
          type: 'new',
          items: [
            'Frozen <code>ENUMS</code> object defines canonical value sets for every status/type field: studentStatus, incidentType, appealStatus, invoiceStatus, paymentMethod, userRole, and more',
            'Single source of truth — no more scattered string literals',
          ]
        },
        {
          heading: 'New — Central Validators (validators.js)',
          type: 'new',
          items: [
            'New <code>js/validators.js</code> file loaded before all modules',
            'Entity validators: <code>student · user · cls · timetableSlot · payment · incident</code>',
            'Delete guards: <code>canDeleteStudent · canDeleteClass · canDeleteYear · canDeleteSection</code>',
            'Each returns <code>null</code> (pass) or an error string (fail) — never throws',
          ]
        },
        {
          heading: 'Changed — Referential Integrity Enforced',
          type: 'changed',
          items: [
            'Student edits: classId FK verified before write',
            'User creates/edits: role enum + unique email enforced',
            'Class creates: sectionId FK + unique name per section enforced',
            'Timetable slots: subject FK, teacher FK, teacher double-booking now <strong>blocks</strong> (was only a warning)',
            'Payment recording: positive amount + non-paid invoice enforced before DB write',
            'Behaviour incidents: student FK verified before logging',
          ]
        },
        {
          heading: 'Changed — Delete Guards Centralised',
          type: 'changed',
          items: [
            'Delete student: blocked if open appeals <strong>or unpaid invoices</strong> (new)',
            'Delete class: also blocked if timetable entries exist (new); cascades timetable cleanup on confirmed delete',
            'Delete academic year: also blocked if classes are linked (new)',
          ]
        },
        {
          heading: 'Changed — Permission Enforcement',
          type: 'changed',
          items: [
            'Payment recording requires <code>finance.create</code> permission in logic',
            'Log incident requires <code>behaviour.create</code> permission in logic',
            'Set current academic year restricted to admin/superadmin in logic',
          ]
        },
      ]
    },
    {
      version: '2.3.0',
      date: '2026-04-27',
      tag: 'minor',
      title: 'Architecture Phase B · Audit Log · Guards · Tests',
      sections: [
        {
          heading: 'New — Audit Log System',
          type: 'new',
          items: [
            'Global <code>_audit(action, details)</code> function writes immutable entries to the <code>audit_log</code> collection',
            'Never blocks the primary operation — failures are silently logged to console',
            'Critical operations audited: <strong>Student Update/Delete · Payment Recorded · Appeal Resolved · Academic Year Changed/Deleted · Permission Changed</strong>',
            'Each entry includes: action name, performing user, timestamp, and structured details (IDs, names, amounts, diffs)',
          ]
        },
        {
          heading: 'New — Operation Guards',
          type: 'new',
          items: [
            '<strong>Delete Student</strong>: blocked if the student has open appeals (pending or escalated) — staff must resolve all appeals before a student can be deleted',
          ]
        },
        {
          heading: 'New — Browser Test Layer',
          type: 'new',
          items: [
            '<code>InnoLearnTests.run()</code> — callable from the browser console at any time',
            'Auto-runs when the URL includes <code>?tests=1</code>',
            'Six suites: DB Layer · SchoolContext · Global Utilities · Seed Integrity · Audit Log · Behaviour Module',
            'Results shown as a summary toast and detailed output in the browser console',
          ]
        },
      ]
    },
    {
      version: '2.2.0',
      date: '2026-04-27',
      tag: 'minor',
      title: 'Architecture Phase A · Core Utilities',
      sections: [
        {
          heading: 'New — SchoolContext Helper',
          type: 'new',
          items: [
            '<code>SchoolContext</code> IIFE added to <code>data.js</code> — single source of truth for the current school, term, and academic year',
            'API: <code>school()</code> · <code>currentTermId()</code> · <code>currentAcYearId()</code> · <code>currentTerm()</code> · <code>currentAcYear()</code>',
            'Replaces all hardcoded <code>|| \'term2\'</code> and <code>|| \'ay2025\'</code> fallbacks across the entire codebase',
          ]
        },
        {
          heading: 'New — Global Utilities',
          type: 'new',
          items: [
            '<strong>assert(condition, message)</strong> — throws a descriptive error if condition is falsy; use before DB writes to catch bad data early',
            '<strong>safe(fn, label)</strong> — wraps UI action handlers; shows a user-friendly toast on unexpected errors instead of silent crashes',
            '<strong>isOverlapping(aStart, aEnd, bStart, bEnd)</strong> — HH:MM overlap check for clash detection in timetable and scheduling',
          ]
        },
        {
          heading: 'Changed — Dynamic Export',
          type: 'changed',
          items: [
            '<strong>Settings → Export All Data</strong> now dynamically discovers every <code>ss_</code>-prefixed localStorage collection',
            'New collections added in future are automatically included in backups — no code change required',
          ]
        },
        {
          heading: 'Fixed — Hardcoded Fallbacks',
          type: 'fixed',
          items: [
            'All hardcoded <code>\'term2\'</code> / <code>\'ay2025\'</code> fallbacks replaced with <code>SchoolContext</code> calls in: behaviour.js (6 sites), academics.js (6 state vars), classes.js, settings.js',
          ]
        },
        {
          heading: 'Removed — Dead Code',
          type: 'removed',
          items: [
            '<code>js/modules/teachers.js</code> deleted — file was never loaded and <code>Teachers</code> object was unused; the <code>#teachers</code> route already redirected to <code>HR.render()</code>',
          ]
        },
      ]
    },
    {
      version: '2.1.1',
      date: '2026-04-27',
      tag: 'patch',
      title: 'Log Modal Class Filter',
      sections: [
        {
          heading: 'Changed — Log Modal',
          type: 'changed',
          items: [
            'Added <strong>Filter by Class</strong> dropdown above the Student field in the log modal',
            'Student list automatically narrows to only students in the selected class',
            'Live count label shows how many students are in the filtered class',
            'Changing the class clears the student selection; selecting "All Classes" restores the full list',
            'Class and date are preserved across type, category, and behaviour changes in the same session',
          ]
        },
        {
          heading: 'Confirmed — House Points',
          type: 'new',
          items: [
            'Every logged incident automatically updates the House Cup: merits add points, demerits subtract them',
            'House Cup standings reflect the change immediately on the next dashboard render',
          ]
        },
      ]
    },
    {
      version: '2.1.0',
      date: '2026-04-27',
      tag: 'minor',
      title: 'Behaviour Category System · Guided Log Modal',
      sections: [
        {
          heading: 'New — Pre-seeded Default Categories',
          type: 'new',
          items: [
            'Eight SAA BPS v2 matrix groups pre-seeded as default categories: <strong>Classroom & Academic, Corridors & Common Areas, Sports/PE/ECA, Interpersonal Relationships, School Rules/Safety/Property, Dining Hall & Shared Spaces, Digital Citizenship & Technology, Leadership & Community Service</strong>',
            'Each category has an icon, colour, and a <code>matCat</code> link to its matrix items',
            'Admin can rename, recolour, or delete any default category from <strong>Settings → Behaviour → Categories</strong>',
            'Admin can add custom categories with a fixed point value (applied as +pts for merit / −pts for demerit)',
          ]
        },
        {
          heading: 'Changed — Log Incident Modal (Guided 3-Step Flow)',
          type: 'changed',
          items: [
            'Removed the Source toggle (Standard Matrix / Custom Category) — replaced by category selection',
            'New guided flow: <strong>Step 1 — Type (Merit/Demerit) → Step 2 — Category → Step 3 — Behaviour</strong>',
            'Step 2 shows a 2-column category grid with icons, colours, and live item counts for the selected type',
            'Step 3 automatically shows <strong>only behaviours matching the selected type</strong> within the chosen category — merits and demerits are never mixed in the list',
            'Custom categories skip the item list and display the fixed point value directly',
            'Selecting a different type or category resets behaviour selection without losing student/date',
          ]
        },
        {
          heading: 'Changed — Settings → Categories Panel',
          type: 'changed',
          items: [
            'Unified categories table replaces the old split merit/demerit view',
            'Columns: Category (icon + name) · Linked To (Standard Matrix or Custom) · Merit items/pts · Demerit items/pts · Actions',
            'Edit modal distinguishes matrix-backed vs custom categories — matrix ones show an info note and hide the fixed points field',
          ]
        },
        {
          heading: 'Fixed',
          type: 'fixed',
          items: [
            'Matrix item point values now correctly read the <code>pts</code> field throughout the log modal (previously showed undefined)',
          ]
        },
      ]
    },
    {
      version: '2.0.0',
      date: '2026-04-26',
      tag: 'major',
      title: 'Behaviour System v2 · Extended Roles · House Overhaul',
      sections: [
        {
          heading: 'New — Roles',
          type: 'new',
          items: [
            'Added <strong>Deputy Principal</strong> role with full behaviour oversight and appeal escalation rights',
            'Added <strong>Discipline Committee</strong> role for disciplinary panel membership',
            'Demo login pills added for both new roles on the login screen',
          ]
        },
        {
          heading: 'New — House System Overhaul',
          type: 'new',
          items: [
            'Four official houses: <strong>Impala</strong> (Yellow), <strong>Simba</strong> (Red), <strong>Twiga</strong> (Green), <strong>Chui</strong> (Blue)',
            'House IDs changed from <code>h1–h4</code> to semantic IDs (<code>yellow</code>, <code>red</code>, <code>green</code>, <code>blue</code>)',
            'Houses carry <code>bg</code>, <code>border</code>, and <code>badge</code> fields for consistent UI theming',
            'House assignment added to the Admissions approval workflow',
            'House shield badge, avatar tint, and info panel added to Student profiles',
            'House column added to Students list table',
            'House dropdown added to Student edit modal',
          ]
        },
        {
          heading: 'New — Behaviour Module v2: Foundation',
          type: 'new',
          items: [
            'Period filter pills on Dashboard and Register: <strong>Weekly / Monthly / Termly / All Time</strong>',
            '<strong>Register</strong> tab replaces old "Incidents" tab; legacy <code>#incidents</code> hash redirects automatically',
            '<strong>Appeals</strong> tab added with live pending-count badge in tab header',
            'Incident <code>status</code> field introduced: <code>active</code> | <code>appealing</code> | <code>overturned</code>',
            'Status column added to Register table with filter (All / Active / Under Appeal / Overturned)',
            'All incident display updated to use <code>note</code> field (with <code>description</code> fallback for legacy data)',
            '<code>saveIncident()</code> now saves <code>status: \'active\'</code> and <code>createdAt</code> timestamp',
          ]
        },
        {
          heading: 'New — Behaviour Module v2: Log Modal',
          type: 'new',
          items: [
            'Old simple dropdown log modal replaced with dual-source modal',
            '<strong>Standard Matrix</strong> source: browse 120+ locked SAA BPS v2 behaviours across 8 categories (Classroom & Academic, Corridors & Common Areas, Sports/PE/ECA, Interpersonal, School Rules, Dining Hall, Digital Citizenship, Leadership & Community Service)',
            'Group tabs on left, scrollable item list on right, live search across all categories',
            'Points auto-fill and lock on selection; preview card shows selected behaviour',
            '<strong>Custom Category</strong> source: admin-created categories with free-point entry (unchanged)',
            '<strong>Serious Incident Note</strong>: any incident with |points| ≥ threshold (default 5) blocks submission until a detailed note is typed',
            'Modal state persists across inner refreshes — student and date selections survive type/source/group changes',
          ]
        },
        {
          heading: 'New — Behaviour Module v2: Appeals System',
          type: 'new',
          items: [
            'Full 3-layer appeals workflow: student submits → staff resolves → parent can add supporting note',
            'Incident status lifecycle: <code>active → appealing → overturned / active</code>',
            '<code>behaviour_appeals</code> DB collection stores full audit trail (reason, parent note, resolution, resolved-by, timestamps)',
            'Escalation restricted to Deputy Principal, Discipline Committee, Admin, Superadmin',
            'Student view: "My Appeals" table + "Eligible to Appeal" list with Appeal buttons on each active demerit',
            'Parent view: child\'s appeals with Add/Edit Note buttons + resolved appeals history',
          ]
        },
        {
          heading: 'New — Behaviour Module v2: Dashboard Enhancements',
          type: 'new',
          items: [
            '<strong>Stage Alerts panel</strong>: all students currently at a demerit stage (half-term window), sorted by stage descending',
            '<strong>Persistent Behaviour Patterns panel</strong>: same behaviour logged ≥ 2 times in the selected period',
            'Stage calculations updated to use a rolling half-term window (configurable via <code>halfTermWeeks</code>, default 7 weeks)',
            'At-risk student list on dashboard now uses half-term demerit window, consistent with stage thresholds',
          ]
        },
        {
          heading: 'New — Behaviour Module v2: PDF Report & Settings',
          type: 'new',
          items: [
            '<strong>Generate Report</strong> button in page header — opens a printable, self-contained PDF report in a new window',
            'Report sections: Summary stats (5 KPI boxes), House Cup standings, Stage Alerts, Persistent Patterns, Full Student Behaviour Summary, Staff Activity log',
            '<strong>Settings → Behaviour Matrix</strong> tab: read-only browser of all 120 standard SAA BPS v2 items with live type filter and search — locked items cannot be edited or deleted',
          ]
        },
        {
          heading: 'Updated — Seed Data',
          type: 'changed',
          items: [
            'SEED_VERSION bumped from 14 to 15',
            '<code>behaviour_settings</code> completely replaced with SAA BPS v2 config (matrix, milestones, stages, houses, demeritWindow)',
            '<code>behaviour_incidents</code> seed updated: uses <code>behaviourId</code>, <code>note</code>, <code>status: \'active\'</code>',
            '<code>behaviour_appeals</code> collection added (empty seed)',
            'Student house assignments applied via <code>_houseMap</code> post-seed',
          ]
        },
      ]
    },
    {
      version: '1.8.0',
      date: '2025-11-10',
      tag: 'minor',
      title: 'Behaviour Module v1',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Behaviour & Pastoral</strong> module added to sidebar',
            'Merit and demerit incident logging with admin-configurable categories and point values',
            '<strong>House Cup</strong>: school houses compete for merit points; standings shown on dashboard',
            '<strong>Merit Milestones</strong>: threshold-based achievement badges awarded automatically on logging',
            '<strong>Demerit Intervention Stages</strong>: escalating response levels triggered by cumulative demerit points',
            '<strong>Detention scheduling</strong>: create, track, complete, and cancel detention sessions',
            'Automated parent notifications on milestone achievement and stage crossing',
            'At-risk students panel and top merit earners leaderboard on Behaviour dashboard',
            'Settings sub-tabs: Categories, Merit Milestones, Demerit Stages, Houses, Key Stages, Detention Types',
          ]
        }
      ]
    },
    {
      version: '1.7.0',
      date: '2025-09-02',
      tag: 'minor',
      title: 'Settings & Permissions',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Settings</strong> module with school-wide configuration',
            'Granular role-based permission system (<code>role_permissions</code> DB collection)',
            'Per-module, per-action controls (view / create / edit / delete) with sub-module granularity',
            'Multi-section school support: KG, Primary, Secondary, A-Level sections configurable',
            'Academic Year and Term management (dates, current term pointer)',
            'Key Stages configuration (grade groupings for analytics and curriculum)',
            'Role management and individual user permission overrides',
          ]
        }
      ]
    },
    {
      version: '1.6.0',
      date: '2025-07-15',
      tag: 'minor',
      title: 'HR & Staff Management',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>HR & Staff</strong> module replacing the earlier standalone Teachers page',
            'Staff profiles: personal details, employment type, subject assignments, homeroom class',
            'Contract and employment date tracking',
            'Department and role assignment',
            'Legacy <code>#teachers</code> route redirected to HR module for backward compatibility',
          ]
        }
      ]
    },
    {
      version: '1.5.0',
      date: '2025-05-20',
      tag: 'minor',
      title: 'Communication & Events',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Communication Hub</strong>: internal messaging between staff, parents, and students',
            'Role-scoped message visibility (teachers see class-related messages; parents see their children\'s)',
            'Notification system wired to topbar bell icon with unread badge',
            '<strong>Events & Calendar</strong> module: school-wide and class-specific events',
            'Calendar grid view with month/week/list toggle, event creation and detail modals',
          ]
        }
      ]
    },
    {
      version: '1.4.0',
      date: '2025-03-18',
      tag: 'minor',
      title: 'Financial Management',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Finance</strong> module: fee structures, invoice generation, and payment recording',
            'Per-student invoice tracking with Paid / Partial / Overdue status',
            'Payment history and receipt generation',
            'Financial dashboard: outstanding balances, collection rate, recent transactions',
            'Overdue alerts with automated notification hooks to parents',
          ]
        }
      ]
    },
    {
      version: '1.3.0',
      date: '2025-01-22',
      tag: 'minor',
      title: 'Admissions Pipeline',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Admissions</strong> module: application intake with stage-based pipeline management',
            '<strong>Public application form</strong> accessible at <code>#apply/&lt;token&gt;</code> without login — shareable URL for prospective families',
            'Pipeline stages: Inquiry → Application → Review → Interview → Decision → Enrolled',
            'Approval workflow: approve application → auto-create student record with class and year group assignment',
            'Application detail view with document checklist and status history',
          ]
        }
      ]
    },
    {
      version: '1.2.0',
      date: '2024-11-14',
      tag: 'minor',
      title: 'Academic Progress & Assessment',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Academics / Gradebook</strong>: marks entry per subject per student with weighted grade computation',
            'Cambridge and IB grade boundary support alongside custom percentage grading',
            '<strong>Exams</strong> module: exam creation, scheduling, invigilator assignment, and result recording',
            'Automatic grade, rank, and class average calculation after results entry',
            '<strong>Reports & Analytics</strong>: term report generation, class performance breakdowns, subject analysis',
            'Report cards: per-student PDF with subject grades, teacher comments, attendance summary, and behaviour summary',
          ]
        }
      ]
    },
    {
      version: '1.1.0',
      date: '2024-09-09',
      tag: 'minor',
      title: 'Academic Infrastructure',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>Subjects & Curriculum</strong>: subject creation with Cambridge / IB / custom curriculum tagging and key stage assignment',
            '<strong>Timetable</strong>: period-based weekly schedule builder with drag-and-drop slot assignment and clash detection across teachers and rooms',
            '<strong>Attendance</strong>: daily class registers with Present / Absent / Late / Excused status per student',
            'Attendance percentage calculation, trend tracking, and bulk mark-present functionality',
            'Copy-previous-day register shortcut',
          ]
        }
      ]
    },
    {
      version: '1.0.0',
      date: '2024-07-01',
      tag: 'major',
      title: 'Foundation Release',
      sections: [
        {
          heading: 'New',
          type: 'new',
          items: [
            '<strong>App shell</strong>: responsive sidebar (collapsible on mobile), topbar with global search and notifications',
            '<strong>Authentication</strong>: email/password login, remember-me, demo credential pills for 8 roles',
            '<strong>Hash-based routing</strong>: <code>#route/param</code> pattern with back-button support',
            '<strong>Modal system</strong>: stacked modals with overlay, size variants (sm / md / lg)',
            '<strong>Toast notifications</strong>: success / warning / error / info with auto-dismiss',
            '<strong>Dashboard</strong>: school KPI cards, recent activity feeds, quick-action buttons (role-aware)',
            '<strong>Students</strong>: full student profiles (personal, academic, guardian, medical), enrollment management, admission number generation',
            '<strong>Classes & Sections</strong>: class creation, section grouping (KG / Primary / Secondary / A-Level), homeroom teacher assignment',
            'Seeded demo data: 20 students, 6 teachers, 4 sections, sample academic year and terms',
            'Global search — find students by name or admission number from the topbar',
            'Role-filtered sidebar navigation — modules shown based on role permissions',
          ]
        }
      ]
    },
  ];

  /* ── Tag helpers ──────────────────────────────────────── */
  function _tagBadge(tag, version) {
    if (tag === 'major') return `<span class="badge badge-danger">v${version} — Major</span>`;
    if (tag === 'minor') return `<span class="badge badge-primary">v${version} — Minor</span>`;
    return `<span class="badge badge-secondary">v${version} — Patch</span>`;
  }

  function _sectionIcon(type) {
    if (type === 'new')     return '<i class="fas fa-plus-circle" style="color:var(--success)"></i>';
    if (type === 'changed') return '<i class="fas fa-edit" style="color:var(--warning)"></i>';
    if (type === 'fixed')   return '<i class="fas fa-wrench" style="color:var(--primary)"></i>';
    if (type === 'removed') return '<i class="fas fa-minus-circle" style="color:var(--danger)"></i>';
    return '<i class="fas fa-circle" style="color:var(--gray-400)"></i>';
  }

  /* ── Main render ──────────────────────────────────────── */
  function render() {
    const user = Auth.currentUser;
    if (!user || !['superadmin', 'admin'].includes(user.role)) {
      App.renderPage(`
        <div class="empty-state" style="padding:60px 0">
          <i class="fas fa-lock" style="font-size:48px;color:var(--gray-300);margin-bottom:16px;display:block"></i>
          <h3 style="color:var(--gray-500)">Access Restricted</h3>
          <p style="color:var(--gray-400)">The changelog is only available to administrators.</p>
        </div>`);
      return;
    }

    App.setBreadcrumb('Changelog');

    const versionsHtml = VERSIONS.map((v, idx) => {
      const sectionsHtml = v.sections.map(sec => `
        <div class="cl-section">
          <div class="cl-section-heading">
            ${_sectionIcon(sec.type)}
            <span>${sec.heading}</span>
          </div>
          <ul class="cl-items">
            ${sec.items.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
      `).join('');

      const isLatest = idx === 0;

      return `
        <div class="cl-card ${isLatest ? 'cl-card--latest' : ''}">
          <div class="cl-card-header">
            <div class="cl-version-wrap">
              ${_tagBadge(v.tag, v.version)}
              ${isLatest ? '<span class="badge badge-success" style="margin-left:6px">Latest</span>' : ''}
            </div>
            <h2 class="cl-title">${v.title}</h2>
            <span class="cl-date"><i class="fas fa-calendar-alt"></i> ${fmtDate(v.date)}</span>
          </div>
          <div class="cl-card-body">
            ${sectionsHtml}
          </div>
        </div>
      `;
    }).join('');

    App.renderPage(`
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fas fa-history"></i> Changelog</h1>
          <p class="page-subtitle">All notable changes to InnoLearn, from the beginning.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="badge badge-success" style="font-size:12px;padding:6px 12px">
            <i class="fas fa-code-branch"></i> Current: v${VERSIONS[0].version}
          </span>
        </div>
      </div>

      <style>
        .cl-timeline { max-width: 860px; margin: 0 auto; }

        .cl-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: 12px;
          margin-bottom: 24px;
          overflow: hidden;
          transition: box-shadow .2s;
        }
        .cl-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.07); }
        .cl-card--latest { border-color: var(--primary); }

        .cl-card-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--gray-50);
        }
        .cl-card--latest .cl-card-header { background: #eff6ff; }

        .cl-version-wrap { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }

        .cl-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--gray-900);
          margin: 0 0 6px;
        }

        .cl-date {
          font-size: 13px;
          color: var(--gray-500);
        }
        .cl-date i { margin-right: 4px; }

        .cl-card-body { padding: 20px 24px; }

        .cl-section { margin-bottom: 20px; }
        .cl-section:last-child { margin-bottom: 0; }

        .cl-section-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          color: var(--gray-700);
          text-transform: uppercase;
          letter-spacing: .4px;
          margin-bottom: 10px;
        }

        .cl-items {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .cl-items li {
          position: relative;
          padding: 5px 0 5px 18px;
          font-size: 14px;
          color: var(--gray-700);
          line-height: 1.55;
          border-bottom: 1px dashed var(--border);
        }
        .cl-items li:last-child { border-bottom: none; }
        .cl-items li::before {
          content: '';
          position: absolute;
          left: 4px;
          top: 13px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--gray-300);
        }
        .cl-items li code {
          background: var(--gray-100);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 5px;
          font-size: 12px;
          color: var(--primary);
          font-family: 'Courier New', monospace;
        }

        @media (max-width: 600px) {
          .cl-card-header, .cl-card-body { padding: 16px; }
        }
      </style>

      <div class="cl-timeline">
        ${versionsHtml}
        <div style="text-align:center;padding:32px 0;color:var(--gray-400);font-size:13px">
          <i class="fas fa-flag" style="margin-right:6px"></i>
          End of changelog — InnoLearn v1.0.0 was the first release.
        </div>
      </div>
    `);
  }

  return { render };
})();
