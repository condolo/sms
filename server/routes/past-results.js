/* ============================================================
   Msingi — /api/past-results  (v5.278.0)

   Import results from earlier academic years, for any school moving onto
   the system with years of mark sheets behind it (first asked for by
   Trinitas and Trinity, 2026-11).

   One upload = one academic year + term + assessment (e.g. 2024, Term 2,
   End-Term), as a mark sheet: one row per student, one column per
   subject — the shape schools already keep in Excel (saved as CSV).
     admissionNumber, name, class, stream, Mathematics, English, ...
   "class" may be left out when the whole sheet is one class (picked on
   screen). A cell holds a score (out of "outOf", converted to the 0–100
   the Markbook stores), or ABS / MIS / EXM / INC, or nothing.

   Endpoints
     GET  /template           blank sheet for a class (its subjects as columns)
     POST /preview            check a sheet; writes nothing
     POST /commit             import it (same checks); returns a batch id
     GET  /batches            past imports
     POST /batches/:id/undo   remove what a batch added, restore what it replaced
     GET  /class-history      a student's class per year, or a past class's roster

   Rules
     - Admins, or roles with full exam rights (Enter / Edit Marks with
       Delete), only.
     - The year must exist and must not be archived (archiving locks a
       year — import first, then archive).
     - Marks are matched on the EXACT year. The Markbook's save adopts a
       legacy mark stored without a year; this import never does, so a
       past year can never overwrite this year's marks.
     - Existing marks are kept unless "overwrite" is chosen; locked marks
       (published report cards) are never touched.
     - Students are matched by admission number in any status, so leavers
       (graduated / transferred / withdrawn) can carry their results.
     - Each student's class for that year is saved to class history.
     - Past years' subjects need not be on today's curriculum.
   ============================================================ */
'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { rbac, hasExplicitSubGrant } = require('../middleware/rbac');
const { planGate }   = require('../middleware/plan');
const { moduleGate } = require('../middleware/module-gate');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, fail, E } = require('../utils/response');
const { parseCSV } = require('../utils/csv');
const { isYearArchived } = require('../utils/archival');
const { recordClassHistory, yearIdOf } = require('../utils/class-history');
const { tagUntaggedMarks } = require('../utils/untagged-marks');
const AuditService = require('../services/audit');

const router  = express.Router();
const PLAN    = planGate('grades');
const MODGATE = moduleGate('grades');

const MAX_ROWS  = 3000;
const MAX_MARKS = 40000;
const STATES = { ABS: 'ABS', ABSENT: 'ABS', MIS: 'MIS', MISSING: 'MIS', EXM: 'EXM', EXEMPT: 'EXM', EXEMPTED: 'EXM', INC: 'INC', INCOMPLETE: 'INC' };

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Match a sheet value to records: exact (ignoring case and outer spaces)
// first, then ignoring spaces and punctuation too ("TR-001" = "tr001").
// Two records matching equally is AMBIGUOUS and reported, never guessed.
function makeMatcher(items, valueOf) {
  const exact = new Map(), loose = new Map();
  const add = (map, k, it) => { if (!k) return; map.set(k, [...(map.get(k) || []), it]); };
  for (const it of items) {
    const v = String(valueOf(it) ?? '').trim();
    add(exact, v.toLowerCase(), it);
    add(loose, norm(v), it);
  }
  return (value) => {
    const v = String(value ?? '').trim();
    const hits = exact.get(v.toLowerCase()) || loose.get(norm(v)) || [];
    return hits.length === 1 ? { hit: hits[0] } : hits.length > 1 ? { ambiguous: hits } : {};
  };
}
const idOf = (d) => (d ? (d.id || (d._id != null ? String(d._id) : null)) : null);
const label = (type, instance) => (!instance || instance <= 1 ? type : `${type} ${instance}`);

