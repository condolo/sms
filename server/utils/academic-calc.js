/* ============================================================
   Msingi — Canonical Academic Calculation Engine
   Single source of truth for all weighted-score calculations.

   Exported functions are used by:
     - server/routes/report-cards.js  (report generation)
     - server/routes/grades.js        (gradebook aggregation)
     - Future: analytics, student portal, dashboards

   DO NOT duplicate these calculations in individual routes.
   Drift between surfaces (PDF vs dashboard vs portal) is the
   classic ERP collapse pattern — this file prevents it.
   ============================================================ */
const { _model }     = require('./model');
const { resolveGrade } = require('../routes/academic-config');

/* ── Internal ───────────────────────────────────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/* A requested academicYearId must also match a record stored with
   academicYearId: null/missing — confirmed directly against the live
   database, 2026-09-30: 14 of 14 exam_results documents (100%) and every
   pre-fix assessment_schedule/assessment_marks document carry no
   academicYearId at all, since nothing ever required the caller to send
   one when those were written. A strict equality filter against a real
   yearId therefore silently returns zero results for exactly the schools
   this matters for most — report cards and gradebooks going blank isn't
   a cosmetic bug. Same dual-mode posture already established for marks
   writes in assessment.js's PUT /marks. */
function _yearFilterPart(academicYearId) {
  return academicYearId
    ? { $or: [{ academicYearId }, { academicYearId: null }, { academicYearId: { $exists: false } }] }
    : {};
}

/* ══════════════════════════════════════════════════════════════
   GRADE DATA AGGREGATION
   ══════════════════════════════════════════════════════════════ */

/**
 * Markbook moderation status, sourced from mark_submissions (the
 * submit -> approve -> lock workflow). A (subject, assessmentType, instance)
 * with marks in this class/term is provisional until its submission is
 * approved or locked. Replaces exam-status gating (exam_results is legacy).
 *
 * Returns: [{ id, title, status }] for every unmoderated combination; empty
 * when everything is approved. status is the submission status, or
 * "not_submitted" when no submission exists yet.
 */
async function aggregateUnmoderatedMarks(schoolId, classId, termNumber = null, academicYearId = null) {
  const scope = { schoolId, classId, ..._yearFilterPart(academicYearId) };
  if (termNumber != null) scope.termNumber = termNumber;

  const marks = await _model("assessment_marks").find({ ...scope, isPublished: true })
    .select("subjectId assessmentType instance").lean();
  const combos = new Map();
  for (const m of marks) {
    if (!m.subjectId || !m.assessmentType) continue;
    combos.set(`${m.subjectId}|${m.assessmentType}|${m.instance ?? 1}`, m);
  }
  if (!combos.size) return [];

  const subs = await _model("mark_submissions").find(scope)
    .select("subjectId assessmentType instance status").lean();
  const statusByCombo = new Map(subs.map(s => [`${s.subjectId}|${s.assessmentType}|${s.instance ?? 1}`, s.status]));

  const subjectIds = [...new Set([...combos.values()].map(m => m.subjectId))];
  const subjectDocs = await _model("subjects").find({ schoolId, id: { $in: subjectIds } }).select("id name").lean();
  const subjectName = Object.fromEntries(subjectDocs.map(s => [s.id, s.name]));

  const out = [];
  for (const [key, m] of combos) {
    const status = statusByCombo.get(key) ?? "not_submitted";
    if (status === "approved" || status === "locked") continue;
    const instance = m.instance ?? 1;
    const label = instance > 1 ? `${m.assessmentType} ${instance}` : m.assessmentType;
    out.push({ id: key, title: `${subjectName[m.subjectId] ?? m.subjectId} — ${label}`, status });
  }
  return out;
}


/**
 * Aggregate published CA marks (assessment_marks collection) per student per subject
 * per assessmentType.  assessment_marks.rawScore is already a percentage (0–100).
 * Multiple instances of the same assessmentType are averaged across instances.
 *
 * Returns: { [studentId]: { [subjectId]: { [assessmentType]: avgPercentage } } }
 *
 * @param {string}      schoolId
 * @param {string}      classId
 * @param {number|null} termNumber     — 1, 2, or 3; pass null to include all terms
 * @param {string|null} academicYearId
 * @param {string|null} studentId      — pass to scope to one student
 */
