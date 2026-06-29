/* ============================================================
   Msingi — Public Onboarding Route
   POST /api/onboard — provisions a new school + admin user
   No auth required (public endpoint, rate-limited)
   ============================================================ */
const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const { sign }   = require('../utils/jwt');
const email      = require('../utils/email');

const router = express.Router();

/* Rate limit: max 5 registrations per IP per hour */
const onboardLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

/* ── Mongoose model helper ──────────────────────────────── */
function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

/* ── Slug sanitiser ─────────────────────────────────────── */
function sanitiseSlug(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

/* ── Auto-generate slug from school name ────────────────── */
function slugFromName(name) {
  return sanitiseSlug(name.replace(/\s+/g, '-'));
}

/* ── Secure temp password generator ────────────────────── */
function _genTempPassword() {
  // 12 readable characters — no ambiguous chars (0/O, 1/l/I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let pwd = '';
  for (const b of bytes) pwd += chars[b % chars.length];
  return pwd;
}

/* ── Disposable / known-abuse email domains (block list) ── */
const BLOCKED_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwam.com',
  'sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info',
  'spam4.me','yopmail.com','trashmail.com','fakeinbox.com','maildrop.cc',
  'getairmail.com','dispostable.com','spamgourmet.com','spamherelots.com',
  'tempr.email','discard.email','mailnull.com','mailnesia.com',
  'thetempmail.com','tempinbox.com','emailondeck.com','throwam.com'
]);

/* ── GET /api/onboard/check-slug?slug=xyz ──────────────── */
const slugCheckLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { error: 'Too many slug checks. Slow down.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.get('/check-slug', slugCheckLimiter, async (req, res) => {
  const raw = (req.query.slug || '').trim().toLowerCase();
  const slug = sanitiseSlug(raw);
  if (!slug || slug.length < 2) {
    return res.json({ available: false, reason: 'Slug must be at least 2 characters.' });
  }
  const reserved = new Set(['admin','app','api','platform','www','mail','support','help','demo','innolearn','login','signup','onboard']);
  if (reserved.has(slug)) {
    return res.json({ available: false, reason: `"${slug}" is a reserved word and cannot be used.` });
  }
  try {
    const School = _model('schools');
    const exists = await School.findOne({ slug }).lean();
    return res.json({ available: !exists, slug, reason: exists ? `"${slug}" is already taken. Please choose a different one.` : null });
  } catch {
    return res.json({ available: null, reason: 'Could not verify availability right now.' });
  }
});

