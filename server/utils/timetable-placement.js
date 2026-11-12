/* ============================================================
   Msingi — "Lessons to place" (v5.265.0).

   Compares what each class needs — the teaching assignments and
   their lessons per week (`periodsPerWeek`) — with what is on the
   draft timetable. The timetabler's checklist, and later the input
   the timetable generator will work from.

   Pure function; routes/timetable.js loads the data.

   Matching rules:
   • Class: any id form of the class (`id` or `String(_id)`) counts.
   • Subject: the lesson's subjectId, else its subject name matched
     (case-insensitive) to the subject's name.
   • Stream: a stream's assignment counts that stream's lessons and
     whole-class lessons of the subject (a whole-class lesson teaches
     every stream). A whole-class assignment counts whole-class lessons.
   • The teacher on the lesson doesn't decide which assignment it counts
     for; two teachers sharing one class + subject are added together.
   • Only lessons (type "lesson") count — not assembly, breaks, etc.
   ============================================================ */
'use strict';

function _lessonOnly(s) { return !s.type || s.type === 'lesson'; }

/**
 * @param {object} p
 * @param {object[]} p.assignments  teaching_assignments rows
 * @param {object[]} p.slots        draft timetable rows (current academic year)
 * @param {object[]} [p.classes]    classes rows, to join id forms and names
 * @param {object[]} [p.subjects]   subjects rows, to match lessons saved by subject name
 * @param {object[]} [p.teachers]   teachers rows, to join a teacher's id forms
 */
