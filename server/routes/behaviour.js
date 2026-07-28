/* ============================================================
   Msingi — /api/behaviour  (Behaviour & Pastoral)
   Sub-routes:
     /api/behaviour/incidents      — incident log
     /api/behaviour/appeals        — appeal log
     /api/behaviour/categories     — school behaviour categories (CRUD)
     /api/behaviour/officer-config — assignable "Behaviour Officer" role
   Plan: standard | RBAC: behaviour:{read,create,update,delete}, OR the
   assigned Behaviour Officer (see behaviourAccess() below) — being
   assigned grants full access regardless of the assignee's base role.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const AuditService = require('../services/audit');
const { notifyGuardiansForStudents } = require('../utils/notify-students');
const email = require('../utils/email');
const { _model } = require('../utils/model');
const { resolveAcademicPeriod } = require('../utils/academic-period');
const { getWorkflowConfig, saveWorkflowConfig, resolveStep } = require('../utils/workflow-config');

const router = express.Router();
const PLAN   = planGate('behaviour');
const MODGATE = moduleGate('behaviour');

const OFFICER_WORKFLOW_KEY = 'behaviour_officer';

/* Is this user the currently-assigned Behaviour Officer? Reuses the
   same {assigneeType:'role'|'user', assigneeValue} + resolveStep()
   primitive HR/payroll/report-card approval chains already use
   (server/utils/workflow-config.js), rather than the hardcoded
   exams_officer pattern — that one is baked into RBAC checks/arrays
   throughout the codebase and isn't actually school-configurable. */
async function _isBehaviourOfficer(schoolId, ctx, userId) {
  if (!userId) return false;
  const cfg = await getWorkflowConfig(ctx, schoolId, OFFICER_WORKFLOW_KEY);
  const steps = cfg?.steps ?? [];
  for (const step of steps) {
    const candidates = await resolveStep(ctx, schoolId, step);
    if (candidates.some(u => u.id === userId)) return true;
  }
  return false;
}

/* Drop-in replacement for rbac('behaviour', action): the assigned
   Behaviour Officer passes through unconditionally (confirmed with
   the requester — assignment itself grants full access, not just a
   label); everyone else falls through to the normal role_permissions
   check exactly as before. A failure resolving the officer config
   never blocks access — it just skips the bypass and defers to the
   existing rbac check, same fail-safe posture as every other
   best-effort lookup in this codebase. */
function behaviourAccess(action) {
  const fallback = rbac('behaviour', action);
  return async (req, res, next) => {
    try {
      const { schoolId, userId } = req.jwtUser || {};
      if (schoolId && userId && await _isBehaviourOfficer(schoolId, tenantContext(req), userId)) {
        return next();
      }
    } catch (err) {
      console.error('[behaviour] officer-access check failed, falling back to role_permissions:', err.message);
    }
    return fallback(req, res, next);
  };
}

/* ── Validation schemas ─────────────────────────────────────── */
const IncidentSchema = z.object({
  studentId:    z.string().min(1),
  classId:      z.string().optional(),
  reportedBy:   z.string().optional(),          // userId of reporter; overridden by JWT
  categoryId:   z.string().optional(),
  category:     z.string().max(100).optional(), // denormalized category name for display, same convention as library loans' bookTitle
  itemId:       z.string().optional(),           // the specific item within the category that was awarded
  itemLabel:    z.string().max(200).optional(),   // denormalized item label, same convention as category above
  academicYearId: z.string().optional(),
  termId:       z.string().optional(),
  type:         z.enum(['merit', 'demerit', 'neutral']).default('demerit'),
  severity:     z.enum(['low', 'medium', 'high', 'critical']).optional(),
  title:        z.string().min(1).max(200),
  description:  z.string().max(3000).optional(),
  points:       z.number().int().min(-100).max(100).default(0),
  date:         z.string().optional(),          // ISO date; defaults to today
  location:     z.string().max(100).optional(),
  witnesses:    z.array(z.string()).optional(),  // userIds
  action:       z.string().max(1000).optional(), // action taken
  note:         z.string().max(1000).optional(), // teacher note on incident
  detention:    z.boolean().default(false),
  detentionDate: z.string().optional(),
  parentNotified: z.boolean().default(false),
  status:       z.enum(['open', 'resolved', 'escalated', 'appealed']).default('open'),
});

