/* ============================================================
   InnoLearn — Help Centre Module
   In-app help, role-filtered, searchable
   ============================================================ */

const Help = (() => {

  let _search = '';

  /* ── Article definitions ──────────────────────────────── */
  /*
   * Each article:
   *   id        — unique string
   *   module    — maps to a nav route (used for badge colour / icon)
   *   title     — short headline
   *   roles     — array of roles that see this article; empty array = all roles
   *   tags      — keywords for search (space-separated string)
   *   content   — HTML string (paragraphs, numbered lists, tips, etc.)
   */
  const ARTICLES = [
    /* ─── Getting Started ─── */
    {
      id: 'gs-login',
      module: 'general',
      title: 'Logging in & demo access',
      roles: [],
      tags: 'login password sign in demo credentials forgot',
      content: `
        <p>Open InnoLearn in your browser. Enter your school email address and password, then click <strong>Sign In</strong>.</p>
        <p><strong>Demo access:</strong> The login screen shows quick-access role pills. Click any pill (e.g. <em>Admin</em>, <em>Teacher</em>, <em>Parent</em>) to pre-fill the demo credentials for that role — no typing required.</p>
        <p><strong>Forgot password:</strong> Contact your school administrator to have your password reset. There is no self-service password reset in this version.</p>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> Your role determines which modules appear in your sidebar. If you cannot see a module you expect, contact your admin to check your permissions.</div>
      `
    },
    {
      id: 'gs-nav',
      module: 'general',
      title: 'Navigating the app',
      roles: [],
      tags: 'navigate sidebar search back button notifications breadcrumb',
      content: `
        <ul>
          <li>Click any item in the <strong>left sidebar</strong> to open that module.</li>
          <li>The <strong>topbar search</strong> finds students by name or admission number. Start typing at least 2 characters — if there is exactly one match, you are taken directly to that student's profile.</li>
          <li>The <strong>back button</strong> in your browser works normally. InnoLearn uses URL hash routing, so every view has a shareable URL.</li>
          <li>The <strong>bell icon</strong> (top-right) shows your latest notifications. Click <em>Mark all read</em> to clear the badge.</li>
          <li>Click your <strong>avatar</strong> (top-right) to open the user menu where you can sign out.</li>
        </ul>
      `
    },

    /* ─── Students ─── */
    {
      id: 'stu-view',
      module: 'students',
      title: 'Finding and viewing students',
      roles: ['superadmin','admin','teacher','deputy_principal','section_head','discipline_committee','finance'],
      tags: 'student list search filter profile admission number class',
      content: `
        <p>Navigate to <strong>Students</strong> in the sidebar. The list shows all active students with their photo initials, admission number, class, and house.</p>
        <p><strong>Filtering:</strong> Use the search box to filter by name, or use the dropdowns to filter by class, section, or status.</p>
        <p><strong>Student profile tabs:</strong></p>
        <ul>
          <li><strong>Overview</strong> — personal details, class, house, guardian contacts</li>
          <li><strong>Academic</strong> — current grades, exam results, report cards</li>
          <li><strong>Attendance</strong> — monthly attendance breakdown</li>
          <li><strong>Behaviour</strong> — merit/demerit history, current stage, milestone badges</li>
          <li><strong>Finance</strong> — invoice history and payment status</li>
        </ul>
      `
    },
    {
      id: 'stu-add',
      module: 'students',
      title: 'Adding or editing a student',
      roles: ['superadmin','admin'],
      tags: 'add student new enroll edit profile guardian medical',
      content: `
        <p>Click <strong>+ Add Student</strong> (admin/superadmin only). You need to fill in:</p>
        <ol>
          <li>Full name, date of birth, nationality, gender</li>
          <li>Class assignment and admission number</li>
          <li>Guardian details — at least one guardian is required</li>
          <li>Medical notes (optional)</li>
        </ol>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> Students are usually created automatically when an Admissions application is approved. Use manual addition only for direct enrollment.</div>
        <p><strong>To edit a student:</strong> Open their profile and click the <strong>Edit</strong> button. All fields are editable, including house assignment.</p>
        <p><strong>Student statuses:</strong> Active, Inactive (suspended/on leave), Graduated, Transferred/Withdrawn.</p>
      `
    },

    /* ─── Admissions ─── */
    {
      id: 'adm-pipeline',
      module: 'admissions',
      title: 'Managing the admissions pipeline',
      roles: ['superadmin','admin'],
      tags: 'admissions pipeline application inquiry interview enroll approve reject stages',
      content: `
        <p>Applications move through stages: <strong>Inquiry → Application → Review → Interview → Decision → Enrolled</strong></p>
        <p><strong>Receiving applications:</strong></p>
        <ul>
          <li><strong>Online form:</strong> Share the public URL (<code>#apply/&lt;token&gt;</code>) with prospective families. They can fill it in without logging in.</li>
          <li><strong>Manual entry:</strong> Click <strong>New Application</strong> to enter details directly.</li>
        </ul>
        <p><strong>Approving and enrolling:</strong></p>
        <ol>
          <li>Click <strong>Approve</strong> on a decision-stage application.</li>
          <li>Assign a class, year group, and optionally a house.</li>
          <li>Click <strong>Enroll</strong> — a student record is created automatically with all application data carried over.</li>
        </ol>
        <p>To reject: click <strong>Reject</strong> and provide a reason. Notify the family via the Communication module.</p>
      `
    },

    /* ─── Classes ─── */
    {
      id: 'cls-manage',
      module: 'classes',
      title: 'Creating and managing classes',
      roles: ['superadmin','admin'],
      tags: 'class add edit delete homeroom teacher section KG primary secondary',
      content: `
        <p>InnoLearn supports four sections: <strong>KG, Primary, Secondary, and A-Level</strong>. Each section contains classes (e.g. Grade 7A).</p>
        <p><strong>To add a class:</strong> Click <strong>+ Add Class</strong>, specify the name, section, and homeroom teacher. Room assignment and capacity are optional but recommended.</p>
        <p>The <strong>homeroom teacher</strong> assigned to a class will see all class students in the Attendance and Behaviour modules.</p>
      `
    },

    /* ─── Timetable ─── */
    {
      id: 'tt-build',
      module: 'timetable',
      title: 'Building the weekly timetable',
      roles: ['superadmin','admin'],
      tags: 'timetable schedule period slot teacher subject clash',
      content: `
        <p>Navigate to <strong>Timetable</strong>. Select a class to view or edit its weekly schedule.</p>
        <ol>
          <li>Click an empty time slot to assign a subject and teacher.</li>
          <li>The system shows a <strong>clash warning</strong> if the selected teacher is already assigned during that slot.</li>
          <li>Use the action bar to print or export the timetable.</li>
        </ol>
      `
    },

    /* ─── Attendance ─── */
    {
      id: 'att-register',
      module: 'attendance',
      title: 'Taking the attendance register',
      roles: ['superadmin','admin','teacher','section_head'],
      tags: 'attendance register present absent late excused mark save class date',
      content: `
        <p>Navigate to <strong>Attendance</strong>. Teachers see only their assigned classes.</p>
        <ol>
          <li>Select your class and date (defaults to today).</li>
          <li>Mark each student: <strong>Present</strong>, <strong>Absent</strong>, <strong>Late</strong>, or <strong>Excused</strong>.</li>
          <li>Click <strong>Save Register</strong>.</li>
        </ol>
        <p><strong>Bulk actions:</strong></p>
        <ul>
          <li><strong>Mark All Present</strong> — one click to mark the whole class present.</li>
          <li><strong>Copy Previous</strong> — pre-fills today's register from yesterday's.</li>
        </ul>
        <p><strong>Absence notifications:</strong> When a student is marked Absent, parents with linked accounts receive an automatic notification.</p>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> Switch to the <strong>Reports</strong> tab in Attendance to view individual student percentages, class summaries, and absence trend charts.</div>
      `
    },

    /* ─── Academics ─── */
    {
      id: 'acad-marks',
      module: 'academics',
      title: 'Entering marks and grades',
      roles: ['superadmin','admin','teacher','section_head'],
      tags: 'academics marks grades gradebook enter subject comment progress report card',
      content: `
        <p>Navigate to <strong>Academics</strong>. Select a class and subject, then enter marks for each student in the marks grid.</p>
        <p>Click <strong>Save</strong> — grades are calculated automatically based on the configured grade boundaries (Cambridge A–U, IB 1–7, or custom percentage).</p>
        <p><strong>Report comments:</strong> Each teacher can add a written comment per student per subject. These appear on the generated report card.</p>
        <p><strong>Progress tab:</strong> Shows a student's grade trajectory across terms. Trends are colour-coded — green for improving, red for declining.</p>
      `
    },

    /* ─── Exams ─── */
    {
      id: 'exam-create',
      module: 'exams',
      title: 'Creating exams and recording results',
      roles: ['superadmin','admin','teacher','section_head'],
      tags: 'exam create schedule invigilator results scores rank average timetable',
      content: `
        <p><strong>To create an exam:</strong></p>
        <ol>
          <li>Navigate to <strong>Exams → + New Exam</strong>.</li>
          <li>Set name, subject, class(es), date, time, and room.</li>
          <li>Assign an invigilator.</li>
          <li>Click <strong>Save</strong>.</li>
        </ol>
        <p><strong>To record results:</strong></p>
        <ol>
          <li>Open the exam and click <strong>Enter Results</strong>.</li>
          <li>Type scores for each student.</li>
          <li>Click <strong>Save</strong> — grade, rank, and class average are calculated automatically.</li>
        </ol>
        <p>The <strong>Timetable</strong> tab shows all scheduled exams in a calendar view. Export as PDF for distribution.</p>
      `
    },

    /* ─── Finance ─── */
    {
      id: 'fin-invoices',
      module: 'finance',
      title: 'Invoices and recording payments',
      roles: ['superadmin','admin','finance'],
      tags: 'finance invoice payment record fee structure term overdue partial paid',
      content: `
        <p><strong>Fee structures</strong> are configured in <strong>Finance → Settings</strong> (admin only): term-based fees by class or section, plus optional extras (transport, lunch, uniform).</p>
        <p><strong>Invoices</strong> are generated automatically when a new term starts (if configured). To create manually: <strong>Finance → Invoices → + New Invoice</strong>.</p>
        <p><strong>To record a payment:</strong></p>
        <ol>
          <li>Open a student's invoice.</li>
          <li>Click <strong>Record Payment</strong>.</li>
          <li>Enter amount, date, and payment method.</li>
          <li>Click <strong>Save</strong> — the invoice status updates automatically (Paid / Partial / Overdue).</li>
        </ol>
        <p>The <strong>Finance Dashboard</strong> shows total expected vs collected this term, collection rate, top outstanding balances, and recent payment activity.</p>
      `
    },

    /* ─── Communication ─── */
    {
      id: 'comm-send',
      module: 'communication',
      title: 'Sending messages and notifications',
      roles: [],
      tags: 'communication message send inbox compose recipient class role notification bell',
      content: `
        <p>Navigate to <strong>Communication → + Compose</strong>.</p>
        <ol>
          <li>Select recipients: individual users, a class, a role group, or everyone.</li>
          <li>Write a subject and body.</li>
          <li>Click <strong>Send</strong>.</li>
        </ol>
        <p><strong>Inbox:</strong> Shows messages sent to you directly, to your role group, or to all users.</p>
        <p><strong>Notifications vs Messages:</strong></p>
        <ul>
          <li><strong>Notifications</strong> (bell icon, top-right): automatic system alerts about attendance, behaviour, and finance events.</li>
          <li><strong>Messages</strong> (Communication module): manually composed messages between users.</li>
        </ul>
      `
    },

    /* ─── Events ─── */
    {
      id: 'evt-add',
      module: 'events',
      title: 'Adding and managing events',
      roles: ['superadmin','admin','teacher','section_head'],
      tags: 'events calendar school class staff add event month week list view',
      content: `
        <p>Navigate to <strong>Events → + New Event</strong>. Set the title, date, time, type, and description, then click <strong>Save</strong>.</p>
        <p><strong>Event types:</strong></p>
        <ul>
          <li><strong>School-wide</strong> — visible to all roles</li>
          <li><strong>Class event</strong> — visible to students and parents in that class</li>
          <li><strong>Staff only</strong> — visible to teachers and above</li>
        </ul>
        <p>Switch between <strong>Month</strong>, <strong>Week</strong>, and <strong>List</strong> views using the view toggle.</p>
      `
    },

    /* ─── Behaviour ─── */
    {
      id: 'beh-overview',
      module: 'behaviour',
      title: 'Behaviour & Pastoral overview',
      roles: ['superadmin','admin','teacher','section_head','deputy_principal','discipline_committee'],
      tags: 'behaviour pastoral merit demerit incident log house cup dashboard stage alert',
      content: `
        <p>The Behaviour module runs a dual merit/demerit system aligned to the SAA Behaviour Points System v2.</p>
        <ul>
          <li><strong>Merits</strong> (positive points): awarded for outstanding behaviour, achievement, leadership.</li>
          <li><strong>Demerits</strong> (negative points): logged for rule-breaking or misconduct.</li>
          <li>Points contribute to the <strong>House Cup</strong> competition.</li>
          <li>Cumulative merit points unlock <strong>Milestone badges</strong> (Bronze, Silver, Gold, Principal's Award, Platinum).</li>
          <li>Cumulative demerit points per half-term trigger <strong>Intervention Stages</strong> (Stage 1–5).</li>
        </ul>
        <p>The dashboard period filter pills (Weekly / Monthly / Termly / All Time) update all panels simultaneously. The Stage Alerts panel and at-risk list always use the rolling half-term window, regardless of the selected period.</p>
      `
    },
    {
      id: 'beh-log',
      module: 'behaviour',
      title: 'Logging a behaviour incident',
      roles: ['superadmin','admin','teacher','section_head','deputy_principal','discipline_committee'],
      tags: 'log incident merit demerit matrix category serious note points submit step',
      content: `
        <p>Click <strong>+ Log Incident</strong> (teachers and above). The modal guides you through three steps:</p>
        <p><strong>Step 1 — Incident Type</strong><br>Select <strong>Merit ⭐</strong> or <strong>Demerit ⚠️</strong>.</p>
        <p><strong>Step 2 — Select Category</strong><br>
        Choose from the category grid. Each card shows the category icon and how many behaviours are available for the type you selected. There are 8 pre-defined SAA BPS v2 categories; your admin may have added more.</p>
        <p><strong>Step 3 — Select Behaviour</strong></p>
        <ul>
          <li><strong>Standard Matrix category</strong> — a filtered list shows only behaviours matching your selected type (merits only, or demerits only). Use the search box or scroll to find the behaviour, then click it.</li>
          <li><strong>Custom category</strong> — no list; the fixed point value is shown automatically.</li>
        </ul>
        <p><strong>Before submitting:</strong></p>
        <ul>
          <li>Use the <strong>Filter by Class</strong> dropdown to narrow the student list to a specific class — helpful when logging for a full class session.</li>
          <li>Select the <strong>Student</strong> and <strong>Date</strong>.</li>
          <li>If the behaviour is worth <strong>5 or more points</strong>, a detailed note is required.</li>
          <li>Add an optional note for context, then click <strong>Log Incident</strong>.</li>
        </ul>
        <p>House points are updated automatically — merit incidents add points to the student's house; demerit incidents subtract them. The House Cup reflects this immediately.</p>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> Changing the type, category, or class filter preserves the date. Changing the class resets the student selection.</div>
      `
    },
    {
      id: 'beh-appeals-student',
      module: 'behaviour',
      title: 'Submitting an appeal (students)',
      roles: ['student'],
      tags: 'appeal demerit submit reason status pending reject accept overturn',
      content: `
        <p>Navigate to <strong>Behaviour → Appeals tab</strong>.</p>
        <p>Under <strong>Demerits Eligible to Appeal</strong>, find the demerit you want to contest. Click <strong>Appeal</strong>, write your reason, and click <strong>Submit Appeal</strong>.</p>
        <p>You can submit one appeal per incident. Once submitted, the incident status changes to <em>Under Appeal</em>. You can track the outcome in your <strong>My Appeals</strong> table.</p>
        <ul>
          <li><strong>Accepted</strong> — the incident is overturned and no longer counts against you.</li>
          <li><strong>Rejected</strong> — the incident is upheld and remains active.</li>
          <li><strong>Escalated</strong> — referred to a disciplinary panel for further review.</li>
        </ul>
      `
    },
    {
      id: 'beh-appeals-parent',
      module: 'behaviour',
      title: 'Supporting a child\'s appeal (parents)',
      roles: ['parent'],
      tags: 'appeal parent note child demerit support pending',
      content: `
        <p>Navigate to <strong>Behaviour → Appeals tab</strong>. You can see your child's pending appeals here.</p>
        <p>Click <strong>Add Note</strong> next to a pending appeal to attach a supporting statement. Staff will see your note when reviewing the appeal.</p>
        <p>You can edit your note any time while the appeal is still pending.</p>
      `
    },
    {
      id: 'beh-appeals-staff',
      module: 'behaviour',
      title: 'Resolving appeals (staff)',
      roles: ['superadmin','admin','teacher','section_head','deputy_principal','discipline_committee'],
      tags: 'appeal review accept reject escalate resolution note staff pending',
      content: `
        <p>Navigate to <strong>Behaviour → Appeals tab</strong>. All pending appeals are listed with the student's reason and any parent note.</p>
        <p>For each appeal you can:</p>
        <ul>
          <li><strong>✓ Accept</strong> — overturn the incident. The incident status changes to <em>Overturned</em> and points are no longer counted.</li>
          <li><strong>✗ Reject</strong> — uphold the incident. It remains active.</li>
          <li><strong>↑ Escalate</strong> (Deputy Principal / Discipline Committee / Admin only) — refer to a panel for further review.</li>
        </ul>
        <p>All actions require a <strong>resolution note</strong> before saving.</p>
      `
    },
    {
      id: 'beh-stages',
      module: 'behaviour',
      title: 'Demerit Intervention Stages',
      roles: ['superadmin','admin','teacher','section_head','deputy_principal','discipline_committee'],
      tags: 'stage demerit intervention threshold half term window pastoral plan parent meeting',
      content: `
        <p>Stages reset every half-term. Thresholds are cumulative demerit points within the rolling half-term window (default: 7 weeks).</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
          <thead>
            <tr style="background:var(--gray-50)">
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)">Stage</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)">Threshold</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)">Responsibility</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Stage 1</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">5 pts</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Class Teacher — Pastoral check-in</td></tr>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Stage 2</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">10 pts</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">KS Coordinator — Behaviour record review</td></tr>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Stage 3</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">20 pts</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Pastoral Lead — Support Plan + Parent meeting</td></tr>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Stage 4</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">35 pts</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">Deputy Principal — Formal referral</td></tr>
            <tr><td style="padding:7px 10px">Stage 5</td><td style="padding:7px 10px">50 pts</td><td style="padding:7px 10px">Principal / Disciplinary Committee</td></tr>
          </tbody>
        </table>
      `
    },
    {
      id: 'beh-milestones',
      module: 'behaviour',
      title: 'Merit Milestones',
      roles: [],
      tags: 'merit milestone badge bronze silver gold principal platinum award cumulative',
      content: `
        <p>Merit milestones are awarded automatically when a student's <strong>cumulative all-time merit points</strong> cross a threshold:</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">
          <thead>
            <tr style="background:var(--gray-50)">
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)">Milestone</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)">Points Required</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">🥉 Bronze Award</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">25 pts</td></tr>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">🥈 Silver Award</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">50 pts</td></tr>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">🥇 Gold Award</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">100 pts</td></tr>
            <tr><td style="padding:7px 10px;border-bottom:1px solid var(--border)">🏅 Principal's Award</td><td style="padding:7px 10px;border-bottom:1px solid var(--border)">200 pts</td></tr>
            <tr><td style="padding:7px 10px">🏆 Platinum Award <em>(KS5 only)</em></td><td style="padding:7px 10px">300 pts</td></tr>
          </tbody>
        </table>
        <p style="margin-top:10px">Parents receive an automatic notification when their child earns a new milestone.</p>
      `
    },
    {
      id: 'beh-report',
      module: 'behaviour',
      title: 'Generating a behaviour PDF report',
      roles: ['superadmin','admin','deputy_principal','discipline_committee','section_head'],
      tags: 'behaviour report pdf print generate house cup patterns stage staff activity',
      content: `
        <p>Click <strong>Report</strong> in the Behaviour page header (visible to staff with appropriate permissions).</p>
        <p>A printable report opens in a new browser window and auto-triggers the print dialog. The report includes:</p>
        <ul>
          <li>Summary stats (5 KPI boxes for the selected period)</li>
          <li>House Cup standings with colour bars</li>
          <li>Stage Alerts table</li>
          <li>Persistent Behaviour Patterns (up to 20 rows)</li>
          <li>Full Student Behaviour Summary</li>
          <li>Staff Activity log</li>
        </ul>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> If nothing happens when you click Report, your browser may have blocked the pop-up. Allow pop-ups for this site and try again.</div>
      `
    },

    /* ─── Finance (parent/student) ─── */
    {
      id: 'fin-parent',
      module: 'finance',
      title: 'Viewing fees and invoices (parents)',
      roles: ['parent'],
      tags: 'fees invoice outstanding payment history balance parent',
      content: `
        <p>Navigate to your child's profile via the Dashboard or Students module, then click the <strong>Finance</strong> tab to see their invoice history and payment status.</p>
        <p>You will receive automatic notifications when a new invoice is generated or when a balance becomes overdue.</p>
      `
    },

    /* ─── Reports ─── */
    {
      id: 'rep-generate',
      module: 'reports',
      title: 'Generating reports and analytics',
      roles: ['superadmin','admin','finance','section_head','deputy_principal'],
      tags: 'report analytics attendance academic behaviour finance admissions pdf csv export generate',
      content: `
        <p>Navigate to <strong>Reports</strong>. Available report types:</p>
        <ul>
          <li><strong>Attendance Report</strong> — class or school-wide, by date range</li>
          <li><strong>Academic Report</strong> — grade distribution, subject averages, top performers</li>
          <li><strong>Behaviour Report</strong> — incidents by type, house standings, at-risk students</li>
          <li><strong>Finance Report</strong> — collection summary, outstanding balances, payment trends</li>
          <li><strong>Admissions Report</strong> — pipeline conversion rates, source analysis</li>
        </ul>
        <p><strong>To generate a report:</strong></p>
        <ol>
          <li>Select the report type.</li>
          <li>Set filters (date range, class, section).</li>
          <li>Click <strong>Generate</strong>.</li>
          <li>Export as <strong>PDF</strong> or <strong>CSV</strong>.</li>
        </ol>
        <p><strong>Report cards</strong> are generated from <strong>Academics → Report Cards</strong>. Each card includes subject grades, teacher comments, attendance summary, behaviour summary, and the principal's comment.</p>
      `
    },

    /* ─── HR ─── */
    {
      id: 'hr-staff',
      module: 'hr',
      title: 'Managing staff records',
      roles: ['superadmin','admin'],
      tags: 'staff hr add profile employment type department subject homeroom contract',
      content: `
        <p>Navigate to <strong>HR & Staff</strong>. View all teaching and non-teaching staff with their role, department, and employment status.</p>
        <p><strong>To add a staff member:</strong> Click <strong>+ Add Staff Member</strong>. A user account is also created automatically with the appropriate role(s).</p>
        <p><strong>Staff profile includes:</strong></p>
        <ul>
          <li>Personal and contact details</li>
          <li>Employment type (full-time / part-time / contract)</li>
          <li>Subject assignments and homeroom class</li>
          <li>Emergency contact</li>
        </ul>
      `
    },

    /* ─── Settings ─── */
    {
      id: 'set-overview',
      module: 'settings',
      title: 'Settings overview (admin only)',
      roles: ['superadmin','admin'],
      tags: 'settings school profile academic year term permissions role behaviour matrix house detention key stage',
      content: `
        <p>Navigate to <strong>Settings</strong> (admin/superadmin only). Available sections:</p>
        <ul>
          <li><strong>School Profile</strong> — update school name, logo, address, and contact details.</li>
          <li><strong>Academic Year & Terms</strong> — configure year dates, term boundaries, and set the active term. The active term drives all default date filtering across Academics, Behaviour, Finance, and Reports.</li>
          <li><strong>Role Permissions</strong> — fine-grained control over what each role can see and do, with sub-module granularity.</li>
          <li><strong>Behaviour Settings</strong> — sub-tabs for Behaviour Matrix (read-only browser), Custom Categories, Milestones, Demerit Stages, Houses, Key Stages, and Detention Types.</li>
        </ul>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> The standard SAA BPS v2 matrix items are locked and cannot be edited. You can add your own school-specific categories via <strong>Custom Categories</strong>.</div>
      `
    },
    {
      id: 'set-audit',
      module: 'settings',
      title: 'Audit log — tracking critical changes',
      roles: ['superadmin','admin'],
      tags: 'audit log changes history student payment appeal permission academic year security',
      content: `
        <p>InnoLearn automatically records every critical data change in an internal <strong>audit log</strong>. This happens silently in the background — staff do not need to do anything.</p>
        <p><strong>What is logged:</strong></p>
        <ul>
          <li>Student profile edits (including class moves, status changes, house changes)</li>
          <li>Student deletions</li>
          <li>Every payment recorded against an invoice</li>
          <li>Every behaviour appeal resolution (accepted, rejected, or escalated)</li>
          <li>Changes to the current active academic year</li>
          <li>Every role permission checkbox toggle in Settings → Role Permissions</li>
        </ul>
        <p>Each entry records: who made the change, when, and what changed. The log can be queried by developers via <code>DB.query('audit_log', ...)</code> in the browser console.</p>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Note:</strong> The audit log persists in the browser and is included in the full JSON backup (Settings → Export All Data).</div>
      `
    },
    {
      id: 'set-export',
      module: 'settings',
      title: 'Exporting and backing up data',
      roles: ['superadmin','admin'],
      tags: 'export backup data download json settings restore',
      content: `
        <p>Navigate to <strong>Settings → System → Export All Data</strong>. A full JSON backup of every data collection is downloaded to your device.</p>
        <ul>
          <li>The export includes <em>all</em> collections automatically — students, classes, behaviour records, finance, admissions, etc.</li>
          <li>The file is named <code>InnoLearn-backup-YYYY-MM-DD.json</code>.</li>
          <li>Keep a regular backup especially before any major configuration change or before advancing to a new academic year.</li>
        </ul>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Important:</strong> InnoLearn stores all data in your browser. Clearing browser data or switching computers will remove all records — the exported JSON is your only backup.</div>
      `
    },
    {
      id: 'set-delete-guards',
      module: 'settings',
      title: 'Why can\'t I delete this record?',
      roles: ['superadmin','admin'],
      tags: 'delete blocked guard subject user class student timetable error',
      content: `
        <p>InnoLearn prevents you from deleting records that other data depends on. This protects data integrity across the system.</p>
        <p><strong>Common blocks and how to resolve them:</strong></p>
        <ul>
          <li><strong>Cannot delete a subject</strong> — the subject is used in the timetable, assigned to a class, or has grade records. Remove timetable slots and class assignments first, then delete grade records if needed.</li>
          <li><strong>Cannot delete a user account</strong> — the user is a homeroom teacher for a class, is assigned to timetable slots, or has a linked student profile. Reassign the class, clear timetable slots, or delete the student profile first.</li>
          <li><strong>Cannot delete a student</strong> — the student has open behaviour appeals or unpaid invoices. Resolve all appeals and settle outstanding fees first.</li>
          <li><strong>Cannot delete a class</strong> — students are still enrolled in it, or it has timetable entries. Move students to another class and clear the timetable first.</li>
          <li><strong>Cannot delete an academic year</strong> — it is set as the current year, or classes are linked to it.</li>
        </ul>
        <div class="help-tip"><i class="fas fa-lightbulb"></i> <strong>Tip:</strong> If you only want to remove a user from the system temporarily, use <strong>Deactivate</strong> instead of Delete. Deactivated users cannot log in but their records and history are preserved.</div>
      `
    },
  ];

  /* ── Module metadata for badges ──────────────────────── */
  const MODULE_META = {
    general:       { label:'General',           color:'var(--gray-600)',    icon:'fas fa-info-circle' },
    students:      { label:'Students',          color:'#2563EB',            icon:'fas fa-user-graduate' },
    admissions:    { label:'Admissions',        color:'#7C3AED',            icon:'fas fa-file-import' },
    classes:       { label:'Classes',           color:'#059669',            icon:'fas fa-door-open' },
    timetable:     { label:'Timetable',         color:'#0891B2',            icon:'fas fa-calendar-alt' },
    attendance:    { label:'Attendance',        color:'#D97706',            icon:'fas fa-clipboard-check' },
    academics:     { label:'Academics',         color:'#7C3AED',            icon:'fas fa-graduation-cap' },
    exams:         { label:'Exams',             color:'#DC2626',            icon:'fas fa-file-alt' },
    finance:       { label:'Finance',           color:'#059669',            icon:'fas fa-coins' },
    communication: { label:'Communication',     color:'#2563EB',            icon:'fas fa-comment-dots' },
    events:        { label:'Events',            color:'#D97706',            icon:'fas fa-calendar' },
    behaviour:     { label:'Behaviour',         color:'#DC2626',            icon:'fas fa-shield-alt' },
    reports:       { label:'Reports',           color:'#0891B2',            icon:'fas fa-chart-bar' },
    hr:            { label:'HR & Staff',        color:'#64748B',            icon:'fas fa-id-card' },
    settings:      { label:'Settings',          color:'#374151',            icon:'fas fa-cog' },
  };

  /* ── Helpers ──────────────────────────────────────────── */
  function _visibleArticles() {
    const role = Auth.currentUser ? Auth.currentUser.role : null;
    return ARTICLES.filter(a => a.roles.length === 0 || (role && a.roles.includes(role)));
  }

  function _filteredArticles() {
    const all = _visibleArticles();
    if (!_search || _search.length < 2) return all;
    const q = _search.toLowerCase();
    return all.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.tags.toLowerCase().includes(q) ||
      a.content.toLowerCase().replace(/<[^>]+>/g,'').includes(q)
    );
  }

  function _moduleBadge(mod) {
    const m = MODULE_META[mod] || MODULE_META.general;
    return `<span class="help-badge" style="background:${m.color}20;color:${m.color};border:1px solid ${m.color}40">
      <i class="${m.icon}" style="font-size:10px"></i> ${m.label}
    </span>`;
  }

  /* ── Render ───────────────────────────────────────────── */
  function render() {
    if (!Auth.currentUser) { App.navigate('dashboard'); return; }
    App.setBreadcrumb('Help Centre');
    _search = '';
    _draw();
  }

  function _draw() {
    const articles = _filteredArticles();

    /* Group by module */
    const grouped = {};
    articles.forEach(a => {
      if (!grouped[a.module]) grouped[a.module] = [];
      grouped[a.module].push(a);
    });

    const noResults = articles.length === 0;

    const listHtml = noResults
      ? `<div class="empty-state" style="padding:48px 0">
           <i class="fas fa-search" style="font-size:36px;color:var(--gray-300);margin-bottom:12px;display:block"></i>
           <h3 style="color:var(--gray-500)">No results for "${_search}"</h3>
           <p style="color:var(--gray-400)">Try a different keyword or <a href="#" onclick="Help.clearSearch();return false">clear the search</a>.</p>
         </div>`
      : Object.keys(grouped).map(mod => {
          const meta = MODULE_META[mod] || MODULE_META.general;
          return `
            <div class="help-group" id="hg-${mod}">
              <div class="help-group-header">
                <i class="${meta.icon}" style="color:${meta.color}"></i>
                <span>${meta.label}</span>
              </div>
              ${grouped[mod].map(a => `
                <div class="help-article-card" id="ha-${a.id}" onclick="Help.openArticle('${a.id}')">
                  <div class="help-article-title">${a.title}</div>
                  ${_moduleBadge(a.module)}
                </div>
              `).join('')}
            </div>
          `;
        }).join('');

    App.renderPage(`
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fas fa-question-circle"></i> Help Centre</h1>
          <p class="page-subtitle">Guides and reference for every module — filtered to your role.</p>
        </div>
      </div>

      <style>
        .help-search-wrap {
          max-width: 520px;
          position: relative;
          margin-bottom: 28px;
        }
        .help-search-wrap i {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--gray-400);
          font-size: 14px;
          pointer-events: none;
        }
        .help-search-wrap input {
          width: 100%;
          padding: 10px 14px 10px 40px;
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 14px;
          background: var(--white);
          outline: none;
          transition: border-color .2s, box-shadow .2s;
        }
        .help-search-wrap input:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(37,99,235,.1);
        }

        .help-layout {
          display: flex;
          gap: 24px;
          align-items: flex-start;
        }

        .help-list { flex: 1; min-width: 0; }

        .help-group { margin-bottom: 28px; }
        .help-group-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .6px;
          color: var(--gray-500);
          margin-bottom: 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }

        .help-article-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 8px;
          cursor: pointer;
          background: var(--white);
          transition: border-color .15s, box-shadow .15s, background .15s;
          gap: 12px;
        }
        .help-article-card:hover {
          border-color: var(--primary);
          box-shadow: 0 2px 8px rgba(37,99,235,.1);
          background: #f8faff;
        }

        .help-article-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--gray-800);
          flex: 1;
        }

        .help-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 12px;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* Article drawer */
        .help-drawer {
          width: 460px;
          flex-shrink: 0;
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 24px;
          position: sticky;
          top: 20px;
        }

        .help-drawer-close {
          float: right;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--gray-400);
          font-size: 16px;
          padding: 0;
          line-height: 1;
        }
        .help-drawer-close:hover { color: var(--gray-700); }

        .help-drawer-tag {
          margin-bottom: 12px;
        }

        .help-drawer h2 {
          font-size: 17px;
          font-weight: 700;
          color: var(--gray-900);
          margin: 0 0 16px;
          line-height: 1.4;
          clear: both;
        }

        .help-drawer-content {
          font-size: 14px;
          color: var(--gray-700);
          line-height: 1.6;
        }
        .help-drawer-content p { margin: 0 0 10px; }
        .help-drawer-content ul, .help-drawer-content ol {
          margin: 0 0 10px;
          padding-left: 20px;
        }
        .help-drawer-content li { margin-bottom: 5px; }
        .help-drawer-content code {
          background: var(--gray-100);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 5px;
          font-size: 12px;
          color: var(--primary);
          font-family: 'Courier New', monospace;
        }
        .help-drawer-content table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          margin-top: 8px;
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
        }
        .help-drawer-content th, .help-drawer-content td {
          text-align: left;
          padding: 8px 10px;
          border-bottom: 1px solid var(--border);
        }
        .help-drawer-content th { background: var(--gray-50); font-weight: 600; }

        .help-tip {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          color: #1e40af;
          margin-top: 10px;
          line-height: 1.5;
        }
        .help-tip i { margin-right: 6px; }

        .help-empty-drawer {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          color: var(--gray-400);
          text-align: center;
        }
        .help-empty-drawer i { font-size: 36px; margin-bottom: 12px; display: block; }
        .help-empty-drawer p { font-size: 13px; }

        @media (max-width: 900px) {
          .help-layout { flex-direction: column; }
          .help-drawer { width: 100%; position: static; }
        }
      </style>

      <div class="help-search-wrap">
        <i class="fas fa-search"></i>
        <input type="text" id="help-search" placeholder="Search help articles…"
          value="${_search}"
          oninput="Help.onSearch(this.value)">
      </div>

      <div class="help-layout">
        <div class="help-list" id="help-list">
          ${listHtml}
        </div>
        <div class="help-drawer" id="help-drawer">
          <div class="help-empty-drawer">
            <i class="fas fa-book-open"></i>
            <p>Select an article from the list to read it here.</p>
          </div>
        </div>
      </div>
    `);
  }

  function openArticle(id) {
    const a = ARTICLES.find(x => x.id === id);
    if (!a) return;

    /* Highlight selected card */
    document.querySelectorAll('.help-article-card').forEach(el => el.classList.remove('selected'));
    const card = document.getElementById(`ha-${id}`);
    if (card) {
      card.classList.add('selected');
      card.style.borderColor = 'var(--primary)';
      card.style.background  = '#f8faff';
    }

    const drawer = document.getElementById('help-drawer');
    if (!drawer) return;

    const meta = MODULE_META[a.module] || MODULE_META.general;

    drawer.innerHTML = `
      <button class="help-drawer-close" onclick="Help.closeDrawer()"><i class="fas fa-times"></i></button>
      <div class="help-drawer-tag">${_moduleBadge(a.module)}</div>
      <h2>${a.title}</h2>
      <div class="help-drawer-content">${a.content}</div>
    `;

    /* On mobile, scroll drawer into view */
    if (window.innerWidth <= 900) {
      drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeDrawer() {
    document.querySelectorAll('.help-article-card').forEach(el => {
      el.classList.remove('selected');
      el.style.borderColor = '';
      el.style.background  = '';
    });
    const drawer = document.getElementById('help-drawer');
    if (drawer) {
      drawer.innerHTML = `
        <div class="help-empty-drawer">
          <i class="fas fa-book-open"></i>
          <p>Select an article from the list to read it here.</p>
        </div>
      `;
    }
  }

  function onSearch(val) {
    _search = val;
    const list = document.getElementById('help-list');
    if (!list) return;

    const articles = _filteredArticles();
    const grouped  = {};
    articles.forEach(a => {
      if (!grouped[a.module]) grouped[a.module] = [];
      grouped[a.module].push(a);
    });

    const noResults = articles.length === 0;

    list.innerHTML = noResults
      ? `<div class="empty-state" style="padding:48px 0">
           <i class="fas fa-search" style="font-size:36px;color:var(--gray-300);margin-bottom:12px;display:block"></i>
           <h3 style="color:var(--gray-500)">No results for "${_search}"</h3>
           <p style="color:var(--gray-400)">Try a different keyword or <a href="#" onclick="Help.clearSearch();return false">clear the search</a>.</p>
         </div>`
      : Object.keys(grouped).map(mod => {
          const meta = MODULE_META[mod] || MODULE_META.general;
          return `
            <div class="help-group" id="hg-${mod}">
              <div class="help-group-header">
                <i class="${meta.icon}" style="color:${meta.color}"></i>
                <span>${meta.label}</span>
              </div>
              ${grouped[mod].map(a => `
                <div class="help-article-card" id="ha-${a.id}" onclick="Help.openArticle('${a.id}')">
                  <div class="help-article-title">${a.title}</div>
                  ${_moduleBadge(a.module)}
                </div>
              `).join('')}
            </div>
          `;
        }).join('');
  }

  function clearSearch() {
    _search = '';
    const inp = document.getElementById('help-search');
    if (inp) inp.value = '';
    onSearch('');
  }

  return { render, openArticle, closeDrawer, onSearch, clearSearch };
})();
