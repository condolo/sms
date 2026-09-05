# Msingi — School Administrator Guide

> **Audience:** The Super Admin or IT Administrator for a school registered on Msingi. This guide covers first-time setup, managing your school's data, staff roles, and day-to-day administration.

---

## Table of Contents

1. [First Login & Portal Access](#1-first-login--portal-access)
2. [Initial Setup Checklist](#2-initial-setup-checklist)
3. [Managing Academic Years & Terms](#3-managing-academic-years--terms)
4. [Sections & Classes](#4-sections--classes)
5. [Subjects & Curriculum](#5-subjects--curriculum)
6. [Staff Management & Roles](#6-staff-management--roles)
7. [Student Enrollment](#7-student-enrollment)
8. [Role Permissions](#8-role-permissions)
9. [Your Subscription Plan](#9-your-subscription-plan)
10. [Branding & School Profile](#10-branding--school-profile)
11. [eLearning Settings — Emergency Online Learning Mode](#11-elearning-settings--emergency-online-learning-mode)
12. [Custom Email Sending (SMTP)](#12-custom-email-sending-smtp)
13. [Data Export & Backup](#13-data-export--backup)
14. [Demo School (Msingi)](#14-demo-school-msingi)
15. [Getting Help](#15-getting-help)

---

## 1. First Login & Portal Access

After completing the onboarding wizard, you will receive a confirmation screen with a **"Go to My Portal"** button. Click it — your session is saved automatically.

If you return later:

1. Go to `https://yourschool.msingi.io` (or your custom URL if on Enterprise)
2. Enter your admin email and password
3. You can also click **"Remember me"** to stay signed in

### Quick Demo Access (for testing)

Visit **[demo.msingi.io](https://demo.msingi.io)** to explore the system using the built-in demo environment with realistic data. One-click role cards let you sign in as any user type without entering credentials — see [Section 12](#12-demo-school-msingi) for details.

---

## 2. Initial Setup Checklist

After your school is created, complete these steps before inviting staff:

- [ ] **Update school profile** — Settings → School Profile (logo, motto, address, phone, website)
- [ ] **Verify academic year** — Settings → School Profile → Academic Years (a default year is pre-created as Active; edit its term dates to match your school calendar)
- [ ] **Confirm/edit sections** — Settings → Sections (KG, Primary, Secondary, A-Level are pre-created — edit to match your school)
- [ ] **Add classes** — Classes module → Add your year groups / form levels
- [ ] **Add subjects** — Subjects module → Add your curriculum subjects
- [ ] **Add staff** — HR → Staff → Add Staff, then Create Login Account (see §6) — or Settings → Users → Invite User for a bare login with no HR profile
- [ ] **Assign roles** — Assign each staff member an appropriate role
- [ ] **Enroll students** — Students module → Enroll or import via Admissions

---

## 3. Managing Academic Years & Terms

Go to **Settings → School Profile**, scroll to the **Academic Years** panel.

### How the year lifecycle works

Every academic year has one of three statuses:

| Status | What it means |
|---|---|
| **Draft** | Created, not yet activated. Term dates can be edited freely. Can be deleted. |
| **Active** | The current running year. Term dates can still be adjusted. Cannot be deleted. |
| **Locked** | Archived. Grades, exams, and report cards are permanently frozen. No edits allowed. |

Only **one year can be active at a time**. All past years become locked when you transition to a new one.

### Creating a new draft year

1. Go to **Settings → School Profile → Academic Years**
2. Click **New year**
3. Enter the year name (e.g. `2026-2027`), start date, end date, and number of terms
4. Click **Create draft year**

The year appears in the list with a **Draft** badge. You can edit its term dates before activating it.

### Editing term dates

1. Click the **pencil icon** on any non-locked year
2. Enter start and end dates for each term
3. Click **Save term dates**

> ⚠️ Locked years are read-only — the pencil icon does not appear.

### Starting a new academic year (transition)

When you are ready to end the current year and begin the next:

1. Make sure you have created a **draft** year for the incoming period and set its term dates
2. Click **Start this academic year** on the draft year
3. Review the confirmation dialog — it shows exactly what will be locked and what will be activated
4. Enter a reason (optional) and click **Lock current & activate new year**

**What happens automatically:**
- The active year is permanently locked
- All exams for the old year are frozen
- All published report cards for the old year are marked year-archived
- Grade entries for the old year are blocked
- The new year becomes active and its term dates are synced school-wide
- A full audit log entry is written

> ⚠️ **This action is irreversible.** Once a year is locked, it cannot be unlocked. Ensure all grades, report cards, and exam results for the old year are final before transitioning.

### What happens if I need to correct data in a locked year?

Contact your Msingi platform administrator. Corrections to locked-year data require a platform-level operation and are subject to audit review.

---

## 4. Sections & Classes

### Sections

Sections group classes by school division (e.g. KG, Primary, Secondary). Go to **Settings → Sections**.

Default sections created at registration:

| Code | Name | Typical levels |
|---|---|---|
| KG | Kindergarten | PP1, PP2, Reception |
| PRI | Primary | Grade 1–8 / Year 1–6 |
| SEC | Secondary | Form 1–4 / Year 7–11 |
| AL | A-Level | Form 5–6 / Year 12–13 |

Edit, rename, or delete sections to match your school structure.

### Classes

Go to **Classes** module → **Add Class**.

Each class needs:
- **Name** (e.g. `Grade 5A`, `Form 3B`)
- **Section** (link to a section above)
- **Level** (numeric, used for sorting — e.g. Grade 5 = 5)
- **Homeroom Teacher** (optional at creation, assign later)
- **Capacity** (max students)

---

## 5. Subjects & Curriculum

Go to **Subjects** module → **Add Subject**.

Each subject needs:
- **Name** and **Code** (e.g. `Mathematics`, `MATH`)
- **Type**: Core / Elective / Co-curricular
- **Curriculum** (Cambridge / IB / National / Custom)
- **Applicable sections** (which school divisions offer this subject)

Subjects are then linked to classes via the **Timetable** module.

---

## 6. Staff Management & Roles

### Configuring Staff Roles & Responsibilities

The **Roles & Responsibilities** section in the Add/Edit Staff form is fully customisable per school. By default it includes: Head of Department, Class Teacher / Form Tutor, Timetabler, Exam Officer, Deputy Principal, and Principal.

To customise for your school's structure:

1. Go to **Settings → School** and scroll to **Staff Roles & Responsibilities**
2. Click **Add Role** to enter a new responsibility (e.g. *KS3 Academic Coordinator*, *Deputy Head Primary*, *Section Head*, *Pastoral Lead*)
3. Click the **×** next to any role to remove it
4. Changes take effect immediately in the Add/Edit Staff form — no page refresh needed

> **Existing assignments are preserved.** If a staff member already has a role assigned (e.g. `hod`) and you remove it from the list, the value remains on their record — it just no longer appears as a selectable option.

> **Staff Type vs Roles & Responsibilities** — Staff Type (Teacher, Administrator, Librarian, etc.) is the HR/payroll employment category and is a single value per person. Roles & Responsibilities are functional duties — a person can hold several at once (e.g. a teacher who is also HOD and Form Tutor).

### Adding a staff member — two things, not one

A staff member has two separate records: an **HR profile** (department, staff type, qualifications, national ID, next of kin — everything HR tracks) and a **login account** (what lets them actually sign in). Creating one doesn't automatically create the other. Two ways to add someone, depending on which you need:

**The full way — via HR (recommended for anyone who's actual staff):**
1. Go to **HR → Staff → Add Staff** and fill in their personal/employment details. This creates their HR profile — they now appear in the staff directory, but **cannot sign in yet**.
2. Open their profile — it shows an amber **"No login account"** notice with a **Create Login Account** button. Click it, confirm their email and role, and send.
3. Msingi generates a secure password and emails it to them automatically. They can log in immediately.

**The quick way — via Settings (a bare login, no HR profile):**
1. Go to **Settings → Users → Invite User**
2. Enter full name (optional), email address, and assign a role
3. Click **Send Invite** — same automatic secure-password email as above
4. The staff member can log in immediately, but has **no HR profile** — nothing shows up under HR → Staff for them. Use this only for accounts that genuinely don't need HR tracking; if you invite someone this way whose email already has an HR profile, Msingi blocks it and tells you to use Create Login Account from their profile instead, so the two records don't end up disconnected.

> **If the email doesn't arrive** — use the Set Password flow below to generate or type a new password you can share directly.

### Setting a user's password (admin only)

If a staff member never received their welcome email, has forgotten their password, or you need to set a specific password for them:

1. Go to **Settings → Users**
2. Hover over the user's row — a **key icon** (🔑) appears on the right
3. Click the key icon to open the **Set Password** dialog
4. **Optional**: type a specific password in the field, or leave it blank to auto-generate a strong random one
5. Click **Set Password**
6. The dialog shows the new password — copy it and share it securely (phone, WhatsApp, in person)
7. A copy is also emailed to the user automatically; the dialog tells you whether the email was delivered

> **The password is shown once.** Copy it before closing the dialog.

> **No forced change**: the user can log in immediately with this password. They are not required to change it on first login — it is a fully usable password. The platform's 90-day rotation policy applies to everyone: all users are prompted to update their password after 90 days regardless of how it was set.

> **Note:** A regular admin cannot set the password of another admin or superadmin. Only a superadmin can do this.

### Available roles

| Role | Access level |
|---|---|
| **Super Admin** | Everything — full platform control for your school |
| **Admin (Principal)** | Full school access, all modules |
| **Deputy Principal** | Most modules including behaviour and reports |
| **Section Head** | Students, classes, and reports for their section |
| **Teacher** | Their classes, attendance, gradebook, timetable |
| **Exams Officer** | Exams and gradebook management |
| **Admissions Officer** | Admissions module |
| **Finance** | Finance module only |
| **HR** | HR & Payroll module only |
| **Timetabler** | Timetable builder only |
| **Discipline Committee** | Behaviour & Pastoral module |
| **Parent** | Read-only: their children's data, events, messaging |
| **Student** | Read-only: own profile, events, timetable |

Dedicated, role-specific guides exist for the four specialist roles above — hand the relevant one to whoever holds that role instead of this general guide: [Finance Guide](FINANCE_GUIDE.md), [HR Guide](HR_GUIDE.md), [Exams Officer Guide](EXAMS_OFFICER_GUIDE.md), [Timetabler Guide](TIMETABLER_GUIDE.md). For the full admissions-to-enrollment workflow (not just the summary in §7 below), see the [Admissions Guide](ADMISSIONS_GUIDE.md).

### Assigning multiple roles

A user can have more than one role (e.g. a teacher who is also section head). In Settings → Users, click the user and add additional roles. Permissions are the **union** of all assigned roles.

### What staff can edit themselves

Every staff member has access to their own **Profile page** (click their avatar in the top-right corner → **My Profile**). From there they can:

- Upload or remove their profile photo
- Change their password (current password required)
- Update their personal details: address, date of birth, qualifications, specialization, next of kin

HR-managed fields (department, contract type, employment status, national ID, NSSF/SHA/KRA numbers) can only be changed by the HR team — they are not visible on the self-edit form.

---

## 7. Student Enrollment

### Individual enrollment

1. Go to **Students → Enroll Student** (or the button on the Dashboard)
2. Fill in personal details, date of birth, gender
3. Select class
4. Add parent/guardian contact
5. Save — student is immediately active

### Via Admissions

For a formal application workflow, **Admissions → New Application** tracks a child through nine pipeline stages: Enquiry → Application → Assessment → Interview → Offer → Acceptance → Enrolled (Withdrawn/Rejected close the pipeline at any point). Required on every application: **Full Names, Gender, Date of Birth**, and **at least one parent** (Mother or Father — see below). Optional: House selection, Allergies, Emergency Contact, ID/Passport numbers for either parent, previous school.

**Mother and Father are entered separately**, each with their own name, email, phone, and ID/Passport number — not a single combined "parent" field. **Email is required for any parent you name** (phone is optional) — this is what lets that parent get their own portal login later (see Student portal accounts, below); a parent entered with a name but no email will be rejected at save time. Pick which parent is the **Primary Contact** — that one drives the "Registration Date"/"Start Date" style school communications; it doesn't limit which parent can later get a portal account.

**Enrolling an applicant.** Once an application reaches **Acceptance**, its detail panel shows an **Enroll Student** button — a deliberate, explicit click, not an automatic effect of changing the stage dropdown, because it creates a real, permanent Student record. Enrolling:
- Assigns the student's **permanent admission number** at that exact moment — admission numbers are never assigned earlier, on the application itself.
- Carries every field across automatically: names, DOB, gender, class/stream/house, Mother/Father details, Allergies and Emergency Contact (filed under the student's Medical tab).
- Is safe to click twice — enrolling an already-enrolled application returns the same student record rather than creating a duplicate.
- Is blocked with a clear error if the application is missing Date of Birth or Gender (only possible on an application started before your school's Msingi setup) — update the application first, then enroll.

The application and the resulting student record stay linked, so you can always trace an enrolled student back to their original application.

### Bulk import (CSV)

Available from **Students → Import**. Upload a CSV of up to 500 students per batch — the system validates every row first and reports which rows succeeded and which were skipped (with a reason) before anything is saved. Rows that don't supply their own admission number are auto-assigned the next number in your school's sequence.

The template mirrors the Admissions form field-for-field: **Date of Birth and Gender are required on every row**, and the same Mother/Father-with-mandatory-email rule applies (or use the older combined `parentName`+phone/email columns instead, if that's what your existing records use — either is accepted, but at least one must be filled in). House, Allergies, and Emergency Contact columns are optional and land in the same places as on the Admissions form. Opening fee columns are optional and only needed when migrating student balances from another system — download the template from the Import screen for the full column list with example rows.

### Student portal accounts

Each student can have a **student login** (signs in with their admission number) and, once a parent's email is on file, a **parent login** — created individually from that student's profile (**Students → [student] → Portal** tab) or in bulk:

1. From the **Students** list, select the students who need portal access (checkbox column).
2. Click **Grant Portal Access**. Any number of students works in one click — the system batches large selections automatically.
3. A CSV of one-time login credentials (name, admission number, temporary password) downloads automatically. **Save this file before closing the result banner** — passwords are never stored in readable form and cannot be recovered afterward. Print it, or share each row individually with the relevant student/parent.
4. Every account requires a password change on first login, so a slip changing hands after the student has already logged in poses no risk.
5. If a student loses their credentials before ever logging in, reset just that one account from their Profile → Portal tab rather than re-running the bulk action.

**Mother and Father can each have their own independent login (2026-09).** If both a Mother's and a Father's name+email are on the student's record, the Profile → Portal tab shows two independent account cards — **Mother's Portal Account** and **Father's Portal Account** — created and reset separately. Neither parent needs to share a password with the other to see the child's information. A record that only ever had one combined parent contact (no Mother/Father split) still shows the single, original **Parent Portal Account** card — nothing changes for those.

Siblings share one parent account automatically, per parent: put the same parent's email on each sibling's profile, then create that parent's account from each sibling's Portal tab in turn — the second and later clicks link that child to the parent's existing account (and reset its password) instead of creating a duplicate. This works independently for Mother and Father — e.g. Mother's account can cover all her children while Father's covers only his, if that's how a family is actually set up. The parent must log out and back in to see a newly linked child.

### Deactivating a student

**Students → [student] → Portal → Deactivate Student.** Marks the student withdrawn/graduated/transferred; all academic records are preserved and the student is excluded from the next billing snapshot. A deactivated student can be restored at any time from the same tab (**Reactivate**), which restores active status and portal access.

---

## 8. Role Permissions

Go to **Settings → Roles & Permissions**.

Each role has a permission matrix — you can customise what each role can **View**, **Create**, **Edit**, and **Delete** within each module.

> **Super Admin** always has full access and cannot be restricted.

### Customising permissions

1. Select a role from the list
2. Toggle permissions per module
3. Save — takes effect immediately (no logout required)

---

## 9. Your Subscription Plan

Go to **Settings → Billing & Plan** to view your current plan.

**Plans differ by WHO can log in, not which modules you have.** Every plan — Base, Student, or Family — includes the full ERP: Finance & Invoicing, HR & Payroll, M-Pesa integration, Timetable Builder, Behaviour & Pastoral, everything. The tier only decides whether students and/or parents also get their own portal login. This is enforced server-side in `server/middleware/plan.js`'s `FEATURE_PLAN` — every ERP module is gated at the base tier; only `student_portal` and `parent_portal` sit above it. (Source of truth for pricing: `server/config/pricing.js`.)

### Plan comparison

| Tier | Rate | Adds | Includes |
|---|---|---|---|
| **Base** | KSh 250 / student / term | Admin + teacher dashboards | The full ERP — students, classes, admissions, attendance, exams, timetable, behaviour, finance & invoicing, HR & payroll, M-Pesa, library, transport, hostel, report cards, messaging |
| **Student** | KSh 300 / student / term | + Student portal | Everything in Base, plus student login (admission number or school email): lessons progress, timetable, report cards, attendance, fee balance |
| **Family** | KSh 350 / student / term | + Parent portal | Everything in Student, plus parent login accounts: child progress, curriculum coverage, fees, parent–teacher messaging |

A one-time setup fee (KSh 45,000–75,000, by student headcount) applies separately at onboarding. Enterprise-only platform features (API access, SSO, white-label, multi-campus, advanced analytics) are negotiated individually and aren't part of the per-student tiers above.

### Free trial

All new schools start on a **30-day free trial** on their chosen plan. No payment is required until the trial ends.

### Upgrading your plan

Contact Msingi via the **Plans page** at [msingi.io/plans](https://msingi.io/plans) or click **Contact Us** → choose your plan to pre-fill the inquiry form. Enterprise pricing is available on request.

### What happens if I exceed my trial?

After the 30-day trial, locked modules will return to the free-tier access unless a subscription is activated. Your data is never deleted.

---

## 10. Branding & School Profile

Go to **Settings → School Profile**.

You can update:
- **School name** and **short name** (shown in sidebar)
- **Logo** — upload a PNG or JPG (shown in sidebar and reports)
- **Motto**
- **Address, phone, email, website**
- **Curriculum type** (Cambridge, IB, National, Custom)
- **Timezone** and **currency**

These settings are used across reports, letters, and the app header.

---

## 11. eLearning Settings — Emergency Online Learning Mode

Go to **Settings → School Profile** and scroll to the **Emergency Online Learning Mode** section.

### What it does
When you turn this ON, every teacher's timetable slot immediately shows a **Join** button using that teacher's saved personal meeting link (Zoom PMI or Google Meet). Students also see Join buttons for each lesson in their Student Dashboard — with the correct time (e.g. 8:00–9:00 Mathematics) and a passcode row if one is set.

This is designed for days when the school cannot be physically accessed — unplanned closures, bad weather, public health events — and you need all lessons to move online instantly.

### Before turning it ON
Ensure every active teacher has saved at least one meeting link in their profile:
1. Ask each teacher to go to **Profile → Online Meeting Links**.
2. Paste their Zoom PMI URL and/or Google Meet URL and click **Save Meeting Links**.

The settings page shows an amber reminder about this when the toggle is ON.

### Turning it ON/OFF
Toggle **Emergency Online Learning Mode** and click **Save Settings**. The change takes effect immediately — no page refresh needed.

---

## 12. Custom Email Sending (SMTP)

By default, all system emails from your school (welcome messages, password resets, attendance alerts, report card notifications, etc.) are sent from the Msingi platform address (`support@msingi.io`) with your school's name as the display name.

If you want emails to come from your own domain — e.g. `noreply@greenwood.ke` or `info@mla.ac.ke` — you can configure your own SMTP server.

### Setting up custom SMTP

1. Go to **Settings → School Profile**
2. Scroll to the **Email / SMTP** section
3. Toggle **Use custom SMTP for school emails** on
4. Fill in the fields:

| Field | What to enter |
|---|---|
| **From name** | Your school's display name (e.g. `Greenwood Academy`) |
| **From email address** | The address emails will appear to come from (e.g. `noreply@greenwood.ke`) |
| **SMTP host** | Your mail server hostname (e.g. `smtp.gmail.com`, `mail.yourschool.ke`) |
| **Port** | `587` with STARTTLS is recommended. Use `465` for SSL/TLS. |
| **Security** | Match the port: STARTTLS for 587, SSL/TLS for 465 |
| **SMTP username** | Your email account username (usually the full email address) |
| **Password** | Your email account password or App Password |

5. Enter a test recipient email address and click **Test** — a test message will be sent. Check the inbox to confirm delivery.
6. Click **Save SMTP** to activate.

> ✅ Msingi always **falls back to the platform sender** if your SMTP server is unreachable, so you will never miss a critical email even during an outage on your mail server.

### Using Gmail as your school SMTP

If your school email runs on Google Workspace (Gmail):

1. Enable **2-Step Verification** on the sending account: [myaccount.google.com → Security](https://myaccount.google.com/security)
2. Go to **App passwords** and generate one for "Mail" / "Other"
3. Use the 16-character App Password (without spaces) as the **Password** field — **not** your regular Gmail password
4. Set **SMTP host** to `smtp.gmail.com`, **Port** to `587`, **Security** to `STARTTLS`

### Removing custom SMTP

Click **Remove Custom SMTP** at the bottom of the SMTP section to revert to the platform sender. All future emails will go through `support@msingi.io` again.

### Troubleshooting

| Error shown | Likely cause | Fix |
|---|---|---|
| *"SMTP_ENCRYPTION_KEY is not set on the server"* | Platform admin has not set the encryption key in Render | Contact the platform administrator — this is a server configuration issue, not a settings error on your side |
| Test email not received | Wrong host / port / credentials | Double-check the SMTP host and port; for Gmail ensure you are using an App Password, not your account password |
| *"Authentication failed"* | Incorrect username or password | Re-enter credentials; for Gmail check App Password is correct and 2FA is enabled on the account |

---

## 13. Data Export & Backup

### Exporting data

Most modules have an **Export** button (top-right of the list view) that downloads a CSV or PDF.

| Module | Export format |
|---|---|
| Students | CSV (full profile) |
| Attendance | CSV per class per term |
| Grades / Report Cards | PDF (printable) |
| Finance | CSV (invoices, payments) |
| HR | CSV (staff records) |

### Full data backup

Your data is stored in MongoDB Atlas with automated cloud backups. As an extra precaution:

1. Go to **Settings → Data**
2. Click **Export All Data** — downloads a ZIP of all your school's data as JSON
3. Store the file in a secure location

This export can be re-imported if you ever need to restore.

---

## 14. Demo School (Msingi)

**Msingi Demo School** is the built-in demo environment at `demo.msingi.io`. It contains realistic sample data including 20 students, 9+ teachers, timetables, behaviour records, finance records, and admissions.

The demo school always runs on the **Enterprise plan** so you can explore every feature without restriction.

### Accessing the demo

Visit **[demo.msingi.io](https://demo.msingi.io)** and use the **Quick Login** panel to sign in as any role with one click:

| Role | Email | What you can explore |
|------|-------|----------------------|
| Admin | `admin@demo.msingi.io` | Everything — full system |
| Deputy Principal | `principal@demo.msingi.io` | Academic, timetable, behaviour |
| Teacher | `teacher@demo.msingi.io` | Attendance, grades, messages |
| Finance Officer | `finance@demo.msingi.io` | Invoices, payments, reports |
| Parent | `parent@demo.msingi.io` | Child's records, messages |
| Student | `student@demo.msingi.io` | Own profile, timetable, grades |

Password for all demo accounts: **`Demo2025!`**

> ⚠️ The demo school uses **shared sample data**. Any changes you make are visible to all demo users but your real school's data is completely separate and unaffected.

---

## 15. Getting Help

### In-app Help Centre

Click **Help Centre** in the sidebar (bottom of the navigation) for searchable guides, FAQs, and video walkthroughs.

### Changelog

Click **Changelog** in the sidebar to see what's new in the latest version.

### Contact Support

| Channel | Details |
|---|---|
| Email | support@msingi.io |
| Response time | Within 24 hours (business days) |
| Priority support | Enterprise plan — 4-hour SLA |

### Reporting a bug

Email support@msingi.io with:
- Your school name and admin email
- A description of the issue
- Steps to reproduce
- Screenshot if possible

---

*Last reviewed: 2026-09-05 — checked directly against the live server code (plan tiers, Admissions/Mother-Father fields, portal accounts), not carried forward from a prior draft. §2 and §6 corrected same day — staff creation via HR → Staff had been omitted entirely in favor of Settings → Users alone, and the Settings button name itself was wrong ("Add Staff" — the real button is "Invite User").*
