/* ============================================================
   Help Centre — searchable FAQ covering every Msingi module
   ============================================================ */
import { useState, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight,
  BookOpen, Users, Wallet, CalendarDays, FileText, Scale,
  BarChart3, Settings, GraduationCap, MessageSquare, HelpCircle,
  Clock, ClipboardList, MonitorPlay, BookCheck,
  ClipboardCheck, Layers, UserCog, Database,
  BookMarked, Bus, BedDouble, TrendingUp, Library,
  Sprout, CalendarCheck, HeartPulse, Boxes, Link2, LineChart,
} from 'lucide-react';
import { useSchoolTheme, withOpacity } from '@/hooks/useSchoolTheme.js';
import useAuthStore from '@/store/auth.js';
import { buildModuleConfigMap } from '@/config/moduleNav.js';

/* ── Section → module permission key mapping ──────────────────────
   null  = always visible (Getting Started, universal sections)
   string = must pass can(moduleKey) OR be admin/superadmin
   ──────────────────────────────────────────────────────────────── */

/* ── All FAQ content ──────────────────────────────────────────── */
const SECTIONS = [
  /* ── Getting Started ──────────────────────────────────────── */
  {
    id: 'getting-started',
    moduleKey: null,
    Icon: BookOpen,
    title: 'Getting Started',
    articles: [
      {
        q: 'How do I sign in?',
        a: 'Open your school portal. Staff sign in with their email address, and students with their admission number. Enter your password and click Sign In. Google or Microsoft sign-in buttons appear on the login page where your school has enabled them. If your account requires a one-time code, you will be asked for it after your password.',
      },
      {
        q: 'I forgot my password. What do I do?',
        a: 'There is no self-service password reset yet. Ask your school administrator to reset it from Settings → Users. They can enter a new password or let Msingi generate one, and then share it with you securely.',
      },
      {
        q: 'Why am I being asked to change my password?',
        a: 'Msingi requires a password change every 90 days. You will be asked to choose a new one at sign-in. A new password must be at least 8 characters. You must also change the password when an administrator has set a temporary one.',
      },
      {
        q: 'I have multiple roles. What do I see?',
        a: 'Your sidebar shows only the modules your role has permission to access. If you have multiple roles (e.g. Teacher + Finance Officer), you see the union of all modules those roles can reach.',
      },
      {
        q: 'What browsers does Msingi support?',
        a: 'Use a current version of Chrome, Firefox, Edge or Safari. Keep the browser updated for the best experience.',
      },
      {
        q: 'Can I use Msingi on my phone?',
        a: 'Yes. Msingi is fully responsive and works on smartphones and tablets. Use a recent version of Chrome or Safari for the best mobile experience.',
      },
      {
        q: 'How is my data stored and who can see it?',
        a: "Each school's records are kept separate from other schools' records, and each user sees only what their school and role allow. Who can see which records is set by the Roles & Permissions for your school.",
      },
      {
        q: 'What is the academic year context?',
        a: 'Everything in Msingi — attendance, grades, fees, timetables — is tied to an academic year. Make sure your administrator has created and activated the current academic year in Settings before entering data.',
      },
    ],
  },

  /* ── Classes ──────────────────────────────────────────────── */
  {
    id: 'classes',
    moduleKey: 'classes',
    Icon: Layers,
    title: 'Classes & Streams',
    articles: [
      {
        q: 'How does the Classes → Streams architecture work?',
        a: 'Classes represent year groups (e.g. Form 3, Year 8). Streams are teaching groups within a class (e.g. Form 3A, Form 3B, Form 3 East). Each student belongs to a stream, and each stream has its own timetable. The curriculum and marks are kept per class and subject.',
      },
      {
        q: 'How do I create a class?',
        a: 'Go to Classes → "Add Class". Enter the class name and, optionally, choose its section (e.g. Primary, Secondary), then save. Open the class to add its streams.',
      },
      {
        q: 'How do I add streams to a class?',
        a: 'Open a class card → click "Add Stream". Enter the stream name (e.g. A, B, East), assign a class teacher and room, set capacity, then save. Repeat for each teaching group in that year.',
      },
      {
        q: 'What are Sections?',
        a: 'Sections group classes by school division (e.g. "Primary" contains Years 1–6; "Secondary" contains Forms 1–4). They are optional but help with reporting and permission scoping for Section Heads.',
      },
      {
        q: 'Can I delete a class that has students?',
        a: 'No. A class with active streams cannot be deleted, and a stream with active students cannot be deleted. Move or deactivate students first, then remove the stream, then the class.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Classes\n• Create Class\n• Edit Class\n• Delete Class\n• Export Classes (CSV)\n• Import Classes (CSV)\n• Manage Sections & Streams\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Subjects ─────────────────────────────────────────────── */
  {
    id: 'subjects',
    moduleKey: 'subjects',
    Icon: Library,
    title: 'Subjects',
    articles: [
      {
        q: 'How do I add a subject?',
        a: 'Go to Subjects → Catalog. Add the subject under its department, with a name and a code. The code must be unique in your school. The subject then appears in the catalogue, and you add it to each class in the Curriculum tab.',
      },
      {
        q: 'How do I add a subject to a class?',
        a: 'Go to Subjects → Curriculum. Pick the class. The left panel lists the subjects available for that class\'s section. Click a subject to add it to the class\'s curriculum. Use the compulsory switch on a subject to mark it compulsory for that class. You can also bulk-assign subjects.',
      },
      {
        q: 'What is a compulsory subject?',
        a: 'A subject marked compulsory for a class. In a class that has streams, a compulsory subject must be assigned to each stream separately, so each stream has its own teacher for it. Electives can be assigned at class level.',
      },
      {
        q: 'How do students take a subject?',
        a: 'Go to Subjects → Enrollment. Pick a class, then a subject from its curriculum. Add individual students by search, or enrol the whole class at once. Remove a student from a subject from the same screen.',
      },
      {
        q: 'What do the Subjects Warnings mean?',
        a: 'Subjects → Warnings compares how many subjects each student is enrolled in against the minimum and maximum set for their class or section. The Timetabler sets these rules. A class with no rule shows "No rule configured", so no warning is given for it. Correct the enrolment, or ask the Timetabler to review the rule.',
      },
      {
        q: 'What happens when I delete a subject?',
        a: 'The subject is deactivated, not erased. It stops appearing in the catalogue for new use, and its existing records are kept, so past marks and history are not lost.',
      },
      {
        q: 'Can the same subject be taught by different teachers in different classes?',
        a: 'Yes. The subject is one catalogue entry. Each class curriculum links it separately, and the teaching assignment for each class (and stream) names its teacher. Each class-subject link is independent.',
      },
      {
        q: 'What is a class-subject?',
        a: 'A class-subject is one subject in one class, for example Mathematics in Form 3A. It is the unit that enrolments and teaching assignments attach to.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Subjects & Departments\n• Create Subject / Department\n• Edit Subject\n• Delete Subject\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Students ─────────────────────────────────────────────── */
  {
    id: 'students',
    moduleKey: 'students',
    Icon: GraduationCap,
    title: 'Students',
    articles: [
      {
        q: 'How do I add a new student?',
        a: 'Go to Students → "Add Student". Fill in the required fields (first name, last name, class, stream) and optional details like date of birth, guardian contacts, and photo. An admission number is generated automatically based on your school\'s configured format.',
      },
      {
        q: 'How do I import students in bulk?',
        a: 'Go to Students → Import → download the CSV template → fill in your student data → upload the file. The import checks each row and reports errors. A class or stream named in the file must already exist, and a house must already exist in Settings. Admission numbers already in Msingi are skipped, not updated, so the import cannot change an existing student\'s class. Opening fee columns create an invoice only for new students. The import writes rows as soon as it runs, so check the file before you upload it.',
      },
      {
        q: 'How do I filter and search students?',
        a: 'Use the filter bar to narrow by Section, Class, Stream, Gender, Status, or Enrolment Year. All active filters are shown as chips. The Export button respects the active filters — what you see is what gets exported.',
      },
      {
        q: 'How do I bulk-select and act on multiple students?',
        a: 'Click the checkbox on any row to select it (or the header checkbox to select the whole page). A bulk action bar appears with options to Deactivate or Permanently Delete selected students. Permanent delete needs an admin-level role or the Permanently Delete Students permission, and an explicit confirmation.',
      },
      {
        q: 'How do I mark a student as transferred or graduated?',
        a: 'Open the student\'s profile → Edit → set Status to "Transferred", "Graduated", or "Withdrawn" → Save. The student leaves the active roll but their full record is preserved.',
      },
      {
        q: 'Can a student have a portal login?',
        a: "Yes. An admin creates a student portal account from the student's profile → Portal tab. The student logs in with their admission number and a password, and can view their timetable, attendance, grades, behaviour history, and report cards.",
      },
      {
        q: 'How do I set up a parent portal account?',
        a: "From the student's profile → Portal tab. If the student has separate Mother and Father details on file, you'll see two independent cards — 'Mother's Portal Account' and 'Father's Portal Account' — each created and reset on its own, so no one has to share a password to see their child's information. A student with only a single, combined parent contact on file has no separate Mother or Father cards. Either way, parents see their child's attendance, grades, fees, report cards, and can message teachers.",
      },
      {
        q: 'Can I grant portal access to many students at once?',
        a: 'Yes. Select multiple students in the list → the bulk action bar shows "Grant Portal Access". This creates login accounts for all selected students who do not already have one and returns a created/skipped summary.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Student List\n• View Student Profile\n• Add Student\n• Edit Student\n• Deactivate Student\n• Export Students (CSV)\n• Import Students (CSV)\n• Promote Students to Next Class\n• Manage Student Portal Accounts\n• Resolve Duplicate Student Records\n• Permanently Delete Students\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
      {
        q: 'Can I reactivate a deactivated student?',
        a: 'Yes. Open the student\'s profile — an inactive, withdrawn, graduated, or transferred student always shows a Reactivate action (anyone with Edit Student can use it). Reactivating sets status back to active and the student immediately reappears in their class/stream roster.',
      },
    ],
  },

  /* ── Teachers ─────────────────────────────────────────────── */
  {
    id: 'teachers',
    moduleKey: 'teachers',
    Icon: Users,
    title: 'Teachers',
    articles: [
      {
        q: 'How do I add a teacher?',
        a: 'Go to HR and click "Add Staff", then fill in the staff member\'s details. This creates the staff record only. It does not create a login. To give them a login, open their record in HR and choose Create Login Account. Msingi creates the account with a temporary password and emails them a welcome message. They must set a new password at first sign-in. You can also invite a user from Settings → Users and assign their role there.',
      },
      {
        q: 'How do I import teachers in bulk?',
        a: 'Use the teacher import (download the CSV template, fill in the staff data, then upload). Each imported teacher who does not already have a login gets one created automatically. Check the import result for any rows that were skipped or had errors.',
      },
      {
        q: 'How do I assign a teacher to a class or subject?',
        a: 'Open the teacher\'s profile and go to the Assignments tab. Add the class, subject and, where the class has streams, the stream they teach. The tab lists all their current assignments, and each one can be removed there. The subject must already be in that class\'s curriculum (Subjects → Curriculum).',
      },
      {
        q: 'Can a teacher be assigned to several classes and streams?',
        a: 'Yes. Each assignment is one class, subject and stream. A teacher can have as many as needed. A compulsory subject in a class with streams needs an assignment for each stream.',
      },
      {
        q: 'What can a teacher edit on their own profile?',
        a: 'Teachers can update their phone, address, qualifications, specialisation, next-of-kin contact, and personal meeting links (Zoom PMI / Google Meet) from Profile — no admin approval required. Name, email, and role changes need an admin.',
      },
      {
        q: 'How do I deactivate a teacher who has left the school?',
        a: "Open the teacher's profile and set their status to Inactive (or On leave, or Terminated, where the school uses those). Their record is kept, and so are the marks, attendance and lesson coverage they recorded. Deleting a teacher from the list does the same: it marks the record inactive and keeps its history. Their login is not changed by this, so disable the login separately in Settings → Users if they should no longer sign in.",
      },
      {
        q: 'How do I filter and search teachers?',
        a: 'Use the filters to narrow the list by Department or Status. Export downloads the teacher list as CSV.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Teacher List\n• View Teacher Profile\n• Add Teacher\n• Edit Teacher\n• Delete Teacher\n• Export Teachers (CSV)\n• Import Teachers (CSV)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Admissions ───────────────────────────────────────────── */
  {
    id: 'admissions',
    moduleKey: 'admissions',
    Icon: ClipboardList,
    title: 'Admissions',
    articles: [
      {
        q: 'How does the admissions pipeline work?',
        a: 'Applications move through stages: Enquiry → Application → Assessment → Interview → Offer → Acceptance → Enrolled (or Withdrawn / Rejected). You can move an application to the next stage at any time.',
      },
      {
        q: 'How do I create a new application?',
        a: "Go to Admissions → 'New Application'. Fill in the applicant's details (Full Names, Gender, and Date of Birth are required), select the target class and academic year, and add at least one parent — Mother and/or Father, entered separately with their own name and email (email is required for any parent you name, so they can get their own portal login later). A unique application reference is generated automatically.",
      },
      {
        q: 'How do I enrol an accepted applicant as a student?',
        a: "Once an application reaches 'Acceptance', open it and click 'Enroll Student' — a deliberate, one-time action that creates a real student record pre-filled from the application and assigns the permanent admission number at that exact moment. Safe to click twice: an already-enrolled application returns the same student rather than creating a duplicate.",
      },
      {
        q: 'Can I track notes and communication per application?',
        a: 'Yes. Each application has a stage history log showing every status change with the staff member who made it and a timestamp. You can add notes when changing stages.',
      },
      {
        q: 'Are admission fees billed when a student is enrolled?',
        a: 'Only if the school has set a fee structure to generate automatically on enrolment. That structure must apply to all students. Each new student then gets a draft invoice. Finance reviews the draft and issues it, so nothing reaches the parent until it is issued. The admission fee is not marked as non-refundable, there is no refund process for the caution fee, and admission charges cannot be limited to one class. Term fees are billed separately, through Finance → Term Billing or Fee Structures.',
      },
      {
        q: 'Where do I see the admissions funnel overview?',
        a: 'The Dashboard → Admissions Pipeline bar chart shows counts by stage. For full detail, go to Admissions — the board view shows all active applications grouped by stage.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Pipeline\n• Add Applicant\n• Edit Applicant Details\n• Move Pipeline Stage\n• Delete Applicant\n• Export Applicants (CSV)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Attendance ───────────────────────────────────────────── */
  {
    id: 'attendance',
    moduleKey: 'attendance',
    Icon: CalendarDays,
    title: 'Attendance',
    articles: [
      {
        q: 'How do I mark attendance for my class?',
        a: 'Go to Attendance → select the date and class (and stream, if the class has more than one — see below) → mark each student as Present, Absent, Late, or Excused → click Save. Each class or stream has one register per date. Saving again for the same date updates that register; it never creates a second one.',
      },
      {
        q: 'My class has multiple streams (e.g. Year 3A and 3B) — why do I have to pick one before I can mark attendance?',
        a: 'Each stream runs its own timetable — often a different time and sometimes a different room — so it needs its own register, not one list merging every stream together. The stream picker only appears when a class genuinely has more than one stream; a class with just one (or none) works exactly as before, no extra step. If you teach today\'s scheduled period for that class/stream, a small chip near the top of the page shows the matching subject and period from your timetable — purely a confirmation that you\'re marking the right register, it never blocks you from taking attendance outside that exact period.',
      },
      {
        q: 'Can I mark the whole class present at once?',
        a: 'Yes. Above the register is a "Quick mark" row with All Present, All Absent, All Late and All Excused. Each sets every student in the register to that status in one click. Then change any exceptions individually before saving.',
      },
      {
        q: "Where can I see a student's full attendance history?",
        a: "Open the student's profile — the Attendance tab shows their complete record with a monthly summary table and overall attendance percentage.",
      },
      {
        q: 'What does the attendance percentage mean?',
        a: 'The percentage shows Present days ÷ Total school days recorded. Below 80% is highlighted amber; below 60% is red. These thresholds also drive the "at-risk students" panel in Leadership Analytics.',
      },
      {
        q: 'Can I edit attendance after saving?',
        a: 'Yes, if your role has edit permission for attendance. Reopen the register for that date and class, make the changes, and save again.',
      },
      {
        q: 'Do teachers only see their own classes?',
        a: "Yes, from two separate sources. A subject teacher sees the classes/streams they're assigned to teach. A form/homeroom teacher (set per stream from Classes → open a class → edit a stream → Form Teacher) also sees their own homeroom stream here — for daily attendance only — even if they don't teach a subject there. Admins, deputy principals, and Section Heads (within their section) see every class.",
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Register\n• Mark Attendance\n• Edit Records\n• Export / Print Register\n• School-Wide Report\n• View Absent Students & Contact Details\n• Attendance Conflicts (Present/Absent Mismatch)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
      {
        q: 'Can I take attendance straight from my dashboard?',
        a: 'Yes. Your Dashboard\'s "Today\'s Timetable" widget lists each of your lessons for today, with a "Take Att." shortcut on each row that opens Attendance with that lesson\'s class (and stream, if it has one) already selected. The button switches to "✓ Att." once that class/stream\'s register has been submitted for the day.',
      },
    ],
  },

  /* ── Timetable ────────────────────────────────────────────── */
  {
    id: 'timetable',
    moduleKey: 'timetable',
    Icon: Clock,
    title: 'Timetable',
    articles: [
      {
        q: 'How do I build a class timetable?',
        a: 'Go to Timetable → select a class. If that class has streams, select a stream too — each stream runs its own timetable, so you build one stream at a time (a whole-class entry like Assembly can still be added by leaving the stream as "Whole class"). Click any empty cell in the grid → choose subject, teacher, and room → Save. Repeat for each period across the week.',
      },
      {
        q: "Why do I have to pick a stream before I see the timetable?",
        a: 'Because two streams of the same class can have different lessons at the same time — e.g. 4A doing Maths while 4B does English, same period. Picking a stream shows exactly that stream\'s lessons, plus any lesson entered for the whole class.',
      },
      {
        q: 'Does picking a subject fill in the teacher automatically?',
        a: "Yes, if that subject already has a teaching assignment for the class (and stream, if it has one) — the teacher and their preferred room are filled in automatically, with a note confirming the auto-fill. You can still change either manually. If no assignment is found, the form says so and you fill in the teacher and room yourself.",
      },
      {
        q: 'Can I record an assistant or co-teacher on a lesson?',
        a: "Yes. Each lesson slot has an optional \"Assistant teacher\" field, shown alongside the main teacher on the grid, printouts, and CSV export. It's for display and scheduling only — it doesn't grant the assistant teacher any attendance or grading access for that class, and isn't checked for double-booking.",
      },
      {
        q: 'Does the system detect teacher or room conflicts?',
        a: 'Yes. Assigning a teacher or room already in use at the same period returns a 409 conflict error and blocks the save. (This check looks at the main teacher only, not an assistant teacher.)',
      },
      {
        q: 'Can I bulk-load a timetable?',
        a: 'Yes. Use the Import button to upload a CSV of all slots. Download the timetable template for the correct column format.',
      },
      {
        q: 'What is Emergency Online Learning Mode?',
        a: "When enabled in Settings → School (Emergency Online Learning), every timetable slot shows a Join button using each teacher's saved meeting link. Students see the same Join buttons in their portal.",
      },
      {
        q: 'How do teachers save their meeting links?',
        a: 'Go to Profile → Online Meeting Links → paste your Zoom PMI URL and/or Google Meet URL → Save. These links appear automatically when Emergency Mode is active.',
      },
      {
        q: 'Why do I only see "My Timetable" instead of the full scheduling console?',
        a: 'The whole-school Scheduling Engine (Class Grid, Teacher View, Institution overview, Rooms, Cover/Subs) is a separate, more restrictive grant — Manage Whole-School Timetable (Admin Console), below. Everyone else — teachers, section heads, parents, students — automatically gets the read-only Portal instead: your own weekly schedule, your children\'s, or your section\'s. This is not something you can be "half-granted" into: you either see your own Portal, or (with the Admin Console permission, or if your role is Admin/Principal/Deputy/Timetabler) the full console.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Timetable\n• Edit Timetable\n• Manage Rooms\n• Configure Bell Schedule\n• Manage Teaching Assignments\n• Import Timetable (CSV)\n• Export Timetable (CSV)\n• Manage Whole-School Timetable (Admin Console)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── eLearning ────────────────────────────────────────────── */
  {
    id: 'elearning',
    moduleKey: 'elearning',
    Icon: MonitorPlay,
    title: 'eLearning & Online Sessions',
    articles: [
      {
        q: 'How do I schedule an online class?',
        a: "Go to eLearning → Online Sessions → Schedule Session. Step 1 chooses the audience. Step 2 gives the details: the platform, date, time and duration. Platforms are Google Meet and Zoom. Zoom can be chosen only when the school's Zoom account is configured; otherwise it is greyed out.",
      },
      {
        q: 'Do I need to connect Google or Zoom to Msingi?',
        a: 'It depends on what you use. Online Sessions does not need a sign-in: it uses the meeting link you saved in Profile → Online Meeting Links. Google Classroom courses and scheduling Google Meet through Google Calendar need a Google Workspace connection, using "Connect Google Classroom" or "Connect Google Meet". Zoom sessions use the school\'s Zoom account, which must be configured first.',
      },
      {
        q: 'Where do students see scheduled sessions?',
        a: 'Session lists are shown to staff who hold the eLearning read permission. Students see Join buttons on their Student Portal dashboard when Emergency Online Learning Mode is switched on.',
      },
      {
        q: 'Can I cancel a session?',
        a: 'Yes. A cancelled session no longer appears in the list of upcoming sessions.',
      },
      {
        q: "What if I haven't saved my meeting link yet?",
        a: "Sessions that use your own link need that link saved in Profile → Online Meeting Links first. The scheduling form warns you if it is missing, and links to your profile to add it.",
      },
      {
        q: 'What does the Google Classroom part of eLearning do?',
        a: 'For a connected Google Classroom course, the eLearning page shows Classwork (assignments, questions and material), People (the enrolled students) and Grades. Students must be enrolled in the Google Classroom course for them to appear there.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Courses & Resources\n• Create / Upload Content\n• Edit Content\n• Delete Content\n• Enroll Students\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Finance ──────────────────────────────────────────────── */
  {
    id: 'finance',
    moduleKey: 'finance',
    Icon: Wallet,
    title: 'Finance',
    articles: [
      {
        q: 'How do I set up fee structures?',
        a: 'Go to Finance → Fee Structures → "Add Structure". Define the fee type (tuition, boarding, transport, etc.), amount, and which classes it applies to. Fee structures are reusable templates for creating invoices.',
      },
      {
        q: 'How do I create a fee invoice for a student?',
        a: 'Invoices are not typed in one at a time. They come from four places: a fee structure (Finance → Fee Structure → Generate Invoices, one invoice per matching student); Term Billing (transport and extra-curricular for a term); automatic draft invoices for new admissions, if the school has set this up; and the student import, for opening fees on new students. There is no "New Invoice" button, so a single student\'s extra charge needs a fee structure that targets that student.',
      },
      {
        q: 'How do I record a payment?',
        a: 'Open the invoice → "Record Payment" → enter the amount, date, method (M-Pesa, bank transfer, cash, cheque), and reference number → Save. The invoice status and balance update automatically.',
      },
      {
        q: 'What do the invoice statuses mean?',
        a: 'Draft = created but not yet issued (admission invoices start as drafts, so you can review them first). Unpaid = issued, nothing paid yet. Partial = some amount paid, balance remains. Paid = fully settled. Void = cancelled. "Overdue" is not a status: it is shown on the Overdue tab for any unpaid or partial invoice past its due date.',
      },
      {
        q: 'How do I bill transport and extra-curricular activities for a term?',
        a: 'Go to Finance → Term Billing. Choose the academic year and term, then click Preview. Nothing is created yet. The preview lists who will be billed, with their charges and the due date (the end of the term\'s first week), and who will not be billed, with the reason. Fix the reasons, preview again, then click Create term invoices. Running it again is safe: students already billed for that term are skipped. Changes made after a run (a new enrolment, a changed fare) need a new invoice.',
      },
      {
        q: 'How does early payment work?',
        a: 'Early payment means paying by the first day of the term. Term invoices carry the discount from the school\'s early-payment policy. A payment does not apply the discount on its own: the bursar confirms it in Finance → Term Billing → Early payment, after checking that the payment was received on or before the deadline. The deadline can be changed until the discount is confirmed. For fee-structure invoices, early payment still applies automatically when a payment lands before the deadline.',
      },
      {
        q: 'Can I enrol several students in an activity at once?',
        a: 'Yes. Go to Finance → Extra-Curricular. Pick a class, search, and tick the students. Choose the activity and the dates, then click Enrol. Each student gets their own enrolment. Students already in that activity are skipped and the message says why. To stop billing for a student in an activity, click End and give the date.',
      },
      {
        q: 'How do transport fares work?',
        a: 'Each route has a one-way fare and a two-way fare per term. When you assign a student to a route, you choose which fare they pay. The Direction (to school, from school, both) only sets the pickup label and does not change the amount. A student with no fare type, or a route with no fare for that type, is not billed and appears under "Not billed" in Term Billing.',
      },
      {
        q: 'How do I accept M-Pesa payments?',
        a: 'A School Admin sets this up in Settings → School, in the M-Pesa section. Enter your Daraja API credentials (Consumer Key, Consumer Secret, Paybill or Till number, STK Push Passkey, Environment, and the public callback base URL). Finance staff then see STK Push and automatic reconciliation work with no extra steps.',
      },
      {
        q: 'How do I generate a fee statement for a parent?',
        a: "There is no separate fee-statement PDF yet. The Finance tab on the student's profile lists every invoice and payment for that student, with the balance. Use that to answer a parent's question about fees.",
      },
      {
        q: 'Can I import opening balances for students?',
        a: 'Only for new students. The student CSV import can create an opening-fee invoice (openingFeeTitle, openingFeeAmount, openingFeePaid, openingFeeDueDate) when it creates a student. A student who is already in Msingi is skipped by the import, so their balance cannot be imported this way. There is no screen for adding one invoice to an existing student, so a balance brought forward for an existing student cannot be recorded in Msingi yet. A balance-only import for existing students is planned but not yet available.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Invoices\n• Create Invoice\n• Void Invoice\n• View Payments\n• Record Payment\n• Print Receipts / Invoices\n• Manage Fee Structures\n• Import Finance Data (CSV)\n• Configure M-Pesa Integration\n• Run Term Billing\n• Confirm Early Payment\n• Manage Extra-Curricular Activities & Enrolments\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Behaviour ────────────────────────────────────────────── */
  {
    id: 'behaviour',
    moduleKey: 'behaviour',
    Icon: Scale,
    title: 'Behaviour & Pastoral',
    articles: [
      {
        q: 'How do I record a behaviour incident?',
        a: 'Go to Behaviour → "Record Incident". Select the student, choose Merit or Demerit, set the category (Classroom, Corridor, Sports, etc.), severity, and points, add a description, and Save.',
      },
      {
        q: 'What is the Behaviour Point System (BPS)?',
        a: 'The BPS tracks each student\'s merit and demerit points. Demerit points move a student through five intervention stages, counted over a rolling 90-day window: Stage 1 Verbal Check-in (5 points, class teacher), Stage 2 Formal Review (10 points, head of year or coordinator), Stage 3 Behaviour Support Plan (20 points, senior staff), Stage 4 Leadership Referral (35 points, deputy or principal), Stage 5 Disciplinary Panel (50 points, principal or committee).',
      },
      {
        q: 'How do students earn milestone badges?',
        a: 'Merit points earn milestone badges: Bronze at 25 points, Silver at 50 points, and Gold at 100 points. The current badge shows on the student profile and the Behaviour dashboard.',
      },
      {
        q: 'How do students or parents appeal a demerit?',
        a: 'A staff member with the right permission submits an appeal against an incident, and the appeal is recorded against that incident. Appeals are resolved by staff who hold the update permission. Parents cannot submit an appeal through the parent portal; they raise it with the school.',
      },
      {
        q: 'Can points be reset?',
        a: 'Yes. A points reset moves the starting point for the running total. It does not delete any incident. The reset date is kept, and the incident history stays complete. Only a user with the Delete Records permission, or a behaviour officer, can reset points.',
      },
      {
        q: 'Can all teachers record behaviour for any student?',
        a: 'Behaviour is school-wide. A staff member who holds the Record Incident permission can record for any student in the school, not only students in their own classes. Behaviour officers, set in the behaviour settings, also get access.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Incidents & BPS\n• Record Incident / Award Points\n• Edit Records\n• Delete Records\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Exams ────────────────────────────────────────────────── */
  {
    id: 'exams',
    moduleKey: 'grades',
    Icon: ClipboardCheck,
    title: 'Exams',
    articles: [
      {
        q: 'How do I create an exam?',
        a: 'Go to Exams → "New Exam". The Exams module is for scheduling: enter the exam title, subject, class, term, type, date, start time, duration, room and the maximum score. Marks are not entered here. They are entered in the Markbook (Grades). An exam has a status of Scheduled, In progress, Completed or Cancelled.',
      },
      {
        q: 'Where do exam marks get entered now?',
        a: 'In the Markbook, under Grades. Exam results are no longer entered or stored on the Exams page. The Exams page only schedules the sitting. If you have older results on the Exams page, they were moved to the Markbook.',
      },
      {
        q: 'What is an Exam Series?',
        a: 'An Exam Series groups related exams together, for example an End-of-Term 1 series. The series is for scheduling and organising. Marks for a report card come from the Markbook, not from the series.',
      },
      {
        q: 'How are exam marks locked or approved now?',
        a: 'Through the Markbook. A teacher submits marks for a class and subject, a reviewer approves or rejects them, and approved marks are locked. Locked marks cannot be changed until an unlock is approved. Publishing a report card is blocked while any mark for that class and term is not yet approved, unless an administrator records a documented bypass. See the Grades help for the steps.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Exams\n• Create / Edit Exam\n• Delete Exam\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Grades & Assessment ──────────────────────────────────── */
  {
    id: 'grades',
    moduleKey: 'grades',
    Icon: BarChart3,
    title: 'Grades & Assessment',
    articles: [
      {
        q: 'What is the CA / HW / MT / ET system?',
        a: 'CA = Continuous Assessment, HW = Homework, MT = Mid-Term test, ET = End-Term exam. Each component has a configurable percentage weight that adds up to 100% of the final grade.',
      },
      {
        q: 'How do I enter marks in the markbook?',
        a: "Go to Grades → Markbook → select the term, class, and subject → enter each student's score per assessment component → Save. Scores are validated against the maximum marks configured.",
      },
      {
        q: 'How are grade letters assigned?',
        a: "Grade letters (A, B, C, D, E or your school's custom scale) are mapped from the weighted percentage using grade boundaries set in Academic Config.",
      },
      {
        q: 'What is the Academic Health dashboard?',
        a: 'Leadership Analytics shows average scores per class for published grades, sorted lowest to highest. Classes below 50% average are flagged for attention.',
      },
      {
        q: 'What is grid mark entry?',
        a: 'Grid mark entry lets you enter marks for an entire class at once in a spreadsheet-style table — one row per student, one column per assessment. This is faster than opening each student individually.',
      },
      {
        q: 'What is "Assessment Scheduling" and how is it different from the marks above?',
        a: 'Assessment Scheduling is its own small module, separate from Grades & Marks, covering only one action: locking or unlocking the assessment schedule (which CA/HW/MT/ET components exist and their weights) for a term. Entering marks against an already-scheduled assessment is a Grades & Marks action; changing the schedule itself needs this separate permission.',
      },
      {
        q: 'How are a final grade and its weights calculated?',
        a: 'A subject\'s final score is a weighted average of the assessments that have marks so far, scaled to those weights. One 20% assessment with marks therefore reads as a full mark, not as 20%. This is the intended behaviour. Weights are set per subject in Academic Config → Assessment Settings.',
      },
      {
        q: 'Which grade scale is used for a class?',
        a: 'Each section (for example KG, Primary, Secondary) can have its own grade scale, set in the Grades configuration under "Applies to". A class uses the scale for its section, then the school default. If neither exists, report cards for that class cannot be generated, and the message says which scale to add.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Grades & Marks\n• Enter / Edit Marks\n• Review / Approve Mark Submissions\n• Manage Comment Banks\n• Generate / Publish Report Cards\n• Export Grades (CSV)\n• Lock / Unlock Assessment Schedule\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Report Cards ─────────────────────────────────────────── */
  {
    id: 'report-cards',
    moduleKey: 'grades',
    Icon: FileText,
    title: 'Report Cards',
    articles: [
      {
        q: 'How do I generate report cards?',
        a: 'Go to Reports → Report Cards. Select the class and term. Click "Generate" — the system compiles grades, attendance, and behaviour data into a card for every student in the class.',
      },
      {
        q: 'How do I publish report cards?',
        a: "Click 'Publish All' for a class. A confirmation shows how many cards will go live. Once published, students and linked parents can view and download PDFs from their portals. Publishing is logged with who did it and when.",
      },
      {
        q: 'What is a Report ID?',
        a: 'Every published report card is assigned a unique Report ID (e.g. RC-000142). This ID is printed on the PDF and can be used to verify the report card is authentic and unmodified.',
      },
      {
        q: 'How does report card verification work?',
        a: 'Each published report card is sealed with a SHA-256 hash. Anyone — including parents and universities — can visit the verification URL on the report card to confirm it is genuine and has not been altered.',
      },
      {
        q: 'What is moderation and when does it apply?',
        a: 'Moderation checks that every mark for the class and term has been approved before publishing. If a subject has marks but no approved submission (still draft, submitted, rejected, or never submitted), publishing is blocked and the message lists the subjects. An administrator can record a documented bypass. The bypass is logged.',
      },
      {
        q: 'Can parents download report cards as a PDF?',
        a: 'Yes. Once published, students and parents can download their report card PDF from their portal. The PDF includes the Report ID, QR code for verification, and the school stamp and signature.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• Manage Draft Comments\n• Configure Approval Workflow\n• Configure Publication Policy\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Lessons / Curriculum Coverage ───────────────────────── */
  {
    id: 'lessons',
    moduleKey: 'lessons',
    Icon: BookCheck,
    title: 'Lessons & Coverage',
    articles: [
      {
        q: 'What is curriculum coverage?',
        a: 'Teachers mark syllabus topics as "covered" after teaching them. The coverage percentage per subject is visible on the student portal, the teacher\'s lesson log, and the leadership dashboard.',
      },
      {
        q: 'How do I log a lesson as covered?',
        a: 'Go to Lessons → select your class and subject (and stream, if you teach that subject separately per stream — see below) → find the topic → click "Mark as covered". Add optional notes on what was taught and how.',
      },
      {
        q: 'My class has multiple streams and I teach them separately — is coverage tracked per stream?',
        a: 'Yes, when it should be. If a subject is taught to each stream separately (e.g. a different pace or a different teacher per stream), your "My Classes" cards show one card per stream — e.g. "Standard 4A · 4A" and "Standard 4A · 4B" — each with its own topics and its own percentage. Marking a topic covered in one stream never affects the other. If instead the whole class is taught together with no stream split, there is just one shared card, same as it always was.',
      },
      {
        q: 'Where do students see curriculum coverage?',
        a: "Students see a per-subject coverage bar on their Student Dashboard showing the percentage of topics covered so far in the term — scoped to their own stream when the subject is taught separately per stream, so a student never sees a sibling stream's progress credited to them.",
      },
      {
        q: 'Can leaders see the syllabus topics and lesson plans teachers have added?',
        a: 'Yes. Admins, deputies and heads of department open Lessons → Overview. Each row is one teacher, class, stream and subject. Click a row to see the topics for it, with coverage. Click "View plans" to see its lesson plans. Both views are read-only for leaders. Topics belong to a class and are shared by the class\'s streams.',
      },
      {
        q: 'Do teachers only see their assigned classes in Lessons?',
        a: 'Yes. Teachers can only view and update coverage for classes (and streams, where relevant) they are actually assigned to teach. Admins and section heads have broader access.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Lesson Plans\n• Create Lesson Plan\n• Edit Lesson Plan\n• Delete Lesson Plan\n• Mark Lesson Coverage\n• Configure Lesson Plan Template\n• Bulk Import Lesson Plans\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Events & Calendar ────────────────────────────────────── */
  {
    id: 'events',
    moduleKey: 'events',
    Icon: CalendarDays,
    title: 'Events & Calendar',
    articles: [
      {
        q: 'How do I add a school event?',
        a: 'Go to Events and add a new event. Set the title, dates, whether it is all day, location and description, and choose a category: Term, Exam, Meeting, Sports, Cultural, Training, Academic, Break, General or Birthday. New events are shown to the whole school. Click Save.',
      },
      {
        q: 'What is an Online Class event?',
        a: 'When you schedule a session in eLearning → Online Sessions, an "Online Class" event is created in the calendar automatically with the meeting link and a Join button.',
      },
      {
        q: 'How do birthday indicators work?',
        a: 'Days with student or staff birthdays show a 🎂 icon. Clicking it lists everyone celebrating that day with their name, class/role, and the age they are turning.',
      },
      {
        q: 'Can I switch between month, week, and list view?',
        a: 'Yes. Use the Month / Week / List toggle at the top of the Events page. List view is useful for scanning upcoming events chronologically.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Events\n• Create Event\n• Edit Event\n• Delete Event\n• Export Events (CSV)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── HR & Staff ───────────────────────────────────────────── */
  {
    id: 'hr',
    moduleKey: 'hr',
    Icon: UserCog,
    title: 'HR & Staff',
    articles: [
      {
        q: 'How do I add a staff member?',
        a: 'Go to HR → "Add Staff". Enter their name, email, role and department. This creates the staff record only. To give them a login, open the record and choose Create Login Account. Msingi then creates the account with a temporary password and emails them a welcome message with their credentials. They must set a new password at first sign-in. You can also bulk-import staff from a CSV.',
      },
      {
        q: 'Does teacher import create login accounts automatically?',
        a: 'Yes. When importing teachers via CSV, Msingi automatically creates a user account and sends a welcome email for each imported teacher who does not already have one.',
      },
      {
        q: 'What can a teacher edit on their own profile?',
        a: 'Teachers can update their phone, address, qualifications, specialization, next-of-kin contact, and personal meeting links (Zoom PMI / Google Meet) from Profile — no admin approval required.',
      },
      {
        q: 'How do I configure staff roles and responsibilities?',
        a: "Go to Settings → School → Staff Responsibilities. Add custom responsibility labels (e.g. KS Coordinator, Pastoral Lead, Boarding Supervisor). These appear as checkboxes in staff profiles and HR forms. A name that exactly matches a real account role (e.g. \"Principal\", \"Section Head\") is rejected — see below.",
      },
      {
        q: 'Why was my custom responsibility name rejected?',
        a: "Its name matched a real account role — one of the roles actually granted in Settings → Roles & Permissions — exactly. This is blocked on purpose: a Roles & Responsibilities tag is only an organisational label with no access of its own, so it can never be allowed to share a name with, and be mistaken for, an actual system role. Pick a more specific name instead, e.g. \"Deputy Head Primary\" rather than \"Deputy Principal\".",
      },
      {
        q: 'How do I reset a staff password?',
        a: 'Go to Settings → Users, open the user, and use the reset password action. You can enter a new password yourself or let Msingi generate one, then give it to the staff member securely.',
      },
      {
        q: 'Can a staff member have multiple roles?',
        a: 'Yes. A user has one main role and can also hold additional roles. The sidebar combines the modules that all of their roles allow. Check a user's roles in Settings → Users.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Leave Requests\n• Approve / Reject Leave\n• View Payroll\n• Export Payroll (CSV)\n• Manage Staff Documents\n• Configure Leave/Payroll Approval Workflow\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Messages ─────────────────────────────────────────────── */
  {
    id: 'messages',
    moduleKey: 'messages',
    Icon: MessageSquare,
    title: 'Messages',
    articles: [
      {
        q: 'Who can I send messages to?',
        a: 'When composing a message, choose a recipient group: Everyone, All Teachers, All Parents, All Students, or All Staff (all non-admin staff roles). You can also choose an individual person. Which people each sender can reach follows the Messages permissions your school has set.',
      },
      {
        q: 'Are messages private?',
        a: 'Messages are sent to the recipients you chose. Staff with the Delete Any Message (Moderation) permission can remove someone else\'s message, for safeguarding or compliance. Ask your school admin if you need that permission.',
      },
      {
        q: 'Can I message a whole group at once?',
        a: 'Yes. Choose one of the group recipients (All Teachers, All Parents, All Students, All Staff or Everyone). The message is sent to every account in that group. To reach one class, choose the people in it individually.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Messages\n• Send Messages\n• Delete Own Messages\n• Delete Any Message (Moderation)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Resources ────────────────────────────────────────────── */
  {
    id: 'resources',
    moduleKey: 'resources',
    Icon: Link2,
    title: 'Resources',
    articles: [
      {
        q: 'What is the Resources module for?',
        a: 'Resources is a shared library for links and files — timetables, policy documents, study guides, forms — that staff share with each other, a class, or the whole school. It is separate from eLearning (which is course content for students) and from Library (physical/digital book lending).',
      },
      {
        q: 'How do I share a resource?',
        a: "Go to Resources → 'Share a Resource'. Give it a title, choose who can see it (the whole school, or a targeted group by role and/or class), and either paste a link or upload a file. Click Share.",
      },
      {
        q: 'Who can see a shared resource?',
        a: 'Only the people the resource was shared with. A resource set to the whole school is visible to everyone. A targeted resource is visible only to the roles and/or classes you chose when sharing it.',
      },
      {
        q: 'Can I edit or remove a resource after sharing it?',
        a: 'Yes, if your role has the Edit / Delete permission for Resources. Open the resource and use the Edit or Delete action. Removing a resource removes it from every viewer\'s list immediately.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Resources\n• Share a Resource\n• Edit a Resource\n• Delete a Resource\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Growth Profile ───────────────────────────────────────── */
  {
    id: 'growth',
    moduleKey: 'growth_profile',
    Icon: Sprout,
    title: 'Growth Profile',
    articles: [
      {
        q: 'What is the Growth Profile module?',
        a: 'Growth Profile tracks student development beyond academic grades — aspirations, personal goals, skills, extra-curricular activities, and holistic growth markers across terms and years.',
      },
      {
        q: 'How do I add a growth record for a student?',
        a: 'Open Growth Profile from the sidebar and choose the student. Pick the section you need (Academic, Behaviour, Leadership, Activities, Projects, Service, Awards, Recommendations or Aspirations) and add the record there.',
      },
      {
        q: 'What are growth aspirations?',
        a: 'The Aspirations section records a student\'s goals, such as career, university or subject interests. It is one of the nine Growth Profile sections.',
      },
      {
        q: 'Who can view or edit a student\'s aspirations?',
        a: 'Viewing and editing are set by the Growth Profile permissions in Settings → Roles & Permissions. The Edit Aspirations permission controls who can change them.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Growth Profiles\n• Add Records (Leadership / Activities / Service / Awards)\n• Edit Own Records\n• Delete Records\n• Add / Edit Projects\n• Write Recommendations\n• Edit Aspirations\n• Verify / Approve Records\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Weekly Student Snapshot ──────────────────────────────── */
  {
    id: 'weekly-snapshot',
    moduleKey: 'weekly_snapshot',
    Icon: CalendarCheck,
    title: 'Weekly Student Snapshot',
    articles: [
      {
        q: 'What is the Weekly Student Snapshot?',
        a: "An automatically-generated weekly digest for every active student — topics covered, assignments and scores, attendance, the full behaviour record, medical visits, library activity, and new Growth Profile entries — all in one place, one snapshot per week.",
      },
      {
        q: 'When is it generated? Do I need to do anything?',
        a: 'No action is needed from staff. It is generated automatically from 1 pm on Saturday, Africa/Nairobi time. There is no approval step, so it adds no work to a class teacher.',
      },
      {
        q: 'How do parents and students see it?',
        a: 'Parents and guardians are notified by email and in the app once a snapshot is ready, through the school\'s notification settings. Past weeks stay available.',
      },
      {
        q: 'How do staff view a class\'s snapshots?',
        a: 'Go to Weekly Snapshot → pick your class → open a student. Use the prev/next/first/last arrows at the top to step through the rest of the class without returning to the roster each time.',
      },
      {
        q: 'Can I download a snapshot as a PDF?',
        a: 'Yes. Open any week from the picker inside a student\'s snapshot view and click Download PDF — staff, parents, and students can all do this for the weeks they have access to.',
      },
      {
        q: 'Does the medical section show to everyone?',
        a: "No. Medical details only appear if your school has the Medical Centre module enabled, and — for staff — only if you also hold the Medical Centre \"View Clinic Visits\" permission. This is checked every time the snapshot is viewed, not fixed at the moment it was generated, so it always reflects current access.",
      },
      {
        q: 'A class teacher only ever sees their own class here — is that different from Growth Profile?',
        a: 'Yes, deliberately. A plain teacher sees only the class(es) they are the class/form teacher for. Other staff (admin, principal, deputy principal, section head) see every active class. This is narrower than Growth Profile\'s own landing page, which this feature\'s design specifically asked for.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Weekly Snapshots\n• Manage Weekly Snapshot Settings\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Library ──────────────────────────────────────────────── */
  {
    id: 'library',
    moduleKey: 'library',
    Icon: BookMarked,
    title: 'Library',
    articles: [
      {
        q: 'How do I add a book to the library catalogue?',
        a: 'Go to Library → "Add Book". Enter the title, author, ISBN, category, and number of copies. The book is immediately searchable and available for borrowing.',
      },
      {
        q: 'How do I issue a book to a student?',
        a: "Go to Library → Issue Book. Search for the student, select the book, set the due date, and confirm. The book's available copy count decreases automatically.",
      },
      {
        q: 'How do I record a book return?',
        a: "Go to Library → Loans. Find the active loan and click 'Return'. The return is recorded and the available copy count goes back up.",
      },
      {
        q: 'Can I see which books are overdue?',
        a: 'Yes. The Library page shows an Overdue Loans count. Loans past their due date are marked overdue on the Loans tab. Use "Sync overdue" to refresh the overdue statuses.',
      },
      {
        q: 'Can I search the catalogue?',
        a: 'Yes. Use the search bar in Library to find books by title, author or ISBN. The result shows total copies and how many are currently available.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Catalogue & Records\n• Issue / Return Books\n• Add / Edit Catalogue Items\n• Delete Catalogue Items\n• View Library Reports\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Transport ────────────────────────────────────────────── */
  {
    id: 'transport',
    moduleKey: 'transport',
    Icon: Bus,
    title: 'Transport',
    articles: [
      {
        q: 'How do I add a transport route?',
        a: "On the Transport page, open the Routes tab and click to add a route. Enter the route name, origin and destination, stops, times, vehicle type and registration, driver name and phone, and capacity. Then set the one-way and two-way fares per term. A route with no fare for a type cannot bill students who choose that type.",
      },
      {
        q: 'How do I assign a student to a route?',
        a: "On the Transport page, open the Assignments tab and click Assign Student to Route. Choose the route, then the fare (one-way or two-way). Choose a class and search for the student by name or admission number, then tick one or more students. Students already on the route are skipped. The number of students you save must fit the route's capacity.",
      },
      {
        q: 'Does an assignment charge the student automatically?',
        a: 'Yes, through Term Billing. Each active assignment is billed for the term at the fare the student chose. Assignments with no fare type, or a route with no fare for it, are not billed and appear under "Not billed" with the reason. See the Finance help for how to run Term Billing.',
      },
      {
        q: 'What does Direction mean on an assignment?',
        a: 'Direction (to school, from school, both) is a pickup label only. It does not change the fare. The amount depends only on the fare type chosen.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Routes & Vehicles\n• Add / Edit Routes & Stops\n• Assign Students to Routes\n• Delete Routes / Vehicles\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Hostel ───────────────────────────────────────────────── */
  {
    id: 'hostel',
    moduleKey: 'hostel',
    Icon: BedDouble,
    title: 'Hostel',
    articles: [
      {
        q: 'How do I add a hostel block and rooms?',
        a: "Go to Hostel → Hostels tab → 'New Hostel'. Enter the hostel's name, warden, capacity and fee per term. Then open the Rooms tab and click 'Add Room' for each room.",
      },
      {
        q: 'How do I assign a student to a room?',
        a: "Go to Hostel → Assignments tab → 'Assign Student'. Choose the student and the room. The assignment list shows who is in which room.",
      },
      {
        q: 'How do I manage hostel capacity?',
        a: "Each room shows its capacity and current occupancy. The block overview shows total beds, occupied beds, and available spaces across all rooms.",
      },
      {
        q: 'How do hostel fees work?',
        a: 'Each hostel has a fee per term, recorded on the hostel. Hostel fees are not invoiced automatically. To bill boarding, add a boarding line to a fee structure in Finance → Fee Structure and generate invoices for the students allocated to the hostel.',
      },
      {
        q: 'Can I see which students are in which rooms?',
        a: 'Yes. The Assignments tab lists each student with their hostel and room. The Rooms tab shows each room and its occupancy.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Rooms & Allocations\n• Add / Edit Rooms & Blocks\n• Assign Students to Rooms\n• Delete Rooms / Blocks\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Medical Centre ───────────────────────────────────────── */
  {
    id: 'medical',
    moduleKey: 'medical',
    Icon: HeartPulse,
    title: 'Medical Centre',
    articles: [
      {
        q: 'How do I record a clinic visit?',
        a: "Go to Medical Centre → Log Visit. Select the student, enter the complaint and observation, record the action taken, and Save. The Visits tab lists earlier visits.",
      },
      {
        q: 'What are Medical Alerts?',
        a: 'Alerts are condition flags only — severe allergies, asthma, epilepsy, and similar — visible to roles who need to know a risk exists without seeing full clinic-visit detail. This is a deliberately narrower permission than full visit records.',
      },
      {
        q: 'Who can see a student\'s full clinic history?',
        a: 'Only roles granted the View Clinic Visits permission, set in Settings → Roles & Permissions. A role with only the Alerts permission sees the condition flags, not the underlying visit records.',
      },
      {
        q: 'Where else does medical information appear?',
        a: 'Weekly Student Snapshot (if enabled) includes a medical section, but it is redacted the same way — hidden entirely unless the Medical Centre module is on for your school and, for staff, you also hold View Clinic Visits.',
      },
      {
        q: 'How do I run a medical report?',
        a: 'Go to Medical Centre → Reports. The tab appears only if your role has the medical reports permission. It gives a summary of visits for a period you choose.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Clinic Visits\n• Record Clinic Visit\n• Delete Clinic Visit\n• View Medical Alerts (condition flags only, not full profile)\n• View Medical Reports\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Reports & Analytics ──────────────────────────────────── */
  {
    id: 'reports',
    moduleKey: 'reports',
    Icon: TrendingUp,
    title: 'Reports & Analytics',
    articles: [
      {
        q: 'Who can access Reports & Analytics?',
        a: 'Reports & Analytics is visible to roles that have been granted the analytics permission, set in Settings → Roles & Permissions. Your role\'s access is shown in the sidebar: if you cannot see it, ask your school admin.',
      },
      {
        q: 'What does the Academic Health panel show?',
        a: 'The average score for each class, from the published grades. The class with the lowest average is shown first. If that average is below 50%, it is flagged in red so leadership can see where intervention is needed.',
      },
      {
        q: 'What does the Attendance analytics section show?',
        a: 'The school-wide attendance rate, with a list of at-risk students: those below 80% attendance.',
      },
      {
        q: 'What does the Finance summary show?',
        a: 'The total invoiced, the amount collected, the outstanding balance, and the students with overdue invoices. Useful for fee collection follow-up.',
      },
      {
        q: 'What is the Admissions Pipeline chart?',
        a: 'A bar chart on the Dashboard showing the number of applications at each stage, from Enquiry to Enrolled.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Reports\n• Export Reports (CSV)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Inventory ────────────────────────────────────────────── */
  {
    id: 'inventory',
    moduleKey: 'inventory',
    Icon: Boxes,
    title: 'Inventory',
    articles: [
      {
        q: 'What does Inventory manage?',
        a: 'School supplies, equipment, and consumables — categorised items with stock levels, tracked through receive/issue/return/adjust transactions, plus a requisition workflow for staff to request items that need approval before issue.',
      },
      {
        q: 'How do I add a new inventory item or category?',
        a: 'Go to Inventory → "Add Item" (or "Add Category" first if this is a new type of item). Set the item name, category, unit, and opening stock level.',
      },
      {
        q: 'How do I record stock movement?',
        a: 'Open the item → choose a transaction type: Receive (new stock in), Issue (given out), Return (came back), or Adjust (correct a count). Each transaction updates the running stock level and is logged.',
      },
      {
        q: 'How do requisitions work?',
        a: 'A staff member raises a requisition for the items and quantities they need. It moves through the approval workflow configured for your school — once approved, the requisition can be fulfilled, which issues the stock and reduces the level automatically.',
      },
      {
        q: 'Who configures the requisition approval workflow?',
        a: 'The approval chain for requisitions is set by a user with the Configure Requisition Approval Workflow permission. Requisitions are raised and tracked from the Requisitions tab on the Inventory page.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Inventory & Categories\n• Add / Edit Items & Categories\n• Record Stock Transactions (Receive/Issue/Return/Adjust)\n• Raise Requisitions\n• Configure Requisition Approval Workflow\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Analytics Dashboard ──────────────────────────────────── */
  {
    id: 'analytics',
    moduleKey: 'analytics',
    Icon: LineChart,
    title: 'Analytics Dashboard',
    articles: [
      {
        q: 'How is Analytics Dashboard different from Reports & Analytics?',
        a: 'Analytics Dashboard is the Leadership Analytics panel on the main Dashboard — Attendance Risk, Fee Exposure, Behaviour Heatmap, and Academic Health, refreshed live as the school\'s selected date range changes. Reports & Analytics (a separate module, above) is the dedicated Reports area with exportable summaries. Many roles that see one do not automatically see the other.',
      },
      {
        q: 'What does the Behaviour Heatmap show?',
        a: 'A per-class view of merit/demerit activity over the Dashboard\'s selected date range (Week/Month/Year/Lifetime), helping leadership spot classes that need pastoral attention.',
      },
      {
        q: 'What does Fee Exposure show?',
        a: 'The outstanding fee balances shown on the Dashboard. Fee Exposure is one of the four Leadership Analytics panels.',
      },
      {
        q: 'Who can see the Leadership Analytics panels?',
        a: 'Access is set by the View Leadership Analytics permission in Settings → Roles & Permissions. A role that does not hold it does not see these panels.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Leadership Analytics\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Settings ─────────────────────────────────────────────── */
  {
    id: 'settings',
    moduleKey: null,
    Icon: Settings,
    title: 'Settings',
    articles: [
      {
        q: 'How do I set up the academic year and terms?',
        a: 'Go to Settings → School, then the Academic Years section. Create the year (for example 2025-2026), add its terms with start and end dates, and click "Activate year". Activating a new year locks the current one. All modules use the active year as their default.',
      },
      {
        q: 'How do I customise the school logo and colours?',
        a: 'Go to Settings → School → Branding. Upload your logo, favicon or login background, and choose a colour theme from the list (for example Violet, Ocean, Forest or Midnight). Save to apply it.',
      },
      {
        q: 'How do I configure custom SMTP email sending?',
        a: "By default, system emails come from Msingi's platform address. To send from your own domain (for example noreply@yourschool.ke), go to Settings → School, then the SMTP section. Enter your SMTP details and save. Use the test action to check them. Removing the custom SMTP sends emails from the platform address again.",
      },
      {
        q: 'What is Emergency Online Learning Mode?',
        a: "Found in Settings → School, in the Emergency Online Learning section. When switched on, timetable slots show Join buttons using each teacher's saved meeting link, and students see the same buttons in their portal. Useful for unexpected school closures.",
      },
      {
        q: 'Can I download a backup of my school data?',
        a: 'Not from Settings. Msingi takes automatic backups of school data on the server. There is no backup download button for schools at present. If you need a copy of your records, export the list you need from its module (for example Students or Invoices) as CSV.',
      },
      {
        q: 'Where can I see the Audit Log?',
        a: 'Go to Settings → Audit Log (admin only). This shows a filterable, paginated list of high-impact actions — logins, student deletions, report card publishes, role changes — with the actor, target, and timestamp.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• Edit School Settings\n• Manage Users / Invites\n• Manage Roles & Permissions\n• View System Info\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions. Ask your school admin if something here looks greyed out or missing for you.',
      },
    ],
  },

  /* ── Roles & Permissions ──────────────────────────────────── */
  {
    id: 'roles',
    moduleKey: null,
    Icon: Users,
    title: 'Roles & Permissions',
    articles: [
      {
        q: 'What roles are available in Msingi?',
        a: 'Superadmin, Admin, Principal, Deputy Principal, Section Head, Teacher, Finance, HR, Admissions Officer, Exams Officer, Timetabler, Discipline Committee, Parent and Student. Custom roles can be created in Settings → Roles & Permissions.',
      },
      {
        q: 'What is the difference between Superadmin and Admin?',
        a: 'A Superadmin bypasses the permission checks in Msingi. An Admin works within the Roles & Permissions grid for their school, like every other role.',
      },
      {
        q: 'Can I create custom permission sets?',
        a: 'Yes. Go to Settings → Roles & Permissions. Choose which modules each role can read, create, update or delete, and set the finer sub-permissions where the grid shows them. Changes apply to everyone with that role.',
      },
      {
        q: 'Why can I only see certain modules in the sidebar?',
        a: "The sidebar shows only modules your role has permission to access. If a module you expect to see is missing, ask your administrator to check your role's permissions in Settings → Roles & Permissions.",
      },
      {
        q: 'What can a parent account see?',
        a: "Parents see their child's attendance, grades, behaviour history, fee balance, report cards, timetable, and messages from staff. They cannot view other students' records.",
      },
      {
        q: 'What can a student account see?',
        a: "Students access the Student Portal — showing today's timetable (with Join buttons during online learning), attendance %, curriculum coverage, fee balance, report cards, and behaviour history.",
      },
    ],
  },

  /* ── Data & Import/Export ─────────────────────────────────── */
  {
    id: 'data',
    moduleKey: null,
    Icon: Database,
    title: 'Data & Import/Export',
    articles: [
      {
        q: 'What file format does Msingi import?',
        a: 'Msingi imports CSV files. Download the template from the Import button inside each module (Students, Teachers, Timetable, Finance) to get the exact column headers required.',
      },
      {
        q: 'Can I export my data?',
        a: 'Yes. Each module has an Export button. Click it to download all records as a CSV. Exports respect active filters — filter to a class or date range and the export matches exactly what is on screen.',
      },
      {
        q: 'What happens if my import has errors?',
        a: 'The import processes all valid rows and skips invalid ones. A summary report shows which rows failed and why (missing fields, duplicate IDs, invalid values). Fix those rows and re-import.',
      },
      {
        q: 'Can I undo a bulk import?',
        a: 'There is no automatic undo for bulk imports. For students: change their status to Inactive individually. For timetable slots: use the bulk-delete option. Always review your CSV before importing.',
      },
      {
        q: 'Can I import opening fee balances for students?',
        a: 'Only for students who are new to Msingi. The student CSV template has columns for opening fee title, amount, amount paid and due date. For each new student with an amount, the import creates an invoice, and a payment record if part was paid. Students already in Msingi are skipped, so their balances are not imported this way. A balance-only import for existing students is planned.',
      },
    ],
  },
];

/* ── Article accordion ────────────────────────────────────────── */
/* Answers are plain prose by default (unchanged from before). An answer
   containing '\n' — used only by the new "Who can do what here?" role/
   permission-reference articles, whose content is inherently list-
   shaped (one sub-permission per line) — renders as a bulleted list
   instead. A trailing line with no leading bullet (a closing sentence,
   e.g. pointing to Settings → Roles & Permissions) renders as its own
   plain paragraph below the list. */
function Article({ q, a, primary }) {
  const [open, setOpen] = useState(false);
  const lines = a.split('\n').filter(Boolean);
  const isList = lines.length > 1 && lines.some(l => l.startsWith('• '));
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        className="flex w-full items-center justify-between gap-3 py-3.5 text-left text-sm font-medium text-slate-800 transition-colors hover:text-slate-600"
        onClick={() => setOpen(o => !o)}
      >
        <span>{q}</span>
        {open
          ? <ChevronDown size={14} className="shrink-0" style={{ color: primary }} />
          : <ChevronRight size={14} className="shrink-0 text-slate-400" />}
      </button>
      {open && (
        isList ? (
          <div className="pb-4 pr-6 space-y-1.5">
            {lines.map((line, i) => line.startsWith('• ') ? (
              <p key={i} className="text-sm text-slate-600 leading-relaxed pl-3.5 relative before:content-['•'] before:absolute before:left-0 before:text-slate-300">
                {line.slice(2)}
              </p>
            ) : (
              <p key={i} className="text-sm text-slate-500 leading-relaxed pt-1.5">{line}</p>
            ))}
          </div>
        ) : (
          <p className="pb-4 pr-6 text-sm text-slate-600 leading-relaxed">{a}</p>
        )
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function HelpPage() {
  const { primary } = useSchoolTheme();
  const [query,    setQuery]    = useState('');
  const [activeId, setActiveId] = useState(null);

  // Section filtering — RBAC (role/permission) AND SaaS tenancy (does
  // THIS school even have the module turned on) — mirrors Sidebar.jsx's
  // computeNav() exactly: the tenancy check runs first, unconditionally
  // (admin/superadmin included — a school that's disabled Library
  // shouldn't show Library help to anyone, admin included), then the
  // role/permission check (which DOES have an admin/superadmin bypass).
  // moduleKey: null sections (Getting Started, Settings, Roles, Data)
  // skip both — they're not tied to one toggleable module.
  const can          = useAuthStore(s => s.can.bind(s));
  const role         = useAuthStore(s => s.session?.user?.role);
  const moduleConfig = useAuthStore(s => s.session?.school?.moduleConfig);

  const visibleSections = useMemo(() => {
    const cfgMap = buildModuleConfigMap(moduleConfig);
    return SECTIONS.filter(sec => {
      if (sec.moduleKey === null) return true;
      if (!(cfgMap[sec.moduleKey]?.enabled ?? true)) return false; // tenancy gate — unconditional
      // 'hr' is a special case, same reasoning as Sidebar.jsx's computeNav:
      // every staff member has self-service HR access (submit leave, view
      // own payslip) regardless of what's granted in Settings, so the help
      // section for it must stay visible even when can('hr') is false.
      if (sec.moduleKey === 'hr') return true;
      return role === 'superadmin' || role === 'admin' || can(sec.moduleKey); // RBAC gate
    });
  }, [role, moduleConfig]); // `can` is a stable bound method — role/moduleConfig change are the only triggers

  const filtered = useMemo(() => {
    if (!query.trim()) return visibleSections;
    const q = query.toLowerCase();
    return visibleSections
      .map(sec => ({
        ...sec,
        articles: sec.articles.filter(
          a => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q),
        ),
      }))
      .filter(sec => sec.articles.length > 0);
  }, [query, visibleSections]);

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3"
          style={{ background: withOpacity(primary, 0.12) }}>
          <HelpCircle size={24} style={{ color: primary }} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Help Centre</h1>
        <p className="text-slate-500 mt-1 text-sm">Find answers to common questions about Msingi.</p>
        <p className="text-slate-400 mt-1 text-xs">Showing what applies to you — your role's access and the modules your school has enabled.</p>
      </div>

      {/* ── Search ──────────────────────────────────────────── */}
      <div className="relative mb-8">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search help articles…"
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveId(null); }}
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition"
          style={{ '--tw-ring-color': withOpacity(primary, 0.3) }}
          onFocus={e => { e.target.style.borderColor = primary; e.target.style.boxShadow = `0 0 0 3px ${withOpacity(primary, 0.15)}`; }}
          onBlur={e => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
        />
      </div>

      {/* ── Results count when searching ────────────────────── */}
      {query && (
        <p className="text-xs text-slate-400 mb-4">
          {filtered.reduce((s, sec) => s + sec.articles.length, 0)} article{filtered.reduce((s, sec) => s + sec.articles.length, 0) !== 1 ? 's' : ''} found
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <HelpCircle size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500 text-sm">No articles found for "<strong>{query}</strong>"</p>
          <button onClick={() => setQuery('')} className="mt-2 text-xs font-medium transition" style={{ color: primary }}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* ── Section sidebar ──────────────────────────────── */}
          {!query && (
            <div className="md:col-span-1 space-y-0.5">
              {visibleSections.map(sec => {
                const isActive = activeId === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setActiveId(id => id === sec.id ? null : sec.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors text-left"
                    style={{
                      background: isActive ? withOpacity(primary, 0.08) : '',
                      color: isActive ? primary : '',
                      fontWeight: isActive ? 600 : undefined,
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = ''; }}
                  >
                    <sec.Icon size={14} className="shrink-0" style={isActive ? { color: primary } : { color: '#94a3b8' }} />
                    <span className={isActive ? '' : 'text-slate-600'}>{sec.title}</span>
                    <span className="ml-auto text-[11px] text-slate-400">{sec.articles.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Article panels ───────────────────────────────── */}
          <div className={query ? 'md:col-span-3 space-y-4' : 'md:col-span-2 space-y-4'}>
            {filtered
              .filter(sec => !activeId || sec.id === activeId || !!query)
              .map(sec => (
                <div key={sec.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  {/* Card header */}
                  <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: withOpacity(primary, 0.1) }}>
                      <sec.Icon size={13} style={{ color: primary }} />
                    </div>
                    <span className="text-sm font-semibold text-slate-800">{sec.title}</span>
                    <span className="ml-auto text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ background: withOpacity(primary, 0.08), color: primary }}>
                      {sec.articles.length}
                    </span>
                  </div>
                  {/* Articles */}
                  <div className="px-5 divide-y divide-slate-100">
                    {sec.articles.map((art, i) => (
                      <Article key={i} {...art} primary={primary} />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