const AppealSchema = z.object({
  incidentId:   z.string().min(1),
  studentId:    z.string().min(1),
  reason:       z.string().min(1).max(3000),
  submittedBy:  z.string().optional(),
  outcome:      z.enum(['pending', 'upheld', 'overturned', 'partial']).default('pending'),
  reviewedBy:   z.string().optional(),
  reviewNotes:  z.string().max(3000).optional(),
  reviewedAt:   z.string().optional(),
});

/* A category is a named grouping (e.g. "Classroom & Academic") that
   holds its own list of items — each item is a specific, individually
   named behaviour with its own points value and its own merit/demerit
   direction (a category is not itself "merit" or "demerit"; its items
   are, one at a time). Fully school-editable at both levels: schools
   add/edit/delete items within a category, and add/edit/delete whole
   categories. Points are stored as positive magnitudes on the item —
   the sign is applied by the item's own direction. */
const CategoryItemSchema = z.object({
  id:          z.string().optional(), // assigned server-side for new items
  label:       z.string().min(1).max(200).trim(),
  direction:   z.enum(['merit', 'demerit']),
  points:      z.number().int().min(0).max(100),
  description: z.string().max(500).optional(),
});

const CategorySchema = z.object({
  name:        z.string().min(1).max(150).trim(),
  description: z.string().max(500).optional(),
  colour:      z.string().optional(),
  isActive:    z.boolean().default(true),
  items:       z.array(CategoryItemSchema).max(80).default([]),
});

/* Seed data — the full St. Austin's Academy Behaviour Point System v2
   item set (Sections 5–12), restored verbatim with its original point
   values as the default a new school starts from. Every item remains
   fully editable/deletable per school, and schools may add further
   items or entire categories on top of this default set. */
const _mi = (label, points) => ({ label, direction: 'merit', points });
const _di = (label, points) => ({ label, direction: 'demerit', points });

