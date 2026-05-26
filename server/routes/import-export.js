/* ============================================================
   Msingi — /api/import-export
   Bulk CSV/JSON import and CSV export for key entities.

   Endpoints:
     GET  /api/import-export/template/:type        Download demo CSV template
     POST /api/import-export/:type                 Import CSV or JSON
     GET  /api/import-export/export/:type          Export all records as CSV

   Supported types: students, teachers

   Import accepts:
     Content-Type: text/csv          — raw CSV text (preferred)
     Content-Type: application/json  — { "rows": [...] } or raw array

   Export returns:
     Content-Type: text/csv; charset=utf-8  with Content-Disposition attachment
   ============================================================ */
const express  = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware }      = require('../middleware/auth');
const { rbac }                = require('../middleware/rbac');
const { planGate }            = require('../middleware/plan');
const { _model }              = require('../utils/model');
const {
  reserveAdmissionNumbers,
  reserveStaffIds,
  reserveInvoiceNumbers,
} = require('../utils/counters');
const { ok, fail, E }         = require('../utils/response');

const router = express.Router();

/* ── Inline CSV parser (no external dependency) ─────────────── */
/**
 * Parse a single CSV line, handling quoted fields with embedded commas.
 */
function _parseCSVLine(line) {
  const fields = [];
  let field    = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Parse CSV text → array of objects (first row = headers).
 * Returns { headers, rows, error? }
 */
function parseCSV(text) {
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = raw.filter(l => l.trim());
  if (nonEmpty.length < 2) return { headers: [], rows: [], error: 'CSV must have a header row and at least one data row' };

  const headers = _parseCSVLine(nonEmpty[0]).map(h => h.trim());
  const rows    = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const values = _parseCSVLine(nonEmpty[i]);
    const row    = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] !== undefined ? values[idx] : '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Convert an array of objects → CSV string.
 */
function toCSV(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => esc(row[h])).join(','))
  ];
  return '﻿' + lines.join('\n'); // BOM for Excel compatibility
}

/* ── Inline totals calc (mirrors finance.js) ──────────────────── */
function _round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function _lineTotal(lineItems) {
  return _round(lineItems.reduce((s, i) => s + _round((i.unitPrice || 0) * (i.quantity || 1)), 0));
}