/* ── POST /api/onboard ──────────────────────────────────── */
router.post('/', onboardLimiter, async (req, res) => {
  try {
    const {
      schoolName, shortName, schoolType, country, city, website,
      adminName, adminEmail,
      plan, slug: rawSlug,
      curriculum, sections,
      _trap, _elapsed
    } = req.body;

    /* ── Anti-bot: honeypot check ── */
    if (_trap && _trap.length > 0) {
      console.warn(`[Security] Honeypot triggered from IP ${req.ip}`);
      await new Promise(r => setTimeout(r, 2000));
      return res.status(400).json({ error: 'Registration could not be completed. Please try again.' });
    }

    /* ── Anti-bot: timing check (must take > 4 seconds to fill the form) ── */
    const elapsed = parseInt(_elapsed) || 0;
    if (elapsed < 4) {
      console.warn(`[Security] Form submitted too fast (${elapsed}s) from IP ${req.ip}`);
      return res.status(429).json({ error: 'Please take a moment to complete the form properly.' });
    }

    /* ── Validate required fields ── */
    const missing = [];
    if (!schoolName) missing.push('schoolName');
    if (!adminEmail) missing.push('adminEmail');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    /* ── Anti-bot: block disposable email domains ── */
    const emailDomain = adminEmail.split('@')[1]?.toLowerCase();
    if (emailDomain && BLOCKED_DOMAINS.has(emailDomain)) {
      console.warn(`[Security] Disposable email blocked: ${adminEmail} from IP ${req.ip}`);
      return res.status(400).json({ error: 'Disposable email addresses are not allowed. Please use your school or institutional email.' });
    }

    /* ── Determine slug ── */
    const slug = sanitiseSlug(rawSlug) || slugFromName(schoolName);
    if (slug.length < 2) {
      return res.status(400).json({ error: 'Could not generate a valid URL slug from the school name' });
    }

    // ── Bootstrap mode ───────────────────────────────────────────────────
    // During the launch / go-to-market phase all onboarding schools receive
    // the enterprise plan so they experience the full platform.
    // When billing goes live, set BOOTSTRAP_PLAN=family (or the chosen
    // default) in the Render dashboard and redeploy — no code change needed.
    const BOOTSTRAP_PLAN  = process.env.BOOTSTRAP_PLAN || 'enterprise';
    // Accept both canonical names (base/student/family) and legacy names (core/standard/premium)
    const validPlan       = ['base','student','family','core','standard','premium','enterprise'].includes(plan) ? plan : BOOTSTRAP_PLAN;
    const validCurriculum = Array.isArray(curriculum) ? curriculum.filter(c => typeof c === 'string') : [];
    const VALID_SECTIONS  = ['kg','primary','secondary','alevel'];
    const validSections   = Array.isArray(sections)
      ? sections.filter(s => VALID_SECTIONS.includes(s))
      : ['primary','secondary'];

    /* ── Generate secure temp password (server-side, not set by user) ── */
    const tempPassword = _genTempPassword();

    const schoolData = {
      schoolName, shortName, schoolType, country, city, website,
      adminName, adminEmail, tempPassword,
      plan: validPlan, slug,
      curriculum: validCurriculum,
      sections: validSections.length ? validSections : ['primary']
    };

    /* ── If MongoDB is connected, provision in DB ── */
    if (mongoose.connection.readyState === 1) {
      return await _provisionInDB(schoolData, res);
    }

    /* ── Offline / localStorage-only mode ── */
    return _provisionOffline(schoolData, res);

  } catch (err) {
    console.error('[ONBOARD ERROR]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/* ── DB provisioning (MongoDB connected) ────────────────── */
async function _provisionInDB(data, res) {
  const { schoolName, shortName, schoolType, country, city, website,
          adminName, adminEmail, tempPassword, plan, slug,
          curriculum, sections } = data;

  const School = _model('schools');
  const User   = _model('users');

  /* Check slug uniqueness */
  const slugExists = await School.findOne({ slug }).lean();
  if (slugExists) {
    return res.status(409).json({
      error: `The URL "${slug}" is already taken. Please choose a different one.`
    });
  }

  /* Check email uniqueness — only block if the existing user belongs to an active school.
     A deleted or rejected school must not permanently prevent re-registration with the same email. */
  const existingUser = await User.findOne({ email: adminEmail.toLowerCase() }).lean();
  if (existingUser) {
    const existingSchool = await School.findOne({ id: existingUser.schoolId, isActive: true }).lean();
    if (existingSchool) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.'
      });
    }
    // User exists but their school is inactive/rejected — allow re-registration
  }

  const schoolId = `sch_${slug}_${Date.now().toString(36)}`;
  const userId   = `u_${slug}_superadmin`;
  const now      = new Date().toISOString();

  // During bootstrap phase, trial is 12 months (full first year free).
  // Set TRIAL_DAYS in Render env to override (e.g. TRIAL_DAYS=30 when billing goes live).
  const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '365', 10);
  const trialEnds  = new Date();
  trialEnds.setDate(trialEnds.getDate() + TRIAL_DAYS);

  /* Create school — status: pending until platform admin approves */
  const school = await School.create({
    id: schoolId, slug, name: schoolName,
    shortName: shortName || _initials(schoolName),
    type: schoolType || 'private',
    country: country || '',
    city: city || '',
    website: website || '',
    plan: plan, addOns: [], isActive: false, status: 'pending',
    curriculum: curriculum || [],
    sections:   sections   || ['primary'],
    trialEnds: trialEnds.toISOString(),
    currency: _currencyForCountry(country),
    currencySymbol: _currencySymbol(country),
    timezone: _timezoneForCountry(country),
    adminName: adminName || adminEmail.split('@')[0],
    adminEmail: adminEmail.toLowerCase(),
    createdAt: now
  });

  /* Create superadmin user — inactive until approved
     tempPassword stored in plaintext so approval email can include it,
     then cleared after approval is sent. mustChangePassword forces reset on first login. */
  const hashed = await bcrypt.hash(tempPassword, 12);
  const user   = await User.create({
    id: userId, schoolId, name: adminName || adminEmail.split('@')[0],
    email: adminEmail.toLowerCase(), password: hashed,
    role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
    isActive: false, mustChangePassword: true,
    tempPassword,   // cleared after approval email is sent
    createdAt: now
  });

  /* Seed base data — sections, academic year, permissions */
  await _seedBaseData(schoolId, sections || ['primary'], country || '');

  const schoolObj = school.toObject();
  const userObj   = { ...user.toObject(), password: undefined };

  /* Send emails (fire-and-forget — don't block response) */
  Promise.all([
    email.sendRegistrationPending({
      adminName: adminName || adminEmail.split('@')[0],
      adminEmail: adminEmail.toLowerCase(),
      schoolName, plan
    }),
    email.sendAdminNewSchoolAlert({
      schoolName, slug,
      adminName: adminName || adminEmail.split('@')[0],
      adminEmail: adminEmail.toLowerCase(),
      plan, country, city, curriculum, sections
    })
  ]).catch(err => console.error('[ONBOARD] Email error:', err.message));

  console.log(`[ONBOARD] New school registered (pending): ${schoolName} (${slug}) plan=${plan}`);

  return res.status(201).json({
    success: true,
    pending: true,
    school: schoolObj,
    user:   userObj,
    message: 'Your application has been received. You will be notified by email once approved.'
  });
}

