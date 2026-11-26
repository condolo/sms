/* ============================================================
   Removing a staff member (HR "Delete Selected" and the Teachers
   page's Remove) — v5.289.0.

   Reported live: a staff record deleted in HR left its login active
   (the login was looked up by an exact email match only, and the
   login's email differed), and its 15 teaching assignments and 19
   timetable lessons kept pointing at the deleted record, so the
   classes showed "Not current" and the person's other record showed
   nothing assigned.

   What removal now does, for each staff record:
     1. Refuses while the record still teaches something: teaching
        assignments, active timetable lessons (as teacher or co-teacher)
        or form / assistant form teacher of an active stream. Those are
        handed over first (Timetable → Allocation → Change), so no class
        silently loses its teacher and no work is stranded.
     2. Refuses the actor's own record, and an administrator's record
        unless the actor is an administrator.
     3. Ends the login linked to the record — by teacher.userId first,
        else by email ignoring case. A login that also holds a parent /
        guardian role keeps that role and loses only staff access;
        otherwise it is deactivated, as Settings → Users → Remove does
        (listed under Removed users, can be reactivated). Every open
        session is signed out.
   The caller writes the audit entry.
   ============================================================ */
'use strict';

const mongoose = require('mongoose');
const { tenantModel } = require('./tenant-model');
const { revokeUserTokens } = require('./token-version');
const { invalidateScopeCache } = require('../middleware/scopeMiddleware');

const PARENT_ROLES = ['parent', 'guardian'];
const ADMIN_ROLES  = ['admin', 'superadmin'];

const isOid = v => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rolesOf = u => [...new Set([u?.role, ...(Array.isArray(u?.roles) ? u.roles : [])].filter(Boolean))];

/* Every form a teacher can be referenced by: login id, staff id, Mongo _id. */
function teacherIdForms(teacher) {
  return [...new Set([teacher.userId, teacher.id, teacher._id && String(teacher._id)].filter(Boolean).map(String))];
}

function teacherName(teacher) {
  return [teacher.title, teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || teacher.email || 'This staff member';
}

/* What the record still teaches. */
async function staffLinks(ctx, schoolId, teacher) {
  const forms = teacherIdForms(teacher);
  const [assignments, lessons, formStreams] = await Promise.all([
    tenantModel('teaching_assignments', ctx).countDocuments({ schoolId, teacherId: { $in: forms } }),
    tenantModel('timetable', ctx).countDocuments({
      schoolId, isActive: { $ne: false },
      $or: [{ teacherId: { $in: forms } }, { coTeacherIds: { $in: forms } }],
    }),
    tenantModel('streams', ctx).countDocuments({
      schoolId, status: { $ne: 'inactive' },
      $or: [{ formTeacherId: { $in: forms } }, { assistantFormTeacherId: { $in: forms } }],
    }),
  ]);
  return { assignments, lessons, formStreams };
}

function linksMessage({ assignments, lessons, formStreams }) {
  const parts = [];
  if (assignments) parts.push(`${assignments} subject${assignments === 1 ? '' : 's'}`);
  if (lessons) parts.push(`${lessons} timetable lesson${lessons === 1 ? '' : 's'}`);
  if (formStreams) parts.push(`form teacher of ${formStreams} stream${formStreams === 1 ? '' : 's'}`);
  if (!parts.length) return null;
  return `still has ${parts.join(', ')}. Give these to another teacher first (Timetable → Allocation → Change), then delete.`;
}

/* The login linked to the record: teacher.userId first, else the email (any case).
   Returns { user } or { user: null, ambiguous: true } when several logins share the email. */
async function findStaffLogin(ctx, schoolId, teacher) {
  const Users = tenantModel('users', ctx);
  if (teacher.userId) {
    const or = [{ id: teacher.userId }];
    if (isOid(teacher.userId)) or.push({ _id: { $in: [new mongoose.Types.ObjectId(teacher.userId)] } });
    const user = await Users.findOne({ schoolId, $or: or }).lean();
    if (user) return { user };
  }
  const email = typeof teacher.email === 'string' ? teacher.email.trim() : '';
  if (!email) return { user: null };
  const found = await Users.find({ schoolId, email: new RegExp(`^${escapeRe(email)}$`, 'i') }).limit(5).lean();
  const active = found.filter(u => u.isActive !== false);
  if (active.length > 1) return { user: null, ambiguous: true };
  return { user: active[0] ?? found[0] ?? null };
}

/* Why this record can't be removed by this actor, or null. */
async function removalProblem(req, ctx, teacher, login) {
  const { schoolId, userId, role, roles } = req.jwtUser;
  const loginId = login && (login.id || String(login._id));
  if (loginId && (loginId === userId || String(login._id) === userId)) {
    return 'is your own record. Ask another administrator to remove it.';
  }
  const actorRoles = [role, ...(Array.isArray(roles) ? roles : [])];
  if (login && rolesOf(login).some(r => ADMIN_ROLES.includes(r)) && !actorRoles.some(r => ADMIN_ROLES.includes(r))) {
    return 'has an administrator login. Only an administrator can remove it.';
  }
  return linksMessage(await staffLinks(ctx, schoolId, teacher));
}

/* End staff access on the login. Returns 'deactivated' | 'parent_kept' | 'already_inactive' | 'none'. */
async function endStaffLogin(ctx, schoolId, login) {
  if (!login) return 'none';
  const Users = tenantModel('users', ctx);
  const filter = login.id ? { schoolId, id: login.id } : { schoolId, _id: login._id };
  const now = new Date().toISOString();
  const keep = rolesOf(login).filter(r => PARENT_ROLES.includes(r));
  let outcome;
  if (keep.length && login.isActive !== false) {
    await Users.updateOne(filter, { $set: { role: keep[0], roles: keep, updatedAt: now } });
    outcome = 'parent_kept';
  } else if (login.isActive === false) {
    outcome = 'already_inactive';
  } else {
    await Users.updateOne(filter, { $set: { isActive: false, updatedAt: now } });
    outcome = 'deactivated';
  }
  if (login.id) {
    await revokeUserTokens(login.id).catch(err => console.warn('[staff-removal] token revocation (non-fatal):', err.message));
  }
  invalidateScopeCache(login.id || String(login._id), schoolId);
  return outcome;
}

module.exports = { teacherIdForms, teacherName, staffLinks, linksMessage, findStaffLogin, removalProblem, endStaffLogin };
