/* ============================================================
   Msingi — Smart Reminders

   One place that decides WHAT is worth interrupting someone about,
   WHO should hear it, and WHETHER they already heard it this window.

   Every rule is a small object with two halves:

     load   — the reads it needs (exams, today's timetable, an
              announcement's read map).  I/O lives here.
     detect — a pure function over that data.  Given the same
              inputs it returns the same recipients, which is what
              makes the console's preview trustworthy: preview runs
              exactly the function a real send runs.

   Rules never send directly.  The runner below hands the entries to
   notify-dispatch.js, so a school's own channel and frequency
   settings (notif-settings.js) still decide email / in-app / push.
   A rule that ignored those would be a second, quieter notification
   system — the exact drift this codebase keeps warning about.

   Idempotency is a row in `smart_reminder_runs` keyed by
   (schoolId, ruleKey, windowKey).  A restart, an overlapping cron
   tick, or a second "Run now" click inside the same window is a
   no-op instead of a duplicate message.  `force` is for the console's
   deliberate re-run, never for the cron.
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { _model } = require('./model');
const { dispatchNotification } = require('./notify-dispatch');
const email = require('./email');

const DEFAULT_TZ = 'Africa/Nairobi';
const DAY_MS = 86400000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/* ── Local-time helpers ──────────────────────────────────────────
   A school's "today" is its own, not the server's. Everything below
   works in the school's timezone and then compares plain YYYY-MM-DD
   strings, so a reminder never fires on the wrong side of midnight. */

function _localDate(now, tz = DEFAULT_TZ) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
}

function _localHour(now, tz = DEFAULT_TZ) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hour12: false,
  }).format(new Date(now)));
}

function _shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function _daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

