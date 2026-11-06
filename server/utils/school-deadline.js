/* ============================================================
   Msingi — school-local assignment deadlines

   A due date + time is a wall-clock instruction in the school's own
   timezone ("23:59 on 13 Nov, Africa/Nairobi"), never the server's.
   Interpreting it with the host clock put a Nairobi deadline three
   hours late on a UTC server.

   Pure functions only — the route resolves the school's timezone.
   ============================================================ */
'use strict';

/**
 * Convert a wall-clock date/time in `timeZone` to a UTC epoch (ms).
 * `dateStr` is YYYY-MM-DD, `timeStr` HH:MM (defaults to 23:59).
 *
 * Two passes: the first uses the offset at the naive guess, the second
 * re-reads the offset at the resulting instant, so a DST boundary lands
 * on the offset actually in force at the target time.
 */
function wallTimeInZone(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '23:59').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);

  const offsetAt = (utcMs) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUtc - utcMs;
  };

  let target = guess - offsetAt(guess);
  target = guess - offsetAt(target);
  return target;
}

/** True when `now` is past the assignment's deadline in the school's zone. */
function deadlinePassed(dueDate, dueTime, timeZone, now = Date.now()) {
  if (!dueDate) return false;
  return now > wallTimeInZone(dueDate, dueTime, timeZone);
}

module.exports = { wallTimeInZone, deadlinePassed };