const DEFAULT_CATEGORIES = [
  {
    name: 'Classroom & Academic',
    description: 'Academic engagement, homework, and classroom conduct.',
    items: [
      _mi('Outstanding contribution to class discussion', 2),
      _mi('Full and focused engagement throughout the lesson', 1),
      _mi('Exceptional quality of written or practical work', 3),
      _mi('Consistent homework completion over a full week', 2),
      _mi('Helping a peer understand a concept without being asked', 2),
      _mi('Creative or innovative approach to a task or project', 3),
      _mi('Taking intellectual risk — answering a challenge question', 2),
      _mi('Outstanding Global Perspectives research or presentation', 4),
      _mi('Achieving a personal best in a class assessment', 3),
      _mi('Demonstrating Cambridge learner attributes in project work', 2),
      _mi('Submitting work ahead of deadline, well-presented', 1),
      _mi('Asking a deep, enquiry-based question in class', 1),
      _di('Arriving late to class without a valid reason', 1),
      _di('Unprepared for lesson (no books, equipment)', 1),
      _di('Off-task, disengaged, or disrupting others', 2),
      _di('Eating or drinking in class without permission', 1),
      _di('Leaving class without permission', 2),
      _di('Incomplete homework (first instance)', 1),
      _di('Persistent refusal to engage in learning', 3),
      _di('Writing on or defacing school materials', 2),
      _di('Academic dishonesty (copying, plagiarism)', 5),
      _di('Cheating in a formal test or exam', 8),
    ],
  },
  {
    name: 'Corridors, Common Areas & Transitions',
    description: 'Movement between lessons and behaviour in shared building spaces.',
    items: [
      _mi('Holding door open or assisting a staff member without being asked', 2),
      _mi('Picking up litter without being asked', 2),
      _mi('Representing SAA with pride and courtesy to a visitor', 3),
      _mi('Maintaining calm, purposeful movement between lessons', 1),
      _mi('Supporting a peer who appears upset or lost', 3),
      _mi('Reporting a safety hazard or concern to a staff member', 2),
      _di('Running in corridors or stairwells', 1),
      _di('Shouting, excessive noise in corridors', 1),
      _di('Pushing, jostling, or rough play in corridors', 2),
      _di('Loitering in restricted areas without permission', 1),
      _di('Littering in corridors, stairwells or open areas', 2),
      _di('Defacing walls, doors or noticeboards', 4),
      _di('Vandalism of school property', 8),
      _di('Entering out-of-bounds or restricted areas', 2),
    ],
  },
  {
    name: 'Sports, PE & Extracurricular',
    description: 'Sports field, PE lessons, and extracurricular club activity.',
    items: [
      _mi('Demonstrating sportsmanship, fair play and encouragement to teammates', 3),
      _mi('Outstanding effort in PE — showing determination beyond ability level', 2),
      _mi('Representing the school in a sports competition', 5),
      _mi('Scoring a notable achievement in inter-school competition', 4),
      _mi('Leading a warm-up, team activity, or drill when invited', 2),
      _mi('Consistently attending and contributing to an extracurricular club', 2),
      _mi('Organising or helping to run a school event or club activity', 4),
      _mi('Supporting a teammate who is struggling during activity', 2),
      _mi('Mentoring a junior student in a sport or activity (KS5)', 4),
      _di('Repeated failure to bring PE kit without valid reason', 2),
      _di('Unsportsmanlike conduct — taunting, mocking peers', 3),
      _di('Dangerous play — deliberately fouling or rough play', 4),
      _di('Refusing to follow coach or teacher instructions during activity', 3),
      _di('Causing deliberate injury to another student during activity', 8),
      _di('Leaving the school premises during an extracurricular activity without permission', 5),
      _di('Using a sports field or equipment dangerously without supervision', 2),
      _di('Abusing or damaging sports equipment', 4),
    ],
  },
  {
    name: 'Interpersonal Relationships',
    description: 'Conduct and character in relationships with peers and staff.',
    items: [
      _mi('Resolving a disagreement calmly and respectfully without staff intervention', 3),
      _mi('Standing up for a peer who is being excluded or treated unfairly', 4),
      _mi('Welcoming and supporting a new student', 3),
      _mi('Showing consistent kindness and consideration across the week', 2),
      _mi('Proactively reporting a safeguarding or welfare concern for a peer', 3),
      _mi('Acting as peer mentor or tutor for a younger or struggling student', 4),
      _mi('Treating all members of staff and visitors with consistent courtesy', 2),
      _mi('Contributing positively to a group project, supporting all team members', 2),
      _mi('Demonstrating empathy during a personal or community difficulty', 3),
      _di('Rude, dismissive or disrespectful language to a peer', 2),
      _di('Rude, dismissive or disrespectful language to a staff member', 4),
      _di('Deliberate exclusion or social isolation of a peer', 3),
      _di('Low-level verbal bullying (name-calling, mockery)', 4),
      _di('Sustained or repeated bullying (verbal, social, relational)', 10),
      _di('Physical aggression (pushing, shoving — not causing injury)', 5),
      _di('Physical assault causing injury', 15),
      _di('Threatening behaviour or intimidation', 10),
      _di('Cyberbullying or online harassment of a peer', 10),
      _di('Public display of romantic affection', 2),
      _di('Discrimination based on race, gender, religion, or background', 15),
      _di('Theft from a peer or the school', 10),
    ],
  },
  {
    name: 'School Rules, Safety & Property',
    description: 'Attendance, punctuality, uniform, and school property.',
    items: [
      _mi('Full term of 100% punctuality (no late arrivals)', 5),
      _mi('Consistent, exemplary uniform standard over a full term', 3),
      _mi('Reporting a safety hazard or damaged property immediately', 2),
      _mi('Looking after and returning borrowed school equipment in excellent condition', 2),
      _mi('Perfect attendance for a full term', 5),
      _mi('Representing SAA with outstanding conduct on an off-site trip', 4),
      _mi('Showing care for shared spaces — clearing tables, returning chairs', 1),
      _mi('Helping to set up or clear away for a school event', 3),
      _di('Arriving late to school without valid reason or communication', 1),
      _di('Unauthorised absence from school', 3),
      _di('Uniform non-compliance (minor — untucked shirt, wrong shoes)', 1),
      _di('Persistent uniform non-compliance after prior warnings', 3),
      _di('Chewing gum on school premises', 1),
      _di('Littering on school grounds', 2),
      _di('Using a mobile phone during class time (KS3/4)', 2),
      _di('Using a mobile phone during class (KS5 — after warning)', 1),
      _di('Bringing a prohibited item to school', 4),
      _di('Misuse of school digital platforms or school internet', 4),
      _di('Leaving school premises without an authorised exit slip', 3),
      _di('Running in or around the school building', 1),
      _di('Playing in wet or hazardous conditions on the field', 2),
      _di('Substance use (alcohol, cigarettes, vaping) on premises', 15),
      _di('Possession of dangerous items or weapons', 15),
    ],
  },
  {
    name: 'Dining Hall & Shared Spaces',
    description: 'Dining hall, tuck shop, and other shared spaces.',
    items: [
      _mi('Queuing patiently and allowing younger students to go first', 2),
      _mi('Clearing table, returning tray and leaving area tidy without being asked', 2),
      _mi('Polite and patient when speaking to dining staff', 1),
      _mi('Assisting a student who has difficulty carrying food or accessing the queue', 2),
      _di('Queue jumping or aggressive queuing behaviour', 2),
      _di('Eating or drinking in class or corridors', 1),
      _di('Leaving dining area untidy deliberately', 2),
      _di('Wasting food deliberately', 1),
      _di('Ordering food from outside school without SLT permission', 2),
      _di('Talking to or soliciting from strangers or visitors at the gate', 3),
    ],
  },
  {
    name: 'Digital Citizenship & Technology',
    description: 'Responsible and irresponsible use of school and personal technology.',
    items: [
      _mi('Using school platforms responsibly and helping a peer navigate them', 2),
      _mi('Citing AI tools or online sources correctly and transparently in work', 2),
      _mi('Reporting inappropriate digital content or cyberbullying to a staff member', 3),
      _mi('Producing a creative digital project beyond minimum requirements', 3),
      _mi('Demonstrating responsible use of technology during a class project', 2),
      _di('Using personal device for non-academic purposes during lessons', 2),
      _di('Accessing inappropriate websites on school network', 4),
      _di('Recording staff or students without consent on personal device', 5),
      _di("Sharing another student's image or video without consent (online)", 8),
      _di('Cyberbullying (also listed under Interpersonal Relationships)', 10),
      _di("Intentionally bypassing the school's internet filter or firewall", 5),
      _di('Using AI tools dishonestly to submit unacknowledged AI-generated work', 5),
    ],
  },
  {
    name: 'Leadership & Community Service',
    description: 'Merit-only — the highest expressions of school and community contribution. There is no demerit side; a voluntary role simply goes unearned if not fulfilled.',
    items: [
      _mi('Elected or appointed to a school leadership role (Head Boy/Girl, House Captain, Council)', 10),
      _mi('Organising or leading a successful school event or charity initiative', 6),
      _mi('Completing a structured community service project', 8),
      _mi('Leading a presentation at assembly or school event', 4),
      _mi('Serving as a Student Ambassador or school tour guide for visitors', 4),
      _mi('Contributing to the school newsletter, magazine or social media responsibly', 3),
      _mi('Achieving a notable result in a national or international competition', 8),
      _mi('Completing the term as a Sixth Form Peer Mentor (KS5)', 6),
      _mi('Initiating an environmental or sustainability project', 6),
    ],
  },
];