function _weekday(iso) {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

/** ISO week bucket, e.g. 2026-W45 — one notice nudge per week per person. */
function _isoWeek(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dayNum = d.getUTCDay() || 7;                 // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);         // the Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function _prettyDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function _personName(p) {
  return [p.firstName, p.lastName].filter(Boolean).join(' ')
    || p.name || p.email || 'there';
}

function _clock(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/* ── Rule: exam coming up ────────────────────────────────────────
   Seven days out and again the day before. Two windows, not a daily
   drumbeat: enough time to revise, close enough to matter. */

const examUpcoming = {
  key: 'exam_upcoming',
  label: 'Exam reminders',
  desc: 'Students and guardians hear about a scheduled exam a week ahead, and again the day before.',
  group: 'academic',
  audience: 'Students & guardians',
  cadence: 'daily',
  eventKey: 'exam_upcoming',
  previewable: true,
  hour: 7,
  windowKey: ({ now, tz }) => _localDate(now, tz),

  async load({ schoolId, now, tz }) {
    const today = _localDate(now, tz);
    const dates = [_shiftDate(today, 1), _shiftDate(today, 7)];

    const exams = await _model('exams').find({
      schoolId,
      date: { $in: dates },
      status: { $ne: 'cancelled' },
    }).select('id classId className subjectName title date startTime endTime').lean();

    if (!exams.length) return { today, exams: [], students: [], people: [] };

    const classIds = [...new Set(exams.map(e => e.classId).filter(Boolean))];
    const students = await _model('students').find({
      schoolId, classId: { $in: classIds }, status: 'active',
    }).select('id firstName lastName classId').lean();

    const studentIds = students.map(s => s.id);
    const people = studentIds.length
      ? await _model('users').find({
          schoolId,
          isActive: { $ne: false },
          $or: [
            { studentId: { $in: studentIds } },
            { studentIds: { $in: studentIds } },
            { guardianOf: { $in: studentIds } },
          ],
        }).select('id name email role studentId studentIds guardianOf').lean()
      : [];

    return { today, exams, students, people };
  },

  detect({ today, exams, students, people }) {
    const byClass = new Map();
    for (const exam of exams) {
      if (!exam.classId) continue;
      if (!byClass.has(exam.classId)) byClass.set(exam.classId, []);
      byClass.get(exam.classId).push(exam);
    }

    const entries = [];
    for (const person of people) {
      const linked = person.studentId
        ? [person.studentId]
        : [...new Set([...(person.studentIds || []), ...(person.guardianOf || [])])];
      if (!linked.length) continue;

      for (const offset of [7, 1]) {
        const rows = [];
        for (const student of students) {
          if (!linked.includes(student.id)) continue;
          for (const exam of byClass.get(student.classId) || []) {
            if (_daysBetween(today, exam.date) !== offset) continue;
            rows.push({ student, exam });
          }
        }
        if (!rows.length) continue;

        const when = offset === 1 ? 'tomorrow' : `in ${offset} days`;
        const subject = rows.length === 1
          ? `Exam ${when}: ${rows[0].exam.subjectName || rows[0].exam.title || 'assessment'}`
          : `${rows.length} exams ${when}`;

        const lines = rows.slice(0, 8).map(({ student, exam }) => {
          const parts = [exam.className || student.classId];
          parts.push(exam.subjectName || exam.title || 'Assessment');
          const time = [_clock(exam.startTime), _clock(exam.endTime)].filter(Boolean).join('–');
          return `${parts.join(' — ')}${time ? ` · ${time}` : ''} · ${_prettyDate(exam.date)}`;
        });

        entries.push({
          userId:   person.id,
          name:     _personName(person),
          email:    person.email || '',
          subject,
          body:     lines.join('\n'),
          lines,
          facts:    { offset, exams: rows.length },
        });
      }
    }
    return entries;
  },
};

/* ── Rule: a class register nobody marked ────────────────────────
   The quietest failure in a school: the lesson happened, the register
   did not, and every attendance number downstream is now wrong.
   Before 16:00 the owning teacher hears it; after that the office
   gets the rollup, because that is when someone can still act. */

const registerMissing = {
  key: 'class_register_missing',
  label: 'Register not marked',
  desc: 'Today\'s classes that had a lesson but no register, to the teacher — then to the office after 16:00.',
  group: 'attendance',
  audience: 'Teachers · office after 16:00',
  cadence: 'daily',
  eventKey: 'class_register_missing',
  previewable: true,
  hour: 15,
  windowKey: ({ now, tz }) => _localDate(now, tz),

  async load({ schoolId, now, tz }) {
    const today = _localDate(now, tz);
    const day = _weekday(today);

    const slots = await _model('timetable').find({ schoolId, day })
      .select('id classId streamId subjectId teacherId period day').lean();
    if (!slots.length) return { today, day, slots: [], marked: new Set(), teachers: [], office: [] };

    const markedDocs = await _model('attendance').find({ schoolId, date: today })
      .select('classId streamId').lean();
    const marked = new Set(markedDocs.map(a => a.classId).filter(Boolean));

    const teacherIds = [...new Set(slots.map(s => s.teacherId).filter(Boolean))];
    const teachers = teacherIds.length
      ? await _model('users').find({ schoolId, id: { $in: teacherIds }, isActive: { $ne: false } })
          .select('id name email').lean()
      : [];
    const office = await _model('users').find({
      schoolId, role: { $in: ['admin', 'principal'] }, isActive: { $ne: false },
    }).select('id name email').lean();

    return { today, day, slots, marked, teachers, office };
  },

  detect({ today, slots, marked, teachers, office }, { now, tz = DEFAULT_TZ }) {
    const unmarked = slots.filter(s => s.classId && !marked.has(s.classId));
    if (!unmarked.length) return [];

    const classIds = [...new Set(unmarked.map(s => s.classId))];
    const byTeacher = new Map();
    for (const slot of unmarked) {
      if (!slot.teacherId) continue;
      if (!byTeacher.has(slot.teacherId)) byTeacher.set(slot.teacherId, []);
      byTeacher.get(slot.teacherId).push(slot);
    }

    const entries = [];
    for (const teacher of teachers) {
      const mine = byTeacher.get(teacher.id);
      if (!mine || !mine.length) continue;
      const lines = mine.slice(0, 8).map(s => `${s.classId}${s.period ? ` · period ${s.period}` : ''}`);
      entries.push({
        userId: teacher.id,
        name:   teacher.name || teacher.email || '',
        email:  teacher.email || '',
        subject: mine.length === 1
          ? 'One register is still unmarked today'
          : `${mine.length} registers are still unmarked today`,
        body: `Marked today: ${today}. Still open:\n${lines.join('\n')}`,
        lines,
        facts: { unmarked: mine.length, today },
      });
    }

    // After the school day, the office hears what is still open — one
    // rollup, not one message per class.
    if (_localHour(now, tz) >= 16 && office.length) {
      const lines = classIds.slice(0, 10).map(id => {
        const slot = unmarked.find(s => s.classId === id);
        return `${id}${slot?.period ? ` · period ${slot.period}` : ''}`;
      });
      for (const person of office) {
        entries.push({
          userId: person.id,
          name:   person.name || person.email || '',
          email:  person.email || '',
          subject: `${classIds.length} class${classIds.length === 1 ? '' : 'es'} with no register today`,
          body: `Still unmarked at the end of the day:\n${lines.join('\n')}`,
          lines,
          facts: { unmarked: classIds.length, today },
        });
      }
    }

    return entries;
  },
};

/* ── Rule: a notice nobody opened ────────────────────────────────
   Announcements are one-shot by design, and a parent who missed one
   never finds out. Seven days after posting, whoever has not opened
   it gets exactly one nudge — weekly, so it cannot become nagging. */

const noticeUnread = {
  key: 'notice_unread',
  label: 'Notice never opened',
  desc: 'A weekly nudge to anyone who has not opened an announcement posted in the last week.',
  group: 'communication',
  audience: 'Anyone who has not read it',
  cadence: 'weekly',
  eventKey: 'notice_unread',
  previewable: true,
  hour: 9,
  weekday: 'monday',
  windowKey: ({ now, tz }) => _isoWeek(_localDate(now, tz)),

  async load({ schoolId, now }) {
    const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const notices = await _model('messages').find({
      schoolId, type: 'announcement', createdAt: { $gte: since },
    }).select('id subject body senderId senderName recipients isRead createdAt').lean();
    if (!notices.length) return { notices: [], people: [] };

    const ids = [...new Set(notices.flatMap(n => n.recipients || []))];
    const people = ids.length
      ? await _model('users').find({ schoolId, id: { $in: ids }, isActive: { $ne: false } })
          .select('id name email').lean()
      : [];
    return { notices, people };
  },

  detect({ notices, people }) {
    const byUser = new Map();
    for (const notice of notices) {
      for (const userId of notice.recipients || []) {
        if (userId === notice.senderId) continue;
        if (notice.isRead?.[userId] === true) continue;
        if (!byUser.has(userId)) byUser.set(userId, []);
        byUser.get(userId).push(notice);
      }
    }

    const entries = [];
    for (const person of people) {
      const mine = byUser.get(person.id);
      if (!mine || !mine.length) continue;
      const lines = mine.slice(0, 5).map(n => `${n.subject} · ${String(n.createdAt).slice(0, 10)}`);
      entries.push({
        userId: person.id,
        name:   person.name || person.email || '',
        email:  person.email || '',
        subject: mine.length === 1
          ? 'You have not opened this notice yet'
          : `${mine.length} notices you have not opened`,
        body: lines.join('\n'),
        lines,
        facts: { unread: mine.length },
      });
    }
    return entries;
  },
};

/* ── Rule: lesson plans (inherited) ──────────────────────────────
   Lesson reminders already exist and are good: Fri 17:00, Sat 12:00,
   and a Sat 16:00 HOD escalation (utils/lesson-reminders.js). They
   are listed here so the console shows the whole picture, but they
   cannot be previewed or re-run per school — that cron sweeps every
   school at once, and a school-level "run now" would message the
   whole platform. Rewiring it is Phase 3, not a lie told in a
   button. */

const lessonPlans = {
  key: 'lesson_plan_due',
  label: 'Lesson plans due',
  desc: 'Friday 17:00 reminder, Saturday 12:00 follow-up, and a 16:00 HOD escalation.',
  group: 'academic',
  audience: 'Teachers · HODs',
  cadence: 'weekly',
  eventKey: null,
  previewable: false,
  runnable: false,
  scheduleLabel: 'Fri 17:00 · Sat 12:00 · Sat 16:00 (HOD)',
  note: 'Already scheduled by the lesson-reminders cron. Its wording is in Settings → Notifications.',
};

/* ── Rule: students drifting out of view ─────────────────────────
   A weekly look at the children who have stopped turning up or have
   started collecting incidents, addressed to the form teacher — the
   one person who can actually ring home. Three absences or two
   incidents in seven days is the threshold; below that it is noise. */

const AT_RISK_ABSENCES = 3;
const AT_RISK_INCIDENTS = 2;

const atRiskStudent = {
  key: 'at_risk_student',
  label: 'Students drifting',
  desc: `A weekly note to the form teacher about anyone with ${AT_RISK_ABSENCES}+ absences or ${AT_RISK_INCIDENTS}+ incidents in the last seven days.`,
  group: 'attendance',
  audience: 'Form teachers',
  cadence: 'weekly',
  eventKey: 'at_risk_student',
  previewable: true,
  hour: 8,
  weekday: 'monday',
  windowKey: ({ now, tz }) => _isoWeek(_localDate(now, tz)),

  async load({ schoolId, now, tz }) {
    const today = _localDate(now, tz);
    const from = _shiftDate(today, -6);
    const dateFilter = {
      $or: [
        { date: { $gte: from, $lte: today } },
        { date: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${today}T23:59:59.999Z`) } },
      ],
    };

    const [absences, incidents, students, classes] = await Promise.all([
      _model('attendance').find({ schoolId, status: 'absent', ...dateFilter }).select('studentId date').lean(),
      _model('behaviour_incidents').find({ schoolId, ...dateFilter }).select('studentId type date').lean(),
      _model('students').find({ schoolId, status: 'active' })
        .select('id firstName lastName classId').lean(),
      _model('classes').find({ schoolId }).select('id name formTeacherId').lean(),
    ]);

    const teacherIds = [...new Set(classes.map(c => c.formTeacherId).filter(Boolean))];
    const teachers = teacherIds.length
      ? await _model('teachers').find({ schoolId, id: { $in: teacherIds } })
          .select('id userId firstName lastName').lean()
      : [];

    return { today, from, absences, incidents, students, classes, teachers };
  },

  detect({ from, absences, incidents, students, classes, teachers }) {
    const absByStudent = new Map();
    for (const row of absences) {
      if (!row.studentId) continue;
      absByStudent.set(row.studentId, (absByStudent.get(row.studentId) || 0) + 1);
    }
    const incByStudent = new Map();
    for (const row of incidents) {
      if (!row.studentId) continue;
      incByStudent.set(row.studentId, (incByStudent.get(row.studentId) || 0) + 1);
    }

    const classById = new Map(classes.map(c => [c.id, c]));
    const teacherById = new Map(teachers.map(t => [t.id, t]));
    const studentById = new Map(students.map(s => [s.id, s]));

    // teacherUserId → classId → lines
    const grouped = new Map();
    for (const [studentId, absencesCount] of absByStudent) {
      const student = studentById.get(studentId);
      if (!student) continue;                       // left, or another school's row
      const incidentsCount = incByStudent.get(studentId) || 0;
      if (absencesCount < AT_RISK_ABSENCES && incidentsCount < AT_RISK_INCIDENTS) continue;

      const klass = classById.get(student.classId);
      const teacher = klass?.formTeacherId ? teacherById.get(klass.formTeacherId) : null;
      if (!klass || !teacher?.userId) continue;     // nobody to tell

      const name = [student.firstName, student.lastName].filter(Boolean).join(' ');
      const reasons = [];
      if (absencesCount >= AT_RISK_ABSENCES) reasons.push(`${absencesCount} absences`);
      if (incidentsCount >= AT_RISK_INCIDENTS) reasons.push(`${incidentsCount} incidents`);

      if (!grouped.has(teacher.userId)) grouped.set(teacher.userId, new Map());
      const byClass = grouped.get(teacher.userId);
      if (!byClass.has(klass.id)) byClass.set(klass.id, { className: klass.name || klass.id, teacher, lines: [] });
      byClass.get(klass.id).lines.push(`${name} — ${reasons.join(', ')}`);
    }

    const entries = [];
    for (const [userId, byClass] of grouped) {
      for (const { className, teacher, lines } of byClass.values()) {
        entries.push({
          userId,
          name: [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || 'Teacher',
          email: '',
          subject: `${lines.length} student${lines.length === 1 ? ' needs' : 's need'} a check-in in ${className}`,
          body: `Since ${from}:\n${lines.join('\n')}`,
          lines,
          facts: { className, since: from },
        });
      }
    }
    return entries;
  },
};

/* ── Rule: fees falling due, for the office ──────────────────────
   Parents already get their own due-soon reminder. Nobody tells the
   bursar how much is about to be owing, so the week is planned blind.
   Two days out, one message per finance user with the count and the
   total — never one message per invoice. */

const FEE_DEADLINE_DAYS = 2;

const feeDeadlineStaff = {
  key: 'fee_deadline_staff',
  label: 'Fees falling due (office)',
  desc: `Two days before invoices fall due, the finance team gets the count and the total still owing.`,
  group: 'finance',
  audience: 'Finance · admin · principal',
  cadence: 'daily',
  eventKey: 'fee_deadline_staff',
  previewable: true,
  hour: 9,
  windowKey: ({ now, tz }) => _localDate(now, tz),

  async load({ schoolId, now, tz }) {
    const today = _localDate(now, tz);
    const dueOn = _shiftDate(today, FEE_DEADLINE_DAYS);
    const invoices = await _model('invoices').find({
      schoolId,
      dueDate: dueOn,
      status: { $in: ['unpaid', 'partial'] },
      balance: { $gt: 0 },
    }).select('id studentId studentName balance currency dueDate status').lean();
    const staff = await _model('users').find({
      schoolId, role: { $in: ['finance', 'admin', 'principal'] }, isActive: { $ne: false },
    }).select('id name email').lean();
    return { today, dueOn, invoices, staff };
  },

  detect({ dueOn, invoices, staff }) {
    if (!invoices.length) return [];
    const totals = new Map();
    for (const inv of invoices) {
      const currency = inv.currency || 'KES';
      totals.set(currency, (totals.get(currency) || 0) + (Number(inv.balance) || 0));
    }
    const money = [...totals.entries()]
      .map(([currency, amount]) => `${currency} ${amount.toLocaleString('en-KE')}`)
      .join(' · ');

    const lines = [
      `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} due ${dueOn}`,
      `Still owing: ${money}`,
      ...invoices.slice(0, 5).map(inv => `${inv.studentName || inv.studentId} — ${inv.currency || 'KES'} ${Number(inv.balance || 0).toLocaleString('en-KE')}`),
    ];

    return staff.map(person => ({
      userId: person.id,
      name: person.name || person.email || '',
      email: person.email || '',
      subject: `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} due in ${FEE_DEADLINE_DAYS} days`,
      body: lines.join('\n'),
      lines,
      facts: { dueOn, invoices: invoices.length, money },
    }));
  },
};

const RULES = [examUpcoming, registerMissing, noticeUnread, atRiskStudent, feeDeadlineStaff, lessonPlans];

/* ── Public shape ──────────────────────────────────────────────── */

function _meta(rule) {
  return {
    key:        rule.key,
    label:      rule.label,
    desc:       rule.desc,
    group:      rule.group,
    audience:   rule.audience,
    cadence:    rule.cadence,
    previewable: Boolean(rule.previewable),
    runnable:   rule.runnable !== false && rule.previewable,
    eventKey:   rule.eventKey,
    hour:       rule.hour ?? null,
    weekday:    rule.weekday ?? null,
    window:     rule.windowKey ? rule.windowKey({ now: new Date(), tz: DEFAULT_TZ }) : null,
    scheduleLabel: rule.scheduleLabel || null,
    note:       rule.note || null,
  };
}

function listRules() {
  return RULES.map(_meta);
}

function getRule(key) {
  return RULES.find(r => r.key === key) || null;
}

/** Who would hear from this rule right now — no writes, no emails. */
async function previewRule(key, { schoolId, now = new Date(), tz = DEFAULT_TZ }) {
  const rule = getRule(key);
  if (!rule) return { error: 'Unknown reminder' };
  if (!rule.previewable) {
    return { rule: _meta(rule), recipients: [], total: 0, previewable: false };
  }
  const data = await rule.load({ schoolId, now, tz });
  const entries = rule.detect(data, { now, tz });
  return {
    rule: _meta(rule),
    previewable: true,
    total: entries.length,
    recipients: entries.slice(0, 50).map(e => ({
      userId: e.userId, name: e.name, email: e.email, subject: e.subject, body: e.body,
    })),
  };
}

/**
 * Send one rule now.
 * Returns { sent, skipped, reason? }. `dryRun` stops just before dispatch.
 */
async function runRule(key, {
  schoolId, now = new Date(), tz = DEFAULT_TZ,
  dryRun = false, force = false, schoolName = '', schoolEmail = '',
}) {
  const rule = getRule(key);
  if (!rule) return { error: 'Unknown reminder' };
  if (!rule.previewable) return { error: 'This reminder cannot be run from here.' };

  const windowKey = rule.windowKey({ now, tz });
  const Runs = _model('smart_reminder_runs');
  const existing = await Runs.findOne({ schoolId, ruleKey: key, windowKey }).lean();

  if (!force && !dryRun && existing) {
    return { sent: 0, skipped: true, reason: `Already ran for ${windowKey}.`, windowKey };
  }

  const data = await rule.load({ schoolId, now, tz });
  const entries = rule.detect(data, { now, tz });

  if (dryRun) return { sent: 0, total: entries.length, dryRun: true, windowKey };

  let sent = 0;
  for (const entry of entries) {
    if (!entry.userId) continue;
    try {
      await dispatchNotification({
        ctx: { schoolId },
        schoolId,
        eventKey: rule.eventKey || key,
        actorUserId: 'system',
        recipients: [{ userId: entry.userId, name: entry.name, email: entry.email }],
        inAppSubject: entry.subject,
        inAppBody: entry.body,
        emailDigestSubject: entry.subject,
        emailDigestBody: entry.body,
        sendEmail: (recipient) => email.sendSmartReminder({
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          title: entry.subject,
          lines: entry.lines || [entry.body],
          schoolName,
          schoolEmail,
          schoolId,
        }),
      });
      sent += 1;
    } catch (err) {
      console.error(`[smart-reminders] ${key} → ${entry.userId}:`, err.message);
    }
  }

  try {
    const record = {
      sent,
      recipients: entries.map(e => e.userId),
      ranAt: new Date().toISOString(),
      ranBy: 'system',
    };
    // One row per window. A forced re-run updates the row it already owns
    // rather than stacking a second one, so "last run" stays a fact. The
    // unique index below is still the real guard against two ticks racing.
    if (existing) {
      await Runs.updateOne({ schoolId, ruleKey: key, windowKey }, { $set: record });
    } else {
      await Runs.create({ id: uuidv4(), schoolId, ruleKey: key, windowKey, ...record });
    }
  } catch (err) {
    // A duplicate key here means another tick won the race and already
    // sent this window's reminders. The messages are out once; say so.
    if (err.code === 11000) return { sent, skipped: false, duplicateWindow: true, windowKey };
    console.error(`[smart-reminders] failed to record ${key}:`, err.message);
  }

  return { sent, skipped: false, windowKey, total: entries.length };
}

/** Latest run per rule, for the console. */
async function runHistory(schoolId) {
  try {
    const rows = await _model('smart_reminder_runs')
      .find({ schoolId }).sort({ ranAt: -1 }).limit(200).lean();
    const latest = {};
    for (const row of rows) {
      if (!latest[row.ruleKey]) latest[row.ruleKey] = row;
    }
    return latest;
  } catch {
    return {};
  }
}

module.exports = {
  RULES,
  DEFAULT_TZ,
  listRules,
  getRule,
  previewRule,
  runRule,
  runHistory,
  _localDate,
  _localHour,
  _shiftDate,
  _daysBetween,
  _weekday,
  _isoWeek,
  _prettyDate,
};
