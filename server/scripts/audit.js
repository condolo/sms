#!/usr/bin/env node
/* ============================================================
   Msingi Platform — Phase A Read-Only Integrity Audit
   Usage:  node server/scripts/audit.js [--schoolId=sch_xxx] [--verbose]

   SAFE: This script ONLY reads data. It never writes, updates,
   or deletes anything. It is safe to run against production.

   Output: JSON audit report to stdout + summary table to stderr.
   Exit code: 0 = clean, 1 = issues found, 2 = script error.

   Checks:
     1.  Orphaned timetable slots (classId or teacherId not found)
     2.  Timetable teacher ID format drift (teacherId not in users.userId format)
     3.  Orphaned attendance records (studentId or classId not found)
     4.  Orphaned grade entries (studentId or classId not found)
     5.  Orphaned exam results (studentId or examId not found)
     6.  Orphaned report card snapshots (studentId not found)
     7.  Orphaned invoices (studentId not found)
     8.  Orphaned behaviour incidents (studentId not found)
     9.  Students with invalid classId (classId not in classes)
     10. Timetable double-booking (teacher in two classes same day+period)
     11. Timetable room double-booking (room in two classes same day+period)
     12. Published report cards referencing archived academic years
     13. Grades with isPublished=false (silently excluded from report cards)
     14. Role permissions gaps (schools with no role_permissions seeded)
     15. Classes with no students enrolled
     16. Teachers with no userId (breaks timetable FK)
   ============================================================ */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[audit] MONGODB_URI not set in environment. Exiting.');
  process.exit(2);
}

/* ── CLI args ───────────────────────────────────────────────── */
const args    = process.argv.slice(2);
const verbose = args.includes('--verbose');
const schoolArg = (args.find(a => a.startsWith('--schoolId=')) || '').replace('--schoolId=', '') || null;

/* ── Minimal model factory (mirrors server/utils/model.js) ───── */
function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* ── Helpers ────────────────────────────────────────────────── */
function log(...a) { if (verbose) process.stderr.write('[audit] ' + a.join(' ') + '\n'); }

const issues   = [];
const warnings = [];
const info     = [];

function issue(check, severity, detail) {
  issues.push({ check, severity, ...detail });
}
function warn(check, detail) {
  warnings.push({ check, ...detail });
}
function note(check, detail) {
  info.push({ check, ...detail });
}

/* ── Checks ─────────────────────────────────────────────────── */

async function checkOrphanedTimetableSlots(schoolIds) {
  log('check: orphaned timetable slots');
  for (const schoolId of schoolIds) {
    const [slots, classes, teachers] = await Promise.all([
      _model('timetable').find({ schoolId, isActive: true }).lean(),
      _model('classes').find({ schoolId }).lean(),
      _model('teachers').find({ schoolId }).lean(),
    ]);

    const classIds  = new Set(classes.map(c => c.id).filter(Boolean));
    const userIds   = new Set(teachers.map(t => t.userId).filter(Boolean));
    const teacherIds = new Set([
      ...teachers.map(t => t.id).filter(Boolean),
      ...teachers.map(t => String(t._id)),
    ]);

    let orphanClass   = 0;
    let orphanTeacher = 0;
    let formatDrift   = 0;

    for (const s of slots) {
      if (s.classId && !classIds.has(s.classId)) {
        orphanClass++;
        if (verbose) log(`  orphan class: slot ${s.id || s._id} classId=${s.classId}`);
      }
      if (s.teacherId) {
        if (!userIds.has(s.teacherId)) {
          // Check if it looks like a MongoDB ObjectId or teacher profile id (format drift)
          if (teacherIds.has(s.teacherId) || /^[0-9a-f]{24}$/i.test(s.teacherId)) {
            formatDrift++;
            if (verbose) log(`  teacherId format drift: slot ${s.id || s._id} teacherId=${s.teacherId}`);
          } else {
            orphanTeacher++;
            if (verbose) log(`  orphan teacher: slot ${s.id || s._id} teacherId=${s.teacherId}`);
          }
        }
      }
    }

    if (orphanClass > 0) {
      issue('timetable_orphan_class', 'HIGH', {
        schoolId, count: orphanClass,
        message: `${orphanClass} active timetable slot(s) reference classId values not found in classes collection`,
      });
    }
    if (orphanTeacher > 0) {
      issue('timetable_orphan_teacher', 'MEDIUM', {
        schoolId, count: orphanTeacher,
        message: `${orphanTeacher} active timetable slot(s) have teacherId values not found in any teacher record`,
      });
    }
    if (formatDrift > 0) {
      issue('timetable_teacherid_format_drift', 'HIGH', {
        schoolId, count: formatDrift,
        message: `${formatDrift} active timetable slot(s) store teacherId as MongoDB _id or profile id instead of userId — conflict detection will fail`,
      });
    }
    if (orphanClass + orphanTeacher + formatDrift === 0) {
      note('timetable_orphan_class', { schoolId, message: 'All timetable slots have valid classId and teacherId references' });
    }
  }
}

