/* ============================================================
   Msingi — mobile scenario seed

   The demo school already holds 26 students, 10 teacher accounts and a
   full academic term, but every portal login was cut from the same cloth:
   one parent with one child, five students who all sit mid-term in
   Form 1A/2A with nothing unusual on their record. The phone screens
   branch on states no such account can reach — two children to switch
   between, a child the office has not linked yet, a class with no teacher
   named, a week the school has not summarised, a term behind on coverage.

   This file adds those states, once each, as named personas:

     users             student + parent logins, a two-child parent, a
                       parent with no child linked
     syllabus_topics   the topic list coverage is measured against
     lesson_coverage   lessonsCoverage on the student dashboard
     attendance        the last three school weeks, per persona profile
     weekly_snapshots  the frozen digest the student screen renders
     messages          parent + teacher inboxes, unread badges, a group
     announcements     the student and parent notice boards
     classes           formTeacherId, so "class teacher" has a name
     students          className, so "Form 1A" has a name

   It runs LAST in seedDemo(), after seed-demo-data.js and after that
   function's own portal-linking step, because it deliberately overwrites
   which student `demo-student` and `parent@demo.msingi.io` point at (see
   _portalAccounts for why the old pick was not the one documented).

   Re-runnable by design: every document has a fixed id or a fixed natural
   key and its content is forced with $set, so a second run restores the
   documented state instead of drifting. DEMO-SCENARIOS.md is the contract
   for what each persona proves — change a number here and change it there.

   A weekly snapshot is a frozen document in production too (the cron
   writes a week once and never revisits it), so its sections are authored
   here rather than derived at read time. The rows inside them are real:
   topics come from the lesson_coverage rows below, marks from
   assessment_marks already in the markbook, attendance/behaviour/library
   from the seeded records — so a snapshot and the live dashboard agree.
   ============================================================ */
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const { _model } = require('../utils/model');

const SCHOOL_ID = 'sch_demo';
const ADMIN_ID  = 'u_demo_admin';

/* Same literal as seed-demo.js's DEMO_PASSWORD and seed-demo-data.js's
   _hash(); every demo account shares it on purpose so the login sheet is
   one line long. */
const PASSWORD = 'Demo2025!';

/* ════════════════════════════════════════════════════════════════
   Personas
   ════════════════════════════════════════════════════════════════ */

/* `login` is exactly what a student types: the admission number,
   lower-cased — POST /api/auth/login matches `identifier` against
   users.username. `userId` reuses the accounts the older seed blocks
   already create, so no login on the sheet has a shadow twin. */
const STUDENT_PERSONAS = [
  { userId: 'u_demo_student', studentId: 'std_demo_1',  login: 'demo-student',   attendance: 'perfect', growth: true,
    note: 'baseline — full attendance, fees clear, one growth entry' },
  { userId: 'u_demo_s2',      studentId: 'std_demo_2',  login: 'adm-2026-00002', attendance: 'steady',
    note: 'half the fees paid, library book overdue, two demerits, parent has TWO children' },
  { userId: 'u_demo_s3',      studentId: 'std_demo_3',  login: 'adm-2026-00003', attendance: 'steady',
    note: 'nothing paid at all' },
  { userId: 'u_demo_s4',      studentId: 'std_demo_4',  login: 'adm-2025-00012', attendance: 'perfect',
    note: 'fees clear, boarder, on the bus route' },
  { userId: 'u_demo_s5',      studentId: 'std_demo_5',  login: 'adm-2025-00015', attendance: 'steady',
    note: 'fees clear, book returned' },
  { userId: 'u_scn_std_9',    studentId: 'std_demo_9',  login: 'adm-2024-00011', attendance: 'late',
    note: 'behaviour negative (-15 bullying, then a neutral counselling entry)' },
  { userId: 'u_scn_std_14',   studentId: 'std_demo_14', login: 'adm-2026-00012', attendance: 'weak',
    note: 'absent-heavy, nothing paid, and the one class with no teacher assigned' },
  { userId: 'u_scn_std_20',   studentId: 'std_demo_20', login: 'adm-2024-00028', attendance: 'steady',
    note: 'primary section, part-paid, no growth entries (hidden section)' },
  { userId: 'u_scn_std_26',   studentId: 'std_demo_26', login: 'adm-2024-00047', attendance: 'perfect',
    note: 'A-Level section — its own subjects and grade scale' },
  /* Faith is John Mwangi's second child. She gets no login of her own — her
     record exists so the parent's child switcher opens a second real week
     instead of an empty shell. */
  { userId: null,             studentId: 'std_demo_13', login: null, attendance: 'late',
    note: 'no portal account; reached only through the two-child parent' },
];

const PARENT_PERSONAS = [
  /* u_demo_parent used to follow seed-demo.js's "lowest admission number"
     pick, which is ADM-2023-00003 — Brian Onyango, Form 4A — not the
     std_demo_1 the comment claims. Pinned here so parent and student
     logins describe one family, as documented.

     Each email below is that child's guardian in the students table, so the
     web and the phone tell one story — except u_demo_p6, whose name appears
     nowhere else: she is the "office opened my account, nobody has linked my
     child yet" login, and borrowing a real guardian's address for her would
     make the empty state look like a bug. */
  { userId: 'u_demo_parent', email: 'parent@demo.msingi.io',    name: 'Demo Parent',   children: ['std_demo_1'], note: 'one child, everything clear' },
  { userId: 'u_demo_p2',     email: 'john.mwangi@gmail.com',    name: 'John Mwangi',   children: ['std_demo_2', 'std_demo_13'], note: 'TWO children in different classes — drives the child switcher, and both owe money' },
  { userId: 'u_demo_p3',     email: 'hassan.omar@gmail.com',    name: 'Hassan Omar',   children: ['std_demo_3'], note: 'child owing the whole term' },
  { userId: 'u_demo_p4',     email: 'kipchoge.mutai@yahoo.com', name: 'Kipchoge Mutai', children: ['std_demo_4'], note: 'boarder, fees clear' },
  { userId: 'u_demo_p5',     email: 'peter.waweru@gmail.com',   name: 'Peter Waweru',  children: ['std_demo_5'], note: 'fees clear' },
  { userId: 'u_demo_p6',     email: 'miriam.njoki@gmail.com',   name: 'Miriam Njoki',  children: [],             note: 'account issued, NO child linked yet — empty state + link-child flow' },
  { userId: 'u_demo_p7',     email: 'beatrice.auma@gmail.com',  name: 'Beatrice Auma', children: ['std_demo_14'], note: 'the absent-heavy child, nothing paid' },
  { userId: 'u_demo_p8',     email: 'daniel.wekesa@gmail.com',  name: 'Daniel Wekesa', children: ['std_demo_20'], note: 'primary, part-paid' },
  { userId: 'u_demo_p9',     email: 'hussein.ali@yahoo.com',    name: 'Hussein Ali',   children: ['std_demo_26'], note: 'A-Level' },
];

