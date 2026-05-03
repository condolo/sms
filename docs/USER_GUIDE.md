# InnoLearn — User Guide

**Version 4.5** · Updated 2026-05-03

> **Looking for admin guides?**
> - 🔧 [Platform Admin Guide](PLATFORM_ADMIN_GUIDE.md) — for the InnoLearn platform owner
> - 🏫 [School Admin Guide](SCHOOL_ADMIN_GUIDE.md) — for your school's IT admin / Super Admin
> - 👤 This guide — for all other staff, parents, and students

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [Students](#3-students)
4. [Admissions](#4-admissions)
5. [Classes](#5-classes)
6. [Subjects & Timetable](#6-subjects--timetable)
7. [Attendance](#7-attendance)
8. [Academics & Gradebook](#8-academics--gradebook)
9. [Exams](#9-exams)
10. [Finance](#10-finance)
11. [Communication](#11-communication)
12. [Events & Calendar](#12-events--calendar)
13. [Behaviour & Pastoral](#13-behaviour--pastoral)
14. [HR & Staff](#14-hr--staff)
15. [Reports & Analytics](#15-reports--analytics)
16. [Settings](#16-settings)
17. [Role Reference](#17-role-reference)

---

## 1. Getting Started

### Registering Your School
If your school is not yet on InnoLearn, visit `/onboard` or click **Get Started** on the login page to begin the 4-step registration wizard:

1. **School Details** — name, type, country, URL slug, curriculum, sections
2. **Admin Account** — your name and email address (no password needed — see below)
3. **Choose Plan** — Core, Standard, Premium, or Enterprise (30-day free trial on all plans)
4. **Review & Launch** — confirm your details and tick the Terms of Service box to submit

> **Curriculum options**: CBE (Kenya — Competency Based Education), IB (International Baccalaureate), British (Cambridge / Edexcel), American (US Common Core / AP)

> **No password at registration** — InnoLearn generates a secure temporary password for you. It will be emailed to you when your school is approved. You do not set a password during registration.

After submitting, your application enters a **pending review** state. You will receive a confirmation email and hear back within **24 hours**.

### Approval Process
Once the InnoLearn team reviews and approves your school, you will receive a **welcome email** containing:

| What | Example |
|------|---------|
| **Your dedicated login URL** | `https://app.innolearn.edu.ke?school=greenhill` |
| **Your email / username** | `admin@greenhill.edu` |
| **Temporary password** | `xK7mNpQrBvW3` (system-generated) |

Click the link in the email — it will take you directly to the InnoLearn login page with your school pre-selected. Enter the temporary password and you will immediately be asked to set a permanent one.

> ⚠️ **Save the approval email.** The temporary password is shown once. If you miss it, contact the InnoLearn team to reset it.

If your application is not approved, you will receive an email explaining why, and you are welcome to reapply after addressing any concerns.

> **Note**: You cannot log in while your school is pending approval. If you try, you will see a clear "Application Under Review" screen — not an error.

---

### Logging In
1. Open InnoLearn in your browser.
2. Enter your school email address and password.
3. Click **Sign In**.

### Demo Access
Visit the login page with `?demo=innolearn` in the URL to open the **Demo Role Selector**. Six role cards appear — click any card to fill credentials for that role, then click **Sign In**. No typing required.

Available demo roles: **Super Admin · Teacher · Parent · Finance · Student · Deputy Principal**

### First Login — Setting Your Password
If your account was created by an administrator (individually or via bulk import), you will be asked to **set your own password** the very first time you sign in. Your temporary password (sent to your email) is valid for one login only.

### Forgot Password
Contact your school administrator to reset your password.

### Auto-Logout (Security)
For your security, InnoLearn automatically signs you out after **10 minutes of inactivity**. At 9 minutes, an amber warning toast appears — click **Stay signed in** to reset the timer. This protects shared or unattended devices.

### Password Policy (60-Day Rotation)
All passwords expire every **60 days**. When your password is about to expire:
- A **dashboard banner** appears at the top of your screen (blue → amber → red as expiry approaches)
- An **email reminder** is sent at 7, 3, 1, and 0 days before expiry
- On the expiry day, you will be prompted to set a new password **before** you can log in

Your new password must be at least 8 characters. After changing it, a security confirmation email is sent to your address.

### Your Role
Your role determines which modules appear in your sidebar and what actions you can take. See [Role Reference](#17-role-reference) for a full breakdown.

### Navigation
- Click any item in the **left sidebar** to navigate to that module.
- The **topbar search** finds students by name or admission number.
- The **back button** works normally — InnoLearn uses URL hash routing.
- The **bell icon** shows your latest notifications.

---

## 2. Dashboard

The Dashboard is the first screen after login. What you see depends on your role.

### System Announcement Banners
When InnoLearn schedules a platform update or maintenance window, a **coloured banner** appears at the very top of your dashboard:

| Banner type | Colour | What it means |
|---|---|---|
| 🔧 Scheduled Maintenance | Amber | A maintenance window is planned — back up your data |
| 🚀 Platform Update | Purple | A new version is being deployed |
| 🔒 Security Notice | Red | A security-related change is being applied |
| ℹ️ General Info | Blue | A general platform notice |

For **maintenance and security** banners, you will see a **"Back Up My Data Now"** button — as a superadmin, click it to immediately download a full export of your school's data before the update. Click **Dismiss** when you have read and actioned the notice.

### Password Expiry Banner
If your password is expiring within 7 days, a banner appears above the dashboard cards (urgency colour-coded). Click **Change Password** to update it immediately.

### Trial Expiry Banner
If your school's free trial ends within 7 days, a banner displays the days remaining. Click **Manage Subscription** to review your plan.

### New School — Setup Wizard
If you are a **Super Admin** and your school has just been approved, the dashboard will display a **Setup Checklist** at the top. This is a 7-step guide to getting your school fully configured:

| Step | What to do | Where |
|------|-----------|-------|
| 1 | Complete school profile (address, phone, logo) | Settings |
| 2 | Set up academic year & terms | Settings |
| 3 | Create classes / grades | Classes |
| 4 | Add teaching staff | HR & Staff |
| 5 | Enroll your first students | Students |
| 6 | Configure fee structures | Finance |
| 7 | Set up report card templates | Reports |

A **% completion bar** shows your progress. Each step is clickable and takes you directly to the right module. Once all 7 steps are done, you can dismiss the wizard permanently. You can also click **"Hide for now"** at any time.

### Data Backup (Super Admin)
A **"Data Backup & Export"** card is visible on the Super Admin dashboard, below the Quick Actions. Click **Back Up Now** to instantly download a complete JSON export of all your school's data — students, staff, classes, finance, attendance, behaviour, reports, and every other module. The download begins immediately in your browser.

- No data is stored on InnoLearn's servers during the backup — the file goes directly to your computer
- Every backup is logged (date, record count, system version) — click **View backup history** to review past exports
- You can also trigger a backup from the **"Backup Data"** tile in the Quick Actions grid
- **Always back up before a major platform update** (you will be reminded automatically by dashboard banners and email)

### Admin / Deputy Principal / Section Head
- **KPI cards**: total students, staff, attendance rate, fee collection rate
- **Quick actions**: log incident, add student, view reports
- **Recent activity**: latest incidents, new admissions, upcoming events

### Teacher
- **My Classes**: today's schedule and attendance status
- **Recent Marks**: last submitted gradebook entries
- **Behaviour summary**: recent incidents you logged

### Parent
- Summary for each of your children: attendance, behaviour balance, outstanding fees

### Student
- Personal attendance record, behaviour balance (merit vs demerit), upcoming exams

---

## 3. Students

### Viewing Students
Navigate to **Students** in the sidebar. The list shows all active students with photo initials, admission number, class, and house.

**Filters**: search by name, filter by class, section, or status.

### Student Profile
Click any student row to open their full profile:
- **Overview tab**: personal details, class, house, guardian contacts
- **Academic tab**: current grades, exam results, report cards
- **Attendance tab**: monthly attendance breakdown
- **Behaviour tab**: merit/demerit history, current stage, milestone badges
- **Finance tab**: invoice history and payment status

### Adding a Student
Click **+ Add Student** (admin/superadmin only). Fill in:
- Full name, date of birth, nationality, gender
- Class assignment and admission number
- Guardian details (at least one required)
- Medical notes (optional)

> **Tip**: Students are usually created automatically when an Admissions application is approved. Use manual addition only for direct enrollment.

### Editing a Student
Open the profile and click the **Edit** button. All fields are editable including house assignment.

### Student Status
- **Active** — currently enrolled
- **Inactive** — temporarily suspended or on leave
- **Graduated** — completed schooling
- **Transferred / Withdrawn** — left the school

> **Note:** A student cannot be deleted while they have open behaviour appeals. Resolve or close all pending appeals first.

---

## 4. Admissions

### The Pipeline
Applications move through stages: **Inquiry → Application → Review → Interview → Decision → Enrolled**

### Receiving Applications
- **Online form**: share the public URL (`#apply/<token>`) with prospective families. They can fill it in without logging in.
- **Manual entry**: click **New Application** to enter details directly.

### Reviewing an Application
1. Click an application in the pipeline.
2. Review all submitted information and documents.
3. Move it to the next stage using the stage buttons.

### Approving and Enrolling
1. Click **Approve** on a decision-stage application.
2. Assign a **class**, **year group**, and (optionally) a **house**.
3. Click **Enroll** — a student record is created automatically with all application data carried over.

### Rejecting an Application
Click **Reject** and provide a reason. The applicant family can be notified via the Communication module.

---

## 5. Classes

### Structure
InnoLearn supports four **sections**: KG, Primary, Secondary, and A-Level. Each section contains classes.

### Managing Classes
- **Add Class**: specify name (e.g. "Grade 7A"), section, and homeroom teacher.
- **Edit/Delete**: use the action buttons on each class row.
- Class capacity and room assignment are optional but recommended.

### Homeroom Teacher
Each class can have one homeroom teacher. This teacher sees all class students in the Attendance and Behaviour modules.

---

## 6. Subjects & Timetable

### Subjects
Navigate to **Subjects**. Each subject has:
- **Name** and **code** (e.g. MATH, ENG)
- **Curriculum** tag: Cambridge, IB, or Custom
- **Key Stage** assignment (for filtering)

Admins can **edit** or **delete** subjects directly from the catalogue. A subject cannot be deleted while it appears in the timetable, is assigned to a class, or has grade records.

### Timetable
Navigate to **Timetable** to build the weekly schedule.
- Select a class to view or edit its timetable.
- Click an empty slot to assign a subject and teacher.
- Clash warnings appear if a teacher is double-booked.
- Print or export the timetable from the action bar.

---

## 7. Attendance

### Taking the Register
1. Navigate to **Attendance**.
2. Select your class (teachers see only their assigned classes).
3. Select the date (defaults to today).
4. Mark each student: **Present**, **Absent**, **Late**, or **Excused**.
5. Click **Save Register**.

### Bulk Actions
- **Mark All Present**: one click to mark the whole class.
- **Copy Previous**: pre-fills today's register from yesterday's.

### Viewing Reports
Switch to the **Reports** tab in Attendance to see:
- Individual student attendance percentage
- Class-level daily/weekly/monthly summaries
- Absence trend charts

### Absence Notifications
When a student is marked Absent, parents with linked accounts receive an automatic notification.

---

## 8. Academics & Gradebook

### Entering Marks
1. Navigate to **Academics**.
2. Select a class and subject.
3. Enter marks for each student in the marks grid.
4. Click **Save** — grades are calculated automatically based on the configured grade boundaries.

### Grade Boundaries
Configured per subject or school-wide in **Settings**. Supports:
- Cambridge A–U boundaries
- IB 1–7 scale
- Custom percentage thresholds

### Report Comments
Each teacher can add a written comment per student per subject. These appear on the generated report card.

### Viewing Progress
The **Progress** tab shows a student's grade trajectory across terms. Grade trends are colour-coded (green = improving, red = declining).

---

## 9. Exams

### Creating an Exam
1. Navigate to **Exams → + New Exam**.
2. Set name, subject, class(es), date, time, and room.
3. Assign an invigilator.
4. Click **Save**.

### Recording Results
1. Open an exam.
2. Click **Enter Results**.
3. Type scores for each student.
4. Click **Save** — the system calculates grade, rank, and class average automatically.

### Exam Timetable
The **Timetable** tab shows all scheduled exams in a calendar view. Export as PDF for distribution.

---

## 10. Finance

### Fee Structures
Set up fee structures in **Finance → Settings** (admin only):
- Term-based fees by class or section
- Optional extras (transport, lunch, uniform)

### Invoices
- Invoices are generated automatically when a new term starts (if configured).
- Manual invoice: **Finance → Invoices → + New Invoice**.

### Recording Payments
1. Open a student's invoice.
2. Click **Record Payment**.
3. Enter amount, date, and payment method.
4. Click **Save** — the invoice status updates automatically (Paid / Partial / Overdue).

### Finance Dashboard
Shows:
- Total expected vs collected this term
- Collection rate percentage
- Top outstanding balances
- Recent payment activity

---

## 11. Communication

> **Messages are now stored in the cloud.** They persist across all devices and sessions — no data is lost when you clear your browser or log in from a different computer.

### Sending a Message
1. Navigate to **Communication → + Compose**.
2. Select recipients: an individual user, a role group (All Teachers, All Parents, etc.), or Everyone.
3. Write a subject and body.
4. Click **Send Message**.

The recipient will receive an **email notification** immediately with a preview of your message and a link to log in and reply.

### Sending a School Announcement
Admins and Deputy Principals see an additional **Announcement** button:
1. Click **Announcement**.
2. Choose your audience (Everyone / Teachers / Parents / Students / Staff).
3. Write the subject and message.
4. Click **Send Announcement**.

Every member of the selected audience receives a notification email. The announcement also appears in their in-app inbox.

### Inbox
Your inbox shows all messages sent:
- Directly to you
- To your role group (e.g. All Teachers)
- To Everyone in the school

Unread messages are highlighted. Click a message to open it — it is automatically marked as read.

### Replying
Open a message and scroll to the **Reply** box at the bottom. Type your reply and click **Send Reply**. The original sender receives an email notification.

### Notifications vs Messages
- **Notifications** (bell icon, top-right): automatic system alerts (attendance, behaviour, finance).
- **Messages** (Communication module): manually composed messages — permanently stored and accessible from any device.

---

## 12. Events & Calendar

### Adding an Event
1. Navigate to **Events → + New Event**.
2. Set title, date, time, type (school-wide, class, staff only), and description.
3. Click **Save** — the event appears on the calendar.

### Calendar Views
Switch between **Month**, **Week**, and **List** views using the view toggle.

### Event Types
- **School-wide**: visible to all roles
- **Class event**: visible to students and parents in that class
- **Staff only**: visible to teachers and above

### Birthday Indicators
The calendar automatically marks days that have student or staff birthdays with a 🎂 emoji next to the date number.

- **Click the 🎂** to open a popup showing everyone celebrating on that day — their name, role/class, and the age they are turning.
- Today's birthdays show a **"Turns N! 🎉"** badge; future birthdays show their age.
- Multiple people sharing a birthday are all listed together.

---

## 13. Behaviour & Pastoral

The Behaviour module is the most comprehensive in InnoLearn. It runs a dual merit/demerit system aligned to the SAA Behaviour Points System v2.

### The Point System
- **Merits** (positive points): awarded for outstanding behaviour, achievement, leadership, etc.
- **Demerits** (negative points): logged for rule-breaking, misconduct, etc.
- Points contribute to the **House Cup** competition.
- Cumulative merit points unlock **Milestone badges**.
- Cumulative demerit points (per half-term) trigger **Intervention Stages**.

### Dashboard
The Behaviour dashboard shows:
- **Period filter pills** (Weekly / Monthly / Termly / All Time) — all panels update.
- **Stats cards**: merit points, demerit points, incident count, pending appeals.
- **House Cup** standings with point bars.
- **At-risk Students** (3+ demerit pts this half-term).
- **Top Merit Earners** leaderboard.
- **Stage Alerts**: students currently at a demerit intervention stage.
- **Persistent Patterns**: same behaviour logged ≥ 2 times in the selected period.

### Logging an Incident
Click **+ Log Incident** (teachers and above). The modal guides you through three steps:

**Step 1 — Incident Type**
Select **Merit ⭐** or **Demerit ⚠️**.

**Step 2 — Select Category**
Choose from the category grid. Each card shows the category icon, name, and the number of behaviours available for the type you selected in Step 1. Categories with no items for that type still appear but will show an empty list in Step 3.

**Step 3 — Select Behaviour**
- **Standard Matrix categories** — A list of specific behaviours for that category and type (merits or demerits only, never mixed) appears with a search box. Click a behaviour to select it. Its point value is locked and shown in the preview card.
- **Custom categories** — No item list; the fixed point value is displayed automatically.

**Before submitting:**
- If the selected behaviour is worth **5 or more points**, a detailed note is **required** before you can submit.
- Select the **student** and **date**.
- Add an optional note (for non-serious incidents).
- Click **Log Incident**.

> **Tip:** Changing the type (Step 1) or category (Step 2) resets the behaviour selection but preserves the student and date you have already chosen.

### Register Tab
Full incident table with filters:
- Period (same pills as dashboard)
- Type (Merit / Demerit / All)
- Status (Active / Under Appeal / Overturned / All)
- Class filter
- Text search (student name, category, note)

Overturned incidents are shown faded.

### Appeals Tab

**For Students**:
- View all your submitted appeals and their status.
- Submit an appeal against any active demerit: go to "Demerits Eligible to Appeal" → click **Appeal** → write your reason → **Submit Appeal**.

**For Parents**:
- See your child's pending appeals.
- Click **Add Note** to add supporting context that staff will see when reviewing.

**For Staff (Teacher / Deputy / Discipline)**:
- View all pending appeals.
- Click ✓ **Accept** to overturn the incident (incident → Overturned).
- Click ✗ **Reject** to uphold the incident (incident → Active).
- Click ↑ **Escalate** (deputy/discipline only) to refer to a panel.
- All actions require a resolution note.

### Milestones
Merit milestones are awarded automatically when a student's cumulative merit points cross a threshold:

| Milestone | Threshold |
|---|---|
| 🥉 Bronze Award | 25 pts |
| 🥈 Silver Award | 50 pts |
| 🥇 Gold Award | 100 pts |
| 🏅 Principal's Award | 200 pts |
| 🏆 Platinum Award (KS5 only) | 300 pts |

### Demerit Stages (Rolling Half-Term)
Stages reset per half-term. Thresholds are cumulative demerit points:

| Stage | Threshold | Responsibility |
|---|---|---|
| Stage 1 | 5 pts | Class Teacher — Pastoral check-in |
| Stage 2 | 10 pts | KS Coordinator — Behaviour record review |
| Stage 3 | 20 pts | Pastoral Lead — Support Plan + Parent meeting |
| Stage 4 | 35 pts | Deputy Principal — Formal referral |
| Stage 5 | 50 pts | Principal / Disciplinary Committee |

### PDF Report
Click **Report** in the page header to generate and print a full behaviour report for the current period. Includes: House Cup, Stage Alerts, Persistent Patterns, Student Summary, and Staff Activity.

---

## 14. HR & Staff

### Staff List
Navigate to **HR & Staff**. View all teaching and non-teaching staff with their role, department, and employment status.

### Staff Profiles
Click a staff member to open their profile:
- Personal and contact details
- Employment type (full-time / part-time / contract)
- Subject assignments and homeroom class
- Emergency contact

### Adding Staff
Click **+ Add Staff Member**. All new staff accounts are also created in the user directory with appropriate role(s).

---

## 15. Reports & Analytics

### Available Reports
Navigate to **Reports**. Report types include:
- **Attendance Report**: class or school-wide, by date range
- **Academic Report**: grade distribution, subject averages, top performers
- **Behaviour Report**: incidents by type, house standings, at-risk students
- **Finance Report**: collection summary, outstanding balances, payment trends
- **Admissions Report**: pipeline conversion rates, source analysis

### Generating a Report
1. Select report type.
2. Set filters (date range, class, section).
3. Click **Generate**.
4. Export as **PDF** or **CSV**.

### Report Cards
Student-level term reports are generated from **Academics → Report Cards**. Each card includes:
- Subject grades and teacher comments
- Attendance summary
- Behaviour summary (merit total, demerit total, current stage, highest milestone)
- Principal's comment

---

## 16. Settings

> **Admin / Superadmin only**

### School Profile
Update school name, short name, code, type, address, contact details, timezone, currency, and active curriculum tracks.

### Academic Year & Terms
Configure academic year dates, term boundaries, and set the current active term.

### Branding *(Super Admin only)*

Personalise the look and feel of InnoLearn for your school.

**App Identity**
- **Logo** — upload PNG/SVG/JPG (max 2 MB). Displayed in the sidebar header. Transparent background recommended.
- **Favicon** — upload a square image (max 512 KB). Shown in browser tabs and bookmarks.
- **App Name** — rename "InnoLearn" to your school's system name. Appears in the sidebar and browser title bar.

**Theme Colors**
- Choose from 6 quick presets (Ocean Blue, Emerald, Violet, Rose, Amber, Cyan) or set custom colors.
- **Primary Accent** — buttons, links, badges, active sidebar item.
- **Sidebar Background** — the left navigation panel color.
- A live mini-preview updates as you adjust colors.
- Click **Save Branding** to apply. **Reset to Default** restores InnoLearn defaults.

**Login Page Animation**
- Choose a canvas background effect for the login screen: **None · Particles · Aurora · Water · Clouds · Fire**.
- Set an **Effect Color** to tint the animation.
- Click **Save Login Page** to persist.

**Login Page Content**
- Edit the welcome title and subtitle shown on the sign-in form.
- Edit the tagline and footer text shown on the left panel.
- Edit the titles and descriptions of the 4 feature highlight cards.

**Social Media Links**
- Add URLs for Facebook, X/Twitter, Instagram, LinkedIn, WhatsApp, and YouTube.
- Links appear as circular icon buttons on the login page left panel. Leave blank to hide.

### Role Permissions
Fine-grained control over what each role can see and do. Sub-module permissions available (e.g. allow Teachers to view Finance but not create invoices).

### Behaviour Settings
Sub-tabs:
- **Behaviour Matrix**: read-only browser of all 120 standard SAA BPS v2 items grouped by category, with type filter and search
- **Categories**: manage the categories used in the Log Incident modal. The 8 SAA BPS v2 groups are pre-seeded as defaults (labelled *SAA BPS v2 Default*). You can:
  - **Edit** any category to rename it or change its icon/colour
  - **Delete** any category (existing incidents are not affected)
  - **Add Custom Category** — creates a new category with a fixed point value (not linked to the standard matrix)
- **Merit Milestones**: view and adjust milestone thresholds and badges
- **Demerit Stages**: view and adjust stage thresholds and responsible staff
- **Houses**: manage house names, colours, and badges
- **Key Stages**: configure grade groupings
- **Detention Types**: define detention sessions (name, day, time, location)

---

## 17. Role Reference

| Role | Key Access |
|---|---|
| **Superadmin** | Full access to everything including system settings and all data |
| **Admin** | All modules; cannot access raw system configuration |
| **Deputy Principal** | Behaviour (full + appeals escalation), Students, Attendance, HR view |
| **Discipline Committee** | Behaviour (full + appeals escalation), Students view |
| **Section Head** | All students in their section; behaviour logging; attendance |
| **Teacher** | Own classes: attendance, academics, behaviour logging, communication |
| **Finance** | Finance module (full); read-only Students and Reports |
| **Parent** | Own children only: dashboard summary, attendance, academics, behaviour, communication |
| **Student** | Own record only: dashboard, behaviour history + appeals, timetable, exams |

### What Students Can Do
- View their own merit/demerit history
- See their current stage and milestone progress
- Submit appeals against active demerits
- Track appeal status and staff resolution

### What Parents Can Do
- View their children's attendance, grades, and behaviour
- Add notes to pending appeals for their children
- Receive automated notifications (absences, milestones, demerit stages, invoices)
- Send messages via the Communication module
