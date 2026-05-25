/* ============================================================
   Changelog — Version history for Msingi platform
   ============================================================ */
import { motion } from 'framer-motion';
import { Tag, Zap, Bug, Shield, Sparkles } from 'lucide-react';

const RELEASES = [
  {
    version: '4.11.3',
    date: '2026-05-25',
    label: 'Phase 1 — A-Level Classes · Subject Curriculum · Enrollments',
    changes: [
      { type: 'new',  text: 'A-Level section: Form 5A and Form 6A classes added (sectionKey: alevel); 4 new subjects — Pure Mathematics, Mechanics, Statistics & Probability, Economics' },
      { type: 'new',  text: 'Class curriculum (class_subjects): 96 subject-to-class links seeded across all 9 classes — primary compulsory core, secondary KCSE model, A-Level all-elective' },
      { type: 'new',  text: 'Student subject enrollments (student_subjects): 163 individual records for all 20 demo students, reflecting science/humanities/primary curriculum tracks' },
      { type: 'new',  text: 'Subject enrollment rules (subject_rules): min/max subjects per section — Primary 6-8, Form 1-2: 7-10, KCSE Form 3-4: 7-9, A-Level: 3-4' },
      { type: 'new',  text: 'Teacher profiles enriched: staffType, departmentId, subjects[], extraRoles (hod/class_teacher/exam_officer/timetabler), formClassId — all 10 profiles updated' },
      { type: 'fix',  text: 'Departments now store hodId + hodUserId (teacher profile and user ID foreign keys) — patched via $set on every re-seed so legacy docs are upgraded' },
      { type: 'fix',  text: 'Subject sections always updated on re-seed — fixes docs seeded before A-Level section existed (e.g. Physics was [secondary], now [secondary, alevel])' },
    ],
  },
  {
    version: '4.11.2',
    date: '2026-05-25',
    label: 'Timetable Seed Fix + Substitution Engine Bug Fixes',
    changes: [
      { type: 'fix',  text: 'Critical: seed-demo-data.js was writing timetable slots to wrong MongoDB collection (timetable_slots instead of timetable) — all 60 slots were invisible to the API, causing empty class grids and "No lessons found" errors' },
      { type: 'fix',  text: 'Teacher ID mismatch in substitution engine: mark-absent now resolves teacher by both profile id and userId via $or lookup, queries slots with $in to match either format' },
      { type: 'fix',  text: 'Available-teachers and auto-assign now check both t.userId and t.id against busy/absent/covered sets so no teacher is silently excluded or shown as available when busy' },
      { type: 'new',  text: 'Full timetable seed for all 7 classes: Standard 5A, 6A, Form 2A, 3A, 4A added (25–30 slots each) — total 205 slots up from 60' },
      { type: 'new',  text: 'All timetable slots now include subject display string and className — substitution cover sheet shows meaningful names instead of IDs' },
    ],
  },
  {
    version: '4.11.1',
    date: '2026-05-24',
    label: 'Smart Cover Sheet & Substitution Engine',
    changes: [
      { type: 'new',  text: 'Substitution table matches aSc format: Absent | Lesson | Reason | Subject | Class | Type | Substitutes | Signature' },
      { type: 'new',  text: 'Smart substitute picker: free teachers ranked same-department first, then fewest weekly lessons; top pick flagged with ⭐' },
      { type: 'new',  text: 'Auto-assign all: fills every uncovered lesson in one click using best available teacher, period-by-period double-booking prevention' },
      { type: 'new',  text: 'Type selector per lesson row: Supervision / Cover / Teaching' },
      { type: 'new',  text: 'Summary header: "Mr. Godfrey (5, 7) and Ms. Beatrice (2)" generated from live absence data' },
      { type: 'new',  text: 'Print-ready cover sheet: signature column, timestamp footer, interactive elements hidden' },
    ],
  },
  {
    version: '4.11.0',
    date: '2026-05-24',
    label: 'Events Birthdays · HR Document Links · Users Filter',
    changes: [
      { type: 'new',  text: 'Events: Birthdays view — browse all student and staff birthdays by month with avatar cards, class/role meta, and today\'s birthday banner' },
      { type: 'new',  text: 'Events: calendar cells show birthday count overlay; clicking switches to birthdays view for that month' },
      { type: 'new',  text: 'HR Documents: document link field — paste a Google Drive / OneDrive / Dropbox URL; "View Document" link appears on the card' },
      { type: 'new',  text: 'Settings › Users: filter by role (13 roles) + name/email search with "X of Y users" count display' },
    ],
  },
  {
    version: '4.10.2',
    date: '2026-05-24',
    label: 'Timetable Cover / Subs Tab + Publish History',
    changes: [
      { type: 'new',  text: 'Cover / Subs tab: daily cover sheet for absent teachers — visible to admin, deputy, and timetabler roles only' },
      { type: 'new',  text: 'Mark teacher absent: auto-pulls all their lessons for that weekday from the master timetable' },
      { type: 'new',  text: 'Substitution records stored separately — master timetable is never modified' },
      { type: 'new',  text: 'Publish history: every timetable publish creates a version snapshot (term label, slot count, timestamp)' },
    ],
  },
  {
    version: '4.10.1',
    date: '2026-05-24',
    label: 'Legacy App Removal + Reference Fixes',
    changes: [
      { type: 'fix',  text: 'Deleted 29,000+ lines of legacy vanilla-JS frontend — React SPA is the only served app' },
      { type: 'fix',  text: 'Demo login links, onboarding URLs, and platform.html all updated to correct /login route and demo slug' },
      { type: 'sec',  text: 'DB name safety: added warning comment; MONGODB_DB_NAME env var is now the override path' },
    ],
  },
  {
    version: '4.10.0',
    date: '2026-05-24',
    label: 'Security Hardening + Google & Microsoft OAuth + M-Pesa',
    changes: [
      { type: 'sec',  text: 'Removed plain-text password fallback — all accounts must have a bcrypt hash' },
      { type: 'sec',  text: 'OTP generation upgraded to Node.js CSPRNG (crypto.randomInt); M-Pesa callbacks enforce Safaricom IP allowlist' },
      { type: 'new',  text: 'Google OAuth 2.0 sign-in: one-click login with Google account' },
      { type: 'new',  text: 'Microsoft OAuth 2.0 sign-in: one-click login with Microsoft / school account' },
      { type: 'new',  text: 'Settings › Subscription tab: M-Pesa STK Push for platform plan payments (Core / Standard / Premium)' },
    ],
  },
  {
    version: '4.9.19',
    date: '2026-05-20',
    label: 'Subjects & Departments Registry',
    changes: [
      { type: 'new',  text: 'Subjects & Departments page: department cards with collapsible subject lists, colour badges, and HoD names' },
      { type: 'new',  text: 'Full CRUD for departments (name, code, colour, HoD) and subjects (code, short name, sections, compulsory flag)' },
      { type: 'new',  text: 'HoD field auto-completes from the teacher roster' },
      { type: 'fix',  text: 'Department delete blocked when active subjects still exist' },
    ],
  },
  {
    version: '4.9.13',
    date: '2026-05-21',
    label: 'Settings & Timetable Rebuild',
    changes: [
      { type: 'new',  text: 'Settings: full multi-tab rebuild — School, Branding, Users, Academic, Integrations, Billing' },
      { type: 'new',  text: 'Timetable: full weekly grid with bell schedule, conflict detection, and publish/unpublish workflow' },
      { type: 'new',  text: 'Bell schedule editor per section (Primary / Secondary)' },
      { type: 'fix',  text: 'Subjects: enrollment counts now reflect live student-subject links' },
      { type: 'perf', text: 'Reduced bundle size for Settings module by 18%' },
    ],
  },
  {
    version: '4.9.12',
    date: '2026-05-14',
    label: 'Grades & Assessment Rebuild',
    changes: [
      { type: 'new',  text: 'Grades page: CA/HW/MT/ET assessment system with configurable weights' },
      { type: 'new',  text: 'Assessment schedule builder — define tasks per term and subject' },
      { type: 'new',  text: 'Markbook view: enter marks per student per assessment task' },
      { type: 'new',  text: 'Grade report with overall average, grade letter, and teacher remarks' },
      { type: 'fix',  text: 'Fixed rounding error in weighted average calculation for borderline grades' },
    ],
  },
  {
    version: '4.9.11',
    date: '2026-05-07',
    label: 'Behaviour & Student Profile',
    changes: [
      { type: 'new',  text: 'Behaviour: Behaviour Point System (BPS) — merit/demerit tracking with points ledger' },
      { type: 'new',  text: 'Behaviour: appeal workflow — students can submit appeals; staff resolve with notes' },
      { type: 'new',  text: 'Student profile: behaviour history, attendance timeline, fee status in one view' },
      { type: 'fix',  text: 'Behaviour summary counts now exclude withdrawn students' },
    ],
  },
  {
    version: '4.9.10',
    date: '2026-04-30',
    label: 'Finance Module',
    changes: [
      { type: 'new',  text: 'Finance: invoice management with void, partial payment, and balance tracking' },
      { type: 'new',  text: 'Finance: payment recording with receipt number and method (M-PESA, bank, cash, cheque)' },
      { type: 'new',  text: 'Finance dashboard: outstanding vs collected summary, top defaulters list' },
      { type: 'sec',  text: 'Finance routes now require explicit finance or admin role — teachers cannot access' },
    ],
  },
  {
    version: '4.9.9',
    date: '2026-04-21',
    label: 'Admissions Pipeline',
    changes: [
      { type: 'new',  text: 'Admissions: 9-stage Kanban pipeline — enquiry → enrolled' },
      { type: 'new',  text: 'Admissions: stage change history with timestamps and staff notes' },
      { type: 'new',  text: 'Admissions stats: conversion rate by stage, monthly applications chart' },
      { type: 'fix',  text: 'Admissions CSV import now correctly maps applyingForClass field' },
    ],
  },
  {
    version: '4.9.8',
    date: '2026-04-14',
    label: 'Attendance & Messages',
    changes: [
      { type: 'new',  text: 'Attendance: bulk mark (present/absent/late/excused) for the entire class in one click' },
      { type: 'new',  text: 'Attendance: summary view — monthly heatmap per student' },
      { type: 'new',  text: 'Messages: in-app messaging between staff, parents, and students' },
      { type: 'fix',  text: 'Attendance date picker now defaults to today and cannot be set in the future' },
    ],
  },
  {
    version: '4.9.7',
    date: '2026-04-07',
    label: 'Multi-Tenant SaaS Foundation',
    changes: [
      { type: 'new',  text: 'Multi-tenant architecture: each school gets an isolated DB namespace (schoolId scoping)' },
      { type: 'new',  text: 'Subdomain routing: demo.msingi.io, school-slug.msingi.io auto-detected and branded' },
      { type: 'new',  text: 'Onboarding flow: new schools can self-provision with guided setup wizard' },
      { type: 'sec',  text: 'JWT tokens now include schoolId — cross-tenant data access is impossible' },
      { type: 'perf', text: 'MongoDB indexes added on schoolId + role for all critical collections' },
    ],
  },
];