function computePlacement({ assignments = [], slots = [], classes = [], subjects = [], teachers = [] }) {
  // Class id forms → one key, plus names.
  const classKey = new Map();
  const className = new Map();
  for (const c of classes) {
    const key = c.id || String(c._id);
    for (const f of [c.id, c._id && String(c._id)].filter(Boolean)) classKey.set(String(f), key);
    className.set(key, c.name);
  }
  const ck = (id) => (id == null ? '' : classKey.get(String(id)) || String(id));

  // Subject name → id.
  const subjectByName = new Map();
  for (const s of subjects) if (s.name) subjectByName.set(s.name.trim().toLowerCase(), s.id || String(s._id));
  for (const a of assignments) if (a.subjectName && a.subjectId && !subjectByName.has(a.subjectName.trim().toLowerCase())) {
    subjectByName.set(a.subjectName.trim().toLowerCase(), a.subjectId);
  }
  const sk = (slot) => slot.subjectId || (slot.subject ? subjectByName.get(slot.subject.trim().toLowerCase()) : null) || (slot.subject ? `name:${slot.subject.trim().toLowerCase()}` : '');

  // Teacher id forms → one key, plus names.
  const teacherKey = new Map();
  const teacherName = new Map();
  for (const t of teachers) {
    const key = t.id || String(t._id);
    for (const f of [t.id, t.userId, t._id && String(t._id)].filter(Boolean)) teacherKey.set(String(f), key);
    teacherName.set(key, [t.title, t.firstName, t.lastName].filter(Boolean).join(' '));
  }
  const tk = (id) => (id ? teacherKey.get(String(id)) || String(id) : null);

  // ── Per class + stream + subject ─────────────────────────────
  const groups = new Map();
  for (const a of assignments) {
    if (!a.classId || !a.subjectId) continue;
    const key = `${ck(a.classId)}|${a.streamId || ''}|${a.subjectId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        classId: ck(a.classId), className: className.get(ck(a.classId)) || a.className || '',
        streamId: a.streamId || null, streamName: a.streamName || null,
        subjectId: a.subjectId, subjectName: a.subjectName || '',
        teachers: [], needed: 0, doubles: 0, missingTarget: false, placed: 0,
      });
    }
    const g = groups.get(key);
    const tName = a.teacherName || teacherName.get(tk(a.teacherId)) || '';
    if (tName && !g.teachers.includes(tName)) g.teachers.push(tName);
    if (a.periodsPerWeek) g.needed += Number(a.periodsPerWeek);
    else g.missingTarget = true;
    g.doubles += Number(a.doubleLessons) || 0;   // of `needed`, how many are double periods (v5.268.0)
  }

  const lessons = slots.filter(s => s.isActive !== false && _lessonOnly(s));
  const counted = new Set();
  lessons.forEach((s, i) => {
    const c = ck(s.classId), sub = sk(s);
    let hit = false;
    for (const g of groups.values()) {
      if (g.classId !== c || g.subjectId !== sub) continue;
      const fits = g.streamId ? (!s.streamId || s.streamId === g.streamId) : !s.streamId;
      if (fits) { g.placed++; hit = true; }
    }
    if (hit) counted.add(i);
  });

  const statusOf = (g) => g.missingTarget && !g.needed ? 'no_target'
    : g.placed < g.needed ? 'short'
    : g.placed > g.needed ? 'over'
    : g.missingTarget ? 'no_target' : 'done';

  const classRows = [...groups.values()].map(g => ({
    ...g,
    remaining: Math.max(0, g.needed - g.placed),
    status: statusOf(g),
  })).sort((x, y) =>
    x.className.localeCompare(y.className, undefined, { numeric: true })
    || (x.streamName || '').localeCompare(y.streamName || '', undefined, { numeric: true })
    || x.subjectName.localeCompare(y.subjectName));

  // ── Lessons on the timetable that no assignment asks for ─────
  const extra = new Map();
  lessons.forEach((s, i) => {
    if (counted.has(i)) return;
    const key = `${ck(s.classId)}|${s.streamId || ''}|${sk(s)}`;
    if (!extra.has(key)) extra.set(key, { classId: ck(s.classId), className: className.get(ck(s.classId)) || '', streamId: s.streamId || null, subjectName: s.subject || '(no subject)', placed: 0 });
    extra.get(key).placed++;
  });
  const unassigned = [...extra.values()].sort((x, y) => x.className.localeCompare(y.className, undefined, { numeric: true }) || x.subjectName.localeCompare(y.subjectName));

  // ── Per teacher ──────────────────────────────────────────────
  const tRows = new Map();
  const tRow = (key, name) => {
    if (!tRows.has(key)) tRows.set(key, { teacherId: key, teacherName: name || teacherName.get(key) || '', needed: 0, missingTarget: false, placed: 0 });
    return tRows.get(key);
  };
  for (const a of assignments) {
    const key = tk(a.teacherId);
    if (!key) continue;
    const r = tRow(key, a.teacherName);
    if (a.periodsPerWeek) r.needed += Number(a.periodsPerWeek); else r.missingTarget = true;
  }
  for (const s of lessons) {
    const key = tk(s.teacherId);
    if (!key) continue;
    tRow(key, s.teacherName).placed++;
  }
  const teacherRows = [...tRows.values()].map(r => ({
    ...r,
    remaining: Math.max(0, r.needed - r.placed),
    status: statusOf(r),
  })).sort((x, y) => x.teacherName.localeCompare(y.teacherName));

  const summary = {
    groups:        classRows.length,
    done:          classRows.filter(r => r.status === 'done').length,
    short:         classRows.filter(r => r.status === 'short').length,
    over:          classRows.filter(r => r.status === 'over').length,
    noTarget:      classRows.filter(r => r.missingTarget).length,
    lessonsNeeded: classRows.reduce((n, r) => n + r.needed, 0),
    lessonsPlaced: classRows.reduce((n, r) => n + Math.min(r.placed, r.needed), 0),
    lessonsToPlace: classRows.reduce((n, r) => n + r.remaining, 0),
    unassignedLessons: unassigned.reduce((n, r) => n + r.placed, 0),
  };

  return { summary, classes: classRows, teachers: teacherRows, unassigned };
}

module.exports = { computePlacement };
