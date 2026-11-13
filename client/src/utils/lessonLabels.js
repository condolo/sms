/* ============================================================
   Lesson display helpers (v5.270.0) — mirror server/utils/lesson-audience.js.

   A lesson can have co-teachers (coTeacherIds / coTeacherNames) and can be
   for several streams taught together (streamIds). These keep every screen
   showing and filtering them the same way.
   ============================================================ */

/** "Grace Akinyi & Brian Kamau" — the main teacher, then co-teachers. */
export function lessonTeachers(slot) {
  return [slot?.teacherName, ...((slot?.coTeacherNames) || [])].filter(Boolean).join(' & ');
}

/** The streams a lesson is for, or null for the whole class. */
export function lessonStreams(slot) {
  if (Array.isArray(slot?.streamIds) && slot.streamIds.length) return slot.streamIds;
  return slot?.streamId ? [slot.streamId] : null;
}

/** Is this lesson for this stream? Whole-class lessons are for every stream. */
export function lessonIsForStream(slot, streamId) {
  const st = lessonStreams(slot);
  return !st || st.includes(streamId);
}

/** True when several streams are taught together in this lesson. */
export function isCombined(slot) {
  return Array.isArray(slot?.streamIds) && slot.streamIds.length > 1;
}
