/* ============================================================
   Msingi — Student digest

   The facts behind a "smart message": one student, one window, the
   three things a guardian actually asks about — did they come to
   school, how did they behave, how are they doing academically.

   `buildStudentDigest` is pure. It takes rows and returns sentences.
   That is deliberate: the numbers a teacher sends home must be the
   numbers we can point at, and a pure function is the only kind of
   thing you can pin down in a test without a database agreeing to
   hold still.

   Two rules it will not break:
     • A day counts once, and resolves to its worst status — a child
       absent for first period did not "attend" that day (same rule
       as the parent calendar, so the two never disagree).
     • Nothing is invented. An empty window says so instead of
       reporting 0% attendance, which reads as "never came".
   ============================================================ */
'use strict';

const DAY_MS = 86400000;
const WEIGHT = { absent: 3, late: 2, present: 1 };

function _iso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function _shift(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function _pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : null;
}

function _label(incident) {
  return incident.label || incident.categoryLabel || incident.title
    || String(incident.type || 'Incident');
}

/**
 * @param {object} input  student, attendance[], incidents[], marks[]
 * @param {object} opts   now, days
 */
function buildStudentDigest({ student = {}, attendance = [], incidents = [], marks = [] }, { now = new Date(), days = 30 } = {}) {
  const to = _iso(now);
  const from = _shift(to, -(Math.max(1, days) - 1));

  /* One entry per day, worst status wins. */
  const byDay = new Map();
  for (const row of attendance) {
    const day = String(row.date).slice(0, 10);
    const held = byDay.get(day);
    if (!held || (WEIGHT[row.status] ?? 0) > (WEIGHT[held.status] ?? 0)) byDay.set(day, row);
  }
  const attendanceSummary = { present: 0, absent: 0, late: 0, total: byDay.size };
  for (const row of byDay.values()) {
    if (attendanceSummary[row.status] !== undefined) attendanceSummary[row.status] += 1;
  }
  attendanceSummary.percentage = _pct(attendanceSummary.present, attendanceSummary.total);

  /* Behaviour: counts and net points, plus the last few labels so the
     message can name what happened instead of only tallying it. */
  const behaviour = { merits: 0, demerits: 0, neutral: 0, points: 0, recent: [] };
  for (const row of incidents) {
    if (row.type === 'merit') behaviour.merits += 1;
    else if (row.type === 'demerit') behaviour.demerits += 1;
    else behaviour.neutral += 1;
    behaviour.points += Number(row.points) || 0;
  }
  behaviour.recent = [...incidents]
    .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')))
    .slice(0, 3)
    .map(row => ({ label: _label(row), type: row.type || 'neutral', date: String(row.date || row.createdAt || '').slice(0, 10) }));

  /* Academics: rawScore is already 0-100 in the markbook. */
  const scores = marks.map(m => Number(m.rawScore)).filter(n => Number.isFinite(n));
  const academic = {
    assessed: scores.length,
    average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    best: scores.length ? Math.max(...scores) : null,
    weakest: scores.length ? Math.min(...scores) : null,
  };

  const name = [student.firstName, student.lastName].filter(Boolean).join(' ') || student.name || 'Student';
  const className = student.className || student.classId || '';

  const lines = [];
  if (attendanceSummary.total) {
    const bits = [`${attendanceSummary.present} present`];
    if (attendanceSummary.absent) bits.push(`${attendanceSummary.absent} absent`);
    if (attendanceSummary.late) bits.push(`${attendanceSummary.late} late`);
    lines.push(`Attendance: ${attendanceSummary.percentage}% — ${bits.join(', ')} of ${attendanceSummary.total} school days.`);
  } else {
    lines.push('Attendance: no register entries in this period.');
  }

  if (behaviour.merits || behaviour.demerits || behaviour.neutral) {
    const bits = [];
    if (behaviour.merits) bits.push(`${behaviour.merits} merit${behaviour.merits === 1 ? '' : 's'}`);
    if (behaviour.demerits) bits.push(`${behaviour.demerits} demerit${behaviour.demerits === 1 ? '' : 's'}`);
    if (!bits.length) bits.push(`${behaviour.neutral} note${behaviour.neutral === 1 ? '' : 's'}`);
    lines.push(`Behaviour: ${bits.join(', ')}${behaviour.points ? ` (${behaviour.points > 0 ? '+' : ''}${behaviour.points} points)` : ''}.`);
  } else {
    lines.push('Behaviour: no incidents recorded in this period.');
  }

  if (academic.assessed) {
    lines.push(`Academics: ${academic.average}% average across ${academic.assessed} published mark${academic.assessed === 1 ? '' : 's'} (range ${academic.weakest}–${academic.best}%).`);
  } else {
    lines.push('Academics: no published marks in this period yet.');
  }

  /* Flags are for the teacher's eye, not the guardian's message. */
  const flags = [];
  if (attendanceSummary.total && attendanceSummary.percentage < 85) flags.push('attendance below 85%');
  if (behaviour.demerits > behaviour.merits) flags.push('more demerits than merits');
  if (academic.average != null && academic.average < 50) flags.push('average below 50%');

  return {
    student: { id: student.id, name, className },
    window:  { days, from, to },
    attendance: attendanceSummary,
    behaviour,
    academic,
    flags,
    lines,
    headline: `${name}${className ? ` — ${className}` : ''} · ${from} to ${to}`,
    hasData: Boolean(attendanceSummary.total || incidents.length || scores.length),
  };
}

/** Loads the rows buildStudentDigest needs. Scoping is the caller's job. */
async function loadStudentDigest({ schoolId, student, days = 30, now = new Date() }) {
  const { _model } = require('./model');
  const to = _iso(now);
  const from = _shift(to, -(Math.max(1, days) - 1));
  const since = new Date(`${from}T00:00:00.000Z`);

  const [attendance, incidents, marks] = await Promise.all([
    _model('attendance').find({
      schoolId,
      studentId: student.id,
      $or: [
        { date: { $gte: from, $lte: to } },
        { date: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) } },
      ],
    }).select('date status').lean(),

    _model('behaviour_incidents').find({
      schoolId,
      studentId: student.id,
      $or: [
        { date: { $gte: from } },
        { date: { $gte: since } },
        { createdAt: { $gte: since } },
      ],
    }).select('type severity points date createdAt label categoryLabel title').lean(),

    // Published, present marks only — same filter the analytics dashboard
    // trusts, so a report card and a report message never disagree.
    _model('assessment_marks').find({
      schoolId,
      studentId: student.id,
      isPublished: true,
      markState: 'present',
      rawScore: { $ne: null },
      createdAt: { $gte: since },
    }).select('rawScore assessmentId createdAt').lean(),
  ]);

  return buildStudentDigest({ student, attendance, incidents, marks }, { now, days });
}

module.exports = { buildStudentDigest, loadStudentDigest, _shift, _iso };
