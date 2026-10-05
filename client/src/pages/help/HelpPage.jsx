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
        a: 'Open your school portal, enter your email (or admission number for students) and password, then click Sign In. First-time users are prompted to set a new password immediately.',
      },
      {
        q: 'I forgot my password. What do I do?',
        a: 'Click "Forgot password?" on the login page and enter your email. A reset link will be sent. Alternatively, ask your school administrator to reset it from Settings → Users.',
      },
      {
        q: 'Why am I being asked to change my password?',
        a: 'Msingi enforces a 90-day password rotation policy for security. You will be prompted to choose a new password after 90 days. The new password must be at least 8 characters and include letters and numbers.',
      },
      {
        q: 'I have multiple roles. What do I see?',
        a: 'Your sidebar shows only the modules your role has permission to access. If you have multiple roles (e.g. Teacher + Finance Officer), you see the union of all modules those roles can reach.',
      },
      {
        q: 'What browsers does Msingi support?',
        a: 'Msingi works on Chrome, Firefox, Edge, and Safari (all current versions). Internet Explorer is not supported. For the best experience keep your browser up to date.',
      },
      {
        q: 'Can I use Msingi on my phone?',
        a: 'Yes. Msingi is fully responsive and works on smartphones and tablets. Use a recent version of Chrome or Safari for the best mobile experience.',
      },
      {
        q: 'How is my data stored and who can see it?',
        a: "All data is stored in a secure cloud database. Each school's data is completely isolated — other schools cannot access your records. Data is encrypted in transit and at rest.",
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
        a: 'Classes represent year groups (e.g. Form 3, Year 8). Streams are teaching groups within a class (e.g. Form 3A, Form 3B, Form 3 East). Students, timetable slots, and marks are tracked at the stream level.',
      },
      {
        q: 'How do I create a class?',
        a: 'Go to Classes → "Add Class". Enter the class name, select a section (e.g. Primary, Secondary), set the year, and save. Then open the class card to add streams inside it.',
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
        a: '• View Classes — see the class/stream list\n• Create Class — add a new class\n• Edit Class — change name, section, or year\n• Delete Class — permanently remove a class\n• Export Classes (CSV) — download the class list\n• Import Classes (CSV) — bulk-create from a spreadsheet\n• Manage Sections & Streams — add/edit streams and the Section groupings above classes\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Go to Subjects → "Add Subject". Enter the subject name, code, and assign the teacher responsible. Subjects must be linked to classes before they appear in the timetable and markbook.',
      },
      {
        q: 'How do subjects link to the timetable and grades?',
        a: 'A subject assigned to a class drives both the timetable (which periods it occupies) and the markbook (which assessment components exist for it). Deleting a subject will affect both.',
      },
      {
        q: 'Can the same subject be taught by different teachers in different classes?',
        a: 'Yes. Create the subject once, then assign it to each class with the appropriate teacher. Each class-subject link is independent.',
      },
      {
        q: 'What is a class-subject?',
        a: 'A class-subject is the combination of a subject and a class — e.g. Mathematics in Form 3A. This is the unit that holds the syllabus, timetable slots, and the gradebook for that group.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Subjects & Departments — see the subject list\n• Create Subject / Department — add a new subject\n• Edit Subject — change name, code, or teacher assignment\n• Delete Subject — permanently remove a subject\nA role with none of these shows a plain "no access" message instead of the Subjects page. Your role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Click the checkbox on any row to select it (or the header checkbox to select the whole page). A bulk action bar appears with options to Deactivate or Permanently Delete selected students. Permanent delete requires admin role and an explicit confirmation.',
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
        a: "From the student's profile → Portal tab. If the student has separate Mother and Father details on file, you'll see two independent cards — 'Mother's Portal Account' and 'Father's Portal Account' — each created and reset on its own, so no one has to share a password to see their child's information. A student with only the older, single combined parent contact shows one 'Create Parent Account' button instead. Either way, parents see their child's attendance, grades, fees, report cards, and can message teachers.",
      },
      {
        q: 'Can I grant portal access to many students at once?',
        a: 'Yes. Select multiple students in the list → the bulk action bar shows "Grant Portal Access". This creates login accounts for all selected students who do not already have one and returns a created/skipped summary.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Student List — see the roster with filters and search\n• View Student Profile — open a student\'s full record\n• Add Student — create a new student record\n• Edit Student — update an existing record\n• Deactivate Student — set status to inactive (reversible — see "Can I reactivate a deactivated student?" below)\n• Export Students (CSV) — download the roster\n• Import Students (CSV) — bulk-create records from a spreadsheet\n• Promote Students to Next Class — move a whole class/stream up at year-end\n• Manage Student Portal Accounts — create/reset the student\'s own portal login (separate from parent portal accounts)\n• Resolve Duplicate Student Records — merge accidental duplicate records\n• Permanently Delete Students — irreversible removal, separate from (and far more restrictive than) Deactivate\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Go to Teachers → "Add Teacher". Enter their name, email, subject specialisation, and qualifications. A user account and welcome email with login instructions are created automatically.',
      },
      {
        q: 'How do I import teachers in bulk?',
        a: 'Go to Teachers → Import → download the CSV template → fill in your staff data → upload. Each imported teacher who does not already have a login gets one created automatically, with a welcome email.',
      },
      {
        q: 'How do I assign a teacher to a class or subject?',
        a: 'Teaching assignments (which teacher delivers which subject to which class) are managed from Subjects → the class-subject link, or from Timetable when building the schedule. A teacher\'s profile shows all their current assignments.',
      },
      {
        q: 'What can a teacher edit on their own profile?',
        a: 'Teachers can update their phone, address, qualifications, specialisation, next-of-kin contact, and personal meeting links (Zoom PMI / Google Meet) from Profile — no admin approval required. Name, email, and role changes need an admin.',
      },
      {
        q: 'How do I deactivate a teacher who has left the school?',
        a: "Open the teacher's profile → Edit → set Status to \"Inactive\" → Save. Their login is disabled and they drop off active class/subject assignment pickers, but their historical records (marks entered, attendance taken, lesson coverage) are preserved.",
      },
      {
        q: 'How do I filter and search teachers?',
        a: 'Use the filter bar to narrow by Department, Subject, or Status. The Export button respects active filters, matching what is on screen.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Teacher List — see the staff roster\n• View Teacher Profile — open a teacher\'s full record\n• Add Teacher — create a new staff account\n• Edit Teacher — update an existing record\n• Delete Teacher — permanently remove a record\n• Export Teachers (CSV) — download the staff list\n• Import Teachers (CSV) — bulk-create staff accounts from a spreadsheet\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Pipeline — see all applications and their stage\n• Add Applicant — create a new application\n• Edit Applicant Details — update an application\n• Move Pipeline Stage — advance/move an application through the funnel\n• Delete Applicant — permanently remove an application\n• Export Applicants (CSV) — download the pipeline data\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Each stream runs its own timetable — often a different time and sometimes a different room — so it needs its own register, not one list merging every stream together. The stream picker only appears when a class genuinely has more than one stream; a class with just one (or none) works exactly as before, no extra step. If you teach today\'s scheduled period for that class/stream, a small chip near the top of the page shows the matching subject, period, and time from your timetable — purely a confirmation that you\'re marking the right register, it never blocks you from taking attendance outside that exact period.',
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
        a: '• View Register — see attendance already marked\n• Mark Attendance — record present/absent/late/excused\n• Edit Records — change attendance after it has been saved\n• Export / Print Register — download or print the register\n• School-Wide Report — the aggregate per-class/stream count view across the whole school, not just your own register\n• View Absent Students & Contact Details — the real per-student absentee list with guardian phone/email, for calling home\n• Attendance Conflicts — the queue of same-day present/absent mismatches (a student marked both in different classes) awaiting resolution\nThe last three are each a separate, more restrictive grant on top of the first four — holding View Register or Mark Attendance does not automatically include them, since each reveals data beyond your own register. Their tabs only appear at all once you hold the matching permission (or you\'re an admin/principal/deputy) — Your role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "Yes, if that subject already has a teaching assignment for the class (and stream, if it has one) — the teacher and their preferred room are filled in automatically, with a note confirming the auto-fill. You can still change either manually. If no assignment is found, you'll be prompted to fill it in yourself.",
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
        a: '• View Timetable — see the schedule\n• Edit Timetable — assign subjects/teachers/rooms to periods\n• Manage Rooms — add/edit rooms\n• Configure Bell Schedule — set period start/end times\n• Manage Teaching Assignments — set which teacher delivers which subject to which class (pre-timetabling)\n• Import Timetable (CSV) — bulk-load a schedule\n• Export Timetable (CSV) — download the schedule\n• Manage Whole-School Timetable (Admin Console) — reach the full Scheduling Engine at all, instead of your own read-only Portal (see above); Admin/Principal/Deputy Principal/Deputy/Timetabler always have this, everyone else needs it explicitly granted\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "Go to eLearning → Online Sessions → 'Schedule Session'. Choose the audience (class, student, or parent), platform (Zoom or Google Meet), date, time, and duration, then click Schedule. A calendar event is created automatically.",
      },
      {
        q: 'Do I need to connect Zoom or Google to Msingi?',
        a: 'No. Save your personal meeting room link once in Profile → Online Meeting Links. That link is used every time — no API connection, tokens, or sign-in required.',
      },
      {
        q: 'Where do students see scheduled sessions?',
        a: 'In the school calendar as "Online Class" events with a Join button. Students also see Join buttons in their Student Portal dashboard when Emergency Online Learning Mode is active.',
      },
      {
        q: 'Can I cancel a session?',
        a: "Yes. Go to eLearning → Online Sessions → find the upcoming session → click × (cancel). This removes the session and its calendar event.",
      },
      {
        q: "What if I haven't saved my meeting link yet?",
        a: "The scheduling modal shows a yellow warning. Click 'Add it in Profile →' to save your link first. You must have a meeting link saved before scheduling sessions.",
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Courses & Resources — browse available content\n• Create / Upload Content — add new courses/resources\n• Edit Content — update existing content\n• Delete Content — remove content\n• Enroll Students — add students to a course\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Invoices — see issued invoices\n• Create Invoice — issue a new invoice\n• Void Invoice — cancel an issued invoice\n• View Payments — see recorded payments\n• Record Payment — log a payment against an invoice\n• Print Receipts / Invoices — generate printable documents\n• Manage Fee Structures — create/edit fee structure templates\n• Import Finance Data (CSV) — bulk-load invoices/opening balances\n• Run Term Billing — preview and create term invoices (its own permission, not covered by the general finance rights)\n• Confirm Early Payment — confirm an early payment, or change its deadline or percentage before confirming (its own permission)\n• Manage Extra-Curricular Activities & Enrolments — create or change activities, and enrol or end students (its own permission)\n• Configure M-Pesa Integration — set up Daraja API credentials\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Incidents & BPS — see the incident log and point totals\n• Record Incident / Award Points — log a new merit or demerit\n• Edit Records — update an existing incident\n• Delete Records — permanently remove an incident\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Exams — see scheduled exams\n• Create / Edit Exam — set up or change an exam\n• Delete Exam — remove an exam\nMarks are a separate permission, under Grades & Marks below. Your role\'s exact access is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Grades & Marks — see marks and grade summaries\n• Enter / Edit Marks — record scores in the markbook\n• Review / Approve Mark Submissions — sign off a teacher\'s submitted marks before they count\n• Manage Comment Banks — maintain the reusable teacher-comment library\n• Generate / Publish Report Cards — compile and release report cards to students/parents\n• Export Grades (CSV) — download markbook data\n• Lock / Unlock Assessment Schedule — a separate "Assessment Scheduling" permission (see above)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• Manage Draft Comments — write/edit teacher comments before publishing\n• Configure Approval Workflow — set up the report-card sign-off chain (e.g. class teacher → section head)\n• Configure Publication Policy — set rules like fee-clearance thresholds that gate downloading\nThese three are the "Report Card Settings" module — configuration, not the actual generate/publish action. Generating and publishing report cards is a separate permission (Generate / Publish Report Cards, under Grades & Marks above) — a role can have one without the other. Your role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Lesson Plans — see planned/logged lessons\n• Create Lesson Plan — add a new lesson plan\n• Edit Lesson Plan — update an existing plan\n• Delete Lesson Plan — remove a plan\n• Mark Lesson Coverage — mark a syllabus topic as taught\n• Configure Lesson Plan Template — set the fields every teacher in the school sees on every future lesson plan; a separate, more restrictive grant from Edit Lesson Plan (which only affects your own plans)\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Events — see the calendar\n• Create Event — add a new event\n• Edit Event — update an existing event\n• Delete Event — remove an event\n• Export Events (CSV) — download the calendar\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Go to HR → "Add Staff". Enter their name, email, role, and department. A welcome email with login instructions is sent automatically. You can also bulk-import staff from a CSV.',
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
        a: 'Go to Settings → Users → find the staff member → "Reset Password". The staff member will be prompted to change it on their next login.',
      },
      {
        q: 'Can a staff member have multiple roles?',
        a: 'Yes. In Settings → Users → open the user → assign multiple roles (e.g. Teacher + Finance Officer). The user sees all modules accessible to any of their combined roles.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Leave Requests — see submitted leave applications\n• Approve / Reject Leave — decide on a leave request\n• View Payroll — see payroll records\n• Export Payroll (CSV) — download payroll data\n• Manage Staff Documents — upload/manage staff document files\n• Configure Leave/Payroll Approval Workflow — set up the approval chain\nStaff profiles are governed by the separate Teachers module permission, not HR & Payroll. Your role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Admins and teachers can message any role. Teachers can message students and parents in their classes. Parents can reply to staff messages. Students can message their teachers.',
      },
      {
        q: 'Are messages private?',
        a: 'Yes. Messages are only visible to the sender and recipient(s), except for staff holding the separate Delete Any Message (Moderation) permission, who can act on any conversation for safeguarding and compliance purposes.',
      },
      {
        q: 'Can I message an entire class at once?',
        a: 'Yes. When composing a message, select "Class" as the recipient type and choose the class. All students or parents in that class receive the message.',
      },
      {
        q: 'Will I be notified of new messages?',
        a: 'An unread badge appears on the Messages icon in the sidebar. Email notifications depend on whether your school has configured SMTP in Settings.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Messages — see conversations\n• Send Messages — start or reply to a conversation\n• Delete Own Messages — remove a message you sent\n• Delete Any Message (Moderation) — remove someone else\'s message, e.g. for safeguarding or compliance; a separate, more restrictive grant from Delete Own Messages\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "Go to Resources → 'Share a Resource'. Give it a title, choose the audience (school-wide, a class, or staff only), and either paste a link or upload a file. Click Share.",
      },
      {
        q: 'Who can see a shared resource?',
        a: 'Only the audience you selected when sharing it. A resource shared with "Form 3A" is visible to that class\'s students, parents, and teachers only — not the whole school.',
      },
      {
        q: 'Can I edit or remove a resource after sharing it?',
        a: 'Yes, if your role has the Edit / Delete permission for Resources. Open the resource and use the Edit or Delete action. Removing a resource removes it from every viewer\'s list immediately.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Resources — see shared resources\n• Share a Resource — add a new one\n• Edit a Resource — update an existing one\n• Delete a Resource — remove one\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "Open the student's profile → Growth tab → 'Add Record'. Select the growth area, term, and add notes or a rating. Records are visible to the student and their parents.",
      },
      {
        q: 'What are growth aspirations?',
        a: 'Aspirations let students or teachers record career goals, subject interests, and personal ambitions. These are referenced when writing teacher comments on report cards and pastoral notes.',
      },
      {
        q: 'How does Growth Profile link to report cards?',
        a: 'Teacher comments on report cards can reference a student\'s growth records and aspirations. This makes comments more personal and evidence-based rather than generic.',
      },
      {
        q: 'Who can view or edit a student\'s aspirations?',
        a: 'Staff with the Edit Aspirations permission can write on any student\'s behalf. A student can always view and edit their own aspirations — this self-service access is separate from the general staff permission and cannot be seen or edited by other students.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Growth Profiles — see a student\'s Growth Profile\n• Add Records (Leadership / Activities / Service / Awards) — log a new entry\n• Edit Own Records — update entries you created\n• Delete Records — remove entries\n• Add / Edit Projects — manage the Projects section (has a supervisor reference)\n• Write Recommendations — add a staff recommendation for a student\n• Edit Aspirations — set career/university goals (students can always edit their own)\n• Verify / Approve Records — mark an entry as institution-verified or staff-verified\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "No action needed from any staff member. It generates automatically every Saturday, in your school's own local time — there is no approval step, so it never adds work to a class teacher's week regardless of how many classes or students they have.",
      },
      {
        q: 'How do parents and students see it?',
        a: 'They are notified automatically by email and in-app the moment it\'s ready, with a "This Week\'s Snapshot" card on their dashboard. Every past week stays available — nothing is ever deleted.',
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
        a: '• View Weekly Snapshots — see a class roster and open individual student snapshots\n• Manage Weekly Snapshot Settings — reserved for future school-level configuration of this feature\nParent and student access to their own/their child\'s snapshot does not go through this permission at all — it works the same way attendance, fees, and report cards already do for self-service accounts: gated by who the record belongs to, not by a Roles & Permissions toggle. Staff access is set in Settings → Roles & Permissions.',
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
        a: "Go to Library → Returns. Find the active loan by student or book → click 'Return'. The system records the return date and restores the available copy count.",
      },
      {
        q: 'Can I see which books are overdue?',
        a: 'Yes. Library → Overdue shows all loans past their due date, with the student name, book title, due date, and number of days overdue.',
      },
      {
        q: 'Can I search the catalogue?',
        a: 'Yes. Use the search bar in Library to find books by title, author, ISBN, or category. The result shows total copies and how many are currently available.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Catalogue & Records — browse books and loan records\n• Issue / Return Books — check out and check in books\n• Add / Edit Catalogue Items — manage the book catalogue\n• Delete Catalogue Items — remove a book from the catalogue\n• View Library Reports — see overdue/usage reports\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• View Routes — see routes and their fares\n• Add / Edit Routes & Stops — manage routes, stops and fares\n• Assign Students to Routes — allocate students to a route, with a fare\n• Delete Routes — remove a route\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "Go to Hostel → Blocks → 'Add Block'. Enter the block name and gender assignment. Then open the block and add rooms with their bed capacity.",
      },
      {
        q: 'How do I assign a student to a room?',
        a: "Go to Hostel → Allocations → 'Allocate Student'. Select the student, block, room, and bed number. The room's occupancy count updates automatically.",
      },
      {
        q: 'How do I manage hostel capacity?',
        a: "Each room shows its capacity and current occupancy. The block overview shows total beds, occupied beds, and available spaces across all rooms.",
      },
      {
        q: 'How do hostel fees work?',
        a: 'Boarding fees are set up in Finance → Fee Structures as a "Boarding" fee type and invoiced to students allocated to the hostel, the same way as tuition fees.',
      },
      {
        q: 'Can I see which students are in which rooms?',
        a: 'Yes. Open any room to see the full occupancy list with student names, class, and stream. You can also see a student\'s hostel allocation from their profile → Hostel tab.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Rooms & Allocations — see blocks, rooms, and who is allocated where\n• Add / Edit Rooms & Blocks — manage the physical hostel structure\n• Assign Students to Rooms — allocate a student to a room/bed\n• Delete Rooms / Blocks — remove a room or block\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: "Go to Medical Centre → \"Record Visit\". Select the student, enter the complaint, observation, and action taken (medication given, sent home, or referred elsewhere), and Save.",
      },
      {
        q: 'What are Medical Alerts?',
        a: 'Alerts are condition flags only — severe allergies, asthma, epilepsy, and similar — visible to roles who need to know a risk exists without seeing full clinic-visit detail. This is a deliberately narrower permission than full visit records.',
      },
      {
        q: 'Who can see a student\'s full clinic history?',
        a: 'Only roles with the View Clinic Visits permission — typically admin, principal, deputy principal, and medical/nursing staff. A teacher with only the Alerts permission sees flags, not the underlying visit records.',
      },
      {
        q: 'Where else does medical information appear?',
        a: 'Weekly Student Snapshot (if enabled) includes a medical section, but it is redacted the same way — hidden entirely unless the Medical Centre module is on for your school and, for staff, you also hold View Clinic Visits.',
      },
      {
        q: 'How do I run a medical report?',
        a: 'Go to Medical Centre → Reports for a summary view (visit counts, common complaints, referral rates) over a selected period.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Clinic Visits — see full visit records\n• Record Clinic Visit — log a new visit\n• Delete Clinic Visit — remove a visit record\n• View Medical Alerts — condition flags only, not full visit records\n• View Medical Reports — see summary reports\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Reports & Analytics is visible to roles with the analytics permission — typically Admin, Deputy Principal, and Section Head. Teachers see their own class data only.',
      },
      {
        q: 'What does the Academic Health panel show?',
        a: 'Average score per class for published grades, sorted from lowest to highest. Classes below 50% average are flagged so leadership can identify where intervention is needed.',
      },
      {
        q: 'What does the Attendance analytics section show?',
        a: 'School-wide attendance rate, per-class breakdown, and a list of at-risk students (below 80% attendance). Clicking a student opens their full attendance history.',
      },
      {
        q: 'What does the Finance summary show?',
        a: 'Total fees invoiced vs. collected, outstanding balance by class, and a list of students with overdue invoices. Useful for fee collection follow-up.',
      },
      {
        q: 'Can I export analytics reports?',
        a: 'Yes. Most analytics panels have a Download or Export button that produces a CSV or PDF summary of the visible data.',
      },
      {
        q: 'What is the Admissions Pipeline chart?',
        a: 'A bar chart on the dashboard showing the count of active applications at each stage (Enquiry → Enrolled). It updates in real time as applications move through stages.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Reports — see the Reports & Analytics area\n• Export Reports (CSV) — download report data\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Go to Inventory → Requisition Settings (requires the Configure Requisition Approval Workflow permission) to set who needs to approve a requisition before it can be fulfilled — a single approver or a multi-step chain.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Inventory & Categories — see items and stock levels\n• Add / Edit Items & Categories — manage the catalogue\n• Record Stock Transactions — receive, issue, return, or adjust stock\n• Raise Requisitions — request items (many roles get only this, not full inventory management — e.g. a teacher requesting classroom supplies)\n• Configure Requisition Approval Workflow — set up the approval chain\nYour role\'s exact access to each of these is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: 'Outstanding balances grouped by class, scoped to the same date range as the rest of the Dashboard, so it reflects the exact period you\'re looking at rather than an all-time total.',
      },
      {
        q: 'Who typically sees this panel?',
        a: 'Leadership roles — admin, superadmin, deputy principal, section head. A plain teacher does not see the Leadership Analytics panel by default.',
      },
      {
        q: 'Who can do what here? (Roles & Permissions)',
        a: '• View Leadership Analytics — see the panel\nThis module has a single view permission — there is no separate edit/export action here, since the panel is read-only by nature. Your role\'s exact access is set in Settings → Roles & Permissions — ask your school admin if something here looks greyed out or missing for you.',
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
        a: '• Edit School Settings — change branding, academic year, SMTP, and similar school-wide configuration\n• Manage Users / Invites — create/edit user accounts and send invites\n• Manage Roles & Permissions — edit the Roles & Permissions grid itself\n• View System Info — see system/version/audit information\nThis page you\'re reading is visible to everyone regardless of these permissions — the ACTIONS inside Settings are what\'s individually gated. Your role\'s exact access to each is set in Settings → Roles & Permissions itself — ask your school admin if something here looks greyed out or missing for you.',
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
