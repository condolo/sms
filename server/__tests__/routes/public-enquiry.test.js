/* ============================================================
   server/routes/public-enquiry.js â€” the school's public enquiry form

   Proves the contract that matters:
     Â· opt-in only â€” absent/disabled config 404s, unknown slugs 404 the
       same way (no enumeration)
     Â· every field optional, but a lead with NO way to reach the family
       is refused
     Â· a submission lands in the admissions pipeline at 'enquiry' with
       source 'public_form', a reference, and the follow-up flags
     Â· class choices are school-scoped â€” an id from another school is
       rejected
     Â· honeypot and age bounds hold
   All DB calls are mocked â€” no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'sch_a';

/* The route builds its limiter at module load; tests submit more than a real
   parent ever would, so lift the cap here rather than skipping the limiter. */
process.env.PUBLIC_ENQUIRY_RATE_MAX = '1000';

let mockSchool = null;
let mockClasses = [];
let mockRoleDocs = [];
let mockCreated = [];

function mockChain(finalValue) {
  const c = {
    sort: () => c,
    select: () => c,
    limit: () => c,
    lean: () => Promise.resolve(finalValue),
  };
  return c;
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return { findOne: () => mockChain(mockSchool) };
    }
    if (collection === 'classes') {
      return {
        find: () => mockChain(mockClasses),
        findOne: (q) => ({
          select: () => ({
            lean: () => Promise.resolve(mockClasses.find((c) => c.id === q.id && (!q.schoolId || q.schoolId === SCHOOL_A)) || null),
          }),
        }),
      };
    }
    if (collection === 'role_permissions') {
      return { find: () => mockChain(mockRoleDocs) };
    }
    return { findOne: () => mockChain(null), find: () => mockChain([]) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => {
    if (collection === 'admissions') {
      return { create: (doc) => { mockCreated.push(doc); return Promise.resolve(doc); } };
    }
    if (collection === 'users') {
      return {
        find: () => ({
          select: () => ({
            limit: () => ({ lean: () => Promise.resolve([{ id: 'usr_1', name: 'Admissions Officer', email: 'adm@school.test' }]) }),
          }),
        }),
      };
    }
    return { create: () => Promise.resolve({}) };
  }),
}));

jest.mock('../../middleware/module-gate', () => ({
  isModuleEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/notify-dispatch', () => ({
  dispatchNotification: jest.fn().mockResolvedValue(undefined),
}));

const express = require('express');
const supertest = require('supertest');
const enquiryRouter = require('../../routes/public-enquiry');
const notify = require('../../utils/notify-dispatch');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public/enquiry', enquiryRouter);
  return app;
}

const baseSchool = {
  id: SCHOOL_A,
  slug: 'trinitas',
  name: 'Trinitas International School',
  shortName: 'Trinitas',
  isActive: true,
  status: 'active',
  admissionConfig: { publicEnquiry: { enabled: true } },
  academicYear: '2026/2027',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { ...baseSchool };
  mockClasses = [
    { id: 'cls_f1', schoolId: SCHOOL_A, name: 'Form 1' },
    { id: 'cls_f2', schoolId: SCHOOL_A, name: 'Form 2' },
  ];
  mockRoleDocs = [{ roleKey: 'admissions_officer', permissions: { admissions: ['read', 'create', 'update'] } }];
  mockCreated = [];
});