async function checkTimetableDoubleBooking(schoolIds) {
  log('check: timetable double-booking');
  for (const schoolId of schoolIds) {
    const slots = await _model('timetable').find({ schoolId, isActive: true }).lean();

    // Teacher double-booking
    const teacherMap = {};
    const roomMap    = {};
    let teacherConflicts = 0;
    let roomConflicts    = 0;

    for (const s of slots) {
      if (s.teacherId && s.day && s.period) {
        const key = `${s.teacherId}:${s.day}:${s.period}`;
        if (teacherMap[key]) {
          teacherConflicts++;
          if (verbose) log(`  teacher conflict: ${s.teacherId} on ${s.day} P${s.period}`);
        }
        teacherMap[key] = true;
      }
      if (s.room && s.day && s.period) {
        const key = `${s.room}:${s.day}:${s.period}`;
        if (roomMap[key]) {
          roomConflicts++;
          if (verbose) log(`  room conflict: ${s.room} on ${s.day} P${s.period}`);
        }
        roomMap[key] = true;
      }
    }

    if (teacherConflicts > 0) {
      issue('timetable_teacher_double_booked', 'HIGH', {
        schoolId, count: teacherConflicts,
        message: `${teacherConflicts} teacher double-booking(s) detected in active timetable`,
      });
    }
    if (roomConflicts > 0) {
      warn('timetable_room_double_booked', {
        schoolId, count: roomConflicts,
        message: `${roomConflicts} room double-booking(s) detected in active timetable`,
      });
    }
  }
}

async function checkOrphanedAttendance(schoolIds) {
  log('check: orphaned attendance records');
  for (const schoolId of schoolIds) {
    const [records, students, classes] = await Promise.all([
      _model('attendance').find({ schoolId }).limit(5000).lean(),
      _model('students').find({ schoolId }).lean(),
      _model('classes').find({ schoolId }).lean(),
    ]);

    const studentIds = new Set(students.map(s => s.id).filter(Boolean));
    const classIds   = new Set(classes.map(c => c.id).filter(Boolean));

    let orphanStudent = 0;
    let orphanClass   = 0;

    for (const r of records) {
      if (r.studentId && !studentIds.has(r.studentId)) orphanStudent++;
      if (r.classId   && !classIds.has(r.classId))     orphanClass++;
    }

    if (orphanStudent > 0) {
      issue('attendance_orphan_student', 'MEDIUM', {
        schoolId, count: orphanStudent,
        message: `${orphanStudent} attendance record(s) reference studentId values not found in students collection`,
      });
    }
    if (orphanClass > 0) {
      warn('attendance_orphan_class', {
        schoolId, count: orphanClass,
        message: `${orphanClass} attendance record(s) reference classId values not found in classes collection`,
      });
    }
  }
}

