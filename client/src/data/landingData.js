import {
  Activity, BarChart3, BookCheck, BookMarked, BookOpen, Building2, Bus,
  Calendar, CalendarDays, CheckCircle, ClipboardList, DollarSign,
  FileCheck2, FileText, GraduationCap, Layers, MessageSquare, MonitorPlay,
  ShieldCheck, TrendingUp, UserCheck, UserCog, Users,
} from 'lucide-react';

export const WA_NUMBER  = '254769024153';
export const WA_MESSAGE = encodeURIComponent('Hello Msingi, I would like to learn more about the platform.');
export const WA_URL     = `https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`;

// ── Ecosystem nodes ────────────────────────────────────────────
export const ECOSYSTEM_NODES = [
  // Core academic pipeline
  { label: 'Admissions',      Icon: ClipboardList, color: 'bg-pink-500',    desc: 'First enquiry in'   },
  { label: 'Student Records', Icon: Users,         color: 'bg-indigo-500',  desc: 'Profile created'    },
  { label: 'Teachers',        Icon: UserCheck,     color: 'bg-blue-600',    desc: 'Staff managed'      },
  { label: 'Classes',         Icon: Layers,        color: 'bg-blue-500',    desc: 'Sections & streams' },
  { label: 'Subjects',        Icon: BookMarked,    color: 'bg-violet-400',  desc: 'Curriculum mapped'  },
  { label: 'Timetable',       Icon: Calendar,      color: 'bg-sky-500',     desc: 'Lessons scheduled'  },
  { label: 'Attendance',      Icon: CheckCircle,   color: 'bg-emerald-500', desc: 'Daily tracked'      },
  { label: 'Lessons',         Icon: BookCheck,     color: 'bg-cyan-500',    desc: 'Curriculum covered' },
  { label: 'Exams',           Icon: FileCheck2,    color: 'bg-fuchsia-500', desc: 'Results recorded'   },
  { label: 'Grades',          Icon: GraduationCap, color: 'bg-violet-500',  desc: 'Marks attributed'   },
  { label: 'eLearning',       Icon: MonitorPlay,   color: 'bg-purple-600',  desc: 'Online learning'    },
  // Operations
  { label: 'Behaviour',       Icon: ShieldCheck,   color: 'bg-orange-500',  desc: 'Incidents logged'   },
  { label: 'Finance',         Icon: DollarSign,    color: 'bg-amber-500',   desc: 'Fees collected'     },
  { label: 'Messages',        Icon: MessageSquare, color: 'bg-sky-600',     desc: 'Staff connected'    },
  { label: 'Events',          Icon: CalendarDays,  color: 'bg-yellow-500',  desc: 'School calendar'    },
  { label: 'HR & Staff',      Icon: UserCog,       color: 'bg-slate-600',   desc: 'Staff & payroll'    },
  { label: 'Library',         Icon: BookOpen,      color: 'bg-lime-600',    desc: 'Resources managed'  },
  // Insights
  { label: 'Reports',         Icon: FileText,      color: 'bg-purple-500',  desc: 'Governed publish'   },
  { label: 'Analytics',       Icon: TrendingUp,    color: 'bg-teal-500',    desc: 'Director insight'   },
  // Support services — last as requested
  { label: 'Transport',       Icon: Bus,           color: 'bg-rose-500',    desc: 'Routes tracked'     },
  { label: 'Hostel',          Icon: Building2,     color: 'bg-stone-500',   desc: 'Boarders managed'   },
];

// ── Conviction before/after pairs ─────────────────────────────
export const CONVICTION_PAIRS = [
  { before: 'Fee tracking in Excel, reconciled every Friday',               after: 'Real-time fee ledger with every payment, every receipt, tracked live'  },
  { before: 'Report cards assembled manually by the registrar',             after: 'Governed publishing chain: Teacher → HOD → Principal → Parent Portal'  },
  { before: "Curriculum coverage tracked in a teacher's notebook",          after: 'Syllabus tracker with every topic marked and every subject covered live' },
  { before: 'Parent notices via personal WhatsApp groups',                  after: 'Structured institutional channels with a permanent audit trail'          },
  { before: 'Leadership decisions on week-old paper summaries',             after: 'Live director dashboard spanning attendance, grades, and finance'        },
];

