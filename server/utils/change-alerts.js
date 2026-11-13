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

const { lessonTeacherIds, lessonStreams } = require('./lesson-audience');

const TIMETABLE_FIELDS = ['day', 'period', 'startTime', 'endTime', 'room', 'teacherId', 'coTeacherIds', 'subjectId'];
const ROUTE_FIELDS = ['departureTime', 'arrivalTime', 'stops'];

const TIMETABLE_LABEL = {
  day: 'Day', period: 'Period', startTime: 'Start', endTime: 'End',
  room: 'Room', teacherId: 'Teacher', coTeacherIds: 'Also teaching', subjectId: 'Subject',
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
    if (Array.isArray(value) && field === 'coTeacherIds') return value.length ? value.map(v => names[v] || 'a teacher').join(', ') : 'none';
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
  // Lessons store a teacher's LOGIN id (users.id); staff records are `teachers`
  // with id + userId. Look them up by either form (v5.270.0 — before, the
  // lookup used teachers.id only and never selected userId, so names were
  // missing and the incoming teacher was never told).
  const allTeacherIds = [...new Set([...lessonTeacherIds(before || {}), ...lessonTeacherIds(after || {})])];
  const [klass, subject, teacherDocs] = await Promise.all([
    slot.classId ? tenantModel('classes', ctx).findOne({ schoolId, id: slot.classId }).select('id name').lean() : null,
    slot.subjectId ? tenantModel('subjects', ctx).findOne({ schoolId, id: slot.subjectId }).select('id name').lean() : null,
    allTeacherIds.length
      ? tenantModel('teachers', ctx).find({ schoolId, $or: [{ id: { $in: allTeacherIds } }, { userId: { $in: allTeacherIds } }] }).select('id userId firstName lastName').lean()
      : [],
  ]);
  const teacherOf = id => teacherDocs.find(t => t.id === id || t.userId === id) || null;
  const names = {};
  for (const id of allTeacherIds) {
    const t = teacherOf(id);
    if (t) names[id] = [t.firstName, t.lastName].filter(Boolean).join(' ');
  }
  const teacher = teacherOf(slot.teacherId);

  const className = klass?.name || slot.classId || 'the class';
  const subjectName = subject?.name || 'lesson';
  const lines = changed.map(f => _describe(f, before, after, TIMETABLE_LABEL, names));

  // Only the families of students the lesson is for (v5.270.0): its stream(s),
  // or for an option subject the students who take it. Before, every student
  // of the class was told about a change to one stream's lesson.
  const audienceStreams = [...new Set([...(lessonStreams(before || {}) || []), ...(lessonStreams(after || {}) || [])])];
  const wholeClass = !lessonStreams(before || {}) || !lessonStreams(after || {});
  let students = slot.classId
    ? await tenantModel('students', ctx)
        .find({ schoolId, classId: slot.classId, status: 'active', ...(wholeClass ? {} : { streamId: { $in: audienceStreams } }) })
        .select('id classId').lean()
    : [];
  if (students.length && slot.subjectId) {
    const elective = await tenantModel('class_subjects', ctx)
      .findOne({ schoolId, classId: slot.classId, subjectId: slot.subjectId, isCompulsoryForClass: false }).select('subjectId').lean();
    if (elective) {
      const takes = await tenantModel('student_subjects', ctx)
        .find({ schoolId, subjectId: slot.subjectId, studentId: { $in: students.map(s => s.id) } }).select('studentId').lean();
      const ids = new Set(takes.map(t => t.studentId));
      students = students.filter(s => ids.has(s.id));
    }
  }

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

  // Teachers who now teach the lesson and didn't before (main teacher or co-teacher).
  const beforeT = new Set(lessonTeacherIds(before || {}));
  const incoming = before ? lessonTeacherIds(after || {}).filter(id => !beforeT.has(id)) : [];
  const recipients = [];
  for (const id of incoming) {
    const t = teacherOf(id);
    const userId = t?.userId || null;
    if (userId && !recipients.some(r => r.userId === userId)) recipients.push({ userId, name: names[id] || '', email: '' });
  }
  if (recipients.length) {
    await dispatchNotification({
      ctx, schoolId, eventKey: 'timetable_change', actorUserId: 'system',
      recipients,
      inAppSubject: `You now teach ${subjectName} — ${className}`,
      inAppBody: body,
      emailDigestSubject: `You now teach ${subjectName} — ${className}`,
      emailDigestBody: body,
    }).catch(() => {});
  }

  return { sent: students.length + recipients.length, changed };
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
