/* ============================================================
   InnoLearn — Public Onboarding Route
   POST /api/onboard — provisions a new school + admin user
   No auth required (public endpoint, rate-limited)
   ============================================================ */
const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');
const { sign }   = require('../utils/jwt');

const router = express.Router();

/* Rate limit: max 5 registrations per IP per hour */
const onboardLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
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

/* ── Disposable / known-abuse email domains (block list) ── */
const BLOCKED_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwam.com',
  'sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info',
  'spam4.me','yopmail.com','trashmail.com','fakeinbox.com','maildrop.cc',
  'getairmail.com','dispostable.com','spamgourmet.com','spamherelots.com',
  'tempr.email','discard.email','mailnull.com','mailnesia.com',
  'thetempmail.com','tempinbox.com','emailondeck.com','throwam.com'
]);

/* ── POST /api/onboard ──────────────────────────────────── */
router.post('/', onboardLimiter, async (req, res) => {
  try {
    const {
      schoolName, shortName, schoolType, country, city, website,
      adminName, adminEmail, adminPassword,
      plan, slug: rawSlug,
      curriculum, sections,
      _trap, _elapsed
    } = req.body;

    /* ── Anti-bot: honeypot check ── */
    if (_trap && _trap.length > 0) {
      // Bot filled the hidden field — silently reject with fake success delay
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
    if (!schoolName)    missing.push('schoolName');
    if (!adminEmail)    missing.push('adminEmail');
    if (!adminPassword) missing.push('adminPassword');
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

    if (adminPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    /* ── Determine slug ── */
    const slug = sanitiseSlug(rawSlug) || slugFromName(schoolName);
    if (slug.length < 2) {
      return res.status(400).json({ error: 'Could not generate a valid URL slug from the school name' });
    }

    const validPlan       = ['core','standard','premium','enterprise'].includes(plan) ? plan : 'standard';
    const validCurriculum = Array.isArray(curriculum) ? curriculum.filter(c => typeof c === 'string') : [];
    const VALID_SECTIONS  = ['kg','primary','secondary','alevel'];
    const validSections   = Array.isArray(sections)
      ? sections.filter(s => VALID_SECTIONS.includes(s))
      : ['primary','secondary'];

    const schoolData = {
      schoolName, shortName, schoolType, country, city, website,
      adminName, adminEmail, adminPassword,
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
          adminName, adminEmail, adminPassword, plan, slug,
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

  /* Check email uniqueness */
  const emailExists = await User.findOne({ email: adminEmail.toLowerCase() }).lean();
  if (emailExists) {
    return res.status(409).json({
      error: 'An account with this email already exists. Please sign in instead.'
    });
  }

  const schoolId = `sch_${slug}_${Date.now().toString(36)}`;
  const userId   = `u_${slug}_superadmin`;
  const now      = new Date().toISOString();

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 30);

  /* Create school */
  const school = await School.create({
    id: schoolId, slug, name: schoolName,
    shortName: shortName || _initials(schoolName),
    type: schoolType || 'private',
    country: country || '',
    city: city || '',
    website: website || '',
    plan: plan, addOns: [], isActive: true,
    curriculum: curriculum || [],
    sections:   sections   || ['primary'],
    trialEnds: trialEnds.toISOString(),
    currency: _currencyForCountry(country),
    currencySymbol: _currencySymbol(country),
    timezone: _timezoneForCountry(country),
    createdAt: now
  });

  /* Create superadmin user */
  const hashed = await bcrypt.hash(adminPassword, 12);
  const user   = await User.create({
    id: userId, schoolId, name: adminName || adminEmail.split('@')[0],
    email: adminEmail.toLowerCase(), password: hashed,
    role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
    isActive: true, createdAt: now, lastLogin: now
  });

  /* Seed base data — only the sections this school selected */
  await _seedBaseData(schoolId, sections || ['primary']);

  /* Issue JWT */
  const token = sign({
    userId, schoolId, email: adminEmail.toLowerCase(),
    role: 'superadmin', roles: ['superadmin']
  });

  /* Build a session payload so localStorage-mode also works */
  const schoolObj = school.toObject();
  const userObj   = { ...user.toObject(), password: undefined };
  const session   = { user: userObj, school: schoolObj };

  console.log(`[ONBOARD] New school provisioned: ${schoolName} (${slug}) plan=${plan}`);

  return res.status(201).json({
    success: true,
    token,
    session,
    school: schoolObj,
    user:   userObj,
    loginUrl: `/index.html`
  });
}

/* ── Offline provisioning (no MongoDB) ──────────────────── */
function _provisionOffline(data, res) {
  const { schoolName, shortName, schoolType, country, city, website,
          adminName, adminEmail, adminPassword, plan, slug,
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

  /* NOTE: password stored in plain text only in offline demo mode.
     In production, MongoDB is always expected to be connected.      */
  const user = {
    id: userId, schoolId, name: adminName || adminEmail.split('@')[0],
    email: adminEmail.toLowerCase(), password: adminPassword,
    role: 'superadmin', primaryRole: 'superadmin', roles: ['superadmin'],
    isActive: true, createdAt: now, lastLogin: now
  };

  /* The client must inject these into its localStorage DB on receipt */
  const session = { user: { ...user, password: undefined }, school };

  console.log(`[ONBOARD:OFFLINE] New school (offline mode): ${schoolName} (${slug})`);

  return res.status(201).json({
    success: true,
    token: null,   // no JWT in offline mode
    session,
    school,
    user: { ...user, password: undefined },
    offline: true,
    loginUrl: `/index.html`
  });
}

/* ── All possible sections (keyed by selection ID) ──────── */
const ALL_SECTIONS = {
  kg:        { key:'kg',        name:'KG / Pre-Primary',     code:'KG',  order:1 },
  primary:   { key:'primary',   name:'Primary',              code:'PRI', order:2 },
  secondary: { key:'secondary', name:'Secondary',            code:'SEC', order:3 },
  alevel:    { key:'alevel',    name:'Sixth Form / A-Level', code:'AL',  order:4 },
};

/* ── Seed base data — only the sections the school selected ─ */
async function _seedBaseData(schoolId, selectedSections = ['primary','secondary']) {
  const AY   = _model('academic_years');
  const Perm = _model('role_permissions');
  const Sec  = _model('sections');

  const year = new Date().getFullYear();
  const ayId = `ay_${schoolId}_${year}`;

  await AY.updateOne({ id: ayId }, { $set: {
    id: ayId, schoolId,
    name: `${year}-${year + 1}`, isCurrent: true,
    startDate: `${year}-09-01`, endDate: `${year + 1}-07-31`,
    terms: [
      { id: `t1_${schoolId}`, name: 'Term 1', startDate: `${year}-09-01`,     endDate: `${year}-12-15`,     isCurrent: false },
      { id: `t2_${schoolId}`, name: 'Term 2', startDate: `${year + 1}-01-08`, endDate: `${year + 1}-04-10`, isCurrent: true  },
      { id: `t3_${schoolId}`, name: 'Term 3', startDate: `${year + 1}-04-27`, endDate: `${year + 1}-07-11`, isCurrent: false },
    ]
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

  const permDocs = roles.map(roleKey => ({
    id: `rp_${roleKey}_${schoolId}`,
    schoolId, roleKey,
    permissions: roleKey === 'superadmin'
      ? { _all: { view: true, edit: true, delete: true, create: true } }
      : _defaultPerms(roleKey)
  }));

  await Promise.all(permDocs.map(p =>
    Perm.updateOne({ id: p.id }, { $set: p }, { upsert: true })
  ));
}

/* ── Default permissions per role ───────────────────────── */
function _defaultPerms(role) {
  const VIEW_ALL = ['dashboard','admissions','students','classes','subjects',
                    'timetable','attendance','academics','exams','finance',
                    'communication','events','reports','hr','behaviour','settings'];
  const v = (mods) => Object.fromEntries(mods.map(m => [m, { view: true }]));
  const ve = (mods) => Object.fromEntries(mods.map(m => [m, { view: true, edit: true, create: true }]));
  const vea = (mods) => Object.fromEntries(mods.map(m => [m, { view: true, edit: true, create: true, delete: true }]));

  switch (role) {
    case 'admin':
      return vea(VIEW_ALL);
    case 'teacher':
      return { ...v(['dashboard','students','classes','subjects','timetable','events','communication']),
               ...ve(['attendance','academics','exams']) };
    case 'finance':
      return { ...v(['dashboard','students','reports']), ...vea(['finance']) };
    case 'hr':
      return { ...v(['dashboard']), ...vea(['hr']) };
    case 'admissions_officer':
      return { ...v(['dashboard','students']), ...vea(['admissions']) };
    case 'exams_officer':
      return { ...v(['dashboard','students','classes','subjects']), ...vea(['exams','academics']) };
    case 'timetabler':
      return { ...v(['dashboard']), ...vea(['timetable','classes','subjects']) };
    case 'section_head':
      return { ...v(['dashboard','students','classes','subjects','timetable','attendance','academics','exams','reports']) };
    case 'deputy_principal':
      return vea(['dashboard','students','classes','subjects','timetable','attendance','academics','exams','behaviour','events','communication','reports']);
    case 'discipline_committee':
      return { ...v(['dashboard','students']), ...vea(['behaviour']) };
    case 'parent':
      return v(['dashboard','events','communication']);
    case 'student':
      return v(['dashboard','events']);
    default:
      return v(['dashboard']);
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
