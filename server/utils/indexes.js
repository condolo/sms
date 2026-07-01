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
     Secondary: filter by action, actor, severity. */
  {
    col: 'audit_logs',
    indexes: [
      { key: { schoolId: 1, createdAt: -1 }, name: 'al_school_date' },
      { key: { action: 1,   createdAt: -1 }, name: 'al_action_date' },
      { key: { 'actor.userId': 1 },          name: 'al_actor' },
      { key: { severity: 1,  createdAt: -1 }, name: 'al_severity_date' },
      { key: { createdAt: -1 },               name: 'al_date_desc' },
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
     Also: id lookup used by JWT verification path. */
  {
    col: 'users',
    indexes: [
      { key: { schoolId: 1, email: 1 },    name: 'users_school_email',    unique: true, sparse: true },
      { key: { schoolId: 1, username: 1 }, name: 'users_school_username', unique: true, sparse: true },
      { key: { studentId: 1 },             name: 'users_student_id',      sparse: true },
      { key: { id: 1 },                    name: 'users_id',              unique: true, sparse: true },
    ],
  },

  /* ── teachers ───────────────────────────────────────────────
     Primary: list teachers by school (common query on timetable, marks)
     Email: unique per school — mirrors users collection constraint */
  {
    col: 'teachers',
    indexes: [
      { key: { schoolId: 1, status: 1 },  name: 'teachers_school_status' },
      { key: { schoolId: 1, email: 1 },   name: 'teachers_school_email', unique: true, sparse: true },
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
