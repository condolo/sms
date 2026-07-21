/* ============================================================
   server/utils/notif-settings.js

   Central registry of notification events and helpers for
   checking whether a specific event + channel is enabled
   for a given school.

   Usage in route handlers:
     const notif = require('../utils/notif-settings');
     if (await notif.isEnabled(schoolId, 'new_message', 'email')) {
       await email.sendMessageNotification({ ... });
     }
   ============================================================ */
const { _model } = require('./model');

/* ── Canonical event registry ─────────────────────────────────
   Each event:
     label      — human-readable name
     desc       — short description shown in settings UI
     group      — UI grouping
     audience   — which roles typically receive this
     channels   — which channels have defaults
     alwaysOn   — if true: cannot be disabled (security/critical)
     implemented — if false: shown as "Coming soon" in UI
─────────────────────────────────────────────────────────────── */
const EVENT_REGISTRY = {
  /* ── Communication ──────────────────────────────────────── */
  new_message: {
    label:       'New Message',
    desc:        'When a user receives a direct message',
    group:       'communication',
    audience:    ['staff', 'parents'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },
  announcement: {
    label:       'School Announcement',
    desc:        'When a school-wide announcement is posted',
    group:       'communication',
    audience:    ['staff', 'parents', 'students'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },

  /* ── Academic ────────────────────────────────────────────── */
  assessment_reminder: {
    label:       'Assessment Reminder',
    desc:        'Reminder for upcoming or overdue teacher assessments',
    group:       'academic',
    audience:    ['staff'],
    channels:    { email: true, inApp: false },
    implemented: true,
  },
  report_published: {
    label:       'Report Cards Published',
    desc:        'When report cards are released for a term',
    group:       'academic',
    audience:    ['parents', 'students'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },
  exam_results: {
    label:       'Exam Results Released',
    desc:        'When exam results are published for a class',
    group:       'academic',
    audience:    ['parents', 'students'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },

  /* ── Finance ─────────────────────────────────────────────── */
  invoice_created: {
    label:       'Invoice Generated',
    desc:        'When a new fee invoice is created for a student',
    group:       'finance',
    audience:    ['parents'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },
  payment_received: {
    label:       'Payment Received',
    desc:        'Payment receipt sent after a fee payment is recorded',
    group:       'finance',
    audience:    ['parents'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },
  invoice_overdue: {
    label:       'Overdue Invoice Reminder',
    desc:        'Reminder for unpaid invoices past their due date',
    group:       'finance',
    audience:    ['parents'],
    channels:    { email: true, inApp: false },
    implemented: true,
  },

  /* ── Attendance ──────────────────────────────────────────── */
  absence_alert: {
    label:       'Absence Alert',
    desc:        'Sent to parents when a student is marked absent',
    group:       'attendance',
    audience:    ['parents'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },
  attendance_summary: {
    label:       'Daily Attendance Summary',
    desc:        'End-of-day attendance summary report for administrators',
    group:       'attendance',
    audience:    ['staff'],
    channels:    { email: false, inApp: true },
    implemented: true,
  },

  /* ── Behaviour ───────────────────────────────────────────── */
  behaviour_incident: {
    label:       'Behaviour Incident Logged',
    desc:        'Sent to parents/guardians when a behaviour incident is recorded for their child',
    group:       'behaviour',
    audience:    ['parents'],
    channels:    { email: true, inApp: true },
    implemented: true,
  },

  /* ── Account / Security ──────────────────────────────────── */
  welcome_user: {
    label:       'Welcome / Account Created',
    desc:        'Login credentials email sent to newly invited users',
    group:       'account',
    audience:    ['staff', 'parents'],
    channels:    { email: true, inApp: false },
    alwaysOn:    true,
    implemented: true,
  },
  role_changed: {
    label:       'Role or Permission Changed',
    desc:        'Notifies a user when their role or access level is updated',
    group:       'account',
    audience:    ['staff'],
    channels:    { email: true, inApp: true },
    alwaysOn:    true,
    implemented: true,
  },
  password_expiry: {
    label:       'Password Expiry Warning',
    desc:        'Security reminder sent before a user\'s password expires',
    group:       'account',
    audience:    ['staff'],
    channels:    { email: true, inApp: false },
    alwaysOn:    true,
    implemented: true,
  },
};

/* ── Default channel state when school has no saved setting ── */
const DEFAULTS = Object.fromEntries(
  Object.entries(EVENT_REGISTRY).map(([key, ev]) => [key, { ...ev.channels }])
);

/* ── Always-on events cannot be disabled ─────────────────── */
const ALWAYS_ON = new Set(
  Object.entries(EVENT_REGISTRY)
    .filter(([, ev]) => ev.alwaysOn)
    .map(([key]) => key)
);

/* ── Group display order ─────────────────────────────────── */
const GROUPS = [
  { key: 'communication', label: 'Communication' },
  { key: 'academic',      label: 'Academic'      },
  { key: 'finance',       label: 'Finance'       },
  { key: 'attendance',    label: 'Attendance'    },
  { key: 'behaviour',     label: 'Behaviour'     },
  { key: 'account',       label: 'Account & Security' },
];

const DEFAULT_FREQUENCY = 'immediate';

/* ── isEnabled ───────────────────────────────────────────────
   Returns true if the given event + channel combo should fire
   for the given schoolId.

   Fails open: unknown events, DB errors → return true so no
   notifications are silently swallowed.
─────────────────────────────────────────────────────────────── */
async function isEnabled(schoolId, eventKey, channel = 'email') {
  // Always-on events cannot be suppressed
  if (ALWAYS_ON.has(eventKey)) return true;

  // Unknown event key → allow (forward-compatible)
  if (!EVENT_REGISTRY[eventKey]) return true;

  try {
    const School   = _model('schools');
    const school   = await School.findOne({ id: schoolId }, { notificationSettings: 1 }).lean();
    const saved    = school?.notificationSettings ?? {};
    const evtCfg   = saved[eventKey] ?? DEFAULTS[eventKey];
    return evtCfg?.[channel] !== false;
  } catch {
    // Fail open — never suppress a notification due to a DB error
    return true;
  }
}

/* ── getFrequency ────────────────────────────────────────────
   'immediate' (default) sends the email as the event happens.
   'daily_digest' batches it into notification_digests for the
   once-daily summary email (see notification-digest-cron.js) —
   only meaningful for the email channel; in-app messages are
   always immediate. Fails open to 'immediate' on any error, same
   posture as isEnabled().
─────────────────────────────────────────────────────────────── */
async function getFrequency(schoolId, eventKey) {
  if (!EVENT_REGISTRY[eventKey]) return DEFAULT_FREQUENCY;
  try {
    const School = _model('schools');
    const school = await School.findOne({ id: schoolId }, { notificationSettings: 1 }).lean();
    const saved  = school?.notificationSettings?.[eventKey];
    return saved?.frequency === 'daily_digest' ? 'daily_digest' : DEFAULT_FREQUENCY;
  } catch {
    return DEFAULT_FREQUENCY;
  }
}

module.exports = { isEnabled, getFrequency, DEFAULTS, ALWAYS_ON, EVENT_REGISTRY, GROUPS, DEFAULT_FREQUENCY };