/* The Mwangi children are siblings, so std_demo_13's guardian fields must
   read the same as std_demo_2's or the family is incoherent on the web. */
const SIBLING_PATCHES = [
  { studentId: 'std_demo_13', patch: { parentName: 'Mr. John Mwangi', parentEmail: 'john.mwangi@gmail.com', parentPhone: '+254 722 001 002' } },
];

/* Teacher logins are the accounts seed-demo-data.js already creates — named
   in DEMO-SCENARIOS.md rather than re-seeded here. */

/* ════════════════════════════════════════════════════════════════
   Reference data
   ════════════════════════════════════════════════════════════════ */

/* Day indexes count from the Monday of the first seeded week, so one
   profile describes the whole three-week stretch. authorised_absence is
   separate from absent because the student screen gives them each a tile. */
const ATTENDANCE_PROFILES = {
  perfect: { absent: [],            late: [],            authorised: [] },
  steady:  { absent: [8],           late: [2],           authorised: [] },
  late:    { absent: [],            late: [0, 2, 5, 8, 11], authorised: [] },
  weak:    { absent: [0, 1, 4, 7, 10, 12], late: [3, 6], authorised: [9] },
};

const STATUS_NOTES = {
  absent: 'Did not report to school.',
  late: 'Arrived after roll call.',
  authorised_absence: 'Absence authorised by guardian.',
  present: '',
};

/* Four topics per subject; the nth subject of a class has n of them marked
   as taught, which walks the Learning tab through 100 / 75 / 50 / 25 %
   without any random numbers that would need explaining. */
const TOPIC_STEMS = {
  subj_demo_math:  ['Algebraic expressions', 'Fractions and decimals', 'Geometry: angles and lines', 'Statistics: collecting data'],
  subj_demo_eng:   ['Reading for inference', 'Parts of speech in context', 'Narrative writing', 'Comprehension: unseen prose'],
  subj_demo_kisw:  ['Mtazamo na mwelekeo', 'Insha: simulizi', 'Isimu na ufafanuzi', 'Ufahamu: muchomo'],
  subj_demo_sci:   ['Living things and habitats', 'Forces and motion', 'Matter and its states', 'The human body'],
  subj_demo_phy:   ['Measurement and units', 'Linear motion', 'Waves and sound', 'Electrical basics'],
  subj_demo_chem:  ['Structure of the atom', 'Acids, bases and salts', 'Separating mixtures', 'Organic chemistry intro'],
  subj_demo_bio:   ['Cell biology', 'Digestion and absorption', 'Ecology and food webs', 'Respiration'],
  subj_demo_hist:  ['Sources of historical knowledge', 'Early trade routes', 'Colonial administration', 'Independence movements'],
  subj_demo_geo:   ['Maps and map interpretation', 'Physical landforms', 'Weather and climate', 'Population studies'],
  subj_demo_cre:   ['Sacred writings', 'Community responsibility', 'Work and stewardship', 'Festival calendar'],
  subj_demo_pmath: ['Functions and graphs', 'Trigonometric ratios', 'Sequences and series', 'Differentiation basics'],
  subj_demo_mech:  ['Vectors and equilibrium', 'Projectiles', 'Circular motion', 'Simple harmonic motion'],
  subj_demo_stat:  ['Data representation', 'Permutations and combinations', 'Probability distributions', 'Hypothesis testing'],
  subj_demo_eco:   ['Demand and supply', 'Market structures', 'National income', 'Money and banking'],
  subj_demo_bs:    ['Business environment', 'Book-keeping basics', 'Marketing mix', 'Small business finance'],
  subj_demo_ict:   ['Computer systems', 'Spreadsheet modelling', 'Networks and safety', 'Programming fundamentals'],
  subj_demo_pe:    ['Fitness and training', 'Athletics technique', 'Team games tactics', 'Sports first aid'],
  subj_demo_ss:    ['Community life', 'Governance and citizenship', 'Environment and resources', 'Economic activities'],
};
const TOPICS_PER_SUBJECT = 4;

/* classes.formTeacherId holds a teachers-collection id, which is what both
   portals resolve a class teacher's name from. Standard 4A is left unset on
   purpose — that is the persona that proves the "Not assigned yet" row. */
const FORM_TEACHERS = {
  cls_demo_f1a: 'tch_demo_3',
  cls_demo_f2a: 'tch_demo_4',
  cls_demo_f3a: 'tch_demo_5',
  cls_demo_6a:  'tch_demo_6',
  cls_demo_f6a: 'tch_demo_8',
};

