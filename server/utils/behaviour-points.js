/* ============================================================
   Msingi — behaviour points: one set of rules for every total (v5.276.0)

   Reported (2026-11-16): the Behaviour dashboard and the downloaded
   incident report "don't add up, particularly in net points … some
   points were hidden when downloading", and house points were missing
   from the report. Causes found:
     1. Overview and Houses added up only the newest 200 incidents
        (they asked the list endpoint for 1000; it caps pages at 200),
        and Houses only the first 200 students.
     2. Deleted incidents (soft delete: deletedAt) were counted by the
        incident list, the summary and the export, but not by parents.
     3. "Net" meant two things: the dashboard took merit points minus
        |demerit points|; the export summed points exactly as stored, so
        a demerit saved as +2 moved the two in opposite directions.
     4. The export capped rows at 3000 and computed its totals from the
        capped rows, silently dropping the oldest incidents' points.
   This module is the single definition all of them now use.
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');

/** Incidents that count: not deleted. */
const NOT_DELETED = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };

/** A merit always adds, a demerit always subtracts, whatever sign was typed. */
function signedPoints(i) {
  const p = Number(i?.points) || 0;
  if (i?.type === 'merit') return Math.abs(p);
  if (i?.type === 'demerit') return -Math.abs(p);
  return p;
}

/** The sign a stored value should have for its type (used on save). */
function normalisedPoints(type, points) {
  const p = Number(points) || 0;
  if (type === 'merit') return Math.abs(p);
  if (type === 'demerit') return -Math.abs(p);
  return p;
}

/** Totals for a list of incidents. Demerit points are reported as a positive number. */
function totalsOf(incidents) {
  const t = { events: 0, merits: 0, demerits: 0, neutral: 0, meritPoints: 0, demeritPoints: 0, otherPoints: 0, net: 0 };
  for (const i of incidents || []) {
    t.events++;
    const sp = signedPoints(i);
    if (i.type === 'merit') { t.merits++; t.meritPoints += sp; }
    else if (i.type === 'demerit') { t.demerits++; t.demeritPoints += -sp; }
    else { t.neutral++; t.otherPoints += sp; }
    t.net += sp;
  }
  return t;
}

/** Date of the latest points reset (YYYY-MM-DD), or null. */
async function lastResetDay(ctx, schoolId) {
  try {
    const [r] = await tenantModel('behaviour_points_resets', ctx)
      .find({ schoolId }).sort({ resetAt: -1 }).limit(1).select('resetAt').lean();
    return r?.resetAt ? String(r.resetAt).slice(0, 10) : null;
  } catch { return null; }
}

/**
 * House standings for a set of incidents: each incident counts for the
 * house of its student (students.houseId, or the legacy `house` field).
 * Students with no house are reported as one "No house" line so the
 * house lines plus it always add up to the incidents' total.
 */
async function houseStandings(ctx, schoolId, incidents, houses = []) {
  const studentIds = [...new Set((incidents || []).map(i => i.studentId).filter(Boolean))];
  const students = studentIds.length
    ? await tenantModel('students', ctx).find({ schoolId, id: { $in: studentIds } }).select('id houseId house').lean()
    : [];
  const houseOfStudent = new Map(students.map(s => [s.id, s.houseId ?? s.house ?? null]));
  const known = new Map((houses || []).map(h => [h.id ?? h.name, h]));
  const buckets = new Map();
  for (const h of houses || []) buckets.set(h.id ?? h.name, { houseId: h.id ?? h.name, name: h.name, color: h.color || null, list: [] });
  for (const i of incidents || []) {
    const hid = houseOfStudent.get(i.studentId);
    const key = hid && known.has(hid) ? hid : '__none__';
    if (!buckets.has(key)) buckets.set(key, { houseId: null, name: 'No house', color: null, list: [] });
    buckets.get(key).list.push(i);
  }
  const memberCount = new Map();
  if ((houses || []).length) {
    const members = await tenantModel('students', ctx)
      .find({ schoolId, status: 'active', $or: [{ houseId: { $in: [...known.keys()] } }, { house: { $in: [...known.keys()] } }] })
      .select('houseId house').lean();
    for (const s of members) { const k = s.houseId ?? s.house; memberCount.set(k, (memberCount.get(k) || 0) + 1); }
  }
  return [...buckets.values()]
    .map(b => ({ houseId: b.houseId, name: b.name, color: b.color, members: b.houseId ? (memberCount.get(b.houseId) || 0) : null, ...totalsOf(b.list) }))
    .filter(b => b.houseId || b.events)
    .sort((a, b) => (a.houseId ? 0 : 1) - (b.houseId ? 0 : 1) || b.net - a.net);
}

module.exports = { NOT_DELETED, signedPoints, normalisedPoints, totalsOf, lastResetDay, houseStandings };
