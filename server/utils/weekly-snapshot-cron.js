/* ============================================================
   Msingi — Weekly Student Snapshot Cron

   Hourly UTC tick. For every active school, checks that school's OWN
   local clock (school.timezone, default 'Africa/Nairobi' — same default
   settings.js already uses) and generates the week's snapshots once
   it's Saturday and local time is 13:00 or later.

   This is the first genuinely per-school-timezone-aware cron in this
   codebase — the other four (billing/attendance-summary/invoice-overdue/
   notification-digest) are all hardcoded to Africa/Nairobi. Achieved by
   ticking hourly and checking each school's own local time on every
   tick, not by registering one cron per timezone.

   Idempotent by construction: the "which students already have a
   snapshot for this weekStart" check IS the catch-up mechanism. A
   missed 13:00 tick (deploy, restart) is simply picked up by the next
   hourly tick that finds the week still (partially) ungenerated — no
   separate backfill code path needed. insertOne per student, never
   upsert, matching the feature's "frozen, never versioned" design (see
   the approved plan) — an already-delivered week must never silently
   change under a parent/student who already viewed it.
   ============================================================ */
'use strict';

const cron          = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { _model }     = require('./model');
const { tenantModel } = require('./tenant-model');
const { buildSnapshotsForSchool, fetchActiveRoster } = require('./weekly-snapshot-aggregate');
const { notifyGuardiansForStudents } = require('./notify-students');
const email = require('./email');

const CRON_WEEKLY_SNAPSHOT = process.env.WEEKLY_SNAPSHOT_CRON || '0 * * * *'; // hourly; per-school local-time gate below decides actual delivery timing

/* ── Date helpers (all string-math on 'YYYY-MM-DD', UTC-anchored —
   safe because we only ever add/subtract whole days) ────────────── */
function _mondayOnOrBefore(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? 6 : dow - 1; // days back to Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}
function _addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* School's local wall-clock right now, decomposed for the gate check. */
function _localSchoolTime(timezone) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone });         // 'YYYY-MM-DD'
  const weekday = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' }); // 'Mon'..'Sun'
  const hour    = Number(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }));
  return { dateStr, weekday, hour };
}

function _emptySections() {
  return {
    topics: [], assignments: [],
    attendance: { present: 0, absent: 0, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0, total: 0, records: [] },
    behaviour: [], medical: [], library: [], growth: [],
  };
}

/**
 * Generate this week's snapshots for one school, if it's that school's
 * Saturday-1pm-or-later local window and the week isn't fully generated
 * yet. Safe to call every hourly tick — cheap no-op otherwise.
 */
async function maybeGenerateForSchool(school) {
  const timezone = school.timezone || 'Africa/Nairobi';
  const { dateStr, weekday, hour } = _localSchoolTime(timezone);
  if (weekday !== 'Sat' || hour < 13) return { generated: 0, skipped: 'not-yet-window' };

  const weekStart = _mondayOnOrBefore(dateStr);
  const weekEnd    = _addDaysToDateStr(weekStart, 6);
  const ctx = { schoolId: school.id };

  const roster = await fetchActiveRoster(ctx);
  if (!roster.length) return { generated: 0, skipped: 'no-active-students' };

  const already = await tenantModel('weekly_snapshots', ctx)
    .find({ weekStart }).select('studentId').lean();
  const doneIds = new Set(already.map(d => d.studentId));
  const pending = roster.filter(s => !doneIds.has(s.id));
  if (!pending.length) return { generated: 0, skipped: 'already-generated' };

  const sectionsByStudent = await buildSnapshotsForSchool(ctx, weekStart, weekEnd, timezone, pending);
  const generatedAt = new Date().toISOString();

  const Snapshots = tenantModel('weekly_snapshots', ctx);
  let generated = 0;
  const createdDocs = [];
  for (const s of pending) {
    const doc = {
      id: uuidv4(), schoolId: school.id, studentId: s.id,
      classId: s.classId ?? null, className: s.className ?? null,
      weekStart, weekEnd, generatedAt, schoolTimezone: timezone,
      sections: sectionsByStudent.get(s.id) ?? _emptySections(),
      notified: { emailSentAt: null, inAppSentAt: null, emailError: null },
    };
    try {
      await Snapshots.create(doc);
      generated++;
      // firstName/lastName ride along for the notification step below
      // only — never persisted onto the snapshot doc itself (the
      // collection schema deliberately has no studentName field, unlike
      // report_card_snapshots; see the approved plan).
      createdDocs.push({ ...doc, firstName: s.firstName, lastName: s.lastName });
    } catch (err) {
      // One student's write failure must not abort the rest of the
      // school's batch, nor the next school in the outer loop.
      console.error(`[weekly-snapshot-cron] Failed to write snapshot for student ${s.id} (school ${school.id}):`, err.message);
    }
  }

  if (createdDocs.length) {
    await _notifyGuardians(ctx, school, createdDocs);
  }

  return { generated, weekStart, weekEnd, total: pending.length };
}