/* ════════════════════════════════════════════════════════════════
   Date helpers — string math on 'YYYY-MM-DD', UTC-anchored, and the same
   Monday rule the snapshot cron uses (_mondayOnOrBefore in
   utils/weekly-snapshot-cron.js). weekStart is matched by exact string
   equality on read, so a Date or an ISO instant here 404s the detail route.
   ════════════════════════════════════════════════════════════════ */
function _dayStr(d) { return d.toISOString().slice(0, 10); }

function _addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return _dayStr(d);
}

function _mondayOnOrBefore(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return _dayStr(d);
}

/** The `count` most recently finished weeks, newest first — the weeks
    Saturday's cron would already have written, so a reviewer opens a
    complete week rather than one still in progress. */
function _lastCompletedMondays(count) {
  const thisMonday = _mondayOnOrBefore(_dayStr(new Date()));
  return Array.from({ length: count }, (_, i) => _addDays(thisMonday, -7 * (i + 1)));
}

/** Mon–Fri of a snapshot week. */
function _schoolDays(weekStart) {
  return [0, 1, 2, 3, 4].map(i => _addDays(weekStart, i));
}

/* ════════════════════════════════════════════════════════════════
   Write helpers
   ════════════════════════════════════════════════════════════════ */

/* Force-by-id: a re-run restores the documented content. timestamps:false
   because setting updatedAt in the same update object while Mongoose also
   stamps it makes MongoDB reject the path conflict — see upsert() in
   seed-demo-data.js, which took the whole seed down that way at the library
   step. */
function _put(Model, id, data) {
  const now = new Date().toISOString();
  return Model.updateOne(
    { id },
    { $set: { ...data, updatedAt: now }, $setOnInsert: { id, createdAt: now } },
    { upsert: true, timestamps: false }
  );
}

/* Attendance and coverage have a natural key the API itself upserts on, and
   rows may already exist from the term seed. Match on that key and mint the
   id only on insert, so the scenario overwrites the real row instead of
   shadowing it with a second one for the same day. */
function _putBy(Model, filter, id, data) {
  const now = new Date().toISOString();
  return Model.updateOne(
    { ...filter, schoolId: SCHOOL_ID },
    { $set: { ...data, updatedAt: now }, $setOnInsert: { id, schoolId: SCHOOL_ID, createdAt: now } },
    { upsert: true, timestamps: false }
  );
}

/* ════════════════════════════════════════════════════════════════
   Academic year — the one thing here that can silently undo the rest

   student-portal.js filters topics and coverage on `academicYear`, taken
   from resolveCurrentPeriod(years).name — i.e. the FIRST academic_years doc
   flagged isCurrent. seed-demo.js flags a new year every January but never
   unflags the previous one, so a leftover second flag makes the read path
   resolve last year's name and every coverage row written here invisible.
   This clears the flag school-wide before anything keys off it.

   schools.academicYear is then set to the same string because the teacher
   WRITE path (lessons.js POST /coverage) keys off that field while the
   student read path keys off the resolved year name. With the cached field
   unset the two disagree: a teacher logging a lesson in the demo writes
   "2026", the student dashboard asks for "2026–2027", and the coverage bar
   never moves.
   ════════════════════════════════════════════════════════════════ */
async function _resolveAcademicYear() {
  const Years = _model('academic_years');
  const all   = await Years.find({ schoolId: SCHOOL_ID }).lean();
  if (!all.length) return null;

  const today = _dayStr(new Date());
  const current =
    all.find(y => y.startDate <= today && y.endDate >= today) ??
    all.find(y => y.isCurrent) ??
    [...all].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];

  await Years.updateOne({ schoolId: SCHOOL_ID, id: current.id }, { $set: { isCurrent: true } });
  await Years.updateMany(
    { schoolId: SCHOOL_ID, id: { $ne: current.id }, isCurrent: true },
    { $set: { isCurrent: false } }
  );
  await _model('schools').updateOne(
    { id: SCHOOL_ID },
    { $set: { academicYear: current.name } }
  );

  return current;
}

/* ════════════════════════════════════════════════════════════════
   Portal accounts
   ════════════════════════════════════════════════════════════════ */
async function _portalAccounts(hash) {
  const Users    = _model('users');
  const Students = _model('students');

  const rows = await Students
    .find({ id: { $in: STUDENT_PERSONAS.map(p => p.studentId) }, schoolId: SCHOOL_ID })
    .select('id firstName lastName classId').lean();
  const rowById = new Map(rows.map(r => [r.id, r]));

  let logins = 0;
  for (const persona of STUDENT_PERSONAS) {
    if (!persona.userId) continue;   // data-only persona, no login to mint
    const row = rowById.get(persona.studentId);
    if (!row) {
      console.warn(`[seed-scenarios] student ${persona.studentId} missing — no login for it.`);
      continue;
    }
    /* No `email` field at all: the unique {schoolId,email} index is partial
       on $type:'string', so email-less student accounts never collide — but
       writing email:null keeps the null in the document for nothing. */
    await _put(Users, persona.userId, {
      schoolId: SCHOOL_ID,
      name: `${row.firstName} ${row.lastName}`.trim(),
      username: persona.login,
      password: hash,
      role: 'student', primaryRole: 'student', roles: ['student'],
      studentId: persona.studentId,
      isActive: true, mustChangePassword: false,
      passwordChangedAt: new Date().toISOString(),
    });
    await Students.updateOne({ id: persona.studentId, schoolId: SCHOOL_ID },
      { $set: { hasPortalAccount: true } });
    logins++;
  }

  for (const parent of PARENT_PERSONAS) {
    await _put(Users, parent.userId, {
      schoolId: SCHOOL_ID,
      name: parent.name,
      email: parent.email,
      password: hash,
      role: 'parent', primaryRole: 'parent', roles: ['parent'],
      studentIds: parent.children,
      guardianOf: parent.children,
      isActive: true, mustChangePassword: false,
      passwordChangedAt: new Date().toISOString(),
    });
    if (parent.children.length) {
      await Students.updateMany({ id: { $in: parent.children }, schoolId: SCHOOL_ID },
        { $set: { hasParentAccount: true } });
    }
  }

  for (const { studentId, patch } of SIBLING_PATCHES) {
    await Students.updateOne({ id: studentId, schoolId: SCHOOL_ID }, { $set: patch });
  }

  /* Re-pointing `demo-student` orphans the pick seed-demo.js made before it:
     that student still reads hasPortalAccount:true in the web list while no
     account points at it any more. Rebuild the flags from the accounts that
     actually exist, so "reset portal password" is never offered for a student
     with nothing to reset. */
  const portalUsers = await Users
    .find({ schoolId: SCHOOL_ID })
    .select('studentId studentIds').lean();
  const linkedIds = new Set();
  for (const u of portalUsers) {
    if (typeof u.studentId === 'string') linkedIds.add(u.studentId);
    for (const sid of u.studentIds ?? []) linkedIds.add(sid);
  }
  await Students.updateMany(
    { schoolId: SCHOOL_ID, id: { $nin: [...linkedIds] }, $or: [{ hasPortalAccount: true }, { hasParentAccount: true }] },
    { $set: { hasPortalAccount: false, hasParentAccount: false } }
  );

  return { students: logins, parents: PARENT_PERSONAS.length, records: rowById.size };
}