async function aggregateAssessmentMarks(schoolId, classId, termNumber = null, academicYearId = null, studentId = null) {
  const filter = { schoolId, classId, isPublished: true, ..._yearFilterPart(academicYearId) };
  if (termNumber != null) filter.termNumber = termNumber;
  if (studentId)          filter.studentId  = studentId;

  // Safety ceiling: 10,000 marks ≈ 50 students × 14 subjects × 4 types × 3–4 instances
  const marks = await _model('assessment_marks').find(filter).limit(10000).lean();
  const grouped = {};

  for (const m of marks) {
    const { studentId: sid, subjectId, assessmentType, rawScore } = m;
    if (rawScore == null || !subjectId || !assessmentType) continue;

    grouped[sid]                            ??= {};
    grouped[sid][subjectId]                 ??= {};
    grouped[sid][subjectId][assessmentType] ??= [];
    grouped[sid][subjectId][assessmentType].push(rawScore); // rawScore is already 0–100 pct
  }

  // Average within each assessmentType bucket (across instances)
  const result = {};
  for (const [sid, subjects] of Object.entries(grouped)) {
    result[sid] = {};
    for (const [sub, types] of Object.entries(subjects)) {
      result[sid][sub] = {};
      for (const [type, scores] of Object.entries(types)) {
        result[sid][sub][type] = _round(scores.reduce((s, n) => s + n, 0) / scores.length);
      }
    }
  }
  return result;
}

/* ══════════════════════════════════════════════════════════════
   WEIGHTED SCORE CALCULATION
   ══════════════════════════════════════════════════════════════ */

/**
 * Compute the weighted final score per student per subject.
 *
 * Algorithm:
 *   For each subject a student has data for:
 *     1. Merge grades + exam breakdown by assessmentType
 *     2. For each type present, look up its weight from assessmentWeights
 *     3. Normalise: if only a subset of weighted types are present,
 *        divide by the sum of present weights (not by 100)
 *     4. Resolve finalScore → grade band via resolveGrade()
 *
 * Returns: { [studentId]: { studentId, subjects, totalScore, averageScore, gpa, subjectCount } }
 *
 * @param {Object} gradesData      — from aggregateAssessmentMarks() (the Markbook)
 * @param {Object} examData        — legacy exam_results input; report cards pass {} (Markbook-only)
 * @param {Array}  assessmentWeights — [{assessmentType, label, weight}], derived from
 *                                     assessment_config.customTypes (server/routes/assessment.js)
 * @param {Array}  gradingSchema     — from grade_boundaries, falls back to academic-config
 */
