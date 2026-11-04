/* ============================================================
   Msingi — Change alerts (timetable and transport routes)

   Two things a school edits that families find out about too late: a
   lesson that moves, and a bus that leaves at a different time. Both
   were already visible on a portal if you went looking; neither ever
   told anyone.

   These are events, not scheduled rules, because there is nothing to
   detect after the fact — the moment to speak is the moment of the
   change. Both are fire-and-forget: the edit has already been saved,
   and a notification failure must never turn a successful save into
   an error the bursar sees.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');
const { dispatchNotification } = require('./notify-dispatch');
const { notifyGuardiansForStudents } = require('./notify-students');

const TIMETABLE_FIELDS = ['day', 'period', 'startTime', 'endTime', 'room', 'teacherId', 'subjectId'];
const ROUTE_FIELDS = ['departureTime', 'arrivalTime', 'stops'];

const TIMETABLE_LABEL = {
  day: 'Day', period: 'Period', startTime: 'Start', endTime: 'End',
  room: 'Room', teacherId: 'Teacher', subjectId: 'Subject',
};
const ROUTE_LABEL = { departureTime: 'Departure', arrivalTime: 'Arrival', stops: 'Stops' };

function _same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function _changedFields(before = {}, after = {}, fields = []) {
  return fields.filter(f => !_same(before[f], after[f]));
}

function _describe(field, before, after, labelMap, names = {}) {
  const render = (value) => {
    if (value == null || value === '') return 'not set';
    if (Array.isArray(value)) return value.length ? `${value.length} stop${value.length === 1 ? '' : 's'}` : 'none';
    return names[value] || String(value);
  };
  return `${labelMap[field] || field}: ${render(before[field])} → ${render(after[field])}`;
}

/**
 * Tell a class's guardians (and the incoming teacher) that a lesson moved.
 * `before` is the stored slot, `after` the saved one.
 */
async function notifyTimetableChange({ ctx, schoolId, before, after }) {
  const changed = _changedFields(before, after, TIMETABLE_FIELDS);
  if (!changed.length) return { sent: 0, skipped: true };

  const slot = after || before;
  const [klass, subject, teacher] = await Promise.all([
    slot.classId ? tenantModel('classes', ctx).findOne({ schoolId, id: slot.classId }).select('id name').lean() : null,
    slot.subjectId ? tenantModel('subjects', ctx).findOne({ schoolId, id: slot.subjectId }).select('id name').lean() : null,
    slot.teacherId ? tenantModel('teachers', ctx).findOne({ schoolId, id: slot.teacherId }).select('id firstName lastName').lean() : null,
  ]);

  const names = {};
  if (teacher) names[teacher.id] = [teacher.firstName, teacher.lastName].filter(Boolean).join(' ');
  if (before?.teacherId && before.teacherId !== slot.teacherId) {
    const oldTeacher = await tenantModel('teachers', ctx).findOne({ schoolId, id: before.teacherId })
      .select('id firstName lastName').lean().catch(() => null);
    if (oldTeacher) names[oldTeacher.id] = [oldTeacher.firstName, oldTeacher.lastName].filter(Boolean).join(' ');
  }

  const className = klass?.name || slot.classId || 'the class';
  const subjectName = subject?.name || 'lesson';
  const lines = changed.map(f => _describe(f, before, after, TIMETABLE_LABEL, names));

  const students = slot.classId
    ? await tenantModel('students', ctx)
        .find({ schoolId, classId: slot.classId, status: 'active' }).select('id').lean()
    : [];

  const subjectLine = `${subjectName} — ${className} has changed`;
  const body = lines.join('\n');

  if (students.length) {
    await notifyGuardiansForStudents({
      ctx, schoolId, eventKey: 'timetable_change',
      items: students.map(s => ({
        studentId: s.id,
        inAppSubject: subjectLine,
        inAppBody: body,
        emailDigestSubject: subjectLine,
        emailDigestBody: body,
      })),
    });
  }

  // The teacher who now owns the lesson, if it changed hands.
  if (teacher?.userId && before?.teacherId && before.teacherId !== slot.teacherId) {
    await dispatchNotification({
      ctx, schoolId, eventKey: 'timetable_change', actorUserId: 'system',
      recipients: [{ userId: teacher.userId, name: names[teacher.id], email: '' }],
      inAppSubject: `You now teach ${subjectName} — ${className}`,
      inAppBody: body,
      emailDigestSubject: `You now teach ${subjectName} — ${className}`,
      emailDigestBody: body,
    }).catch(() => {});
  }

  return { sent: students.length + (teacher?.userId ? 1 : 0), changed };
}

/**
 * Tell the riders' guardians that a route's times or stops moved.
 */
async function notifyRouteChange({ ctx, schoolId, before, after }) {
  const changed = _changedFields(before, after, ROUTE_FIELDS);
  if (!changed.length) return { sent: 0, skipped: true };

  const route = after || before;
  const assignments = await tenantModel('transport_assignments', ctx)
    .find({ schoolId, routeId: route.id, status: 'active' }).select('studentId').lean();
  if (!assignments.length) return { sent: 0, changed };

  const lines = changed.map(f => _describe(f, before, after, ROUTE_LABEL));
  const subjectLine = `${route.name || 'Your school bus'} has changed`;
  const body = lines.join('\n');

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'transport_route_change',
    items: assignments.map(a => ({
      studentId: a.studentId,
      inAppSubject: subjectLine,
      inAppBody: body,
      emailDigestSubject: subjectLine,
      emailDigestBody: body,
    })),
  });

  return { sent: assignments.length, changed };
}

module.exports = { notifyTimetableChange, notifyRouteChange, _changedFields, _describe };
