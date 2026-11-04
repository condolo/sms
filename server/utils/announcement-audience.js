/* ============================================================
   Msingi — which notice-board posts a given portal may read

   `announcements.audience` is an optional list of audience keys, the same
   vocabulary a broadcast uses ('all', 'teachers', 'parents', 'students',
   'staff' — see utils/message-audience.js). Absent or null means the whole
   school, which is what every announcement written before the field existed
   looks like; an explicitly empty list addresses nobody and stays hidden,
   which is how the parent board already treats it.

   A read that ignores the field hands a fee notice meant for families to a
   student's board, so every portal read uses the clause below rather than
   inventing its own. Two copies of the predicate is how a parent's board and
   a student's board end up disagreeing about a key nobody intended.
   ============================================================ */
'use strict';

/* Synonyms are for hand-written and imported rows; the composer only ever
   sends the canonical keys. */
const PORTAL_AUDIENCE_KEYS = {
  parents:  ['all', 'parents', 'guardians', 'family'],
  students: ['all', 'students'],
};

/**
 * Mongo filter fragment for one portal's half of the board. Spread it into an
 * `$and` alongside any other clause — the expiry window is already an `$or`,
 * and a second `$or` key in the same object silently replaces the first.
 *
 * Anchored case-insensitive `$regex` rather than `$in`, for two reasons that
 * are both about not hiding a notice from the people it was written for:
 * a `$regex` on an array field matches when ANY element matches, so it covers
 * `['parents']` and the bare string `'parents'` in one clause, and it keeps
 * the tolerance the parent board has always had for `'Parents'` from a
 * hand-edited or CSV-imported row. The keys come from the constant above,
 * never from a caller, so there is nothing to escape.
 */
function audienceClause(portal) {
  return {
    $or: [
      { audience: { $exists: false } },
      { audience: null },
      ...PORTAL_AUDIENCE_KEYS[portal].map(k => ({ audience: { $regex: `^${k}$`, $options: 'i' } })),
    ],
  };
}

module.exports = { audienceClause, PORTAL_AUDIENCE_KEYS };