// ── Showcase tab data (Mockup component wired in Landing.jsx) ──
export const SHOWCASE_TAB_DATA = [
  {
    id:       'director',
    label:    "Director's View",
    Icon:     BarChart3,
    headline: "Every decision signal in one view.",
    bullets: [
      "Attendance, academic performance, and financial health on a single screen, updated in real time",
      "Outliers and alerts surface automatically without manual compilation",
      "Decisions grounded in current data, not last week's spreadsheet",
    ],
  },
  {
    id:       'reports',
    label:    "Report Governance",
    Icon:     FileText,
    headline: "No report published without every gate cleared.",
    bullets: [
      "A five-stage approval chain the platform enforces, not email threads",
      "Every action logged with attribution: who approved, when, and what was reviewed",
      "Publication is blocked until the full chain is complete. The trail is permanent",
    ],
  },
  {
    id:       'finance',
    label:    "Fee Clarity",
    Icon:     DollarSign,
    headline: "Fee collection without the guesswork.",
    bullets: [
      "M-Pesa STK Push triggers payment to parent phones and auto-reconciles on receipt",
      "Paybill, bank transfer, and cash all land in one live register with receipt numbers",
      "Overdue accounts surface automatically, with SMS reminders and a full notification log",
    ],
  },
];

// ── Pricing tiers ──────────────────────────────────────────────
export const PORTAL_TIERS_LANDING = [
  {
    name:     'Base',
    rate:     150,
    tagline:  'Full school ERP for admin and teaching staff',
    badge:    null,
    dark:     false,
    portals:  ['Admin Portal', 'Teacher Portal'],
    features: [
      'All ERP modules — no feature gates',
      'Admin & teacher dashboards',
      'Students, attendance, behaviour & finance',
      'Timetable, exams, HR & lessons tracker',
      'Library, transport, hostel & admissions',
    ],
    cta: 'Get Started',
  },
  {
    name:     'Student',
    rate:     200,
    tagline:  'Base + dedicated student login and dashboard',
    badge:    'Popular',
    dark:     true,
    portals:  ['Admin Portal', 'Teacher Portal', 'Student Portal'],
    features: [
      'Everything in Base',
      'Student login accounts',
      'Student dashboard: lessons, timetable, report cards',
      'Attendance & fee balance view',
    ],
    cta: 'Get Student',
  },
  {
    name:     'Family',
    rate:     250,
    tagline:  'Student + parent portal with full family visibility',
    badge:    'Recommended',
    dark:     false,
    portals:  ['Admin Portal', 'Teacher Portal', 'Student Portal', 'Parent Portal'],
    features: [
      'Everything in Student',
      'Parent login accounts',
      'Parent dashboard: child progress, fees & curriculum',
      'Parent–teacher messaging',
      'Real-time lesson coverage per subject',
    ],
    cta: 'Get Family',
  },
];

