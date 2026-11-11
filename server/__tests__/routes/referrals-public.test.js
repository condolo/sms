/* ============================================================
   Public referral routes — contract at the HTTP edge

   The service itself is covered in referral-program.test.js; these
   tests pin the envelope, the status codes the /refer form depends on,
   and the fact that a form-time validation call never leaks partner
   details.
   ============================================================ */
'use strict';

const express = require('express');
const request = require('supertest');

const mockService = {
  getProgramSettings: jest.fn(),
  createPartner:      jest.fn(),
  normalizeCode:      jest.fn((c) => String(c || '').trim().toUpperCase()),
  resolveAttribution: jest.fn(),
  getHub:             jest.fn(),
  updatePayoutDetails: jest.fn(),
  requestPayout:      jest.fn(),
  resendHubLink:      jest.fn(),
};

jest.mock('../../services/referralService', () => mockService);

const router = require('../../routes/referrals');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/referrals', router);
  return app;
}

beforeEach(() => jest.clearAllMocks());

test('GET /program returns only public program terms', async () => {
  mockService.getProgramSettings.mockResolvedValue({
    enabled: true,
    bountyAmount: 5000,
    currency: 'KES',
    codePrefix: 'MSINGI',
    refereeIncentive: { type: 'percent', value: 10 },
    termsUrl: '/terms',
  });

  const res = await request(buildApp()).get('/api/referrals/program');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({
    enabled: true,
    bountyAmount: 5000,
    currency: 'KES',
    refereeIncentive: { type: 'percent', value: 10 },
    termsUrl: '/terms',
  });
  expect(res.body.data.codePrefix).toBeUndefined();
});

test('POST /partners rejects a form missing required contact details', async () => {
  const res = await request(buildApp()).post('/api/referrals/partners').send({ name: 'J' });
  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
});

test('POST /partners returns the code and both share links', async () => {
  mockService.createPartner.mockResolvedValue({
    ok: true,
    partner: { name: 'Jane', code: 'MSINGI-ABC234' },
    links: {
      onboardUrl: 'https://msingi.io/onboard?ref=MSINGI-ABC234',
      demoUrl: 'https://msingi.io/demo?ref=MSINGI-ABC234',
      hubUrl: 'https://msingi.io/refer/hub/token',
    },
    program: { enabled: true, bountyAmount: 5000, currency: 'KES' },
  });

  const res = await request(buildApp()).post('/api/referrals/partners').send({
    name: 'Jane Wanjiru',
    email: 'jane@example.com',
    phone: '+254700000000',
  });

  expect(res.status).toBe(201);
  expect(res.body.data.code).toBe('MSINGI-ABC234');
  expect(res.body.data.links.onboardUrl).toContain('MSINGI-ABC234');
  expect(res.body.data.links.hubUrl).toContain('/refer/hub/');
});

test('POST /partners reports a duplicate email as 409 without a code', async () => {
  mockService.createPartner.mockResolvedValue({
    ok: false,
    code: 'EMAIL_TAKEN',
    message: 'This email is already registered.',
  });

  const res = await request(buildApp()).post('/api/referrals/partners').send({
    name: 'Jane Wanjiru',
    email: 'jane@example.com',
    phone: '+254700000000',
  });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('EMAIL_TAKEN');
  expect(res.body.data).toBeUndefined();
});

test('GET /validate returns a boolean and never partner details', async () => {
  mockService.resolveAttribution.mockResolvedValue({
    ok: true,
    attribution: { referralCode: 'MSINGI-ABC234', referralPartnerId: 'ref_1' },
    partner: { id: 'ref_1', name: 'Jane', email: 'jane@example.com', code: 'MSINGI-ABC234' },
  });

  const res = await request(buildApp()).get('/api/referrals/validate?code=msingi-abc234');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ valid: true, code: 'MSINGI-ABC234' });
  expect(JSON.stringify(res.body)).not.toContain('jane@example.com');
});

test('GET /hub rejects an implausible token before hitting the service', async () => {
  const res = await request(buildApp()).get('/api/referrals/hub/short');
  expect(res.status).toBe(404);
  expect(mockService.getHub).not.toHaveBeenCalled();
});

test('POST /partners/resend always gives the same generic answer', async () => {
  mockService.resendHubLink.mockResolvedValue({ ok: true, sent: false });
  const res = await request(buildApp()).post('/api/referrals/partners/resend').send({ email: 'nobody@example.com' });
  expect(res.status).toBe(200);
  expect(res.body.data.message).toMatch(/If that email is registered/i);
  expect(mockService.resendHubLink).toHaveBeenCalledWith({ email: 'nobody@example.com' });
});

test('PATCH /hub payout-details saves the partner payout method', async () => {
  mockService.updatePayoutDetails.mockResolvedValue({
    ok: true,
    payout: { method: 'mpesa', phoneMasked: '+254•••••344', complete: true },
  });

  const res = await request(buildApp())
    .patch('/api/referrals/hub/abcdefghijklmnopqrstuvwx/payout-details')
    .send({ method: 'mpesa', payoutPhone: '+254700000344' });

  expect(res.status).toBe(200);
  expect(res.body.data.payout).toMatchObject({ method: 'mpesa', complete: true });
  expect(mockService.updatePayoutDetails).toHaveBeenCalledWith(expect.objectContaining({
    token: 'abcdefghijklmnopqrstuvwx',
    patch: expect.objectContaining({ payoutPhone: '+254700000344' }),
  }));
});

test('POST /hub payout-requests opens a manual payout request', async () => {
  mockService.requestPayout.mockResolvedValue({
    ok: true,
    request: { id: 'rpr_1', amount: 5000, currency: 'KES', status: 'requested' },
    payout: { method: 'mpesa', complete: true },
  });

  const res = await request(buildApp())
    .post('/api/referrals/hub/abcdefghijklmnopqrstuvwx/payout-requests')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.data.request).toMatchObject({ status: 'requested', amount: 5000 });
});

test('PATCH /hub payout-details reports an open-request lock as 409', async () => {
  mockService.updatePayoutDetails.mockResolvedValue({
    ok: false,
    code: 'PAYOUT_IN_REVIEW',
    message: 'A payout request is already under review.',
  });

  const res = await request(buildApp())
    .patch('/api/referrals/hub/abcdefghijklmnopqrstuvwx/payout-details')
    .send({ method: 'mpesa', payoutPhone: '+254700000344' });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('PAYOUT_IN_REVIEW');
});
