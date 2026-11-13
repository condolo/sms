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
const { loadElectiveInfo, isElectiveFor, enrolledIn, canShareSlot, streamsOfElective } = require('../elective-groups');
const { lessonStreams } = require('../lesson-audience');
const { subjectTimeBlock } = require('../timetable-settings');

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
      .select('id teacherId teacherName subjectId subjectName classId className streamId streamName preferredRoomId periodsPerWeek doubleLessons lessonGroupId').lean(),
    tenantModel('subjects', ctx).find({ schoolId }).select('id name requiredRoomType').lean(),
    tenantModel('rooms', ctx).find({ schoolId, isActive: { $ne: false } }).select('id name type capacity homeFor').lean(),
    tenantModel('teachers', ctx).find({ schoolId }).select('id userId title firstName lastName').lean(),
    tenantModel('teacher_availability', ctx).find({ schoolId }).select('teacherId blocks').lean(),
    tenantModel('timetable', ctx).find({ schoolId, isActive: true, academicYearId })
      .select('id classId streamId streamIds day period startTime endTime teacherId coTeacherIds roomId room subject subjectId type locked section').lean(),
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

  // ── Electives (option groups, v5.269.1) — utils/elective-groups.js ──
  // Merged per class key, since class_subjects / students may store either id form.
  const rawElec = await loadElectiveInfo(ctx, schoolId, scopeIdForms);
  const elecInfo = { classes: new Map() };
  for (const c of scopeClasses) {
    const merged = { electives: new Set(), enrolled: new Map(), streamOf: new Map() };
    for (const f of [c.id, c._id && String(c._id)].filter(Boolean)) {
      const e = rawElec.classes.get(String(f));
      if (!e) continue;
      e.electives.forEach(x => merged.electives.add(x));
      for (const [subj, set] of e.enrolled) {
        if (!merged.enrolled.has(subj)) merged.enrolled.set(subj, new Set());
        set.forEach(x => merged.enrolled.get(subj).add(x));
      }
      for (const [stu, st] of e.streamOf) merged.streamOf.set(stu, st);
    }
    elecInfo.classes.set(classKeyOf(c), merged);
  }
  const isElec = (k, subjectId) => isElectiveFor(elecInfo, k, subjectId);
  // One group per class + elective subject + teacher. Lessons of a group
  // have streamId null and `groupId`; see solver.js audienceClash().
  const groups = {};
  const groupIdFor = (k, subjectId, teacherK) => `${k}|g:${subjectId}|${teacherK || ''}`;
  function ensureGroup(k, subjectId, teacherK) {
    const gid = groupIdFor(k, subjectId, teacherK);
    if (!groups[gid]) groups[gid] = { classK: k, subjectId, teacherKey: teacherK || null, streams: streamsOfElective(elecInfo, k, subjectId), shareWith: [] };
    return gid;
  }

  const subjectById = new Map(subjects.map(s => [s.id, s]));
  const subjectByName = new Map(subjects.filter(s => s.name).map(s => [s.name.trim().toLowerCase(), s]));
  const roomList = rooms.map(r => ({ id: r.id || String(r._id), name: r.name, type: r.type || 'classroom', capacity: r.capacity || null }));
  // Lessons saved with only a typed room name still occupy that room.
  const roomIdByName = new Map(rooms.filter(r => r.name).map(r => [r.name.trim().toLowerCase(), r.id || String(r._id)]));
  // Home rooms (rooms.homeFor, v5.269.2): `${classKey}|${streamId||''}` → roomId.
  const homeRoom = new Map();
  for (const r of rooms) for (const h of r.homeFor || []) homeRoom.set(`${ck(h.classId)}|${h.streamId || ''}`, r.id || String(r._id));
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
  const streamNameOf = sid => streams.find(s => (s.id || String(s._id)) === sid)?.name || sid;
  // Audience: the whole class (no streams), one stream, or streams taught together (v5.270.0).
  const audienceForStreams = (classK, st) => {
    const list = st && st.length ? [...st].map(String).sort() : null;
    const key = `${classK}|${list ? list.join('+') : ''}`;
    if (!audiences[key]) {
      const cs = classSlots.get(classK);
      const c = classByKey.get(classK);
      audiences[key] = {
        classId: classK,
        streamId: list && list.length === 1 ? list[0] : null,
        streamIds: list && list.length > 1 ? list : null,
        label: `${c?.name || classK}${list ? ` ${list.map(streamNameOf).join(' + ')}` : ''}`,
        slots: cs.slots, doubleStarts: cs.doubleStarts,
      };
    }
    return key;
  };
  const groupAudience = (gid, subjectName) => {
    if (!audiences[gid]) {
      const g = groups[gid];
      const cs = classSlots.get(g.classK);
      const c = classByKey.get(g.classK);
      audiences[gid] = { classId: g.classK, streamId: null, groupId: gid, label: `${c?.name || g.classK} ${subjectName || ''} (option)`.trim(), slots: cs.slots, doubleStarts: cs.doubleStarts };
    }
    return gid;
  };

  // ── Class sizes (for room capacity) ─────────────────────────
  const size = new Map();
  for (const s of students) {
    const k = ck(s.classId);
    size.set(`${k}|`, (size.get(`${k}|`) || 0) + 1);
    if (s.streamId) size.set(`${k}|${s.streamId}`, (size.get(`${k}|${s.streamId}`) || 0) + 1);
  }

  // ── Unit groups: what is placed as ONE set of lessons (v5.270.0) ──
  //   - rows linked "taught together" (teaching_assignments.lessonGroupId):
  //     all their teachers teach every lesson (co-teaching) and all their
  //     streams attend it (combined streams);
  //   - an elective's rows for one teacher (one row per stream is common):
  //     one option group;
  //   - otherwise one row.
  // Rows of a group share periods/week; if they differ, the largest is used (warned).
  const unitGroups = new Map();   // key → { k, subjectId, elective, rows: [] }
  const missing = [];
  const rowLabel = (a, k) => {
    const who = a.teacherName || (a.teacherId ? teacherName.get(tk(a.teacherId)) : '') || (a.teacherId ? 'teacher not found' : 'no teacher');
    return isElec(k, a.subjectId)
      ? `${a.className || classByKey.get(k)?.name || k} ${a.subjectName || ''} option (${who})`
      : `${a.className || classByKey.get(k)?.name || k}${a.streamName ? ` ${a.streamName}` : ''} ${a.subjectName || ''} (${who})`;
  };
  for (const a of assignments) {
    const k = ck(a.classId);
    if (!classSlots.has(k)) continue;
    if (!a.periodsPerWeek) { missing.push(rowLabel(a, k)); continue; }
    const elective = isElec(k, a.subjectId);
    const key = a.lessonGroupId ? `L:${a.lessonGroupId}` : elective ? `E:${groupIdFor(k, a.subjectId, tk(a.teacherId))}` : `A:${a.id || a._id}`;
    if (!unitGroups.has(key)) unitGroups.set(key, { key, k, subjectId: a.subjectId, elective, rows: [] });
    unitGroups.get(key).rows.push(a);
  }

  // Which target key(s) each lesson belongs to, and which unit group a target key is placed by.
  // An elective's students come from any stream, so electives are keyed with '*'.
  const rowTargetKey = (k, streamId, subjectId) => (isElec(k, subjectId) ? `${k}|*|${subjectId}` : `${k}|${streamId || ''}|${subjectId}`);
  const lessonTargetKeys = (k, l, subjectId) => {
    if (isElec(k, subjectId)) return [`${k}|*|${subjectId}`];
    const st = lessonStreams(l);
    return st ? st.map(s => `${k}|${s}|${subjectId}`) : [`${k}||${subjectId}`];
  };
  const targetToUnit = new Map();
  for (const g of unitGroups.values()) for (const a of g.rows) targetToUnit.set(rowTargetKey(g.k, a.streamId, a.subjectId), g.key);
  const subjectOf = l => (l.subjectId ? subjectById.get(l.subjectId) : null) || (l.subject ? subjectByName.get(l.subject.trim().toLowerCase()) : null);

  // ── Fixed lessons: everything outside the scope, locked lessons in it, and
  //    in-scope lessons the generator is NOT placing (a subject with no
  //    periods-per-week target, an assembly…). Only unlocked lessons of a
  //    target are replaced — a half-filled set of assignments must never
  //    wipe the rest of the timetable. ──
  const fixed = [];
  const replaceable = [];
  let untimedIgnored = 0;
  let keptInScope = 0;
  const lockedBy = new Map();   // unit group key → locked lesson periods already covering it
  for (const l of lessons) {
    const k = ck(l.classId);
    const inScope = scopeKeys.has(k);
    const subj = isLesson(l) ? subjectOf(l) : null;
    const tKeys = inScope && subj ? lessonTargetKeys(k, l, subj.id) : [];
    const unitKey = tKeys.map(t => targetToUnit.get(t)).find(Boolean) || null;
    if (inScope && !l.locked && unitKey) { replaceable.push(l); continue; }
    if (inScope && !l.locked) keptInScope += 1;
    let { startTime, endTime } = l;
    if (!startTime || !endTime) {
      // Old lessons saved without times: take them from the class's bell schedule.
      const c = classByKey.get(k);
      const p = c ? ((await bellFor(c)).periods || []).find(x => String(x.p) === String(l.period) && !x.isBreak) : null;
      if (p) { startTime = p.start; endTime = p.end; } else { untimedIgnored += 1; continue; }
    }
    // An in-scope elective lesson belongs to its option group, whatever stream it names.
    const gid = inScope && subj && isElec(k, subj.id) ? ensureGroup(k, subj.id, tk(l.teacherId)) : null;
    const st = gid ? null : lessonStreams(l);
    const audKey = gid || (inScope ? audienceForStreams(k, st) : null);
    fixed.push({
      day: l.day, start: startTime, end: endTime, classId: k,
      streamId: st && st.length === 1 ? st[0] : null, streamIds: st && st.length > 1 ? st : null, groupId: gid,
      teacherKey: tk(l.teacherId), coTeacherKeys: (l.coTeacherIds || []).map(tk).filter(Boolean),
      roomId: l.roomId || roomIdByName.get(String(l.room || '').trim().toLowerCase()) || null,
      audKey, subjectId: subj?.id || null,
    });
    if (inScope && l.locked && unitKey) lockedBy.set(unitKey, (lockedBy.get(unitKey) || 0) + 1);
  }
  if (keptInScope) add('warning', 'kept_lessons', `${keptInScope} unlocked lesson${keptInScope === 1 ? '' : 's'} in this scope ${keptInScope === 1 ? 'is for a subject' : 'are for subjects'} with no periods per week set, so ${keptInScope === 1 ? 'it stays' : 'they stay'} where ${keptInScope === 1 ? 'it is' : 'they are'} and the generator works around ${keptInScope === 1 ? 'it' : 'them'}.`);
  if (untimedIgnored) add('warning', 'untimed', `${untimedIgnored} lesson${untimedIgnored === 1 ? '' : 's'} ha${untimedIgnored === 1 ? 's' : 've'} a period that isn't in its class's bell schedule, so ${untimedIgnored === 1 ? 'it was' : 'they were'} ignored when checking for clashes.`);

  // ── Units: one per period to place, from each unit group ────
  const units = [];
  const unitInfo = {};
  let n = 0;
  for (const g of unitGroups.values()) {
    const { k, rows, elective } = g;
    const first = rows[0];
    const subj = subjectById.get(g.subjectId);
    const subjectName = first.subjectName || subj?.name || '';
    // Teachers: every row's teacher, main teacher first (by staff record, so two id forms of one person count once).
    const teacherRows = [];
    const seenT = new Set();
    for (const a of rows) { const key = tk(a.teacherId); if (key && !seenT.has(key)) { seenT.add(key); teacherRows.push(a); } }
    const teacherKeys = teacherRows.map(a => tk(a.teacherId));
    const names = teacherRows.map(a => a.teacherName || teacherName.get(tk(a.teacherId)) || '').filter(Boolean);
    // Streams (non-elective): every row's stream; a row with no stream means the whole class.
    const rowStreams = [...new Set(rows.map(a => a.streamId).filter(Boolean))].sort();
    const streams = elective || rows.some(a => !a.streamId) ? null : rowStreams;
    const together = rows.length > 1 && !!first.lessonGroupId;
    const label = together
      ? `${first.className || classByKey.get(k)?.name || k}${streams && streams.length ? ` ${streams.map(s => streamNameOf(s)).join(' + ')}` : ''} ${subjectName}${elective ? ' option' : ''} (${names.join(' & ') || 'no teacher'})`
      : rowLabel(first, k);
    const periodsPerWeek = Math.max(...rows.map(r => r.periodsPerWeek || 0));
    const doubleLessons = Math.max(...rows.map(r => r.doubleLessons || 0));
    if (rows.length > 1 && new Set(rows.map(r => r.periodsPerWeek)).size > 1) {
      add('warning', elective && !first.lessonGroupId ? 'elective_rows_differ' : 'group_rows_differ', `${label}: its ${rows.length} assignment rows set different periods per week; it is placed once, at ${periodsPerWeek} a week.`);
    }
    let audKey;
    let gid = null;
    if (elective) {
      gid = ensureGroup(k, g.subjectId, first.lessonGroupId ? `L:${first.lessonGroupId}` : tk(first.teacherId));
      audKey = groupAudience(gid, subjectName);
    } else {
      audKey = audienceForStreams(k, streams);
    }
    const locked = Math.min(lockedBy.get(g.key) || 0, periodsPerWeek);
    const remaining = periodsPerWeek - locked;
    const doubles = Math.min(doubleLessons, Math.floor(remaining / 2));
    const singles = remaining - doubles * 2;
    const enrolledCount = elective ? enrolledIn(elecInfo, k, g.subjectId).size : 0;
    const audSize = streams ? streams.reduce((s, sid) => s + (size.get(`${k}|${sid}`) || 0), 0) : (size.get(`${k}|`) || 0);
    const base = {
      audKey, classId: k,
      streamId: streams && streams.length === 1 ? streams[0] : null,
      streamIds: streams && streams.length > 1 ? streams : null,
      groupId: gid,
      subjectId: g.subjectId, subjectName,
      teacherKey: teacherKeys[0] || null, coTeacherKeys: teacherKeys.slice(1),
      requiredRoomType: subj?.requiredRoomType || null,
      preferredRoomId: first.preferredRoomId || null,
      // Home room: the stream's (one stream), else the class's. An option group or
      // combined streams use the class's when it is free (rooms are never double-booked).
      homeRoomId: (streams && streams.length === 1 ? homeRoom.get(`${k}|${streams[0]}`) : null) || homeRoom.get(`${k}|`) || null,
      classSize: elective ? (enrolledCount || null) : (audSize || null),
      isCore: coreIds.has(g.subjectId),
    };
    const info = {
      assignmentId: first.id, assignmentIds: rows.map(r => r.id), classId: k,
      streamId: base.streamId, streamIds: base.streamIds,
      subjectId: g.subjectId, subject: subjectName,
      teacherId: teacherRows[0]?.teacherId || null, teacherName: names[0] || '',
      coTeacherIds: teacherRows.slice(1).map(a => a.teacherId), coTeacherNames: names.slice(1),
      label,
      ...(elective ? { elective: true } : {}),
    };
    for (let d = 0; d < doubles; d++) { const id = `g${++n}`; units.push({ id, ...base, length: 2 }); unitInfo[id] = info; }
    for (let s = 0; s < singles; s++) { const id = `g${++n}`; units.push({ id, ...base, length: 1 }); unitInfo[id] = info; }
    if (doubles < doubleLessons) add('warning', 'doubles_trimmed', `${label}: fewer double lessons than set, because locked lessons already use some of its periods.`);
  }

  // ── Option groups: which can share a period, and which we can't tell ──
  const groupList = Object.entries(groups);
  for (const [gid, g] of groupList) {
    for (const [gid2, g2] of groupList) {
      if (gid !== gid2 && g.classK === g2.classK && canShareSlot(elecInfo, g.classK, g.subjectId, g2.subjectId)) g.shareWith.push(gid2);
    }
  }
  const unknownEnrolment = [...new Set(groupList
    .filter(([, g]) => !enrolledIn(elecInfo, g.classK, g.subjectId).size)
    .map(([, g]) => `${classByKey.get(g.classK)?.name || g.classK} ${subjectById.get(g.subjectId)?.name || g.subjectId}`))];
  if (unknownEnrolment.length) {
    add('warning', 'elective_no_enrolment', `No students are recorded as taking ${unknownEnrolment.slice(0, 5).join(', ')}${unknownEnrolment.length > 5 ? '…' : ''} (Students → Subjects), so ${unknownEnrolment.length === 1 ? 'it is' : 'they are'} kept apart from every other lesson of the class instead of sharing periods with other options.`);
  }
  if (missing.length) {
    add('warning', 'no_target', `${missing.length} teaching assignment${missing.length === 1 ? ' has' : 's have'} no periods per week set and will be left out: ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? '…' : ''}`);
  }
  if (!units.length) add('error', 'nothing_to_place', 'Nothing to place: no teaching assignment in this scope has periods per week set (Teachers → Assignments).');

  // ── Unavailable times ───────────────────────────────────────
  const unavailable = {};
  for (const a of availability) if (a.blocks?.length) unavailable[String(a.teacherId)] = a.blocks;

  // ── Pre-check: things that can't fit ────────────────────────
  // Per class / stream: periods needed vs periods it has. A whole-class lesson
  // counts for every stream; a combined-streams lesson for each of its streams.
  const streamsOfX = x => (x.streamIds && x.streamIds.length ? x.streamIds : (x.streamId ? [x.streamId] : null));
  for (const [classK, cs] of classSlots) {
    const c = classByKey.get(classK);
    const isWhole = x => !x.groupId && !streamsOfX(x);
    const whole = units.filter(u => u.classId === classK && isWhole(u)).reduce((s, u) => s + u.length, 0)
      + fixed.filter(f => f.classId === classK && isWhole(f) && f.audKey).length;
    // Option groups: a lower bound only — the busiest group touching the
    // stream must fit too (groups that share a period can't add up). An
    // error here means it surely can't fit; it never over-reports.
    const groupNeed = Object.entries(groups).filter(([, g]) => g.classK === classK).map(([gid, g]) => ({
      streams: g.streams,
      need: units.filter(u => u.groupId === gid).reduce((s, u) => s + u.length, 0) + fixed.filter(f => f.groupId === gid).length,
    }));
    const maxGroup = sid => Math.max(0, ...groupNeed.filter(g => !sid || !g.streams || g.streams.includes(sid)).map(g => g.need));
    const streamIds = [...new Set(units.filter(u => u.classId === classK && !u.groupId).flatMap(u => streamsOfX(u) || []))];
    const check = (label, need) => {
      if (need > cs.slots.length) add('error', 'class_overfull', `${label} needs ${need} lessons a week but has only ${cs.slots.length} periods.`);
    };
    if (!streamIds.length) check(c?.name || classK, whole + maxGroup(null));
    for (const sid of streamIds) {
      const has = x => !x.groupId && (streamsOfX(x) || []).includes(sid);
      const own = units.filter(u => u.classId === classK && has(u)).reduce((s, u) => s + u.length, 0)
        + fixed.filter(f => f.classId === classK && has(f) && f.audKey).length;
      check(`${c?.name || classK} ${streamNameOf(sid)}`, whole + own + maxGroup(sid));
    }
    if (units.some(u => u.classId === classK && u.length === 2) && !cs.doubleStarts.length) {
      add('error', 'no_doubles', `${c?.name || classK} has double lessons but no two back-to-back periods without a break between them.`);
    }
  }
  // Per teacher (a co-taught lesson needs every one of its teachers): lessons
  // needed here vs periods in the week they could teach.
  const teachersOfX = x => [x.teacherKey, ...(x.coTeacherKeys || [])].filter(Boolean);
  const teacherNeed = new Map();
  for (const u of units) for (const t of teachersOfX(u)) teacherNeed.set(t, (teacherNeed.get(t) || 0) + u.length);
  for (const [t, need] of teacherNeed) {
    // Exact count (v5.269.2): the distinct periods of the classes they'd
    // teach here, minus times they marked unavailable and minus times they
    // already teach a lesson that stays (elsewhere, or locked).
    const busy = fixed.filter(f => teachersOfX(f).includes(t));
    const blocks = unavailable[t] || [];
    const times = new Map();
    for (const u of units.filter(x => teachersOfX(x).includes(t))) for (const s of audiences[u.audKey].slots) times.set(`${s.day}|${s.start}|${s.end}`, s);
    let blockedByLessons = 0;
    let free = 0;
    for (const s of times.values()) {
      if (blocks.some(b => b.day === s.day && s.start < b.end && s.end > b.start)) continue;
      if (busy.some(f => f.day === s.day && s.start < f.end && s.end > f.start)) { blockedByLessons += 1; continue; }
      free += 1;
    }
    if (need > free) {
      add('error', 'teacher_overfull', `${teacherName.get(t) || 'A teacher'} needs ${need} lessons a week here but is free for only ${free} of these classes' periods${blockedByLessons ? ` (${blockedByLessons} ${blockedByLessons === 1 ? 'is' : 'are'} taken by lessons that stay)` : ''}${blocks.length ? ', after unavailable times' : ''}.`);
    }
  }
  // Subject time rules (v5.270.0): a subject's lessons must fit in the periods its rules allow.
  if (rules.subjectTimes?.on && (rules.subjectTimes.items || []).length) {
    const seen = new Set();
    for (const u of units) {
      const key = u.audKey + '|' + u.subjectId;
      if (seen.has(key)) continue;
      seen.add(key);
      const mine = units.filter(x => x.audKey === u.audKey && x.subjectId === u.subjectId);
      const need = mine.reduce((s, x) => s + x.length, 0);
      const allowed = audiences[u.audKey].slots.filter(s => !subjectTimeBlock(rules, u.subjectId, s.day, s.dayPos + 1)).length;
      if (allowed < audiences[u.audKey].slots.length && need > allowed) {
        add('error', 'subject_time_overfull', `${audiences[u.audKey].label} ${u.subjectName}: needs ${need} lessons a week but its time rules (Days & rules) leave only ${allowed} periods.`);
      }
    }
  }

  // Classes whose ordinary lessons will have no room (no home room, no preferred room).
  const roomless = [...new Set(units
    .filter(u => !u.requiredRoomType && !u.homeRoomId && !(u.preferredRoomId && rules.usePreferredRooms?.on))
    .map(u => audiences[u.audKey]?.label || u.classId))];
  if (roomless.length) {
    add('warning', 'no_home_room', `${roomless.slice(0, 6).join(', ')}${roomless.length > 6 ? '…' : ''} ha${roomless.length === 1 ? 's' : 've'} no home room, so ${roomless.length === 1 ? 'its' : 'their'} ordinary lessons will be placed without a room. Set one under Timetable → Rooms → edit a room → Home room for.`);
  }
  // Room types nobody registered.
  const neededTypes = [...new Set(units.map(u => u.requiredRoomType).filter(Boolean))];
  for (const type of neededTypes) {
    if (!roomList.some(r => r.type === type)) {
      const subjectsNeeding = [...new Set(units.filter(u => u.requiredRoomType === type).map(u => u.subjectName))].join(', ');
      add('error', 'no_room_type', `${subjectsNeeding} need${subjectsNeeding.includes(',') ? '' : 's'} a room of type "${type}", but none is registered (Timetable → Rooms).`);
    }
  }

  const problem = {
    days: workingDays, audiences, units, fixed, unavailable, rooms: roomList, rules,
    groups: Object.fromEntries(Object.entries(groups).map(([gid, g]) => [gid, { streams: g.streams, shareWith: g.shareWith }])),
  };
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