// ── Module preview data ────────────────────────────────────────
export const MODULE_PREVIEWS = {
  'Admissions': {
    tagline: 'Every prospective student tracked from first contact to enrolled record.',
    outcomes: [
      'First enquiries captured with source, notes and contact details — no lead is lost',
      'Applicants move through your defined stages: Enquiry → Applied → Interview → Offered → Enrolled',
      'Offer letters and admission references generated automatically when a stage is reached',
      'Approved applicants convert to full student records in one click — no re-entering data',
    ],
    results: [
      'No lost enquiries — every lead tracked from first contact to decision',
      'No duplicate student records — admissions feed directly into Student Records',
      'Offer letters issued in seconds, not assembled by hand',
    ],
    badge: 'Pipeline Tracked',
    connectedModules: ['Student Records', 'Finance', 'Reports'],
    demoPath: '/admissions',
    mockup: {
      type: 'pipeline',
      rows: [
        { stage: 'Enquiry',   count: 14, color: 'bg-slate-500'  },
        { stage: 'Applied',   count: 9,  color: 'bg-blue-500'   },
        { stage: 'Interview', count: 6,  color: 'bg-amber-500'  },
        { stage: 'Offered',   count: 4,  color: 'bg-indigo-500' },
        { stage: 'Enrolled',  count: 2,  color: 'bg-emerald-500'},
      ],
    },
  },
  'Student Records': {
    tagline: 'One permanent record per student — from first admission to final graduation.',
    outcomes: [
      'Profile, guardian contacts, photo and medical notes in a single view — nothing scattered across spreadsheets',
      'Academic history, attendance, behaviour and fee records all accessible in one place',
      'Every edit timestamped and attributed — an immutable audit trail behind every record',
      'Records preserved permanently after a student leaves, transfers or graduates',
    ],
    results: [
      'One record per student — no reconciling data across separate registers',
      'Complete history available instantly — for parent meetings, legal requests or audits',
      'No data lost when staff change — institutional memory lives in the system',
    ],
    badge: 'Audit Ready',
    connectedModules: ['Attendance', 'Grades', 'Reports', 'Behaviour', 'Finance'],
    demoPath: '/students',
    mockup: {
      type: 'list',
      headers: ['Student', 'Class', 'Status'],
      rows: [
        ['Amara Wanjiku', 'Form 3A', 'active'],
        ['Brian Otieno',  'Form 1B', 'active'],
        ['Chloe Kamau',   'Form 4A', 'active'],
        ['David Njoroge', 'Form 2C', 'inactive'],
      ],
    },
  },
  'Classes': {
    tagline: 'Sections, streams and curriculum structure that mirror your school exactly.',
    outcomes: [
      'Create classes with any naming convention — Form 1A, Year 7, Grade 4 Stream B',
      'Supports CBC, 8-4-4, IGCSE and IB without building separate systems',
      'Assign class teachers and configure subject sets per class in minutes',
      'Enrolling a student into a class automatically activates their attendance, timetable and report card',
    ],
    results: [
      'Multi-curriculum schools need one system, not one per curriculum',
      'New academic year setup takes minutes — not a week of spreadsheet work',
      'Timetable, attendance and reports always aligned — no manual class mapping',
    ],
    badge: 'Multi-Curriculum',
    connectedModules: ['Attendance', 'Timetable', 'Grades', 'Reports', 'Finance'],
    demoPath: '/classes',
    mockup: {
      type: 'list',
      headers: ['Class', 'Teacher', 'Students'],
      rows: [
        ['Form 1A', 'Ms Achieng',  '38'],
        ['Form 2B', 'Mr Mwangi',   '35'],
        ['Form 3A', 'Mrs Kariuki',  '40'],
        ['Form 4C', 'Mr Odhiambo', '32'],
      ],
    },
  },
  'Timetable': {
    tagline: 'A complete school schedule with zero conflicts — published instantly to every portal.',
    outcomes: [
      'Build the full school timetable in a visual grid across days, classes, subjects and rooms',
      'Conflict detection is automatic — no teacher or room is ever double-booked',
      'Students and teachers see their own schedule the moment they log in',
      'Timetable changes publish instantly — no printing and redistributing paper copies',
    ],
    results: [
      'Scheduling errors caught before publishing, not discovered in week one of term',
      'Every teacher sees their current schedule in real time — no WhatsApp reminders',
      'Timetable changes take effect across all portals immediately',
    ],
    badge: 'Conflict-Free',
    connectedModules: ['Attendance', 'Lessons', 'Classes', 'Student Records'],
    demoPath: '/timetable',
    mockup: {
      type: 'timetable',
      periods: [
        { time: '8:00',  subjects: ['Maths', 'English', 'Science', 'Kiswahili'] },
        { time: '9:00',  subjects: ['English', 'Maths', 'History', 'Science'] },
        { time: '10:00', subjects: ['Science', 'CRE', 'Maths', 'English'] },
      ],
    },
  },
  'Attendance': {
    tagline: 'Daily register marked in seconds — accurate data available instantly across the school.',
    outcomes: [
      'Teachers mark attendance for their class in under 60 seconds — present, absent or late',
      'Notes recorded per entry — illness, authorised absence, bereavement, field trip',
      'School-wide attendance percentage visible in real time by student, class and date',
      'Parents on the Family tier receive automatic alerts on unexplained absences',
    ],
    results: [
      'No paper registers to scan or transcribe at end of term',
      'Chronic absenteeism visible in the dashboard before it becomes a pastoral crisis',
      'Attendance data in reports comes from the same record — no reconciliation',
    ],
    badge: 'Real-time',
    connectedModules: ['Reports', 'Analytics', 'Grades', 'Student Records'],
    demoPath: '/attendance',
    mockup: {
      type: 'register',
      rows: [
        { name: 'Amara Wanjiku',  status: 'present' },
        { name: 'Brian Otieno',   status: 'absent'  },
        { name: 'Chloe Kamau',    status: 'present' },
        { name: 'David Njoroge',  status: 'late'    },
        { name: 'Esther Muthoni', status: 'present' },
      ],
    },
  },
  'Lessons': {
    tagline: 'Syllabus coverage tracked per class — principals can see what has been taught at any time.',
    outcomes: [
      'Admin defines the syllabus once — all teachers of a subject work from the same topic list',
      "Co-teachers of the same class share one coverage pool — no duplication or conflict",
      'HODs see every subject\'s coverage across all classes in a single dashboard view',
      'Parents see real-time curriculum progress for their child\'s subjects in their portal',
    ],
    results: [
      'Principals confirm syllabus progress at any time — no waiting for end-of-term reports',
      'No end-of-term scramble to cover missed topics — gaps are visible throughout the term',
      'Parents informed on curriculum without teachers making individual phone calls',
    ],
    badge: 'Syllabus Linked',
    connectedModules: ['Reports', 'Analytics', 'Grades', 'Timetable'],
    demoPath: '/lessons',
    mockup: {
      type: 'coverage',
      rows: [
        { subject: 'Mathematics', covered: 18, total: 24, pct: 75 },
        { subject: 'English',     covered: 22, total: 28, pct: 79 },
        { subject: 'Science',     covered: 12, total: 20, pct: 60 },
        { subject: 'History',     covered: 16, total: 18, pct: 89 },
      ],
    },
  },
  'Grades': {
    tagline: 'CA, homework, mid-term and end-term marks entered once — totals calculated automatically.',
    outcomes: [
      'CA, Homework, Mid-Term and End-Term scores recorded per student per subject',
      'Weighted totals and grade boundaries applied automatically — no Excel formulas',
      'Grade boundaries configurable per school and curriculum, applied school-wide from one setting',
      'Marks flow directly into report cards — zero manual transfer between registers and templates',
    ],
    results: [
      'No grade entry errors from copying between registers and report templates',
      'Subject totals, class averages and rank positions calculated in real time',
      'Teachers spend time on teaching, not on reconciling mark sheets',
    ],
    badge: 'Auto-Calculated',
    connectedModules: ['Reports', 'Analytics', 'Attendance', 'Lessons'],
    demoPath: '/grades',
    mockup: {
      type: 'list',
      headers: ['Student', 'CA', 'MT', 'ET', 'Total'],
      rows: [
        ['Amara W.', '28', '61', '74', '163 / A'],
        ['Brian O.',  '24', '55', '68', '147 / B+'],
        ['Chloe K.',  '30', '70', '82', '182 / A+'],
        ['David N.',  '18', '42', '58', '118 / C+'],
      ],
    },
  },
  'Behaviour': {
    tagline: 'Merit awards and incident logs — with automatic escalation through defined intervention stages.',
    outcomes: [
      'Log incidents or award merits with category, description and teacher attribution in seconds',
      'Student stage advances automatically: Commended → Good Standing → Monitored → At Risk → Intervention',
      'Milestone achievements recorded — community service hours, honour roll, leadership recognition',
      'Full behaviour history preserved in the student record — available for parent meetings and handovers',
    ],
    results: [
      'Behavioural trends visible before they escalate — early intervention is possible',
      'Disciplinary records available for parent meetings, staff transitions and tribunal processes',
      'Merit culture reinforced alongside accountability — not just a punishment log',
    ],
    badge: 'Stage-Based',
    connectedModules: ['Reports', 'Analytics', 'Student Records'],
    demoPath: '/behaviour',
    mockup: {
      type: 'list',
      headers: ['Student', 'Points', 'Stage'],
      rows: [
        ['Amara W.', '+42', 'Commended'],
        ['Brian O.',  '+15', 'Good Standing'],
        ['Chloe K.',  '+38', 'Commended'],
        ['David N.',  '-12', 'Monitored'],
      ],
    },
  },
  'Reports': {
    tagline: 'Five-stage approval pipeline — no report card leaves without every gate cleared.',
    outcomes: [
      'Teacher enters marks → HOD reviews → Deputy approves → Principal authorises → Published to parent portal',
      'Publication blocked until every stage is cleared for every student in the class — no partial releases',
      'Every action timestamped and attributed — a permanently auditable chain of custody',
      "Parents receive an in-portal notification the moment their child's report card is published",
    ],
    results: [
      'Report cards published in hours, not days — approval stages run in parallel, not in sequence',
      'No unsigned, unreviewed or incorrect report card reaches a parent',
      'Full audit trail protects the school in the event of a grade dispute',
    ],
    badge: '5-Stage Approval',
    connectedModules: ['Grades', 'Analytics', 'Finance', 'Student Records'],
    demoPath: '/reports',
    mockup: {
      type: 'pipeline',
      rows: [
        { stage: 'Teacher Entry', count: 4,  color: 'bg-slate-500'  },
        { stage: 'HOD Review',    count: 3,  color: 'bg-blue-500'   },
        { stage: 'Deputy',        count: 2,  color: 'bg-amber-500'  },
        { stage: 'Principal',     count: 1,  color: 'bg-indigo-500' },
        { stage: 'Published',     count: 8,  color: 'bg-emerald-500'},
      ],
    },
  },
  'Finance': {
    tagline: 'Fee structures, M-Pesa collections and a live arrears register — reconciled automatically.',
    outcomes: [
      'Build fee structures by class, term and item — tuition, boarding, transport and activities',
      "M-Pesa STK Push sends a payment prompt to the parent's phone — confirmed and reconciled in seconds",
      'Paybill, bank transfer and cash all recorded in the same ledger with receipt numbers',
      'Overdue accounts flagged automatically — parents notified without a manual phone call from the bursar',
    ],
    results: [
      'Fee arrears visible per student in real time — no end-of-term reconciliation exercise',
      'Every payment accounted for regardless of method — one audit-ready ledger',
      'Bursars focus on exceptions, not on manually matching bank statements to registers',
    ],
    badge: 'M-Pesa Integrated',
    connectedModules: ['Analytics', 'Reports', 'Student Records', 'Admissions'],
    demoPath: '/finance',
    mockup: {
      type: 'ledger',
      rows: [
        { name: 'Amara W.', amount: '18,500', status: 'paid',    ref: 'RCP-0041' },
        { name: 'Brian O.',  amount: '18,500', status: 'partial', ref: 'RCP-0039' },
        { name: 'Chloe K.',  amount: '18,500', status: 'paid',    ref: 'RCP-0038' },
        { name: 'David N.',  amount: '18,500', status: 'overdue', ref: '—'        },
      ],
    },
  },
  'Library': {
    tagline: 'Book catalogue, loan tracking and automated overdue fines — no card system required.',
    outcomes: [
      'Books catalogued with title, author, ISBN, shelf location and copy count',
      'Loans issued to students or staff — due date tracked automatically, no manual card system',
      'Overdue fines calculated at a configurable daily rate and added directly to the student fee account',
      'Catalogue searchable by title, author or ISBN in real time from any device',
    ],
    results: [
      'No manual fine collection — overdue charges appear on the student fee account automatically',
      'Book availability accurate at all times — staff check without walking to the shelf',
      'Loan history preserved permanently for every student',
    ],
    badge: 'Fine Automated',
    connectedModules: ['Student Records', 'Finance'],
    demoPath: '/library',
    mockup: {
      type: 'list',
      headers: ['Title', 'Borrower', 'Due'],
      rows: [
        ['KCSE Chemistry Revision',  'Amara W.', 'Jun 12'],
        ['Blossoms of the Savannah', 'Brian O.',  'Jun 8 ⚠'],
        ['Business Studies Bk 3',    'Chloe K.',  'Jun 15'],
        ['Mathematics Form 4',       'Esther M.', 'Jun 10'],
      ],
    },
  },
  'Transport': {
    tagline: 'Route management, student assignments and capacity enforcement — centrally managed.',
    outcomes: [
      'Create routes with stops, departure times, vehicle registration and driver contacts',
      'Assign students to their specific pickup stop — one record updated in real time',
      'Capacity enforcement built in — the system prevents over-assigning a vehicle',
      'Transport fees configured per route and collected through the same M-Pesa flow as tuition fees',
    ],
    results: [
      'No manual route lists — transport assignments always reflect current enrolment',
      'Vehicle capacity never exceeded — the safety constraint is enforced by the platform',
      'Transport fees collected without a separate billing process',
    ],
    badge: 'Capacity Enforced',
    connectedModules: ['Student Records', 'Finance'],
    demoPath: '/transport',
    mockup: {
      type: 'list',
      headers: ['Route', 'Students', 'Driver'],
      rows: [
        ['Westlands Express', '38 / 40', 'James Mwenda'],
        ['Eastlands Shuttle', '31 / 33', 'Peter Omondi'],
        ['Karen Runner',      '12 / 14', 'Samuel Njiru'],
      ],
    },
  },
  'Hostel': {
    tagline: 'Boarding houses and room assignments — occupancy tracked automatically, fees collected centrally.',
    outcomes: [
      'Create boarding houses and rooms with capacity, gender rules and warden contacts',
      'Assign students to rooms — occupied count updates automatically, no whiteboard or paper register',
      'Discharge marks the end date and frees the room for reassignment immediately',
      'Boarding fees configured per house and linked to the student fee account',
    ],
    results: [
      'Room availability accurate at all times — no end-of-day manual count',
      'Boarding fee collection handled through the same Finance module as tuition',
      'Warden handovers take minutes — all resident information is in the system',
    ],
    badge: 'Room Managed',
    connectedModules: ['Student Records', 'Finance', 'Reports'],
    demoPath: '/hostel',
    mockup: {
      type: 'list',
      headers: ['Room', 'Occupied', 'Capacity'],
      rows: [
        ['Boys B101',  '4', '4 ✓'],
        ['Boys B102',  '3', '4'  ],
        ['Girls G201', '4', '4 ✓'],
        ['Girls G202', '2', '4'  ],
      ],
    },
  },
  'Analytics': {
    tagline: 'Director-level visibility across attendance, academic performance and finances — live.',
    outcomes: [
      'School-wide attendance trends, class-by-class and day-by-day, in one dashboard',
      'Performance outliers and at-risk students surface automatically — no manual compilation',
      'Fee collection rate, outstanding balances and month-on-month comparison in real time',
      "Every chart reflects the current state of the institution — not last week's export",
    ],
    results: [
      'Directors make decisions on current data, not a week-old paper summary',
      'No end-of-term report assembly — the dashboard is always ready',
      'Financial health, academic performance and operational data visible in one view',
    ],
    badge: 'Live Dashboard',
    connectedModules: ['Finance', 'Grades', 'Attendance', 'Reports'],
    demoPath: '/reports',
    mockup: {
      type: 'stats',
      items: [
        { label: 'Attendance',    value: '94%',      trend: '+2%',   up: true  },
        { label: 'Fee Collected', value: 'KSh 2.4M', trend: '+18%',  up: true  },
        { label: 'Avg Grade',     value: 'B+',        trend: '−0.2', up: false },
        { label: 'At Risk',       value: '4',         trend: '−2',   up: true  },
      ],
    },
  },
  'Teachers': {
    tagline: 'Every staff member profiled, assigned, and performing — managed from one place.',
    outcomes: [
      'Teacher profiles created with qualifications, subjects taught, and assigned classes',
      'Workload balanced across classes and streams — no invisible overloads',
      'Linked directly to timetable, attendance, and lesson records for a complete picture',
      'Performance tracked term by term with a permanent professional record',
    ],
    results: [
      'Admin spends less time chasing staff details — everything in one profile',
      'Subject gaps visible at a glance before term begins',
      'Teacher history preserved across academic years',
    ],
    badge: 'Staff Managed',
    connectedModules: ['Classes', 'Subjects', 'Timetable', 'Attendance'],
    demoPath: '/teachers',
    mockup: {
      type: 'list',
      headers: ['Teacher', 'Subjects', 'Classes'],
      rows: [
        ['Ms Achieng',   'Math, Physics',    'Form 3A, 3B'],
        ['Mr Omondi',    'English, History', 'Form 1A, 2A'],
        ['Mrs Kamau',    'Biology, Chem',    'Form 4A, 4B'],
      ],
    },
  },
  'Exams': {
    tagline: 'Set papers, capture results, and publish grades — the full exam cycle in one workflow.',
    outcomes: [
      'Exams created per subject, class, and term — linked to the academic year automatically',
      'Results captured per student with marks, grade, and remarks in one screen',
      'Grade boundaries configured per school so grades are consistent and transparent',
      'Results feed into report cards the moment they are confirmed — no manual transfer',
    ],
    results: [
      'Data-entry errors drop significantly — marks entered once, used everywhere',
      'Parents see grades on the same day results are published',
      'Historic exam performance retrievable for any student at any time',
    ],
    badge: 'Results Recorded',
    connectedModules: ['Grades', 'Report Cards', 'Student Records'],
    demoPath: '/exams',
    mockup: {
      type: 'list',
      headers: ['Exam', 'Class', 'Avg Score'],
      rows: [
        ['Mid-Term Math', 'Form 3A', '67%'],
        ['End-Term Eng',  'Form 1B', '72%'],
        ['KCSE Mock',     'Form 4',  '58%'],
      ],
    },
  },
  'Subjects': {
    tagline: 'Map every subject to the right class, teacher, and curriculum — before the first lesson.',
    outcomes: [
      'Subjects created school-wide and assigned to classes in seconds',
      'Each subject linked to the responsible teacher and the relevant timetable slots',
      'Curriculum-level categorisation (core vs elective) enforced consistently',
      'Changes to the subject list propagate to timetable and lessons automatically',
    ],
    results: [
      'No subject-class mismatches appearing on report cards at end of term',
      'New teachers can see their full subject load from day one',
      'Curriculum structure preserved accurately across academic years',
    ],
    badge: 'Curriculum Mapped',
    connectedModules: ['Classes', 'Teachers', 'Timetable', 'Lessons'],
    demoPath: '/subjects',
    mockup: {
      type: 'list',
      headers: ['Subject', 'Classes', 'Teacher'],
      rows: [
        ['Mathematics',  '6 classes', 'Ms Achieng'],
        ['English',      '8 classes', 'Mr Omondi'],
        ['Biology',      '4 classes', 'Mrs Kamau'],
      ],
    },
  },
  'Messages': {
    tagline: 'Structured communication between staff, parents, and students — on the record.',
    outcomes: [
      'Direct messages sent between teachers, admin, parents, and students within the platform',
      'Threaded conversations keep context intact — no lost reply chains',
      'Broadcast announcements sent to a class, year group, or the whole school in one click',
      'All messages archived and searchable — a permanent communication record',
    ],
    results: [
      'WhatsApp groups replaced with a structured, auditable channel',
      'Parent queries resolved faster — staff see all context in the thread',
      'No communication falls through the cracks of informal channels',
    ],
    badge: 'Staff Connected',
    connectedModules: ['Student Records', 'Events', 'Admissions'],
    demoPath: '/messages',
    mockup: {
      type: 'list',
      headers: ['Thread', 'Participants', 'Last Message'],
      rows: [
        ['Fee Reminder — Form 4',     'Admin → Parents',   '2 min ago'],
        ['Trip Permission — Form 2A', 'Ms Achieng → Parents', '1 hr ago'],
        ['Staff Briefing — All',      'Principal → Staff', 'Yesterday'],
      ],
    },
  },
  'Events': {
    tagline: 'Every school event planned, communicated, and archived in a shared calendar.',
    outcomes: [
      'Events created with date, time, venue, and audience — published to the school calendar instantly',
      'Reminders sent automatically to the relevant staff and parent groups',
      'Recurring events (open days, prize givings, sports days) set up once and repeated',
      'Event history preserved — a permanent record of the school year',
    ],
    results: [
      'Parents always have the term calendar — no "I didn\'t know" at gate pick-up',
      'Staff stop duplicating event communications across email, WhatsApp, and notice boards',
      'Event planning starts earlier because visibility is higher',
    ],
    badge: 'School Calendar',
    connectedModules: ['Messages', 'Student Records', 'Finance'],
    demoPath: '/events',
    mockup: {
      type: 'list',
      headers: ['Event', 'Date', 'Audience'],
      rows: [
        ['Open Day',         'Jun 28, 2025', 'Parents & Students'],
        ['Prize Giving',     'Jul 5, 2025',  'Whole School'],
        ['Term 2 Begins',    'Jul 14, 2025', 'All Staff'],
      ],
    },
  },
  'HR & Staff': {
    tagline: 'Staff employment, payroll, and leave — managed in one place, not a spreadsheet.',
    outcomes: [
      'Employee records created with contract type, start date, department, and salary grade',
      'Leave requests submitted and approved within the platform — balances updated automatically',
      'Monthly payroll processed against confirmed attendance and approved deductions',
      'Staff documents (contracts, appraisals, certificates) stored securely per employee',
    ],
    results: [
      'HR admin time on payroll preparation cut by half',
      'Leave disputes resolved in seconds — balance history is always available',
      'Compliance records audit-ready without manual collation',
    ],
    badge: 'Staff & Payroll',
    connectedModules: ['Teachers', 'Finance', 'Reports'],
    demoPath: '/hr',
    mockup: {
      type: 'list',
      headers: ['Staff Member', 'Leave Balance', 'Status'],
      rows: [
        ['Ms Achieng',  '12 days', 'Active'],
        ['Mr Omondi',   '8 days',  'On Leave'],
        ['Mrs Kamau',   '15 days', 'Active'],
      ],
    },
  },
  'eLearning': {
    tagline: 'Learning that continues beyond the classroom — lessons, resources, and assignments online.',
    outcomes: [
      'Lessons published as structured modules with notes, videos, and downloadable resources',
      'Assignments set online and submitted by students before a deadline — no paper trail',
      'Student progress tracked per module — teachers see completion rates at a glance',
      'Content reused across classes and academic years — build once, deploy many times',
    ],
    results: [
      'Students who miss class can catch up without waiting for the next lesson',
      'Teacher preparation time per lesson drops after the first term of content creation',
      'Assessment results from online submissions feed directly into Grades',
    ],
    badge: 'Online Learning',
    connectedModules: ['Lessons', 'Grades', 'Student Records', 'Subjects'],
    demoPath: '/elearning',
    mockup: {
      type: 'list',
      headers: ['Module', 'Completion', 'Class'],
      rows: [
        ['Algebra — Quadratics',  '82%', 'Form 3A'],
        ['Essay Writing Basics',  '91%', 'Form 1B'],
        ['Cell Biology Unit 2',   '74%', 'Form 4A'],
      ],
    },
  },
};

