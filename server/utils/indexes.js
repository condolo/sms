/* ============================================================
   Msingi — Database Index Definitions
   Called once at server startup after DB connection.
   Uses MongoDB driver directly (collection.createIndex) so
   indexes are created regardless of Mongoose schema definition.

   All indexes are created with { background: true } so they
   don't block the server during initial creation on a live DB.

   Safe to call multiple times — MongoDB is idempotent on
   createIndex for existing indexes.
   ============================================================ */
const { _model } = require('./model');
const { isConnected } = require('../config/db');

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
      { key: { reportId: 1 },                                           name: 'snap_report_id',    unique: true, sparse: true },
    ],
  },
  /* ── report_card_counters ───────────────────────────────────
     One doc per school/year/term combo; seq incremented atomically */
  {
    col: 'report_card_counters',
    indexes: [
      { key: { key: 1 }, name: 'rcc_key', unique: true },
    ],
  },

  /* ── audit_logs ─────────────────────────────────────────────
     Append-only. Primary query: school + date desc.
     Secondary: filter by action, actor, severity, correlationId
     (C5/MR-002: traces every entry one HTTP request produced), orgId. */
  {
    col: 'audit_logs',
    indexes: [
      { key: { schoolId: 1, createdAt: -1 }, name: 'al_school_date' },
      { key: { action: 1,   createdAt: -1 }, name: 'al_action_date' },
      { key: { 'actor.userId': 1 },          name: 'al_actor' },
      { key: { severity: 1,  createdAt: -1 }, name: 'al_severity_date' },
      { key: { createdAt: -1 },               name: 'al_date_desc' },
      { key: { correlationId: 1 },            name: 'al_correlation' },
      { key: { orgId: 1, createdAt: -1 },     name: 'al_org_date' },
    ],
  },

  /* ── release_certificates ───────────────────────────────────
     Append-only audit trail of every release certification.
     certId is globally unique; version indexed for trend queries. */
  {
    col: 'release_certificates',
    indexes: [
      { key: { certId: 1 },      name: 'rc_cert_id',  unique: true },
      { key: { version: 1 },     name: 'rc_version' },
      { key: { _createdAt: -1 }, name: 'rc_created_desc' },
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
     Also: id lookup used by JWT verification path.

     NOTE: email/username uniqueness uses PARTIAL indexes, not sparse.
     A sparse COMPOUND index still indexes any doc that has schoolId,
     so { email: null } docs collide — only one email-less user per
     school could exist (student accounts have no email, parent
     accounts have no username). Partial indexes enforce uniqueness
     only when the field is an actual string. */
  {
    col: 'users',
    indexes: [
      { key: { schoolId: 1, email: 1 },    name: 'users_school_email_str',    unique: true, partialFilterExpression: { email: { $type: 'string' } } },
      { key: { schoolId: 1, username: 1 }, name: 'users_school_username_str', unique: true, partialFilterExpression: { username: { $type: 'string' } } },
      { key: { studentId: 1 },             name: 'users_student_id',      sparse: true },
      { key: { id: 1 },                    name: 'users_id',              unique: true, sparse: true },
      { key: { identityId: 1, schoolId: 1 }, name: 'users_identity_school', sparse: true },
    ],
  },

  /* ── teachers ───────────────────────────────────────────────
     Primary: list teachers by school (common query on timetable, marks)
     Email: unique per school — mirrors users collection constraint */
  {
    col: 'teachers',
    indexes: [
      { key: { schoolId: 1, status: 1 },  name: 'teachers_school_status' },
      { key: { schoolId: 1, email: 1 },   name: 'teachers_school_email_str', unique: true, partialFilterExpression: { email: { $type: 'string' } } },
      { key: { id: 1 },                   name: 'teachers_id', unique: true, sparse: true },
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

  /* ── bell_schedule ──────────────────────────────────────────
     One document per (school, section).
     section: 'all' | 'kg' | 'primary' | 'secondary' | 'alevel'
     Primary: fetch by schoolId + section for the grid.
     Unique constraint: one schedule per school per section. */
  {
    col: 'bell_schedule',
    indexes: [
      { key: { schoolId: 1, section: 1 }, name: 'bsched_school_section', unique: true, sparse: true },
      { key: { id: 1 },                   name: 'bsched_id', unique: true, sparse: true },
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

  /* ── departments ────────────────────────────────────────────
     Primary: list departments for a school */
  {
    col: 'departments',
    indexes: [
      { key: { schoolId: 1, order: 1, name: 1 }, name: 'dept_school_order' },
      { key: { schoolId: 1, code: 1 },            name: 'dept_school_code', unique: true, sparse: true },
      { key: { id: 1 },                            name: 'dept_id', unique: true, sparse: true },
    ],
  },

  /* ── subjects ────────────────────────────────────────────────
     Primary: list subjects per department; secondary: by section */
  {
    col: 'subjects',
    indexes: [
      { key: { schoolId: 1, departmentId: 1, order: 1 }, name: 'sub_dept_order' },
      { key: { schoolId: 1, code: 1 },                   name: 'sub_school_code', unique: true, sparse: true },
      { key: { schoolId: 1, sections: 1 },               name: 'sub_school_sections' },
      { key: { id: 1 },                                  name: 'sub_id', unique: true, sparse: true },
    ],
  },

  /* ── student_subjects ──────────────────────────────────────
     Primary: list students in a subject (enrollment slide-over)
     Secondary: list subjects per student (timetable / grade filter)
     Unique: prevent duplicate enrollments */
  {
    col: 'student_subjects',
    indexes: [
      { key: { schoolId: 1, subjectId: 1, studentId: 1 }, name: 'ss_sub_student', unique: true, sparse: true },
      { key: { schoolId: 1, studentId: 1 },               name: 'ss_student' },
      { key: { schoolId: 1, subjectId: 1 },               name: 'ss_subject' },
      { key: { id: 1 },                                   name: 'ss_id', unique: true, sparse: true },
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

  /* ── library_books ──────────────────────────────────────────
     Primary: catalogue list by school; text search on title/author/isbn */
  {
    col: 'library_books',
    indexes: [
      { key: { schoolId: 1, title: 1 },     name: 'lb_school_title' },
      { key: { schoolId: 1, category: 1 },  name: 'lb_school_category' },
      { key: { schoolId: 1, isbn: 1 },      name: 'lb_school_isbn', sparse: true },
      { key: { id: 1 },                     name: 'lb_id', unique: true, sparse: true },
    ],
  },

  /* ── library_loans ──────────────────────────────────────────
     Primary: active loans per borrower; secondary: all loans for a book */
  {
    col: 'library_loans',
    indexes: [
      { key: { schoolId: 1, borrowerId: 1, status: 1 },    name: 'll_borrower_status' },
      { key: { schoolId: 1, bookId: 1, status: 1 },         name: 'll_book_status' },
      { key: { schoolId: 1, status: 1, dueDate: 1 },        name: 'll_status_due' },
      { key: { id: 1 },                                     name: 'll_id', unique: true, sparse: true },
    ],
  },

  /* ── transport_routes ───────────────────────────────────────
     Primary: list routes for a school */
  {
    col: 'transport_routes',
    indexes: [
      { key: { schoolId: 1, name: 1 },  name: 'tr_school_name' },
      { key: { id: 1 },                 name: 'tr_id', unique: true, sparse: true },
    ],
  },

  /* ── transport_assignments ──────────────────────────────────
     Primary: assignments per route; secondary: per student */
  {
    col: 'transport_assignments',
    indexes: [
      { key: { schoolId: 1, routeId: 1, status: 1 },    name: 'ta_route_status' },
      { key: { schoolId: 1, studentId: 1, status: 1 },  name: 'ta_student_status' },
      { key: { id: 1 },                                  name: 'ta_id', unique: true, sparse: true },
    ],
  },

  /* ── hostels ────────────────────────────────────────────────
     Primary: list hostels for a school */
  {
    col: 'hostels',
    indexes: [
      { key: { schoolId: 1, name: 1 },    name: 'h_school_name' },
      { key: { schoolId: 1, gender: 1 },  name: 'h_school_gender' },
      { key: { id: 1 },                   name: 'h_id', unique: true, sparse: true },
    ],
  },

  /* ── hostel_rooms ───────────────────────────────────────────
     Primary: list rooms within a hostel; unique room number per hostel.
     IMPORTANT: this is 'hostel_rooms' — NOT 'rooms' (owned by timetable). */
  {
    col: 'hostel_rooms',
    indexes: [
      { key: { schoolId: 1, hostelId: 1, roomNumber: 1 },  name: 'hr_hostel_room', unique: true, sparse: true },
      { key: { schoolId: 1, hostelId: 1 },                 name: 'hr_hostel' },
      { key: { id: 1 },                                    name: 'hr_id', unique: true, sparse: true },
    ],
  },

  /* ── hostel_assignments ─────────────────────────────────────
     Primary: active assignments per room; secondary: per student */
  {
    col: 'hostel_assignments',
    indexes: [
      { key: { schoolId: 1, roomId: 1, status: 1 },     name: 'ha_room_status' },
      { key: { schoolId: 1, studentId: 1, status: 1 },  name: 'ha_student_status' },
      { key: { schoolId: 1, hostelId: 1, status: 1 },   name: 'ha_hostel_status' },
      { key: { id: 1 },                                  name: 'ha_id', unique: true, sparse: true },
    ],
  },

  /* ── syllabus_topics ─────────────────────────────────────────
     Shared curriculum per subject per school per academic year.
     Primary: list topics for a subject/year.
     Note: topics are shared — all teachers of a subject see the same list. */
  {
    col: 'syllabus_topics',
    indexes: [
      { key: { schoolId: 1, subjectId: 1, academicYear: 1, order: 1 },  name: 'st_school_sub_year_order' },
      { key: { id: 1 },                                                  name: 'st_id', unique: true, sparse: true },
    ],
  },

  /* ── lesson_coverage ─────────────────────────────────────────
     Per-teacher per-class coverage records.
     Primary: coverage for a class-subject pair.
     Unique: prevent duplicate coverage for same class+subject+topic+subtopic.
     Note: co-teachers sharing a class see the same coverage pool. */
  /* ── mpesa_transactions ─────────────────────────────────────
     Primary: STK callback lookup by Safaricom's checkoutRequestId.
     Secondary: school + status + date for transaction listing. */
  {
    col: 'mpesa_transactions',
    indexes: [
      { key: { checkoutRequestId: 1 }, name: 'mpesa_checkout_id',    unique: true, sparse: true },
      { key: { schoolId: 1, status: 1, createdAt: -1 }, name: 'mpesa_school_status' },
      { key: { schoolId: 1, invoiceId: 1 },             name: 'mpesa_invoice' },
      { key: { id: 1 },                                  name: 'mpesa_id', unique: true, sparse: true },
    ],
  },

  /* ── billing_snapshots ───────────────────────────────────────
     Platform subscription invoices (one per school per term).
     Primary lookup: school + year + term (unique per billing period). */
  {
    col: 'billing_snapshots',
    indexes: [
      { key: { schoolId: 1, academicYear: 1, term: 1 }, name: 'bs_school_year_term', unique: true },
      { key: { schoolId: 1, status: 1 },                name: 'bs_school_status' },
      { key: { status: 1, generatedAt: -1 },             name: 'bs_status_date' },
      { key: { id: 1 },                                  name: 'bs_id', unique: true },
    ],
  },

  {
    col: 'lesson_coverage',
    indexes: [
      { key: { schoolId: 1, classId: 1, subjectId: 1, academicYear: 1, topicId: 1, subtopicId: 1 }, name: 'lc_class_sub_year_topic', sparse: true },
      { key: { schoolId: 1, teacherId: 1, academicYear: 1 },           name: 'lc_teacher_year' },
      { key: { schoolId: 1, classId: 1, subjectId: 1, academicYear: 1 }, name: 'lc_class_sub_year' },
      { key: { id: 1 },                                                 name: 'lc_id', unique: true, sparse: true },
    ],
  },

  /* ── assessment_marks ───────────────────────────────────────
     High-volume CA marks collection (replaces legacy grades for new CA system).
     Primary: mark entry grid loads by class+subject+term simultaneously.
     Secondary: report card aggregation per student.
     Tertiary: lock guard $or query uses isLocked. */
  {
    col: 'assessment_marks',
    indexes: [
      { key: { schoolId: 1, classId: 1, subjectId: 1, termNumber: 1 }, name: 'am_class_sub_term' },
      { key: { schoolId: 1, studentId: 1, termNumber: 1 },             name: 'am_student_term' },
      { key: { schoolId: 1, academicYearId: 1, isPublished: 1 },       name: 'am_year_published' },
      { key: { schoolId: 1, isLocked: 1 },                             name: 'am_locked', sparse: true },
      { key: { id: 1 },                                                 name: 'am_id', unique: true, sparse: true },
    ],
  },

  /* ── assessment_config ──────────────────────────────────────
     One config doc per school (academicYearId: null = global config).
     Queried by { schoolId, academicYearId } on every mark operation. */
  {
    col: 'assessment_config',
    indexes: [
      { key: { schoolId: 1, academicYearId: 1 }, name: 'acfg_school_year', unique: true, sparse: true },
      { key: { id: 1 },                          name: 'acfg_id', unique: true, sparse: true },
    ],
  },

  /* ── grade_boundaries ───────────────────────────────────────
     Grading scale docs. Primary lookup: default scale for school.
     Secondary: list all scales for school (admin config page). */
  {
    col: 'grade_boundaries',
    indexes: [
      { key: { schoolId: 1, isDefault: 1 }, name: 'gb_school_default', sparse: true },
      { key: { schoolId: 1 },               name: 'gb_school' },
      { key: { id: 1 },                     name: 'gb_id', unique: true, sparse: true },
    ],
  },

  /* ── mark_submissions ───────────────────────────────────────
     Approval workflow. Unique composite = one submission per
     class/subject/term/type/instance combination.
     List view filtered by status for admin review queue. */
  {
    col: 'mark_submissions',
    indexes: [
      { key: { schoolId: 1, classId: 1, subjectId: 1, termNumber: 1, assessmentType: 1, instance: 1 }, name: 'mksub_composite', unique: true, sparse: true },
      { key: { schoolId: 1, status: 1, createdAt: -1 }, name: 'mksub_status_date' },
      { key: { id: 1 },                                  name: 'mksub_id', unique: true, sparse: true },
    ],
  },

  /* ── exam_series ────────────────────────────────────────────
     Named groupings of formal exams. Filtered by status and term. */
  {
    col: 'exam_series',
    indexes: [
      { key: { schoolId: 1, status: 1 },  name: 'exs_school_status' },
      { key: { schoolId: 1, termId: 1 },  name: 'exs_school_term', sparse: true },
      { key: { id: 1 },                   name: 'exs_id', unique: true, sparse: true },
    ],
  },

  /* ── comment_banks ──────────────────────────────────────────
     Pre-written remark templates. Filtered by category and subject. */
  {
    col: 'comment_banks',
    indexes: [
      { key: { schoolId: 1, category: 1 },  name: 'cb_school_category' },
      { key: { schoolId: 1, subjectId: 1 }, name: 'cb_school_subject', sparse: true },
      { key: { id: 1 },                     name: 'cb_id', unique: true, sparse: true },
    ],
  },

  /* ── growth_* ───────────────────────────────────────────────
     All growth portfolio collections share the same access pattern:
     list/count by schoolId + studentId, used by the profile summary
     and individual record pages. */
  {
    col: 'growth_projects',
    indexes: [
      { key: { schoolId: 1, studentId: 1, createdAt: -1 }, name: 'gp_student_date' },
      { key: { id: 1 },                                    name: 'gp_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'growth_leadership',
    indexes: [
      { key: { schoolId: 1, studentId: 1, createdAt: -1 }, name: 'gl_student_date' },
      { key: { id: 1 },                                    name: 'gl_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'growth_activities',
    indexes: [
      { key: { schoolId: 1, studentId: 1, createdAt: -1 }, name: 'ga_student_date' },
      { key: { id: 1 },                                    name: 'ga_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'growth_service',
    indexes: [
      { key: { schoolId: 1, studentId: 1, createdAt: -1 }, name: 'gs_student_date' },
      { key: { id: 1 },                                    name: 'gs_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'growth_awards',
    indexes: [
      { key: { schoolId: 1, studentId: 1, createdAt: -1 }, name: 'gaw_student_date' },
      { key: { id: 1 },                                    name: 'gaw_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'growth_recommendations',
    indexes: [
      { key: { schoolId: 1, studentId: 1, createdAt: -1 }, name: 'gr_student_date' },
      { key: { id: 1 },                                    name: 'gr_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'growth_aspirations',
    indexes: [
      // One aspirations doc per student; profile summary does a findOne by schoolId+studentId
      { key: { schoolId: 1, studentId: 1 }, name: 'gasp_student', unique: true, sparse: true },
      { key: { id: 1 },                     name: 'gasp_id', unique: true, sparse: true },
    ],
  },

  /* ── elearning_* ────────────────────────────────────────────
     elearning_tokens: looked up by userId (no schoolId in _getToken helper).
     elearning_course_links: unique per school+gcCourseId (Google Classroom course).
     elearning_coursework_links: callback uses gcCourseId+gcCourseWorkId (no schoolId).
     elearning_sessions: listed by school+date; Zoom webhook lookup by zoomMeetingId. */
  {
    col: 'elearning_tokens',
    indexes: [
      { key: { userId: 1 },   name: 'elt_user',   unique: true, sparse: true },
      { key: { schoolId: 1 }, name: 'elt_school' },
    ],
  },
  {
    col: 'elearning_course_links',
    indexes: [
      { key: { schoolId: 1, gcCourseId: 1 }, name: 'elcl_school_course', unique: true, sparse: true },
      { key: { id: 1 },                      name: 'elcl_id', unique: true, sparse: true },
    ],
  },
  {
    col: 'elearning_coursework_links',
    indexes: [
      // Webhook callback has only gcCourseId + gcCourseWorkId — no schoolId available at that point
      { key: { gcCourseId: 1, gcCourseWorkId: 1 }, name: 'elcwl_course_work', unique: true, sparse: true },
      { key: { schoolId: 1 },                       name: 'elcwl_school' },
    ],
  },
  {
    col: 'elearning_sessions',
    indexes: [
      { key: { schoolId: 1, scheduledAt: -1 }, name: 'els_school_date' },
      { key: { schoolId: 1, teacherId: 1 },    name: 'els_teacher' },
      { key: { zoomMeetingId: 1 },             name: 'els_zoom', sparse: true },
      { key: { id: 1 },                        name: 'els_id', unique: true, sparse: true },
    ],
  },

  /* ── queue_jobs (C11 Phase 1 / ADR-0006) ────────────────────
     Platform-level (no schoolId — not every job is school-scoped, e.g.
     platform-operator security alerts). Primary query: the worker's
     due-job claim (status + nextAttemptAt). */
  {
    col: 'queue_jobs',
    indexes: [
      { key: { status: 1, nextAttemptAt: 1 }, name: 'qj_status_next' },
      { key: { type: 1, createdAt: -1 },      name: 'qj_type_created' },
      { key: { id: 1 },                       name: 'qj_id', unique: true, sparse: true },
    ],
  },

  /* ── organizations (Phase A · C1) ───────────────────────────
     Platform/org-level (no schoolId). One org per customer; 1:1 with a
     school today, one-to-many once multi-school activates.
     provisionedFromSchoolId is the 1:1 provenance key used by the
     provisioning migration for interruption-safe upserts. */
  {
    col: 'organizations',
    indexes: [
      { key: { id: 1 },                      name: 'org_id',               unique: true, sparse: true },
      { key: { slug: 1 },                    name: 'org_slug',             unique: true, sparse: true },
      { key: { provisionedFromSchoolId: 1 }, name: 'org_provisioned_from', unique: true, sparse: true },
    ],
  },

  /* ── schools (Phase A · C2, slug uniqueness added for the org-shared-
     slug feature) ─────────────────────────────────────────────
     schools was previously unindexed here (relied on _id). The
     organizationId FK is sparse, since it is null until a school is
     provisioned — non-unique, one org may own many schools. `slug` is
     newly indexed here too: platform.js's POST /schools always checked
     uniqueness via a `findOne` before insert, but with no DB-level
     constraint backing it, two concurrent requests could both pass that
     check before either insert lands (TOCTOU). This closes that race —
     app-level checks in platform.js remain the primary UX (they return a
     clean 409 with a message; a raw duplicate-key error is the backstop,
     not the normal path). Sparse because system/seed schools may
     legitimately lack a slug. */
  {
    col: 'schools',
    indexes: [
      { key: { organizationId: 1 }, name: 'schools_org', sparse: true },
      { key: { slug: 1 },           name: 'schools_slug', unique: true, sparse: true },
    ],
  },

  /* ── memberships (Phase 1 · C7) ─────────────────────────────
     Platform/org-level shadow collection — records who has access to
     which school(s). NON-AUTHORITATIVE: auth.js/rbac.js/scopeMiddleware
     still read role straight off the JWT; nothing reads this collection
     yet. {userId,schoolId} is the real-world invariant and the
     idempotency key used by provision-memberships.js's upsert. */
  {
    col: 'memberships',
    indexes: [
      { key: { id: 1 },                  name: 'mem_id',          unique: true, sparse: true },
      { key: { userId: 1, schoolId: 1 }, name: 'mem_user_school', unique: true },
      { key: { schoolId: 1 },            name: 'mem_school' },
      { key: { orgId: 1 },               name: 'mem_org', sparse: true },
      { key: { userId: 1 },              name: 'mem_user' },
    ],
  },

  /* ── entitlements (C3) ───────────────────────────────────────
     Platform-level registry of per-school capability grants, independent
     of plan tier (PLATFORM_ARCHITECTURE_EVOLUTION_v1.md §8: "plans and
     features must never be coupled"). Consulted by plan.js's
     planGate() as an additive override (ADR-0004, C10) — only checked
     when plan tier alone would deny a feature. {schoolId,key} is the
     idempotency key: granting an already-revoked key re-activates the
     same doc rather than duplicating it, preserving the audit trail. */
  {
    col: 'entitlements',
    indexes: [
      { key: { id: 1 },               name: 'ent_id',          unique: true, sparse: true },
      { key: { schoolId: 1, key: 1 }, name: 'ent_school_key',  unique: true },
      { key: { schoolId: 1 },         name: 'ent_school' },
    ],
  },

  /* ── identities (C8/MR-001 Phase 0 · shadow) ──────────────────
     Platform/org-level. Owns credentials only (passwordHash, MFA) per
     ADR-0003 — NOT YET CONSULTED by auth.js; `users.password` remains
     the sole credential source until the Dual-write/Cutover phases.
     `users` is NOT restructured — this collection is purely additive,
     linked via a new `users.identityId` FK (added at the application
     layer). Originally looked up FROM a resolved identity only — the
     reverse-direction query (given an identityId, which schools can it
     log into) is now real, backing school-switching and org-first login
     (`users_identity_school`, users block above).
     {orgId,email} partial-unique (not sparse — a collision_pending
     identity has email:null, which the partial filter, not sparse,
     correctly excludes from the uniqueness constraint, mirroring the
     existing users_school_email_str idiom at the top of this file). */
  {
    col: 'identities',
    indexes: [
      { key: { id: 1 },              name: 'idt_id',            unique: true, sparse: true },
      { key: { orgId: 1, email: 1 }, name: 'idt_org_email',     unique: true, partialFilterExpression: { email: { $type: 'string' } } },
      { key: { collisionKey: 1 },    name: 'idt_collision_key', unique: true, partialFilterExpression: { status: 'collision_pending' } },
      { key: { orgId: 1 },           name: 'idt_org' },
    ],
  },

  /* ── workflow_configs (Governance Spec §0) ─────────────────────
     School-authored, school-scoped approval chains — e.g. leave
     approval, marks-unlock. Same tenant-isolation posture as
     role_permissions. One doc per {schoolId, workflowKey}; steps[]
     store only stable references (roleKey/users.id), never a copied
     display name — see GOVERNANCE_WORKFLOW_SPECIFICATION_v1.md §0. */
  {
    col: 'workflow_configs',
    indexes: [
      { key: { id: 1 },                    name: 'wfc_id',              unique: true, sparse: true },
      { key: { schoolId: 1, workflowKey: 1 }, name: 'wfc_school_key',   unique: true },
    ],
  },

  /* ── behaviour_points_resets (Governance Spec §2) ──────────────
     One doc per manual reset. Never touches behaviour_incidents —
     /incidents/summary's live aggregation reads the most recent
     reset's date as the floor for the current running total. */
  {
    col: 'behaviour_points_resets',
    indexes: [
      { key: { id: 1 },                  name: 'bpr_id',          unique: true, sparse: true },
      { key: { schoolId: 1, resetAt: -1 }, name: 'bpr_school_date' },
    ],
  },

  /* ── resources / resource_groups (Governance Spec §5) ──────────
     Shared-links repository, multi-dimensional visibility. */
  {
    col: 'resources',
    indexes: [
      { key: { id: 1 },                 name: 'res_id',       unique: true, sparse: true },
      { key: { schoolId: 1, createdAt: -1 }, name: 'res_school_date' },
      { key: { schoolId: 1, category: 1 }, name: 'res_school_category' },
    ],
  },
  {
    col: 'resource_groups',
    indexes: [
      { key: { id: 1 },       name: 'resgrp_id',     unique: true, sparse: true },
      { key: { schoolId: 1 }, name: 'resgrp_school' },
      { key: { schoolId: 1, memberUserIds: 1 }, name: 'resgrp_school_member' },
    ],
  },
];

/* ── One-time index migrations ──────────────────────────────────
   Old indexes that must be DROPPED before their replacements can be
   created. MongoDB rejects createIndex when an index with the same
   key pattern exists with different options (error 85), so simply
   redefining an index above is not enough — the stale one wins.

   users_school_email / users_school_username / teachers_school_email:
   were unique+sparse compound indexes. Sparse compound indexes still
   index docs that have ANY of the keys, so every user (all have
   schoolId) was indexed — meaning only one email-less user could
   exist per school. Student portal accounts (no email) and parent
   accounts (no username) hit E11000 from the second one onward.
   Replaced by partial indexes that only apply to string values.     */
const DROP_INDEXES = [
  { col: 'users',    name: 'users_school_email' },
  { col: 'users',    name: 'users_school_username' },
  { col: 'teachers', name: 'teachers_school_email' },
];

/**
 * Create all defined indexes.
 * Safe to call on every startup — MongoDB ignores already-existing indexes.
 * Logs each collection's result and any errors (non-fatal).
 */
async function ensureIndexes() {
  const results = { created: 0, skipped: 0, errors: [] };

  if (!isConnected()) {
    console.warn('[DB] Skipping index creation — no MongoDB connection (MONGODB_URI not set).');
    return results;
  }

  // Drop superseded indexes first — ignore "index not found" (already migrated)
  for (const { col, name } of DROP_INDEXES) {
    try {
      await _model(col).collection.dropIndex(name);
      console.log(`[DB] Dropped superseded index ${col}.${name}`);
    } catch (err) {
      // 27 = IndexNotFound — already dropped on a previous startup; anything else is logged
      if (err.code !== 27 && !/index not found/i.test(err.message || '')) {
        results.errors.push({ col, name: `drop:${name}`, message: err.message });
      }
    }
  }

  for (const { col, indexes } of INDEXES) {
    try {
      const model = _model(col);
      for (const { key, name, unique = false, sparse = false, partialFilterExpression } of indexes) {
        try {
          const opts = { name, unique, background: true };
          // sparse and partialFilterExpression are mutually exclusive in MongoDB
          if (partialFilterExpression) opts.partialFilterExpression = partialFilterExpression;
          else if (sparse)             opts.sparse = true;

          await model.collection.createIndex(key, opts);
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
