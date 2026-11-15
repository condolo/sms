/* ============================================================
   Every identifier one person's teaching_assignments / timetable slots
   may be keyed by.

   teaching_assignments.teacherId is SUPPOSED to be the login id the JWT
   carries (see teaching-assignments.js's canonicalTeacherId comment), but
   real data has three other forms for the same person:
     - teachers.id — a row created before the login existed, or while the
       staff record wasn't linked yet. The two lazy re-key paths
       (settings.js invite-with-staffId, timetable.js GET /my) only fire
       when teacher.userId is still UNSET, so a row keyed by teachers.id for
       a teacher whose link was set some other way is never re-keyed.
     - the user's _id string vs its `id` field — a school whose user docs
       have no `id` (onboarded through an irregular path, like Mascit's
       classes were) gets a JWT userId of String(_id) (auth.js), while
       assignment creation stored `matchingUser.id` (undefined → fell back
       to teachers.id).

   Reported directly (2026-11-12, Mascit Lab Academy): "teachers assigned
   classes cannot mark attendance". Matching only `teacherId === userId`
   made every such row silently invisible — no error, just "not in your
   assigned scope". Resolve every form that provably belongs to this login
   and match any of them. A staff record only counts if it is linked to
   THIS login, or unlinked with this login's exact email — never one linked
   to a different login. Any lookup failure degrades to the old exact-match
   behaviour, never to wider access.

   Lives here (not in scopeMiddleware) because subject-scope.js needs the
   same forms for the mark write gate; requiring a middleware module from
   a util would invert the dependency direction.
   ============================================================ */
'use strict';

const { _model } = require('./model');

async function teacherIdForms(userId, schoolId) {
  const forms = new Set([userId].filter(Boolean));
  if (!userId || !schoolId) return [...forms];
  try {
    const or = [{ id: userId }];
    if (/^[a-f\d]{24}$/i.test(userId)) {
      const mongoose = require('mongoose');
      or.push({ _id: new mongoose.Types.ObjectId(userId) });
    }
    const user = await _model('users').findOne({ schoolId, $or: or }).select('id email').lean();
    if (!user) return [...forms];
    if (user.id) forms.add(user.id);
    if (user._id) forms.add(String(user._id));

    const loginForms = new Set(forms);
    const tOr = [{ userId: { $in: [...loginForms] } }];
    if (user.email) {
      const e = String(user.email);
      tOr.push({ email: { $in: [...new Set([e, e.toLowerCase()])] } });
    }
    const teachers = await _model('teachers').find({ schoolId, $or: tOr }).select('id userId').lean();
    for (const t of teachers || []) {
      if (t.userId && !loginForms.has(t.userId)) continue; // linked to someone else
      if (t.id) forms.add(t.id);
    }
  } catch (err) {
    console.error('[teacherIdForms] lookup failed (falling back to exact match):', err.message);
  }
  return [...forms];
}

module.exports = { teacherIdForms };