/* ── Offline provisioning (no MongoDB) ──────────────────── */
function _provisionOffline(data, res) {
  const { schoolName, shortName, schoolType, country, city, website,
          adminName, adminEmail, tempPassword, plan, slug,
          curriculum, sections } = data;

  const schoolId = `sch_${slug}_${Date.now().toString(36)}`;
  const userId   = `u_${slug}_superadmin`;
  const now      = new Date().toISOString();

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 30);

  const school = {
    id: schoolId, slug, name: schoolName,
    shortName: shortName || _initials(schoolName),
    type: schoolType || 'private',
    country, city, website,
    plan, addOns: [], isActive: true,
    curriculum: curriculum || [],
    sections:   sections   || ['primary'],
    trialEnds: trialEnds.toISOString(),
    currency: _currencyForCountry(country),
    currencySymbol: _currencySymbol(country),
    timezone: _timezoneForCountry(country),
    createdAt: now
  };

  /* Offline mode: store plaintext password so the user can log in without a server */
  const user = {
    id: userId, schoolId, name: adminName || adminEmail.split('@')[0],
    email: adminEmail.toLowerCase(), password: tempPassword,
    role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
    isActive: true, mustChangePassword: true, createdAt: now, lastLogin: now
  };

  /* The client must inject these into its localStorage DB on receipt */
  const session = { user: { ...user, password: undefined }, school };

  console.log(`[ONBOARD:OFFLINE] New school (offline mode): ${schoolName} (${slug})`);

  return res.status(201).json({
    success: true,
    token: null,   // no JWT in offline mode
    session,
    school,
    tempPassword,  // shown in success screen so user knows their credentials
    user: { ...user, password: undefined },
    offline: true,
    loginUrl: `/login`
  });
}

/* ── All possible sections (keyed by selection ID) ──────── */
const ALL_SECTIONS = {
  kg:        { key:'kg',        name:'KG / Pre-Primary',     code:'KG',  order:1 },
  primary:   { key:'primary',   name:'Primary',              code:'PRI', order:2 },
  secondary: { key:'secondary', name:'Secondary',            code:'SEC', order:3 },
  alevel:    { key:'alevel',    name:'Sixth Form / A-Level', code:'AL',  order:4 },
};

/* ── Country sets for academic calendar selection ───────── */
const _AFRICA = new Set(['KE','UG','TZ','RW','ET','NG','GH','ZA','ZM','ZW']);
const _UK_AU  = new Set(['GB','AU']);
const _US_CA  = new Set(['US','CA']);

