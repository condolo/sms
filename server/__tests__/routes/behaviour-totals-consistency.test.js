/* ============================================================
   Behaviour totals add up everywhere (v5.276.0)

   Reported (2026-11-16): "the behaviour incidents dashboard and what is
   downloaded don't add up, particularly in net points … some points
   were hidden when downloading", and house points were expected in the
   report. Pins, through the real routes and the real report renderer:
     - GET /behaviour/totals counts every incident (not the newest 200),
       excludes deleted ones, and signs points by type;
     - the export's totals and the dashboard's agree on the same data;
     - the export's totals, staff and house figures cover every incident
       even when the row list is capped;
     - the report includes house points that add up to its net total;
     - new and edited incidents are saved with merit +, demerit −;
     - the incident list and student summary skip deleted incidents.
   ============================================================ */
'use strict';

let mockJwtUser;
let mockHtml = '';
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => true, hasPermission: async () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn(async () => ({})) }));
jest.mock('../../utils/email', () => ({ sendBehaviourIncidentAlert: jest.fn(async () => true) }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/academic-period', () => ({ resolveAcademicPeriod: async () => ({ academicYearId: 'ay1', termId: 't1' }) }));
jest.mock('../../utils/archival', () => ({ isYearArchived: async () => false, firstArchivedYear: async () => null }));
jest.mock('../../utils/html-to-pdf', () => ({
  htmlToPdfBufferOrFallback: async (html) => { mockHtml = html; return Buffer.from('%PDF-fake'); },
}));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));

const express = require('express');
const supertest = require('supertest');
const router = require('../../routes/behaviour');
const { signedPoints, totalsOf } = require('../../utils/behaviour-points');

const S = 'sch_1';
const ADMIN = { userId: 'u_admin', schoolId: S, role: 'admin', roles: ['admin'] };
const app = () => { const a = express(); a.use(express.json()); a.use('/api/behaviour', router); return a; };
const api = () => { mockJwtUser = ADMIN; return supertest(app()); };

let seq = 0;
const inc = (o) => ({ id: `i${++seq}`, schoolId: S, classId: 'c1', date: '2026-10-01', title: 'x', status: 'open', reportedBy: 'u_t1', ...o });

function seed(extraIncidents = []) {
  seq = 0;
  const students = [
    { id: 's_red1', schoolId: S, houseId: 'h_red', status: 'active', firstName: 'A', lastName: 'R' },
    { id: 's_red2', schoolId: S, houseId: 'h_red', status: 'active', firstName: 'B', lastName: 'R' },
    { id: 's_blue', schoolId: S, house: 'h_blue', status: 'active', firstName: 'C', lastName: 'B' },  // legacy field
    { id: 's_none', schoolId: S, status: 'active', firstName: 'D', lastName: 'N' },
  ];
  // 250 merits of 1 point for s_red1 — more than the list endpoint's 200 page cap.
  const many = Array.from({ length: 250 }, (_, k) => inc({ studentId: 's_red1', type: 'merit', points: 1, date: `2026-09-${String((k % 28) + 1).padStart(2, '0')}` }));
  mockDb = createFakeDb({
    schools: [{ id: S, name: 'Test School', houses: [{ id: 'h_red', name: 'Red', color: '#f00' }, { id: 'h_blue', name: 'Blue', color: '#00f' }] }],
    students,
    users: [{ id: 'u_t1', schoolId: S, name: 'Teacher One', role: 'teacher' }, { id: 'u_admin', schoolId: S, name: 'Admin', role: 'admin' }],
    classes: [{ id: 'c1', schoolId: S, name: 'Year 7' }],
    behaviour_points_resets: [],
    behaviour_incidents: [
      ...many,
      inc({ studentId: 's_red2', type: 'demerit', points: -3 }),
      inc({ studentId: 's_blue', type: 'demerit', points: 2 }),        // stored with the wrong sign: still −2
      inc({ studentId: 's_blue', type: 'merit', points: 5 }),
      inc({ studentId: 's_none', type: 'merit', points: 4, reportedBy: undefined, createdBy: 'u_t1' }),
      inc({ studentId: 's_red2', type: 'merit', points: 50, deletedAt: '2026-10-02T00:00:00Z' }),   // deleted: never counts
      ...extraIncidents,
    ],
  });
}

// Expected (deleted excluded, signed by type): merits 250+5+4 = 259 pts; demerits 3+2 = 5 pts; net 254.
describe('GET /behaviour/totals', () => {
  beforeEach(() => seed());
  test('counts every incident, excludes deleted ones, signs by type', async () => {
    const res = await api().get('/api/behaviour/totals');
    expect(res.status).toBe(200);
    expect(res.body.data.allTime).toMatchObject({ events: 254, merits: 252, demerits: 2, meritPoints: 259, demeritPoints: 5, net: 254 });
  });
  test('house standings: each incident counts for its student\x27s house (legacy field too); "No house" makes them add up', async () => {
    const { houses } = (await api().get('/api/behaviour/totals')).body.data;
    const by = Object.fromEntries(houses.map(h => [h.name, h]));
    expect(by.Red).toMatchObject({ members: 2, net: 247, meritPoints: 250, demeritPoints: 3 });
    expect(by.Blue).toMatchObject({ members: 1, net: 3 });
    expect(by['No house']).toMatchObject({ net: 4 });
    expect(houses.reduce((n, h) => n + h.net, 0)).toBe(254);
  });
  test('house standings follow the latest points reset', async () => {
    mockDb.data.behaviour_points_resets.push({ schoolId: S, resetAt: '2026-09-30T00:00:00Z' });
    const d = (await api().get('/api/behaviour/totals')).body.data;
    expect(d.resetAt).toBe('2026-09-30');
    expect(d.allTime.net).toBe(254);
    expect(d.sinceReset.net).toBe(4);                // only the 1 Oct incidents
    expect(d.houses.find(h => h.name === 'Red').net).toBe(-3);
  });
});