const ADMISSION_COLS = new Set(['admissionnumber', 'admissionno', 'admno', 'adm', 'admission', 'admnumber', 'regno', 'registrationnumber']);
const CLASS_COLS     = new Set(['class', 'classname', 'form', 'level']);
const STREAM_COLS    = new Set(['stream', 'streamname']);
const IGNORED_COLS   = new Set([
  'name', 'studentname', 'fullname', 'firstname', 'middlename', 'lastname', 'surname', 'othernames',
  'gender', 'sex', 'sn', 'no', 'number', 'serial', '',
  'total', 'totalmarks', 'totalscore', 'average', 'avg', 'mean', 'meanscore', 'meangrade',
  'grade', 'position', 'pos', 'rank', 'points', 'remarks', 'remark', 'comment', 'comments',
]);

async function _canImport(req) {
  const roles = [req.jwtUser?.role, ...(req.jwtUser?.roles || [])];
  if (roles.some(r => r === 'admin' || r === 'superadmin')) return true;
  return hasExplicitSubGrant(req, 'grades', 'enter_marks', 'delete');
}
async function _guard(req, res) {
  if (await _canImport(req)) return true;
  E.forbidden(res, 'Importing past results needs an admin, or a role with full exam rights (Enter / Edit Marks with Delete).');
  return false;
}