/* Auto-provisions the default category+item set the first time a
   school has none — idempotent (only inserts when the count is
   genuinely zero), same "seed once, then fully hands-off" posture as
   demo data $setOnInsert patterns elsewhere. A school that deletes
   down to zero categories on purpose will get them reseeded on next
   read; that's an acceptable edge case for a picker catalogue, not a
   data-loss risk since categories/items carry no incident history
   themselves (incidents copy the label/points they used at the time). */
async function _ensureDefaultCategories(schoolId, ctx, userId) {
  const Categories = tenantModel('behaviour_categories', ctx);
  const count = await Categories.countDocuments({ schoolId });
  if (count > 0) return;
  await Categories.insertMany(DEFAULT_CATEGORIES.map(c => ({
    ...c,
    items: c.items.map(it => ({ ...it, id: uuidv4() })),
    id: uuidv4(), schoolId, isActive: true, createdBy: userId || 'system', updatedBy: userId || 'system',
  })));
}

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   INCIDENTS
   ══════════════════════════════════════════════════════════════ */

router.get('/incidents', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _sid = strParam(req.query.studentId);
    const _cid = strParam(req.query.classId);
    const _typ = strParam(req.query.type);
    const _st  = strParam(req.query.status);
    const _sev = strParam(req.query.severity);
    const _cat = strParam(req.query.categoryId);
    if (_sid) filter.studentId  = _sid;
    if (_cid) filter.classId    = _cid;
    if (_typ) filter.type       = _typ;
    if (_st)  filter.status     = _st;
    if (_sev) filter.severity   = _sev;
    if (_cat) filter.categoryId = _cat;
    if (req.query.detention === 'true') filter.detention = true;

    const _df = strParam(req.query.dateFrom);
    const _dt = strParam(req.query.dateTo);
    if (_df || _dt) {
      filter.date = {};
      if (_df) filter.date.$gte = _df;
      if (_dt) filter.date.$lte = _dt;
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { description: rx }];
    }

    const Incidents = tenantModel('behaviour_incidents', tenantContext(req));
    const [docs, total] = await Promise.all([
      Incidents.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Incidents.countDocuments(filter)
    ]);

    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[behaviour/incidents GET]', err); return E.serverError(res); }
});

