/**
 * _risk-classify.js — endpoint risk classification (internal module)
 *
 * Assigns a risk level (critical | high | medium | low) to each HTTP endpoint
 * based on the file it lives in, the HTTP method, and specific path patterns.
 *
 * Risk drives which engineering gates are REQUIRED before an endpoint ships:
 *   critical — all 8 gates, mandatory audit + rate limiting
 *   high     — auth, RBAC, tenant, audit (for destructive actions), tests
 *   medium   — auth, RBAC, tenant
 *   low      — auth, tenant
 *
 * See PLATFORM_ROADMAP.md — "Eight Production-Readiness Gates"
 */
'use strict';

/* Base risk per route file */
const FILE_RISK = {
  /* Critical — authentication, permissions, financial, bulk operations */
  'import-export.js':      'critical',
  'settings.js':           'critical',
  'billing.js':            'critical',
  'platform.js':           'critical',
  'auth.js':               'critical',
  'mpesa.js':              'critical',

  /* High — personally identifiable data, financial records, HR */
  'finance.js':            'high',
  'hr.js':                 'high',
  'students.js':           'high',
  'teachers.js':           'high',
  'users.js':              'high',
  'report-cards.js':       'high',
  'admissions.js':         'high',
  'behaviour.js':          'high',

  /* Medium — operational modules with moderate data sensitivity */
  'assessment.js':         'medium',
  'timetable.js':          'medium',
  'attendance.js':         'medium',
  'analytics.js':          'medium',
  'elearning.js':          'medium',
  'grades.js':             'medium',
  'exams.js':              'medium',
  'lessons.js':            'medium',
  'growth-records.js':     'medium',
  'growth-projects.js':    'medium',
  'messages.js':           'medium',
  'events.js':             'medium',
  'library.js':            'medium',
  'hostel.js':             'medium',
  'transport.js':          'medium',

  /* Low — reference / configuration data, read-mostly */
  'academic-config.js':    'low',
  'bell-schedule.js':      'low',
  'class-subjects.js':     'low',
  'classes.js':            'low',
  'collections.js':        'low',
  'departments.js':        'low',
  'rooms.js':              'low',
  'sections.js':           'low',
  'subjects.js':           'low',
  'subject-rules.js':      'low',
  'student-subjects.js':   'low',
  'teaching-assignments.js': 'low',
  'onboard.js':            'low',
};

const LEVELS = ['low', 'medium', 'high', 'critical'];

function escalate(risk, steps = 1) {
  const idx = Math.min(LEVELS.indexOf(risk) + steps, LEVELS.length - 1);
  return LEVELS[idx];
}

/**
 * Classify the risk of a single endpoint.
 *
 * @param {string} file      — route filename (e.g. 'finance.js')
 * @param {string} method    — HTTP method (GET | POST | PUT | PATCH | DELETE)
 * @param {string} routePath — Express route path (e.g. '/students/:id')
 * @returns {'critical'|'high'|'medium'|'low'}
 */
function classifyRisk(file, method, routePath) {
  let risk = FILE_RISK[file] || 'low';

  /* Path-level escalations — specific dangerous operations */
  const path = routePath.toLowerCase();
  if (
    path.includes('/purge')    ||
    path.includes('/bulk')     ||
    path.includes('/smtp')     ||
    path.includes('/mpesa')    ||
    path.includes('/payment')  ||
    path.includes('/reset-password') ||
    path.includes('/otp')      ||
    path.includes('/invite')   ||
    path.includes('/role-change') ||
    path.includes('/custom-roles') ||
    path.includes('/permissions') ||
    path.includes('/lock')     ||
    path.includes('/unlock')
  ) {
    risk = 'critical';
  }

  /* Method-level escalation — destructive methods are riskier */
  if (method === 'DELETE') risk = escalate(risk, 1);

  return risk;
}

module.exports = { classifyRisk, LEVELS };
