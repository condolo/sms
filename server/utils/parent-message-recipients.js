/* ============================================================
   Msingi — Parent-safe message recipient resolution

   Reported directly (2026-10-15): "the parent cannot message the
   school, in the message, I need the parent can select whom they want
   to message, nurse, discipline, subject teachers etc but not fellow
   parents." The Parent Portal's Messages page was read-only — no
   compose feature existed at all (confirmed: ParentDashboard.jsx's
   MessagesPage only ever lists the inbox).

   The hard safety requirement is "not fellow parents." The generic
   /api/messages route (messages.js) accepts an arbitrary `recipients`
   array with no validation beyond a broadcast-roles check for 'all' —
   if a parent were simply granted messages:create, nothing would stop
   them sending to another parent's userId, or to the 'parents' group
   key. This module exists so a parent NEVER supplies a raw recipient
   list at all: they pick a category (resolved here from real
   assignment/role data), and the server re-resolves that category to
   concrete staff userIds at SEND time — never trusting whatever the
   client echoes back.

   Categories, grounded in data that actually exists (no fabricated
   "Nurse" role — there is none in this codebase; see the header note
   on custom tags below):
     - class_teacher   — the child's stream's form teacher, if set.
     - subject:<id>    — the real assigned teacher for one of the
                          child's actual curriculum subjects (compulsory
                          subjects always; electives only if the child
                          is actually enrolled — same rule assessment.js/
                          elective-scope.js already enforce for marks).
     - discipline      — every active user holding the real
                          'discipline_committee' SYSTEM_ROLE.
     - administration  — every active user holding admin/superadmin/
                          principal/deputy_principal/deputy.
     - custom:<tag>     — any responsibility tag a school has added
                          to teachers.extraRoles BEYOND the built-in
                          set (server/config/staffResponsibilities.js) —
                          e.g. a school that tags a staff member "Nurse"
                          via Staff Roles & Responsibilities gets a
                          "Nurse" category here automatically, with zero
                          code change required. A category is only ever
                          offered when at least one active teacher holds
                          it, so a parent never sends into the void.
   Never offered, by construction: 'all', the 'parents'/'students' role
   groups, or any direct parent/guardian/student userId — this module
   only ever resolves to teacher/admin accounts.
   ============================================================ */
'use strict';

const { tenantModel, tenantContext } = require('./tenant-model');
const { isElective, enrolledStudentIds } = require('./elective-scope');
const { BUILTIN_EXTRA_ROLE_VALUES } = require('../config/staffResponsibilities');
const { _model } = require('./model');

const ADMIN_ROLES = new Set(['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy']);

/** One child's resolvable categories: [{ key, label, recipientUserIds }]. */
async function resolveCategoriesForChild(req, studentId) {
  const { schoolId } = req.jwtUser;
  const Students = tenantModel('students', tenantContext(req));
  const student = await Students.findOne({ schoolId, id: studentId }).select('id classId streamId').lean();
  if (!student || !student.classId) return [];

  const categories = [];

  // ── Class / Form Teacher — from the child's own stream, if any ──
  if (student.streamId) {
    const stream = await tenantModel('streams', tenantContext(req))
      .findOne({ schoolId, id: student.streamId }).select('formTeacherId name').lean();
    if (stream?.formTeacherId) {
      const formTeacher = await tenantModel('teachers', tenantContext(req))
        .findOne({ schoolId, id: stream.formTeacherId }).select('userId firstName lastName').lean();
      if (formTeacher?.userId) {
        categories.push({
          key: 'class_teacher',
          label: `Class Teacher (${stream.name ?? 'your child\'s stream'})`,
          recipientUserIds: [formTeacher.userId],
        });
      }
    }
  }

  // ── Subject teachers — only subjects genuinely in this child's curriculum ──
  const links = await tenantModel('class_subjects', tenantContext(req))
    .find({ schoolId, classId: student.classId }).lean();
  if (links.length) {
    const subjectIds = links.map(l => l.subjectId);
    const subjects = await tenantModel('subjects', tenantContext(req))
      .find({ schoolId, id: { $in: subjectIds } }).select('id name').lean();
    const subjectNameById = Object.fromEntries(subjects.map(s => [s.id, s.name]));

    const assignments = await tenantModel('teaching_assignments', tenantContext(req))
      .find({ schoolId, classId: student.classId, subjectId: { $in: subjectIds } }).lean();

    for (const link of links) {
      const elective = await isElective(req, student.classId, link.subjectId);
      if (elective) {
        const enrolled = await enrolledStudentIds(req, link.subjectId);
        if (!enrolled.has(studentId)) continue; // not enrolled in this elective — not offered
      }
      // Compulsory: the assignment scoped to this child's own stream (or a
      // whole-class grant with no streamId) is the real teacher; elective
      // assignments span every stream, so any row for the subject matches.
      const match = assignments.find(a => a.subjectId === link.subjectId &&
        (elective || !a.streamId || a.streamId === student.streamId));
      if (!match) continue; // no teacher actually assigned yet — nothing to offer
      categories.push({
        key: `subject:${link.subjectId}`,
        label: `${subjectNameById[link.subjectId] ?? 'Subject'} Teacher (${match.teacherName ?? 'assigned teacher'})`,
        recipientUserIds: [match.teacherId],
      });
    }
  }

  return categories;
}

