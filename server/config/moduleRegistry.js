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
     key     — matches the key used in role_permissions collection
                and in the Sidebar's moduleConfig list
     label   — human-readable name shown in R&P UI
     section — grouping header: 'Academic' | 'Operations' | 'Insights' | 'System'
     subs    — array of { key, label } defining the checkbox rows in R&P
               sub.key is stored as `${mod.key}__${sub.key}` in modulePermissions
   ============================================================ */
'use strict';

const MODULE_REGISTRY = [
  /* ── Academic ─────────────────────────────────────────── */
  { key: 'students', label: 'Students', section: 'Academic', subs: [
    { key: 'list',    label: 'View Student List' },
    { key: 'profile', label: 'View Student Profile' },
    { key: 'create',  label: 'Add Student' },
    { key: 'edit',    label: 'Edit Student' },
    { key: 'delete',  label: 'Delete Student' },
    { key: 'export',  label: 'Export Students (CSV)' },
    { key: 'import',  label: 'Import Students (CSV)' },
  ]},
  { key: 'teachers', label: 'Teachers', section: 'Academic', subs: [
    { key: 'list',   label: 'View Teacher List' },
    { key: 'detail', label: 'View Teacher Profile' },
    { key: 'create', label: 'Add Teacher' },
    { key: 'edit',   label: 'Edit Teacher' },
    { key: 'delete', label: 'Delete Teacher' },
    { key: 'export', label: 'Export Teachers (CSV)' },
    { key: 'import', label: 'Import Teachers (CSV)' },
  ]},
  { key: 'classes', label: 'Classes & Streams', section: 'Academic', subs: [
    { key: 'view',    label: 'View Classes' },
    { key: 'create',  label: 'Create Class' },
    { key: 'edit',    label: 'Edit Class' },
    { key: 'delete',  label: 'Delete Class' },
    { key: 'export',  label: 'Export Classes (CSV)' },
    { key: 'import',  label: 'Import Classes (CSV)' },
    { key: 'section', label: 'Manage Sections & Streams' },
  ]},
  { key: 'attendance', label: 'Attendance', section: 'Academic', subs: [
    { key: 'view',   label: 'View Register' },
    { key: 'mark',   label: 'Mark Attendance' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'export', label: 'Export / Print Register' },
  ]},
  { key: 'timetable', label: 'Timetable', section: 'Academic', subs: [
    { key: 'view',          label: 'View Timetable' },
    { key: 'edit',          label: 'Edit Timetable' },
    { key: 'rooms',         label: 'Manage Rooms' },
    { key: 'bell_schedule', label: 'Configure Bell Schedule' },
    { key: 'assignments',   label: 'Manage Teaching Assignments' },
    { key: 'import',        label: 'Import Timetable (CSV)' },
    { key: 'export',        label: 'Export Timetable (CSV)' },
  ]},
  { key: 'subjects', label: 'Subjects', section: 'Academic', subs: [
    { key: 'view',   label: 'View Subjects & Departments' },
    { key: 'create', label: 'Create Subject / Department' },
    { key: 'edit',   label: 'Edit Subject' },
    { key: 'delete', label: 'Delete Subject' },
  ]},
  { key: 'lessons', label: 'Lessons', section: 'Academic', subs: [
    { key: 'view',     label: 'View Lesson Plans' },
    { key: 'create',   label: 'Create Lesson Plan' },
    { key: 'edit',     label: 'Edit Lesson Plan' },
    { key: 'delete',   label: 'Delete Lesson Plan' },
    { key: 'coverage', label: 'Mark Lesson Coverage' },
  ]},
  { key: 'grades', label: 'Grades & Exams', section: 'Academic', subs: [
    { key: 'view_grades',  label: 'View Grades' },
    { key: 'enter_marks',  label: 'Enter / Edit Marks' },
    { key: 'view_exams',   label: 'View Exams' },
    { key: 'create_exam',  label: 'Create / Edit Exam' },
    { key: 'export',       label: 'Export Grades (CSV)' },
  ]},
  { key: 'elearning', label: 'eLearning', section: 'Academic', subs: [
    { key: 'view',   label: 'View Courses & Resources' },
    { key: 'create', label: 'Create / Upload Content' },
    { key: 'edit',   label: 'Edit Content' },
    { key: 'delete', label: 'Delete Content' },
    { key: 'enroll', label: 'Enroll Students' },
  ]},

  /* ── Operations ───────────────────────────────────────── */
  { key: 'admissions', label: 'Admissions', section: 'Operations', subs: [
    { key: 'view',   label: 'View Pipeline' },
    { key: 'create', label: 'Add Applicant' },
    { key: 'edit',   label: 'Edit Applicant Details' },
    { key: 'move',   label: 'Move Pipeline Stage' },
    { key: 'delete', label: 'Delete Applicant' },
    { key: 'export', label: 'Export Applicants (CSV)' },
  ]},
  { key: 'behaviour', label: 'Behaviour (BPS)', section: 'Operations', subs: [
    { key: 'view',   label: 'View Incidents & BPS' },
    { key: 'create', label: 'Record Incident / Award Points' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'delete', label: 'Delete Records' },
  ]},
  { key: 'finance', label: 'Finance', section: 'Operations', subs: [
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
  { key: 'messages', label: 'Messages', section: 'Operations', subs: [
    { key: 'view',   label: 'View Messages' },
    { key: 'send',   label: 'Send Messages' },
    { key: 'delete', label: 'Delete Messages' },
  ]},
  { key: 'events', label: 'Events & Calendar', section: 'Operations', subs: [
    { key: 'view',   label: 'View Events' },
    { key: 'create', label: 'Create Event' },
    { key: 'edit',   label: 'Edit Event' },
    { key: 'delete', label: 'Delete Event' },
    { key: 'export', label: 'Export Events (CSV)' },
  ]},
  { key: 'hr', label: 'HR & Payroll', section: 'Operations', subs: [
    { key: 'staff',          label: 'View Staff Records' },
    { key: 'leave_view',     label: 'View Leave Requests' },
    { key: 'leave_approve',  label: 'Approve / Reject Leave' },
    { key: 'payroll_view',   label: 'View Payroll' },
    { key: 'payroll_export', label: 'Export Payroll (CSV)' },
    { key: 'documents',      label: 'Manage Staff Documents' },
  ]},
  { key: 'library', label: 'Library', section: 'Operations', subs: [
    { key: 'view',     label: 'View Catalogue & Records' },
    { key: 'issue',    label: 'Issue / Return Books' },
    { key: 'manage',   label: 'Add / Edit Catalogue Items' },
    { key: 'delete',   label: 'Delete Catalogue Items' },
    { key: 'reports',  label: 'View Library Reports' },
  ]},
  { key: 'transport', label: 'Transport', section: 'Operations', subs: [
    { key: 'view',     label: 'View Routes & Vehicles' },
    { key: 'manage',   label: 'Add / Edit Routes & Stops' },
    { key: 'assign',   label: 'Assign Students to Routes' },
    { key: 'delete',   label: 'Delete Routes / Vehicles' },
  ]},
  { key: 'hostel', label: 'Hostel', section: 'Operations', subs: [
    { key: 'view',     label: 'View Rooms & Allocations' },
    { key: 'manage',   label: 'Add / Edit Rooms & Blocks' },
    { key: 'assign',   label: 'Assign Students to Rooms' },
    { key: 'delete',   label: 'Delete Rooms / Blocks' },
  ]},

  /* ── Insights ─────────────────────────────────────────── */
  { key: 'growth_profile', label: 'Growth Profile', section: 'Insights', subs: [
    { key: 'view',            label: 'View Growth Profiles' },
    { key: 'add_records',     label: 'Add Records (Leadership / Activities / Service / Awards)' },
    { key: 'edit_records',    label: 'Edit Own Records' },
    { key: 'delete_records',  label: 'Delete Records' },
    { key: 'projects',        label: 'Add / Edit Projects' },
    { key: 'recommendations', label: 'Write Recommendations' },
    { key: 'aspirations',     label: 'Edit Aspirations' },
    { key: 'verify',          label: 'Verify / Approve Records' },
  ]},
  { key: 'reports', label: 'Reports & Analytics', section: 'Insights', subs: [
    { key: 'view',   label: 'View Reports' },
    { key: 'export', label: 'Export Reports (CSV)' },
  ]},
  { key: 'analytics', label: 'Analytics Dashboard', section: 'Insights', subs: [
    { key: 'view', label: 'View Leadership Analytics' },
  ]},

  /* ── System ───────────────────────────────────────────── */
  { key: 'settings', label: 'Settings', section: 'System', subs: [
    { key: 'school',      label: 'Edit School Settings' },
    { key: 'users',       label: 'Manage Users / Invites' },
    { key: 'permissions', label: 'Manage Roles & Permissions' },
    { key: 'system',      label: 'View System Info' },
  ]},
];

/* Convenience: flat list of module keys — used by permission helpers */
const MODULE_KEYS = MODULE_REGISTRY.map(m => m.key);

module.exports = { MODULE_REGISTRY, MODULE_KEYS };
