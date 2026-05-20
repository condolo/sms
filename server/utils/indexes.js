/* ============================================================
   InnoLearn — Database Index Definitions
   Called once at server startup after DB connection.
   Uses MongoDB driver directly (collection.createIndex) so
   indexes are created regardless of Mongoose schema definition.

   All indexes are created with { background: true } so they
   don't block the server during initial creation on a live DB.

   Safe to call multiple times — MongoDB is idempotent on
   createIndex for existing indexes.
   ============================================================ */
const { _model } = require('./model');

const INDEXES = [
  /* ── report_card_snapshots ──────────────────────────────────
     Primary query pattern: find current snapshots by class/term
     Secondary:            find by student + term
     Also:                 filter superseded, sort by publishedAt */
  {
    col: 'report_card_snapshots',
    indexes: [
      { key: { schoolId: 1, classId: 1, termId: 1, superseded: 1 },   name: 'snap_class_term_superseded' },
      { key: { schoolId: 1, studentId: 1, termId: 1, academicYearId: 1 }, name: 'snap_student_term' },
      { key: { id: 1 },                                                name: 'snap_id',       unique: true, sparse: true },
      { key: { batchId: 1 },                                           name: 'snap_batch' },
      { key: { schoolId: 1, publishedAt: -1 },                         name: 'snap_school_published' },
      { key: { schoolId: 1, classId: 1, studentId: 1, version: -1 },   name: 'snap_version_chain' },
    ],
  },

  /* ── publish_batches ────────────────────────────────────────
     Primary: list batches for a school/class
     Secondary: find stuck 'running' batches for recovery */
  {
    col: 'publish_batches',
    indexes: [
      { key: { schoolId: 1, classId: 1, startedAt: -1 },  name: 'batch_school_class' },
      { key: { schoolId: 1, status: 1, startedAt: -1 },   name: 'batch_status' },
      { key: { id: 1 },                                   name: 'batch_id',  unique: true, sparse: true },
    ],
  },

  /* ── mark_audit_log ─────────────────────────────────────────
     Primary: per-student audit trail
     Secondary: per-exam, per-editor */
  {
    col: 'mark_audit_log',
    indexes: [
      { key: { schoolId: 1, studentId: 1, timestamp: -1 },  name: 'audit_student' },
      { key: { schoolId: 1, examId: 1, timestamp: -1 },     name: 'audit_exam' },
      { key: { schoolId: 1, editedBy: 1, timestamp: -1 },   name: 'audit_editor' },
      { key: { gradeId: 1, timestamp: -1 },                  name: 'audit_grade', sparse: true },
    ],
  },

  /* ── exams ──────────────────────────────────────────────────
     Primary: list exams for a class/term
     Secondary: status-based filtering (e.g. moderation guard) */
  {
    col: 'exams',
    indexes: [
      { key: { schoolId: 1, classId: 1, termId: 1, status: 1 },  name: 'exams_class_term_status' },
      { key: { schoolId: 1, subjectId: 1, termId: 1 },            name: 'exams_subject_term' },
      { key: { id: 1 },                                            name: 'exams_id',  unique: true, sparse: true },
      { key: { schoolId: 1, date: -1 },                            name: 'exams_date' },
    ],
  },

  /* ── exam_results ───────────────────────────────────────────
     Primary: fetch results for one exam
     Secondary: all results for one student (cross-exam view) */
  {
    col: 'exam_results',
    indexes: [
      { key: { schoolId: 1, examId: 1, studentId: 1 },  name: 'results_exam_student',  unique: true, sparse: true },
      { key: { schoolId: 1, studentId: 1 },              name: 'results_student' },
      { key: { examId: 1, markState: 1 },                name: 'results_exam_state' },
      { key: { id: 1 },                                  name: 'results_id',  unique: true, sparse: true },
    ],
  },

  /* ── grades ─────────────────────────────────────────────────
     Primary: aggregate for class/term report generation
     Secondary: single student report */
  {
    col: 'grades',
    indexes: [
      { key: { schoolId: 1, classId: 1, termId: 1, isPublished: 1 },  name: 'grades_class_term' },
      { key: { schoolId: 1, studentId: 1, subjectId: 1, termId: 1 },   name: 'grades_student_subject' },
      { key: { id: 1 },                                                 name: 'grades_id',  unique: true, sparse: true },
    ],
  },

  /* ── students ───────────────────────────────────────────────
     Primary: list students in a class (used by publish, ranking)
     Secondary: admission number lookup */
  {
    col: 'students',
    indexes: [
      { key: { schoolId: 1, classId: 1 },              name: 'students_class' },
      { key: { schoolId: 1, admissionNumber: 1 },       name: 'students_admission', sparse: true },
      { key: { id: 1 },                                 name: 'students_id',  unique: true, sparse: true },
    ],
  },

  /* ── users ──────────────────────────────────────────────────
     CRITICAL: login path queries by schoolId + email on every login.
     Also: id lookup used by JWT verification path. */
  {
    col: 'users',
    indexes: [
      { key: { schoolId: 1, email: 1 }, name: 'users_school_email', unique: true, sparse: true },
      { key: { id: 1 },                 name: 'users_id',           unique: true, sparse: true },
    ],
  },

  /* ── teachers ───────────────────────────────────────────────
     Primary: list teachers by school (common query on timetable, marks) */
  {
    col: 'teachers',
    indexes: [
      { key: { schoolId: 1, status: 1 }, name: 'teachers_school_status' },
      { key: { id: 1 },                  name: 'teachers_id', unique: true, sparse: true },
    ],
  },

  /* ── messages / notifications ───────────────────────────────
     Primary: inbox query by schoolId + recipientId */
  {
    col: 'messages',
    indexes: [
      { key: { schoolId: 1, recipientId: 1, createdAt: -1 }, name: 'messages_inbox' },
      { key: { schoolId: 1, senderId: 1, createdAt: -1 },    name: 'messages_sent' },
      { key: { id: 1 },                                       name: 'messages_id', unique: true, sparse: true },
    ],
  },

  /* ── behaviour_incidents ────────────────────────────────────
     Primary: list incidents per student */
  {
    col: 'behaviour_incidents',
    indexes: [
      { key: { schoolId: 1, studentId: 1, date: -1 }, name: 'beh_student_date' },
      { key: { schoolId: 1, status: 1 },               name: 'beh_status' },
      { key: { id: 1 },                                 name: 'beh_id', unique: true, sparse: true },
    ],
  },

  /* ── admissions ─────────────────────────────────────────────
     Primary: filter by stage in the pipeline */
  {
    col: 'admissions',
    indexes: [
      { key: { schoolId: 1, stage: 1, createdAt: -1 }, name: 'adm_stage_date' },
      { key: { id: 1 },                                 name: 'adm_id', unique: true, sparse: true },
    ],
  },

  /* ── timetable ──────────────────────────────────────────────
     Primary: class timetable view + conflict detection
     Note: field is 'day' (lowercase string), NOT 'dayOfWeek' */
  {
    col: 'timetable',
    indexes: [
      { key: { schoolId: 1, classId: 1, day: 1, period: 1 },        name: 'tt_class_day_period' },
      { key: { schoolId: 1, teacherId: 1, day: 1, startTime: 1 },   name: 'tt_teacher_day_time' },
      { key: { schoolId: 1, room: 1, day: 1, startTime: 1 },        name: 'tt_room_day_time' },
      { key: { schoolId: 1, section: 1 },                            name: 'tt_school_section', sparse: true },
      { key: { id: 1 },                                              name: 'tt_id', unique: true, sparse: true },
    ],
  },

  /* ── bell_schedules ─────────────────────────────────────────
     One document per (school, section).
     section: 'all' | 'kg' | 'primary' | 'secondary' | 'alevel'
     Primary: fetch by schoolId + section for the grid.
     Unique constraint: one schedule per school per section. */
  {
    col: 'bell_schedules',
    indexes: [
      { key: { schoolId: 1, section: 1 }, name: 'bs_school_section', unique: true, sparse: true },
      { key: { id: 1 },                   name: 'bs_id', unique: true, sparse: true },
    ],
  },

  /* ── invoices ───────────────────────────────────────────────
     Primary: student balance query, status filter */
  {
    col: 'invoices',
    indexes: [
      { key: { schoolId: 1, studentId: 1, status: 1 }, name: 'inv_student_status' },
      { key: { schoolId: 1, status: 1, dueDate: 1 },   name: 'inv_status_due' },
      { key: { id: 1 },                                 name: 'inv_id', unique: true, sparse: true },
    ],
  },

  /* ── payments ───────────────────────────────────────────────
     Primary: sum payments for an invoice */
  {
    col: 'payments',
    indexes: [
      { key: { schoolId: 1, invoiceId: 1 }, name: 'pay_invoice' },
      { key: { id: 1 },                      name: 'pay_id', unique: true, sparse: true },
    ],
  },

  /* ── academic_config ────────────────────────────────────────
     One document per school — already indexed by schoolId via _model() base schema.
     Extra: id field */
  {
    col: 'academic_config',
    indexes: [
      { key: { schoolId: 1 }, name: 'aconfig_school', unique: true, sparse: true },
    ],
  },

  /* ── attendance ─────────────────────────────────────────────
     Primary: count present/absent for report card attendance summary */
  {
    col: 'attendance',
    indexes: [
      { key: { schoolId: 1, studentId: 1, termId: 1, status: 1 },  name: 'att_student_term_status' },
      { key: { schoolId: 1, classId: 1, date: 1 },                  name: 'att_class_date' },
    ],
  },
];