/* ── Template definitions ────────────────────────────────────── */
const TEMPLATES = {
  students: {
    plan:    'students',
    rbacRes: 'students',
    headers: [
      'firstName', 'lastName', 'middleName',
      'dateOfBirth', 'gender',
      'className',   // resolved to classId on import
      'parentName', 'parentEmail', 'parentPhone',
      'address', 'enrollmentDate', 'status', 'medicalNotes'
    ],
    examples: [
      {
        firstName: 'Amara', lastName: 'Osei', middleName: 'Kweku',
        dateOfBirth: '2015-03-14', gender: 'female',
        className: 'Grade 3A',
        parentName: 'Kofi Osei', parentEmail: 'kofi.osei@example.com', parentPhone: '+254712345678',
        address: 'Nairobi, Kenya', enrollmentDate: '2026-01-15', status: 'active', medicalNotes: ''
      },
      {
        firstName: 'Tomas', lastName: 'Muriuki', middleName: '',
        dateOfBirth: '2016-07-22', gender: 'male',
        className: 'Grade 2B',
        parentName: 'Mary Muriuki', parentEmail: 'mary.m@example.com', parentPhone: '+254798765432',
        address: 'Mombasa, Kenya', enrollmentDate: '2026-01-15', status: 'active', medicalNotes: 'Allergic to peanuts'
      }
    ],
    notes: [
      '# STUDENT IMPORT TEMPLATE — Msingi School Management',
      '# Instructions:',
      '#   firstName, lastName  — REQUIRED',
      '#   dateOfBirth          — format YYYY-MM-DD (e.g. 2015-03-14)',
      '#   gender               — male | female | other | prefer_not_to_say',
      '#   className            — exact class name as shown in your Msingi classes list',
      '#   enrollmentDate       — format YYYY-MM-DD',
      '#   status               — active | inactive | suspended (default: active)',
      '#   parentEmail          — must be a valid email if provided',
      '#   admissionNumber      — auto-generated by system, do NOT include',
      '#',
      '#   Rows beginning with # are ignored.',
      '#   Maximum 500 students per import file.',
      '#',
    ]
  },

  teachers: {
    plan:    'teachers',
    rbacRes: 'teachers',
    headers: [
      'firstName', 'lastName', 'middleName',
      'email', 'phone',
      'dateOfBirth', 'gender', 'title',
      'qualifications', 'joinDate', 'contractType', 'status'
    ],
    examples: [
      {
        firstName: 'Grace', lastName: 'Akinyi', middleName: 'N.',
        email: 'grace.akinyi@school.example.com', phone: '+254712000001',
        dateOfBirth: '1985-06-10', gender: 'female', title: 'Mrs',
        qualifications: 'B.Ed Mathematics, University of Nairobi',
        joinDate: '2026-01-06', contractType: 'full_time', status: 'active'
      },
      {
        firstName: 'Brian', lastName: 'Kamau', middleName: '',
        email: 'b.kamau@school.example.com', phone: '+254798000002',
        dateOfBirth: '1990-11-25', gender: 'male', title: 'Mr',
        qualifications: 'PGCE Science, Kenyatta University',
        joinDate: '2026-01-06', contractType: 'full_time', status: 'active'
      }
    ],
    notes: [
      '# TEACHER IMPORT TEMPLATE — Msingi School Management',
      '# Instructions:',
      '#   firstName, lastName, email  — REQUIRED',
      '#   email                       — must be unique per school',
      '#   dateOfBirth                 — format YYYY-MM-DD',
      '#   gender                      — male | female | other | prefer_not_to_say',
      '#   title                       — Mr | Mrs | Ms | Dr | Prof (any text)',
      '#   joinDate                    — format YYYY-MM-DD',
      '#   contractType                — full_time | part_time | supply | volunteer',
      '#   status                      — active | inactive | on_leave (default: active)',
      '#   staffId                     — auto-generated by system, do NOT include',
      '#',
      '#   Rows beginning with # are ignored.',
      '#   Maximum 500 teachers per import file.',
      '#',
    ]
  },

  classes: {
    plan:    'classes',
    rbacRes: 'classes',
    headers: ['name', 'sectionKey', 'year', 'capacity'],
    examples: [
      { name: 'Standard 4A', sectionKey: 'primary',   year: 'Standard 4', capacity: '35' },
      { name: 'Form 1A',     sectionKey: 'secondary', year: 'Form 1',     capacity: '40' },
      { name: 'Form 5A',     sectionKey: 'alevel',    year: 'Form 5',     capacity: '25' },
      { name: 'PP2 Red',     sectionKey: 'kg',        year: 'PP2',        capacity: '20' },
    ],
    notes: [
      '# CLASS IMPORT TEMPLATE — Msingi School Management',
      '# Instructions:',
      '#   name        — REQUIRED, e.g. "Form 3A" or "Grade 5B"',
      '#   sectionKey  — REQUIRED: primary | secondary | alevel | kg',
      '#   year        — optional display label, e.g. "Form 3" or "Grade 5"',
      '#   capacity    — optional max student count',
      '#',
      '#   Classes whose name already exists in Msingi are skipped (not updated).',
      '#   Rows beginning with # are ignored.',
      '#   Maximum 500 rows per import file.',
      '#',
    ]
  },

  timetable: {
    plan:    'timetable',
    rbacRes: 'timetable',
    headers: ['className', 'day', 'period', 'subject', 'teacherName', 'room', 'type'],
    examples: [
      { className: 'Form 4A', day: 'monday',    period: '1', subject: 'Mathematics', teacherName: 'Grace Akinyi', room: 'Room 101', type: 'lesson' },
      { className: 'Form 4A', day: 'monday',    period: '2', subject: 'Physics',     teacherName: 'Brian Kamau',  room: 'Lab 1',    type: 'lesson' },
      { className: 'Form 3B', day: 'tuesday',   period: '1', subject: 'English',     teacherName: 'Agnes Mwangi', room: 'Room 202', type: 'lesson' },
      { className: 'Form 4A', day: 'wednesday', period: '3', subject: 'Assembly',    teacherName: '',             room: 'Hall',     type: 'assembly' },
    ],
    notes: [
      '# TIMETABLE IMPORT TEMPLATE — Msingi School Management',
      '# Instructions:',
      '#   className   — REQUIRED, exact class name as shown in your Classes list',
      '#   day         — REQUIRED: monday | tuesday | wednesday | thursday | friday',
      '#   period      — REQUIRED: lesson period number, e.g. 1, 2, 3',
      '#   subject     — subject name, e.g. Mathematics (optional)',
      '#   teacherName — teacher first + last name, e.g. Grace Akinyi (matched to active staff)',
      '#   room        — room name, e.g. Lab 1 or Room 202 (optional)',
      '#   type        — lesson | assembly | registration | free  (default: lesson)',
      '#',
      '#   Existing slots for the same class/day/period are UPDATED (upsert behaviour).',
      '#   To start fresh: clear your timetable in the Timetable module first, then import.',
      '#   Maximum 500 rows per import file.',
      '#',
    ]
  },

  finance: {
    plan:    'finance',
    rbacRes: 'finance',
    headers: ['admissionNumber', 'title', 'description', 'amount', 'dueDate'],
    examples: [
      { admissionNumber: 'ADM-2026-001', title: 'Term 1 Fees', description: 'Tuition Fee', amount: '15000', dueDate: '2026-03-31' },
      { admissionNumber: 'ADM-2026-002', title: 'Term 1 Fees', description: 'Tuition Fee', amount: '15000', dueDate: '2026-03-31' },
      { admissionNumber: 'ADM-2026-001', title: 'Term 1 Fees', description: 'Transport',   amount: '3000',  dueDate: '2026-03-31' },
    ],
    notes: [
      '# FINANCE IMPORT TEMPLATE — Msingi School Management',
      '# Instructions:',
      '#   admissionNumber — REQUIRED, student admission number as shown in Msingi',
      '#   title           — REQUIRED, invoice title e.g. "Term 1 School Fees"',
      '#   description     — REQUIRED, line item description e.g. "Tuition Fee"',
      '#   amount          — REQUIRED, numeric amount, e.g. 15000',
      '#   dueDate         — format YYYY-MM-DD (optional)',
      '#',
      '#   Each row creates ONE invoice with ONE line item for the given student.',
      '#   To create an invoice with multiple line items, create separate rows',
      '#   (each row = separate invoice).',
      '#   Rows beginning with # are ignored.',
      '#   Maximum 500 rows per import file.',
      '#',
    ]
  },
};