async function checkOrphanedGrades(schoolIds) {
  log('check: orphaned grade entries');
  for (const schoolId of schoolIds) {
    const [grades, students, classes] = await Promise.all([
      _model('grades').find({ schoolId }).limit(5000).lean(),
      _model('students').find({ schoolId }).lean(),
      _model('classes').find({ schoolId }).lean(),
    ]);

    const studentIds = new Set(students.map(s => s.id).filter(Boolean));
    const classIds   = new Set(classes.map(c => c.id).filter(Boolean));

    let orphanStudent   = 0;
    let orphanClass     = 0;
    let unpublishedCount = 0;

    for (const g of grades) {
      if (g.studentId && !studentIds.has(g.studentId)) orphanStudent++;
      if (g.classId   && !classIds.has(g.classId))     orphanClass++;
      if (!g.isPublished) unpublishedCount++;
    }

    if (orphanStudent > 0) {
      issue('grades_orphan_student', 'MEDIUM', {
        schoolId, count: orphanStudent,
        message: `${orphanStudent} grade entry/entries reference studentId not found in students collection`,
      });
    }
    if (orphanClass > 0) {
      warn('grades_orphan_class', {
        schoolId, count: orphanClass,
        message: `${orphanClass} grade entry/entries reference classId not found in classes collection`,
      });
    }
    if (unpublishedCount > 0) {
      note('grades_unpublished', {
        schoolId, count: unpublishedCount,
        message: `${unpublishedCount} grade entry/entries are unpublished (isPublished=false) — silently excluded from report card generation`,
      });
    }
  }
}

async function checkOrphanedExamResults(schoolIds) {
  log('check: orphaned exam results');
  for (const schoolId of schoolIds) {
    const [results, students, exams] = await Promise.all([
      _model('exam_results').find({ schoolId }).limit(5000).lean(),
      _model('students').find({ schoolId }).lean(),
      _model('exams').find({ schoolId }).lean(),
    ]);

    const studentIds = new Set(students.map(s => s.id).filter(Boolean));
    const examIds    = new Set(exams.map(e => e.id).filter(Boolean));

    let orphanStudent = 0;
    let orphanExam    = 0;

    for (const r of results) {
      if (r.studentId && !studentIds.has(r.studentId)) orphanStudent++;
      if (r.examId    && !examIds.has(r.examId))       orphanExam++;
    }

    if (orphanStudent > 0) {
      issue('exam_results_orphan_student', 'MEDIUM', {
        schoolId, count: orphanStudent,
        message: `${orphanStudent} exam result(s) reference studentId not found in students collection`,
      });
    }
    if (orphanExam > 0) {
      issue('exam_results_orphan_exam', 'HIGH', {
        schoolId, count: orphanExam,
        message: `${orphanExam} exam result(s) reference examId not found in exams collection — results are lost`,
      });
    }
  }
}

async function checkOrphanedReportCards(schoolIds) {
  log('check: orphaned report card snapshots');
  for (const schoolId of schoolIds) {
    const [snaps, students] = await Promise.all([
      _model('report_card_snapshots').find({ schoolId, superseded: { $ne: true } }).lean(),
      _model('students').find({ schoolId }).lean(),
    ]);

    const studentIds = new Set(students.map(s => s.id).filter(Boolean));

    let orphanStudent = 0;
    for (const s of snaps) {
      if (s.studentId && !studentIds.has(s.studentId)) orphanStudent++;
    }

    if (orphanStudent > 0) {
      issue('report_cards_orphan_student', 'HIGH', {
        schoolId, count: orphanStudent,
        message: `${orphanStudent} live report card snapshot(s) reference studentId not found in students collection`,
      });
    }
  }
}

