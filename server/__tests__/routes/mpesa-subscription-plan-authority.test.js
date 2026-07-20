/* ============================================================
   POST /api/mpesa/subscription — plan-authority regression test.

   Real gap found via a platform-admin/school-Settings mismatch report:
   a school set to "Family" by platform admin showed "Student" in its own
   Settings, and the self-service M-Pesa flow let a school admin pick ANY
   tier and pay for it, silently overwriting whatever platform admin had
   set — two uncoordinated writers to the same schools.plan field.

   Decision (explicit, asked of and confirmed by the product owner):
   platform admin is the sole authority over which tier a school is on.
   This route must derive the tier being paid for from the school's own
   CURRENT plan (schools.plan) and ignore any tier/plan the client sends —
   self-service payment can only renew/pay for the existing tier, never
   change it.

   All DB and M-Pesa calls are mocked — no MongoDB or Daraja required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] };
    next();
  },
}));

let mockSchoolDoc = { id: 'sch_1', plan: 'family', slug: 'test-school', shortName: 'Test' };

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'schools') {
      return {
        findOne: () => ({
          lean:   () => Promise.resolve(mockSchoolDoc),
          select: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
        }),
      };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({
    create:    jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
    find:      () => ({ lean: () => Promise.resolve([]) }),
    findOne:   () => ({ sort: () => ({ lean: () => Promise.resolve(null) }) }),
  })),
  tenantContext: jest.fn((req) => ({ schoolId: req.jwtUser?.schoolId })),
}));

jest.mock('../../utils/counters', () => ({ nextReceiptNumber: jest.fn() }));

const mockStkPush = jest.fn().mockResolvedValue({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_test' });
jest.mock('../../utils/mpesa', () => ({
  normalizePhone: (p) => p,
  stkPush: (...args) => mockStkPush(...args),
}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    MSINGI_MPESA_CONSUMER_KEY:    'k',
    MSINGI_MPESA_CONSUMER_SECRET: 's',
    MSINGI_MPESA_SHORTCODE:       '123456',
    MSINGI_MPESA_PASSKEY:         'p',
  };
  mockSchoolDoc = { id: 'sch_1', plan: 'family', slug: 'test-school', shortName: 'Test' };
});
afterAll(() => { process.env = ORIGINAL_ENV; });

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/mpesa', require('../../routes/mpesa'));
  return a;
}

describe('POST /api/mpesa/subscription — plan authority', () => {
  test('charges for the school\'s CURRENT plan (family), ignoring a different tier sent by the client', async () => {
    const res = await supertest(app())
      .post('/api/mpesa/subscription')
      .send({ phone: '254712345678', tier: 'base', studentCount: 100 }); // client tries to pay for the cheaper "base" tier

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('family'); // server used the school's real plan, not the client-supplied 'base'
    expect(res.body.amount).toBe(350 * 100); // family rate, not base rate
  });

  test('also ignores the legacy "plan" param the same way', async () => {
    mockSchoolDoc.plan = 'student';
    const res = await supertest(app())
      .post('/api/mpesa/subscription')
      .send({ phone: '254712345678', plan: 'premium', studentCount: 10 }); // 'premium' legacy-maps to 'family'

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('student'); // still the school's real current plan
  });

  test('rejects with a clear message when the school is on Enterprise (no self-service rate)', async () => {
    mockSchoolDoc.plan = 'enterprise';
    const res = await supertest(app())
      .post('/api/mpesa/subscription')
      .send({ phone: '254712345678', studentCount: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/isn't a self-service tier/i);
  });

  test('rejects when the school has no plan set at all', async () => {
    mockSchoolDoc.plan = undefined;
    const res = await supertest(app())
      .post('/api/mpesa/subscription')
      .send({ phone: '254712345678', studentCount: 10 });

    expect(res.status).toBe(400);
  });
});