/* ── Reads the sheet and works out everything the import would do ── */
async function _plan(req, body) {
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);
  const errors = [];
  const warnings = [];
  const fatal = (message) => ({ fatal: message });

  // Settings chosen on screen
  const academicYearId = String(body.academicYearId || '').trim();
  const termNumber     = Number(body.termNumber);
  const assessmentType = String(body.assessmentType || '').trim().toUpperCase();
  const instance       = body.instance == null || body.instance === '' ? 1 : Number(body.instance);
  const outOf          = body.outOf == null || body.outOf === '' ? 100 : Number(body.outOf);
  const onExisting     = body.onExisting === 'overwrite' ? 'overwrite' : 'skip';
  if (!academicYearId) return fatal('Choose the academic year these results belong to.');
  if (!Number.isInteger(termNumber) || termNumber < 1 || termNumber > 3) return fatal('Choose a term (1, 2 or 3).');
  if (!assessmentType) return fatal('Choose the assessment (e.g. End-Term).');
  if (!Number.isInteger(instance) || instance < 1 || instance > 10) return fatal('The assessment number must be between 1 and 10.');
  if (!(outOf > 0) || outOf > 1000) return fatal('"Marked out of" must be a number above 0.');

  const years = await tenantModel('academic_years', ctx).find({ schoolId }).lean();
  const year = years.find(y => yearIdOf(y) === academicYearId);
  if (!year) return fatal('That academic year was not found. Add it under Settings → Academics first.');
  if (await isYearArchived(schoolId, academicYearId)) {
    return fatal(`${year.name || 'This year'} is archived, so its marks are locked. Past results must be imported before a year is archived.`);
  }
  const terms = Array.isArray(year.terms) ? year.terms : [];
  if (terms.length && termNumber > terms.length) return fatal(`${year.name} has only ${terms.length} term(s).`);

  const { getConfig } = require('./assessment');
  // The school-wide setup — the same one report cards use (report-cards.js
  // _loadCaConfig), so imported assessments count on past report cards.
  const config = await getConfig(schoolId, null);
  const typeDef = (config.customTypes || []).find(t => String(t.key).toUpperCase() === assessmentType);
  if (!typeDef) {
    return fatal(`"${assessmentType}" is not one of the school's assessments (Exams → Configuration). Set up: ${(config.customTypes || []).map(t => t.label || t.key).join(', ') || 'none'}.`);
  }
  const maxInstances = Number(typeDef.instances) || 1;
  const weightWarning = !(Number(typeDef.weight) > 0)
    ? `${typeDef.label || assessmentType} carries 0% weight (Exams → Configuration), so these marks are stored but won't count on report cards.`
    : null;
  if (instance > maxInstances) return fatal(`${typeDef.label || assessmentType} is set up with ${maxInstances} per term, so number ${instance} doesn't exist.`);

  // The sheet
  let headers = [];
  let rows = [];
  if (typeof body.csv === 'string') {
    const text = body.csv.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(l => !/^\s*#/.test(l)).join('\n');
    const parsed = parseCSV(text);
    if (parsed.error) return fatal(parsed.error);
    headers = parsed.headers;
    rows = parsed.rows;
  } else if (Array.isArray(body.rows)) {
    rows = body.rows.filter(r => r && typeof r === 'object');
    headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  }
  if (!rows.length) return fatal('The file has no rows of results.');
  if (rows.length > MAX_ROWS) return fatal(`At most ${MAX_ROWS} students per file — split it (e.g. by class).`);

  // Columns
  const subjects = await tenantModel('subjects', ctx).find({ schoolId }).select('id _id name code shortName isActive').lean();
  // Heading → subject by name, code or short name. Active subjects win over
  // retired ones; two different active subjects on one heading is ambiguous.
  const subjectHits = new Map();
  for (const s of subjects) {
    for (const k of new Set([s.name, s.code, s.shortName].map(norm).filter(Boolean))) {
      subjectHits.set(k, [...(subjectHits.get(k) || []), s]);
    }
  }
  const subjectFor = (n) => {
    const all = subjectHits.get(n) || [];
    const active = all.filter(x => x.isActive !== false);
    const pool = active.length ? active : all;
    return pool.length === 1 ? { hit: pool[0] } : pool.length > 1 ? { ambiguous: pool } : {};
  };
  let admissionCol = null, classCol = null, streamCol = null;
  const subjectCols = [];
  const ignored = [];
  const unmatched = [];
  for (const h of headers) {
    const n = norm(h);
    if (!admissionCol && ADMISSION_COLS.has(n)) { admissionCol = h; continue; }
    if (!classCol && CLASS_COLS.has(n)) { classCol = h; continue; }
    if (!streamCol && STREAM_COLS.has(n)) { streamCol = h; continue; }
    const sf = subjectFor(n);
    if (sf.ambiguous) {
      warnings.push({ message: `Column "${h}" matches more than one subject (${sf.ambiguous.map(x => `${x.name} ${x.code || ''}`.trim()).join('; ')}) and was left out. Use the subject's code as the heading.` });
      continue;
    }
    const subj = sf.hit;
    if (subj && subjectCols.some(c => c.subjectId === idOf(subj))) {
      warnings.push({ message: `Columns "${subjectCols.find(c => c.subjectId === idOf(subj)).column}" and "${h}" are both ${subj.name}; only the first is used.` });
      continue;
    }
    if (subj) {
      subjectCols.push({ column: h, subjectId: idOf(subj), subjectName: subj.name });
      continue;
    }
    if (IGNORED_COLS.has(n)) { if (h) ignored.push(h); continue; }
    unmatched.push(h);
  }
  if (weightWarning) warnings.push({ message: weightWarning });
  if (!admissionCol) return fatal('The file needs an admission number column (e.g. "admissionNumber").');
  if (!subjectCols.length) return fatal('None of the columns match a subject. Use subject names or codes as column headings.');
  if (unmatched.length) warnings.push({ message: `Column(s) not matching any subject were left out: ${unmatched.join(', ')}. Add the subject in Subjects, or rename the column to its name or code.` });

  // Classes and streams
  const classes = await tenantModel('classes', ctx).find({ schoolId }).select('id _id name').lean();
  const classById = new Map(classes.map(c => [idOf(c), c]));
  const matchClass = makeMatcher(classes, c => c.name);
  const defaultClass = body.classId ? classById.get(String(body.classId)) : null;
  if (body.classId && !defaultClass) return fatal('The class picked on screen was not found.');
  if (!classCol && !defaultClass) return fatal('Pick the class, or add a "class" column to the file.');
  const streams = await tenantModel('streams', ctx).find({ schoolId }).select('id _id name classId').lean();

  // Students, any status
  const students = await tenantModel('students', ctx).find({ schoolId }).select('id _id admissionNumber firstName lastName status').lean();
  const matchStudent = makeMatcher(students, s => s.admissionNumber);

  // Row by row
  const marks = [];
  const history = [];
  const seenStudent = new Map();
  const states = {};
  rows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const adm = String(r[admissionCol] ?? '').trim();
    if (!adm) {
      if (subjectCols.some(c => String(r[c.column] ?? '').trim())) errors.push({ row: rowNo, message: 'Missing admission number.' });
      return;
    }
    const sm = matchStudent(adm);
    if (sm.ambiguous) {
      const who = sm.ambiguous.map(x => `${x.admissionNumber} ${x.firstName || ''} ${x.lastName || ''}`.trim()).join('; ');
      errors.push({ row: rowNo, message: `More than one student matches admission number ${adm} (${who}). Correct the duplicate admission numbers first.` });
      return;
    }
    const student = sm.hit;
    if (!student) { errors.push({ row: rowNo, message: `No student with admission number ${adm}. Import past students first (Students → Import, status "graduated" etc.).` }); return; }
    const studentId = idOf(student);
    if (seenStudent.has(studentId)) { errors.push({ row: rowNo, message: `${adm} is already on row ${seenStudent.get(studentId)}.` }); return; }
    seenStudent.set(studentId, rowNo);

    let cls = defaultClass;
    const classCell = classCol ? String(r[classCol] ?? '').trim() : '';
    if (classCell) {
      const cm = matchClass(classCell);
      if (cm.ambiguous) { errors.push({ row: rowNo, message: `More than one class is called "${classCell}". Rename one under Classes, or pick the class on screen and leave the class column out.` }); return; }
      cls = cm.hit || classById.get(classCell) || null;
    }
    if (!cls) { errors.push({ row: rowNo, message: classCell ? `No class called "${classCell}". Add it under Classes first.` : 'No class given.' }); return; }
    const classId = idOf(cls);

    let stream = null;
    const streamCell = streamCol ? String(r[streamCol] ?? '').trim() : '';
    if (streamCell) {
      stream = streams.find(s => s.classId === classId && (norm(s.name) === norm(streamCell) || idOf(s) === streamCell)) || null;
      if (!stream) warnings.push({ row: rowNo, message: `${cls.name} has no stream "${streamCell}" — imported without a stream.` });
    }

    const rowMarks = [];
    let bad = false;
    for (const c of subjectCols) {
      const raw = String(r[c.column] ?? '').trim();
      if (!raw || raw === '-') continue;
      const state = STATES[raw.toUpperCase()];
      if (state) { rowMarks.push({ subjectId: c.subjectId, markState: state, rawScore: null }); continue; }
      const v = Number(raw.replace(/%$/, ''));
      if (!Number.isFinite(v) || v < 0 || v > outOf) {
        errors.push({ row: rowNo, message: `${c.subjectName}: "${raw}" is not a score between 0 and ${outOf} (or ABS / MIS / EXM / INC).` });
        bad = true;
        break;
      }
      rowMarks.push({ subjectId: c.subjectId, markState: 'present', rawScore: Math.round((v / outOf) * 10000) / 100 });
    }
    if (bad) return;
    if (!rowMarks.length) { warnings.push({ row: rowNo, message: `${adm} has no marks on this row — skipped.` }); return; }
    for (const m of rowMarks) {
      if (m.markState !== 'present') states[m.markState] = (states[m.markState] || 0) + 1;
      marks.push({ ...m, studentId, classId, streamId: stream ? idOf(stream) : null, rowNo });
    }
    history.push({ studentId, academicYearId, classId, className: cls.name || '', streamId: stream ? idOf(stream) : null, streamName: stream?.name || null, rowNo });
  });
  if (marks.length > MAX_MARKS) return fatal(`This file holds ${marks.length} marks; the limit is ${MAX_MARKS}. Split it.`);

  // Against what is already stored — exact year only
  const studentIds = [...new Set(marks.map(m => m.studentId))];
  const existing = studentIds.length
    ? await tenantModel('assessment_marks', ctx).find({
      schoolId, academicYearId, termNumber, assessmentType, instance, studentId: { $in: studentIds },
    }).lean()
    : [];
  const existingByKey = new Map(existing.map(m => [`${m.studentId}|${m.subjectId}`, m]));
  let toCreate = 0, toOverwrite = 0, existingSkipped = 0, lockedSkipped = 0;
  for (const m of marks) {
    const prev = existingByKey.get(`${m.studentId}|${m.subjectId}`);
    if (!prev) { m.action = 'create'; toCreate++; continue; }
    if (prev.isLocked) { m.action = 'locked'; lockedSkipped++; continue; }
    if (onExisting !== 'overwrite') { m.action = 'keep'; existingSkipped++; continue; }
    m.action = 'overwrite'; m.prev = prev; toOverwrite++;
  }
  if (lockedSkipped) warnings.push({ message: `${lockedSkipped} mark(s) are locked by a published report card and will not be changed.` });

  const hist = await recordClassHistory(ctx, schoolId, history, { source: 'past_import', dryRun: true });
  // Older marks saved without a year would otherwise show in every year,
  // this past one included; the commit files them under their own year first.
  const untagged = await tagUntaggedMarks(tenantModel('assessment_marks', ctx), schoolId, years, { dryRun: true });
  const nameOf = new Map(students.map(s => [idOf(s), `${s.firstName || ''} ${s.lastName || ''}`.trim()]));
  for (const d of hist.differs) {
    const row = history.find(h => h.studentId === d.studentId)?.rowNo;
    warnings.push({ row, message: `${nameOf.get(d.studentId) || 'This student'} is already recorded in ${d.existingClassName || 'another class'} for ${year.name}; that stays as their class for the year, and these marks are filed under the class on this row.` });
  }

  return {
    settings: { academicYearId, yearName: year.name, termNumber, assessmentType, assessmentLabel: typeDef.label || assessmentType, instance, outOf, onExisting },
    columns: { subjects: subjectCols, ignored, unmatched, admission: admissionCol, class: classCol, stream: streamCol },
    rowsTotal: rows.length,
    studentsMatched: seenStudent.size,
    marks: { total: marks.length, toCreate, toOverwrite, existingSkipped, lockedSkipped, states },
    classHistory: { toRecord: hist.created, alreadyRecorded: hist.unchanged, differs: hist.differs.length },
    untaggedMarks: { toFile: untagged.tagged, left: untagged.left },
    _years: years,
    errors, warnings,
    _marks: marks, _history: history,
  };
}

