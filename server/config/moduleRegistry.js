/* ============================================================
   MODULE REGISTRY — Single source of truth for all system modules.

   This file is the authoritative list of every permissioned module
   in the platform.  Every other place that needs a module list
   (onboard, settings, repairPermissions, R&P UI) imports from here.

   Adding a module:  add one entry below, redeploy — it appears
   automatically in Settings → Roles & Permissions with no other
   changes required anywhere else.

   Removing a module: delete the entry — it disappears from R&P
   and from the auto-sync on next deploy.  Existing stored permissions
   for that key are preserved (harmless orphans) but never checked.

   Structure of each entry:
     key       — matches the key used in role_permissions collection
                  and in the Sidebar's moduleConfig list
     label     — human-readable name shown in R&P UI
     section   — grouping header: 'Academic Management' | 'Student Services' |
                  'Operations' | 'Communication' | 'Analytics' | 'Administration'
     subs      — array of { key, label } defining the checkbox rows in R&P
                 sub.key is stored as `${mod.key}__${sub.key}` in modulePermissions

   Optional nav metadata (present only on entries with their own Sidebar
   nav item — 24 of the 28 entries; analytics/settings and the
   exams/assessment pair have no `navRoute` and are excluded from nav
   generation, exactly matching pre-existing Sidebar behaviour):
     icon        — lucide-react export name (string, not a component — this
                   file is plain Node/CommonJS with no JSX) resolved client-side
                   via client/src/config/moduleNav.js's NAV_ICON_MAP
     navRoute    — the Sidebar route path; entries WITHOUT this field render
                   no nav item at all (or share another entry's, see navGroupKey)
     navLabel    — nav-specific label when it must differ from the R&P `label`
                   (e.g. 'grades'/'Grades & Marks' shows as 'Exams' in the nav);
                   omit when it's identical to `label`
     navOrder    — default nav position (0-based) for schools with no custom
                   moduleConfig order; presentation-only, mirrors the exact
                   order Sidebar.jsx used before this file became the source
     navGroupKey — set on permission-only entries (exams, assessment) that
                   share another entry's single nav item instead of having
                   their own; not yet consumed by any generation code, kept
                   as documentation of the relationship

   See client/src/config/moduleNav.js for how the client turns this into
   the actual Sidebar module list (deriveNavModules()).
   ============================================================ */
'use strict';