/* ════════════════════════════════════════════════════════════════
   Class teacher labels
   ════════════════════════════════════════════════════════════════ */
/* `students.className` is a denormalised display copy the real write path
   maintains (students.js:848 stamps it whenever a class changes) and the
   students list backfills at read time — but the student dashboard selects
   the field straight off the document, so a seeded student that never had it
   renders no class label anywhere. Stamp it school-wide from classes.name. */
async function _denormaliseClassNames() {
  const Students = _model('students');
  const classes  = await _model('classes').find({ schoolId: SCHOOL_ID }).select('id name').lean();
  const nameOf   = new Map(classes.map(c => [c.id, c.name]));

  const orphans = new Set();
  const rows = await Students.find({ schoolId: SCHOOL_ID }).select('id classId className').lean();
  let written = 0;
  for (const s of rows) {
    const name = nameOf.get(s.classId);
    if (!name) { if (s.classId) orphans.add(s.classId); continue; }
    if (s.className === name) continue;
    await Students.updateOne({ id: s.id, schoolId: SCHOOL_ID }, { $set: { className: name } });
    written++;
  }
  if (orphans.size) {
    console.warn(`[seed-scenarios] students point at classIds with no classes doc: ${[...orphans].join(', ')}`);
  }
  return written;
}

async function _classTeachers() {
  const Classes  = _model('classes');
  const Teachers = _model('teachers');

  const rows = await Teachers
    .find({ id: { $in: Object.values(FORM_TEACHERS) }, schoolId: SCHOOL_ID })
    .select('id firstName lastName title').lean();
  const byId = new Map(rows.map(r => [r.id, r]));

  let set = 0;
  for (const [classId, teacherId] of Object.entries(FORM_TEACHERS)) {
    const t = byId.get(teacherId);
    if (!t) continue;
    await Classes.updateOne(
      { id: classId, schoolId: SCHOOL_ID },
      { $set: { formTeacherId: teacherId, formTeacherName: `${t.title} ${t.firstName} ${t.lastName}`.trim() } }
    );
    await Teachers.updateOne({ id: teacherId, schoolId: SCHOOL_ID }, { $set: { formClassId: classId } });
    set++;
  }
  return set;
}

/* ════════════════════════════════════════════════════════════════
   Curriculum — topics to teach, coverage of the ones taught
   ════════════════════════════════════════════════════════════════ */
async function _curriculum(yearName, weeks, classIds) {
  const ClassSubjects = _model('class_subjects');
  const Subjects      = _model('subjects');
  const Topics        = _model('syllabus_topics');
  const Coverage      = _model('lesson_coverage');
  const Classes       = _model('classes');
  const Teachers      = _model('teachers');

  const classDocs   = await Classes.find({ id: { $in: classIds }, schoolId: SCHOOL_ID }).select('id name').lean();
  const className   = new Map(classDocs.map(c => [c.id, c.name]));
  const allSubjects = await Subjects.find({ schoolId: SCHOOL_ID }).select('id name').lean();
  const subjectById = new Map(allSubjects.map(s => [s.id, s]));

  /* Attributed per subject from the teachers collection's own subjects[] so
     the name on a coverage row is someone who actually teaches it. */
  const teacherRows = await Teachers.find({ schoolId: SCHOOL_ID }).select('title firstName lastName subjects').lean();
  const teacherFor = (subjectId) => {
    const t = teacherRows.find(tr => Array.isArray(tr.subjects) && tr.subjects.includes(subjectId));
    return t ? { id: t.id, name: `${t.title} ${t.firstName} ${t.lastName}`.trim() } : null;
  };

  const schoolDays = weeks.flatMap(_schoolDays);
  let topics = 0, coverage = 0;

  for (const [classIdx, classId] of classIds.entries()) {
    const offered = await ClassSubjects
      .find({ schoolId: SCHOOL_ID, classId, isActive: true }).select('subjectId').lean();
    const subjectIds = [...new Set(offered.map(o => o.subjectId))].slice(0, 4);
    const shortClass = classId.replace('cls_demo_', '');

    for (const [subjectIdx, subjectId] of subjectIds.entries()) {
      const subject = subjectById.get(subjectId);
      if (!subject) continue;
      const stems = TOPIC_STEMS[subjectId] ??
        Array.from({ length: TOPICS_PER_SUBJECT }, (_, i) => `${subject.name} — unit ${i + 1}`);
      const shortSubject = subjectId.replace('subj_demo_', '');
      const teacher = teacherFor(subjectId);

      for (let t = 0; t < TOPICS_PER_SUBJECT; t++) {
        await _put(Topics, `topic_scn_${shortClass}_${shortSubject}_${t + 1}`, {
          schoolId: SCHOOL_ID,
          classId, subjectId,
          subjectName: subject.name,
          academicYear: yearName,
          title: stems[t],
          description: '',
          order: t,
          subtopics: [],
          createdBy: ADMIN_ID, updatedBy: ADMIN_ID,
        });
        topics++;
      }

      /* nth subject of the class has n of its four topics taught.
         No streamId key at all on these rows: the student read path asks for
         { streamId: { $exists: false } }, and a present-but-null streamId
         does NOT satisfy $exists:false — the row silently disappears from the
         dashboard while still counting on the teacher's own screen. */
      const taught = (classIdx + subjectIdx) % TOPICS_PER_SUBJECT + 1;
      for (let c = 0; c < taught; c++) {
        const topicId = `topic_scn_${shortClass}_${shortSubject}_${c + 1}`;
        const coveredAt = schoolDays[(classIdx * 3 + subjectIdx * TOPICS_PER_SUBJECT + c) % schoolDays.length];
        await _putBy(
          Coverage,
          { classId, subjectId, topicId, academicYear: yearName },
          `lc_scn_${shortClass}_${shortSubject}_${c + 1}`,
          {
            teacherId:   teacher?.id ?? ADMIN_ID,
            teacherName: teacher?.name ?? 'Demo Teacher',
            className:   className.get(classId) ?? classId,
            subjectName: subject.name,
            topicTitle:  stems[c],
            coveredAt,
            notes: '',
            createdBy: ADMIN_ID, updatedBy: ADMIN_ID,
          }
        );
        coverage++;
      }
    }
  }
  return { topics, coverage, classes: classIds.length };
}

