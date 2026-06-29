'use strict';
/* ============================================================
   Shared teacher resolution — four-step email-based lookup.

   Always selects `id` and `userId`; callers add any extra
   fields they need via the `extraFields` param.

   Back-fills `userId` on the teacher doc on first email-match
   so all subsequent calls hit the fast userId path instead.

   Used by: teacher-portal.js, lesson-plans.js, birthdays.js
   ============================================================ */
const mongoose = require('mongoose');
const { _model } = require('./model');

async function resolveTeacher(userId, email, schoolId, extraFields = '') {
  const Teachers = _model('teachers');
  const Users    = _model('users');

  // Build the select string — always include id and userId
  const fieldSet = new Set(['id', 'userId', ...extraFields.split(' ').filter(Boolean)]);
  const select   = [...fieldSet].join(' ');

  // 1. Fast path — userId already written on the teachers doc
  let teacher = await Teachers.findOne({ schoolId, userId }).select(select).lean();
  if (teacher) return teacher;

  // 2. Resolve the user record to get their canonical email
  const isOid   = /^[a-f\d]{24}$/i.test(userId);
  const idQuery  = isOid
    ? { $or: [{ id: userId }, { _id: new mongoose.Types.ObjectId(userId) }], schoolId }
    : { id: userId, schoolId };

  const user = await Users.findOne(idQuery).select('email').lean().catch(() => null);
  const lookupEmail = user?.email || email;
  if (!lookupEmail) return null;

  // 3. Find by email — the pattern /api/teachers/me uses
  teacher = await Teachers.findOne({ schoolId, email: lookupEmail }).select(select).lean();

  // 4. Back-fill userId so future lookups hit path #1
  if (teacher && !teacher.userId) {
    Teachers.updateOne({ id: teacher.id }, { $set: { userId } }).catch(() => {});
  }

  return teacher || null;
}

module.exports = { resolveTeacher };
