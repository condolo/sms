/**
 * check-report-comments.js — READ-ONLY check before/after v5.280.0
 * (Mid-Term / End-Term comments). Only finds and counts; writes nothing.
 * Prints school names, counts and dates. No learner, parent or staff names,
 * no comment text.
 *
 * Per school it reports:
 *   A. Academic years whose terms have no ids.
 *   B. Published reports hidden by a DIFFERENT term's report (they were
 *      published in a year from A). Nothing is changed; they can be opened
 *      again by publishing that term.
 *   C. Live Mid-Term/End-Term (Report Cycle) reports printed with no subject
 *      comments although the Markbook has some for that learner and term.
 *   D. Comments saved without an academic year that the new version would
 *      NOT show in the current year, because they were saved before that
 *      year's start date. Expected for last year's comments. If the dates
 *      look like THIS year's work, correct the year's start date first.
 *   E. Duplicate comment rows (would stop the new index being created).
 *   F. Schedule entries naming a year the school no longer has.
 *
 * Usage (on a machine with database access, e.g. the Render shell):
 *   node scripts/check-report-comments.js
 *   node scripts/check-report-comments.js --school trinity
 * Uses MONGODB_URI (and MONGODB_DB_NAME if set) from the environment / .env.
 */
'use strict';

const path     = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { resolveCurrentPeriod } = require('../server/routes/academic-config');
const { untaggedBelongsTo } = require('../server/utils/report-comments');
const { yearIdOf } = require('../server/utils/class-history');

const args = process.argv.slice(2);
const SLUG = args.includes('--school') ? String(args[args.indexOf('--school') + 1] || '').toLowerCase() : null;

const col  = (n) => mongoose.connection.db.collection(n);
const day  = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null; };
const span = (days) => { const s = days.filter(Boolean).sort(); return s.length ? `${s[0]} to ${s[s.length - 1]}` : 'undated'; };
const hasText = (map) => Object.values(map || {}).some(t => typeof t === 'string' && t.trim());

async function checkSchool(school) {
  const schoolId = school.id;
  const out = [];
  const years = await col('academic_years').find({ schoolId }).project({ id: 1, name: 1, startDate: 1, endDate: 1, isCurrent: 1, terms: 1 }).toArray();
  const current = resolveCurrentPeriod(years).year || null;
  const currentYearId = yearIdOf(current);
  const known = new Set(years.flatMap(y => [y.id, String(y._id)]).filter(Boolean));

  for (const y of years) {
    const missing = (y.terms || []).filter(t => !t.id).length;
    if (missing) out.push(`A. Year ${y.name}: ${missing} of ${y.terms.length} terms have no id`);
  }

  const hidden = await col('report_card_snapshots').find({ schoolId, superseded: true, supersededBy: { $exists: true, $ne: null } })
    .project({ id: 1, supersededBy: 1, termNumber: 1, academicYear: 1, studentId: 1 }).toArray();
  if (hidden.length) {
    const by = new Map();
    const ids = [...new Set(hidden.map(h => h.supersededBy))];
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await col('report_card_snapshots').find({ schoolId, id: { $in: ids.slice(i, i + 1000) } }).project({ id: 1, termNumber: 1 }).toArray();
      for (const r of rows) by.set(r.id, r.termNumber);
    }
    const cross = {};
    for (const h of hidden) {
      const t = by.get(h.supersededBy);
      if (t != null && h.termNumber != null && t !== h.termNumber) {
        const k = `Term ${h.termNumber} hidden by Term ${t}${h.academicYear ? ` (${h.academicYear})` : ''}`;
        cross[k] = (cross[k] || 0) + 1;
      }
    }
    for (const [k, n] of Object.entries(cross)) out.push(`B. ${k}: ${n} report(s)`);
  }

  const drafts = await col('report_card_draft_comments').find({ schoolId })
    .project({ studentId: 1, termNumber: 1, cycle: 1, academicYearId: 1, updatedAt: 1, createdAt: 1, subjectComments: 1 }).toArray();

  const boxes = new Map(drafts.filter(d => !d.cycle && hasText(d.subjectComments)).map(d => [`${d.studentId}|${d.termNumber}`, d]));
  const blank = {};
  const cycles = col('report_card_snapshots').find({ schoolId, superseded: { $ne: true }, cycle: { $nin: [null, ''] } })
    .project({ studentId: 1, termNumber: 1, cycle: 1, academicYear: 1, academicYearId: 1, 'comments.subjectComments': 1 });
  for await (const s of cycles) {
    if (currentYearId && s.academicYearId && s.academicYearId !== currentYearId) continue;
    if (hasText(s.comments?.subjectComments) || !boxes.has(`${s.studentId}|${s.termNumber}`)) continue;
    const k = `${s.cycle}, Term ${s.termNumber}${s.academicYear ? ` (${s.academicYear})` : ''}`;
    blank[k] = (blank[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(blank)) out.push(`C. ${k}: ${n} published report(s) without the Markbook's comments`);

  const scope = { yearId: currentYearId, currentYearId, years };
  const notShown = drafts.filter(d => !d.academicYearId && !untaggedBelongsTo(d.updatedAt || d.createdAt, scope));
  if (notShown.length) {
    out.push(`D. ${notShown.length} of ${drafts.length} comment rows would not show in ${current?.name} (starts ${current?.startDate}); saved ${span(notShown.map(d => day(d.updatedAt || d.createdAt)))}`);
  }

  const seen = new Map();
  for (const d of drafts) {
    const k = [d.studentId, d.termNumber, d.cycle || '', d.academicYearId || ''].join('|');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dupes = [...seen.values()].filter(n => n > 1).length;
  if (dupes) out.push(`E. ${dupes} duplicate comment row(s)`);

  const sched = await col('assessment_schedule').find({ schoolId, academicYearId: { $nin: [null, ''] } }).project({ academicYearId: 1 }).toArray();
  const orphan = sched.filter(s => !known.has(String(s.academicYearId))).length;
  if (orphan) out.push(`F. ${orphan} of ${sched.length} schedule entries name a year this school no longer has`);

  console.log(`\n${school.name || schoolId} — ${drafts.length} comment rows; current year ${current ? `${current.name} (${current.startDate || '?'} to ${current.endDate || '?'})` : 'not set'}`);
  console.log(out.length ? out.map(l => `  ${l}`).join('\n') : '  nothing found');
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI,
    process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {});
  const schools = await col('schools').find({}).project({ id: 1, name: 1, slug: 1 }).sort({ name: 1 }).toArray();
  const picked = schools.filter(s => s.id && (!SLUG || [s.slug, s.name].some(v => String(v || '').toLowerCase().includes(SLUG))));
  if (!picked.length) console.log('No matching school.');
  for (const s of picked) await checkSchool(s);
  console.log('\nRead-only check finished. Nothing was changed.');
  await mongoose.disconnect();
}

run().then(() => process.exit(0)).catch(err => { console.error(err.message); process.exit(1); });
