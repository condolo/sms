/* ============================================================
   Msingi — Weekly Student Snapshot aggregation

   Builds the frozen per-student payload that weekly-snapshot-cron.js
   stores into the `weekly_snapshots` collection. Pulled into its own
   module (separate from the cron file) specifically so it's testable as
   a pure-ish function without touching node-cron scheduling at all.

   Batches every source collection ONCE per school (studentId/classId
   $in the active roster), never once per student — the N+1 pattern this
   session's own audit flagged elsewhere in the codebase.

   Field names below were verified directly against each route file's
   Zod schema before writing this (not assumed):
     assessment.js    MarkSchema        — studentId, subjectId, classId,
                                           assessmentType, instance, rawScore,
                                           label (+ auto createdAt)
     attendance.js                      — studentId, classId, status ∈
                                           present/absent/late/
                                           authorised_absence/excluded/holiday,
                                           date, period, note
     behaviour.js      IncidentSchema   — studentId, classId, type ∈
                                           merit/demerit/neutral, points, date,
                                           category, itemLabel, status
     medical.js        VisitSchema      — studentId, date, time, complaint,
                                           observation, actionTaken,
                                           medicationGiven, returnedToClass,
                                           sentHome, referred, referredTo, notes
     library.js         (stored doc)    — borrowerId, borrowerType, bookId,
                                           bookTitle, issuedAt (full ISO
                                           instant), dueDate (date string),
                                           status, returnedAt
     lessons.js         CoverageSchema  — classId, subjectId, topicId,
                                           subtopicId, coveredAt (date string,
                                           denormalized with topic/subject/
                                           class/teacher display names already
                                           attached — no join needed)
     growth-records.js  RecordSchema    — studentId, title, category,
                                           startDate, verificationStatus
                                           (+ auto createdAt) — collections
                                           growth_leadership/activities/
                                           service/awards
     growth-projects.js ProjectSchema   — same shape as above, collection
                                           growth_projects

   Every collection in this app gets a Mongoose-managed `createdAt`
   automatically (server/utils/model.js's shared schema options set
   `timestamps: true`), even though route code never sets it explicitly —
   used below as the "this week" signal for assessment marks, growth
   records, and library issue dates, none of which carry their own
   date-of-event field.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

const GROWTH_COLLECTIONS = ['growth_leadership', 'growth_activities', 'growth_service', 'growth_awards', 'growth_projects'];

/* ── Week-window helpers ──────────────────────────────────────
   Two filtering strategies, depending on what each collection stores:
   - Plain 'YYYY-MM-DD' date fields (attendance.date, behaviour.date,
     medical.date, library.dueDate, lesson_coverage.coveredAt) sort
     correctly as strings — a direct {$gte, $lte} Mongo filter is exact,
     no timezone conversion needed.
   - Full ISO-instant fields with no separate local-date meaning
     (assessment_marks/growth_*'s auto createdAt, library's issuedAt) need
     a school-timezone-aware day boundary. Query loosely (±1 day padding
     in UTC, cheap and always safe since real-world UTC offsets never
     exceed 14h) then filter precisely in memory against the school's
     actual timezone — avoids needing a timezone-offset math library. */
