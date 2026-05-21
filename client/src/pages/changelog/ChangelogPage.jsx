/* ============================================================
   Changelog — Version history for Msingi platform
   ============================================================ */
import { motion } from 'framer-motion';
import { Tag, Zap, Bug, Shield, Sparkles } from 'lucide-react';

const RELEASES = [
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
