/* ============================================================
   SchoolSync — Central Validators
   Loaded after data.js (needs DB, ENUMS, SchoolContext).
   Loaded before all feature modules.

   Convention:
     Every Validators.xxx() function returns:
       null           — data is valid, proceed with DB write
       string         — human-readable error; show to user, abort write

   Usage in modules:
     const err = Validators.student(data, existingId);
     if (err) return showToast(err, 'warning');
     DB.update('students', existingId, data);
   ============================================================ */

const Validators = (() => {

  /* ── Internal helpers ──────────────────────────────────── */

  function _require(value, label) {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return `${label} is required.`;
    }
    return null;
  }

  function _enum(value, set, label) {
    if (!set.includes(value)) {
      return `${label} must be one of: ${set.join(', ')}. Got: "${value}".`;
    }
    return null;
  }

  function _fk(collection, id, label) {
    if (!id) return null; // optional FK — caller must _require() if mandatory
    if (!DB.getById(collection, id)) {
      return `${label} "${id}" does not exist in ${collection}.`;
    }
    return null;
  }

  function _unique(collection, field, value, excludeId, label) {
    if (!value) return null;
    const dupe = DB.query(collection, r => r[field] === value && r.id !== excludeId);
    if (dupe.length > 0) {
      return `${label} "${value}" is already in use.`;
    }
    return null;
  }

  /* Run an array of check functions; return the first error or null. */
  function _first(...checks) {
    for (const c of checks) {
      const err = c();
      if (err) return err;
    }
    return null;
  }

  /* ── Entity Validators ─────────────────────────────────── */

  /**
   * Validate a student data object.
   * @param {object} data — the fields being written
   * @param {string} [id] — existing student ID (for updates, to allow same admNo)
   */
  function student(data, id) {
    return _first(
      () => _require(data.firstName, 'First name'),
      () => _require(data.lastName,  'Last name'),
      () => _require(data.classId,   'Class'),
      () => _require(data.status,    'Status'),
      () => _enum(data.status, ENUMS.studentStatus, 'Status'),
      () => data.gender ? _enum(data.gender, ENUMS.gender, 'Gender') : null,
      // Referential integrity
      () => _fk('classes', data.classId, 'Class'),
      () => data.houseId ? _fk('behaviour_settings', null, null) : null, // house validated below
      // Unique admission number (system-set, but guard anyway)
      () => data.admissionNo
              ? _unique('students', 'admissionNo', data.admissionNo, id, 'Admission number')
              : null,
    );
  }

  /**
   * Validate a user (account) object.
   * @param {object} data
   * @param {string} [id] — existing user ID
   */
  function user(data, id) {
    return _first(
      () => _require(data.name,  'Full name'),
      () => _require(data.email, 'Email'),
      () => _require(data.role,  'Role'),
      () => _enum(data.role, ENUMS.userRole, 'Role'),
      // Unique email
      () => _unique('users', 'email', data.email, id, 'Email address'),
    );
  }

  /**
   * Validate a class object.
   * @param {object} data
   * @param {string} [id] — existing class ID (for updates)
   */
  function cls(data, id) {
    return _first(
      () => _require(data.name,      'Class name'),
      () => _require(data.sectionId, 'Section'),
      // Referential integrity
      () => _fk('sections', data.sectionId, 'Section'),
      () => data.homeroomTeacherId
              ? _fk('users', data.homeroomTeacherId, 'Homeroom teacher')
              : null,
      // Unique class name within the same section
      () => {
        const dupe = DB.query('classes', c =>
          c.name === data.name &&
          c.sectionId === data.sectionId &&
          c.id !== id
        );
        return dupe.length ? `A class named "${data.name}" already exists in this section.` : null;
      },
    );
  }

  /**
   * Validate a timetable slot before saving.
   * @param {object} slot        — { day, period, subjectId, teacherId, classId }
   * @param {string} ttId        — existing timetable record ID (to exclude from clash check)
   * @param {string} [editDay]   — for edit mode: the original day (to exclude self from clash)
   * @param {number} [editPeriod]— for edit mode: the original period
   */
  function timetableSlot(slot, ttId, editDay, editPeriod) {
    return _first(
      () => _require(String(slot.day),    'Day'),
      () => _require(String(slot.period), 'Period'),
      () => _require(slot.subjectId,      'Subject'),
      // Referential integrity
      () => _fk('subjects', slot.subjectId, 'Subject'),
      () => slot.teacherId ? _fk('users', slot.teacherId, 'Teacher') : null,
      // Teacher double-booking: same teacher, same day, same period, different timetable record
      () => {
        if (!slot.teacherId) return null;
        const isEditSelf = (editDay !== undefined && slot.day === editDay && slot.period === editPeriod);
        if (isEditSelf) return null; // editing the slot in place — no clash with itself
        const clash = DB.get('timetable').find(t =>
          t.id !== ttId &&
          (t.slots || []).some(s =>
            s.teacherId === slot.teacherId &&
            s.day       === slot.day &&
            s.period    === slot.period
          )
        );
        if (clash) {
          const clsName = DB.getById('classes', clash.classId)?.name || 'another class';
          return `Teacher is already assigned to ${clsName} at this time.`;
        }
        return null;
      },
      // Room conflict: same room booked at same day/period in any class
      () => {
        if (!slot.room || !slot.room.trim()) return null;
        const roomKey = slot.room.trim().toLowerCase();
        const isEditSelf = (editDay !== undefined && slot.day === editDay && slot.period === editPeriod);
        const clash = DB.get('timetable').find(t =>
          t.id !== ttId &&
          (t.slots || []).some(s =>
            s.room && s.room.trim().toLowerCase() === roomKey &&
            s.day    === slot.day &&
            s.period === slot.period &&
            !(isEditSelf && t.id === ttId)
          )
        );
        if (clash) {
          const clsName = DB.getById('classes', clash.classId)?.name || 'another class';
          return `Room "${slot.room}" is already booked by ${clsName} at this time.`;
        }
        return null;
      },
    );
  }

  /**
   * Validate a payment before recording.
   * @param {number} amount
   * @param {object} invoice — full invoice object
   */
  function payment(amount, invoice) {
    return _first(
      () => !invoice ? 'Invoice not found.' : null,
      () => (isNaN(amount) || amount <= 0) ? 'Payment amount must be a positive number.' : null,
      () => invoice && invoice.status === 'paid' ? 'This invoice is already fully paid.' : null,
    );
  }

  /**
   * Validate an incident before logging.
   * @param {object} data — { type, studentId, catId, points }
   */
  function incident(data) {
    return _first(
      () => _require(data.studentId, 'Student'),
      () => _require(data.type,      'Incident type'),
      () => _enum(data.type, ENUMS.incidentType, 'Incident type'),
      () => _fk('students', data.studentId, 'Student'),
    );
  }

  /* ── Orphan / referential delete guards ───────────────── */

  /**
   * Returns an error string if deleting this student is blocked,
   * or null if it's safe to proceed.
   */
  function canDeleteStudent(id) {
    const openAppeals = DB.query('behaviour_appeals', a =>
      a.studentId === id && ['pending','escalated'].includes(a.status));
    if (openAppeals.length) {
      return `Student has ${openAppeals.length} open appeal(s). Resolve them first.`;
    }
    const unpaidInvoices = DB.query('invoices', i =>
      i.studentId === id && i.status !== 'paid');
    if (unpaidInvoices.length) {
      return `Student has ${unpaidInvoices.length} unpaid invoice(s). Settle them first.`;
    }
    return null;
  }

  /**
   * Returns an error string if deleting this class is blocked, or null.
   */
  function canDeleteClass(classId) {
    const students = DB.query('students', s => s.classId === classId);
    if (students.length) {
      return `${students.length} student(s) are enrolled in this class. Move them first.`;
    }
    const ttEntry = DB.query('timetable', t => t.classId === classId);
    if (ttEntry.length) {
      return `This class has timetable entries. Clear the timetable first.`;
    }
    return null;
  }

  /**
   * Returns an error string if deleting this academic year is blocked, or null.
   */
  function canDeleteYear(id) {
    const ay = DB.getById('academicYears', id);
    if (!ay) return 'Academic year not found.';
    if (ay.isCurrent) return 'Cannot delete the current academic year.';
    const linkedClasses = DB.query('classes', c => c.academicYearId === id);
    if (linkedClasses.length) {
      return `${linkedClasses.length} class(es) are linked to this year. Reassign them first.`;
    }
    return null;
  }

  /**
   * Returns an error string if deleting this section is blocked, or null.
   */
  function canDeleteSection(sectionId) {
    const classes = DB.query('classes', c => c.sectionId === sectionId);
    if (classes.length) {
      return `Remove all ${classes.length} class(es) from this section first.`;
    }
    return null;
  }

  /**
   * Returns an error string if deleting this subject is blocked, or null.
   * Blocks if the subject is referenced in timetable slots, class assignments,
   * or grade records.
   */
  function canDeleteSubject(subjectId) {
    // Active timetable slots
    const inTimetable = DB.get('timetable').some(t =>
      (t.slots || []).some(s => s.subjectId === subjectId)
    );
    if (inTimetable) {
      return 'This subject is assigned in the timetable. Remove it from all timetable slots first.';
    }
    // Class–subject assignments
    const inClassSubjects = DB.query('class_subjects', r => r.subjectId === subjectId);
    if (inClassSubjects.length) {
      return `This subject is assigned to ${inClassSubjects.length} class(es). Remove the assignments first.`;
    }
    // Grade records
    const inGrades = DB.query('grades', g => g.subjectId === subjectId);
    if (inGrades.length) {
      return `This subject has ${inGrades.length} grade record(s). Grades must be removed before deleting the subject.`;
    }
    return null;
  }

  /**
   * Returns an error string if deleting this user is blocked, or null.
   * Blocks if the user is a homeroom teacher, has timetable slots,
   * or has a linked student record.
   */
  function canDeleteUser(userId) {
    // Homeroom teacher for a class
    const homeroomCls = DB.query('classes', c => c.homeroomTeacherId === userId);
    if (homeroomCls.length) {
      const names = homeroomCls.map(c => c.name).join(', ');
      return `This user is the homeroom teacher for: ${names}. Reassign the class first.`;
    }
    // Assigned to timetable slots
    const inTimetable = DB.get('timetable').some(t =>
      (t.slots || []).some(s => s.teacherId === userId)
    );
    if (inTimetable) {
      return 'This user is assigned to timetable slots. Remove them from the timetable first.';
    }
    // Has a linked student record (delete the student record first)
    const stuRecord = DB.query('students', s => s.userId === userId);
    if (stuRecord.length) {
      return 'This account is linked to a student record. Delete the student profile first.';
    }
    return null;
  }

  return {
    student,
    user,
    cls,
    timetableSlot,
    payment,
    incident,
    canDeleteStudent,
    canDeleteClass,
    canDeleteYear,
    canDeleteSection,
    canDeleteSubject,
    canDeleteUser,
  };
})();