function computeFinalScores(gradesData, examData, assessmentWeights, gradingSchema) {
  // ── Runtime input validation ─────────────────────────────────
  if (!gradesData  || typeof gradesData  !== 'object' || Array.isArray(gradesData))  gradesData  = {};
  if (!examData    || typeof examData    !== 'object' || Array.isArray(examData))    examData    = {};
  if (!Array.isArray(assessmentWeights) || assessmentWeights.length === 0) {
    throw new TypeError('[academic-calc] computeFinalScores: assessmentWeights must be a non-empty array');
  }
  if (!Array.isArray(gradingSchema) || gradingSchema.length === 0) {
    throw new TypeError('[academic-calc] computeFinalScores: gradingSchema must be a non-empty array');
  }
  for (const w of assessmentWeights) {
    if (typeof w.weight !== 'number' || isNaN(w.weight)) {
      throw new TypeError(`[academic-calc] assessmentWeights entry "${w.assessmentType}" has non-numeric weight: ${w.weight}`);
    }
  }
  for (const g of gradingSchema) {
    // Accept both { minScore, maxScore } (academic_config format) and { min } (grade_boundaries format)
    const minVal = g.minScore ?? g.min;
    if (typeof minVal !== 'number') {
      throw new TypeError(`[academic-calc] gradingSchema band "${g.grade}" is missing a numeric minScore or min value`);
    }
  }

  const weightMap   = Object.fromEntries(assessmentWeights.map(w => [w.assessmentType, w.weight]));
  const allStudents = new Set([...Object.keys(gradesData), ...Object.keys(examData)]);

  const studentReports = {};

  for (const sid of allStudents) {
    const allSubjects = new Set([
      ...Object.keys(gradesData[sid] || {}),
      ...Object.keys(examData[sid]   || {}),
    ]);

    const subjects   = {};
    let totalScore   = 0;
    let totalPoints  = 0;
    let subjectCount = 0;

    for (const sub of allSubjects) {
      const gradeTypes = gradesData[sid]?.[sub] || {};
      const examTypes  = examData[sid]?.[sub]   || {};
      // gradesData (the Markbook — assessment_marks, merged on top of the
      // legacy gradebook by report-cards.js's own _mergeGradeData, "CA
      // marks win on per-type conflict") is spread LAST so it overrides
      // examData (exam_results, the separate Exams-tab "Create Exam" +
      // Results entry path) on any shared assessmentType key. Was the
      // other way around — exam data silently won — which broke the
      // Markbook's whole premise: a teacher entering/correcting a CA mark
      // there had no effect on the report card the moment ANY exam record
      // of that same type already had a score for that student, with no
      // indication anything had been overridden. Direct instruction,
      // 2026-10-01: "the markbook... is where all marks are supposed to
      // be updated and reflect on the report card module." exam-only
      // types (nothing ever entered in the Markbook for that type, e.g. a
      // school that still runs MT/ET purely through Exams -> Results)
      // still flow through untouched — this only changes which source
      // wins when BOTH have a value for the same student+subject+type.
      const allTypes   = { ...examTypes, ...gradeTypes };

      let weightedSum     = 0;
      let totalWeightUsed = 0;

      for (const [type, avg] of Object.entries(allTypes)) {
        const w = weightMap[type] ?? 0;
        if (w === 0) continue;           // unweighted type — skip
        const numericAvg = Number(avg);
        if (isNaN(numericAvg)) {
          console.warn(`[academic-calc] Non-numeric score for assessmentType "${type}" — skipping`);
          continue;
        }
        weightedSum     += numericAvg * w;
        totalWeightUsed += w;
      }

      if (totalWeightUsed === 0) continue; // no weighted data for this subject

      // Normalise to present weights (so partial data doesn't artificially depress scores)
      const finalScore = _round(weightedSum / totalWeightUsed);
      const gradeInfo  = resolveGrade(finalScore, gradingSchema);

      subjects[sub] = {
        finalScore,
        grade:      gradeInfo.grade,
        points:     gradeInfo.points,
        descriptor: gradeInfo.descriptor,
        remarks:    gradeInfo.remarks,
        breakdown:  allTypes,   // raw type averages, e.g. { classwork: 72, midterm: 68, final: 74 }
      };

      totalScore   += finalScore;
      totalPoints  += gradeInfo.points ?? 0;
      subjectCount++;
    }

    studentReports[sid] = {
      studentId:    sid,
      subjects,
      totalScore:   _round(totalScore),
      averageScore: subjectCount > 0 ? _round(totalScore / subjectCount) : 0,
      gpa:          subjectCount > 0 ? _round(totalPoints / subjectCount) : 0,
      subjectCount,
    };
  }

  return studentReports;
}

/* ══════════════════════════════════════════════════════════════
   ATTENDANCE
   ══════════════════════════════════════════════════════════════ */

/**
 * Fetch attendance summary for a student in a class/term.
 * Returns: { daysPresent, daysAbsent, totalSchoolDays, percentage }
 */
async function attendanceSummary(schoolId, studentId, classId, termId, academicYearId) {
  const filter = { schoolId, studentId };
  if (classId) filter.classId = classId;

  // `attendance` records carry no termId/academicYearId at all — only
  // schoolId/studentId/classId/streamId/date/status/note/markedBy (see
  // attendance.js's own AttendanceRecordSchema). Filtering directly by
  // those two fields, as this used to, matched ZERO records every time,
  // for every student at every school — every report card's attendance
  // summary silently showed 0/0/null regardless of real attendance.
  // Resolve the term's real startDate/endDate instead and filter by date
  // range — the same term-dates-are-truth model academic-config.js's
  // _resolveCurrentPeriod already uses — rather than a field that has
  // never existed on an attendance record.
  if (termId && academicYearId) {
    const years = await _model('academic_years').find({ schoolId }).lean();
    const year  = years.find(y => (y.id || y._id?.toString()) === academicYearId);
    const term  = Array.isArray(year?.terms) ? year.terms.find(t => t.id === termId) : null;
    if (term?.startDate && term?.endDate) {
      filter.date = { $gte: term.startDate, $lte: term.endDate };
    }
    // No matching term/dates (e.g. a legacy year predating the id/name
    // normalization in v5.129.0) — fall back to unrestricted-by-date
    // rather than silently matching nothing, same as the pre-existing
    // behavior when no term/year is passed in at all.
  }

  const Att = _model('attendance');
  const [present, absent, total] = await Promise.all([
    Att.countDocuments({ ...filter, status: 'present' }),
    Att.countDocuments({ ...filter, status: 'absent' }),
    Att.countDocuments(filter),
  ]);
  return {
    daysPresent:     present,
    daysAbsent:      absent,
    totalSchoolDays: total,
    percentage:      total > 0 ? _round((present / total) * 100) : null,
  };
}

