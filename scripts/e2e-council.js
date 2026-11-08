/* ============================================================
   scripts/e2e-council.js — Student Council end-to-end proof

   Spawns the REAL server against an in-memory MongoDB (mongodb-memory-
   server, a devDependency), waits for the demo tenant seed, then drives
   the whole feature over HTTP as four different actors:

     pupil A     files an anonymous suggestion and a safety grievance
     member B    appointed to the council; sees A masked, replies,
                 cannot close the safeguarding case
     admin       sees A's identity, runs an election and closes it
     pupil A     votes once, reads the published result

   No mocks in the application path: real routes, real middleware, real
   tenantModel, real notification dispatch.

   Usage:  node scripts/e2e-council.js
   Requires network on first run (downloads a MongoDB binary).
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = path.join(__dirname, '..');
const MAIL_DIR = path.join(ROOT, '.mail');

const PORT = 3135;
const BASE = `http://127.0.0.1:${PORT}`;
const SLUG = 'demo';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-School-Slug': SLUG,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Server exited during startup');
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('Server did not become healthy in 120s');
}

async function waitForDemoSeed() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/public/schools/search?q=demo`);
      const json = await res.json();
      if ((json.results || []).some((r) => r.slug === SLUG)) return;
    } catch { /* retry */ }
    await sleep(1500);
  }
  throw new Error('Demo seed did not appear in 120s');
}