/* Governance Spec §2 — a points reset never touches incident history;
   it just moves the floor the running total is computed from. Shared
   by /incidents/summary and /points-reset/latest so both surfaces
   (student totals, house totals) agree on the same floor. */
async function _lastResetDate(schoolId, ctx) {
  const lastReset = await tenantModel('behaviour_points_resets', ctx)
    .find({ schoolId }).sort({ resetAt: -1 }).limit(1).lean();
  return lastReset[0]?.resetAt ?? null;
}

/* GET /api/behaviour/points-reset/latest — the date HousesTab and any
   other all-time client-side aggregation should filter from, so house
   points follow the same yearly cycle as individual student totals
   instead of accumulating forever. */
router.get('/points-reset/latest', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const resetAt = await _lastResetDate(schoolId, tenantContext(req));
    return ok(res, { resetAt });
  } catch (err) { console.error('[behaviour/points-reset/latest GET]', err); return E.serverError(res); }
});

router.get('/incidents/summary', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const filter = { schoolId };
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.classId)   filter.classId   = req.query.classId;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {};
      if (req.query.dateFrom) filter.date.$gte = req.query.dateFrom;
      if (req.query.dateTo)   filter.date.$lte = req.query.dateTo;
    } else {
      const resetAt = await _lastResetDate(schoolId, tenantContext(req));
      if (resetAt) filter.date = { $gte: resetAt.slice(0, 10) };
    }

    const Incidents = tenantModel('behaviour_incidents', tenantContext(req));
    const summary = await Incidents.aggregate([
      { $match: filter },
      { $group: {
        _id:      '$studentId',
        merits:   { $sum: { $cond: [{ $eq: ['$type', 'merit'] }, 1, 0] } },
        demerits: { $sum: { $cond: [{ $eq: ['$type', 'demerit'] }, 1, 0] } },
        points:   { $sum: '$points' },
        total:    { $sum: 1 },
      }},
      { $sort: { points: -1 } }
    ]);
    return ok(res, summary);
  } catch (err) { console.error('[behaviour/incidents/summary]', err); return E.serverError(res); }
});