/* ════════════════════════════════════════════════════════════════
   Attendance — the last three school weeks, per persona profile
   ════════════════════════════════════════════════════════════════ */
function _statusesFor(persona) {
  const p = ATTENDANCE_PROFILES[persona.attendance] ?? ATTENDANCE_PROFILES.steady;
  const total = 15;
  const marks = {};
  for (const [key, idxs] of Object.entries({ absent: p.absent, late: p.late, authorised_absence: p.authorised })) {
    for (const i of idxs) marks[i % total] = key;
  }
  return Array.from({ length: total }, (_, i) => marks[i] ?? 'present');
}

async function _attendance(yearName, weeks) {
  const Attendance = _model('attendance');
  const rows = await _model('students')
    .find({ id: { $in: STUDENT_PERSONAS.map(p => p.studentId) }, schoolId: SCHOOL_ID })
    .select('id classId').lean();
  const classOf = new Map(rows.map(r => [r.id, r.classId]));

  const out = [];
  for (const persona of STUDENT_PERSONAS) {
    const all = _statusesFor(persona);
    const weeksOut = {};

    weeks.forEach((weekStart, wi) => {
      const days = _schoolDays(weekStart);
      const records = days.map((date, di) => {
        const status = all[wi * 5 + di];
        return { date, status, period: 'AM', note: STATUS_NOTES[status] };
      });
      weeksOut[weekStart] = records;
    });

    for (const records of Object.values(weeksOut)) {
      for (const r of records) {
        await _putBy(Attendance, { studentId: persona.studentId, date: r.date, period: 'AM' },
          `att_scn_${persona.studentId.replace('std_demo_', '')}_${r.date}`, {
            studentId: persona.studentId,
            classId: classOf.get(persona.studentId) ?? null,
            date: r.date,
            period: 'AM',
            status: r.status,
            subjectId: null,
            note: r.note,
            /* academicYear is stamped because both portals' attendance widget
               filters on it (student-portal.js:110, parent-portal.js:221) —
               and it is the resolved year NAME, not a number. No other
               consumer needs it: attendance.js's own write path never sets
               it, which is why the teacher portal counts by `date` instead
               (see teacher-portal.js:281) and why the two portal reads above
               report 0% for a school whose register is real. Nothing written
               here fixes that for rows a teacher marks from the app — it only
               makes the demo's own numbers show. */
            academicYear: yearName,
            markedBy: ADMIN_ID, updatedBy: ADMIN_ID, createdBy: ADMIN_ID,
          });
      }
    }
    out.push({ studentId: persona.studentId, weeksOut });
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════
   Weekly snapshots
   ════════════════════════════════════════════════════════════════ */
/* The seven keys are the shape _emptySections() in the cron writes, and the
   PDF renderer dereferences every one of them without a guard — a doc
   missing a key 200s on the JSON route and 500s on /pdf. */
function _attendanceCounters(records) {
  const counters = {
    present: 0, absent: 0, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0,
    total: records.length,
  };
  for (const r of records) {
    if (r.status === 'present')             counters.present++;
    else if (r.status === 'absent')         counters.absent++;
    else if (r.status === 'late')           counters.late++;
    else if (r.status === 'authorised_absence') counters.authorisedAbsence++;
    else if (r.status === 'excluded')       counters.excluded++;
    else if (r.status === 'holiday')        counters.holiday++;
  }
  return counters;
}

async function _snapshots(weeks, attendanceRows, classIds) {
  const Snapshots = _model('weekly_snapshots');
  const Coverage  = _model('lesson_coverage');
  const Marks     = _model('assessment_marks');
  /* behaviour_incidents, NOT behaviour: the first is where behaviour.js:515
     stores what a school logs; 'behaviour' is written by nobody and holds 0
     documents in every database. The three portal dashboards used to read it
     anyway — fixed, and weekly-snapshot-aggregate.js:147 (production's own
     snapshot builder) is the mapping this one copies.
     The demo incidents predate category/itemLabel, so the labels are derived
     here rather than passed through: an unlabelled strip would prove nothing. */
  const Behaviour = _model('behaviour_incidents');
  const Loans     = _model('library_loans');

  const students = await _model('students')
    .find({ id: { $in: STUDENT_PERSONAS.map(p => p.studentId) }, schoolId: SCHOOL_ID })
    .select('id firstName lastName classId').lean();
  const classNames = new Map((await _model('classes')
    .find({ id: { $in: classIds }, schoolId: SCHOOL_ID }).select('id name').lean())
    .map(c => [c.id, c.name]));

  /* Coverage is class-wide, so one read per class serves every student in
     it. Dates are compared as 'YYYY-MM-DD' strings, exactly as the
     aggregate does for plain date fields. */
  const coverageOf = new Map();
  for (const classId of classIds) {
    const rows = await Coverage.find({ schoolId: SCHOOL_ID, classId })
      .select('subjectId subjectName topicId topicTitle coveredAt teacherName').lean();
    for (const weekStart of weeks) {
      const days = new Set(_schoolDays(weekStart));
      coverageOf.set(`${classId}|${weekStart}`, rows
        .filter(r => days.has(String(r.coveredAt).slice(0, 10)))
        .map(r => ({
          subjectId: r.subjectId, subjectName: r.subjectName,
          topicId: r.topicId, topicTitle: r.topicTitle,
          subtopicId: null, subtopicTitle: null,
          coveredAt: r.coveredAt, teacherName: r.teacherName, notes: '',
        })));
    }
  }

  const marksOf = new Map();
  const behaviourOf = new Map();
  const loansOf = new Map();
  for (const persona of STUDENT_PERSONAS) {
    marksOf.set(persona.studentId, await Marks
      .find({ schoolId: SCHOOL_ID, studentId: persona.studentId, termNumber: 3 })
      .select('subjectId assessmentType instance rawScore label').lean());
    behaviourOf.set(persona.studentId, await Behaviour
      .find({ schoolId: SCHOOL_ID, studentId: persona.studentId })
      .select('type points date title description status').lean());
    loansOf.set(persona.studentId, await Loans
      .find({ schoolId: SCHOOL_ID, borrowerId: persona.studentId })
      .select('bookId bookTitle issuedAt dueDate status returnedAt').lean());
  }

  let written = 0;
  /* The snapshot cron runs live (index.js starts it), and on a Monday it has
     already written the week that just closed — same {studentId, weekStart},
     a UUID id, and none of the topics this file knows about. Two rows for
     one week puts a duplicate in the week picker and lets the detail route's
     findOne({studentId, weekStart}) return either one. Clear the three weeks
     first: the seeded digest is meant to be the one a reviewer opens. */
  await Snapshots.deleteMany({
    schoolId: SCHOOL_ID,
    studentId: { $in: students.map(s => s.id) },
    weekStart: { $in: weeks },
  });

  for (const student of students) {
    const persona   = STUDENT_PERSONAS.find(p => p.studentId === student.id);
    const attByWeek = attendanceRows.find(r => r.studentId === student.id)?.weeksOut ?? {};

    for (const [wi, weekStart] of weeks.entries()) {
      const weekEnd = _addDays(weekStart, 6);
      const records = attByWeek[weekStart] ?? [];

      /* Two mark entries a week, taken straight from the markbook so the
         score is a score the school actually holds. markedAt is the one
         thing this file invents: assessment_marks carry a single createdAt
         stamped at seed time, and a frozen week needs a date inside it. */
      const marks = marksOf.get(student.id) ?? [];
      const assignments = marks.slice(wi * 2, wi * 2 + 2).map((m, i) => ({
        subjectId: m.subjectId,
        assessmentType: m.assessmentType,
        instance: m.instance,
        rawScore: m.rawScore,
        label: m.label ?? null,
        markedAt: `${_schoolDays(weekStart)[(wi + i) % 5]}T09:00:00.000Z`,
      }));

      const behaviour = (behaviourOf.get(student.id) ?? [])
        .filter(b => {
          const day = String(b.date).slice(0, 10);
          return day >= weekStart && day <= weekEnd;
        })
        .map(b => ({
          type: b.type,
          points: b.points,
          date: String(b.date).slice(0, 10),
          category: b.type === 'merit' ? 'Recognition' : b.type === 'demerit' ? 'Concern' : 'Note',
          itemLabel: b.title,
          status: b.status ?? 'open',
        }));

      /* A loan belongs to the weeks it was live in, not to every week. */
      const library = (loansOf.get(student.id) ?? [])
        .filter(l => String(l.issuedAt).slice(0, 10) <= weekEnd &&
                     (!l.returnedAt || String(l.returnedAt).slice(0, 10) >= weekStart))
        .map(l => ({
          bookId: l.bookId, bookTitle: l.bookTitle,
          issuedAt: l.issuedAt, dueDate: l.dueDate,
          status: l.status, returnedAt: l.returnedAt ?? null,
        }));

      await _put(Snapshots, `snap_scn_${student.id}_${weekStart}`, {
        schoolId: SCHOOL_ID,
        studentId: student.id,
        classId: student.classId ?? null,
        className: classNames.get(student.classId) ?? null,
        weekStart, weekEnd,
        /* Saturday afternoon of that week — the window the cron generates in. */
        generatedAt: `${_addDays(weekStart, 5)}T13:05:00.000Z`,
        schoolTimezone: 'Africa/Nairobi',
        sections: {
          topics: coverageOf.get(`${student.classId}|${weekStart}`) ?? [],
          assignments,
          attendance: { ..._attendanceCounters(records), records },
          behaviour,
          medical: [],
          library,
          growth: wi === 0 && persona?.growth
            ? [{
                collection: 'growth_activities', id: `grw_scn_${student.id}`,
                title: 'Class library monitor', category: 'Responsibility',
                startDate: weekStart, verificationStatus: 'verified',
                createdAt: new Date().toISOString(),
              }]
            : [],
        },
        notified: { emailSentAt: null, inAppSentAt: null, emailError: null },
      });
      written++;
    }
  }
  return written;
}

/* ════════════════════════════════════════════════════════════════
   Messages — inboxes, threads, a saved group
   ════════════════════════════════════════════════════════════════ */
/* A direct send stores concrete userIds (the route resolves and validates
   them before insert); an announcement stores a selector token and is
   expanded at read time. Writing them the other way round makes the inbox
   read a DM as a broadcast or drop it entirely. createdAt is an ISO string
   because the thread ordering compares it as a string. */
const MESSAGES = [
  {
    id: 'msg_scn_ann_exams', type: 'announcement', recipients: ['all'],
    senderId: ADMIN_ID, senderName: 'Demo Admin', senderRole: 'admin',
    subject: 'End of term examinations begin Monday',
    body: 'The timetable goes up on the notice board on Friday. There are no lessons on examination days; revision is with your subject teachers.',
    daysAgo: 2, readBy: [],
  },
  {
    id: 'msg_scn_ann_fees', type: 'announcement', recipients: ['parents'],
    senderId: 'u_demo_principal', senderName: 'Demo Principal', senderRole: 'deputy_principal',
    subject: 'Fee clearance letters for Term 3',
    body: 'Clearance letters are being issued this week. A balance still outstanding holds yours up; the app takes an M-Pesa reference and issues a receipt.',
    daysAgo: 4, readBy: ['u_demo_parent', 'u_demo_p4'],
  },
  {
    /* Teachers-only broadcast: proves the selector token expands to the staff
       list rather than materialising ids, and that a teacher's inbox shows it
       unread while a parent's never does. (The students' notice board is a
       different collection — see ANNOUNCEMENTS below.) */
    id: 'msg_scn_ann_invigilation', type: 'announcement', recipients: ['teachers'],
    senderId: ADMIN_ID, senderName: 'Demo Admin', senderRole: 'admin',
    subject: 'Confirm your invigilation slot',
    body: 'Reply with any clash in the draft rota before Friday. The final list goes to the printing queue on Monday.',
    daysAgo: 1, readBy: [],
  },
  {
    id: 'msg_scn_t3_p2_1', type: 'direct', recipients: ['u_demo_p2'],
    senderId: 'u_demo_t3', senderName: 'Ms. Agnes Otieno', senderRole: 'teacher',
    subject: "James' Mathematics coursework",
    body: 'Two pieces of coursework are still outstanding for this term. They are worth a third of the continuous assessment, so I would like them in before the examinations.',
    daysAgo: 6, readBy: ['u_demo_p2'],
  },
  {
    id: 'msg_scn_p2_t3_1', type: 'direct', recipients: ['u_demo_t3'],
    senderId: 'u_demo_p2', senderName: 'John Mwangi', senderRole: 'parent',
    subject: 'Re: James’ Mathematics coursework',
    body: 'Thank you for flagging it. He says one piece was handed in — I will check with him tonight and send it on Thursday.',
    daysAgo: 5, readBy: ['u_demo_t3'],
  },
  {
    /* Unread for the parent — this is the row that lights the badge, and it
       is about the SECOND child, so the thread is visible in a family where
       the switcher matters. */
    id: 'msg_scn_t3_p2_2', type: 'direct', recipients: ['u_demo_p2'],
    senderId: 'u_demo_t3', senderName: 'Ms. Agnes Otieno', senderRole: 'teacher',
    subject: 'Faith’s library book as well',
    body: 'Faith is in Standard 4A but her book is a fortnight overdue — the librarian will have sent a reminder too. Mentioning it here so it is not a surprise at the parents’ meeting.',
    daysAgo: 0.4, readBy: [],
  },
  {
    id: 'msg_scn_t3_parent_1', type: 'direct', recipients: ['u_demo_parent'],
    senderId: 'u_demo_t3', senderName: 'Ms. Agnes Otieno', senderRole: 'teacher',
    subject: 'Amara has been made class librarian',
    body: 'She volunteered and the class backed her. Nothing needed from you — I only thought you would like to know.',
    daysAgo: 3, readBy: [],
  },
  {
    id: 'msg_scn_prin_p7_1', type: 'direct', recipients: ['u_demo_p7'],
    senderId: 'u_demo_principal', senderName: 'Demo Principal', senderRole: 'deputy_principal',
    subject: 'Attendance — Solomon, Standard 4A',
    body: 'Solomon has been absent on six of the last fifteen school days. Can we talk before the end of term? A phone call is fine if it is easier than coming in.',
    daysAgo: 1.2, readBy: [],
  },
];

const MESSAGE_GROUPS = [
  {
    id: 'grp_scn_f1_team', name: 'Form 1A teaching team',
    createdBy: 'u_demo_t3', createdByName: 'Ms. Agnes Otieno',
    memberIds: ['u_demo_t2', 'u_demo_t4', 'u_demo_t5', 'u_demo_teacher'],
    daysAgo: 12,
  },
];

async function _messages() {
  const Messages = _model('messages');
  const Groups   = _model('message_groups');
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

  for (const group of MESSAGE_GROUPS) {
    await _put(Groups, group.id, {
      schoolId: SCHOOL_ID,
      createdBy: group.createdBy,
      createdByName: group.createdByName,
      name: group.name,
      memberIds: group.memberIds,
    });
  }

  /* A group send is still type 'direct' with materialised member ids, plus
     the groupId/groupName snapshot the inbox badge reads. The creator is
     never inside memberIds — that is what the POST route enforces. */
  const group = MESSAGE_GROUPS[0];
  await _put(Messages, 'msg_scn_grp_1', {
    schoolId: SCHOOL_ID,
    senderId: group.createdBy, senderName: group.createdByName, senderRole: 'teacher',
    recipients: group.memberIds,
    groupId: group.id, groupName: group.name,
    subject: 'Draft timetable for next term',
    body: 'Circulating early so you can mark your preferred slots before it goes to the principal.',
    type: 'direct',
    isRead: {},
    createdAt: ago(group.daysAgo),
  });

  for (const m of MESSAGES) {
    await _put(Messages, m.id, {
      schoolId: SCHOOL_ID,
      senderId: m.senderId, senderName: m.senderName, senderRole: m.senderRole,
      recipients: m.recipients,
      subject: m.subject, body: m.body, type: m.type,
      isRead: Object.fromEntries(m.readBy.map(userId => [userId, true])),
      createdAt: ago(m.daysAgo),
    });
  }

  return { messages: MESSAGES.length + 1, groups: MESSAGE_GROUPS.length };
}

/* ════════════════════════════════════════════════════════════════
   Announcements — the notice boards
   ════════════════════════════════════════════════════════════════ */
/* The student dashboard reads this collection for title/body/createdAt/
   priority (newest three, no audience filter); the parent board adds the
   audience filter and shows category. expiresAt must be a real Date: the
   routes compare it against new Date(), and in MongoDB a string never
   satisfies a Date comparison, so a string-dated notice silently vanishes
   from every board rather than merely expiring.

   Verified against the running API, so it is stated rather than fixed here:
   the parents-only notice below DOES appear on a student's board
   (student-portal.js:293 selects on schoolId + expiry only), while the
   parent board at parent-portal.js:773 filters it correctly. A notice meant
   for staff is therefore public to students until that read path filters.
   */
const ANNOUNCEMENTS = [
  {
    id: 'ann_scn_exams', title: 'End of term examinations begin Monday',
    body: 'The timetable is on the notice board. No lessons on examination days.',
    priority: 'high', category: 'academic', audience: ['all'], daysAgo: 2,
  },
  {
    id: 'ann_scn_fees', title: 'Term 3 fees — clearance letters',
    body: 'A balance still outstanding after Friday holds up your clearance letter. The app issues a receipt for every payment.',
    priority: 'high', category: 'finance', audience: ['parents'], daysAgo: 5,
  },
  {
    id: 'ann_scn_sports', title: 'Sports Day is the last Friday of term',
    body: 'Bring runners, not visitors — the ground is small and the drop-off will be busy.',
    priority: 'normal', category: 'events', audience: ['all'], daysAgo: 8,
  },
  {
    /* Already expired, so it must NOT appear on any board — the row that
       proves the expiry filter works instead of proving nothing does. */
    id: 'ann_scn_library', title: 'Library closes for stock-take',
    body: 'All borrowed books back on the shelves before Monday.',
    priority: 'normal', category: 'library', audience: ['all'], daysAgo: 30,
    expiredDaysAgo: 3,
  },
];

async function _announcements() {
  const Announcements = _model('announcements');
  for (const a of ANNOUNCEMENTS) {
    await _put(Announcements, a.id, {
      schoolId: SCHOOL_ID,
      title: a.title, body: a.body,
      priority: a.priority, category: a.category, audience: a.audience,
      createdAt: new Date(Date.now() - a.daysAgo * 86400000),
      ...(a.expiredDaysAgo != null
        ? { expiresAt: new Date(Date.now() - a.expiredDaysAgo * 86400000) }
        : {}),
    });
  }
  return ANNOUNCEMENTS.length;
}

/* ════════════════════════════════════════════════════════════════
   Entry point
   ════════════════════════════════════════════════════════════════ */
async function seedMobileScenarios() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    console.warn('[seed-scenarios] DB not connected — skipping.');
    return null;
  }

  const weeks = _lastCompletedMondays(3);
  const year  = await _resolveAcademicYear();

  const personaStudents = await _model('students')
    .find({ id: { $in: STUDENT_PERSONAS.map(p => p.studentId) }, schoolId: SCHOOL_ID })
    .select('id classId').lean();
  const personaClassIds = [...new Set(personaStudents.map(s => s.classId).filter(Boolean))];

  const hash = await bcrypt.hash(PASSWORD, 10);
  const accounts   = await _portalAccounts(hash);
  const teachers   = await _classTeachers();
  const classLabels = await _denormaliseClassNames();

  let curriculum = { topics: 0, coverage: 0, classes: 0 };
  if (year) {
    curriculum = await _curriculum(year.name, weeks, personaClassIds);
  } else {
    console.warn('[seed-scenarios] no academic_years doc for the demo school — topics and coverage need its name, skipping them.');
  }

  const attendance = await _attendance(year?.name, weeks);
  const snapshots  = await _snapshots(weeks, attendance, personaClassIds);
  const messages   = await _messages();
  const notices    = await _announcements();

  console.log(`[seed-scenarios] ✓ ${accounts.students} student + ${accounts.parents} parent logins (${accounts.records} student records) · ${teachers} class teachers + ${classLabels} class labels · ${curriculum.topics} topics / ${curriculum.coverage} coverage rows across ${curriculum.classes} classes (year "${year?.name ?? '—'}") · ${attendance.length} attendance profiles · ${snapshots} weekly snapshots (${weeks[weeks.length - 1]} → ${weeks[0]}) · ${messages.messages} messages + ${messages.groups} group · ${notices} announcements (1 expired)`);
  return { accounts, curriculum, snapshots, messages, notices, weeks };
}

module.exports = { seedMobileScenarios };

/* Standalone: node server/scripts/seed-demo-scenarios.js — runs the whole
   demo seed, because the personas hang off students, teachers and marks that
   seed creates, and seedDemo() ends by calling seedMobileScenarios() itself. */
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'innolearn' });
    const { seedDemo } = require('./seed-demo');
    await seedDemo();
    await mongoose.disconnect();
    console.log('[seed-scenarios] Done.');
  })().catch(err => {
    console.error('[seed-scenarios] Fatal:', err);
    process.exit(1);
  });
}
