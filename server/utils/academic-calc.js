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

/* ══════════════════════════════════════════════════════════════
   GRADE DATA AGGREGATION
   ══════════════════════════════════════════════════════════════ */

/**
 * Aggregate published gradebook entries (continuous assessment)
 * per student per subject per assessmentType.
 *
 * Returns: { [studentId]: { [subjectId]: { [assessmentType]: avgPercentage } } }
 *
 * @param {string}  schoolId
 * @param {string}  classId
 * @param {string|null} termId
 * @param {string|null} academicYearId
 * @param {string|null} studentId  — pass to scope to one student
 */
async function aggregateGrades(schoolId, classId, termId, academicYearId, studentId = null) {
  const filter = { schoolId, classId, isPublished: true };
  if (termId)         filter.termId         = termId;
  if (academicYearId) filter.academicYearId = academicYearId;
  if (studentId)      filter.studentId      = studentId;

  const grades  = await _model('grades').find(filter).lean();
  const grouped = {};

  for (const g of grades) {
    const { studentId: sid, subjectId, assessmentType } = g;
    const pct = g.percentage ?? (g.maxScore > 0 ? _round((g.score / g.maxScore) * 100) : null);
    if (pct === null || !subjectId || !assessmentType) continue;

    grouped[sid]                    ??= {};
    grouped[sid][subjectId]         ??= {};
    grouped[sid][subjectId][assessmentType] ??= [];
    grouped[sid][subjectId][assessmentType].push(pct);
  }

  // Average within each assessmentType bucket
  const result = {};
  for (const [sid, subjects] of Object.entries(grouped)) {
    result[sid] = {};
    for (const [sub, types] of Object.entries(subjects)) {
      result[sid][sub] = {};
      for (const [type, pcts] of Object.entries(types)) {
        result[sid][sub][type] = _round(pcts.reduce((s, n) => s + n, 0) / pcts.length);
      }
    }
  }
  return result;
}

/**
 * Aggregate exam results (terminal/mock exams) per student per subject per exam type.
 * Only includes results with valid scores (markState: present, not absent).
 * Maps exam.type → assessmentType for weight lookup.
 *
 * Returns: { data: same shape as aggregateGrades, examStatuses: [{ id, status, title }] }
 *
 * @param {string}  schoolId
 * @param {string}  classId
 * @param {string|null} termId
 * @param {string|null} academicYearId
 * @param {string|null} studentId  — pass to scope to one student
 */
async function aggregateExamResults(schoolId, classId, termId, academicYearId, studentId = null) {
  const examsFilter = {
    schoolId, classId,
    status: { $in: ['completed', 'moderated', 'approved', 'locked', 'published', 'archived'] }
  };
  if (termId)         examsFilter.termId         = termId;
  if (academicYearId) examsFilter.academicYearId = academicYearId;

  const exams = await _model('exams').find(examsFilter).lean();
  if (!exams.length) return { data: {}, examStatuses: [] };

  const examMap      = Object.fromEntries(exams.map(e => [e.id, e]));
  const examIds      = exams.map(e => e.id);
  const examStatuses = exams.map(e => ({ id: e.id, status: e.status, title: e.title, subjectId: e.subjectId }));

  const resultsFilter = {
    schoolId,
    examId: { $in: examIds },
    markState: { $in: ['present', null] },
    absent: { $ne: true }
  };
  if (studentId) resultsFilter.studentId = studentId;

  const results = await _model('exam_results').find(resultsFilter).lean();

  const grouped = {};
  for (const r of results) {
    const exam = examMap[r.examId];
    if (!exam || r.score == null || !exam.subjectId) continue;
    const pct = exam.maxScore > 0 ? _round((r.score / exam.maxScore) * 100) : null;
    if (pct === null) continue;

    const sid = r.studentId;
    grouped[sid]              ??= {};
    grouped[sid][exam.subjectId] ??= {};
    grouped[sid][exam.subjectId][exam.type] ??= [];
    grouped[sid][exam.subjectId][exam.type].push(pct);
  }

  const data = {};
  for (const [sid, subjects] of Object.entries(grouped)) {
    data[sid] = {};
    for (const [sub, types] of Object.entries(subjects)) {
      data[sid][sub] = {};
      for (const [type, pcts] of Object.entries(types)) {
        data[sid][sub][type] = _round(pcts.reduce((s, n) => s + n, 0) / pcts.length);
      }
    }
  }
  return { data, examStatuses };
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
 * @param {Object} gradesData      — from aggregateGrades()
 * @param {Object} examData        — from aggregateExamResults().data
 * @param {Array}  assessmentWeights — from academic-config
 * @param {Array}  gradingSchema     — from academic-config
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
    if (typeof g.minScore !== 'number' || typeof g.maxScore !== 'number') {
      throw new TypeError(`[academic-calc] gradingSchema band "${g.grade}" has non-numeric minScore/maxScore`);
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
      const allTypes   = { ...gradeTypes, ...examTypes };

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
  if (classId)        filter.classId        = classId;
  if (termId)         filter.termId         = termId;
  if (academicYearId) filter.academicYearId = academicYearId;

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

module.exports = {
  aggregateGrades,
  aggregateExamResults,
  computeFinalScores,
  attendanceSummary,
  attachDeviations,
};