describe('the downloaded report adds up with the dashboard', () => {
  beforeEach(() => seed());
  test('whole-school report: same net as the dashboard, house points included and adding up', async () => {
    const dash = (await api().get('/api/behaviour/totals')).body.data.allTime;
    const res = await api().get('/api/behaviour/incidents/export-pdf');
    expect(res.status).toBe(200);
    expect(mockHtml).toMatch(new RegExp(`Net Points[\\s\\S]*?\\+${dash.net}<`));
    expect(mockHtml).toMatch(/House Points/);
    expect(mockHtml).toMatch(/Red[\s\S]*?\+247/);
    expect(mockHtml).toMatch(/Total<\/td>[\s\S]*?\+254/);
    expect(mockHtml).not.toMatch(/\+50</);             // the deleted incident is nowhere
    expect(mockHtml).toMatch(/Teacher One/);             // createdBy-only entry attributed
  });
  test('totals cover every incident even when the row list is capped at 3000', async () => {
    const more = Array.from({ length: 3000 }, () => inc({ studentId: 's_blue', type: 'merit', points: 1, date: '2026-08-01' }));
    seed(more);
    await api().get('/api/behaviour/incidents/export-pdf');
    expect(mockHtml).toMatch(/Listing the latest 3000 of 3254 incidents/);
    expect(mockHtml).toMatch(/Net Points[\s\S]*?\+3254</);
  });
});

describe('saving and listing', () => {
  beforeEach(() => seed());
  test('a demerit typed as positive is saved negative; a merit typed negative is saved positive', async () => {
    let r = await api().post('/api/behaviour/incidents').send({ studentId: 's_red1', type: 'demerit', points: 4, title: 'Late' });
    expect(r.status).toBe(201);
    expect(r.body.data.points).toBe(-4);
    r = await api().post('/api/behaviour/incidents').send({ studentId: 's_red1', type: 'merit', points: -6, title: 'Help' });
    expect(r.body.data.points).toBe(6);
    const id = r.body.data.id;
    await api().put(`/api/behaviour/incidents/${id}`).send({ type: 'demerit' });
    expect(mockDb.data.behaviour_incidents.find(i => i.id === id).points).toBe(-6);
  });
  test('incidents saved without a student name show the student\x27s name, not the id', async () => {
    const res = await api().get('/api/behaviour/incidents').query({ studentId: 's_red2' });
    expect(res.body.data[0].studentName).toBe('B R');
  });
  test('the incident list skips deleted incidents', async () => {
    const res = await api().get('/api/behaviour/incidents').query({ studentId: 's_red2', limit: 50 });
    expect(res.body.data.map(i => i.points)).toEqual([-3]);
  });
});

describe('the rules themselves', () => {
  test('signedPoints and totalsOf', () => {
    expect(signedPoints({ type: 'merit', points: -2 })).toBe(2);
    expect(signedPoints({ type: 'demerit', points: 2 })).toBe(-2);
    expect(signedPoints({ type: 'neutral', points: 1 })).toBe(1);
    expect(totalsOf([{ type: 'merit', points: 3 }, { type: 'demerit', points: 1 }, { type: 'neutral', points: 0 }]))
      .toMatchObject({ events: 3, merits: 1, demerits: 1, neutral: 1, meritPoints: 3, demeritPoints: 1, net: 2 });
  });
});

describe('House filter (v5.276.0)', () => {
  beforeEach(() => seed());
  test('the list narrows to a house\x27s students (legacy house field too), and to students with no house', async () => {
    const red = await api().get('/api/behaviour/incidents').query({ houseId: 'h_red', limit: 200 });
    expect(new Set(red.body.data.map(i => i.studentId))).toEqual(new Set(['s_red1', 's_red2']));
    expect(red.body.pagination.total).toBe(251);           // 250 + 1, the deleted one excluded
    const blue = await api().get('/api/behaviour/incidents').query({ houseId: 'h_blue' });
    expect(blue.body.data.map(i => i.studentId).every(id => id === 's_blue')).toBe(true);
    const none = await api().get('/api/behaviour/incidents').query({ houseId: 'none' });
    expect(none.body.data.map(i => i.studentId)).toEqual(['s_none']);
  });
  test('house combines with a student filter instead of replacing it', async () => {
    const res = await api().get('/api/behaviour/incidents').query({ houseId: 'h_blue', studentId: 's_red2' });
    expect(res.body.data).toEqual([]);
  });
  test('the report follows the house filter and names it', async () => {
    await api().get('/api/behaviour/incidents/export-pdf').query({ houseId: 'h_blue' });
    expect(mockHtml).toMatch(/Whole School · House: Blue/);
    expect(mockHtml).toMatch(/Net Points[\s\S]*?\+3</);
    expect(mockHtml).not.toMatch(/Red</);
  });
});