const TYPE_CONFIG = {
  new:  { label: 'New',         Icon: Sparkles, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  fix:  { label: 'Fix',         Icon: Bug,       cls: 'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-300'    },
  perf: { label: 'Performance', Icon: Zap,       cls: 'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-300'  },
  sec:  { label: 'Security',    Icon: Shield,    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

export default function ChangelogPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Changelog</h1>
        <p className="text-slate-500 mt-1 text-sm">What's new in Msingi — release notes and updates.</p>
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-200" />
        <div className="space-y-8">
          {RELEASES.map((rel, i) => (
            <motion.div
              key={rel.version}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="relative pl-7"
            >
              {/* Dot */}
              <span className="absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 ring-4 ring-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </span>

              {/* Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                        <Tag size={10} /> v{rel.version}
                      </span>
                      <span className="text-xs text-slate-400">{rel.date}</span>
                    </div>
                    <h2 className="mt-1.5 font-semibold text-slate-900">{rel.label}</h2>
                  </div>
                </div>

                <ul className="space-y-2">
                  {rel.changes.map((c, j) => {
                    const cfg = TYPE_CONFIG[c.type] ?? TYPE_CONFIG.new;
                    const { Icon } = cfg;
                    return (
                      <li key={j} className="flex items-start gap-2.5 text-sm text-slate-700">
                        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold mt-0.5 ${cfg.cls}`}>
                          <Icon size={9} /> {cfg.label}
                        </span>
                        <span>{c.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