const MODULE_REGISTRY = [
  /* ── Academic ─────────────────────────────────────────── */
  { key: 'students', label: 'Students', section: 'Academic Management', icon: 'GraduationCap', navRoute: '/students', navOrder: 0, subs: [
    { key: 'list',    label: 'View Student List' },
    { key: 'profile', label: 'View Student Profile' },
    { key: 'create',  label: 'Add Student' },
    { key: 'edit',    label: 'Edit Student' },
    { key: 'delete',  label: 'Delete Student' },
    { key: 'export',  label: 'Export Students (CSV)' },
    { key: 'import',  label: 'Import Students (CSV)' },
  ]},
  { key: 'teachers', label: 'Teachers', section: 'Academic Management', icon: 'Users', navRoute: '/teachers', navOrder: 1, subs: [
    { key: 'list',   label: 'View Teacher List' },
    { key: 'detail', label: 'View Teacher Profile' },
    { key: 'create', label: 'Add Teacher' },
    { key: 'edit',   label: 'Edit Teacher' },
    { key: 'delete', label: 'Delete Teacher' },
    { key: 'export', label: 'Export Teachers (CSV)' },
    { key: 'import', label: 'Import Teachers (CSV)' },
  ]},
  { key: 'classes', label: 'Classes & Streams', section: 'Academic Management', icon: 'BookOpen', navRoute: '/classes', navLabel: 'Classes', navOrder: 2, subs: [
    { key: 'view',    label: 'View Classes' },
    { key: 'create',  label: 'Create Class' },
    { key: 'edit',    label: 'Edit Class' },
    { key: 'delete',  label: 'Delete Class' },
    { key: 'export',  label: 'Export Classes (CSV)' },
    { key: 'import',  label: 'Import Classes (CSV)' },
    { key: 'section', label: 'Manage Sections & Streams' },
  ]},
  { key: 'attendance', label: 'Attendance', section: 'Academic Management', icon: 'CheckSquare', navRoute: '/attendance', navOrder: 4, subs: [
    { key: 'view',   label: 'View Register' },
    { key: 'mark',   label: 'Mark Attendance' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'export', label: 'Export / Print Register' },
  ]},
  { key: 'timetable', label: 'Timetable', section: 'Academic Management', icon: 'Calendar', navRoute: '/timetable', navOrder: 3, subs: [
    { key: 'view',          label: 'View Timetable' },
    { key: 'edit',          label: 'Edit Timetable' },
    { key: 'rooms',         label: 'Manage Rooms' },
    { key: 'bell_schedule', label: 'Configure Bell Schedule' },
    { key: 'assignments',   label: 'Manage Teaching Assignments' },
    { key: 'import',        label: 'Import Timetable (CSV)' },
    { key: 'export',        label: 'Export Timetable (CSV)' },
  ]},
  { key: 'subjects', label: 'Subjects', section: 'Academic Management', icon: 'Library', navRoute: '/subjects', navOrder: 7, subs: [
    { key: 'view',   label: 'View Subjects & Departments' },
    { key: 'create', label: 'Create Subject / Department' },
    { key: 'edit',   label: 'Edit Subject' },
    { key: 'delete', label: 'Delete Subject' },
  ]},
  { key: 'lessons', label: 'Lessons', section: 'Academic Management', icon: 'BookCheck', navRoute: '/lessons', navOrder: 14, subs: [
    { key: 'view',     label: 'View Lesson Plans' },
    { key: 'create',   label: 'Create Lesson Plan' },
    { key: 'edit',     label: 'Edit Lesson Plan' },
    { key: 'delete',   label: 'Delete Lesson Plan' },
    { key: 'coverage', label: 'Mark Lesson Coverage' },
  ]},
  { key: 'grades', label: 'Grades & Marks', section: 'Academic Management', icon: 'FileText', navRoute: '/exams', navLabel: 'Exams', navOrder: 5, subs: [
    { key: 'view_grades',      label: 'View Grades & Marks' },
    { key: 'enter_marks',      label: 'Enter / Edit Marks' },
    { key: 'mark_submissions', label: 'Review / Approve Mark Submissions' },
    { key: 'comment_banks',    label: 'Manage Comment Banks' },
    { key: 'report_generate',  label: 'Generate / Publish Report Cards' },
    { key: 'export',           label: 'Export Grades (CSV)' },
  ]},
  { key: 'exams', label: 'Exams', section: 'Academic Management', navGroupKey: 'grades', subs: [
    { key: 'view',    label: 'View Exams & Results' },
    { key: 'create',  label: 'Create / Edit Exam' },
    { key: 'lock',    label: 'Lock / Unlock Exam' },
    { key: 'results', label: 'Enter Exam Results' },
    { key: 'delete',  label: 'Delete Exam' },
  ]},
  { key: 'assessment', label: 'Assessment Scheduling', section: 'Academic Management', navGroupKey: 'grades', subs: [
    { key: 'lock', label: 'Lock / Unlock Assessment Schedule' },
  ]},
  { key: 'report_cards', label: 'Report Card Settings', section: 'Academic Management', icon: 'FileBarChart2', navRoute: '/report-cards', navLabel: 'Report Cards', navOrder: 6, subs: [
    { key: 'draft_comments',      label: 'Manage Draft Comments' },
    { key: 'workflow',            label: 'Configure Approval Workflow' },
    { key: 'publication_policy',  label: 'Configure Publication Policy' },
  ]},
  { key: 'elearning', label: 'eLearning', section: 'Academic Management', icon: 'MonitorPlay', navRoute: '/elearning', navOrder: 15, subs: [
    { key: 'view',   label: 'View Courses & Resources' },
    { key: 'create', label: 'Create / Upload Content' },
    { key: 'edit',   label: 'Edit Content' },
    { key: 'delete', label: 'Delete Content' },
    { key: 'enroll', label: 'Enroll Students' },
  ]},

  /* ── Operations ───────────────────────────────────────── */
  { key: 'admissions', label: 'Admissions', section: 'Student Services', icon: 'ClipboardList', navRoute: '/admissions', navOrder: 8, subs: [
    { key: 'view',   label: 'View Pipeline' },
    { key: 'create', label: 'Add Applicant' },
    { key: 'edit',   label: 'Edit Applicant Details' },
    { key: 'move',   label: 'Move Pipeline Stage' },
    { key: 'delete', label: 'Delete Applicant' },
    { key: 'export', label: 'Export Applicants (CSV)' },
  ]},
  { key: 'behaviour', label: 'Behaviour (BPS)', section: 'Student Services', icon: 'Scale', navRoute: '/behaviour', navLabel: 'Behaviour', navOrder: 9, subs: [
    { key: 'view',   label: 'View Incidents & BPS' },
    { key: 'create', label: 'Record Incident / Award Points' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'delete', label: 'Delete Records' },
  ]},
  { key: 'finance', label: 'Finance', section: 'Operations', icon: 'Wallet', navRoute: '/finance', navOrder: 10, subs: [
    { key: 'invoices',       label: 'View Invoices' },
    { key: 'create_invoice', label: 'Create Invoice' },
    { key: 'void_invoice',   label: 'Void Invoice' },
    { key: 'payments',       label: 'View Payments' },
    { key: 'record_payment', label: 'Record Payment' },
    { key: 'print',          label: 'Print Receipts / Invoices' },
    { key: 'fee_structure',  label: 'Manage Fee Structures' },
    { key: 'import',         label: 'Import Finance Data (CSV)' },
    { key: 'mpesa',          label: 'Configure M-Pesa Integration' },
  ]},
  { key: 'messages', label: 'Messages', section: 'Communication', icon: 'MessageSquare', navRoute: '/messages', navOrder: 11, subs: [
    { key: 'view',   label: 'View Messages' },
    { key: 'send',   label: 'Send Messages' },
    { key: 'delete', label: 'Delete Messages' },
  ]},
  { key: 'events', label: 'Events & Calendar', section: 'Communication', icon: 'Calendar', navRoute: '/events', navLabel: 'Events', navOrder: 12, subs: [
    { key: 'view',   label: 'View Events' },
    { key: 'create', label: 'Create Event' },
    { key: 'edit',   label: 'Edit Event' },
    { key: 'delete', label: 'Delete Event' },
    { key: 'export', label: 'Export Events (CSV)' },
  ]},
  { key: 'hr', label: 'HR & Payroll', section: 'Operations', icon: 'UserCog', navRoute: '/hr', navLabel: 'HR & Staff', navOrder: 13, subs: [
    { key: 'staff',          label: 'View Staff Records' },
    { key: 'leave_view',     label: 'View Leave Requests' },
    { key: 'leave_approve',  label: 'Approve / Reject Leave' },
    { key: 'payroll_view',   label: 'View Payroll' },
    { key: 'payroll_export', label: 'Export Payroll (CSV)' },
    { key: 'documents',      label: 'Manage Staff Documents' },
  ]},
  { key: 'resources', label: 'Resources', section: 'Communication', icon: 'Link2', navRoute: '/resources', navOrder: 17, subs: [
    { key: 'read',   label: 'View Resources' },
    { key: 'create', label: 'Share a Resource' },
    { key: 'update', label: 'Edit a Resource' },
    { key: 'delete', label: 'Delete a Resource' },
  ]},
  { key: 'library', label: 'Library', section: 'Operations', icon: 'BookMarked', navRoute: '/library', navOrder: 16, subs: [
    { key: 'view',     label: 'View Catalogue & Records' },
    { key: 'issue',    label: 'Issue / Return Books' },
    { key: 'manage',   label: 'Add / Edit Catalogue Items' },
    { key: 'delete',   label: 'Delete Catalogue Items' },
    { key: 'reports',  label: 'View Library Reports' },
  ]},
  { key: 'transport', label: 'Transport', section: 'Operations', icon: 'Bus', navRoute: '/transport', navOrder: 18, subs: [
    { key: 'view',     label: 'View Routes & Vehicles' },
    { key: 'manage',   label: 'Add / Edit Routes & Stops' },
    { key: 'assign',   label: 'Assign Students to Routes' },
    { key: 'delete',   label: 'Delete Routes / Vehicles' },
  ]},
  { key: 'hostel', label: 'Hostel', section: 'Student Services', icon: 'BedDouble', navRoute: '/hostel', navOrder: 19, subs: [
    { key: 'view',     label: 'View Rooms & Allocations' },
    { key: 'manage',   label: 'Add / Edit Rooms & Blocks' },
    { key: 'assign',   label: 'Assign Students to Rooms' },
    { key: 'delete',   label: 'Delete Rooms / Blocks' },
  ]},
  { key: 'medical', label: 'Medical Centre', section: 'Student Services', icon: 'HeartPulse', navRoute: '/medical', navOrder: 20, subs: [
    { key: 'view',    label: 'View Clinic Visits' },
    { key: 'record',  label: 'Record Clinic Visit' },
    { key: 'delete',  label: 'Delete Clinic Visit' },
    { key: 'alerts',  label: 'View Medical Alerts (condition flags only, not full profile)' },
    { key: 'reports', label: 'View Medical Reports' },
  ]},
  { key: 'inventory', label: 'Inventory', section: 'Operations', icon: 'Boxes', navRoute: '/inventory', navOrder: 21, subs: [
    { key: 'view',        label: 'View Inventory & Categories' },
    { key: 'manage',      label: 'Add / Edit Items & Categories' },
    { key: 'transact',    label: 'Record Stock Transactions (Receive/Issue/Return/Adjust)' },
    { key: 'requisition', label: 'Raise Requisitions' },
    { key: 'workflow',    label: 'Configure Requisition Approval Workflow' },
  ]},

  { key: 'growth_profile', label: 'Growth Profile', section: 'Student Services', icon: 'Sprout', navRoute: '/growth-profile', navOrder: 10, subs: [
    { key: 'view',            label: 'View Growth Profiles' },
    { key: 'add_records',     label: 'Add Records (Leadership / Activities / Service / Awards)' },
    { key: 'edit_records',    label: 'Edit Own Records' },
    { key: 'delete_records',  label: 'Delete Records' },
    { key: 'projects',        label: 'Add / Edit Projects' },
    { key: 'recommendations', label: 'Write Recommendations' },
    { key: 'aspirations',     label: 'Edit Aspirations' },
    { key: 'verify',          label: 'Verify / Approve Records' },
  ]},
  { key: 'reports', label: 'Reports & Analytics', section: 'Analytics', icon: 'TrendingUp', navRoute: '/reports', navOrder: 22, subs: [
    { key: 'view',   label: 'View Reports' },
    { key: 'export', label: 'Export Reports (CSV)' },
  ]},
  { key: 'analytics', label: 'Analytics Dashboard', section: 'Analytics', subs: [
    { key: 'view', label: 'View Leadership Analytics' },
  ]},

  /* ── System ───────────────────────────────────────────── */
  { key: 'settings', label: 'Settings', section: 'Administration', subs: [
    { key: 'school',      label: 'Edit School Settings' },
    { key: 'users',       label: 'Manage Users / Invites' },
    { key: 'permissions', label: 'Manage Roles & Permissions' },
    { key: 'system',      label: 'View System Info' },
  ]},
];

/* Convenience: flat list of module keys — used by permission helpers */
const MODULE_KEYS = MODULE_REGISTRY.map(m => m.key);

module.exports = { MODULE_REGISTRY, MODULE_KEYS };
