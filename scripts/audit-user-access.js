/**
 * audit-user-access.js — READ-ONLY report of what one person can do, per school.
 *
 * For each school where the person has an account it prints:
 *   1. the account: role(s), active or not, staff profile, classes taught;
 *   2. every row in Settings → Roles & Permissions with the View / Edit / Delete
 *      the server will actually allow (role(s) combined + personal overrides,
 *      the same rule as server/middleware/rbac.js), marking rows that are
 *      strict (only an explicit tick counts);
 *   3. what their role NAME gives on top (leadership floors, whole-school
 *      reach), read from the server's own role lists where exported;
 *   4. what stays out of reach whatever is ticked.
 *
 * Writes nothing. Prints no passwords, hashes or tokens.
 *
 * Usage (on a machine with database access):
 *   node scripts/audit-user-access.js --name "Collins Odhiambo Ochoo"
 *   node scripts/audit-user-access.js --email someone@school.ac.ke
 *   node scripts/audit-user-access.js --name "Collins Ochoo" --school trinity --school trinitas
 * Uses MONGODB_URI (and MONGODB_DB_NAME if set) from the environment / .env.
 */
'use strict';

const path     = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { MODULE_REGISTRY } = require('../server/config/moduleRegistry');
const { _mergeUserOverrides } = require('../server/middleware/rbac');
const { EXPLICIT_SUB_KEYS, ROLE_FLOOR_SUB_KEYS } = require('../server/middleware/explicit-sub');
const ScopeEngine = require('../server/utils/scopeEngine');
const { GROWTH_PROFILE_STAFF_ROLES } = require('../server/utils/self-service-scope');

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const NAME   = argOf('--name');
const EMAIL  = argOf('--email');
const SLUGS  = args.reduce((a, v, i) => (v === '--school' && args[i + 1] ? [...a, args[i + 1].toLowerCase()] : a), []);
if (!NAME && !EMAIL) { console.error('Give --name "Full Name" or --email address'); process.exit(1); }

const col = (n) => mongoose.connection.db.collection(n);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROLE_ALIASES = { deputy: 'deputy_principal' };

/* Rows the server checks strictly (hasExplicitSubGrant: no module fallback).
   ROLE_FLOOR_SUB_KEYS / EXPLICIT_SUB_KEYS come from the server; the rest are
   the long-standing strict rows found in the v5.279.0 audit. */
const STRICT = new Set([
  ...ROLE_FLOOR_SUB_KEYS, ...EXPLICIT_SUB_KEYS,
  'settings__permissions', 'settings__audit_log', 'reports__mark_list_school_wide',
  'reports__academic_analytics_school_wide', 'attendance__all_classes', 'attendance__report',
  'attendance__absentees', 'attendance__conflicts', 'timetable__manage', 'timetable__generate',
  'lessons__template', 'lessons__import', 'students__duplicates', 'students__purge',
  'students__portal_accounts', 'students__reset_passwords', 'students__promote',
  'grades__mark_submissions', 'report_cards__report_generate', 'council__manage',
  'messages__moderate', 'hr__payroll_view', 'hr__leave_view', 'hr__documents',
]);

/* What a role NAME gives on top of ticks — from server/utils/scopeEngine.js and
   self-service-scope.js where exported; others mirrored from the file named. */
const MANAGEMENT  = new Set(['admin', 'superadmin', 'deputy_principal', 'deputy', 'principal', 'hod']);           // subject-scope.js
const HR_ROLES    = new Set(['superadmin', 'admin', 'hr']);                                                       // hr.js
const LP_ADMIN    = new Set(['superadmin', 'admin', 'principal', 'head_teacher']);                                // lesson-plans.js
const EXAM_STATUS = new Set(['teacher', 'exams_officer', 'admin', 'superadmin']);                                 // exams.js
const EXAM_CANCEL = new Set(['exams_officer', 'admin', 'superadmin']);                                            // exams.js
const PATRON      = new Set(['admin', 'principal', 'deputy_principal', 'superadmin']);                            // council.js
const REVIEW      = new Set(['admin', 'principal', 'section_head']);                                              // mark-submissions.js
const ADMINISH    = new Set(['admin', 'superadmin']);

