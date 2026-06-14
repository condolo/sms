/* ============================================================
   Msingi — Pricing Configuration
   Single source of truth for all commercial pricing.

   Currency: KES (Kenyan Shillings)

   ── Pricing model ────────────────────────────────────────────
   • One-time setup fee   → minimum KSh 45,000
     Varies by: student count, number of active modules,
     data migration scope.

   • Per-student per-term → tiered by portal access

   ── Portal tiers ─────────────────────────────────────────────
   TIER 1 — BASE (staff portal only)
     KSh 150 / student / term
     Includes: admin + teacher dashboards, all ERP modules

   TIER 2 — STUDENT (+ student portal)
     KSh 200 / student / term
     Includes: Tier 1 + student login account + student dashboard
     (lessons progress, timetable, report cards, attendance)

   TIER 3 — FAMILY (+ student AND parent portal)
     KSh 250 / student / term
     Includes: Tier 2 + parent login accounts + parent dashboard
     (child progress, fees, attendance, curriculum coverage)

   ── Billing period ───────────────────────────────────────────
   Schools are billed at the start of each term.
   Per-student count is taken at term start (snapshot).

   ── Bootstrap / go-to-market ─────────────────────────────────
   During launch phase:
   • All schools onboard on ENTERPRISE plan (full access)
   • TRIAL_DAYS env var controls free period (default 365 days)
   • BOOTSTRAP_PLAN env var controls default plan (default 'enterprise')
   • When billing goes live: set BOOTSTRAP_PLAN=standard, TRIAL_DAYS=30
     in Render dashboard — no code change required.
   ============================================================ */
'use strict';

/* ── Per-student per-term rates (KES) ───────────────────────── */
const STUDENT_RATE = {
  base:    150,   // staff dashboard only
  student: 200,   // + student login & dashboard
  family:  250,   // + student & parent login & dashboards
};

/* ── Setup fee range (KES) ──────────────────────────────────── */
const SETUP_FEE = {
  min: 45_000,
  max: 75_000,
};

/* ── Setup fee bands (by student headcount) ─────────────────── */
// These are reference bands; final fee agreed during onboarding call.
const SETUP_FEE_BANDS = [
  { maxStudents: 200,      fee: 45_000, label: 'Up to 200 students'   },
  { maxStudents: 500,      fee: 50_000, label: '201 – 500 students'   },
  { maxStudents: 1000,     fee: 60_000, label: '501 – 1,000 students' },
  { maxStudents: Infinity, fee: 75_000, label: 'Over 1,000 students'  },
];

/* ── Portal tier features ───────────────────────────────────── */
const PORTAL_TIERS = [
  {
    key:         'base',
    name:        'Base',
    ratePerTerm: STUDENT_RATE.base,
    description: 'Full school ERP for admin and teachers',
    includes: [
      'Admin & teacher dashboards',
      'Student records, attendance, behaviour',
      'Timetable, exams & assessment',
      'Finance, fee structures & invoicing',
      'HR & staff management',
      'Lessons / syllabus tracker',
      'Report cards & transcripts',
      'Library, transport & hostel',
      'Messaging & announcements',
      'Admissions pipeline',
    ],
    portals: ['admin', 'teacher'],
  },
  {
    key:         'student',
    name:        'Student',
    ratePerTerm: STUDENT_RATE.student,
    description: 'Everything in Base + dedicated student portal',
    includes: [
      'Everything in Base',
      'Student login accounts (admission number or school email)',
      'Student dashboard: lessons progress, timetable, report cards',
      'Student attendance & fee balance view',
    ],
    portals: ['admin', 'teacher', 'student'],
  },
  {
    key:         'family',
    name:        'Family',
    ratePerTerm: STUDENT_RATE.family,
    description: 'Everything in Student + parent portal',
    includes: [
      'Everything in Student',
      'Parent login accounts (one per family)',
      'Parent dashboard: child progress, curriculum coverage, fees',
      'Parent–teacher messaging',
      'Real-time lesson coverage visibility per subject',
    ],
    portals: ['admin', 'teacher', 'student', 'parent'],
    recommended: true,
  },
];

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * Calculate setup fee for a given student count.
 * Returns the reference fee (actual is negotiated during onboarding).
 */
function getSetupFee(studentCount) {
  const band = SETUP_FEE_BANDS.find(b => studentCount <= b.maxStudents);
  return band?.fee ?? SETUP_FEE.max;
}

/**
 * Calculate termly invoice amount.
 * @param {number} studentCount  — number of enrolled students this term
 * @param {'base'|'student'|'family'} tier
 * @returns {number} — total KES for the term
 */
function calcTermAmount(studentCount, tier = 'base') {
  const rate = STUDENT_RATE[tier] ?? STUDENT_RATE.base;
  return studentCount * rate;
}

/**
 * Return a human-readable pricing summary for a school.
 * Used in emails, invoices, and the platform admin dashboard.
 */
function pricingSummary(studentCount, tier = 'base') {
  const termAmount = calcTermAmount(studentCount, tier);
  const tierInfo   = PORTAL_TIERS.find(t => t.key === tier) ?? PORTAL_TIERS[0];
  return {
    tier:          tier,
    tierName:      tierInfo.name,
    ratePerTerm:   STUDENT_RATE[tier],
    studentCount,
    termAmount,
    annualEstimate: termAmount * 3,   // assuming 3 terms per year
    setupFeeRef:   getSetupFee(studentCount),
    currency:      'KES',
  };
}

module.exports = {
  STUDENT_RATE,
  SETUP_FEE,
  SETUP_FEE_BANDS,
  PORTAL_TIERS,
  getSetupFee,
  calcTermAmount,
  pricingSummary,
};
