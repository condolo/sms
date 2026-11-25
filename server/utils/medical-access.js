/* ============================================================
   Msingi — who may see which medical record (v5.285.0)

   One rule for Medical Centre, the student record, Weekly Snapshots, the
   teacher portal and the student export, read from Settings → Roles &
   Permissions → Medical Centre.

   Settings also writes one combined "medical" grant: every row ticked,
   together. Reading that grant alone let a role with only "View Medical
   Alerts" ticked read clinic visits (an unsaved row falls back to it) and
   the nurse's notes in Weekly Snapshots. Here it never counts when the
   Alerts, Profile, Clinic-only Notes or Settings rows are all that is
   behind it.

   Rows added in v5.285.0 follow an existing one until a school ticks them:
     profile        read → View Clinic Visits; edit → Record Clinic Visit;
                    and the admissions officer, who records it on enrolment
     clinic_notes   read → View Clinic Visits; write → Record Clinic Visit
   Settings shows the same ticks (SettingsPage _mergePerms).
   ============================================================ */
'use strict';

const { effectivePerms } = require('../middleware/rbac');

const NARROW = ['alerts', 'profile', 'clinic_notes', 'settings'];   // never open the rest of the module

/** Pure: does this permission map allow the action on a Medical Centre row? */
function allowedIn(perms, sub, action, roles = []) {
  const own = perms?.[`medical__${sub}`];
  if (Array.isArray(own)) return own.includes(action);

  if (sub === 'profile') {
    if (roles.includes('admissions_officer') && ['read', 'create', 'update'].includes(action)) return true;
    return action === 'read' ? allowedIn(perms, 'view', 'read') : allowedIn(perms, 'record', 'create');
  }
  if (sub === 'clinic_notes') return action === 'read' ? allowedIn(perms, 'view', 'read') : allowedIn(perms, 'record', 'create');
  if (sub === 'settings') return roles.includes('admin');   // strict otherwise: an explicit tick

  const combined = perms?.medical;
  if (!Array.isArray(combined) || !combined.includes(action)) return false;
  if (sub === 'alerts') return true;

  const rows = Object.entries(perms).filter(([k, v]) => k.startsWith('medical__') && Array.isArray(v));
  const isNarrow = ([k]) => NARROW.includes(k.slice('medical__'.length));
  if (rows.some(r => !isNarrow(r) && r[1].includes(action))) return true;
  const explained = new Set(rows.filter(isNarrow).flatMap(([, v]) => v));
  return explained.size === 0 || combined.some(a => !explained.has(a));
}

/** Never throws: a lookup that fails shows nothing. */
async function canMedical(req, sub, action) {
  try {
    const perms = await effectivePerms(req);
    if (perms === true) return true;   // super admin
    const { role, roles } = req.jwtUser || {};
    return allowedIn(perms, sub, action, [role, ...(Array.isArray(roles) ? roles : [])]);
  } catch (err) {
    console.error('[medical-access]', err.message);
    return false;
  }
}

/** Route guard, after rbac(). */
function needMedical(sub, action) {
  return async (req, res, next) => {
    if (await canMedical(req, sub, action)) return next();
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Your role does not have access to this part of the Medical Centre.' } });
  };
}

const FLAGS = ['severeAllergy', 'hasAsthma', 'hasEpilepsy', 'otherCriticalAlert'];
const CONTACT = ['emergencyName', 'emergencyPhone', 'emergencyRelation'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));

/**
 * A student record as this caller may see it. Without the profile: the
 * emergency contact, plus the condition flags when `flags` is true.
 */
function studentFor(doc, { profile, flags }) {
  if (!doc || profile) return doc;
  const { medicalNotes, allergies, medicalAlert, ...rest } = doc;
  if (doc.medical === undefined) return rest;
  return { ...rest, medical: pick(doc.medical, flags ? [...CONTACT, ...FLAGS] : CONTACT) };
}

/** "Severe allergy · Asthma", or null. */
function alertText(medical) {
  const m = medical || {};
  return [m.severeAllergy && 'Severe allergy', m.hasAsthma && 'Asthma', m.hasEpilepsy && 'Epilepsy', m.otherCriticalAlert].filter(Boolean).join(' · ') || null;
}

/* ── The school's own choices (Medical Centre → Settings) ────────── */
const DEFAULT_SETTINGS = Object.freeze({
  alertShowsComplaint: false,   // the parent's alert can show on a locked phone
  parentsSeeNotes: true,        // "Notes"; clinic-only notes are never shown to parents
});
function medicalSettings(school) {
  const s = school?.medicalSettings || {};
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, d]) => [k, typeof s[k] === 'boolean' ? s[k] : d]));
}

module.exports = { allowedIn, canMedical, needMedical, studentFor, alertText, medicalSettings, DEFAULT_SETTINGS };
