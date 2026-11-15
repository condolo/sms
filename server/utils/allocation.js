/* ============================================================
   Msingi — Subject allocation (v5.273.0)

   Asked for directly (2026-11-15): "somewhere central so that you can see
   clearly subject allocations and whether a teacher has classes or not",
   inside the Timetable module, instead of opening each teacher.

   One row per curriculum entry (class_subjects): class × subject. A
   subject that is compulsory for a class WITH streams has one row per
   stream — the same rule teaching-assignments.js enforces when an
   assignment is created. Each row carries its teaching assignments,
   lessons per week, and how many lessons the draft timetable has.

   Nothing is hidden: an assignment that matches no curriculum row (a
   stream row for an elective, a whole-class row for a streamed
   compulsory subject saved before the stream rule, a subject removed
   from the curriculum) still gets a row, flagged.

   Teachers: EVERY active teacher, including those with no assignments,
   with their classes, lessons per week asked for and placed.

   Pure function; routes/timetable.js loads the data.
   ============================================================ */
'use strict';

const { computePlacement } = require('./timetable-placement');

const nameOf = (t) => [t.title, t.firstName, t.lastName].filter(Boolean).join(' ') || t.name || t.email || 'Teacher';
const byText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

function computeAllocation({ classes = [], streams = [], classSubjects = [], subjects = [], teachers = [], assignments = [], slots = [] }) {
  // ── Id forms → one key ─────────────────────────────────────
  const classKey = new Map();
  const classInfo = new Map();
  for (const c of classes) {
    const key = c.id || String(c._id);
    for (const f of [c.id, c._id && String(c._id)].filter(Boolean)) classKey.set(String(f), key);
    classInfo.set(key, { name: c.name || key, sectionKey: c.sectionKey || c.section || null, order: c.order ?? null });
  }
  const ck = (id) => (id == null ? '' : classKey.get(String(id)) || String(id));

  const streamsByClass = new Map();
  const streamName = new Map();
  for (const s of streams) {
    if (s.status && s.status !== 'active') continue;
    const sid = s.id || String(s._id);
    streamName.set(sid, s.name || sid);
    const c = ck(s.classId);
    if (!streamsByClass.has(c)) streamsByClass.set(c, []);
    streamsByClass.get(c).push({ id: sid, name: s.name || sid });
  }
  for (const list of streamsByClass.values()) list.sort((a, b) => byText(a.name, b.name));

  const subjectInfo = new Map(subjects.map(s => [s.id || String(s._id), { name: s.name || s.id, departmentId: s.departmentId || null }]));

  const teacherKey = new Map();
  const teacherInfo = new Map();
  for (const t of teachers) {
    const key = t.id || String(t._id);
    for (const f of [t.id, t.userId, t._id && String(t._id)].filter(Boolean)) teacherKey.set(String(f), key);
    teacherInfo.set(key, {
      teacherId: key, userId: t.userId || null, name: nameOf(t), departmentId: t.departmentId || null,
      canTeach: Array.isArray(t.subjects) ? t.subjects : [],
      active: !t.status || t.status === 'active',
    });
  }
  const tk = (id) => (id ? teacherKey.get(String(id)) || String(id) : null);

  // ── Curriculum rows ────────────────────────────────────────
  const rows = new Map();
  const rowKey = (c, st, sub) => `${c}|${st || ''}|${sub}`;
  const makeRow = (c, st, sub, extra) => {
    const key = rowKey(c, st, sub);
    if (!rows.has(key)) {
      const ci = classInfo.get(c) || { name: c };
      const si = subjectInfo.get(sub) || { name: sub, departmentId: null };
      rows.set(key, {
        key, classId: c, className: ci.name, sectionKey: ci.sectionKey || null, classOrder: ci.order ?? null,
        streamId: st || null, streamName: st ? (streamName.get(st) || st) : null,
        subjectId: sub, subjectName: si.name, departmentId: si.departmentId,
        compulsory: false, inCurriculum: true, assignments: [], ...extra,
      });
    }
    return rows.get(key);
  };
  const curriculum = new Map();     // class|subject → link
  for (const link of classSubjects) {
    if (link.isActive === false || !link.classId || !link.subjectId) continue;
    const c = ck(link.classId);
    curriculum.set(`${c}|${link.subjectId}`, link);
    const st = streamsByClass.get(c) || [];
    if (link.isCompulsoryForClass && st.length) {
      for (const s of st) makeRow(c, s.id, link.subjectId, { compulsory: true });
    } else {
      makeRow(c, null, link.subjectId, { compulsory: !!link.isCompulsoryForClass });
    }
  }

  // ── Attach assignments ─────────────────────────────────────
  for (const a of assignments) {
    if (!a.classId || !a.subjectId) continue;
    const c = ck(a.classId);
    const link = curriculum.get(`${c}|${a.subjectId}`);
    const row = rows.get(rowKey(c, a.streamId, a.subjectId))
      || makeRow(c, a.streamId || null, a.subjectId, {
        compulsory: !!link?.isCompulsoryForClass,
        inCurriculum: !!link,
        note: !link ? 'not_in_curriculum'
          : (a.streamId ? 'stream_row_for_whole_class_subject' : 'whole_class_row_for_streamed_subject'),
      });
    const tKey = tk(a.teacherId);
    row.assignments.push({
      id: a.id, teacherId: a.teacherId, teacherKey: tKey,
      teacherName: a.teacherName || teacherInfo.get(tKey)?.name || 'Teacher',
      periodsPerWeek: a.periodsPerWeek ?? null, doubleLessons: a.doubleLessons ?? null,
      lessonGroupId: a.lessonGroupId || null, preferredRoomName: a.preferredRoomName || null,
    });
  }

  // ── Lessons placed: the same counting as "Lessons to place" ─
  // Rows with no teacher get a stand-in (no teacher, no target) so their
  // lessons are still counted rather than reported as "no assignment".
  const standIns = [...rows.values()].filter(r => !r.assignments.length)
    .map(r => ({ classId: r.classId, streamId: r.streamId, subjectId: r.subjectId, subjectName: r.subjectName }));
  const placement = computePlacement({ assignments: [...assignments, ...standIns], slots, classes, subjects, teachers });
  const placedBy = new Map(placement.classes.map(g => [rowKey(g.classId, g.streamId, g.subjectId), g]));

  const out = [...rows.values()].map(r => {
    const g = placedBy.get(r.key);
    const linkedOnce = new Set();
    let needed = 0; let missing = false; let doubles = 0;
    for (const a of r.assignments) {
      if (a.lessonGroupId) { if (linkedOnce.has(a.lessonGroupId)) continue; linkedOnce.add(a.lessonGroupId); }
      if (a.periodsPerWeek) needed += Number(a.periodsPerWeek); else missing = true;
      doubles += Number(a.doubleLessons) || 0;
    }
    const placed = g ? g.placed : 0;
    const status = !r.assignments.length ? 'no_teacher'
      : (missing && !needed) ? 'no_target'
        : placed < needed ? 'short'
          : placed > needed ? 'over'
            : missing ? 'no_target' : 'done';
    return { ...r, needed, doubles, placed, status, taughtTogether: linkedOnce.size > 0 };
  }).sort((x, y) =>
    (x.classOrder ?? 9999) - (y.classOrder ?? 9999) || byText(x.className, y.className)
    || byText(x.streamName, y.streamName) || byText(x.subjectName, y.subjectName));

  // ── Teachers, including those with nothing assigned ─────────
  const tRows = new Map();
  for (const [key, t] of teacherInfo) {
    if (!t.active) continue;
    tRows.set(key, { ...t, classes: new Set(), subjects: new Set(), assignments: 0, needed: 0, missingTarget: false, placed: 0 });
  }
  for (const r of out) for (const a of r.assignments) {
    const t = tRows.get(a.teacherKey);
    if (!t) continue;
    t.assignments++;
    t.classes.add(r.streamName ? `${r.className} ${r.streamName}` : r.className);
    t.subjects.add(r.subjectName);
    if (a.periodsPerWeek) t.needed += Number(a.periodsPerWeek); else t.missingTarget = true;
  }
  for (const pt of placement.teachers) { const t = tRows.get(pt.teacherId); if (t) t.placed = pt.placed; }
  const teacherRows = [...tRows.values()].map(t => ({
    teacherId: t.teacherId, userId: t.userId, name: t.name, departmentId: t.departmentId, canTeach: t.canTeach,
    assignments: t.assignments, classes: [...t.classes].sort(byText), subjects: [...t.subjects].sort(byText),
    needed: t.needed, missingTarget: t.missingTarget, placed: t.placed,
    status: t.assignments === 0 ? 'no_classes' : 'ok',
  })).sort((a, b) => (a.assignments === 0) - (b.assignments === 0) || byText(a.name, b.name));

  const summary = {
    rows: out.length,
    noTeacher: out.filter(r => r.status === 'no_teacher').length,
    noTarget: out.filter(r => r.status === 'no_target').length,
    short: out.filter(r => r.status === 'short').length,
    over: out.filter(r => r.status === 'over').length,
    done: out.filter(r => r.status === 'done').length,
    outsideCurriculum: out.filter(r => !r.inCurriculum).length,
    teachers: teacherRows.length,
    teachersWithNoClasses: teacherRows.filter(t => t.status === 'no_classes').length,
  };
  return { summary, rows: out, teachers: teacherRows };
}

module.exports = { computeAllocation };
