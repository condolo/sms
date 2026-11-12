/* ============================================================
   Msingi — timetable generator: from a school's data to a problem (v5.269.0)

   buildProblem(schoolId, ctx, scope) loads everything the solver needs
   and returns { problem, meta, precheck }:
     problem   the solver's input (see solver.js)
     meta      what the route needs to turn placements into lessons
               (unit → assignment details, scope classes, academic year)
     precheck  problems found before generating, each
               { level: 'error'|'warning', code, message }

   Scope: { sectionKey } (one section — the recommended first use) or
   { classIds: [...] }. Lessons outside the scope, and locked lessons in
   it, stay where they are and count as busy time. Unlocked lessons in
   the scope are what a generated timetable replaces.
   ============================================================ */
'use strict';

const { tenantModel } = require('../tenant-model');
const { resolveAcademicPeriod } = require('../academic-period');
const { getTimetableSettings, dayLabel } = require('../timetable-settings');
const { resolveBellSchedule } = require('../../routes/bell-schedule');

/* Same inference as routes/timetable.js's _inferSection, for classes saved before sectionKey existed. */
function inferSection(className = '') {
  const n = (className || '').toLowerCase();
  if (/kinder|^kg|^pp\s?[12]|nursery|playgroup/i.test(n)) return 'kg';
  if (/grade\s*[1-6]|std\s*[1-6]|class\s*[1-6]|primary|year\s*[1-6]/i.test(n)) return 'primary';
  if (/form\s*[1-4]|grade\s*[7-9]|year\s*[7-9]|junior\s*sec/i.test(n)) return 'secondary';
  if (/form\s*[5-6]|year\s*1[0-3]|a.?level|sixth/i.test(n)) return 'alevel';
  return 'all';
}
const classKeyOf = c => c.id || String(c._id);
const sectionOf = c => c.sectionKey || inferSection(c.name);
const isLesson = s => !s.type || s.type === 'lesson';

/** Slots for one class: working days × its bell's lesson periods; doubles need no break between. */
function slotsFromBell(periods, workingDays) {
  const lessonIdx = [];
  periods.forEach((p, idx) => { if (!p.isBreak) lessonIdx.push(idx); });
  const slots = [];
  const doubleStarts = [];
  for (const day of workingDays) {
    lessonIdx.forEach((idx, pos) => {
      const p = periods[idx];
      const i = slots.length;
      slots.push({ i, day, periodKey: String(p.p), start: p.start, end: p.end, dayPos: pos, dayLen: lessonIdx.length });
      const nextIdx = lessonIdx[pos + 1];
      // Back-to-back: the very next row of the bell is a lesson (no break row between).
      if (nextIdx === idx + 1) doubleStarts.push(i);
    });
  }
  return { slots, doubleStarts };
}