/* ── Build country-aware academic year config ───────────── */
function _buildAcademicYear(schoolId, country) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const month = today.getMonth() + 1; // 1-12
  const yr    = today.getFullYear();

  function _markCurrent(terms) {
    return terms.map(t => ({ ...t, isCurrent: todayStr >= t.startDate && todayStr <= t.endDate }));
  }

  if (_UK_AU.has(country)) {
    // Sept–July spanning two calendar years
    // If we're in Jan-Aug, the academic year started last September
    const startYr = month >= 9 ? yr : yr - 1;
    const endYr   = startYr + 1;
    const terms = _markCurrent([
      { id: `t1_${schoolId}`, name: 'Term 1', startDate: `${startYr}-09-01`, endDate: `${startYr}-12-15` },
      { id: `t2_${schoolId}`, name: 'Term 2', startDate: `${endYr}-01-08`,   endDate: `${endYr}-04-10`   },
      { id: `t3_${schoolId}`, name: 'Term 3', startDate: `${endYr}-04-27`,   endDate: `${endYr}-07-11`   },
    ]);
    return {
      ayId: `ay_${schoolId}_${startYr}`,
      name: `${startYr}–${endYr}`,
      startDate: `${startYr}-09-01`, endDate: `${endYr}-07-31`,
      terms,
    };
  }

  if (_US_CA.has(country)) {
    // Aug–May spanning two calendar years
    const startYr = month >= 8 ? yr : yr - 1;
    const endYr   = startYr + 1;
    const terms = _markCurrent([
      { id: `t1_${schoolId}`, name: 'Semester 1', startDate: `${startYr}-08-20`, endDate: `${endYr}-01-15` },
      { id: `t2_${schoolId}`, name: 'Semester 2', startDate: `${endYr}-01-16`,   endDate: `${endYr}-05-31` },
    ]);
    return {
      ayId: `ay_${schoolId}_${startYr}`,
      name: `${startYr}–${endYr}`,
      startDate: `${startYr}-08-20`, endDate: `${endYr}-05-31`,
      terms,
    };
  }

  // Default: Africa and everywhere else — single calendar year, Jan–Dec, three terms
  const terms = _markCurrent([
    { id: `t1_${schoolId}`, name: 'Term 1', startDate: `${yr}-01-06`, endDate: `${yr}-04-03` },
    { id: `t2_${schoolId}`, name: 'Term 2', startDate: `${yr}-05-05`, endDate: `${yr}-08-07` },
    { id: `t3_${schoolId}`, name: 'Term 3', startDate: `${yr}-09-01`, endDate: `${yr}-11-13` },
  ]);
  return {
    ayId: `ay_${schoolId}_${yr}`,
    name: `${yr}`,
    startDate: `${yr}-01-01`, endDate: `${yr}-12-31`,
    terms,
  };
}

/* ── Seed base data — only the sections the school selected ─ */
async function _seedBaseData(schoolId, selectedSections = ['primary','secondary'], country = '') {
  const AY   = _model('academic_years');
  const Perm = _model('role_permissions');
  const Sec  = _model('sections');

  const { ayId, name, startDate, endDate, terms } = _buildAcademicYear(schoolId, country);

  await AY.updateOne({ id: ayId }, { $set: {
    id: ayId, schoolId,
    name, isCurrent: true,
    startDate, endDate,
    terms,
  }}, { upsert: true });

  /* Seed ONLY the sections this school selected */
  const secsToSeed = selectedSections
    .filter(s => ALL_SECTIONS[s])
    .map(s => ({
      id:      `sec_${s}_${schoolId}`,
      name:     ALL_SECTIONS[s].name,
      code:     ALL_SECTIONS[s].code,
      order:    ALL_SECTIONS[s].order,
      sectionKey: s,   // store the key for easy lookup
    }));

  await Promise.all(secsToSeed.map(sec =>
    Sec.updateOne({ id: sec.id }, { $set: { ...sec, schoolId } }, { upsert: true })
  ));

  /* Default role permissions */
  const roles = ['superadmin','admin','teacher','finance','hr','admissions_officer',
                 'exams_officer','timetabler','section_head','deputy_principal',
                 'discipline_committee','parent','student'];

  const FULL_ACTIONS = ['read', 'create', 'update', 'delete'];
  const ALL_MODULES  = [
    'students', 'teachers', 'classes', 'attendance', 'finance', 'behaviour',
    'exams', 'grades', 'admissions', 'timetable', 'messages', 'settings',
    'assessment', 'report_cards', 'lessons', 'hr', 'analytics',
  ];

  const permDocs = roles.map(roleKey => ({
    id: `rp_${roleKey}_${schoolId}`,
    schoolId, roleKey,
    permissions: roleKey === 'superadmin'
      ? Object.fromEntries(ALL_MODULES.map(m => [m, FULL_ACTIONS]))  // superadmin: full access (also bypassed in middleware)
      : _defaultPerms(roleKey)
  }));

  await Promise.all(permDocs.map(p =>
    Perm.updateOne({ id: p.id }, { $set: p }, { upsert: true })
  ));
}

/* ── Default permissions per role ───────────────────────── */
/*
 * IMPORTANT: RBAC middleware (middleware/rbac.js) expects the NEW array format:
 *   { students: ['read', 'create', 'update', 'delete'], ... }
 *
 * DO NOT use the legacy object format { view: true, edit: true } —
 * that format silently fails all permission checks.
 *
 * Permission actions: 'read' | 'create' | 'update' | 'delete'
 *
 * Module keys must match the strings used in rbac() calls in route files:
 *   students, teachers, classes, attendance, finance, behaviour, exams,
 *   grades, admissions, timetable, messages, settings, assessment, report_cards
 */