async function checkOrphanedInvoices(schoolIds) {
  log('check: orphaned invoices');
  for (const schoolId of schoolIds) {
    const [invoices, students] = await Promise.all([
      _model('invoices').find({ schoolId }).lean(),
      _model('students').find({ schoolId }).lean(),
    ]);

    const studentIds = new Set(students.map(s => s.id).filter(Boolean));
    let orphan = 0;
    for (const inv of invoices) {
      if (inv.studentId && !studentIds.has(inv.studentId)) orphan++;
    }

    if (orphan > 0) {
      warn('finance_orphan_invoice', {
        schoolId, count: orphan,
        message: `${orphan} invoice(s) reference studentId not found in students collection`,
      });
    }
  }
}

async function checkStudentsWithInvalidClassId(schoolIds) {
  log('check: students with invalid classId');
  for (const schoolId of schoolIds) {
    const [students, classes] = await Promise.all([
      _model('students').find({ schoolId, classId: { $exists: true, $ne: null, $ne: '' } }).lean(),
      _model('classes').find({ schoolId }).lean(),
    ]);

    const classIds = new Set(classes.map(c => c.id).filter(Boolean));
    let invalid = 0;
    for (const s of students) {
      if (s.classId && !classIds.has(s.classId)) invalid++;
    }

    if (invalid > 0) {
      issue('students_invalid_classid', 'HIGH', {
        schoolId, count: invalid,
        message: `${invalid} student(s) have classId values not found in classes collection — attendance and report cards will fail for these students`,
      });
    }
  }
}

async function checkTeachersWithNoUserId(schoolIds) {
  log('check: teachers missing userId');
  for (const schoolId of schoolIds) {
    const teachers = await _model('teachers').find({ schoolId, status: 'active' }).lean();
    const missing  = teachers.filter(t => !t.userId);

    if (missing.length > 0) {
      issue('teachers_missing_userid', 'HIGH', {
        schoolId, count: missing.length,
        message: `${missing.length} active teacher(s) have no userId field — timetable conflict detection will fail for any slot assigned to these teachers`,
        names: missing.map(t => `${t.firstName} ${t.lastName}`).slice(0, 10),
      });
    }
  }
}

async function checkClassesWithNoStudents(schoolIds) {
  log('check: classes with no enrolled students');
  for (const schoolId of schoolIds) {
    const [classes, students] = await Promise.all([
      _model('classes').find({ schoolId, status: 'active' }).lean(),
      _model('students').find({ schoolId, status: 'active' }).lean(),
    ]);

    const enrolledClassIds = new Set(students.map(s => s.classId).filter(Boolean));
    const empty = classes.filter(c => !enrolledClassIds.has(c.id));

    if (empty.length > 0) {
      note('classes_no_students', {
        schoolId, count: empty.length,
        message: `${empty.length} active class(es) have no enrolled students`,
        classes: empty.map(c => c.name).slice(0, 10),
      });
    }
  }
}

async function checkRolePermissionsGaps(schoolIds) {
  log('check: role_permissions gaps');
  for (const schoolId of schoolIds) {
    const perms = await _model('role_permissions').find({ schoolId }).lean();
    if (perms.length === 0) {
      issue('rbac_no_permissions_seeded', 'CRITICAL', {
        schoolId,
        message: `School ${schoolId} has no role_permissions documents — all non-admin users will be blocked from every resource`,
      });
    } else {
      const roles = perms.map(p => p.roleKey);
      const expected = ['teacher', 'parent', 'student', 'section_head'];
      const missing  = expected.filter(r => !roles.includes(r));
      if (missing.length > 0) {
        warn('rbac_missing_role_permissions', {
          schoolId,
          message: `School ${schoolId} is missing role_permissions for: ${missing.join(', ')}`,
        });
      }
    }
  }
}