// ── Mockup status helpers ──────────────────────────────────────
export const STATUS_DOT = {
  present: 'bg-emerald-400',
  absent:  'bg-red-400',
  late:    'bg-amber-400',
  paid:    'bg-emerald-400',
  partial: 'bg-amber-400',
  overdue: 'bg-red-400',
};

export const STATUS_LABEL = {
  present: 'Present',
  absent:  'Absent',
  late:    'Late',
  paid:    'Paid',
  partial: 'Partial',
  overdue: 'Overdue',
};

// ── CMS defaults (shown when DB has no override) ───────────────
export const CMS_DEFAULTS = {
  hero: {
    headline:    'Decision Intelligence\nfor Educational Leaders.',
    subheadline: 'Real-time visibility across admissions, attendance, academics, and finance so school leaders make faster, better-informed decisions every day.',
    tagline:     'Built for the leaders who run schools',
    cta1:        'Book a Demo',
    cta2:        'Explore the Platform',
    italic:      'Most platforms give you data. Msingi gives you institutional clarity.',
  },
  conviction: CONVICTION_PAIRS,
  ecosystem: {
    heading:      'One student. Every operational layer, connected.',
    subheading:   'From the first enquiry to the published report card, the collected fee, and the covered lesson. One unbroken data trail across the entire institution.',
    enabledNodes: ECOSYSTEM_NODES.map(n => n.label),
    nodeDescs:    Object.fromEntries(ECOSYSTEM_NODES.map(n => [n.label, n.desc])),
  },
  showcase: SHOWCASE_TAB_DATA.map(t => ({
    id:       t.id,
    label:    t.label,
    headline: t.headline,
    bullets:  t.bullets,
  })),
  trust: {
    schools: ['Mascit Lab Academy'],
    tagline: 'Now live · actively onboarding partner schools for 2026',
  },
  footer: {
    tagline: 'Decision Intelligence for Educational Leaders.',
    email:   'hello@msingi.io',
  },
  seo: {
    title:       'Msingi — Decision Intelligence for Educational Leaders',
    description: 'Real-time visibility across attendance, academics, and finance so school leaders make faster, better-informed decisions.',
    ogImageUrl:  '',
  },
};
