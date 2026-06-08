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
- [ ] **Verify academic year** — Settings → Academic Years (a default 2025-2026 year with 3 terms is pre-created)
- [ ] **Confirm/edit sections** — Settings → Sections (KG, Primary, Secondary, A-Level are pre-created — edit to match your school)
- [ ] **Add classes** — Classes module → Add your year groups / form levels
- [ ] **Add subjects** — Subjects module → Add your curriculum subjects
- [ ] **Create staff accounts** — Settings → Users → Add Staff
- [ ] **Assign roles** — Assign each staff member an appropriate role
- [ ] **Enroll students** — Students module → Enroll or import via Admissions

---

## 3. Managing Academic Years & Terms

Go to **Settings → Academic Years**.

### Creating a new academic year

1. Click **Add Academic Year**
2. Enter the year name (e.g. `2026-2027`), start and end dates
3. Add terms with their own start/end dates
4. Mark one term as **Current** — this drives attendance, timetable, and reporting
5. Save

### Setting the current term

Only one term can be active at a time. Click **Set as Current** next to the relevant term. This updates:
- Attendance sheets (only current-term dates shown)
- Timetable display
- Grade entries

> ⚠️ Changing the current term mid-term will affect what teachers see immediately. Do this at the start of a new term.

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

### Inviting a staff member

1. Go to **Settings → Users**
2. Click **Invite User** (top right)
3. Enter full name (optional), email address, and assign a role
4. Click **Send Invite** — Msingi generates a secure temporary password and emails it to the staff member automatically
5. The staff member follows the link in the email and is forced to set a new password on first login

> **If the email doesn't arrive** — use the password reset flow below to retrieve or regenerate a temporary password you can share directly.

### Resetting a user's password (admin only)

If a staff member never received their welcome email — or has forgotten their password and cannot recover it by email — you can assign them a new temporary password instantly:

1. Go to **Settings → Users**
2. Hover over the user's row — a **key icon** (🔑) appears on the right
3. Click the key icon to open the **Set Temporary Password** dialog
4. Confirm by clicking **Set Password**
5. The dialog shows the generated temporary password — copy it and share it with the user via a secure channel (phone, WhatsApp, in person)
6. A copy of the password is also emailed to the user automatically; the dialog tells you whether the email was delivered

> **The password is shown once.** Copy it before closing the dialog. The user will be required to change it on their next login.

> **Note:** A regular admin cannot reset the password of another admin or superadmin. Only a superadmin can do this.

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

*(Coming in v3.2 — Data Migration Tool)*

For transitioning from another system, a CSV import tool is planned. In the meantime, use the Admissions module for batch processing or contact your Msingi administrator for a manual migration.

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

## 11. Data Export & Backup

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

## 12. Demo School (Msingi)

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

## 13. Getting Help

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

*Last updated: 2026-05-19 — Msingi v4.9.9*
