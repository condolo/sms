/* Student/parent-facing assignment projection — strips the answer key. */
'use strict';

function forStudent(assignment) {
  if (!assignment) return assignment;
  if (!Array.isArray(assignment.questions) || assignment.questions.length === 0) return assignment;
  return {
    ...assignment,
    questions: assignment.questions.map(q => {
      const { correctOptionIds, ...safe } = q;
      return safe;
    }),
  };
}

module.exports = { forStudent };
