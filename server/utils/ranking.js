/* ============================================================
   InnoLearn — Ranking Utility
   Computes class/stream/overall rankings from an array of
   student score objects.

   Supports two methods:
     'standard'  — 1, 2, 2, 4  (gap after ties — standard competition ranking)
     'dense'     — 1, 2, 2, 3  (no gap — dense ranking)

   Usage:
     const { rankStudents, mergeRankings } = require('../utils/ranking');

     const classRanks   = rankStudents(classStudents, 'standard');
     const overallRanks = rankStudents(allStudents,   'standard');
     const merged       = mergeRankings(student.id, { class: classRanks, overall: overallRanks });
   ============================================================ */

/**
 * Rank an array of students by totalScore (descending).
 *
 * @param {Array<{ studentId: string, totalScore: number }>} students
 * @param {'standard'|'dense'} method
 * @returns {Array<{ studentId: string, totalScore: number, rank: number, outOf: number }>}
 */
function rankStudents(students, method = 'standard') {
  if (!students || students.length === 0) return [];

  // Sort descending by totalScore; on tie, preserve original order
  const sorted = [...students].sort((a, b) => b.totalScore - a.totalScore);
  const outOf  = sorted.length;
  const result = [];

  let currentRank = 1;
  let nextRank    = 1; // only used by dense mode

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prevScore = sorted[i - 1].totalScore;
      const currScore = sorted[i].totalScore;

      if (currScore < prevScore) {
        // New rank needed
        if (method === 'standard') {
          currentRank = i + 1;       // skip positions = number of students before us
        } else {
          currentRank = currentRank + 1;  // dense: just increment
        }
      }
      // If currScore === prevScore: keep same rank (tied)
    }

    result.push({ ...sorted[i], rank: currentRank, outOf });
  }

  return result;
}

/**
 * Build a student's rankings object from multiple scope arrays.
 *
 * @param {string} studentId
 * @param {Object<string, Array>} scopeRanks  — e.g. { class: [...], stream: [...], overall: [...] }
 * @returns {Object}  — e.g. { class: { rank: 3, outOf: 35 }, overall: { rank: 15, outOf: 200 } }
 */
function mergeRankings(studentId, scopeRanks) {
  const result = {};
  for (const [scope, ranked] of Object.entries(scopeRanks)) {
    const entry = ranked.find(r => r.studentId === studentId);
    if (entry) {
      result[scope] = { rank: entry.rank, outOf: entry.outOf };
    }
  }
  return result;
}

/**
 * Determine the "best in subject" student per subject.
 * Returns a map: { [subjectId]: studentId }
 *
 * @param {Array<{ studentId, subjects: Object<subjectId, { finalScore }>}>} studentReports
 * @returns {Object}
 */
function bestPerSubject(studentReports) {
  const best = {}; // { subjectId: { studentId, score } }
  for (const sr of studentReports) {
    for (const [subjectId, subData] of Object.entries(sr.subjects || {})) {
      if (subData.finalScore == null) continue;
      if (!best[subjectId] || subData.finalScore > best[subjectId].score) {
        best[subjectId] = { studentId: sr.studentId, score: subData.finalScore };
      }
    }
  }
  return Object.fromEntries(
    Object.entries(best).map(([sub, v]) => [sub, v.studentId])
  );
}

/**
 * Filter a student's subjects based on the school's ranking strategy,
 * then return the totalScore to use for ranking.
 *
 * @param {{ [subjectId]: { finalScore: number } }} subjects
 * @param {'all'|'best_n'|'compulsory_only'} strategy
 * @param {number}   n                    — used with 'best_n'
 * @param {string[]} compulsorySubjects   — used with 'compulsory_only'
 * @returns {{ rankingScore: number, subjectsUsed: string[] }}
 */
function computeRankingScore(subjects, strategy = 'all', n = 7, compulsorySubjects = []) {
  const entries = Object.entries(subjects || {})
    .filter(([, s]) => s.finalScore != null)
    .map(([subjectId, s]) => ({ subjectId, score: s.finalScore }));

  let selected;

  if (strategy === 'compulsory_only' && compulsorySubjects.length > 0) {
    selected = entries.filter(e => compulsorySubjects.includes(e.subjectId));
  } else if (strategy === 'best_n') {
    selected = [...entries].sort((a, b) => b.score - a.score).slice(0, n);
  } else {
    // 'all' — default
    selected = entries;
  }

  if (!selected.length) return { rankingScore: 0, subjectsUsed: [] };

  const rankingScore = _round(
    selected.reduce((s, e) => s + e.score, 0) / selected.length
  );

  return { rankingScore, subjectsUsed: selected.map(e => e.subjectId) };
}

function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = { rankStudents, mergeRankings, bestPerSubject, computeRankingScore };