async function login(identifier, password = 'Demo2025!') {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier, password, schoolSlug: SLUG, platform: 'mobile' },
  });
  if (res.status !== 200 || !res.json?.data?.token) {
    throw new Error(`Login failed for ${identifier}: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json.data.token;
}

(async () => {
  console.log('\nStudent Council — end-to-end\n─────────────────────────────');

  const mongo = await MongoMemoryServer.create({ instance: { dbName: 'msingi_e2e' } });
  const uri = mongo.getUri();
  console.log('  · in-memory MongoDB ready');

  const childEnv = {
    ...process.env,
    MONGODB_URI: uri,
    PORT: String(PORT),
    NODE_ENV: 'development',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
  };
  const child = spawn(process.execPath, ['server/index.js'], {
    env: childEnv,
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const mailSink = spawn(process.execPath, ['scripts/dev-mail.js'], {
    env: { ...process.env, DEV_MAIL_PORT: '1025' },
    cwd: ROOT,
    stdio: 'ignore',
  });
  await sleep(1200);
  const priorMails = fs.existsSync(MAIL_DIR)
    ? new Set(fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith('.eml')))
    : new Set();
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  let ok = true;
  try {
    await waitForServer(child);
    await waitForDemoSeed();
    console.log('  · server up, demo tenant seeded');

    await mongoose.connect(uri, { dbName: 'innolearn' });
    const Users = mongoose.connection.collection('users');
    const Messages = mongoose.connection.collection('messages');
    const Cases = mongoose.connection.collection('council_cases');
    const Memberships = mongoose.connection.collection('council_memberships');
    const schoolId = 'sch_demo';

    /* Wait for the demo seed to finish creating its own pupil logins —
       the scenario seeder writes 9 of them. Writing our own here would
       race its unique (schoolId, username) index, so the e2e borrows two
       of the accounts it creates. */
    const seedDeadline = Date.now() + 180_000;
    let logins = [];
    let lastLog = 0;
    while (Date.now() < seedDeadline) {
      logins = await Users.find({
        schoolId, role: 'student', isActive: true,
        studentId: { $nin: [null, undefined] },
        username: { $nin: [null, ''] },
        password: { $exists: true },
      }).limit(2).toArray();
      if (logins.length >= 2) break;
      if (Date.now() - lastLog > 15_000) {
        const counts = {
          students: await mongoose.connection.collection('students').countDocuments({ schoolId }),
          users: await Users.countDocuments({ schoolId }),
          pupilLogins: await Users.countDocuments({ schoolId, role: 'student', studentId: { $nin: [null, undefined] } }),
        };
        console.log(`  · waiting for the demo seed… ${JSON.stringify(counts)}`);
        lastLog = Date.now();
      }
      await sleep(1500);
    }
    if (logins.length < 2) throw new Error('Demo seed did not produce two pupil logins');

    const toActor = (u) => ({
      sid: u.studentId,
      username: u.username,
      name: u.name || 'Pupil',
    });
    const [pupil, member] = logins.map(toActor);

    const adminToken = await login('admin@demo.msingi.io');
    const pupilToken = await login(pupil.username);
    const memberToken = await login(member.username);
    console.log('  · three sessions: admin, pupil, council member');

    /* Admin appoints the member. */
    let r = await api('/api/council/admin/memberships', {
      token: adminToken, method: 'POST',
      body: { studentId: member.sid, positionTitle: 'Secretary' },
    });
    check('admin appoints a council member', r.status === 201, `${r.status}`);

    r = await api('/api/council/me', { token: memberToken });
    check('member sees their seat', r.status === 200 && r.json?.data?.membership?.positionTitle === 'Secretary');

    /* Pupil files an anonymous suggestion. */
    r = await api('/api/council/cases', {
      token: pupilToken, method: 'POST',
      body: {
        kind: 'suggestion', category: 'facilities', anonymous: true,
        title: 'More bins near the field', body: 'The field has no bins and litter blows into class.',
      },
    });
    const suggestion = r.json?.data;
    check('pupil files an anonymous suggestion', r.status === 201 && /^SC-\d{4}-\d{4}$/.test(suggestion?.ref || ''), `${r.status}`);

    /* Member sees it masked in the queue. */
    r = await api('/api/council/queue', { token: memberToken });
    const queued = (r.json?.data?.cases || []).find((c) => c.id === suggestion.id);
    check('the suggestion reaches the council queue', Boolean(queued));
    check('the queue masks the reporter', queued?.reporter?.anonymous === true && queued?.reporter?.studentId === null);

    /* The suggestions feed: school-visible, still anonymous, upvotable. */
    r = await api('/api/council/suggestions', { token: memberToken });
    const inFeed = (r.json?.data || []).find((c) => c.id === suggestion.id);
    check('the suggestion appears in the student suggestions feed', Boolean(inFeed));
    check('the feed keeps the reporter anonymous', inFeed?.reporter?.anonymous === true);
    r = await api(`/api/council/cases/${suggestion.id}/upvote`, { token: memberToken, method: 'POST', body: {} });
    check('another student can upvote the suggestion', r.status === 200 && r.json?.data?.upvoteCount === 1);

    /* Member replies; pupil reads it. */
    r = await api(`/api/council/cases/${suggestion.id}/replies`, {
      token: memberToken, method: 'POST', body: { body: 'Noted — we will raise it with the grounds team.' },
    });
    check('member replies to the case', r.status === 200);
    r = await api('/api/council/cases', { token: pupilToken });
    const mine = (r.json?.data || []).find((c) => c.id === suggestion.id);
    check('pupil sees the reply in My cases', (mine?.replies || []).some((x) => /grounds team/.test(x.body)));

    /* A safeguarding grievance escalates and cannot be closed by students. */
    r = await api('/api/council/cases', {
      token: pupilToken, method: 'POST',
      body: {
        kind: 'grievance', category: 'safety', anonymous: true,
        title: 'Scared to walk home', body: 'A group waits at the gate every evening.',
      },
    });
    const safety = r.json?.data;
    check('safety grievance is escalated on creation', r.status === 201 && safety?.status === 'escalated');

    r = await api(`/api/council/cases/${safety.id}/status`, {
      token: memberToken, method: 'POST', body: { status: 'resolved', note: 'Handled.' },
    });
    check('council member cannot close a safeguarding case', r.status === 403, `${r.status}`);

    r = await api('/api/council/queue', { token: memberToken });
    check('safeguarding case stays out of the student queue',
      !(r.json?.data?.cases || []).some((c) => c.id === safety.id));

    r = await api('/api/council/admin/cases', { token: adminToken });
    const adminSafety = (r.json?.data || []).find((c) => c.id === safety.id);
    check('patron sees the safeguarding case', Boolean(adminSafety));
    check('patron sees the reporter behind anonymity',
      adminSafety?.reporter?.anonymous === false && Boolean(adminSafety?.reporter?.studentId));

    const adminUser = await Users.findOne({ id: 'u_demo_admin' });
    const alert = await Messages.findOne({
      schoolId, recipients: adminUser.id,
      subject: { $regex: /Safeguarding|safety/i },
    });
    check('safeguarding alert reached the patron inbox', Boolean(alert));

    const newMails = fs.existsSync(MAIL_DIR)
      ? fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith('.eml') && !priorMails.has(f))
      : [];
    check('the safeguarding email left through the school SMTP path', newMails.length >= 1, `${newMails.length} captured`);

    /* Election: nominate, vet, vote once, close, seat. */
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    r = await api('/api/council/admin/elections', {
      token: adminToken, method: 'POST',
      body: {
        title: 'E2E Council Election', termLabel: 'Term 1',
        nominationStart: iso(now - 3_600_000),
        nominationEnd:   iso(now + 3_600_000),
        votingStart:     iso(now + 7_200_000),
        votingEnd:       iso(now + 10_800_000),
        positions: [{ title: 'Chairperson', seats: 1 }],
      },
    });
    const election = r.json?.data;
    check('admin creates an election', r.status === 201 && election?.positions?.length === 1);
    const positionId = election.positions[0].id;

    r = await api(`/api/council/elections/${election.id}/nominate`, {
      token: memberToken, method: 'POST', body: { positionId },
    });
    check('member stands for a seat', r.status === 201);

    r = await api(`/api/council/admin/elections/${election.id}/candidates`, { token: adminToken });
    const candidacy = (r.json?.data || [])[0];
    check('nomination waits for vetting', candidacy?.status === 'pending');

    r = await api(`/api/council/admin/elections/${election.id}/candidates/${candidacy.id}/vet`, {
      token: adminToken, method: 'POST', body: { approve: true, reason: '' },
    });
    check('admin approves the candidacy', r.status === 200);

    /* Move the window into voting, then vote. */
    r = await api(`/api/council/admin/elections/${election.id}`, {
      token: adminToken, method: 'PATCH',
      body: { nominationEnd: iso(now - 60_000), votingStart: iso(now - 30_000), votingEnd: iso(now + 3_600_000) },
    });
    check('election enters the voting window', r.status === 200 && r.json?.data?.phase === 'voting');

    r = await api(`/api/council/elections/${election.id}/vote`, {
      token: pupilToken, method: 'POST', body: { positionId, candidateId: candidacy.id },
    });
    check('pupil votes', r.status === 200);
    r = await api(`/api/council/elections/${election.id}/vote`, {
      token: pupilToken, method: 'POST', body: { positionId, candidateId: candidacy.id },
    });
    check('a second vote for the same seat is refused', r.status === 400, `${r.status}`);

    r = await api(`/api/council/admin/elections/${election.id}/close`, { token: adminToken, method: 'POST', body: {} });
    check('admin closes and tallies the election', r.status === 200 && r.json?.data?.closed === true);
    check('the winner is seated automatically',
      Boolean(await Memberships.findOne({ schoolId, studentId: member.sid, source: 'elected', active: true })));

    r = await api('/api/council/elections', { token: pupilToken });
    const published = (r.json?.data || []).find((e) => e.id === election.id);
    check('results are published to students',
      published?.phase === 'closed' && published?.results?.[0]?.winners?.length === 1);

    const totalCases = await Cases.countDocuments({ schoolId });
    check('every filed case is persisted', totalCases >= 2, `${totalCases}`);
  } catch (err) {
    ok = false;
    failed += 1;
    console.error('\n  ✗ e2e aborted:', err.message);
    if (serverLog) console.error(serverLog.split('\n').slice(-25).join('\n'));
  } finally {
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    child.kill('SIGTERM');
    mailSink.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (child.exitCode === null) child.kill('SIGKILL');
    await mongo.stop();
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(ok && failed === 0 ? 0 : 1);
})();