function _defaultPerms(role) {
  const R    = ['read'];
  const RCU  = ['read', 'create', 'update'];
  const RCUD = ['read', 'create', 'update', 'delete'];

  switch (role) {
    case 'admin':
      // admin gets full access to everything — also bypassed in RBAC middleware
      return {
        students:     RCUD, teachers:     RCUD, classes:      RCUD,
        attendance:   RCUD, finance:      RCUD, behaviour:    RCUD,
        exams:        RCUD, grades:       RCUD, admissions:   RCUD,
        timetable:    RCUD, messages:     RCUD, settings:     RCUD,
        assessment:   RCUD, report_cards: RCUD, lessons:      RCUD,
        hr:           RCUD, analytics:    RCUD,
      };

    case 'teacher':
      return {
        students:     R,    teachers:     R,    classes:      R,
        attendance:   RCU,  grades:       RCU,  assessment:   RCU,
        timetable:    R,    messages:     RCU,  report_cards: R,
        exams:        R,    lessons:      RCUD,
      };

    case 'finance':
      return {
        students:     R,
        finance:      RCUD,
        report_cards: R,
      };

    case 'hr':
      return {
        hr:           RCUD,
        teachers:     RCUD,
        students:     R,
      };

    case 'admissions_officer':
      return {
        admissions:   RCUD,
        students:     RCU,
        classes:      R,
      };

    case 'exams_officer':
      return {
        exams:        RCUD,
        grades:       RCUD,
        assessment:   RCUD,
        students:     R,
        classes:      R,
        report_cards: R,
      };

    case 'timetabler':
      return {
        timetable:    RCUD,
        classes:      RCU,
        teachers:     R,
      };

    case 'section_head':
      return {
        students:     R,   teachers:     R,   classes:      R,
        attendance:   R,   grades:       R,   assessment:   R,
        exams:        R,   timetable:    R,   report_cards: R,
        admissions:   R,   lessons:      RCU, analytics:    R,
      };

    case 'deputy_principal':
      return {
        students:     RCUD, teachers:     RCU,  classes:      RCUD,
        attendance:   RCUD, grades:       RCUD, assessment:   RCUD,
        exams:        RCUD, behaviour:    RCUD, timetable:    RCUD,
        messages:     RCUD, report_cards: RCU,  admissions:   RCU,
        lessons:      RCUD, analytics:    R,
      };

    case 'discipline_committee':
      return {
        behaviour:    RCUD,
        students:     R,
      };

    case 'parent':
      return {
        messages:     R,
        report_cards: R,   // read their own child's report cards
        lessons:      R,   // view curriculum coverage for their child's class
      };

    case 'student':
      return {
        messages:     R,
        lessons:      R,   // view curriculum coverage for their class
      };

    default:
      return {};
  }
}

/* ── Locale helpers ─────────────────────────────────────── */
function _currencyForCountry(country) {
  const map = { KE:'KES', UG:'UGX', TZ:'TZS', RW:'RWF', ET:'ETB',
                NG:'NGN', GH:'GHS', ZA:'ZAR', ZM:'ZMW', ZW:'USD',
                GB:'GBP', US:'USD', CA:'CAD', AU:'AUD', IN:'INR' };
  return map[country] || 'USD';
}

function _currencySymbol(country) {
  const map = { KE:'KSh', UG:'USh', TZ:'TSh', RW:'Fr', ET:'Br',
                NG:'₦', GH:'₵', ZA:'R', ZM:'K', ZW:'$',
                GB:'£', US:'$', CA:'$', AU:'$', IN:'₹' };
  return map[country] || '$';
}

function _timezoneForCountry(country) {
  const map = { KE:'Africa/Nairobi', UG:'Africa/Kampala', TZ:'Africa/Dar_es_Salaam',
                RW:'Africa/Kigali', ET:'Africa/Addis_Ababa', NG:'Africa/Lagos',
                GH:'Africa/Accra', ZA:'Africa/Johannesburg', ZM:'Africa/Lusaka',
                ZW:'Africa/Harare', GB:'Europe/London', US:'America/New_York',
                CA:'America/Toronto', AU:'Australia/Sydney', IN:'Asia/Kolkata' };
  return map[country] || 'UTC';
}

function _initials(name) {
  return name.split(/\s+/).filter(w => w.length > 2).map(w => w[0].toUpperCase()).join('').substring(0, 6) || name.substring(0, 4).toUpperCase();
}

module.exports = router;
