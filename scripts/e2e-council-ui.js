/* ============================================================
   scripts/e2e-council-ui.js — Student Council WEB UI end-to-end

   Boots the real server on an in-memory MongoDB (demo tenant seeded)
   and drives the production web build in headless Chrome through the
   whole council journey:

     admin     appoint a member, create an election
     member    file a suggestion, follow it, stand for a seat
     student   upvote, file a safety grievance, file an anonymous case
     member    claim the anonymous case, reply
     admin     see identities + safeguarding, resolve the safety case,
               vet the nomination, open voting
     student   vote
     admin     close & tally, confirm the elected seat
     teacher   confirm the module is hidden and direct URL is refused

   Run (builds the client first):
     npm run e2e:council:ui

   Screenshots of any failure land in test-results/council-ui/.
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const puppeteer = require('puppeteer');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = path.join(__dirname, '..');
const PORT = 3136;
const BASE = `http://127.0.0.1:${PORT}`;
const SLUG = 'demo';
const OUT_DIR = path.join(ROOT, 'test-results', 'council-ui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('\nStudent Council — web UI e2e\n─────────────────────────────');

  if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) {
    throw new Error('client/dist is missing — run `npm run e2e:council:ui` (it builds first).');
  }

  const mongo = await MongoMemoryServer.create({ instance: { dbName: 'innolearn' } });
  const uri = mongo.getUri();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: uri, PORT: String(PORT), NODE_ENV: 'development', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d.toString(); });
  server.stderr.on('data', (d) => { serverLog += d.toString(); });

  let browser = null;
  let page = null;
  let passed = 0;

  const step = (msg) => console.log(`\n· ${msg}`);

  async function waitText(text, timeout = 20_000) {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout },
      text,
    );
  }
  async function textGone(text, timeout = 15_000) {
    await page.waitForFunction(
      (t) => !document.body.innerText.includes(t),
      { timeout },
      text,
    );
  }
  async function clickTest(id) {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 15_000 });
    await page.click(`[data-testid="${id}"]`);
  }
  async function waitTestGone(id, timeout = 10_000) {
    await page.waitForFunction(
      (sel) => !document.querySelector(sel),
      { timeout },
      `[data-testid="${id}"]`,
    );
  }
  async function fillTest(id, value) {
    const sel = `[data-testid="${id}"]`;
    await page.waitForSelector(sel, { timeout: 15_000 });
    await page.click(sel);
    await page.type(sel, value, { delay: 5 });
  }
  async function clickButtonContaining(text) {
    const ok = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes(t) && !x.disabled);
      if (b) { b.click(); return true; }
      return false;
    }, text);
    assert(ok, `button containing "${text}" exists`);
  }
  async function loginQuick(testid, landedText) {
    await page.goto(`${BASE}/login?school=${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 20_000 });
    await page.click(`[data-testid="${testid}"]`);
    await waitText(landedText, 25_000);
  }
  async function loginPassword(username) {
    await page.goto(`${BASE}/login?school=${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email', { timeout: 20_000 });
    await page.type('#email', username, { delay: 5 });
    await page.type('#password', 'Demo2025!', { delay: 5 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Sign in/.test(x.innerText));
      if (b) b.click();
    });
    await waitText('Student Portal', 25_000);
  }
  async function logout() {
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(`${BASE}/login?school=${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="quick-administrator"]', { timeout: 20_000 });
  }
  async function openCouncilAdmin() {
    await page.goto(`${BASE}/council`, { waitUntil: 'networkidle2' });
    await waitText('OPEN CASES', 20_000);
  }
  async function openStudentCouncil() {
    await page.goto(`${BASE}/student-council`, { waitUntil: 'networkidle2' });
    await waitText('Have your say', 20_000);
  }
  async function openElectionRow() {
    await page.waitForSelector('[data-testid="election-row"]', { timeout: 15_000 });
    // The list refetches on mount; let the row settle before clicking it.
    await sleep(600);
    await page.click('[data-testid="election-row"]');
    await waitText('CANDIDATES', 20_000);
  }
  async function fillDate(index, value) {
    await page.evaluate(({ i, v }) => {
      const el = [...document.querySelectorAll('input[type="datetime-local"]')][i];
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { i: index, v: value });
  }
  function dtLocal(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  try {
    step('booting server');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* retry */ }
      await sleep(800);
    }
    console.log('  · API up');

    await mongoose.connect(uri, { dbName: 'innolearn' });
    step('waiting for the demo seed');
    let member = null;
    const seedDeadline = Date.now() + 180_000;
    while (Date.now() < seedDeadline) {
      const users = await mongoose.connection.collection('users').find({
        schoolId: 'sch_demo', role: 'student', isActive: true,
        studentId: { $nin: [null, undefined] },
        username: { $nin: [null, '', 'demo-student'] },
        password: { $exists: true },
      }).limit(5).toArray();
      if (users.length) {
        const u = users[0];
        member = {
          studentId: u.studentId,
          username: u.username,
          firstName: String(u.name || 'Student').split(/\s+/)[0],
          name: u.name || 'Student',
        };
        break;
      }
      await sleep(1500);
    }
    if (!member) throw new Error('demo seed did not produce a pupil login');
    console.log(`  · member actor: ${member.name} (${member.username})`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('dialog', (d) => d.accept());

    /* 1 ── Patron appoints a council member ---------------------- */
    step('admin: appoint a member');
    await loginQuick('quick-administrator', 'Dashboard');
    await openCouncilAdmin();
    await clickTest('council-tab-members');
    await waitText('No council members yet');
    await clickTest('appoint-member');
    await waitText('Appoint a council member');
    await fillTest('appoint-search', member.firstName);
    await waitText(member.name);
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes(name));
      if (b) b.click();
    }, member.name);
    await fillTest('appoint-position', 'Secretary');
    await clickTest('appoint-confirm');
    await waitText('Secretary · appointed');
    await waitTestGone('appoint-confirm');
    assert(true, 'member appointed through the UI');
    passed += 1;

    /* 2 ── Patron creates an election ---------------------------- */
    step('admin: create an election');
    await clickTest('council-tab-elections');
    await clickTest('new-election');
    await waitText('New council election');
    await page.type('input[placeholder="Student Council Elections 2027"]', 'UI E2E Council 2027', { delay: 5 });
    await page.type('input[placeholder="Term 1 · 2027"]', 'Term 1', { delay: 5 });
    const now = Date.now();
    await fillDate(0, dtLocal(now - 3_600_000));
    await fillDate(1, dtLocal(now + 3_600_000));
    await fillDate(2, dtLocal(now + 7_200_000));
    await fillDate(3, dtLocal(now + 10_800_000));
    await page.type('input[placeholder="Chairperson"]', 'Chairperson', { delay: 5 });
    await clickTest('create-election');
    await waitText('UI E2E Council 2027');
    await waitTestGone('create-election');
    assert(true, 'election created through the UI');
    passed += 1;

    /* 3 ── Member files a suggestion ----------------------------- */
    step('member: file a suggestion');
    await logout();
    await loginPassword(member.username);
    await openStudentCouncil();
    await waitText('Secretary · appointed');
    await clickTest('student-tab-submit');
    await clickTest('kind-suggestion');
    await clickTest('category-facilities');
    await fillTest('case-title', 'Better Wi-Fi in the dormitories');
    await fillTest('case-body', 'Study time is limited because the dorm Wi-Fi drops every evening. Could we get a second access point?');
    await clickTest('case-submit');
    await waitText('Filed as SC-');
    assert(true, 'suggestion filed with a case reference');
    passed += 1;
    await clickButtonContaining('See my cases');
    await waitText('Better Wi-Fi in the dormitories');
    await clickButtonContaining('Better Wi-Fi in the dormitories');
    await fillTest('reply-input', 'Thank you — noted for the estates meeting.');
    await clickTest('reply-send');
    await waitText('noted for the estates meeting');
    assert(true, 'member sees their own case and can reply');
    passed += 1;

    /* 4 ── Member stands for a seat ------------------------------ */
    step('member: stand for a seat');
    await clickTest('student-tab-votes');
    await waitText('Nominations open');
    await clickTest('nominate');
    await waitText('waiting for staff vetting');
    assert(true, 'nomination submitted through the UI');
    passed += 1;

    /* 5 ── Student upvotes the suggestion ------------------------ */
    step('student: upvote + file cases');
    await logout();
    await loginQuick('quick-student', 'Student Portal');
    await openStudentCouncil();
    await clickTest('student-tab-ideas');
    await waitText('Better Wi-Fi in the dormitories');
    const upClicked = await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')]
        .filter((d) => d.querySelector('button[title]') && d.innerText.includes('Better Wi-Fi in the dormitories'))
        .sort((a, b) => a.innerText.length - b.innerText.length)[0];
      const b = card && card.querySelector('button[title="Upvote this suggestion"]');
      if (b) { b.click(); return true; }
      return false;
    });
    assert(upClicked, 'suggestion is visible and upvotable');
    await page.waitForFunction(() => !!document.querySelector('button[title="Remove your upvote"]'), { timeout: 15_000 });
    assert(true, 'upvote registered and toggled on');
    passed += 1;

    /* 6 ── Safety grievance -------------------------------------- */
    step('student: safety grievance');
    await clickTest('student-tab-submit');
    await clickTest('category-safety');
    await fillTest('case-title', 'Unsafe corridor lights');
    await fillTest('case-body', 'The corridor lights have been out for a week and it is dangerous after games.');
    await clickTest('case-submit');
    await waitText('gone straight to school staff');
    assert(true, 'safety case shows the safeguarding copy');
    passed += 1;

    /* 7 ── Anonymous ordinary case ------------------------------- */
    step('student: anonymous grievance');
    await clickTest('student-tab-mine');
    await clickTest('student-tab-submit');
    await clickTest('category-welfare');
    await fillTest('case-title', 'Gate supervision');
    await fillTest('case-body', 'Nobody is watching the gate after 5pm and younger learners walk home alone.');
    await page.click('[data-testid="case-anonymous"]');
    await clickTest('case-submit');
    await waitText('Filed as SC-');
    await clickButtonContaining('See my cases');
    await waitText('Gate supervision');
    assert(true, 'anonymous grievance filed and listed');
    passed += 1;

    /* 8 ── Member queue: masked reporter, claim, reply ------------ */
    step('member: queue claim + reply');
    await logout();
    await loginPassword(member.username);
    await openStudentCouncil();
    await clickTest('student-tab-queue');
    await waitText('Gate supervision');
    const queueText = await page.evaluate(() => document.body.innerText);
    assert(queueText.includes('Anonymous ·'), 'queue masks the reporter');
    assert(!queueText.includes('Amara Osei'), 'queue does not leak the reporter name');
    await clickButtonContaining('Gate supervision');
    await clickTest('claim-case');
    await waitText('Assigned');
    await fillTest('queue-reply-input', 'We will ask the office to add a second guard at the gate.');
    await clickTest('queue-reply-send');
    await waitText('second guard at the gate');
    assert(true, 'member claimed and replied to the anonymous case');
    passed += 1;

    /* 9 ── Patron oversight -------------------------------------- */
    step('admin: identities + safeguarding filter');
    await logout();
    await loginQuick('quick-administrator', 'Dashboard');
    await openCouncilAdmin();
    await waitText('Unsafe corridor lights');
    const casesText = await page.evaluate(() => document.body.innerText);
    assert(casesText.includes('Safeguarding'), 'safeguarding badge is visible');
    assert(casesText.includes('Amara Osei'), 'patron sees the reporter behind anonymity');
    passed += 1;
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('input[type="checkbox"]')].find((x) => x.parentElement.innerText.includes('Safeguarding only'));
      if (cb) cb.click();
    });
    await waitText('Safeguarding only');
    await waitText('Unsafe corridor lights');
    const filtered = await page.evaluate(() => document.body.innerText);
    assert(!filtered.includes('Gate supervision'), 'safeguarding filter hides ordinary cases');
    passed += 1;

    /* 10 ── Patron resolves the safety case ---------------------- */
    step('admin: resolve safeguarding case');
    await clickButtonContaining('Unsafe corridor lights');
    await waitText('Save update');
    await fillTest('staff-note', 'Facilities replaced the corridor lights today.');
    await page.select('[data-testid="staff-status"]', 'resolved');
    await clickTest('staff-save');
    await waitText('RESOLVED');
    assert(true, 'staff note + resolved status applied');
    passed += 1;
    await clickTest('close-case');
    await waitTestGone('close-case');

    /* 11 ── Vet nomination, open voting -------------------------- */
    step('admin: vet + open voting');
    await clickTest('council-tab-elections');
    await waitText('UI E2E Council 2027');
    await openElectionRow();
    await page.waitForSelector('button[title="Approve"]', { timeout: 15_000 });
    await page.click('button[title="Approve"]');
    await waitText('APPROVED');
    await clickTest('start-voting');
    await waitText('VOTING');
    assert(true, 'nomination approved and voting opened');
    passed += 1;

    /* 12 ── Student votes ---------------------------------------- */
    step('student: vote');
    await logout();
    await loginQuick('quick-student', 'Student Portal');
    await openStudentCouncil();
    await clickTest('student-tab-votes');
    await waitText('Voting open');
    await clickButtonContaining(member.name);
    await waitText('Voted');
    assert(true, 'ballot cast once, marked Voted');
    passed += 1;

    /* 13 ── Close + seat ----------------------------------------- */
    step('admin: close + elect');
    await logout();
    await loginQuick('quick-administrator', 'Dashboard');
    await openCouncilAdmin();
    await clickTest('council-tab-elections');
    await waitText('UI E2E Council 2027');
    await openElectionRow();
    await clickTest('close-election');
    await waitText('RESULTS');
    await waitText('elected');
    assert(true, 'results published with the elected candidate');
    passed += 1;
    await clickTest('council-tab-members');
    await waitText('Chairperson · elected');
    const membersText = await page.evaluate(() => document.body.innerText);
    assert(membersText.includes('Secretary · appointed'), 'appointed seat retained in history as ended');
    assert(true, 'elected Chairperson seated');
    passed += 1;

    /* 14 ── Least privilege -------------------------------------- */
    step('teacher: no council access');
    await logout();
    await loginQuick('quick-teacher', 'Dashboard');
    const navHasCouncil = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      return nav ? nav.innerText.includes('Student Council') : false;
    });
    assert(!navHasCouncil, 'teacher nav does not list the council');
    await page.goto(`${BASE}/council`, { waitUntil: 'networkidle2' });
    await waitText('don’t have access');
    assert(true, 'direct URL shows the access-denied state');
    passed += 1;

    console.log(`\n  ${passed} UI checks passed\n`);
  } catch (err) {
    console.error(`\n  ✗ UI e2e failed: ${err.message}`);
    if (page) {
      try {
        const file = path.join(OUT_DIR, `failure-${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.error(`  · screenshot: ${file}`);
      } catch { /* ignore */ }
      try {
        const body = await page.evaluate(() => document.body.innerText.slice(0, 1200));
        console.error(`  · page text:\n${body}`);
      } catch { /* ignore */ }
    }
    console.error(serverLog.split('\n').slice(-20).join('\n'));
    process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    server.kill('SIGTERM');
    await sleep(1200);
    if (server.exitCode === null) server.kill('SIGKILL');
    await mongo.stop();
  }
})();