function roleFloors(keys) {
  const has = (set) => keys.some(r => set.has(r));
  const out = [];
  if (has(ADMINISH)) out.push('Admin-level actions: academic years, school profile, payroll release, principal remark, unlock comments, M-Pesa registration, choosing attendance/behaviour officers, subscription');
  if (has(MANAGEMENT)) out.push('Management: enter/correct marks for any class & subject; manage any Kindergarten indicators; full report cards for every class');
  if (has(ScopeEngine.ATTENDANCE_FLOOR_ROLES)) out.push('Attendance: every class');
  if (has(ScopeEngine.ASSESSMENT_FLOOR_ROLES)) out.push('Markbook / Mark List: every class, school-wide');
  if (has(ScopeEngine.LESSONS_FLOOR_ROLES)) out.push('Lessons & coverage: every class');
  if (has(ScopeEngine.TIMETABLE_FLOOR_ROLES)) out.push('Timetable: whole-school management');
  if (has(HR_ROLES)) out.push('HR: Staff tab & overview, all staff documents, all payslips');
  if (has(LP_ADMIN)) out.push("Lesson plans: every teacher's plans");
  if (has(EXAM_CANCEL)) out.push('Exams: start, complete and cancel any exam');
  else if (has(EXAM_STATUS)) out.push('Exams: start and complete exams (not cancel)');
  if (has(PATRON)) out.push('Student Council: patron console');
  if (has(REVIEW)) out.push('Mark submissions: review / approve');
  if (keys.some(r => GROWTH_PROFILE_STAFF_ROLES.includes(r))) out.push('Growth Profile: add / edit / verify records');
  return out;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI,
    process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {});
  console.log('READ-ONLY user access audit — nothing is written.\n');

  let schools = await col('schools').find(SLUGS.length ? { slug: { $in: SLUGS } } : {}).project({ id: 1, slug: 1, name: 1 }).toArray();
  if (SLUGS.length && !schools.length) console.log(`No school with slug ${SLUGS.join(', ')}. Showing every school the person is found in.\n`);
  if (!schools.length) schools = await col('schools').find({}).project({ id: 1, slug: 1, name: 1 }).toArray();
  const byId = new Map(schools.map(s => [s.id || String(s._id), s]));

  const who = [];
  if (EMAIL) who.push({ email: new RegExp(`^${esc(EMAIL.trim())}$`, 'i') });
  if (NAME) {
    const parts = NAME.trim().split(/\s+/).map(esc);
    who.push({ name: new RegExp(parts.join('.*'), 'i') });
    if (parts.length >= 2) {
      who.push({ $and: [{ firstName: new RegExp(`^${parts[0]}`, 'i') }, { lastName: new RegExp(`${parts[parts.length - 1]}$`, 'i') }] });
    }
  }
  const users = await col('users').find({ $or: who, schoolId: { $in: [...byId.keys()] } })
    .project({ id: 1, name: 1, firstName: 1, lastName: 1, email: 1, role: 1, primaryRole: 1, roles: 1, isActive: 1, schoolId: 1, lastLoginAt: 1 }).toArray();
  if (!users.length) { console.log('No matching account found.'); return mongoose.disconnect(); }

  for (const u of users) {
    const school = byId.get(u.schoolId) || {};
    const uid = u.id || String(u._id);
    const primary = u.primaryRole || u.role;
    const keys = [...new Set([primary, ...(Array.isArray(u.roles) ? u.roles : [])].filter(Boolean))];
    console.log('═'.repeat(78));
    console.log(`${school.name || u.schoolId}  (${school.slug || '?'})`);
    console.log('═'.repeat(78));
    console.log(`Account:  ${u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim()}  <${u.email || 'no email'}>`);
    console.log(`Status:   ${u.isActive === false ? 'INACTIVE (cannot sign in)' : 'active'}${u.lastLoginAt ? `   last sign-in ${String(u.lastLoginAt).slice(0, 10)}` : ''}`);
    console.log(`Role:     ${primary}${keys.length > 1 ? `   + also: ${keys.filter(k => k !== primary).join(', ')}` : ''}`);
    if (keys.includes('superadmin')) console.log('          SUPERADMIN: passes every permission check in this school.');

    const teacher = await col('teachers').findOne({ schoolId: u.schoolId, $or: [{ userId: uid }, { email: u.email }] }, { projection: { id: 1, firstName: 1, lastName: 1 } });
    const tForms = [uid, teacher?.id].filter(Boolean);
    const tas = await col('teaching_assignments').find({ schoolId: u.schoolId, teacherId: { $in: tForms } }).project({ classId: 1, subjectName: 1, subjectId: 1, streamId: 1 }).toArray();
    console.log(`Staff profile: ${teacher ? 'yes' : 'none'}   Teaching assignments: ${tas.length}`);

    // Effective permissions: roles combined, then personal overrides (rbac.js rule)
    const merged = {};
    for (const k of keys) {
      let doc = await col('role_permissions').findOne({ schoolId: u.schoolId, roleKey: k });
      if (!doc && ROLE_ALIASES[k]) doc = await col('role_permissions').findOne({ schoolId: u.schoolId, roleKey: ROLE_ALIASES[k] });
      if (!doc) console.log(`  ! No permissions record for role "${k}" — that role grants nothing.`);
      for (const [mod, acts] of Object.entries(doc?.permissions || {})) {
        if (!Array.isArray(acts)) continue;
        merged[mod] = [...new Set([...(merged[mod] || []), ...acts])];
      }
    }
    const override = await col('role_permissions').findOne({ schoolId: u.schoolId, userId: uid });
    const perms = override?.permissions ? _mergeUserOverrides(merged, override.permissions) : merged;
    if (override?.permissions) console.log(`Personal overrides: YES (${Object.keys(override.permissions).length} entries) — these change what the role gives.`);

    const allow = (mod, sub, a) => {
      const k = `${mod}__${sub}`;
      if (keys.includes('superadmin')) return true;
      if (Array.isArray(perms[k])) return perms[k].includes(a);
      // Strict: no module fallback. Every strict check lets admins through by role (v5.279.0 audit).
      if (STRICT.has(k)) return keys.some(r => ADMINISH.has(r));
      return Array.isArray(perms[mod]) && perms[mod].includes(a);
    };
    const mark = (b) => (b ? '✓' : '·');

    console.log('\nSettings rows (V = view, E = edit, D = delete; * = only an explicit tick counts, except for admins, who pass these by role):');
    for (const m of MODULE_REGISTRY) {
      const rows = m.subs.map(s => {
        const v = allow(m.key, s.key, 'read');
        const e = allow(m.key, s.key, 'update') || allow(m.key, s.key, 'create');
        const d = allow(m.key, s.key, 'delete');
        return { label: s.label, v, e, d, strict: STRICT.has(`${m.key}__${s.key}`) };
      });
      const any = rows.some(r => r.v || r.e || r.d);
      console.log(`\n  ${m.label}${any ? '' : '   — no access'}`);
      if (!any) continue;
      for (const r of rows) {
        console.log(`    ${mark(r.v)} ${mark(r.e)} ${mark(r.d)}  ${r.label}${r.strict ? ' *' : ''}`);
      }
    }

    const floors = roleFloors(keys);
    console.log('\nGiven by role NAME on top of the ticks:');
    console.log(floors.length ? floors.map(f => `  • ${f}`).join('\n') : '  • nothing — this role relies entirely on its ticks');

    const wholeSchoolMarks = keys.some(r => ScopeEngine.ASSESSMENT_FLOOR_ROLES.has(r)) || allow('reports', 'mark_list_school_wide', 'read');
    const wholeSchoolAttend = keys.some(r => ScopeEngine.ATTENDANCE_FLOOR_ROLES.has(r)) || allow('attendance', 'all_classes', 'read') || allow('attendance', 'all_classes', 'create');
    console.log('\nReach:');
    console.log(`  Marks / Mark List:  ${wholeSchoolMarks ? 'every class' : `only classes they teach (${tas.length} assignment${tas.length === 1 ? '' : 's'})`}`);
    console.log(`  Attendance:         ${wholeSchoolAttend ? 'every class' : 'only classes they teach or form-teach'}`);

    console.log('\nNever, whatever is ticked:');
    if (!keys.includes('superadmin')) {
      console.log('  • backups, granting the Admin role, resetting another admin\'s password (superadmin only)');
      if (!keys.some(r => ADMINISH.has(r))) console.log('  • choosing attendance/behaviour officers, subscription, full data export, fee-block override (admin only)');
    }
    console.log('  • changing records protected by rules: subjects not on the class curriculum, learners not enrolled in an elective, marks locked by a published report card, archived years');
    console.log('');
  }
  await mongoose.disconnect();
}

run().catch(err => { console.error(err.message); process.exit(1); });