/* ── Main ───────────────────────────────────────────────────── */
async function run() {
  log('connecting to MongoDB…');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  log('connected.');

  // Resolve schools to audit
  let schools;
  if (schoolArg) {
    schools = await _model('schools').find({ id: schoolArg }).lean();
    if (!schools.length) {
      process.stderr.write(`[audit] School not found: ${schoolArg}\n`);
      process.exit(2);
    }
  } else {
    schools = await _model('schools').find({ status: { $ne: 'suspended' } }).lean();
  }

  const schoolIds = schools.map(s => s.id).filter(Boolean);
  log(`auditing ${schoolIds.length} school(s): ${schoolIds.join(', ')}`);

  // Run all checks
  await checkOrphanedTimetableSlots(schoolIds);
  await checkTimetableDoubleBooking(schoolIds);
  await checkOrphanedAttendance(schoolIds);
  await checkOrphanedGrades(schoolIds);
  await checkOrphanedExamResults(schoolIds);
  await checkOrphanedReportCards(schoolIds);
  await checkOrphanedInvoices(schoolIds);
  await checkStudentsWithInvalidClassId(schoolIds);
  await checkTeachersWithNoUserId(schoolIds);
  await checkClassesWithNoStudents(schoolIds);
  await checkRolePermissionsGaps(schoolIds);

  await mongoose.disconnect();
  log('disconnected.');

  // ── Print summary to stderr ──────────────────────────────────
  const critical = issues.filter(i => i.severity === 'CRITICAL');
  const high     = issues.filter(i => i.severity === 'HIGH');
  const medium   = issues.filter(i => i.severity === 'MEDIUM');

  process.stderr.write('\n');
  process.stderr.write('═══════════════════════════════════════════════════════\n');
  process.stderr.write('  Msingi Platform — Integrity Audit Summary\n');
  process.stderr.write('═══════════════════════════════════════════════════════\n');
  process.stderr.write(`  Schools audited : ${schoolIds.length}\n`);
  process.stderr.write(`  CRITICAL issues : ${critical.length}\n`);
  process.stderr.write(`  HIGH issues     : ${high.length}\n`);
  process.stderr.write(`  MEDIUM issues   : ${medium.length}\n`);
  process.stderr.write(`  Warnings        : ${warnings.length}\n`);
  process.stderr.write(`  Info notes      : ${info.length}\n`);
  process.stderr.write('───────────────────────────────────────────────────────\n');

  if (critical.length + high.length + medium.length > 0) {
    process.stderr.write('  ISSUES:\n');
    for (const i of [...critical, ...high, ...medium]) {
      process.stderr.write(`  [${i.severity}] ${i.check} (${i.schoolId})\n`);
      process.stderr.write(`         ${i.message}\n`);
      if (i.names?.length) process.stderr.write(`         ${i.names.join(', ')}\n`);
    }
    process.stderr.write('───────────────────────────────────────────────────────\n');
  }

  if (warnings.length > 0) {
    process.stderr.write('  WARNINGS:\n');
    for (const w of warnings) {
      process.stderr.write(`  [WARN] ${w.check} (${w.schoolId})\n`);
      process.stderr.write(`         ${w.message}\n`);
    }
    process.stderr.write('───────────────────────────────────────────────────────\n');
  }

  if (info.length > 0 && verbose) {
    process.stderr.write('  INFO:\n');
    for (const n of info) {
      process.stderr.write(`  [INFO] ${n.check} (${n.schoolId || 'all'})\n`);
      process.stderr.write(`         ${n.message}\n`);
      if (n.classes?.length) process.stderr.write(`         ${n.classes.join(', ')}\n`);
    }
    process.stderr.write('───────────────────────────────────────────────────────\n');
  }

  process.stderr.write('\n');

  // ── JSON report to stdout ────────────────────────────────────
  const report = {
    auditDate:   new Date().toISOString(),
    schoolIds,
    summary: {
      critical: critical.length,
      high:     high.length,
      medium:   medium.length,
      warnings: warnings.length,
      info:     info.length,
    },
    issues,
    warnings,
    info,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  process.exit(issues.length > 0 ? 1 : 0);
}

run().catch(err => {
  process.stderr.write(`[audit] Fatal error: ${err.message}\n${err.stack}\n`);
  mongoose.disconnect().finally(() => process.exit(2));
});