router.get('/incidents/:id', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('behaviour_incidents', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Incident not found');
    return ok(res, doc);
  } catch (err) { console.error('[behaviour/incidents GET/:id]', err); return E.serverError(res); }
});

router.post('/incidents', authMiddleware, PLAN, MODGATE, behaviourAccess('create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(IncidentSchema, req.body);
    if (error) return E.validation(res, error);

    const period = await resolveAcademicPeriod(schoolId, tenantContext(req), { academicYearId: data.academicYearId, termId: data.termId });
    if (period.error) return E.badRequest(res, period.error);
    data.academicYearId = period.academicYearId;
    data.termId          = period.termId;

    const doc = await tenantModel('behaviour_incidents', tenantContext(req)).create({
      ...data,
      id:          uuidv4(),
      schoolId,
      reportedBy:  userId,
      date:        data.date || new Date().toISOString().slice(0, 10),
      createdBy:   userId,
      updatedBy:   userId,
    });
    const plain = doc.toObject ? doc.toObject() : doc;

    _notifyGuardians(req, plain).catch(err => console.error('[behaviour/incidents notify]', err));

    return created(res, plain);
  } catch (err) { console.error('[behaviour/incidents POST]', err); return E.serverError(res); }
});

/* Notify the incident's student's parent(s)/guardian(s) — school-configured
   channel + frequency (Governance-style: reuses the same real dispatch
   mechanism every future event wires into, not a bespoke one-off). */
async function _notifyGuardians(req, incident) {
  const { schoolId } = req.jwtUser;
  const ctx = tenantContext(req);

  const [student, school] = await Promise.all([
    tenantModel('students', ctx).findOne({ id: incident.studentId, schoolId }).select('firstName lastName').lean(),
    _model('schools').findOne({ id: schoolId }).select('name systemEmail').lean(),
  ]);
  if (!student) return;
  const studentName = `${student.firstName} ${student.lastName}`;
  const schoolName  = school?.name || '';
  const schoolEmail = school?.systemEmail || '';

  await notifyGuardiansForStudents({
    ctx, schoolId, eventKey: 'behaviour_incident',
    items: [{
      studentId: incident.studentId,
      inAppSubject: `Behaviour incident logged for ${studentName}`,
      inAppBody:    `${incident.type} — ${incident.title}${incident.description ? `: ${incident.description}` : ''}`,
      emailDigestSubject: `Behaviour incident — ${studentName}`,
      emailDigestBody:    `${incident.type}: ${incident.title}`,
      sendEmail: (recipient) => email.sendBehaviourIncidentAlert({
        recipientName: recipient.name, recipientEmail: recipient.email,
        studentName, type: incident.type, title: incident.title,
        description: incident.description, points: incident.points,
        schoolName, schoolEmail, schoolId,
      }),
    }],
  });
}

router.put('/incidents/:id', authMiddleware, PLAN, MODGATE, behaviourAccess('update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(IncidentSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const Incidents = tenantModel('behaviour_incidents', tenantContext(req));

    if (data.academicYearId !== undefined || data.termId !== undefined) {
      const existing = await Incidents.findOne({ id: req.params.id, schoolId }).lean();
      if (!existing) return E.notFound(res, 'Incident not found');
      const period = await resolveAcademicPeriod(schoolId, tenantContext(req), {
        academicYearId: data.academicYearId !== undefined ? data.academicYearId : existing.academicYearId,
        termId:         data.termId         !== undefined ? data.termId         : existing.termId,
      });
      if (period.error) return E.badRequest(res, period.error);
      data.academicYearId = period.academicYearId;
      data.termId          = period.termId;
    }

    const doc = await Incidents.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Incident not found');
    return ok(res, doc);
  } catch (err) { console.error('[behaviour/incidents PUT/:id]', err); return E.serverError(res); }
});