/* ── Middleware to accept raw CSV body ───────────────────────── */
// express.json() is already mounted globally, so we only need text parsing here
const rawText = express.text({ type: 'text/csv', limit: '5mb' });

/* ── Helper: resolve class name → classId ────────────────────── */
async function _buildClassMap(schoolId) {
  const Classes = _model('classes');
  const docs    = await Classes.find({ schoolId }).select('id name').lean();
  const map     = {};
  for (const c of docs) {
    map[c.name.toLowerCase().trim()] = c.id;
  }
  return map;
}

/* ── Helper: resolve teacher name → { teacherId, teacherName } ── */
async function _buildTeacherMap(schoolId) {
  const docs = await _model('teachers')
    .find({ schoolId, status: 'active' })
    .select('userId id firstName lastName')
    .lean();
  const map = {};
  for (const t of docs) {
    const key = `${t.firstName} ${t.lastName}`.toLowerCase().trim();
    map[key] = {
      teacherId:   t.userId ?? String(t._id),
      teacherName: `${t.firstName} ${t.lastName}`.trim(),
    };
  }
  return map;
}

/* ─────────────────────────────────────────────────────────────
   GET /api/import-export/template/:type
   Download a demo CSV template with example rows and instructions
   ──────────────────────────────────────────────────────────── */
