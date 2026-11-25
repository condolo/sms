/* ============================================================
   Msingi — which topic ticks count, and for whom (v5.283.0)

   A tick (lesson_coverage) saved for a whole class has no streamId: the
   class had no streams then, or its teacher teaches the whole class. The
   stream's students were taught it, so it counts for EVERY stream of the
   class. A tick saved for a stream counts for that stream only, and a
   whole-class assignment counts whole-class ticks only.

   notForStreams (on a whole-class tick): streams whose teacher unticked
   it for their own stream. The tick itself is kept for the others.

   Every reader of lesson_coverage uses this file, so a teacher, the HOD
   and a parent see the same progress.
   ============================================================ */
'use strict';

/** The clauses a tick must match ONE of, for a stream (or, with none, a whole class). */
function coverageStreamOr(streamId) {
  const wholeClass = { streamId: { $exists: false } };
  if (!streamId) return [wholeClass];
  const id = String(streamId);
  return [{ streamId: id }, { ...wholeClass, notForStreams: { $ne: id } }];
}

/** Same, to spread into a filter that has no $or of its own. */
function coverageStreamFilter(streamId) {
  return streamId ? { $or: coverageStreamOr(streamId) } : { streamId: { $exists: false } };
}

/**
 * Progress in leaf items: each subtopic is one, and so is a topic without
 * subtopics. Counts items, never records: one item can be ticked by the
 * whole class AND the stream, and a topic-level tick on a topic that has
 * subtopics is not one of its items.
 */
function leafProgress(topics, ticks) {
  const subs = new Set();
  const whole = new Set();
  for (const r of ticks) (r.subtopicId ? subs.add(`${r.topicId}__${r.subtopicId}`) : whole.add(r.topicId));
  let totalItems = 0;
  let coveredItems = 0;
  for (const t of topics) {
    if (t.subtopics?.length) {
      totalItems += t.subtopics.length;
      coveredItems += t.subtopics.filter(st => subs.has(`${t.id}__${st.id}`)).length;
    } else {
      totalItems += 1;
      if (whole.has(t.id)) coveredItems += 1;
    }
  }
  return { totalItems, coveredItems };
}

module.exports = { coverageStreamOr, coverageStreamFilter, leafProgress };
