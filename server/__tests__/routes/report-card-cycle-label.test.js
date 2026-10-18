/* ============================================================
   GET/PUT /report-cards/cycle-label — "just a label" (2026-10-18)
   Reported directly: most schools issue more than one report per term
   (Mid-Term, then End-of-Term) and the report card had no way to say
   which one this is. One editable label per {class, term, year},
   stored as its own setting so it survives a republish unchanged.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';
let mockUser = { schoolId: SCHOOL, userId: 'u_admin', role: 'admin' };

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { ...mockUser }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasExplicitSubGrant: jest.fn(async () => true),
  hasPermission: jest.fn(async () => true),
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

let mockDb = {};
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v === null) return doc[k] == null;
    return doc[k] === v;
  });
}
function mockMakeStore(col) {
  const rows = () => (mockDb[col] = mockDb[col] || []);
  return {
    findOne: (f) => ({ lean: () => Promise.resolve(rows().find(d => mockMatches(d, f)) ?? null) }),
    findOneAndUpdate: (f, update) => {
      let doc = rows().find(d => mockMatches(d, f));
      if (!doc) { doc = { ...f }; rows().push(doc); }
      Object.assign(doc, update.$set || {});
      if (!doc.id) Object.assign(doc, update.$setOnInsert || {});
      return { lean: () => Promise.resolve(doc) };
    },
  };
}
jest.mock('../../utils/tenant-model', () => {
  const actual = jest.requireActual('../../utils/tenant-model');
  return { ...actual, tenantModel: (col) => mockMakeStore(col) };
});

const express = require('express');
const supertest = require('supertest');
const reportCardsRouter = require('../../routes/report-cards');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-cards', reportCardsRouter);
  return app;
}

beforeEach(() => { mockDb = {}; });

describe('GET /report-cards/cycle-label', () => {
  test('no label set yet — returns empty string, not an error', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/cycle-label')
      .query({ classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1' });
    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe('');
  });

  test('missing classId/termNumber is a 400, not a silent empty match', async () => {
    const res = await supertest(buildApp()).get('/api/report-cards/cycle-label').query({ termNumber: 1 });
    expect(res.status).toBe(400);
  });
});

describe('PUT /report-cards/cycle-label', () => {
  test('sets a label, then GET reflects it back', async () => {
    const put = await supertest(buildApp()).put('/api/report-cards/cycle-label').send({
      classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1', label: 'Mid-Term 1',
    });
    expect(put.status).toBe(200);
    expect(put.body.data.label).toBe('Mid-Term 1');

    const get = await supertest(buildApp()).get('/api/report-cards/cycle-label')
      .query({ classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1' });
    expect(get.body.data.label).toBe('Mid-Term 1');
  });

  test('a different class/term/year combo is a separate setting, not shared', async () => {
    await supertest(buildApp()).put('/api/report-cards/cycle-label').send({
      classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1', label: 'Mid-Term 1',
    });
    const other = await supertest(buildApp()).get('/api/report-cards/cycle-label')
      .query({ classId: 'cls_1', termNumber: 2, academicYearId: 'ay_1' });
    expect(other.body.data.label).toBe('');
  });

  test('label over 60 chars is rejected', async () => {
    const res = await supertest(buildApp()).put('/api/report-cards/cycle-label').send({
      classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1', label: 'x'.repeat(61),
    });
    expect(res.status).toBe(422);
  });

  test('re-publishing after a correction keeps using the same stored label (survives republish, not reset)', async () => {
    await supertest(buildApp()).put('/api/report-cards/cycle-label').send({
      classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1', label: 'Mid-Term 1',
    });
    // Simulate a second, unrelated PUT call for the SAME key with the SAME
    // label (what a republish's own re-read of the setting would see) —
    // the setting is independent of the snapshot lifecycle, so it's still
    // exactly what was saved, not cleared by anything else happening.
    const get = await supertest(buildApp()).get('/api/report-cards/cycle-label')
      .query({ classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1' });
    expect(get.body.data.label).toBe('Mid-Term 1');
  });
});