/* â”€â”€ GET config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

describe('GET /api/public/enquiry/:slug', () => {
  test('returns school branding and the class list when enabled', async () => {
    const res = await supertest(buildApp()).get('/api/public/enquiry/trinitas');
    expect(res.status).toBe(200);
    expect(res.body.data.school.name).toBe('Trinitas International School');
    expect(res.body.data.classes.map(c => c.name)).toEqual(['Form 1', 'Form 2']);
    // The public payload must never expose the school's config/pipeline.
    expect(res.body.data).not.toHaveProperty('admissionConfig');
    expect(JSON.stringify(res.body)).not.toContain('publicEnquiry');
  });

  test('404s when the school has not opted in', async () => {
    mockSchool = { ...baseSchool, admissionConfig: {} };
    const res = await supertest(buildApp()).get('/api/public/enquiry/trinitas');
    expect(res.status).toBe(404);
  });

  test('404s an unknown slug exactly like a disabled one', async () => {
    mockSchool = null;
    const res = await supertest(buildApp()).get('/api/public/enquiry/no-such-school');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Enquiry form not available.');
  });

  test('404s when the admissions module itself is disabled', async () => {
    const gate = require('../../middleware/module-gate');
    gate.isModuleEnabled.mockResolvedValueOnce(false);
    const res = await supertest(buildApp()).get('/api/public/enquiry/trinitas');
    expect(res.status).toBe(404);
  });
});

/* â”€â”€ POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

describe('POST /api/public/enquiry/:slug', () => {
  test('creates an enquiry from just a name, at stage enquiry with source public_form', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Jane Wanjiku' });
    expect(res.status).toBe(201);
    expect(res.body.data.ref).toMatch(/^APP-2026-[A-Z0-9]{6}$/);
    expect(mockCreated).toHaveLength(1);
    const doc = mockCreated[0];
    expect(doc).toMatchObject({
      schoolId: SCHOOL_A,
      parentName: 'Jane Wanjiku',
      stage: 'enquiry',
      enquirySource: 'public_form',
      priority: 'normal',
      firstName: '',
      lastName: '',
      tourCompleted: null,
      assessmentCompleted: null,
    });
    expect(doc.enquiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('phone alone is enough — every other field stays optional', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentPhone: '+254 711 000111' });
    expect(res.status).toBe(201);
    expect(mockCreated[0]).toMatchObject({
      parentName: '',
      parentPhone: '+254 711 000111',
      parentEmail: '',
      learnerAge: null,
      applyingForClass: null,
      applyingForClassName: '',
      heardAbout: null,
    });
  });

  test('email alone is enough, normalized to lower case', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentEmail: 'Parent@Example.COM' });
    expect(res.status).toBe(201);
    expect(mockCreated[0]).toMatchObject({
      parentName: '',
      parentPhone: '',
      parentEmail: 'parent@example.com',
    });
  });

  test('captures age, class, tour/assessment flags and source', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({
        parentName: 'Jane Wanjiku',
        parentPhone: '+254 700 000000',
        learnerAge: 12,
        applyingForClass: 'cls_f2',
        tourCompleted: true,
        assessmentCompleted: false,
        heardAbout: 'facebook',
        heardAboutOther: '',
      });
    // heardAbout enum uses the internal keys â€” 'facebook' is not one of them,
    // which proves unknown sources are refused rather than silently stored.
    expect(res.status).toBe(422);

    const ok = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({
        parentName: 'Jane Wanjiku',
        parentPhone: '+254 700 000000',
        learnerAge: 12,
        applyingForClass: 'cls_f2',
        tourCompleted: true,
        assessmentCompleted: false,
        heardAbout: 'social_media',
      });
    expect(ok.status).toBe(201);
    const doc = mockCreated[0];
    expect(doc).toMatchObject({
      parentPhone: '+254 700 000000',
      learnerAge: 12,
      applyingForClass: 'cls_f2',
      applyingForClassName: 'Form 2',
      tourCompleted: true,
      assessmentCompleted: false,
      heardAbout: 'social_media',
    });
  });

  test('refuses a submission with no name, phone or email', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ learnerAge: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/name or a way to reach/i);
    expect(mockCreated).toHaveLength(0);
  });

  test('rejects the honeypot without creating a case', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Bot', website: 'https://spam.example' });
    expect(res.status).toBe(400);
    expect(mockCreated).toHaveLength(0);
  });

  test('rejects a submission posted instantly (minimum fill time)', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Speed Bot', startedAt: Date.now() });
    expect(res.status).toBe(400);
    expect(mockCreated).toHaveLength(0);
  });

  test('rejects an out-of-range learner age', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Jane', learnerAge: 99 });
    expect(res.status).toBe(400);
    expect(mockCreated).toHaveLength(0);
  });

  test('rejects a class that does not belong to this school', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Jane', applyingForClass: 'cls_other_school' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/class from the list/i);
    expect(mockCreated).toHaveLength(0);
  });

  test('404s the POST when the form is disabled', async () => {
    mockSchool = { ...baseSchool, admissionConfig: { publicEnquiry: { enabled: false } } };
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Jane' });
    expect(res.status).toBe(404);
    expect(mockCreated).toHaveLength(0);
  });

  test('notifies admissions staff in-app after a successful submission', async () => {
    const res = await supertest(buildApp())
      .post('/api/public/enquiry/trinitas')
      .send({ parentName: 'Jane Wanjiku' });
    expect(res.status).toBe(201);
    // The notification is fire-and-forget: give it a tick.
    await new Promise(r => setTimeout(r, 0));
    expect(notify.dispatchNotification).toHaveBeenCalledTimes(1);
    expect(notify.dispatchNotification.mock.calls[0][0]).toMatchObject({
      eventKey: 'admission_enquiry',
      schoolId: SCHOOL_A,
      recipients: [{ userId: 'usr_1', name: 'Admissions Officer', email: 'adm@school.test' }],
    });
  });
});