/* Best-effort parent notification (email + in-app) after generation.
   Never blocks/fails snapshot generation itself — generation has already
   committed by the time this runs. notifyGuardiansForStudents() already
   isolates each student's failure internally (one guardian lookup/send
   failing doesn't stop the rest); this function's own try/catch is the
   outer safety net so a notification-layer exception can't propagate
   back into the cron's per-school loop in runWeeklySnapshots(). */
async function _notifyGuardians(ctx, school, createdDocs) {
  try {
    const schoolName  = school.name       || '';
    const schoolEmail = school.systemEmail || '';

    await notifyGuardiansForStudents({
      ctx, schoolId: school.id, eventKey: 'weekly_snapshot_ready',
      items: createdDocs.map(d => {
        const studentName = [d.firstName, d.lastName].filter(Boolean).join(' ') || 'your child';
        return {
          studentId: d.studentId,
          inAppSubject: `Weekly snapshot ready for ${studentName}`,
          inAppBody:    `This week's snapshot (${d.weekStart} – ${d.weekEnd}) is now available.`,
          emailDigestSubject: `Weekly Snapshot Ready — ${studentName}`,
          emailDigestBody:    `This week's snapshot (${d.weekStart} – ${d.weekEnd}) is now available.`,
          sendEmail: (recipient) => email.sendWeeklySnapshotReady({
            recipientName: recipient.name, recipientEmail: recipient.email,
            studentName, weekStart: d.weekStart, weekEnd: d.weekEnd,
            schoolName, schoolEmail, schoolId: school.id,
          }),
        };
      }),
    });

    // Best-effort notified.* timestamp stamp — matches this codebase's
    // existing posture of not tracking per-recipient delivery success,
    // only "was dispatch attempted." A finer-grained emailError would
    // need dispatchNotification to surface per-recipient results, which
    // no existing call site in this codebase does either.
    const nowIso = new Date().toISOString();
    const Snapshots = tenantModel('weekly_snapshots', ctx);
    await Promise.all(createdDocs.map(d =>
      Snapshots.updateOne({ id: d.id }, { $set: { 'notified.emailSentAt': nowIso, 'notified.inAppSentAt': nowIso } })
        .catch(err => console.error(`[weekly-snapshot-cron] Failed to stamp notified.* for snapshot ${d.id}:`, err.message))
    ));
  } catch (err) {
    console.error(`[weekly-snapshot-cron] Notification dispatch failed for school ${school.id}:`, err.message);
  }
}

async function runWeeklySnapshots() {
  const Schools = _model('schools');
  let schools;
  try {
    schools = await Schools.find({ isActive: { $ne: false } }).select('id name timezone systemEmail').lean();
  } catch (err) {
    console.error('[weekly-snapshot-cron] Failed to query schools:', err.message);
    return;
  }
  if (!schools.length) return;

  for (const school of schools) {
    try {
      const result = await maybeGenerateForSchool(school);
      if (result.generated > 0) {
        console.log(`[weekly-snapshot-cron] School ${school.id}: generated ${result.generated}/${result.total} snapshot(s) for week ${result.weekStart}..${result.weekEnd}`);
      }
    } catch (err) {
      console.error(`[weekly-snapshot-cron] Error processing school ${school.id}:`, err.message);
    }
  }
}

function startWeeklySnapshotCron() {
  if (!cron.validate(CRON_WEEKLY_SNAPSHOT)) {
    console.error(`[weekly-snapshot-cron] Invalid cron expression: ${CRON_WEEKLY_SNAPSHOT}`);
    return;
  }
  cron.schedule(CRON_WEEKLY_SNAPSHOT, runWeeklySnapshots, { timezone: 'UTC' });
  console.log(`[weekly-snapshot-cron] Scheduled — ${CRON_WEEKLY_SNAPSHOT} UTC tick · per-school local Saturday-13:00 gate · override via WEEKLY_SNAPSHOT_CRON env var`);
}

module.exports = {
  startWeeklySnapshotCron, runWeeklySnapshots, maybeGenerateForSchool,
  _mondayOnOrBefore, _addDaysToDateStr, _localSchoolTime,
};