router.get('/template/:type', authMiddleware, async (req, res) => {
  const tpl = TEMPLATES[req.params.type];
  if (!tpl) return E.notFound(res, `No template for type '${req.params.type}'. Valid types: ${Object.keys(TEMPLATES).join(', ')}`);

  const lines = [
    ...tpl.notes,
    tpl.headers.join(','),
    ...tpl.examples.map(row => tpl.headers.map(h => {
      const v = String(row[h] ?? '');
      return (v.includes(',') || v.includes('"')) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(','))
  ];

  const csv = '﻿' + lines.join('\n'); // BOM for Excel

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="msingi_${req.params.type}_template.csv"`);
  return res.send(csv);
});

/* ─────────────────────────────────────────────────────────────
   POST /api/import-export/:type
   Accepts: text/csv (raw) or application/json { rows: [...] }
   Returns import summary: { created, skipped, errors[] }
   ──────────────────────────────────────────────────────────── */

/* ── Student import handler ───────────────────────── */
async function _importStudents(rows, schoolId, userId) {
  const classMap = await _buildClassMap(schoolId);
  const Students = _model('students');

  const VALID_GENDER  = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
  const VALID_STATUS  = new Set(['active', 'inactive', 'suspended', 'graduated', 'transferred']);

  const results  = { created: 0, skipped: 0, errors: [] };
  const validRows = []; // collect valid rows before touching counters

  for (let i = 0; i < rows.length; i++) {
    const r   = rows[i];
    const row = i + 1; // 1-based for user-facing error messages

    // Skip comment rows
    if (r.firstName?.startsWith('#')) continue;

    // Required fields
    if (!r.firstName?.trim()) { results.errors.push({ row, field: 'firstName', message: 'First name is required' }); results.skipped++; continue; }
    if (!r.lastName?.trim())  { results.errors.push({ row, field: 'lastName',  message: 'Last name is required' });  results.skipped++; continue; }

    // Field coercions / validations
    const gender = r.gender?.trim().toLowerCase();
    if (gender && !VALID_GENDER.has(gender)) {
      results.errors.push({ row, field: 'gender', message: `Invalid gender '${r.gender}'. Use: male, female, other, prefer_not_to_say` });
      results.skipped++; continue;
    }

    const status = r.status?.trim().toLowerCase() || 'active';
    if (!VALID_STATUS.has(status)) {
      results.errors.push({ row, field: 'status', message: `Invalid status '${r.status}'. Use: active, inactive, suspended, graduated, transferred` });
      results.skipped++; continue;
    }

    // Parent email validation
    const parentEmail = r.parentEmail?.trim();
    if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
      results.errors.push({ row, field: 'parentEmail', message: `Invalid email '${parentEmail}'` });
      results.skipped++; continue;
    }

    // Class name → id resolution
    let classId = null;
    if (r.className?.trim()) {
      classId = classMap[r.className.trim().toLowerCase()];
      if (!classId) {
        results.errors.push({ row, field: 'className', message: `Class '${r.className}' not found. Create it first in Msingi, then re-import.` });
        results.skipped++; continue;
      }
    }

    validRows.push({ r, row, gender, status, parentEmail, classId });
  }

  // Reserve ALL admission numbers in one atomic DB call (was N sequential calls)
  const admissionNumbers = validRows.length > 0
    ? await reserveAdmissionNumbers(schoolId, validRows.length)
    : [];

  const toInsert = validRows.map(({ r, gender, status, parentEmail, classId }, idx) => ({
    id:              uuidv4(),
    schoolId,
    admissionNumber: admissionNumbers[idx],
    firstName:       r.firstName.trim(),
    lastName:        r.lastName.trim(),
    middleName:      r.middleName?.trim() || undefined,
    dateOfBirth:     r.dateOfBirth?.trim() || undefined,
    gender:          gender || undefined,
    classId:         classId || undefined,
    parentName:      r.parentName?.trim() || undefined,
    parentEmail:     parentEmail || undefined,
    parentPhone:     r.parentPhone?.trim() || undefined,
    address:         r.address?.trim() || undefined,
    enrollmentDate:  r.enrollmentDate?.trim() || undefined,
    status,
    medicalNotes:    r.medicalNotes?.trim() || undefined,
    createdBy:       userId,
    updatedBy:       userId,
  }));

  if (toInsert.length > 0) {
    try {
      await Students.insertMany(toInsert, { ordered: false });
      results.created = toInsert.length;
    } catch (err) {
      // insertMany with ordered:false — some may have succeeded
      if (err.writeErrors) {
        const failed = err.writeErrors.length;
        results.created = toInsert.length - failed;
        err.writeErrors.forEach(we => {
          results.errors.push({ row: we.index + 1, message: we.errmsg || 'Duplicate record' });
          results.skipped++;
        });
      } else throw err;
    }
  }

  return results;
}

/* ── Teacher import handler ────────────────────────── */
async function _importTeachers(rows, schoolId, userId) {
  const Teachers = _model('teachers');

  const VALID_GENDER   = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
  const VALID_STATUS   = new Set(['active', 'inactive', 'on_leave', 'terminated']);
  const VALID_CONTRACT = new Set(['full_time', 'part_time', 'supply', 'volunteer']);

  const results   = { created: 0, skipped: 0, errors: [] };
  const validRows = [];

  // Pre-fetch existing emails to detect duplicates early
  const existing    = await Teachers.find({ schoolId }).select('email').lean();
  const knownEmails = new Set(existing.map(t => t.email.toLowerCase()));

  for (let i = 0; i < rows.length; i++) {
    const r   = rows[i];
    const row = i + 1;

    if (r.firstName?.startsWith('#')) continue;

    if (!r.firstName?.trim()) { results.errors.push({ row, field: 'firstName', message: 'First name is required' }); results.skipped++; continue; }
    if (!r.lastName?.trim())  { results.errors.push({ row, field: 'lastName',  message: 'Last name is required' });  results.skipped++; continue; }

    const email = r.email?.trim().toLowerCase();
    if (!email) { results.errors.push({ row, field: 'email', message: 'Email is required for teachers' }); results.skipped++; continue; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { results.errors.push({ row, field: 'email', message: `Invalid email '${email}'` }); results.skipped++; continue; }
    if (knownEmails.has(email)) { results.errors.push({ row, field: 'email', message: `Email '${email}' already exists in this school` }); results.skipped++; continue; }
    knownEmails.add(email);

    const gender = r.gender?.trim().toLowerCase();
    if (gender && !VALID_GENDER.has(gender)) {
      results.errors.push({ row, field: 'gender', message: `Invalid gender '${r.gender}'` });
      results.skipped++; continue;
    }

    const contractType = r.contractType?.trim().toLowerCase();
    if (contractType && !VALID_CONTRACT.has(contractType)) {
      results.errors.push({ row, field: 'contractType', message: `Invalid contractType '${r.contractType}'. Use: full_time, part_time, supply, volunteer` });
      results.skipped++; continue;
    }

    const status = r.status?.trim().toLowerCase() || 'active';
    if (!VALID_STATUS.has(status)) {
      results.errors.push({ row, field: 'status', message: `Invalid status '${r.status}'` });
      results.skipped++; continue;
    }

    validRows.push({ r, row, email, gender, contractType, status });
  }

  // Reserve all staff IDs in one atomic DB call
  const staffIds = validRows.length > 0
    ? await reserveStaffIds(schoolId, validRows.length)
    : [];

  const toInsert = validRows.map(({ r, email, gender, contractType, status }, idx) => ({
    id:             uuidv4(),
    schoolId,
    staffId:        staffIds[idx],
    firstName:      r.firstName.trim(),
    lastName:       r.lastName.trim(),
    middleName:     r.middleName?.trim() || undefined,
    email,
    phone:          r.phone?.trim() || undefined,
    dateOfBirth:    r.dateOfBirth?.trim() || undefined,
    gender:         gender || undefined,
    title:          r.title?.trim() || undefined,
    qualifications: r.qualifications?.trim() || undefined,
    joinDate:       r.joinDate?.trim() || undefined,
    contractType:   contractType || undefined,
    status,
    createdBy:      userId,
    updatedBy:      userId,
  }));

  if (toInsert.length > 0) {
    try {
      await Teachers.insertMany(toInsert, { ordered: false });
      results.created = toInsert.length;
    } catch (err) {
      if (err.writeErrors) {
        const failed = err.writeErrors.length;
        results.created = toInsert.length - failed;
        err.writeErrors.forEach(we => {
          results.errors.push({ row: we.index + 1, message: we.errmsg || 'Duplicate record' });
          results.skipped++;
        });
      } else throw err;
    }
  }

  return results;
}

/* ── Classes import handler ────────────────────────────────── */
async function _importClasses(rows, schoolId, userId) {
  const Classes  = _model('classes');
  const existing = await Classes.find({ schoolId }).select('name').lean();
  const knownNames = new Set(existing.map(c => c.name.toLowerCase().trim()));

  const VALID_SECTION = new Set(['primary', 'secondary', 'alevel', 'kg']);

  const results  = { created: 0, skipped: 0, errors: [] };
  const toInsert = [];

  for (let i = 0; i < rows.length; i++) {
    const r   = rows[i];
    const row = i + 1;

    if (r.name?.startsWith('#')) continue;

    if (!r.name?.trim()) {
      results.errors.push({ row, field: 'name', message: 'Class name is required' });
      results.skipped++; continue;
    }

    const sectionKey = r.sectionKey?.trim().toLowerCase();
    if (!sectionKey || !VALID_SECTION.has(sectionKey)) {
      results.errors.push({ row, field: 'sectionKey', message: `sectionKey must be one of: primary, secondary, alevel, kg. Got: '${r.sectionKey || ''}'` });
      results.skipped++; continue;
    }

    const nameKey = r.name.trim().toLowerCase();
    if (knownNames.has(nameKey)) {
      results.skipped++;
      continue; // silent skip for duplicates — expected behaviour
    }
    knownNames.add(nameKey); // prevent within-batch duplicates

    const capacity = r.capacity ? parseInt(r.capacity, 10) : undefined;
    if (r.capacity && (isNaN(capacity) || capacity < 1)) {
      results.errors.push({ row, field: 'capacity', message: `Capacity must be a positive number. Got: '${r.capacity}'` });
      results.skipped++; continue;
    }

    toInsert.push({
      id:         uuidv4(),
      schoolId,
      name:       r.name.trim(),
      sectionKey,
      year:       r.year?.trim() || undefined,
      capacity:   capacity || undefined,
      status:     'active',
      createdBy:  userId,
      updatedBy:  userId,
    });
  }

  if (toInsert.length > 0) {
    try {
      await Classes.insertMany(toInsert, { ordered: false });
      results.created = toInsert.length;
    } catch (err) {
      if (err.writeErrors) {
        const failed = err.writeErrors.length;
        results.created = toInsert.length - failed;
        err.writeErrors.forEach(we => {
          results.errors.push({ row: we.index + 1, message: we.errmsg || 'Duplicate or invalid record' });
          results.skipped++;
        });
      } else throw err;
    }
  }

  return results;
}

/* ── Timetable import handler ──────────────────────────────── */
async function _importTimetable(rows, schoolId, userId) {
  const [classMap, teacherMap] = await Promise.all([
    _buildClassMap(schoolId),
    _buildTeacherMap(schoolId),
  ]);

  const Timetable  = _model('timetable');
  const VALID_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  const VALID_TYPE = new Set(['lesson', 'assembly', 'registration', 'free']);

  const results = { created: 0, skipped: 0, errors: [] };
  let upserted  = 0;
  let inserted  = 0;

  for (let i = 0; i < rows.length; i++) {
    const r   = rows[i];
    const row = i + 1;

    if (r.className?.startsWith('#')) continue;

    // Required fields
    if (!r.className?.trim()) { results.errors.push({ row, field: 'className', message: 'className is required' }); results.skipped++; continue; }
    if (!r.day?.trim())       { results.errors.push({ row, field: 'day',       message: 'day is required' });       results.skipped++; continue; }
    if (!r.period?.trim())    { results.errors.push({ row, field: 'period',    message: 'period is required' });    results.skipped++; continue; }

    const day = r.day.trim().toLowerCase();
    if (!VALID_DAYS.has(day)) {
      results.errors.push({ row, field: 'day', message: `day must be monday–friday. Got: '${r.day}'` });
      results.skipped++; continue;
    }

    const period = String(parseInt(r.period, 10));
    if (isNaN(Number(period)) || Number(period) < 1) {
      results.errors.push({ row, field: 'period', message: `period must be a positive integer. Got: '${r.period}'` });
      results.skipped++; continue;
    }

    const classId = classMap[r.className.trim().toLowerCase()];
    if (!classId) {
      results.errors.push({ row, field: 'className', message: `Class '${r.className}' not found. Create it first in Classes, then re-import.` });
      results.skipped++; continue;
    }

    const type = r.type?.trim().toLowerCase() || 'lesson';
    if (!VALID_TYPE.has(type)) {
      results.errors.push({ row, field: 'type', message: `type must be: lesson, assembly, registration, or free. Got: '${r.type}'` });
      results.skipped++; continue;
    }

    // Resolve teacher name → FK (best-effort; not required)
    let teacherId   = undefined;
    let teacherName = r.teacherName?.trim() || undefined;
    if (teacherName) {
      const match = teacherMap[teacherName.toLowerCase()];
      if (match) {
        teacherId   = match.teacherId;
        teacherName = match.teacherName;
      }
      // If no match — keep the raw name string so data is not silently lost
    }

    try {
      const filter = { schoolId, classId, day, period };
      const update = {
        $set: {
          subject:     r.subject?.trim() || undefined,
          teacherId:   teacherId   || undefined,
          teacherName: teacherName || undefined,
          room:        r.room?.trim() || undefined,
          type,
          isActive:    true,
          updatedBy:   userId,
        },
        $setOnInsert: {
          id:        uuidv4(),
          createdBy: userId,
        },
      };
      const result = await Timetable.findOneAndUpdate(filter, update, {
        upsert: true,
        new:    true,
        rawResult: true,
      });
      if (result.lastErrorObject?.updatedExisting) {
        upserted++;
      } else {
        inserted++;
      }
    } catch (err) {
      results.errors.push({ row, message: err.message || 'Failed to upsert slot' });
      results.skipped++;
    }
  }

  results.created = inserted + upserted; // total written (both new and updated)
  return { ...results, inserted, updated: upserted };
}

/* ── Finance import handler ────────────────────────────────── */
async function _importFinance(rows, schoolId, userId) {
  const Students = _model('students');
  const Invoices = _model('invoices');

  // Build admission number → studentId map
  const studentDocs = await Students.find({ schoolId }).select('id admissionNumber firstName lastName').lean();
  const studentMap  = {};
  for (const s of studentDocs) {
    if (s.admissionNumber) {
      studentMap[s.admissionNumber.trim().toLowerCase()] = {
        studentId:   s.id,
        studentName: `${s.firstName} ${s.lastName}`.trim(),
      };
    }
  }

  const results   = { created: 0, skipped: 0, errors: [] };
  const validRows = [];

  for (let i = 0; i < rows.length; i++) {
    const r   = rows[i];
    const row = i + 1;

    if (r.admissionNumber?.startsWith('#')) continue;

    if (!r.admissionNumber?.trim()) { results.errors.push({ row, field: 'admissionNumber', message: 'admissionNumber is required' }); results.skipped++; continue; }
    if (!r.title?.trim())           { results.errors.push({ row, field: 'title',           message: 'title is required' });           results.skipped++; continue; }
    if (!r.description?.trim())     { results.errors.push({ row, field: 'description',     message: 'description is required' });     results.skipped++; continue; }
    if (!r.amount?.trim())          { results.errors.push({ row, field: 'amount',           message: 'amount is required' });          results.skipped++; continue; }

    const amount = parseFloat(r.amount);
    if (isNaN(amount) || amount < 0) {
      results.errors.push({ row, field: 'amount', message: `amount must be a positive number. Got: '${r.amount}'` });
      results.skipped++; continue;
    }

    const student = studentMap[r.admissionNumber.trim().toLowerCase()];
    if (!student) {
      results.errors.push({ row, field: 'admissionNumber', message: `Student '${r.admissionNumber}' not found in this school` });
      results.skipped++; continue;
    }

    validRows.push({ r, unitPrice: _round(amount), student });
  }

  // Reserve all invoice numbers in one atomic DB call
  const invoiceNumbers = validRows.length > 0
    ? await reserveInvoiceNumbers(schoolId, validRows.length)
    : [];

  const toInsert = validRows.map(({ r, unitPrice, student }, idx) => ({
    id:            uuidv4(),
    schoolId,
    invoiceNumber: invoiceNumbers[idx],
    studentId:     student.studentId,
    studentName:   student.studentName,
    title:         r.title.trim(),
    lineItems: [{
      description: r.description.trim(),
      quantity:    1,
      unitPrice,
      total:       unitPrice,
    }],
    subtotal:    unitPrice,
    discount:    0,
    tax:         0,
    total:       unitPrice,
    amountPaid:  0,
    balance:     unitPrice,
    status:      'unpaid',
    dueDate:     r.dueDate?.trim() || undefined,
    createdBy:   userId,
    updatedBy:   userId,
  }));

  if (toInsert.length > 0) {
    try {
      await Invoices.insertMany(toInsert, { ordered: false });
      results.created = toInsert.length;
    } catch (err) {
      if (err.writeErrors) {
        const failed = err.writeErrors.length;
        results.created = toInsert.length - failed;
        err.writeErrors.forEach(we => {
          results.errors.push({ row: we.index + 1, message: we.errmsg || 'Failed to create invoice' });
          results.skipped++;
        });
      } else throw err;
    }
  }

  return results;
}

/* ── POST /api/import-export/:type ──────────────────────────── */
router.post('/:type', authMiddleware, rawText, async (req, res) => {
  const { type }              = req.params;
  const { schoolId, userId }  = req.jwtUser;
  const tpl                   = TEMPLATES[type];

  if (!tpl) return E.notFound(res, `Unsupported import type '${type}'. Valid types: ${Object.keys(TEMPLATES).join(', ')}`);

  /* Check plan & RBAC */
  const planOk = await new Promise(resolve => {
    planGate(tpl.plan)(req, res, () => resolve(true));
  }).catch(() => false);
  if (!planOk) return; // planGate already sent the 403

  /* Parse the incoming body */
  let rows = [];
  const ct = req.headers['content-type'] || '';

  if (ct.includes('text/csv')) {
    const { rows: parsed, error } = parseCSV(req.body);
    if (error) return E.badRequest(res, error);
    rows = parsed;
  } else {
    // JSON: accept { rows: [...] } or raw array
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    rows = Array.isArray(body) ? body : (body?.rows || body?.data || []);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return E.badRequest(res, 'No data rows found. Upload a CSV or send { "rows": [...] }');
  }
  if (rows.length > 500) {
    return E.badRequest(res, 'Maximum 500 rows per import. Split your file into smaller batches.');
  }

  try {
    let results;
    if (type === 'students')  results = await _importStudents(rows, schoolId, userId);
    if (type === 'teachers')  results = await _importTeachers(rows, schoolId, userId);
    if (type === 'classes')   results = await _importClasses(rows, schoolId, userId);
    if (type === 'timetable') results = await _importTimetable(rows, schoolId, userId);
    if (type === 'finance')   results = await _importFinance(rows, schoolId, userId);

    if (!results) return E.notFound(res, `No handler for type '${type}'`);

    const status = results.errors.length > 0 && results.created === 0 ? 422
      : results.errors.length > 0 ? 207  // partial success
      : 201;

    return res.status(status).json({
      success: results.created > 0,
      data: {
        created:  results.created,
        skipped:  results.skipped,
        total:    rows.length,
        errors:   results.errors,
        // timetable-specific: break down new vs updated
        ...(type === 'timetable' ? { inserted: results.inserted, updated: results.updated } : {}),
      }
    });
  } catch (err) {
    console.error(`[import-export POST /${type}]`, err);
    return E.serverError(res);
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/import-export/export/:type
   Export all records as a downloadable CSV
   ──────────────────────────────────────────────────────────── */
router.get('/export/:type', authMiddleware, async (req, res) => {
  const { type }     = req.params;
  const { schoolId } = req.jwtUser;

  try {
    let csv;

    if (type === 'students') {
      const Students  = _model('students');
      const Classes   = _model('classes');

      const [docs, classes] = await Promise.all([
        Students.find({ schoolId }).sort({ lastName: 1, firstName: 1 }).lean(),
        Classes.find({ schoolId }).select('id name').lean()
      ]);

      const classById = {};
      for (const c of classes) classById[c.id] = c.name;

      const headers = [
        'admissionNumber', 'firstName', 'lastName', 'middleName',
        'dateOfBirth', 'gender', 'className',
        'parentName', 'parentEmail', 'parentPhone',
        'address', 'enrollmentDate', 'status', 'medicalNotes', 'createdAt'
      ];

      const rows = docs.map(d => ({
        admissionNumber: d.admissionNumber || '',
        firstName:       d.firstName || '',
        lastName:        d.lastName  || '',
        middleName:      d.middleName || '',
        dateOfBirth:     d.dateOfBirth || '',
        gender:          d.gender || '',
        className:       d.classId ? (classById[d.classId] || d.classId) : '',
        parentName:      d.parentName || '',
        parentEmail:     d.parentEmail || '',
        parentPhone:     d.parentPhone || '',
        address:         d.address || '',
        enrollmentDate:  d.enrollmentDate || '',
        status:          d.status || '',
        medicalNotes:    d.medicalNotes || '',
        createdAt:       d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : ''
      }));

      csv = toCSV(headers, rows);
      res.setHeader('Content-Disposition', `attachment; filename="msingi_students_${_dateStamp()}.csv"`);

    } else if (type === 'teachers') {
      const Teachers = _model('teachers');
      const docs     = await Teachers.find({ schoolId }).sort({ lastName: 1, firstName: 1 }).lean();

      const headers = [
        'staffId', 'firstName', 'lastName', 'middleName',
        'email', 'phone', 'dateOfBirth', 'gender', 'title',
        'qualifications', 'joinDate', 'contractType', 'status', 'createdAt'
      ];

      const rows = docs.map(d => ({
        staffId:        d.staffId || '',
        firstName:      d.firstName || '',
        lastName:       d.lastName  || '',
        middleName:     d.middleName || '',
        email:          d.email || '',
        phone:          d.phone || '',
        dateOfBirth:    d.dateOfBirth || '',
        gender:         d.gender || '',
        title:          d.title || '',
        qualifications: d.qualifications || '',
        joinDate:       d.joinDate || '',
        contractType:   d.contractType || '',
        status:         d.status || '',
        createdAt:      d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : ''
      }));

      csv = toCSV(headers, rows);
      res.setHeader('Content-Disposition', `attachment; filename="msingi_teachers_${_dateStamp()}.csv"`);

    } else if (type === 'classes') {
      const Classes = _model('classes');
      const docs    = await Classes.find({ schoolId }).sort({ name: 1 }).lean();

      const headers = ['name', 'section', 'keyStage', 'capacity', 'status', 'createdAt'];
      const rows    = docs.map(d => ({
        name:      d.name || '',
        section:   d.section || '',
        keyStage:  d.keyStage || '',
        capacity:  d.capacity ?? '',
        status:    d.status || '',
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : ''
      }));

      csv = toCSV(headers, rows);
      res.setHeader('Content-Disposition', `attachment; filename="msingi_classes_${_dateStamp()}.csv"`);

    } else if (type === 'timetable') {
      const [slots, classes] = await Promise.all([
        _model('timetable').find({ schoolId, isActive: true }).sort({ classId: 1, day: 1, period: 1 }).lean(),
        _model('classes').find({ schoolId }).select('id name').lean()
      ]);

      const classById = {};
      for (const c of classes) classById[c.id] = c.name;

      const headers = ['className', 'day', 'period', 'subject', 'teacherName', 'room', 'type'];
      const rows    = slots.map(s => ({
        className:   s.classId ? (classById[s.classId] || s.classId) : '',
        day:         s.day || '',
        period:      s.period || '',
        subject:     s.subject || '',
        teacherName: s.teacherName || '',
        room:        s.room || '',
        type:        s.type || 'lesson',
      }));

      csv = toCSV(headers, rows);
      res.setHeader('Content-Disposition', `attachment; filename="msingi_timetable_${_dateStamp()}.csv"`);

    } else if (type === 'finance') {
      const Invoices = _model('invoices');
      const docs     = await Invoices.find({ schoolId }).sort({ createdAt: -1 }).lean();

      const headers = ['invoiceNumber', 'studentName', 'title', 'description', 'amount', 'total', 'amountPaid', 'balance', 'status', 'dueDate', 'createdAt'];
      const rows    = docs.map(d => {
        const firstLine = d.lineItems?.[0] || {};
        return {
          invoiceNumber: d.invoiceNumber || '',
          studentName:   d.studentName || '',
          title:         d.title || '',
          description:   firstLine.description || '',
          amount:        firstLine.unitPrice ?? '',
          total:         d.total ?? '',
          amountPaid:    d.amountPaid ?? '',
          balance:       d.balance ?? '',
          status:        d.status || '',
          dueDate:       d.dueDate || '',
          createdAt:     d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : '',
        };
      });

      csv = toCSV(headers, rows);
      res.setHeader('Content-Disposition', `attachment; filename="msingi_finance_${_dateStamp()}.csv"`);

    } else {
      return E.notFound(res, `Unsupported export type '${type}'. Valid types: students, teachers, classes, timetable, finance`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);

  } catch (err) {
    console.error(`[import-export GET /export/${type}]`, err);
    return E.serverError(res);
  }
});

function _dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

module.exports = router;