/**
 * Create all defined indexes.
 * Safe to call on every startup — MongoDB ignores already-existing indexes.
 * Logs each collection's result and any errors (non-fatal).
 */
async function ensureIndexes() {
  const results = { created: 0, skipped: 0, errors: [] };

  for (const { col, indexes } of INDEXES) {
    try {
      const model = _model(col);
      for (const { key, name, unique = false, sparse = false } of indexes) {
        try {
          await model.collection.createIndex(key, {
            name,
            unique,
            sparse,
            background: true,
          });
          results.created++;
        } catch (err) {
          // Code 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — already exists with different options
          // Code 11000 = duplicate key — not relevant here
          if (err.code === 85 || err.code === 86) {
            results.skipped++;  // index exists — no action needed
          } else {
            results.errors.push({ col, name, message: err.message });
          }
        }
      }
    } catch (err) {
      results.errors.push({ col, name: '_model', message: err.message });
    }
  }

  if (results.errors.length) {
    console.warn(`[DB] Index creation: ${results.created} created, ${results.skipped} skipped, ${results.errors.length} error(s):`);
    results.errors.forEach(e => console.warn(`  ✗ ${e.col}.${e.name}: ${e.message}`));
  } else {
    console.log(`[DB] Indexes: ${results.created} created / confirmed, ${results.skipped} skipped.`);
  }

  return results;
}

module.exports = { ensureIndexes };
