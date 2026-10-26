/* ============================================================
   server/config/notificationTemplates.js

   Registry of EDITABLE message wording for the automated emails
   Msingi sends on a school's behalf. Reported directly: schools
   want to "own the message" — right now every welcome/password-
   reset/etc. email reads as if Msingi wrote it, with no way for
   a school to put it in their own words.

   This is deliberately a NARROW slice of each email: only the
   subject line and the free-text narrative paragraphs (greeting +
   explanation) are overridable here. The structural parts of each
   email — credential boxes, security/lock status, buttons, the
   "do not reply" footer — stay hardcoded in server/utils/email.js
   and are NEVER driven by school-supplied text, so a school can
   personalize tone without being able to break a placeholder,
   hide a security disclosure, or corrupt the layout.

   Keys mirror server/utils/notif-settings.js's EVENT_REGISTRY
   wherever an equivalent event already exists there (same lesson
   that comment file's own history already teaches: a second,
   independently-named registry for the same concept drifts — see
   notif-settings.js's own header comment about the client-side
   duplicate it once had). A few keys below have no equivalent in
   that registry yet (password_changed, security_alert, birthdays,
   daily_digest) because that registry is about which events can be
   TOGGLED on/off, not which ones have editable wording — those are
   independent questions, so this file adds its own entries for them
   rather than changing notif-settings.js's toggle set.

   NOT every tenant email in email.js has an entry here. Excluded,
   and why:
     - sendInvoiceEmail — Msingi's own platform billing invoice TO
       the school; not the school's message to word.
     - sendTrialReminder, sendSystemUpdateNotice — no schoolId is
       passed to either call site today, so there is no school to
       attach an override to without a separate change to thread
       schoolId through (out of scope here).
     - sendRegistrationPending, sendApprovalWelcome, sendRejectionEmail,
       sendAdminNewSchoolAlert, sendAdminApprovalAlert,
       sendPlatformOperatorInvite, sendContactEnquiry/Confirmation,
       sendDemo*, sendSupportReply, sendTicketNotice — pre-onboarding,
       platform-operator-facing, or public-contact-form flows with no
       existing school tenant to own the wording, structurally.

   placeholders: the {{tokens}} available in that template's body/
   subject, substituted by server/utils/notificationTemplates.js.
   A few are pre-computed phrases (e.g. {{statusMessage}}) rather
   than raw fields — see each call site in email.js — so the
   editable text can still reference a conditional outcome (e.g.
   "is currently open") without the school needing to write
   conditional logic of their own.
   ============================================================ */

const CATEGORIES = {
  account:       'Account & Security',
  communication: 'Communication',
  academic:      'Academic',
  finance:       'Finance',
  attendance:    'Attendance',
  behaviour:     'Behaviour',
  hr:            'HR & Payroll',
  celebrations:  'Celebrations',
};