async function buildProblem(schoolId, ctx, scope = {}) {
  const precheck = [];
  const add = (level, code, message) => precheck.push({ level, code, message });

  const period = await resolveAcademicPeriod(schoolId, ctx, {});
  const academicYearId = period.error ? null : (period.academicYearId ?? null);
  const termId = period.error ? null : (period.termId ?? null);

  const [{ workingDays, rules }, classes] = await Promise.all([
    getTimetableSettings(schoolId),
    tenantModel('classes', ctx).find({ schoolId, status: { $ne: 'inactive' } }).select('id name sectionKey status').lean(),
  ]);

  // ── Scope ───────────────────────────────────────────────────
  let scopeClasses;
  if (Array.isArray(scope.classIds) && scope.classIds.length) {
    const want = new Set(scope.classIds.map(String));
    scopeClasses = classes.filter(c => want.has(String(c.id)) || want.has(String(c._id)));
  } else if (scope.sectionKey) {
    scopeClasses = classes.filter(c => sectionOf(c) === scope.sectionKey);
  } else {
    scopeClasses = [];
  }
  const scopeKeys = new Set(scopeClasses.map(classKeyOf));
  // Any id form of a scope class → its key.
  const classKey = new Map();
  for (const c of classes) for (const f of [c.id, c._id && String(c._id)].filter(Boolean)) classKey.set(String(f), classKeyOf(c));
  const ck = id => classKey.get(String(id)) || String(id);

  if (!scopeClasses.length) {
    add('error', 'no_classes', 'No classes in this scope.');
    return { problem: null, meta: null, precheck };
  }

  const scopeIdForms = [...new Set(scopeClasses.flatMap(c => [c.id, c._id && String(c._id)].filter(Boolean)))];
  const [streams, assignments, subjects, rooms, teachers, availability, lessons, students] = await Promise.all([
    tenantModel('streams', ctx).find({ schoolId, classId: { $in: scopeIdForms } }).select('id classId name status').lean(),
    tenantModel('teaching_assignments', ctx).find({ schoolId, classId: { $in: scopeIdForms } })
      .select('id teacherId teacherName subjectId subjectName classId className streamId streamName preferredRoomId periodsPerWeek doubleLessons').lean(),
    tenantModel('subjects', ctx).find({ schoolId }).select('id name requiredRoomType').lean(),
    tenantModel('rooms', ctx).find({ schoolId, isActive: { $ne: false } }).select('id name type capacity').lean(),
    tenantModel('teachers', ctx).find({ schoolId }).select('id userId title firstName lastName').lean(),
    tenantModel('teacher_availability', ctx).find({ schoolId }).select('teacherId blocks').lean(),
    tenantModel('timetable', ctx).find({ schoolId, isActive: true, academicYearId })
      .select('id classId streamId day period startTime endTime teacherId roomId room subject subjectId type locked section').lean(),
    tenantModel('students', ctx).find({ schoolId, status: 'active', classId: { $in: scopeIdForms } }).select('classId streamId').lean(),
  ]);

  // Teacher id forms → the staff record's key.
  const teacherKey = new Map();
  const teacherName = new Map();
  for (const t of teachers) {
    const key = t.id || String(t._id);
    for (const f of [t.id, t.userId, t._id && String(t._id)].filter(Boolean)) teacherKey.set(String(f), key);
    teacherName.set(key, [t.title, t.firstName, t.lastName].filter(Boolean).join(' '));
  }
  const tk = id => (id ? teacherKey.get(String(id)) || String(id) : null);

  const subjectById = new Map(subjects.map(s => [s.id, s]));
  const subjectByName = new Map(subjects.filter(s => s.name).map(s => [s.name.trim().toLowerCase(), s]));
  const roomList = rooms.map(r => ({ id: r.id || String(r._id), name: r.name, type: r.type || 'classroom', capacity: r.capacity || null }));
  const coreIds = new Set(rules.coreSubjectsMorning?.on ? rules.coreSubjectsMorning.subjectIds : []);

  // ── Bell schedules: one per class (scope classes + classes of lessons that need times) ──
  const bellCache = new Map();
  async function bellFor(c) {
    const key = classKeyOf(c);
    if (!bellCache.has(key)) bellCache.set(key, await resolveBellSchedule(schoolId, sectionOf(c) || 'all', key));
    return bellCache.get(key);
  }
  const classByKey = new Map(classes.map(c => [classKeyOf(c), c]));

  // ── Audiences (class, or one stream of it) ──────────────────
  const audiences = {};
  const classSlots = new Map();
  for (const c of scopeClasses) {
    const bell = await bellFor(c);
    const { slots, doubleStarts } = slotsFromBell(bell.periods || [], workingDays);
    classSlots.set(classKeyOf(c), { slots, doubleStarts, bellScheduleId: bell.id ?? null });
    if (!slots.length) add('error', 'no_periods', `${c.name} has no lesson periods on the working days (check its bell schedule).`);
  }
  const audienceFor = (classK, streamId) => {
    const key = `${classK}|${streamId || ''}`;
    if (!audiences[key]) {
      const cs = classSlots.get(classK);
      const c = classByKey.get(classK);
      const st = streamId ? streams.find(s => (s.id || String(s._id)) === streamId) : null;
      audiences[key] = { classId: classK, streamId: streamId || null, label: `${c?.name || classK}${st ? ` ${st.name}` : ''}`, slots: cs.slots, doubleStarts: cs.doubleStarts };
    }
    return key;
  };

  // ── Class sizes (for room capacity) ─────────────────────────
  const size = new Map();
  for (const s of students) {
    const k = ck(s.classId);
    size.set(`${k}|`, (size.get(`${k}|`) || 0) + 1);
    if (s.streamId) size.set(`${k}|${s.streamId}`, (size.get(`${k}|${s.streamId}`) || 0) + 1);
  }

  // ── What the generator places: class|stream|subject groups with a periods-per-week target ──
  const targetGroups = new Set();
  for (const a of assignments) {
    if (a.periodsPerWeek > 0 && a.subjectId && scopeKeys.has(ck(a.classId))) targetGroups.add(`${ck(a.classId)}|${a.streamId || ''}|${a.subjectId}`);
  }
  const subjectOf = l => (l.subjectId ? subjectById.get(l.subjectId) : null) || (l.subject ? subjectByName.get(l.subject.trim().toLowerCase()) : null);

  // ── Fixed lessons: everything outside the scope, locked lessons in it, and
  //    in-scope lessons the generator is NOT placing (a subject with no
  //    periods-per-week target, an assembly…). Only unlocked lessons of a
  //    target group are replaced — a half-filled set of assignments must
  //    never wipe the rest of the timetable. ──
  const fixed = [];
  const replaceable = [];
  let untimedIgnored = 0;
  let keptInScope = 0;
  const lockedBy = new Map();   // `${classK}|${streamId}|${subjectId}` → count of locked lesson periods
  for (const l of lessons) {
    const k = ck(l.classId);
    const inScope = scopeKeys.has(k);
    const groupSubj = inScope && isLesson(l) ? subjectOf(l) : null;
    const inTarget = !!groupSubj && targetGroups.has(`${k}|${l.streamId || ''}|${groupSubj.id}`);
    if (inScope && !l.locked && inTarget) { replaceable.push(l); continue; }
    if (inScope && !l.locked) keptInScope += 1;
    let { startTime, endTime } = l;
    if (!startTime || !endTime) {
      // Old lessons saved without times: take them from the class's bell schedule.
      const c = classByKey.get(k);
      const p = c ? ((await bellFor(c)).periods || []).find(x => String(x.p) === String(l.period) && !x.isBreak) : null;
      if (p) { startTime = p.start; endTime = p.end; } else { untimedIgnored += 1; continue; }
    }
    const subj = subjectOf(l);
    const audKey = inScope ? `${k}|${l.streamId || ''}` : null;
    fixed.push({
      day: l.day, start: startTime, end: endTime, classId: k, streamId: l.streamId || null,
      teacherKey: isLesson(l) ? tk(l.teacherId) : tk(l.teacherId), roomId: l.roomId || null,
      audKey, subjectId: subj?.id || null,
    });
    if (inScope && l.locked && isLesson(l) && subj) {
      const lk = `${k}|${l.streamId || ''}|${subj.id}`;
      lockedBy.set(lk, (lockedBy.get(lk) || 0) + 1);
    }
  }
  if (keptInScope) add('warning', 'kept_lessons', `${keptInScope} unlocked lesson${keptInScope === 1 ? '' : 's'} in this scope ${keptInScope === 1 ? 'is for a subject' : 'are for subjects'} with no periods per week set, so ${keptInScope === 1 ? 'it stays' : 'they stay'} where ${keptInScope === 1 ? 'it is' : 'they are'} and the generator works around ${keptInScope === 1 ? 'it' : 'them'}.`);
  if (untimedIgnored) add('warning', 'untimed', `${untimedIgnored} lesson${untimedIgnored === 1 ? '' : 's'} ha${untimedIgnored === 1 ? 's' : 've'} a period that isn't in its class's bell schedule, so ${untimedIgnored === 1 ? 'it was' : 'they were'} ignored when checking for clashes.`);

  // ── Units: from teaching assignments ────────────────────────
  const units = [];
  const unitInfo = {};
  const missing = [];
  let n = 0;
  for (const a of assignments) {
    const k = ck(a.classId);
    if (!classSlots.has(k)) continue;
    // Many assignments store only teacherId — look the name up before saying "no teacher".
    const who = a.teacherName || (a.teacherId ? teacherName.get(tk(a.teacherId)) : '') || (a.teacherId ? 'teacher not found' : 'no teacher');
    const label = `${a.className || classByKey.get(k)?.name || k}${a.streamName ? ` ${a.streamName}` : ''} ${a.subjectName || ''} (${who})`;
    if (!a.periodsPerWeek) { missing.push(label); continue; }
    const audKey = audienceFor(k, a.streamId || null);
    const lk = `${k}|${a.streamId || ''}|${a.subjectId}`;
    const locked = Math.min(lockedBy.get(lk) || 0, a.periodsPerWeek);
    if (locked) lockedBy.set(lk, (lockedBy.get(lk) || 0) - locked);
    const remaining = a.periodsPerWeek - locked;
    const doubles = Math.min(a.doubleLessons || 0, Math.floor(remaining / 2));
    const singles = remaining - doubles * 2;
    const subj = subjectById.get(a.subjectId);
    const base = {
      audKey, classId: k, streamId: a.streamId || null, subjectId: a.subjectId, subjectName: a.subjectName || subj?.name || '',
      teacherKey: tk(a.teacherId), requiredRoomType: subj?.requiredRoomType || null,
      preferredRoomId: a.preferredRoomId || null, classSize: size.get(audKey) || null, isCore: coreIds.has(a.subjectId),
    };
    const info = {
      assignmentId: a.id, classId: k, streamId: a.streamId || null, subjectId: a.subjectId, subject: base.subjectName,
      teacherId: a.teacherId, teacherName: a.teacherName || teacherName.get(base.teacherKey) || '', label,
    };
    for (let d = 0; d < doubles; d++) { const id = `g${++n}`; units.push({ id, ...base, length: 2 }); unitInfo[id] = info; }
    for (let s = 0; s < singles; s++) { const id = `g${++n}`; units.push({ id, ...base, length: 1 }); unitInfo[id] = info; }
    if (doubles < (a.doubleLessons || 0)) add('warning', 'doubles_trimmed', `${label}: fewer double lessons than set, because locked lessons already use some of its periods.`);
  }
  if (missing.length) {
    add('warning', 'no_target', `${missing.length} teaching assignment${missing.length === 1 ? ' has' : 's have'} no periods per week set and will be left out: ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? '…' : ''}`);
  }
  if (!units.length) add('error', 'nothing_to_place', 'Nothing to place: no teaching assignment in this scope has periods per week set (Teachers → Assignments).');

  // ── Unavailable times ───────────────────────────────────────
  const unavailable = {};
  for (const a of availability) if (a.blocks?.length) unavailable[String(a.teacherId)] = a.blocks;

  // ── Pre-check: things that can't fit ────────────────────────
  // Per class / stream: periods needed vs periods it has (whole-class lessons count for every stream).
  for (const [classK, cs] of classSlots) {
    const c = classByKey.get(classK);
    const whole = units.filter(u => u.classId === classK && !u.streamId).reduce((s, u) => s + u.length, 0)
      + fixed.filter(f => f.classId === classK && !f.streamId && f.audKey).length;
    const streamIds = [...new Set(units.filter(u => u.classId === classK && u.streamId).map(u => u.streamId))];
    const check = (label, need) => {
      if (need > cs.slots.length) add('error', 'class_overfull', `${label} needs ${need} lessons a week but has only ${cs.slots.length} periods.`);
    };
    if (!streamIds.length) check(c?.name || classK, whole);
    for (const sid of streamIds) {
      const own = units.filter(u => u.classId === classK && u.streamId === sid).reduce((s, u) => s + u.length, 0)
        + fixed.filter(f => f.classId === classK && f.streamId === sid && f.audKey).length;
      check(audiences[`${classK}|${sid}`]?.label || `${c?.name} ${sid}`, whole + own);
    }
    if (units.some(u => u.classId === classK && u.length === 2) && !cs.doubleStarts.length) {
      add('error', 'no_doubles', `${c?.name || classK} has double lessons but no two back-to-back periods without a break between them.`);
    }
  }
  // Per teacher: lessons needed (here + already elsewhere) vs periods in the week they could teach.
  const teacherNeed = new Map();
  for (const u of units) if (u.teacherKey) teacherNeed.set(u.teacherKey, (teacherNeed.get(u.teacherKey) || 0) + u.length);
  for (const [t, need] of teacherNeed) {
    const busyElsewhere = fixed.filter(f => f.teacherKey === t).length;
    // Periods available: the distinct times of the classes they'd teach here, minus unavailable ones.
    const times = new Set();
    for (const u of units.filter(x => x.teacherKey === t)) for (const s of audiences[u.audKey].slots) times.add(`${s.day}|${s.start}|${s.end}`);
    const blocks = unavailable[t] || [];
    const free = [...times].filter(k => { const [day, s, e] = k.split('|'); return !blocks.some(b => b.day === day && s < b.end && e > b.start); }).length;
    if (need + busyElsewhere > free) {
      add('error', 'teacher_overfull', `${teacherName.get(t) || 'A teacher'} needs ${need + busyElsewhere} lessons a week (${need} here${busyElsewhere ? `, ${busyElsewhere} already elsewhere` : ''}) but is free for only ${free} periods.`);
    }
  }
  // Room types nobody registered.
  const neededTypes = [...new Set(units.map(u => u.requiredRoomType).filter(Boolean))];
  for (const type of neededTypes) {
    if (!roomList.some(r => r.type === type)) {
      const subjectsNeeding = [...new Set(units.filter(u => u.requiredRoomType === type).map(u => u.subjectName))].join(', ');
      add('error', 'no_room_type', `${subjectsNeeding} need${subjectsNeeding.includes(',') ? '' : 's'} a room of type "${type}", but none is registered (Timetable → Rooms).`);
    }
  }

  const problem = { days: workingDays, audiences, units, fixed, unavailable, rooms: roomList, rules };
  const meta = {
    academicYearId, termId,
    scopeClassKeys: [...scopeKeys],
    scopeIdForms,   // every id form (id and String(_id)) — what apply matches lessons on
    scopeLabel: scope.sectionKey ? `Section: ${scope.sectionKey}` : scopeClasses.map(c => c.name).join(', '),
    unitInfo,
    classInfo: Object.fromEntries(scopeClasses.map(c => [classKeyOf(c), { name: c.name, section: sectionOf(c), bellScheduleId: classSlots.get(classKeyOf(c))?.bellScheduleId ?? null }])),
    replaceableCount: replaceable.length,
    replaceIds: replaceable.map(l => l.id || String(l._id)),   // exactly what apply may delete
    keptInScope,
    lessonsNeeded: units.reduce((s, u) => s + u.length, 0),
  };
  return { problem, meta, precheck };
}

module.exports = { buildProblem, slotsFromBell, inferSection, dayLabel };
