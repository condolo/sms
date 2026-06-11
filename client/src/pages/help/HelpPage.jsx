/* ============================================================
   Help Centre — searchable FAQ covering every Msingi module
   ============================================================ */
import { useState, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight,
  BookOpen, Users, Wallet, CalendarDays, FileText, Scale,
  BarChart3, Settings, GraduationCap, MessageSquare, HelpCircle,
  Clock, ClipboardList, MonitorPlay, Award, BookCheck,
  ClipboardCheck, Layers, UserCog, Trophy,
} from 'lucide-react';
import { useSchoolTheme, withOpacity } from '@/hooks/useSchoolTheme.js';
import useAuthStore from '@/store/auth.js';

/* ── Section → module permission key mapping ──────────────────────
   null  = always visible (Getting Started, universal sections)
   string = must pass can(moduleKey) OR be admin/superadmin
   ──────────────────────────────────────────────────────────────── */

/* ── All FAQ content ──────────────────────────────────────────── */
const SECTIONS = [
  /* ── Getting Started ──────────────────────────────────────── */
  {
    id: 'getting-started',
    moduleKey: null,          // visible to all roles
    Icon: BookOpen,
    title: 'Getting Started',
    articles: [
      {
        q: 'How do I sign in?',
        a: 'Open your school portal (e.g. mascitlabacademy.msingi.io), enter your email and password, then click Sign In. First-time users are prompted to set a new password immediately.',
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
        a: 'If your account has multiple roles (e.g. Teacher + Finance Officer), you see all modules your highest role can access. The sidebar shows only the modules relevant to your combined permissions.',
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
        a: "All data is stored in a secure cloud database (MongoDB Atlas). Each school's data is completely isolated — other schools cannot access your records. Data is encrypted in transit and at rest.",
      },
      {
        q: 'What is the academic year context?',
        a: 'Everything in Msingi — attendance, grades, fees, timetables — is tied to an academic year. Make sure your administrator has created and activated the current academic year in Settings before entering data.',
      },
    ],
  },

  /* ── Classes & Subjects ───────────────────────────────────── */
  {
    id: 'classes',
    moduleKey: 'classes',
    Icon: Layers,
    title: 'Classes & Subjects',
    articles: [
      {
        q: 'How do I create a new class?',
        a: 'Go to Classes → click "Add Class". Enter the class name (e.g. Grade 4A, Form 2B), select a section if applicable, assign a homeroom teacher, and click Save.',
      },
      {
        q: 'How do I add subjects to a class?',
        a: 'Go to Subjects → "Add Subject". Enter the subject name and code, assign it to one or more classes, and set the teacher responsible. Subjects drive both the timetable and the markbook.',
      },
      {
        q: 'What are Sections?',
        a: 'Sections let you group classes (e.g. "Primary" contains Grades 1–6; "Secondary" contains Forms 1–4). Sections are optional but help with reporting and permission scoping for Section Heads.',
      },
      {
        q: 'Can I have streaming within a year group?',
        a: 'Yes. Create multiple classes with the same year label but different streams — e.g. Form 3A, Form 3B, Form 3C. Students, timetable slots, and marks are tracked separately per stream.',
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
        a: 'Go to Students → click "Add Student". Fill in the required fields (first name, last name, class, admission number) and any optional details like date of birth, guardian contacts, and photo. Click Save.',
      },
      {
        q: 'How do I import students in bulk?',
        a: 'Go to Students → click the Import button → download the CSV template → fill in your student data following the column headers exactly → upload the file. The system validates each row and reports any errors.',
      },
      {
        q: 'Can I move a student to a different class?',
        a: "Yes. Open the student's profile → click Edit → change the Class field → Save. All historical data (attendance, grades, fees) remains linked to the student.",
      },
      {
        q: 'How do I mark a student as transferred or graduated?',
        a: 'Open the student\'s profile → Edit → set Status to "Transferred", "Graduated", or "Withdrawn" → Save. The student moves out of the active roll but their record is preserved.',
      },
      {
        q: 'Can a student have a portal login?',
        a: "Yes. An admin can create a student portal account from the student's profile page. The student receives login credentials and can view their own timetable, attendance, grades, behaviour history, and report cards.",
      },
      {
        q: 'How do I add a parent or guardian?',
        a: "Add guardian contact details in the student's profile. An admin can also create a separate Parent portal account linked to that student, giving the parent their own secure login.",
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
        a: 'Go to Admissions → "New Application". Fill in the applicant\'s details, select the target class and academic year, and submit. A unique application reference is generated automatically.',
      },
      {
        q: 'How do I enrol an accepted applicant as a student?',
        a: 'Open the application and move it to the "Acceptance" or "Enrolled" stage. Click "Enrol as Student" — this automatically creates a student record with all details pre-filled from the application.',
      },
      {
        q: 'Can I track notes and communication per application?',
        a: 'Yes. Each application has a stage history log showing every status change with the staff member who made it and a timestamp. You can add notes when changing stages.',
      },
      {
        q: 'Where do I see the admissions funnel overview?',
        a: 'The Dashboard → Admissions Pipeline bar chart shows counts by stage at a glance. For full detail, go to Admissions → the board view shows all active applications grouped by stage.',
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
        a: 'Go to Attendance → select the date and class → mark each student as Present, Absent, Late, or Excused → click Save. You can only save attendance once per class per day.',
      },
      {
        q: 'Can I mark the whole class present at once?',
        a: 'Yes. Click "Mark All Present" to set all students to Present in one click, then adjust any exceptions individually before saving.',
      },
      {
        q: "Where can I see a student's full attendance history?",
        a: "Open the student's profile — the Attendance tab shows their complete record with a monthly summary table and overall attendance percentage.",
      },
      {
        q: 'What does the attendance percentage mean?',
        a: 'The percentage shows Present days ÷ Total school days recorded. A rate below 80% is highlighted in amber and below 60% in red — these are the "at risk" thresholds shown in Leadership Analytics.',
      },
      {
        q: 'Can I edit attendance after saving?',
        a: 'Yes, if your role has edit permission for attendance. Reopen the register for that date and class, make the changes, and save again. All edits are logged in the audit trail.',
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
        a: 'Go to Timetable → select a class from the dropdown → click any empty cell in the grid → choose subject, teacher, and room → Save. Repeat for each period across the week.',
      },
      {
        q: 'Does the system detect teacher or room conflicts?',
        a: 'Yes. If you try to assign a teacher or room to two classes at the same day and period, the system returns a 409 conflict error and prevents the save.',
      },
      {
        q: 'Can I bulk-load a timetable?',
        a: 'Yes. Use the Import button to upload a CSV of all slots at once. Download the timetable template for the correct column format.',
      },
      {
        q: 'What is Emergency Online Learning Mode?',
        a: 'When enabled by an admin (Settings → Emergency Online Learning Mode), every timetable slot shows a "Join Zoom / Meet" button using the assigned teacher\'s saved personal meeting link. Students see the same Join buttons in their portal.',
      },
      {
        q: 'How do teachers save their meeting links for the timetable?',
        a: 'Each teacher goes to their Profile → Online Meeting Links → pastes their Zoom PMI URL and/or Google Meet URL → Save. These links appear automatically when Emergency Mode is active.',
      },
    ],
  },

  /* ── eLearning & Online Sessions ─────────────────────────── */
  {
    id: 'elearning',
    moduleKey: 'elearning',
    Icon: MonitorPlay,
    title: 'eLearning & Online Sessions',
    articles: [
      {
        q: 'How do I schedule an online class?',
        a: 'Go to eLearning → Online Sessions → "Schedule Session". Choose the audience (a class, an individual student, or a parent), select your platform (Zoom or Google Meet), set the date, time, and duration, then click Schedule. The session is added to the school calendar automatically.',
      },
      {
        q: 'Do I need to sign in to Zoom or Google from Msingi?',
        a: 'No. Msingi does not connect to Zoom or Google APIs. You simply save your personal meeting room link once in your Profile → Online Meeting Links. That link is used every time you schedule a session — no sign-in or tokens required.',
      },
      {
        q: 'Where do scheduled sessions appear for students?',
        a: 'Scheduled sessions appear in the school calendar as "Online Class" events with a Join Meeting button. Students in the target class can also see Join buttons in their Student Portal dashboard when Emergency Online Learning Mode is active.',
      },
      {
        q: 'Can I cancel a session?',
        a: 'Yes. Go to eLearning → Online Sessions → find the upcoming session → click the × (cancel) button. This removes the session and its calendar event.',
      },
      {
        q: "What if I haven't saved my meeting link yet?",
        a: 'The scheduling modal will show a yellow warning. Click "Add it in Profile →" to go directly to your profile and save your Zoom PMI or Google Meet URL. You must save a link before you can schedule sessions.',
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
        a: 'Go to Finance → Fee Structures → "Add Structure". Define the fee type (tuition, boarding, transport, etc.), amount, and which classes it applies to. Fee structures are templates you can apply when creating invoices.',
      },
      {
        q: 'How do I create a fee invoice for a student?',
        a: 'Go to Finance → Invoices → "New Invoice". Select the student, choose a fee structure or enter a custom amount, set the due date, and click Create.',
      },
      {
        q: 'How do I record a payment?',
        a: 'Open the invoice → click "Record Payment" → enter the amount, payment date, method (M-Pesa, bank transfer, cash, cheque), and reference/receipt number → Save. The invoice status updates automatically.',
      },
      {
        q: 'What do the invoice statuses mean?',
        a: 'Draft = not yet sent. Pending = sent, awaiting payment. Partial = some amount paid but balance remains. Paid = fully settled. Overdue = past due date with an outstanding balance. Void = cancelled.',
      },
      {
        q: 'How do I accept M-Pesa payments?',
        a: 'Go to Settings → M-Pesa. Enter your Daraja API credentials (Consumer Key, Secret, Shortcode, Passkey). Once configured, the system can validate M-Pesa STK push payments and auto-reconcile them to invoices.',
      },
      {
        q: 'How do I generate a fee statement for a parent?',
        a: "Open the student's Finance tab in their profile. You can print or download a PDF fee statement showing all invoices and payment history.",
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
        a: 'The BPS tracks cumulative merit and demerit points per student. Demerits trigger escalating stages (Verbal Warning → Written Warning → Suspension). Merits award milestone badges at set thresholds.',
      },
      {
        q: 'How do students reach milestones?',
        a: 'When a student accumulates enough merit points they earn a milestone badge (e.g. Bronze, Silver, Gold). Milestones are visible on the student profile and in the Behaviour module dashboard.',
      },
      {
        q: 'How do students or parents appeal a demerit?',
        a: 'A teacher or admin submits an appeal from the incident detail page. Parents can add a note to the appeal from their portal. An admin or discipline committee member resolves it — the outcome is logged permanently.',
      },
      {
        q: 'What is a Rolling Half-Term window?',
        a: 'Demerit stages are calculated over a rolling half-term window, not the full year. This means a student can "reset" after sufficient time passes without new demerits, preventing unfair carry-over from long ago incidents.',
      },
    ],
  },

  /* ── Exams ────────────────────────────────────────────────── */
  {
    id: 'exams',
    moduleKey: 'grades',     // exams live under the grades/assessment module key
    Icon: ClipboardCheck,
    title: 'Exams',
    articles: [
      {
        q: 'How do I create an exam?',
        a: 'Go to Exams → "New Exam". Enter the exam name, subject, class, date, total marks, and term. The exam appears in the markbook once created.',
      },
      {
        q: 'How do I enter exam results?',
        a: 'Go to Exams → open the exam → click "Enter Results". Enter each student\'s raw score. The system calculates percentages and letter grades automatically based on your grading scale.',
      },
      {
        q: 'Can I lock exam results after entry?',
        a: 'Yes. Once results are reviewed and correct, click "Lock Exam". Locked exams cannot be edited without an unlock request that requires an admin to provide a reason — this is logged in the audit trail.',
      },
      {
        q: 'How are grades calculated from multiple assessments?',
        a: 'The final grade is a weighted average of all assessment components (CA, Homework, Mid-Term, End-Term). Weights are configured per subject in Academic Config. The system calculates this automatically.',
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
        a: 'CA = Continuous Assessment, HW = Homework, MT = Mid-Term test, ET = End-Term exam. Each has a configurable percentage weight that adds up to 100% of the final grade for a subject.',
      },
      {
        q: 'How do I enter marks in the markbook?',
        a: "Go to Grades → Markbook → select the term, class, and subject → enter each student's score for each assessment task → Save. Scores are validated against the maximum marks you set.",
      },
      {
        q: 'How are grade letters assigned?',
        a: "Grade letters (A, B, C, D, E or your school's custom scale) are mapped from the weighted percentage using grade boundaries set in Academic Config.",
      },
      {
        q: 'What is the Academic Health dashboard?',
        a: 'Leadership Analytics includes an Academic Health panel showing the average score per class for published grades, sorted from lowest to highest. Classes below 50% are flagged.',
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
        a: 'Go to Reports → Report Cards. Select the academic year and term. Click "Generate" to produce cards for all students in a class, or open an individual student to generate theirs.',
      },
      {
        q: 'How do I publish a report card?',
        a: 'Once a report card is reviewed and correct, click "Publish". Published cards are visible to the student in their portal and to linked parents. Unpublished cards are only visible to staff.',
      },
      {
        q: 'Can I bulk-publish all report cards for a class?',
        a: "Yes. In the class report card view, click 'Publish All'. A confirmation dialog shows how many cards will be published. A publish audit trail records who published and when.",
      },
      {
        q: 'Can parents download report cards as a PDF?',
        a: 'Yes. Once published, a student or parent can download their report card as a PDF from the Student Portal or Parent Portal.',
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
        a: 'Go to Lessons → select your class and subject → find the topic in the syllabus list → click "Mark as covered". Add optional notes on what was taught.',
      },
      {
        q: 'Where do students see their curriculum coverage?',
        a: "Students see a per-subject coverage bar on their Student Dashboard showing the percentage of topics covered so far. This gives them visibility into learning progress throughout the term.",
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
        a: 'Go to Events → "New Event". Set the title, date, time, category (term date, exam, sports, cultural, meeting, etc.), and audience (school-wide, specific class, or staff only). Click Save.',
      },
      {
        q: 'What is an Online Class event?',
        a: 'When you schedule a session in eLearning → Online Sessions, an "Online Class" calendar event is created automatically. Opening the event shows the meeting link and passcode with a "Join Meeting" button.',
      },
      {
        q: 'How do birthday indicators work on the calendar?',
        a: 'Days with student or staff birthdays are marked with a 🎂 icon. Clicking it shows a popup listing everyone celebrating that day with their name, class/role, and the age they are turning.',
      },
      {
        q: 'Can I view events by week or list view?',
        a: 'Yes. Use the Month / Week / List toggle at the top of the Events page to switch views. The list view is useful for quickly scanning upcoming events.',
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
        a: 'Go to HR → "Add Staff" (or use Settings → Users → Invite User). Enter their name, email, role, and department. They will receive a welcome email with login instructions.',
      },
      {
        q: 'What can a teacher edit on their own profile?',
        a: 'Teachers can update their phone, address, qualifications, specialization, next-of-kin contact, and personal meeting links (Zoom PMI / Google Meet) from their Profile page — no admin approval required.',
      },
      {
        q: 'How do I reset a staff member\'s password?',
        a: 'Go to Settings → Users → find the staff member → click "Reset Password". Enter and confirm a new password. The staff member will be prompted to change it on their next login.',
      },
      {
        q: 'Can a staff member have multiple roles?',
        a: 'Yes. In Settings → Users → open the user → you can assign multiple roles (e.g. Teacher + Finance Officer). The user sees all modules accessible to any of their roles.',
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
        a: 'Yes. Messages are only visible to the sender and recipient(s). Admins can review all conversations for safeguarding and audit purposes.',
      },
      {
        q: 'Can I message an entire class at once?',
        a: 'Yes. When composing a message, select "Class" as the recipient type and choose the class. All students or parents in that class will receive the message.',
      },
      {
        q: 'Will I be notified of new messages?',
        a: 'Yes. An unread badge appears on the Messages icon in the sidebar. Email notifications for messages depend on whether your school has configured SMTP in Settings.',
      },
    ],
  },

  /* ── Settings ─────────────────────────────────────────────── */
  {
    id: 'settings',
    moduleKey: null,             // all staff can read settings guidance
    Icon: Settings,
    title: 'Settings',
    articles: [
      {
        q: 'How do I set up the academic year and terms?',
        a: 'Go to Settings → Academic Year. Create the year (e.g. 2025/2026), add terms with start and end dates, then click "Set as Active". All modules use this active year as the default context.',
      },
      {
        q: 'How do I customise the school logo and colours?',
        a: 'Go to Settings → Branding. Upload your school logo (PNG or JPG), set a Primary Colour and Accent Colour using the colour pickers, and save. These colours are applied across all dashboards and module pages.',
      },
      {
        q: 'How do I configure custom SMTP email sending?',
        a: "By default, all system emails come from Msingi's platform address. To send from your own domain (e.g. noreply@yourschool.ke), go to Settings → Email / SMTP and enter your SMTP server credentials.",
      },
      {
        q: 'What is Emergency Online Learning Mode?',
        a: 'Found in Settings → School Profile. When toggled ON, all timetable slots show Join buttons using each teacher\'s saved meeting link, and students see Join buttons on their dashboard. Useful for unexpected school closures.',
      },
      {
        q: 'How do I back up my school data?',
        a: 'Go to Settings → Data → "Download Backup". This exports all your school data as a JSON archive. Store the file securely — it can be used to restore data if needed.',
      },
    ],
  },

  /* ── Roles & Permissions ──────────────────────────────────── */
  {
    id: 'roles',
    moduleKey: null,             // role information is universal reference
    Icon: Users,
    title: 'Roles & Permissions',
    articles: [
      {
        q: 'What roles are available in Msingi?',
        a: 'Superadmin, Admin, Deputy Principal, Section Head, Teacher, Finance Officer, HR, Admissions Officer, Discipline Committee, Exams Officer, Timetabler, Parent, and Student.',
      },
      {
        q: 'What is the difference between Superadmin and Admin?',
        a: 'Superadmin is the school owner account — it has full access including billing, branding, and platform settings. Admin has full operational access but cannot change billing or delete the school.',
      },
      {
        q: 'Can I create custom permission sets?',
        a: 'Yes. Go to Settings → Role Permissions. You can adjust which modules each role can Read, Create, Update, or Delete. Changes apply immediately for all users with that role.',
      },
      {
        q: 'What can a parent account see?',
        a: "Parents can view their child's attendance, grades, behaviour history, fee balance, report cards, timetable, and messages from staff. They cannot see other students' records.",
      },
      {
        q: 'What can a student account see?',
        a: "Students access the Student Portal — a dedicated dashboard showing today's timetable (with Join buttons during online learning), attendance %, curriculum coverage, fee balance, report cards, and behaviour history.",
      },
    ],
  },

  /* ── Data & Import/Export ─────────────────────────────────── */
  {
    id: 'data',
    moduleKey: null,             // data help visible to all (admin-only features explained in body)
    Icon: Trophy,
    title: 'Data & Import/Export',
    articles: [
      {
        q: 'What file format does Msingi import?',
        a: 'Msingi imports CSV files. Download the template from the Import button inside each module (Students, Teachers, Classes, Timetable, Finance) to get the exact column headers required.',
      },
      {
        q: 'Can I export my data?',
        a: 'Yes. Each module has an Export button in the toolbar. Click it to download all records as a CSV spreadsheet. You can also do a full school data backup from Settings → Data.',
      },
      {
        q: 'What happens if my import has errors?',
        a: 'The import processes all valid rows and skips invalid ones. A summary report shows which rows failed and why (missing fields, duplicate IDs, invalid values). Fix those rows and re-import.',
      },
      {
        q: 'Can I undo a bulk import?',
        a: 'There is no automatic undo for bulk imports. For students: you can change their status to Inactive individually. For timetable slots: use the bulk-delete option. Always preview your CSV data before importing.',
      },
    ],
  },
];

/* ── Article accordion ────────────────────────────────────────── */
function Article({ q, a, primary }) {
  const [open, setOpen] = useState(false);
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
        <p className="pb-4 pr-6 text-sm text-slate-600 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function HelpPage() {
  const { primary } = useSchoolTheme();
  const [query,    setQuery]    = useState('');
  const [activeId, setActiveId] = useState(null);

  // Role-based section filtering — only show help for modules the user can access
  const can  = useAuthStore(s => s.can.bind(s));
  const role = useAuthStore(s => s.session?.user?.role);

  const visibleSections = useMemo(() =>
    SECTIONS.filter(sec =>
      sec.moduleKey === null ||
      role === 'superadmin' ||
      role === 'admin' ||
      can(sec.moduleKey),
    ),
  [role]); // `can` is a stable bound method — role change is the only trigger

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