const MESSAGE_TEMPLATES = {
  /* ── Account & Security ─────────────────────────────────── */
  welcome_user: {
    category: 'account',
    label: 'Welcome / New Account Credentials',
    desc: 'Sent when a staff or parent account is first created.',
    placeholders: ['name', 'schoolName', 'role'],
    defaultSubject: 'Your {{schoolName}} account is ready — welcome aboard',
    defaultBody:
      'Hi {{name}},\n\n' +
      'Your account on {{schoolName}} has been set up. Here are your login credentials.\n\n' +
      'You can sign in immediately with these credentials. You may change your password at any time from your account settings.',
  },
  role_changed: {
    category: 'account',
    label: 'Role or Permission Changed',
    desc: "Sent when a user's role or access level is updated.",
    placeholders: ['name', 'schoolName'],
    defaultSubject: 'Your role has changed — {{schoolName}}',
    defaultBody:
      'Hi {{name}},\n\n' +
      'Your role on {{schoolName}} has been updated by an administrator.\n\n' +
      'Your access level may have changed. Sign in to see your updated dashboard.',
  },
  password_expiry: {
    category: 'account',
    label: 'Password Expiry Warning',
    desc: "Security reminder sent before a user's password expires.",
    placeholders: ['name', 'schoolName', 'expiryMessage', 'urgency', 'expiryWhen'],
    defaultSubject: '{{urgency}} — password expires {{expiryWhen}} · {{schoolName}}',
    defaultBody:
      'Hi {{name}},\n\n' +
      'Your password for {{schoolName}} {{expiryMessage}} as part of our 90-day security policy.\n\n' +
      'Please sign in and update your password now to avoid being locked out.',
  },
  password_changed: {
    category: 'account',
    label: 'Password Changed Confirmation',
    desc: "Security confirmation sent right after a user's password is changed.",
    placeholders: ['name', 'schoolName'],
    defaultSubject: 'Password changed — {{schoolName}}',
    defaultBody:
      'Hi {{name}},\n\n' +
      'Your password for {{schoolName}} was just changed. Your next password change will be due in 90 days.',
  },
  platform_impersonation: {
    category: 'account',
    label: 'Msingi Support Access',
    desc: "Notifies a school's administrator when a Msingi platform operator signs in as their account for support.",
    placeholders: ['name', 'schoolName'],
    defaultSubject: 'Msingi support accessed your account — {{schoolName}}',
    defaultBody:
      'Hi {{name}},\n\n' +
      'A Msingi platform operator signed in as your account on {{schoolName}} to provide support.',
  },
  security_alert: {
    category: 'account',
    label: 'Security Alert — Repeated Login Failures',
    desc: "Sent to a school's administrator when an account on their portal is locked after repeated failed logins.",
    placeholders: ['name', 'schoolName', 'count'],
    defaultSubject: '[Security Alert] {{count}} failed login attempts on {{schoolName}}',
    defaultBody:
      'Hi {{name}},\n\n' +
      'Msingi has detected {{count}} failed login attempts for an account on your school portal. The account has been automatically locked for 24 hours.\n\n' +
      'If this user is legitimate, they can contact you to regain access. If this looks suspicious, investigate the source IP and consider reviewing recent login activity for your school.',
  },

  /* ── Communication ───────────────────────────────────────── */
  new_message: {
    category: 'communication',
    label: 'New Message',
    desc: 'Sent when a user receives a direct message.',
    placeholders: ['recipientName', 'senderName', 'schoolName'],
    defaultSubject: '✉️ New Message: {{subject}} — {{schoolName}}',
    defaultBody:
      'Hi {{recipientName}},\n\n' +
      '{{senderName}} has sent you a message on {{schoolName}}.\n\n' +
      'Log in to read the full message and reply.',
  },
  announcement: {
    category: 'communication',
    label: 'School Announcement',
    desc: 'Sent when a school-wide announcement is posted.',
    placeholders: ['recipientName', 'senderName', 'schoolName'],
    defaultSubject: '📢 School Announcement: {{subject}} — {{schoolName}}',
    defaultBody:
      'Hi {{recipientName}},\n\n' +
      '{{senderName}} posted a school announcement on {{schoolName}}.\n\n' +
      'Log in to read the full message and reply.',
  },
  daily_digest: {
    category: 'communication',
    label: 'Daily Summary Digest',
    desc: "Sent instead of individual emails to a user who's chosen the daily digest frequency.",
    placeholders: ['recipientName', 'schoolName', 'itemCount'],
    defaultSubject: '📬 Daily Summary — {{schoolName}}',
    defaultBody:
      "Hi {{recipientName}},\n\n" +
      "Here's what happened today at {{schoolName}} ({{itemCount}} updates).",
  },

  /* ── Academic ────────────────────────────────────────────── */
  assessment_reminder: {
    category: 'academic',
    label: 'Assessment Reminder',
    desc: 'Reminder for upcoming or overdue teacher assessments.',
    placeholders: ['name', 'schoolName', 'assessment', 'statusMessage', 'status', 'termNumber'],
    defaultSubject: '{{schoolName}} — {{assessment}} (Term {{termNumber}}) {{status}}',
    defaultBody:
      'Hi {{name}},\n\n' +
      'This is a reminder from {{schoolName}} about the following assessment:\n\n' +
      'This assessment {{statusMessage}}. Please log in to enter or review marks.',
  },
  report_published: {
    category: 'academic',
    label: 'Report Cards Published',
    desc: 'Sent when report cards are released for a term.',
    placeholders: ['recipientName', 'studentName', 'schoolName', 'termName'],
    defaultSubject: '📄 Report Card Published — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      "{{termName}}'s report card for {{studentName}} is now available on {{schoolName}}.",
  },
  weekly_snapshot_ready: {
    category: 'academic',
    label: 'Weekly Student Snapshot Ready',
    desc: "Sent when a student's weekly digest (topics, assignments, attendance, behaviour) is generated.",
    placeholders: ['recipientName', 'studentName', 'schoolName', 'weekStart', 'weekEnd'],
    defaultSubject: '📅 Weekly Snapshot Ready — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      "This week's snapshot for {{studentName}} ({{weekStart}} – {{weekEnd}}) is now available on {{schoolName}} — topics covered, assignments, attendance, behaviour, and more.",
  },
  exam_results: {
    category: 'academic',
    label: 'Exam Results Released',
    desc: 'Sent when exam results are published for a class.',
    placeholders: ['recipientName', 'studentName', 'schoolName', 'examName'],
    defaultSubject: '📝 Exam Results Published — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      'Results for {{examName}} are now available for {{studentName}} on {{schoolName}}.',
  },

  /* ── Finance ─────────────────────────────────────────────── */
  invoice_created: {
    category: 'finance',
    label: 'Invoice Generated',
    desc: 'Sent when a new fee invoice is created for a student.',
    placeholders: ['recipientName', 'studentName', 'schoolName', 'invoiceNumber', 'amountDue'],
    defaultSubject: '🧾 New Invoice — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      'A new invoice {{invoiceNumber}} of {{amountDue}} has been issued for {{studentName}} at {{schoolName}}.',
  },
  payment_received: {
    category: 'finance',
    label: 'Payment Received',
    desc: 'Payment receipt sent after a fee payment is recorded.',
    placeholders: ['recipientName', 'studentName', 'schoolName', 'receiptNumber', 'balanceMessage'],
    defaultSubject: '✅ Payment Received — {{studentName}} — {{schoolName}}',
    defaultBody:
      "Dear {{recipientName}},\n\n" +
      "We've received a payment for {{studentName}} at {{schoolName}}. Receipt: {{receiptNumber}}.\n\n" +
      "{{balanceMessage}}",
  },
  invoice_due_soon: {
    category: 'finance',
    label: 'Fee Due Soon Reminder',
    desc: "Reminder sent before a fee invoice's due date.",
    placeholders: ['recipientName', 'studentName', 'schoolName', 'invoiceNumber', 'daysRemaining'],
    defaultSubject: '📅 Fee Due Soon — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      'Invoice {{invoiceNumber}} for {{studentName}} at {{schoolName}} is due in {{daysRemaining}}.',
  },
  invoice_overdue: {
    category: 'finance',
    label: 'Overdue Invoice Reminder',
    desc: 'Reminder for unpaid invoices due today or past due.',
    placeholders: ['recipientName', 'studentName', 'schoolName', 'invoiceNumber'],
    defaultSubject: '⏰ Overdue Invoice — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      'Invoice {{invoiceNumber}} for {{studentName}} at {{schoolName}} is now overdue. Please settle the balance as soon as possible.',
  },

  /* ── Attendance ──────────────────────────────────────────── */
  absence_alert: {
    category: 'attendance',
    label: 'Absence Alert',
    desc: 'Sent to parents when a student is marked absent.',
    placeholders: ['recipientName', 'studentName', 'schoolName', 'date'],
    defaultSubject: '🚸 Absence Alert — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      '{{studentName}} was marked absent on {{date}} at {{schoolName}}.\n\n' +
      'If this is unexpected, please contact the school office.',
  },
  attendance_summary: {
    category: 'attendance',
    label: 'Daily Attendance Summary',
    desc: 'End-of-day attendance summary report for administrators.',
    placeholders: ['recipientName', 'schoolName', 'date'],
    defaultSubject: '📊 Daily Attendance Summary — {{schoolName}}',
    defaultBody:
      'Hi {{recipientName}},\n\n' +
      'Attendance summary for {{schoolName}} on {{date}}:',
  },
  attendance_absentee_alert: {
    category: 'attendance',
    label: 'Student Marked Absent (Staff Alert)',
    desc: 'Sent to the assigned Absentee Alert Recipient whenever a student is marked absent.',
    placeholders: ['recipientName', 'schoolName', 'date', 'subject'],
    defaultSubject: '🚸 {{subject}} — {{schoolName}}',
    defaultBody:
      'Hi {{recipientName}},\n\n' +
      'At {{schoolName}} on {{date}}:',
  },

  /* ── Behaviour ───────────────────────────────────────────── */
  behaviour_incident: {
    category: 'behaviour',
    label: 'Behaviour Incident Logged',
    desc: 'Sent to parents/guardians when a behaviour incident is recorded for their child.',
    placeholders: ['recipientName', 'studentName', 'schoolName'],
    defaultSubject: 'Behaviour Incident — {{studentName}} — {{schoolName}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      'A behaviour record was logged for {{studentName}} at {{schoolName}}.',
  },

  /* ── HR & Payroll ────────────────────────────────────────── */
  payroll_status_changed: {
    category: 'hr',
    label: 'Payroll Status Changed',
    desc: 'Sent to a staff member when their payroll record for a period is confirmed or marked as paid.',
    placeholders: ['recipientName', 'schoolName', 'payPeriod', 'status'],
    defaultSubject: '{{schoolName}} — Payroll {{status}} — {{payPeriod}}',
    defaultBody:
      'Dear {{recipientName}},\n\n' +
      'Your payroll record for {{payPeriod}} at {{schoolName}} has been marked as {{status}}.',
  },

  /* ── Celebrations ────────────────────────────────────────── */
  birthday_student: {
    category: 'celebrations',
    label: 'Birthday Wish — Student',
    desc: 'Sent directly to a student on their birthday.',
    placeholders: ['firstName', 'schoolName', 'age'],
    defaultSubject: '🎂 Happy Birthday, {{firstName}}! — {{schoolName}}',
    defaultBody:
      'Hi {{firstName}},\n\n' +
      'Wishing you a wonderful day as you turn {{age}} today!\n\n' +
      'May this year bring you joy, great friendships, and many achievements — inside and outside the classroom.\n\n' +
      'Happy Birthday from everyone at {{schoolName}}!',
  },
  birthday_parent: {
    category: 'celebrations',
    label: 'Birthday Notification — Parent',
    desc: "Sent to a parent/guardian on their child's birthday.",
    placeholders: ['parentName', 'studentFirstName', 'schoolName', 'age'],
    defaultSubject: '🎂 Happy Birthday to {{studentFirstName}}! — {{schoolName}}',
    defaultBody:
      'Dear {{parentName}},\n\n' +
      "Today is {{studentFirstName}}'s birthday! They turn {{age}} today.\n\n" +
      "We celebrate their special day and wish them a wonderful birthday filled with happiness.\n\n" +
      'With warm wishes from {{schoolName}}.',
  },
};

const CATEGORY_ORDER = ['account', 'communication', 'academic', 'finance', 'attendance', 'behaviour', 'hr', 'celebrations'];

module.exports = { MESSAGE_TEMPLATES, CATEGORIES, CATEGORY_ORDER };