router.delete('/incidents/:id', authMiddleware, PLAN, MODGATE, behaviourAccess('delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await tenantModel('behaviour_incidents', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { status: 'resolved', deletedAt: new Date().toISOString(), deletedBy: userId },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Incident not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[behaviour/incidents DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   APPEALS
   ══════════════════════════════════════════════════════════════ */

router.get('/appeals', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { schoolId };
    if (req.query.studentId)  filter.studentId  = req.query.studentId;
    if (req.query.incidentId) filter.incidentId = req.query.incidentId;
    if (req.query.outcome)    filter.outcome    = req.query.outcome;

    const Appeals = tenantModel('behaviour_appeals', tenantContext(req));
    const [docs, total] = await Promise.all([
      Appeals.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Appeals.countDocuments(filter)
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[behaviour/appeals GET]', err); return E.serverError(res); }
});

router.post('/appeals', authMiddleware, PLAN, MODGATE, behaviourAccess('create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AppealSchema, req.body);
    if (error) return E.validation(res, error);

    // Verify incident exists and belongs to this school
    const incident = await tenantModel('behaviour_incidents', tenantContext(req)).findOne({ id: data.incidentId, schoolId }).lean();
    if (!incident) return E.notFound(res, 'Incident not found');

    const doc = await tenantModel('behaviour_appeals', tenantContext(req)).create({
      ...data,
      id:          uuidv4(),
      schoolId,
      submittedBy: userId,
      createdBy:   userId,
      updatedBy:   userId,
    });

    // Mark incident as appealed
    await tenantModel('behaviour_incidents', tenantContext(req)).updateOne({ id: data.incidentId }, { status: 'appealed' });

    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[behaviour/appeals POST]', err); return E.serverError(res); }
});

router.put('/appeals/:id', authMiddleware, PLAN, MODGATE, behaviourAccess('update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(AppealSchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;

    const doc = await tenantModel('behaviour_appeals', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, reviewedBy: userId, reviewedAt: new Date().toISOString(), updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Appeal not found');

    // If outcome resolved, update incident status based on appeal decision
    if (data.outcome && data.outcome !== 'pending') {
      // 'overturned' → incident cleared/dismissed; 'upheld' → incident remains closed
      const newStatus = data.outcome === 'overturned' ? 'overturned' : 'closed';
      await tenantModel('behaviour_incidents', tenantContext(req)).updateOne(
        { id: doc.incidentId },
        { status: newStatus, appealOutcome: data.outcome }
      );
    }

    return ok(res, doc);
  } catch (err) { console.error('[behaviour/appeals PUT/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   CATEGORIES  (school-defined behaviour categories)
   ══════════════════════════════════════════════════════════════ */

router.get('/categories', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    await _ensureDefaultCategories(schoolId, tenantContext(req), userId);

    const filter = { schoolId };
    if (req.query.isActive) filter.isActive = req.query.isActive === 'true';
    // ?direction=merit|demerit — only categories that contain at least
    // one item of that direction (used by the Award Points picker once
    // a direction is chosen); the client still filters each category's
    // own items down to that direction before showing the item list.
    if (req.query.direction === 'merit' || req.query.direction === 'demerit') {
      filter['items.direction'] = req.query.direction;
    }

    const docs = await tenantModel('behaviour_categories', tenantContext(req)).find(filter).sort({ name: 1 }).limit(200).select('-__v').lean();
    return ok(res, docs);
  } catch (err) { console.error('[behaviour/categories GET]', err); return E.serverError(res); }
});

router.post('/categories', authMiddleware, PLAN, MODGATE, behaviourAccess('create'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CategorySchema, req.body);
    if (error) return E.validation(res, error);

    const dup = await tenantModel('behaviour_categories', tenantContext(req)).findOne({ schoolId, name: data.name }).lean();
    if (dup) return E.conflict(res, `Category '${data.name}' already exists`);

    data.items = (data.items || []).map(it => ({ ...it, id: it.id || uuidv4() }));
    const doc = await tenantModel('behaviour_categories', tenantContext(req)).create({ ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[behaviour/categories POST]', err); return E.serverError(res); }
});

router.put('/categories/:id', authMiddleware, PLAN, MODGATE, behaviourAccess('update'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CategorySchema.partial(), req.body);
    if (error) return E.validation(res, error);
    delete data.schoolId; delete data.id;
    // PUT replaces the whole items array when provided (client sends the
    // full edited list back) — assign ids to any newly-added items that
    // don't have one yet; existing items keep the id the client sent.
    if (data.items) data.items = data.items.map(it => ({ ...it, id: it.id || uuidv4() }));

    const doc = await tenantModel('behaviour_categories', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { ...data, updatedBy: userId },
      { new: true, runValidators: false }
    ).lean();
    if (!doc) return E.notFound(res, 'Category not found');
    return ok(res, doc);
  } catch (err) { console.error('[behaviour/categories PUT/:id]', err); return E.serverError(res); }
});

router.delete('/categories/:id', authMiddleware, PLAN, MODGATE, behaviourAccess('delete'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('behaviour_categories', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!doc) return E.notFound(res, 'Category not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[behaviour/categories DELETE/:id]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   OFFICER CONFIG — who the "Behaviour Officer" role is assigned to
   ══════════════════════════════════════════════════════════════ */

/* GET /api/behaviour/officer-config — any behaviour:read caller may
   see who's currently assigned (needed just to display it). */
router.get('/officer-config', authMiddleware, PLAN, MODGATE, behaviourAccess('read'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const cfg = await getWorkflowConfig(tenantContext(req), schoolId, OFFICER_WORKFLOW_KEY);
    return ok(res, { steps: cfg?.steps ?? [] });
  } catch (err) { console.error('[behaviour/officer-config GET]', err); return E.serverError(res); }
});

/* PUT /api/behaviour/officer-config — admin/superadmin only. Deliberately
   NOT gated by behaviourAccess(): reassigning who controls the module
   is a governance action, not a behaviour:update action, and an
   already-assigned officer reassigning themselves (or someone else)
   without admin oversight would be a privilege-escalation path this
   guards against. Empty steps ([]) is valid — it clears the
   assignment, falling back to plain role_permissions for everyone. */
router.put('/officer-config', authMiddleware, PLAN, MODGATE, async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!['superadmin', 'admin'].includes(role)) {
      return E.forbidden(res, 'Admin access required to assign the Behaviour Officer');
    }
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const doc = await saveWorkflowConfig(tenantContext(req), schoolId, OFFICER_WORKFLOW_KEY, { steps }, userId, 0);
    return ok(res, { steps: doc.steps });
  } catch (err) {
    if (err.statusCode === 400) return E.badRequest(res, err.message);
    console.error('[behaviour/officer-config PUT]', err);
    return E.serverError(res);
  }
});

/* Governance Spec §2 — zeroes the CURRENT running-total balance shown
   by /incidents/summary without touching behaviour_incidents history,
   which is never deleted, modified, or filtered out by this action.
   Exported so academic-config.js's /transition-year route can fire
   this automatically at year-end, alongside the manual admin button
   below — same mechanism, two triggers. */
async function resetBehaviourPoints(schoolId, ctx, { resetBy, note } = {}) {
  const now = new Date().toISOString();
  const doc = await tenantModel('behaviour_points_resets', ctx).create({
    id: uuidv4(), schoolId, resetAt: now, resetBy: resetBy || 'system', note: (note || '').trim(),
  });
  return doc.toObject ? doc.toObject() : doc;
}

/* ── POST /api/behaviour/points-reset — manual, admin-triggered ── */
router.post('/points-reset', authMiddleware, PLAN, MODGATE, behaviourAccess('delete'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const doc = await resetBehaviourPoints(schoolId, tenantContext(req), { resetBy: userId, note: req.body?.note });
    await AuditService.log({
      action: 'behaviour.points_reset', actor: { userId, role: req.jwtUser.role, email: req.jwtUser.email }, schoolId,
      target: { type: 'behaviour_points_reset', id: doc.id }, details: { resetAt: doc.resetAt }, req,
    });
    return created(res, doc);
  } catch (err) { console.error('[behaviour/points-reset POST]', err); return E.serverError(res); }
});

module.exports = router;
module.exports.resetBehaviourPoints = resetBehaviourPoints;