function _paddedInstantRange(weekStart, weekEnd) {
  const from = new Date(`${weekStart}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${weekEnd}T23:59:59.999Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  return { $gte: from.toISOString(), $lte: to.toISOString() };
}
function _localDateOf(isoInstant, timezone) {
  return new Date(isoInstant).toLocaleDateString('en-CA', { timeZone: timezone });
}
function _inWeekWindow(isoInstant, weekStart, weekEnd, timezone) {
  const local = _localDateOf(isoInstant, timezone);
  return local >= weekStart && local <= weekEnd;
}

/* ── Per-student grouping helper ──────────────────────────────
   `keyFn` extracts the grouping key (usually studentId, classId for
   lesson_coverage) from a doc; results land in a Map<key, doc[]>. */
function _groupBy(docs, keyFn) {
  const map = new Map();
  for (const doc of docs) {
    const key = keyFn(doc);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(doc);
  }
  return map;
}

/**
 * Fetch the active roster (status:'active', classId set) for a school.
 * @returns {Promise<Array<{id,classId,className,firstName,lastName}>>}
 */
async function fetchActiveRoster(ctx) {
  return tenantModel('students', ctx)
    .find({ schoolId: ctx.schoolId, status: 'active', classId: { $ne: null } })
    .select('id classId className firstName lastName')
    .lean();
}

/**
 * Build the weekly snapshot payload for every active student in a school,
 * batching each source collection exactly once.
 *
 * @param {{schoolId:string}} ctx        tenant context for tenantModel()
 * @param {string} weekStart             'YYYY-MM-DD', Monday of the covered week
 * @param {string} weekEnd               'YYYY-MM-DD', Sunday
 * @param {string} timezone              the school's IANA timezone (for the
 *                                        instant-field two-stage filter above)
 * @param {Array}  [roster]              optional pre-fetched roster (avoids a
 *                                        second query when the caller already
 *                                        has it); fetched internally if omitted
 * @returns {Promise<Map<string, object>>} studentId -> sections payload
 */
async function buildSnapshotsForSchool(ctx, weekStart, weekEnd, timezone, roster = null) {
  const students = roster ?? await fetchActiveRoster(ctx);
  if (students.length === 0) return new Map();

  const studentIds = students.map(s => s.id);
  const classIds   = [...new Set(students.map(s => s.classId).filter(Boolean))];
  const studentById = new Map(students.map(s => [s.id, s]));

  const instantRange = _paddedInstantRange(weekStart, weekEnd);

  const [
    marks, attendance, behaviour, medical, libraryLoans, coverage,
    ...growthByCollection
  ] = await Promise.all([
    tenantModel('assessment_marks', ctx)
      .find({ schoolId: ctx.schoolId, studentId: { $in: studentIds }, createdAt: instantRange })
      .select('studentId subjectId assessmentType instance rawScore label createdAt').lean(),

    tenantModel('attendance', ctx)
      .find({ schoolId: ctx.schoolId, studentId: { $in: studentIds }, date: { $gte: weekStart, $lte: weekEnd } })
      .select('studentId status date period note').lean(),

    tenantModel('behaviour_incidents', ctx)
      .find({ schoolId: ctx.schoolId, studentId: { $in: studentIds }, date: { $gte: weekStart, $lte: weekEnd } })
      .select('studentId type points date category itemLabel status').lean(),

    tenantModel('medical_visits', ctx)
      .find({ schoolId: ctx.schoolId, studentId: { $in: studentIds }, date: { $gte: weekStart, $lte: weekEnd } })
      .select('studentId date time complaint observation actionTaken medicationGiven returnedToClass sentHome referred referredTo notes').lean(),

    // Borrowed or due this week — issuedAt is a full instant (padded+filtered
    // below), dueDate is a plain date string (filtered directly here).
    tenantModel('library_loans', ctx)
      .find({
        schoolId: ctx.schoolId, borrowerId: { $in: studentIds }, borrowerType: 'student',
        $or: [
          { issuedAt: instantRange },
          { dueDate: { $gte: weekStart, $lte: weekEnd } },
        ],
      })
      .select('borrowerId bookId bookTitle issuedAt dueDate status returnedAt').lean(),

    tenantModel('lesson_coverage', ctx)
      .find({ schoolId: ctx.schoolId, classId: { $in: classIds }, coveredAt: { $gte: weekStart, $lte: weekEnd } })
      .select('classId subjectId subjectName topicId topicTitle subtopicId subtopicTitle coveredAt teacherName notes').lean(),

    ...GROWTH_COLLECTIONS.map(col =>
      tenantModel(col, ctx)
        .find({ schoolId: ctx.schoolId, studentId: { $in: studentIds }, deletedAt: { $exists: false }, createdAt: instantRange })
        .select('studentId title category startDate verificationStatus createdAt').lean()
        .then(docs => docs.map(d => ({ ...d, collection: col })))
    ),
  ]);

  // Instant-field collections need the precise in-memory pass the padded
  // DB query above only loosely bounded.
  const marksInWeek   = marks.filter(m => _inWeekWindow(m.createdAt, weekStart, weekEnd, timezone));
  const growthInWeek  = growthByCollection.flat().filter(g => _inWeekWindow(g.createdAt, weekStart, weekEnd, timezone));
  const libraryInWeek = libraryLoans.filter(l =>
    (l.dueDate >= weekStart && l.dueDate <= weekEnd) ||
    _inWeekWindow(l.issuedAt, weekStart, weekEnd, timezone)
  );

  const marksByStudent      = _groupBy(marksInWeek,   d => d.studentId);
  const attendanceByStudent = _groupBy(attendance,     d => d.studentId);
  const behaviourByStudent  = _groupBy(behaviour,      d => d.studentId);
  const medicalByStudent    = _groupBy(medical,        d => d.studentId);
  const libraryByStudent    = _groupBy(libraryInWeek,  d => d.borrowerId);
  const growthByStudent     = _groupBy(growthInWeek,   d => d.studentId);
  const coverageByClass     = _groupBy(coverage,       d => d.classId);

  const result = new Map();

  for (const student of students) {
    const att = attendanceByStudent.get(student.id) ?? [];
    const attSummary = {
      present: 0, absent: 0, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0,
      total: att.length,
    };
    for (const a of att) {
      if (a.status === 'present')            attSummary.present++;
      else if (a.status === 'absent')        attSummary.absent++;
      else if (a.status === 'late')          attSummary.late++;
      else if (a.status === 'authorised_absence') attSummary.authorisedAbsence++;
      else if (a.status === 'excluded')      attSummary.excluded++;
      else if (a.status === 'holiday')       attSummary.holiday++;
    }

    result.set(student.id, {
      topics: (coverageByClass.get(student.classId) ?? []).map(c => ({
        subjectId: c.subjectId, subjectName: c.subjectName,
        topicId: c.topicId, topicTitle: c.topicTitle,
        subtopicId: c.subtopicId ?? null, subtopicTitle: c.subtopicTitle ?? null,
        coveredAt: c.coveredAt, teacherName: c.teacherName, notes: c.notes ?? '',
      })),
      assignments: (marksByStudent.get(student.id) ?? []).map(m => ({
        subjectId: m.subjectId, assessmentType: m.assessmentType,
        instance: m.instance, rawScore: m.rawScore, label: m.label ?? null,
        markedAt: m.createdAt,
      })),
      attendance: { ...attSummary, records: att.map(a => ({ date: a.date, status: a.status, period: a.period ?? null, note: a.note ?? '' })) },
      behaviour: (behaviourByStudent.get(student.id) ?? []).map(b => ({
        type: b.type, points: b.points, date: b.date,
        category: b.category, itemLabel: b.itemLabel, status: b.status,
      })),
      medical: (medicalByStudent.get(student.id) ?? []).map(v => ({
        date: v.date, time: v.time ?? null, complaint: v.complaint,
        observation: v.observation ?? '', actionTaken: v.actionTaken ?? '',
        medicationGiven: v.medicationGiven ?? '', returnedToClass: !!v.returnedToClass,
        sentHome: !!v.sentHome, referred: !!v.referred, referredTo: v.referredTo ?? null,
        notes: v.notes ?? '',
      })),
      library: (libraryByStudent.get(student.id) ?? []).map(l => ({
        bookId: l.bookId, bookTitle: l.bookTitle, issuedAt: l.issuedAt,
        dueDate: l.dueDate, status: l.status, returnedAt: l.returnedAt ?? null,
      })),
      growth: (growthByStudent.get(student.id) ?? []).map(g => ({
        collection: g.collection, id: g.id, title: g.title, category: g.category ?? null,
        startDate: g.startDate ?? null, verificationStatus: g.verificationStatus ?? null,
        createdAt: g.createdAt,
      })),
    });
  }

  return result;
}

module.exports = { buildSnapshotsForSchool, fetchActiveRoster, _inWeekWindow, _paddedInstantRange };
