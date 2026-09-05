/* ============================================================
   server/routes/admissions.js — 2026-09 field update
   (Mother/Father split, required Gender/DOB, House, Allergies,
   Emergency Contact)

   Covers:
     1. Gender and Date of Birth are now genuinely required (were
        optional before this change) — server-side, not just a UI
        asterisk (the exact gap found and flagged for the parent-name
        field before this change: a client-only "required" that the
        API didn't actually enforce).
     2. At least one of Mother/Father (name + phone-or-email) is
        required — an application with neither has no one the school,
        or the eventual parent-portal account, can ever reach.
     3. _resolvePrimaryContact correctly derives the legacy
        parentName/parentEmail/parentPhone/parentRelationship fields —
        the ONLY fields the parent-portal-account route (students.js)
        and birthday emails (birthdays.js) actually read — from
        whichever parent is primary, so those two existing consumers
        keep working completely unchanged.
     4. A partial PUT that doesn't touch any guardian field never
        re-runs the guardian requirement or clobbers the derived
        fields; a partial PUT that touches only ONE guardian field
        (e.g. fatherPhone) still resolves correctly by merging against
        the already-stored record, not just the request body.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'u_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

const SCHOOL = 'sch_test';

function mockMatchFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockChain(result) { return { select: () => mockChain(result), lean: () => Promise.resolve(result) }; }

let mockAppDocs;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') return { findOne: () => mockChain({ academicYear: '2026' }) };
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'admissions') {
      return {
        findOne: (filter) => mockChain(mockAppDocs.find((d) => mockMatchFilter(d, filter)) ?? null),
        create:  (doc) => { const d = { ...doc }; mockAppDocs.push(d); return Promise.resolve(d); },
        findOneAndUpdate: (filter, update) => {
          const d = mockAppDocs.find((x) => mockMatchFilter(x, filter));
          if (!d) return mockChain(null);
          const { $push, ...rest } = update;
          Object.assign(d, rest);
          return mockChain({ ...d });
        },
      };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser.schoolId })),
}));

const express   = require('express');
const supertest = require('supertest');
const admissionsRouter = require('../../routes/admissions');
const { resolvePrimaryContact: _resolvePrimaryContact, validateGuardianRequirement: _validateGuardianRequirement } = require('../../utils/guardian-contact');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admissions', admissionsRouter);
  return app;
}

beforeEach(() => { mockAppDocs = []; });

const BASE = {
  firstName: 'Amara', lastName: 'Osei', gender: 'female', dateOfBirth: '2018-04-02',
  motherName: 'Adjoa Osei', motherPhone: '+254700000001', motherEmail: 'adjoa@example.com',
};

describe('_resolvePrimaryContact — unit', () => {
  test('defaults to mother when motherName is present and primaryContact is unset', () => {
    const r = _resolvePrimaryContact({ motherName: 'Adjoa', motherPhone: '0700', fatherName: 'Kwame', fatherPhone: '0711' });
    expect(r).toEqual({ parentName: 'Adjoa', parentEmail: '', parentPhone: '0700', parentRelationship: 'Mother' });
  });

  test('falls back to father when only father is filled', () => {
    const r = _resolvePrimaryContact({ fatherName: 'Kwame', fatherEmail: 'k@example.com' });
    expect(r).toEqual({ parentName: 'Kwame', parentEmail: 'k@example.com', parentPhone: '', parentRelationship: 'Father' });
  });

  test('explicit primaryContact="father" wins even when mother is also filled', () => {
    const r = _resolvePrimaryContact({ primaryContact: 'father', motherName: 'Adjoa', fatherName: 'Kwame', fatherPhone: '0711' });
    expect(r).toEqual({ parentName: 'Kwame', parentEmail: '', parentPhone: '0711', parentRelationship: 'Father' });
  });

  test('returns null when neither parent has a name', () => {
    expect(_resolvePrimaryContact({})).toBeNull();
  });
});

describe('_validateGuardianRequirement — unit', () => {
  test('passes with mother name + email (phone optional, not provided)', () => {
    expect(_validateGuardianRequirement({ motherName: 'Adjoa', motherEmail: 'adjoa@example.com' })).toBeNull();
  });
  test('passes with father name + email only', () => {
    expect(_validateGuardianRequirement({ fatherName: 'Kwame', fatherEmail: 'k@example.com' })).toBeNull();
  });
  test('THE TIGHTENED RULE (2026-09 per-parent-account follow-up): a name WITH a phone but NO email is now rejected — phone is no longer a substitute for email', () => {
    const result = _validateGuardianRequirement({ motherName: 'Adjoa', motherPhone: '0700' });
    expect(result).not.toBeNull();
    expect(result[0].field).toBe('motherEmail');
  });
  test('the same tightened rule applies to Father independently of Mother', () => {
    const result = _validateGuardianRequirement({ fatherName: 'Kwame', fatherPhone: '0711' });
    expect(result).not.toBeNull();
    expect(result[0].field).toBe('fatherEmail');
  });
  test('fails when a name is given but no phone AND no email for either parent', () => {
    expect(_validateGuardianRequirement({ motherName: 'Adjoa' })).not.toBeNull();
  });
  test('fails when neither parent is filled at all', () => {
    expect(_validateGuardianRequirement({})).not.toBeNull();
  });
});

describe('POST /api/admissions — required fields', () => {
  test('THE GAP THIS CLOSES: gender and dateOfBirth are now genuinely required server-side, not just a UI asterisk', async () => {
    const { gender, dateOfBirth, ...withoutRequired } = BASE;
    const res = await supertest(buildApp()).post('/api/admissions').send(withoutRequired);
    expect(res.status).toBe(422);
    const fields = res.body.error.issues.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['gender', 'dateOfBirth']));
  });

  test('rejects an application with neither Mother nor Father filled in', async () => {
    const { motherName, motherPhone, motherEmail, ...noParent } = BASE;
    const res = await supertest(buildApp()).post('/api/admissions').send(noParent);
    expect(res.status).toBe(422);
    expect(res.body.error.issues[0].message).toMatch(/at least one parent/i);
  });

  test('a valid application derives parentName/Email/Phone from the mother fields', async () => {
    const res = await supertest(buildApp()).post('/api/admissions').send(BASE);
    expect(res.status).toBe(201);
    expect(res.body.data.parentName).toBe('Adjoa Osei');
    expect(res.body.data.parentEmail).toBe('adjoa@example.com');
    expect(res.body.data.parentPhone).toBe('+254700000001');
    expect(res.body.data.parentRelationship).toBe('Mother');
    // The raw mother/father fields are preserved too — nothing is lost.
    expect(res.body.data.motherName).toBe('Adjoa Osei');
  });

  test('houseId/houseName and allergies/emergency contact round-trip through create', async () => {
    const res = await supertest(buildApp()).post('/api/admissions').send({
      ...BASE, houseId: 'house_1', houseName: 'Baobab', allergies: 'Peanuts',
      emergencyContactName: 'Aunt Abena', emergencyContactPhone: '0722000000', emergencyContactRelation: 'Aunt',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      houseId: 'house_1', houseName: 'Baobab', allergies: 'Peanuts',
      emergencyContactName: 'Aunt Abena', emergencyContactPhone: '0722000000', emergencyContactRelation: 'Aunt',
    });
  });
});

describe('PUT /api/admissions/:id — partial updates and re-derivation', () => {
  test('a partial update touching only pipeline stage does not re-run guardian validation or touch derived fields', async () => {
    mockAppDocs = [{ id: 'app_1', schoolId: SCHOOL, ...BASE, parentName: 'Adjoa Osei', parentEmail: 'adjoa@example.com', parentPhone: '+254700000001', parentRelationship: 'Mother', stage: 'enquiry' }];
    const res = await supertest(buildApp()).put('/api/admissions/app_1').send({ stage: 'application' });
    expect(res.status).toBe(200);
    expect(res.body.data.parentName).toBe('Adjoa Osei'); // untouched
  });

  test('a partial update to ONE guardian field (fatherPhone) re-derives correctly by merging against the stored record', async () => {
    mockAppDocs = [{
      id: 'app_2', schoolId: SCHOOL, ...BASE,
      primaryContact: 'father', fatherName: 'Kwame Osei', fatherEmail: 'kwame@example.com',
      parentName: 'Kwame Osei', parentEmail: 'kwame@example.com', parentPhone: '', parentRelationship: 'Father',
    }];
    const res = await supertest(buildApp()).put('/api/admissions/app_2').send({ fatherPhone: '+254711111111' });
    expect(res.status).toBe(200);
    expect(res.body.data.parentPhone).toBe('+254711111111');
    expect(res.body.data.parentName).toBe('Kwame Osei'); // still father, still correct
  });

  test('a partial update that would leave both parents empty is rejected, not silently accepted', async () => {
    mockAppDocs = [{ id: 'app_3', schoolId: SCHOOL, ...BASE }];
    const res = await supertest(buildApp()).put('/api/admissions/app_3').send({ motherName: '', motherPhone: '', motherEmail: '' });
    expect(res.status).toBe(422);
  });
});
