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
11. [Data Export & Backup](#11-data-export--backup)
12. [Demo School (Msingi)](#12-demo-school-msingi)
13. [Getting Help](#13-getting-help)

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
- [ ] **Create staff accounts** — Settings → Users → Add Staff
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

Subjects are then linked to classes via the **Timetable** module (Standard plan and above).

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

### Inviting a staff member

1. Go to **Settings → Users**
2. Click **Invite User** (top right)
3. Enter full name (optional), email address, and assign a role
4. Click **Send Invite** — Msingi generates a secure password and emails it to the staff member automatically
5. The staff member can log in immediately with those credentials

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
| **Finance** | Finance module only (Standard plan) |
| **HR** | HR & Payroll module (Premium plan) |
| **Timetabler** | Timetable builder only (Standard plan) |
| **Discipline Committee** | Behaviour & Pastoral module |
| **Parent** | Read-only: their children's data, events, messaging |
| **Student** | Read-only: own profile, events, timetable |

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

For a formal application workflow:
1. **Admissions module** → New Application
2. Track through stages: Applied → Interview → Accepted → Enrolled
3. On acceptance, convert to a full student record

### Bulk import (CSV)

Available from **Students → Import**. Upload a CSV of up to 500 students per batch — the system validates every row first and reports which rows succeeded and which were skipped (with a reason) before anything is saved. Rows that don't supply their own admission number are auto-assigned the next number in your school's sequence.

### Student portal accounts

Each student can have a **student login** (signs in with their admission number) and, if a parent email is on file, a **parent login** — created individually from that student's profile (**Students → [student] → Portal** tab) or in bulk:

1. From the **Students** list, select the students who need portal access (checkbox column).
2. Click **Grant Portal Access**. Any number of students works in one click — the system batches large selections automatically.
3. A CSV of one-time login credentials (name, admission number, temporary password) downloads automatically. **Save this file before closing the result banner** — passwords are never stored in readable form and cannot be recovered afterward. Print it, or share each row individually with the relevant student/parent.
4. Every account requires a password change on first login, so a slip changing hands after the student has already logged in poses no risk.
5. If a student loses their credentials before ever logging in, reset just that one account from their Profile → Portal tab rather than re-running the bulk action.

Siblings share one parent account automatically: put the same parent email on each sibling's profile, then create the parent account from each sibling's Portal tab in turn — the second and later clicks link that child to the existing account (and reset its password) instead of creating a duplicate. The parent must log out and back in to see a newly linked child.

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

### Plan comparison

| Feature | Core | Standard | Premium | Enterprise |
|---|---|---|---|---|
| Students, Classes, Subjects | ✅ | ✅ | ✅ | ✅ |
| Admissions, Attendance, Exams | ✅ | ✅ | ✅ | ✅ |
| Reports & Analytics | ✅ | ✅ | ✅ | ✅ |
| Communication & Events | ✅ | ✅ | ✅ | ✅ |
| **Timetable Builder** | ❌ | ✅ | ✅ | ✅ |
| **Behaviour & Pastoral** | ❌ | ✅ | ✅ | ✅ |
| **Finance & Invoicing** | ❌ | ❌ | ✅ | ✅ |
| **HR & Payroll** | ❌ | ❌ | ✅ | ✅ |
| **M-Pesa Integration** | ❌ | ❌ | ✅ | ✅ |
| **White-label / Custom Domain** | ❌ | ❌ | ❌ | ✅ |
| **LMS Integration** | ❌ | ❌ | ❌ | ✅ |
| Price (KES/month) | 15,000 | 35,000 | 65,000 | Custom |

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

## 10b. eLearning Settings — Emergency Online Learning Mode *(Standard plan)*

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

## 11. Custom Email Sending (SMTP) — Standard plan and above

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

## 12. Data Export & Backup

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

## 13. Demo School (Msingi)

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

## 14. Getting Help

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

*Last updated: 2026-06-09 — Msingi v4.30.0*