/* ══════════════════════════════════════════════════════════════
   BEHAVIOUR (single-student summary, for report cards)
   ══════════════════════════════════════════════════════════════ */

/**
 * Fetch a single student's behaviour incident summary — same
 * merits/demerits/points/total shape and "since last points reset"
 * default window as behaviour.js's GET /incidents/summary (class-wide,
 * grouped by studentId), scoped here to one student instead. A
 * separate function rather than a refactor of that route: the two are
 * genuinely different query shapes (class-wide group-by vs one
 * student), the same coexistence attendanceSummary above already has
 * with attendance.js's own class-wide endpoint.
 * Returns: { merits, demerits, points, total }
 */
async function behaviourSummary(schoolId, studentId) {
  const filter = { schoolId, studentId };
  const lastReset = await _model('behaviour_points_resets')
    .find({ schoolId }).sort({ resetAt: -1 }).limit(1).lean();
  if (lastReset[0]) filter.date = { $gte: lastReset[0].resetAt.slice(0, 10) };

  const [summary] = await _model('behaviour_incidents').aggregate([
    { $match: filter },
    { $group: {
      _id:      '$studentId',
      merits:   { $sum: { $cond: [{ $eq: ['$type', 'merit'] }, 1, 0] } },
      demerits: { $sum: { $cond: [{ $eq: ['$type', 'demerit'] }, 1, 0] } },
      points:   { $sum: '$points' },
      total:    { $sum: 1 },
    }},
  ]);
  return summary
    ? { merits: summary.merits, demerits: summary.demerits, points: summary.points, total: summary.total }
    : { merits: 0, demerits: 0, points: 0, total: 0 };
}

/* ══════════════════════════════════════════════════════════════
   DEVIATION (class average deviation per student per subject)
   ══════════════════════════════════════════════════════════════ */

/**
 * Given a full set of student reports for a class, compute each
 * student's deviation from the class average per subject.
 * Mutates `studentReports[sid].subjects[sub].deviation` in-place.
 *
 * @param {Object} studentReports — from computeFinalScores()
 */
function attachDeviations(studentReports) {
  // Collect all scores per subject
  const subjectScores = {}; // { subjectId: [score, ...] }
  for (const report of Object.values(studentReports)) {
    for (const [sub, data] of Object.entries(report.subjects || {})) {
      subjectScores[sub] ??= [];
      if (data.finalScore != null) subjectScores[sub].push(data.finalScore);
    }
  }

  // Compute class average per subject
  const classAvg = {};
  for (const [sub, scores] of Object.entries(subjectScores)) {
    classAvg[sub] = scores.length > 0
      ? _round(scores.reduce((s, n) => s + n, 0) / scores.length)
      : null;
  }

  // Attach deviation to each student's subject
  for (const report of Object.values(studentReports)) {
    for (const [sub, data] of Object.entries(report.subjects || {})) {
      data.classAverage = classAvg[sub] ?? null;
      data.deviation    = (data.finalScore != null && classAvg[sub] != null)
        ? _round(data.finalScore - classAvg[sub])
        : null;
    }
  }

  return { studentReports, classAverages: classAvg };
}

/**
 * Term-over-term deviation per subject — a student's current finalScore
 * minus their OWN finalScore in the same subject the previous term.
 * Deliberately separate from attachDeviations() above (class-AVERAGE
 * deviation, a different comparison entirely) — this is what
 * StudentReportCard.jsx's report-card preview already computed
 * client-side (comparing two /generate calls); moved here as the single
 * source of truth now that report-cards.js's RC3 HTML adapter needs the
 * exact same figure server-side, for both a live draft preview and a
 * published snapshot's re-render.
 *
 * @param {Object} currentSubjects — one student's `subjects` map (finalScore per subjectId)
 * @param {Object} prevSubjects    — same student's `subjects` map from the previous term, or null/undefined
 * @returns {{subjects: Object<string, number|null>}}
 */
function computeTermDeviation(currentSubjects, prevSubjects) {
  const subjects = {};
  for (const [subjectId, data] of Object.entries(currentSubjects || {})) {
    const curr = data?.finalScore ?? null;
    const prev = prevSubjects?.[subjectId]?.finalScore ?? null;
    subjects[subjectId] = (curr != null && prev != null) ? _round(curr - prev) : null;
  }
  return { subjects };
}

module.exports = {
  aggregateAssessmentMarks,
  aggregateUnmoderatedMarks,
  computeFinalScores,
  attendanceSummary,
  behaviourSummary,
  attachDeviations,
  computeTermDeviation,
};