/** School-wide categories — same for every child, computed once per request. */
async function resolveSchoolWideCategories(req) {
  const { schoolId } = req.jwtUser;
  const Users = tenantModel('users', tenantContext(req));
  const categories = [];

  const discipline = await Users.find({
    schoolId, isActive: { $ne: false },
    $or: [{ role: 'discipline_committee' }, { roles: 'discipline_committee' }],
  }).select('id').lean();
  if (discipline.length) {
    categories.push({ key: 'discipline', label: 'Discipline Office', recipientUserIds: discipline.map(u => u.id) });
  }

  const admins = await Users.find({
    schoolId, isActive: { $ne: false },
    $or: [...ADMIN_ROLES].flatMap(r => [{ role: r }, { roles: r }]),
  }).select('id').lean();
  if (admins.length) {
    categories.push({ key: 'administration', label: 'School Administration', recipientUserIds: admins.map(u => u.id) });
  }

  // Custom staff-responsibility tags this school has added beyond the
  // built-ins (e.g. "Nurse") — surfaced automatically, never hardcoded.
  const teachers = await tenantModel('teachers', tenantContext(req))
    .find({ schoolId, status: { $ne: 'inactive' }, extraRoles: { $exists: true, $ne: [] } })
    .select('userId extraRoles').lean();
  const school = await _model('schools').findOne({ id: schoolId }).select('staffResponsibilities').lean().catch(() => null);
  const customLabels = Object.fromEntries((school?.staffResponsibilities ?? []).map(r => [r.value, r.label]));

  const customTagUsers = new Map(); // tag -> Set(userId)
  for (const t of teachers) {
    if (!t.userId) continue;
    for (const tag of t.extraRoles ?? []) {
      if (BUILTIN_EXTRA_ROLE_VALUES.has(tag)) continue; // a built-in tag (HOD, Class Teacher, etc.) — not a messaging category
      if (!customTagUsers.has(tag)) customTagUsers.set(tag, new Set());
      customTagUsers.get(tag).add(t.userId);
    }
  }
  for (const [tag, userIds] of customTagUsers) {
    categories.push({
      key: `custom:${tag}`,
      label: customLabels[tag] ?? tag,
      recipientUserIds: [...userIds],
    });
  }

  return categories;
}

/** Full category list for a parent sending about one specific child. */
async function resolveMessageCategories(req, studentId) {
  const [perChild, schoolWide] = await Promise.all([
    resolveCategoriesForChild(req, studentId),
    resolveSchoolWideCategories(req),
  ]);
  return [...perChild, ...schoolWide];
}

/** Re-resolve ONE category at send time — the only server trusts. Returns
 * the recipientUserIds array, or null if the category no longer resolves
 * (e.g. the teacher was deactivated between loading the list and sending). */
async function resolveOneCategory(req, studentId, categoryKey) {
  const all = await resolveMessageCategories(req, studentId);
  const found = all.find(c => c.key === categoryKey);
  return found?.recipientUserIds ?? null;
}

module.exports = { resolveMessageCategories, resolveOneCategory };