function _public(plan) {
  const { _marks, _history, _years, ...rest } = plan;
  return { ...rest, errors: rest.errors.slice(0, 500), warnings: rest.warnings.slice(0, 500), errorCount: rest.errors.length, warningCount: rest.warnings.length };
}

/* ── GET /template?classId=&academicYearId= ─────────────────── */
router.get('/template', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    if (!(await _guard(req, res))) return;
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    const classId = String(req.query.classId || '');
    let subjectIds = [];
    let className = '';
    if (classId) {
      const cls = await tenantModel('classes', ctx).findOne({ schoolId, $or: [{ id: classId }, ...(/^[0-9a-f]{24}$/i.test(classId) ? [{ _id: classId }] : [])] }).select('name').lean();
      className = cls?.name || '';
      subjectIds = await tenantModel('class_subjects', ctx).distinct('subjectId', { schoolId, classId });
    }
    const subjFilter = subjectIds.length ? { schoolId, id: { $in: subjectIds } } : { schoolId, isActive: { $ne: false } };
    const subjects = await tenantModel('subjects', ctx).find(subjFilter).select('name code').sort({ name: 1 }).lean();
    // A past class's roster, when the year is known and history has it
    let roster = [];
    if (classId && req.query.academicYearId) {
      const hist = await tenantModel('student_class_history', ctx).find({ schoolId, academicYearId: String(req.query.academicYearId), classId }).select('studentId streamName').lean();
      if (hist.length) {
        const studs = await tenantModel('students', ctx).find({ schoolId, id: { $in: hist.map(h => h.studentId) } }).select('id admissionNumber firstName lastName').lean();
        const streamOf = new Map(hist.map(h => [h.studentId, h.streamName || '']));
        roster = studs.map(s => [s.admissionNumber || '', `${s.firstName || ''} ${s.lastName || ''}`.trim(), className, streamOf.get(s.id) || ''])
          .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      }
    }
    const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['admissionNumber', 'name', 'class', 'stream', ...subjects.map(s => s.name)];
    const lines = [head.map(esc).join(',')];
    for (const r of roster) lines.push([...r, ...subjects.map(() => '')].map(esc).join(','));
    const file = `past_results_${(className || 'class').replace(/[^a-z0-9]+/gi, '_')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    return res.send('﻿' + lines.join('\r\n') + '\r\n');
  } catch (err) {
    console.error('[past-results/template]', err);
    return E.serverError(res);
  }
});

/* ── POST /preview ──────────────────────────────────────────── */
router.post('/preview', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    if (!(await _guard(req, res))) return;
    const plan = await _plan(req, req.body || {});
    if (plan.fatal) return E.validation(res, plan.fatal);
    return ok(res, _public(plan));
  } catch (err) {
    console.error('[past-results/preview]', err);
    return E.serverError(res);
  }
});

/* ── POST /commit ───────────────────────────────────────────── */
router.post('/commit', authMiddleware, PLAN, MODGATE, rbac('grades', 'create'), async (req, res) => {
  try {
    if (!(await _guard(req, res))) return;
    const { schoolId, userId } = req.jwtUser;
    const ctx = tenantContext(req);
    const plan = await _plan(req, req.body || {});
    if (plan.fatal) return E.validation(res, plan.fatal);
    const s = plan.settings;
    const writes = plan._marks.filter(m => m.action === 'create' || m.action === 'overwrite');
    if (!writes.length) return E.validation(res, 'Nothing to import — every mark in the file is already stored, locked, or has a problem.');

    // Older marks without a year: file them under their own year before
    // anything is added to a past one (see utils/untagged-marks.js).
    const filed = await tagUntaggedMarks(tenantModel('assessment_marks', ctx), schoolId, plan._years);

    const batchId = uuidv4();
    const now = new Date().toISOString();
    const Marks = tenantModel('assessment_marks', ctx);
    const lbl = label(s.assessmentType, s.instance);
    const ops = writes.map(m => {
      const base = { rawScore: m.rawScore, markState: m.markState, classId: m.classId, streamId: m.streamId, label: lbl, isPublished: true, source: 'past_import', importBatchId: batchId, importedAt: now, updatedBy: userId, updatedAt: now };
      if (m.action === 'overwrite') {
        return {
          updateOne: {
            filter: { schoolId, id: m.prev.id, isLocked: { $ne: true } },
            update: {
              $set: {
                ...base,
                importV: (Number(m.prev._v) || 0) + 1,
                importPrev: { rawScore: m.prev.rawScore ?? null, markState: m.prev.markState || 'present', classId: m.prev.classId || null, streamId: m.prev.streamId ?? null, label: m.prev.label || null, source: m.prev.source || null, importBatchId: m.prev.importBatchId || null, updatedBy: m.prev.updatedBy || null },
              },
              $inc: { _v: 1 },
            },
          },
        };
      }
      return {
        updateOne: {
          filter: { schoolId, studentId: m.studentId, subjectId: m.subjectId, termNumber: s.termNumber, assessmentType: s.assessmentType, instance: s.instance, academicYearId: s.academicYearId },
          update: { $set: { ...base, importV: 0 }, $setOnInsert: { id: uuidv4(), schoolId, createdBy: userId, createdAt: now, _v: 0 } },
          upsert: true,
        },
      };
    });
    let created = 0, replaced = 0;
    for (let i = 0; i < ops.length; i += 1000) {
      const r = await Marks.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      created  += r.upsertedCount || 0;
      replaced += r.modifiedCount || 0;
    }
    const hist = await recordClassHistory(ctx, schoolId, plan._history, { source: 'past_import', importBatchId: batchId, userId });

    const summary = {
      created, replaced,
      existingSkipped: plan.marks.existingSkipped, lockedSkipped: plan.marks.lockedSkipped,
      studentsMatched: plan.studentsMatched, rowsWithProblems: plan.errors.length,
      classHistoryRecorded: hist.created,
      olderMarksFiled: filed.tagged,
    };
    await tenantModel('past_result_imports', ctx).create({
      id: batchId, schoolId, ...s,
      subjects: plan.columns.subjects.map(c => ({ subjectId: c.subjectId, subjectName: c.subjectName })),
      fileName: String(req.body.fileName || '').slice(0, 200) || null,
      counts: summary, status: 'imported', createdBy: userId, createdAt: now,
    });
    AuditService.log({
      action: 'grades.past_results_imported', actor: req.jwtUser, schoolId, req,
      target: { type: 'import', id: batchId, label: `${s.yearName} · Term ${s.termNumber} · ${s.assessmentLabel}${s.instance > 1 ? ` ${s.instance}` : ''}` },
      details: summary,
    });
    return ok(res, { batchId, ..._public(plan), result: summary });
  } catch (err) {
    console.error('[past-results/commit]', err);
    return E.serverError(res);
  }
});

/* ── GET /batches ───────────────────────────────────────────── */
router.get('/batches', authMiddleware, PLAN, MODGATE, rbac('grades', 'read'), async (req, res) => {
  try {
    if (!(await _guard(req, res))) return;
    const { schoolId } = req.jwtUser;
    const rows = await tenantModel('past_result_imports', tenantContext(req)).find({ schoolId }).sort({ createdAt: -1 }).limit(100).lean();
    return ok(res, rows.map(({ _id, __v, ...r }) => r));
  } catch (err) {
    console.error('[past-results/batches]', err);
    return E.serverError(res);
  }
});

/* ── POST /batches/:id/undo ─────────────────────────────────── */
router.post('/batches/:id/undo', authMiddleware, PLAN, MODGATE, rbac('grades', 'delete'), async (req, res) => {
  try {
    if (!(await _guard(req, res))) return;
    const { schoolId, userId } = req.jwtUser;
    const ctx = tenantContext(req);
    const Batches = tenantModel('past_result_imports', ctx);
    const batch = await Batches.findOne({ schoolId, id: req.params.id }).lean();
    if (!batch) return E.notFound(res, 'Import not found');
    if (batch.status === 'undone') return fail(res, 'ALREADY_UNDONE', 'This import has already been undone.', 409);
    if (await isYearArchived(schoolId, batch.academicYearId)) {
      return fail(res, 'YEAR_ARCHIVED', 'That year has been archived, so its marks can no longer change.', 409);
    }

    const Marks = tenantModel('assessment_marks', ctx);
    const mine = await Marks.find({ schoolId, importBatchId: batch.id }).lean();
    // A mark someone has changed since the import (Markbook save bumps _v;
    // any later write moves updatedAt) is theirs now — undo leaves it.
    const changedSince = (m) => {
      if (m.importV != null && Number(m._v ?? 0) !== Number(m.importV)) return true;
      const at = m.importedAt ? new Date(m.importedAt).getTime() : NaN;
      const up = m.updatedAt ? new Date(m.updatedAt).getTime() : NaN;
      return Number.isFinite(at) && Number.isFinite(up) && up - at > 5000;
    };
    const locked  = mine.filter(m => m.isLocked);
    const changed = mine.filter(m => !m.isLocked && changedSince(m));
    const restore = mine.filter(m => !m.isLocked && !changedSince(m) && m.importPrev);
    const remove  = mine.filter(m => !m.isLocked && !changedSince(m) && !m.importPrev);
    const now = new Date().toISOString();
    const ops = [
      ...restore.map(m => {
        const p = m.importPrev;
        const $set = { rawScore: p.rawScore, markState: p.markState, classId: p.classId, streamId: p.streamId, label: p.label, updatedBy: userId, updatedAt: now };
        const $unset = { importPrev: '', importV: '', importedAt: '' };
        if (p.source) $set.source = p.source; else $unset.source = '';
        if (p.importBatchId) $set.importBatchId = p.importBatchId; else $unset.importBatchId = '';
        return { updateOne: { filter: { schoolId, id: m.id }, update: { $set, $unset, $inc: { _v: 1 } } } };
      }),
      ...remove.map(m => ({ deleteOne: { filter: { schoolId, id: m.id, isLocked: { $ne: true } } } })),
    ];
    for (let i = 0; i < ops.length; i += 1000) await Marks.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    // A student whose marks stay (locked or changed since) keeps the class too.
    const keptStudents = [...new Set([...locked, ...changed].map(m => m.studentId))];
    const histRes = await tenantModel('student_class_history', ctx).deleteMany({ schoolId, importBatchId: batch.id, ...(keptStudents.length ? { studentId: { $nin: keptStudents } } : {}) });
    const result = { removed: remove.length, restored: restore.length, lockedKept: locked.length, changedKept: changed.length, classHistoryRemoved: histRes?.deletedCount ?? 0 };
    await Batches.updateOne({ schoolId, id: batch.id }, { $set: { status: 'undone', undoneBy: userId, undoneAt: now, undoResult: result } });
    AuditService.log({
      action: 'grades.past_results_import_undone', actor: req.jwtUser, schoolId, req,
      target: { type: 'import', id: batch.id, label: `${batch.yearName} · Term ${batch.termNumber} · ${batch.assessmentLabel}` },
      details: result,
    });
    return ok(res, result);
  } catch (err) {
    console.error('[past-results/undo]', err);
    return E.serverError(res);
  }
});

/* ── GET /class-history?studentId=  |  ?academicYearId=&classId= ── */
router.get('/class-history', authMiddleware, rbac('students', 'read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const ctx = tenantContext(req);
    const filter = { schoolId };
    if (req.query.studentId) filter.studentId = String(req.query.studentId);
    else if (req.query.academicYearId && req.query.classId) { filter.academicYearId = String(req.query.academicYearId); filter.classId = String(req.query.classId); }
    else return E.badRequest(res, 'Give a studentId, or an academicYearId and classId.');
    const rows = await tenantModel('student_class_history', ctx).find(filter).limit(5000).lean();
    const years = await tenantModel('academic_years', ctx).find({ schoolId }).select('id _id name startDate').lean();
    const yearById = new Map(years.map(y => [yearIdOf(y), y]));
    const out = rows.map(({ _id, __v, ...r }) => ({ ...r, yearName: yearById.get(r.academicYearId)?.name || '', yearStart: yearById.get(r.academicYearId)?.startDate || '' }))
      .sort((a, b) => String(b.yearStart).localeCompare(String(a.yearStart)));
    return ok(res, out);
  } catch (err) {
    console.error('[past-results/class-history]', err);
    return E.serverError(res);
  }
});

module.exports = router;
module.exports._plan = _plan;
